import { componentRootInstance, componentSurface, type ComponentSurface } from '../../../shared/contracts/component-platform/project'
import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'
import { mountPublishedCourseV3 } from '../../../player/componentPlatform/publishedPlayer'
import { prepareComponentOutputRegion } from '../../../player/componentPlatform/outputCapture'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { installedBundledFontFaceCss } from '../../../shared/fonts/installedBundledFontFaceCss'

export interface ObservationWorkerInput {
  published: PublishedCourseV3
  /** The observation protocol retains its name; a location can be a container or a formal program root. */
  locationId: string
  stateId?: string | null
  /** Actual isolated-host viewport. Programs have no implicit author design size. */
  viewport?: { width: number; height: number }
  diagnostics?: string[]
  bootstrapBaseUrl?: string
  instanceId?: string
  spatialFrameId?: string
  staticExport?: true
  /** A task's persistent test run uses ordinary playback; export snapshots retain capture mode. */
  interactive?: true
}
export interface ObservationWorkerResult { locationId: string; stateId: string | null; structure: string[]; diagnostics: string[]; rect?: { x: number; y: number; width: number; height: number } }
let interactive: { input: ObservationWorkerInput; player: Awaited<ReturnType<typeof mountPublishedCourseV3>>; root: HTMLElement; diagnostics: string[] } | undefined
let mountedPlayer: Awaited<ReturnType<typeof mountPublishedCourseV3>> | undefined

function observationLocation(published: PublishedCourseV3, locationId: string) {
  const surface = componentSurface(published, locationId), root = componentRootInstance(published, locationId)
  if (!surface && !root) throw new Error('课件观察位置不存在')
  const title = surface?.title ?? root?.name ?? published.definitions[root!.definitionId]?.title ?? locationId
  return { surface, title, kind: surface?.kind ?? 'program', childIds: surface?.childIds ?? root?.childIds ?? [] }
}

function observationViewport(input: ObservationWorkerInput, surface?: Readonly<ComponentSurface>) {
  return input.viewport ?? surface?.designSize ?? (surface ? { width: 1280, height: 720 }
    : { width: window.innerWidth, height: window.innerHeight })
}

function observationStructure(published: PublishedCourseV3, locationId: string): string[] {
  const location = observationLocation(published, locationId), structure = [location.title, location.kind]
  const visit = (ids: readonly string[]) => { for (const id of ids) {
    const instance = published.instances[id]
    if (!instance) continue
    structure.push(instance.name ?? published.definitions[instance.definitionId]?.title ?? id)
    visit(instance.childIds ?? [])
  } }
  visit([...published.global.underlay, ...location.childIds, ...published.global.overlay])
  return structure
}

async function readInteractiveObservation(): Promise<ObservationWorkerResult> {
  if (!interactive) throw new Error('课件运行观察尚未建立')
  const { input, player, root, diagnostics } = interactive
  await player.waitForCaptureReady(root)
  const locationId = player.navigation.read().locationId
  if (!locationId) throw new Error('课件运行位置不存在')
  return { locationId, stateId: player.navigation.currentStateId(),
    structure: observationStructure(input.published, locationId), diagnostics: [...diagnostics] }
}

async function selectInteractiveObservation(locationId: string, stateId: string | null,
  viewport?: { width: number; height: number }): Promise<ObservationWorkerResult> {
  if (!interactive) throw new Error('课件运行观察尚未建立')
  const { input, player, root } = interactive
  const { surface } = observationLocation(input.published, locationId)
  if (!surface && stateId !== null) throw new Error('程序根没有容器展示状态')
  const size = observationViewport({ ...input, viewport }, surface)
  Object.assign(root.style, { width: `${size.width}px`, height: `${size.height}px` })
  const before = player.navigation.read().locationId, currentState = player.navigation.currentStateId()
  if (before !== locationId || currentState !== stateId) {
    if (!await player.go(locationId, stateId ?? undefined)) throw new Error('播放器没有接受观察页面导航')
    // The ordinary previous-step command exposes a scene's base presentation.
    if (stateId === null && surface && surface.kind !== 'spatial') {
      for (let remaining = (surface.presentation?.states.length ?? 0) + 1; player.navigation.currentStateId() !== null && remaining > 0; remaining--)
        if (!await player.previous()) break
    }
  }
  const result = await readInteractiveObservation()
  if (result.locationId !== locationId || (surface?.kind !== 'spatial' && result.stateId !== stateId)) throw new Error('播放器没有到达请求的观察页面或状态')
  return result
}

