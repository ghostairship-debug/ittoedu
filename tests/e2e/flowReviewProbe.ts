import { isControllerFixture } from '../fixtures/teacherController'
import type { Page } from 'playwright'

/** Real media and Published host probe; fixtures never touch an open editor project. */
export async function runFlowReviewProbe(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string): Promise<any> => import(path)
    const { createBlankCourseProject } = await load('/src/renderer/project/createCourseProject.ts')
    const { addCourseFlowPage } = await load('/src/renderer/course/courseLocationCommands.ts')
    const { createVideoNode, createTextNode } = await load('/src/renderer/project/nativeNodeFactories.ts')
    const { sceneNodeToCourseLayerItem } = await load('/src/shared/courseProjectModel.ts')
    const { courseProjectDocumentSchema } = await load('/src/shared/courseProjectSchema.ts')
    const { parseComponentPackageFiles } = await load('/src/renderer/components/importComponentPackage.ts')
    const { componentPackageMeta } = await load('/src/renderer/components/editableComponentPackage.ts')
    const { buildPublishedCourseV2Payload } = await load('/src/renderer/export/course/buildPublishedCourse.ts')
    const { createPublishedCourseSession } = await load('/src/player/surfaces/publishedDynamicHosts.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 160; canvas.height = 90
    const context = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)
    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const recorded = new Promise<Blob>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data)
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
    })
    recorder.start()
    let frame = 0
    const draw = setInterval(() => {
      context.fillStyle = frame++ % 2 ? '#1976d2' : '#e65100'
      context.fillRect(0, 0, 160, 90)
    }, 30)
    await new Promise(resolve => setTimeout(resolve, 650))
    recorder.stop()
    const videoBytes = new Uint8Array(await (await recorded).arrayBuffer())
    clearInterval(draw)
    stream.getTracks().forEach(track => track.stop())
    const fallback = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
    const added = addCourseFlowPage(createBlankCourseProject({ title: 'Flow review fixture' }), {})
    if (!added.ok) throw new Error(added.reason)
    const project = added.project
    const flow = project.surfaces.find((surface: any) => surface.type === 'flow')
    const firstLocation = project.locations.find((location: any) => location.surfaceId === flow.id)
    const slideLocation = project.locations.find((location: any) => location.kind === 'slide-scene')
    const secondLocationId = 'flow-second-location'
    flow.blocks.push({ id: 'second-heading', type: 'heading', level: 2, text: '第二个正式课程位置' })
    project.locations.push({ id: secondLocationId, kind: 'flow-block', surfaceId: flow.id, blockId: 'second-heading', label: '第二位置' })
    project.media.audio.defaultMuted = true
    project.assets.clip = { id: 'clip', kind: 'video', filename: 'clip.webm', path: 'assets/clip.webm', mimeType: 'video/webm', byteLength: videoBytes.length, width: 160, height: 90, duration: 0.65 }
    project.assets.fallback = { id: 'fallback', kind: 'image', filename: 'fallback.png', path: 'assets/fallback.png', mimeType: 'image/png', byteLength: fallback.length, width: 1, height: 1 }
    const manifest = { schemaVersion: 4, runtimeApiVersion: 4, id: 'flow-counter', name: 'Flow counter', version: '1.0.0', entry: 'runtime.js',
      defaultSize: { width: 260, height: 80 }, minSize: { width: 100, height: 40 }, preserveAspectRatio: false,
      assets: {}, defaultProps: {}, supportedScopes: ['scene'], renderMode: 'dom', editor: { properties: [] } }
    const component = parseComponentPackageFiles({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      'runtime.js': new TextEncoder().encode(`CoursewareComponent.define({id:'flow-counter',runtimeApiVersion:4,create(ctx){
        let count=0;const button=document.createElement('button');button.textContent='0';button.dataset.counter='true';
        button.style.cssText='width:240px;height:60px;font:24px sans-serif';button.onclick=()=>button.textContent=String(++count);
        ctx.dom.root.append(button);return {destroy(){button.remove()}}}})`),
    })
    project.componentPackages[manifest.id] = componentPackageMeta(component)
    flow.blocks.splice(1, 0, { id: 'body-counter', type: 'component', component: { packageId: manifest.id, version: manifest.version }, props: {}, staticFallbackAssetId: 'fallback' })
    const counter = { layerItemId: 'overlay-counter', label: 'Overlay counter', kind: 'component', component: { packageId: manifest.id, version: manifest.version }, props: {}, staticFallbackAssetId: 'fallback',
      frame: { mode: 'absolute', x: 800, y: 80, width: 260, height: 80 }, order: 4, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit' }
    flow.surfaceLayerItems.push({ item: counter, visibility: { mode: 'all', locationIds: [] } })
    flow.surfaceLayerItems.push({ item: { ...structuredClone(counter), layerItemId: 'conditional-counter', frame: { ...counter.frame, y: 170 } }, visibility: { mode: 'include', locationIds: [firstLocation.id] } })
    flow.surfaceLayerItems.push({ item: sceneNodeToCourseLayerItem(createVideoNode({ id: 'flow-video', assetId: 'clip', x: 800, y: 280, width: 320, height: 180, loop: true })), visibility: { mode: 'all', locationIds: [] } })
    flow.surfaceLayerItems.push({ item: sceneNodeToCourseLayerItem(createTextNode({ id: 'rotated-text', text: '旋转 30°', x: 820, y: 500, width: 220, height: 70, rotation: 30 })), visibility: { mode: 'all', locationIds: [] } })
    flow.surfaceLayerItems.forEach((entry: any, index: number) => { entry.item.order = index })
    const parsed = courseProjectDocumentSchema.parse(project)
    const payload = buildPublishedCourseV2Payload({ project: parsed, assetFiles: { clip: videoBytes, fallback }, components: { [manifest.id]: component } })
    const root = document.createElement('div')
    root.id = 'flow-review-fixture'
    root.style.cssText = 'position:fixed;inset:0;width:1280px;height:720px;background:white;z-index:999999'
    document.body.append(root)
    const session = createPublishedCourseSession(payload, { initialLocationId: firstLocation.id })
    const findButton = (selector: string) => root.querySelector(selector)?.querySelector('.published-component-mount')?.shadowRoot?.querySelector<HTMLButtonElement>('[data-counter]')
    try {
      await session.mount(root)
      const video = root.querySelector<HTMLVideoElement>('video')!
      const defaultMuted = video.muted
      const body = findButton('[data-flow-block-id="body-counter"]')!
      const overlay = findButton('[data-flow-overlay-item="overlay-counter"]')!
      if (!body || !overlay || !video) throw new Error('Missing mounted fixture elements')
      body.click(); overlay.click()
      await video.play()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video did not advance')), 4000)
        const onTime = () => { if (video.currentTime > 0) { clearTimeout(timer); video.removeEventListener('timeupdate', onTime); resolve() } }
        video.addEventListener('timeupdate', onTime)
        onTime()
      })
      const playing = !video.paused
      const controllerItem = project.globalLayerItems.find((entry: any) => isControllerFixture(entry.item)).item
      const muteId = controllerItem.content.data.buttons.find((button: any) => button.action.type === 'audio.toggle-mute').id
      root.querySelector<HTMLElement>('.flow-surface-host [aria-label="展开教师控制器"]')?.click()
      const mute = root.querySelector<HTMLElement>(`[data-controller-button-id="${muteId}"]`)!
      if (!mute) throw new Error(JSON.stringify({ muteId, buttons: Array.from(root.querySelectorAll('button')).map(button => ({ id: button.dataset.controllerButtonId, text: button.textContent, label: button.getAttribute('aria-label') })) }))
      mute.click()
      await Promise.resolve()
      const controllerUnmuted = !video.muted
      mute.click()
      await Promise.resolve()
      const controllerMuted = video.muted
      await session.goToLocation(secondLocationId)
      const anchorsPreserved = body === findButton('[data-flow-block-id="body-counter"]') && overlay === findButton('[data-flow-overlay-item="overlay-counter"]')
        && body.textContent === '1' && overlay.textContent === '1'
      const conditionalRemoved = !root.querySelector('[data-flow-overlay-item="conditional-counter"]')
      await session.goToLocation(firstLocation.id)
      const conditionalRestored = !!findButton('[data-flow-overlay-item="conditional-counter"]')
      let pausedOnLeave = true, progressPreserved = true
      for (let i = 0; i < 2; i++) {
        await video.play()
        await session.goToLocation(slideLocation.id)
        pausedOnLeave &&= video.paused
        const progress = video.currentTime
        await session.goToLocation(firstLocation.id)
        progressPreserved &&= root.querySelector('video') === video && video.paused && video.currentTime === progress
      }
      const rotated = root.querySelector<HTMLElement>('[data-flow-overlay-item="rotated-text"]')!
      const rotation = getComputedStyle(rotated).transform
      await session.navigator.goToLocation(firstLocation.id, { force: true })
      const replayReset = body !== findButton('[data-flow-block-id="body-counter"]') && findButton('[data-flow-block-id="body-counter"]')?.textContent === '0'
      const latestVideo = root.querySelector<HTMLVideoElement>('video')!
      await latestVideo.play()
      await session.destroy()
      const destroyedPaused = latestVideo.paused
      return { defaultMuted, playing, controllerUnmuted, controllerMuted, anchorsPreserved, conditionalRemoved, conditionalRestored,
        pausedOnLeave, progressPreserved, replayReset, destroyedPaused, rotation }
    } finally {
      await session.destroy()
      root.remove()
    }
  })
}
