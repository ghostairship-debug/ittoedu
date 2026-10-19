import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'
import { mountPublishedCourseV3 } from '../../../player/componentPlatform/publishedPlayer'
import { prepareComponentOutputRegion } from '../../../player/componentPlatform/outputCapture'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { ensureBundledFonts } from '../../../shared/fonts/ensureBundledFonts'
import { installedBundledFontFaceCss } from '../../../shared/fonts/installedBundledFontFaceCss'

export interface ObservationWorkerInput {
  published: PublishedCourseV3
  /** The observation protocol retains its existing name; this is a V10 surface id. */
  locationId: string
  stateId?: string | null
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

async function readInteractiveObservation(): Promise<ObservationWorkerResult> {
  if (!interactive) throw new Error('课件运行观察尚未建立')
  const { input, player, root, diagnostics } = interactive
  await player.waitForCaptureReady(root)
  const locationId = player.navigation.read().locationId
  const surface = input.published.surfaces.find(value => value.id === locationId)
  if (!surface) throw new Error('课件运行位置不存在')
  const structure = [surface.title, surface.kind]
  const visit = (ids: readonly string[]) => { for (const id of ids) {
    const instance = input.published.instances[id]
    if (!instance) continue
    structure.push(instance.name ?? input.published.definitions[instance.definitionId]?.title ?? id)
    visit(instance.childIds ?? [])
  } }
  visit([...input.published.global.underlay, ...surface.childIds, ...input.published.global.overlay])
  return { locationId: surface.id, stateId: player.navigation.currentStateId(), structure, diagnostics: [...diagnostics] }
}

async function selectInteractiveObservation(locationId: string, stateId: string | null): Promise<ObservationWorkerResult> {
  if (!interactive) throw new Error('课件运行观察尚未建立')
  const { input, player, root } = interactive
  const surface = input.published.surfaces.find(value => value.id === locationId)
  if (!surface) throw new Error('课件观察页面不存在')
  const size = surface.designSize ?? { width: 1280, height: 720 }
  Object.assign(root.style, { width: `${size.width}px`, height: `${size.height}px` })
  const before = player.navigation.read().locationId, currentState = player.navigation.currentStateId()
  if (before !== locationId || currentState !== stateId) {
    if (!await player.go(locationId, stateId ?? undefined)) throw new Error('播放器没有接受观察页面导航')
    // The ordinary previous-step command exposes a scene's base presentation.
    if (stateId === null && surface.kind !== 'spatial') {
      for (let remaining = (surface.presentation?.states.length ?? 0) + 1; player.navigation.currentStateId() !== null && remaining > 0; remaining--)
        if (!await player.previous()) break
    }
  }
  const result = await readInteractiveObservation()
  if (result.locationId !== locationId || (surface.kind !== 'spatial' && result.stateId !== stateId)) throw new Error('播放器没有到达请求的观察页面或状态')
  return result
}

function decode(value: string): Uint8Array { return Uint8Array.from(atob(value), character => character.charCodeAt(0)) }

/** Main captures the real pixels of this fixed isolated renderer entrypoint. */
export async function renderObservationSnapshot(input: ObservationWorkerInput): Promise<ObservationWorkerResult> {
  const surface = input.published.surfaces.find(value => value.id === input.locationId)
  if (!surface) throw new Error('观察目标页不存在')
  installBundledFontFaces()
  await ensureBundledFonts()
  const root = document.createElement('div'), size = surface.designSize ?? { width: 1280, height: 720 }
  root.id = 'observation-root'
  Object.assign(root.style, { width: `${size.width}px`, height: `${size.height}px`, overflow: 'hidden', position: 'fixed', inset: '0' })
  document.body.replaceChildren(root)
  const diagnostics = [...(input.diagnostics ?? [])]
  if (interactive) { await interactive.player.dispose(); interactive = undefined }
  const player = await mountPublishedCourseV3(input.published, root, { capture: input.interactive !== true, keyboardNavigation: false,
    fontFaceCss: installedBundledFontFaceCss(document),
    initialSurfaceId: input.locationId, initialStateId: input.stateId ?? null, report: message => diagnostics.push(message),
    componentBootstrap: input.bootstrapBaseUrl ? {
      async createComponentBootstrap({ leaseId, html }) { const url = new URL(encodeURIComponent(leaseId), input.bootstrapBaseUrl); url.searchParams.set('html', html); return { leaseId, url: url.href } },
      async releaseComponentBootstrap() {},
    } : undefined })
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
    const structure = [surface.title, surface.kind]
    const visit = (ids: readonly string[]) => { for (const id of ids) {
      const instance = input.published.instances[id]
      if (!instance) continue
      structure.push(instance.name ?? input.published.definitions[instance.definitionId]?.title ?? id)
      visit(instance.childIds ?? [])
    } }
    visit([...input.published.global.underlay, ...surface.childIds, ...input.published.global.overlay])
    // The owner destroys the isolated BrowserWindow after capture; keep this world
    // mounted until those pixels have actually been read.
    return { locationId: actual, stateId, structure, diagnostics, ...(input.instanceId ? { rect } : {}) }
  } catch (error) { await player.dispose(); throw error }
}

Object.defineProperty(window, '__COURSEWARE_OBSERVATION_RUN__', {
  configurable: false, writable: false, value: (encoded: string) => renderObservationSnapshot(
    JSON.parse(new TextDecoder().decode(decode(encoded))) as ObservationWorkerInput),
})
Object.defineProperty(window, '__COURSEWARE_OBSERVATION_READ__', { configurable: false, writable: false, value: readInteractiveObservation })
Object.defineProperty(window, '__COURSEWARE_OBSERVATION_SELECT__', { configurable: false, writable: false, value: selectInteractiveObservation })
