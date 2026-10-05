import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'
import { mountPublishedCourseV3 } from '../../../player/componentPlatform/publishedPlayer'
import { prepareComponentOutputRegion } from '../../../player/componentPlatform/outputCapture'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { ensureBundledFonts } from '../../../shared/fonts/ensureBundledFonts'

export interface ObservationWorkerInput {
  published: PublishedCourseV3
  /** The observation protocol retains its existing name; this is a V10 surface id. */
  locationId: string
  stateId?: string | null
  diagnostics?: string[]
  bootstrapBaseUrl?: string
  instanceId?: string
  spatialFrameId?: string
}
export interface ObservationWorkerResult { locationId: string; stateId: string | null; structure: string[]; diagnostics: string[]; rect?: { x: number; y: number; width: number; height: number } }

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
  const player = await mountPublishedCourseV3(input.published, root, { capture: true, keyboardNavigation: false,
    initialSurfaceId: input.locationId, initialStateId: input.stateId ?? null, report: message => diagnostics.push(message),
    componentBootstrap: input.bootstrapBaseUrl ? {
      async createComponentBootstrap({ leaseId, html }) { const url = new URL(encodeURIComponent(leaseId), input.bootstrapBaseUrl); url.searchParams.set('html', html); return { leaseId, url: url.href } },
      async releaseComponentBootstrap() {},
    } : undefined })
  try {
    const rect = await prepareComponentOutputRegion({ payload: input.published, root, player, surfaceId: input.locationId,
      instanceId: input.instanceId, spatialFrameId: input.spatialFrameId })
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
