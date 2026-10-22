import type { PublishedCourseV4 } from '../../shared/contracts/component-platform/published'
import { mountPublishedCourseV4, publishedComponentModel } from './publishedPlayer'
import { componentSurfaceGeometryTargets } from './spatialTargets'
import { spatialFramePose } from '../surfaces/spatial/componentPlatform/graph'
import { componentDefinitionBuiltinKey, componentSurface } from '../../shared/contracts/component-platform/project'

export interface ComponentOutputImage { dataUrl: string; width: number; height: number }
export interface ComponentOutputCaptureOptions {
  payload: PublishedCourseV4
  root: HTMLElement
  staticExport?: true
  screenshot(rect: { x: number; y: number; width: number; height: number }): Promise<ComponentOutputImage>
}

/** Camera and local-frame preparation is shared by isolated observation and output capture. */
export async function prepareComponentOutputRegion(input: {
  payload: PublishedCourseV4; root: HTMLElement; player: Awaited<ReturnType<typeof mountPublishedCourseV4>>;
  surfaceId: string; instanceId?: string; spatialFrameId?: string; staticExport?: true;
}): Promise<{ x: number; y: number; width: number; height: number }> {
  const { payload, root, player, surfaceId, instanceId, spatialFrameId } = input
  const surface = componentSurface(publishedComponentModel(payload).project, surfaceId)
  if (!surface) throw new Error(`捕获表面已不存在：${surfaceId}`)
  const omitted = new Set<string>()
  if (input.staticExport === true) {
    for (const instance of Object.values(payload.instances)) {
      const definition = payload.definitions[instance.definitionId], key = componentDefinitionBuiltinKey(definition) ?? definition?.id
      if (!key || !['guoling.navigation', 'guoling.teacher-controller'].includes(key)) continue
      if (instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && instance.data.includeInStaticExports === true) continue
      const target = player.runtime.targetElement(instance.id)
      if (target && root.contains(target)) { target.hidden = true; target.style.display = 'none'; omitted.add(instance.id) }
    }
  }
  if (spatialFrameId) {
    const frame = surface.spatial?.frames.find(value => value.id === spatialFrameId), camera = player.camera(surfaceId)
    if (!frame || !camera) throw new Error(`捕获镜头已不存在：${spatialFrameId}`)
    camera.set(spatialFramePose(frame, player.viewport(surfaceId) ?? surface.designSize ?? { width: 960, height: 640 }, componentSurfaceGeometryTargets(publishedComponentModel(payload).project, surfaceId)))
  }
  const container = Boolean(instanceId && payload.instances[instanceId]?.container)
  const localTarget = instanceId ? player.runtime.targetElement(instanceId) : undefined
  let containerTarget = localTarget
  if (container && instanceId) for (let parent = localTarget?.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (parent.dataset.componentObject === instanceId) { containerTarget = parent; break }
  }
  // A container's runtime target is its inner viewport. Its own authored paint,
  // border and opacity belong to the ordinary instance outer around that view.
  const element = instanceId ? container ? containerTarget : player.runtime.contentElement(instanceId)
    : payload.rootIds.includes(surfaceId) ? root : player.runtime.targetElement(surfaceId)
  if (!element) throw new Error(`捕获组件没有运行内容：${instanceId}`)
  await player.waitForCaptureReady(element)
  if (instanceId) {
    const target = container ? containerTarget : localTarget
    if (!target) throw new Error(`捕获组件没有本地投影：${instanceId}`)
    // Office applies the authored frame itself. Capture only local professional pixels.
    const local = root.ownerDocument.createElement('div')
    local.dataset.componentLocalCapture = instanceId
    const frame = payload.instances[instanceId]?.frame
    const width = frame?.width ?? target.offsetWidth, height = frame?.height ?? target.offsetHeight
    const scale = Math.min(1, root.clientWidth / Math.max(1, width), root.clientHeight / Math.max(1, height))
    Object.assign(local.style, { position: 'absolute', left: '0px', top: '0px', width: `${width}px`, height: `${height}px`,
      transform: `scale(${scale})`, transformOrigin: '0 0', background: 'transparent', zIndex: '10' })
    root.append(local)
    // This bitmap owns local pixels only; work/Surface paint belongs to the output page.
    for (const sibling of root.children) if (sibling !== local) (sibling as HTMLElement).style.display = 'none'
    player.runtime.beforeProjectionMutation()
    local.append(target)
    Object.assign(target.style, { position: 'relative', left: '0px', top: '0px', width: `${width}px`, height: `${height}px`, maxWidth: 'none', margin: '0px', float: 'none', transform: 'none', translate: 'none', rotate: 'none', scale: 'none' })
    // Flow's reading-lane fitting also belongs to its projection, never the
    // instance-local Office bitmap. The authored local frame remains 1:1.
    Object.assign(element.style, { position: 'absolute', inset: '0px', width: '100%', height: '100%', transform: 'none', translate: 'none', rotate: 'none', scale: 'none' })
    // The Flow stage can still have a fitted extent/height between target and
    // content. Reset that projection wrapper too, so 100% means the local frame.
    for (let wrapper = element === target ? null : element.parentElement; wrapper && wrapper !== target; wrapper = wrapper.parentElement) {
      Object.assign(wrapper.style, { position: 'absolute', inset: '0px', width: '100%', height: '100%', transform: 'none', translate: 'none', rotate: 'none', scale: 'none' })
    }
    player.runtime.afterProjectionMutation()
    for (const outer of root.querySelectorAll<HTMLElement>('[data-component-object],[data-component-instance-id]')) {
      const ownerId = outer.dataset.componentObject ?? outer.dataset.componentInstanceId
      if (ownerId !== instanceId && !outer.contains(target) && !(container && target.contains(outer))) outer.hidden = true
    }
    if (!omitted.has(instanceId)) target.hidden = false
    // Reparenting native media can restart decoding. Prepare the final local
    // projection through the same target readiness owner before photographing it.
    await player.waitForCaptureReady(element)
  }
  if (input.staticExport === true) {
    // Static formats consume the decoded video/poster, not browser playback UI.
    // Apply this after readiness, since asset updates reapply authored controls.
    for (const instance of Object.values(payload.instances)) {
      if (componentDefinitionBuiltinKey(payload.definitions[instance.definitionId]) !== 'guoling.video') continue
      const content = player.runtime.contentElement(instance.id)
      for (const video of content?.querySelectorAll<HTMLVideoElement>('video[data-media-kind="video"]') ?? []) {
        if (video.dataset.mediaInstanceId === instance.id) video.controls = false
      }
    }
  }
  const view = root.ownerDocument.defaultView
  if (!view) throw new Error('捕获窗口已关闭')
  await root.ownerDocument.fonts?.ready
  await new Promise<void>(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())))
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) throw new Error('捕获目标没有可见运行尺寸')
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** Every image starts a fresh author-initial run of the supplied immutable payload. */
export async function prepareComponentOutputCapture(options: ComponentOutputCaptureOptions) {
  let disposed = false, current: Awaited<ReturnType<typeof mountPublishedCourseV4>> | undefined
  let queue = Promise.resolve()
  const capture = (surfaceId: string, instanceId?: string, spatialFrameId?: string): Promise<ComponentOutputImage> => {
    const work = queue.then(async () => {
      if (disposed) throw new Error('输出捕获已结束')
      const surface = componentSurface(publishedComponentModel(options.payload).project, surfaceId)
      if (!surface) throw new Error(`捕获表面已不存在：${surfaceId}`)
      current = await mountPublishedCourseV4(options.payload, options.root, { initialSurfaceId: surfaceId, capture: true, keyboardNavigation: false })
      try {
        if (disposed) throw new Error('输出捕获已结束')
        const rect = await prepareComponentOutputRegion({ payload: options.payload, root: options.root, player: current,
          surfaceId, instanceId, spatialFrameId, staticExport: options.staticExport })
        return await options.screenshot({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      } finally { await current.dispose(); current = undefined; options.root.querySelector('[data-component-local-capture]')?.remove() }
    })
    queue = work.then(() => {}, () => {})
    return work
  }
  return {
    captureInstance: (surfaceId: string, instanceId: string) => capture(surfaceId, instanceId),
    captureSurface: (surfaceId: string, spatialFrameId?: string) => capture(surfaceId, undefined, spatialFrameId),
    async dispose() { if (disposed) return; disposed = true; await current?.dispose(); await queue },
  }
}