/** Main captures the real pixels of this fixed isolated renderer entrypoint. */
export async function renderObservationSnapshot(input: ObservationWorkerInput): Promise<ObservationWorkerResult> {
  const { surface } = observationLocation(input.published, input.locationId)
  if (!surface && input.stateId) throw new Error('程序根没有容器展示状态')
  installBundledFontFaces()
  // Keep the window and font cache; every image gets a fresh author-initial run.
  // Disposal precedes root replacement so local captures and scopes are released.
  const previous = mountedPlayer
  mountedPlayer = undefined; interactive = undefined
  await previous?.dispose()
  const root = document.createElement('div'), size = observationViewport(input, surface)
  root.id = 'observation-root'
  Object.assign(root.style, { width: `${size.width}px`, height: `${size.height}px`, overflow: 'hidden', position: 'fixed', inset: '0' })
  document.body.replaceChildren(root)
  const diagnostics = [...(input.diagnostics ?? [])]
  const player = await mountPublishedCourseV3(input.published, root, { capture: input.interactive !== true, keyboardNavigation: false,
    progressPersistence: false,
    fontFaceCss: installedBundledFontFaceCss(document),
    initialSurfaceId: input.locationId, initialStateId: input.stateId ?? null, report: message => diagnostics.push(message),
    componentBootstrap: input.bootstrapBaseUrl ? {
      async createComponentBootstrap({ leaseId, html }) {
        const url = new URL(encodeURIComponent(leaseId), input.bootstrapBaseUrl)
        const response = await fetch(url, { method: 'POST', body: html, credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
        if (!response.ok) throw new Error(`组件观察内容准备失败（${response.status}）`)
        return { leaseId, url: url.href }
      },
      async releaseComponentBootstrap({ leaseId }) {
        const response = await fetch(new URL(encodeURIComponent(leaseId), input.bootstrapBaseUrl), { method: 'DELETE', credentials: 'omit' })
        if (!response.ok) throw new Error(`组件观察内容清理失败（${response.status}）`)
      },
    } : undefined })
  mountedPlayer = player
  try {
    if (input.interactive) {
      interactive = { input, player, root, diagnostics }
      Object.defineProperty(window, 'coursePlayer', { configurable: true, value: player })
      return await readInteractiveObservation()
    }
    const rect = await prepareComponentOutputRegion({ payload: input.published, root, player, surfaceId: input.locationId,
      instanceId: input.instanceId, spatialFrameId: input.spatialFrameId, staticExport: input.staticExport })
    const actual = player.navigation.read().locationId, stateId = player.navigation.currentStateId()
    if (actual !== input.locationId || stateId !== (input.stateId ?? null)) throw new Error('播放器未停留在请求的页面和状态')
    const structure = observationStructure(input.published, input.locationId)
    // Keep this world mounted until Main reads its pixels. The next target
    // disposes it before remounting; job close destroys the isolated window.
    return { locationId: actual, stateId, structure, diagnostics, ...(input.instanceId ? { rect } : {}) }
  } catch (error) {
    if (mountedPlayer === player) { mountedPlayer = undefined; interactive = undefined }
    await player.dispose(); throw error
  }
}

Object.defineProperty(window, '__COURSEWARE_OBSERVATION_RUN__', {
  configurable: false, writable: false, value: async (payloadUrl: string) => {
    const response = await fetch(payloadUrl, { credentials: 'omit', cache: 'no-store' })
    if (!response.ok) throw new Error(`观察内容读取失败（${response.status}）`)
    return renderObservationSnapshot(await response.json() as ObservationWorkerInput)
  },
})
Object.defineProperty(window, '__COURSEWARE_OBSERVATION_READ__', { configurable: false, writable: false, value: readInteractiveObservation })
Object.defineProperty(window, '__COURSEWARE_OBSERVATION_SELECT__', { configurable: false, writable: false, value: selectInteractiveObservation })
