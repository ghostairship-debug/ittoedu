import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'
import type { CaptureObservationInput } from '../../../shared/ipcTypes'
import type { ComponentOutputCapture } from './delivery'
import { componentOutputPresentation, componentOutputSurface } from './presentation'
import { resolveComponentBackground, resolveComponentSurfaceBackground, componentContainerBuiltinKey } from '../../../shared/contracts/component-platform/project'

export type ComponentScreenshot = (input: CaptureObservationInput) => Promise<{ dataUrl: string; width: number; height: number }>

/** Capture the frozen publication in the existing isolated host, without touching the App view. */
export async function createComponentDeliveryCapture(payload: PublishedCourseV3, screenshot: ComponentScreenshot): Promise<ComponentOutputCapture> {
  let disposed = false, queue = Promise.resolve()
  const capture = (surfaceId: string, instanceId?: string, spatialFrameId?: string, backgroundOnly: false | 'project' | 'surface' | 'effective' = false) => {
    const work = queue.then(async () => {
      if (disposed) throw new Error('输出捕获已结束')
      const surface = componentOutputSurface(payload, surfaceId)
      if (!surface) throw new Error(`捕获表面已不存在：${surfaceId}`)
      let published = payload
      if (backgroundOnly) {
        const initial = componentOutputPresentation(payload, surfaceId)
        const effective = componentOutputSurface(initial, surfaceId)!
        const background = backgroundOnly === 'surface' ? resolveComponentSurfaceBackground(initial, effective) ?? { color: 'transparent', assetId: null, fit: 'cover' as const }
          : resolveComponentBackground(initial, backgroundOnly === 'project' ? undefined : effective)
        // The background uses the same Player and readiness owner, but contains
        // no authored objects, global planes or executable project logic.
        const definitionId = componentContainerBuiltinKey(surface.kind)
        published = { schemaVersion: 4, id: payload.id, title: payload.title, assets: payload.assets, background: { color: 'transparent' },
          definitions: { [definitionId]: { id: definitionId, role: 'content', implementation: { kind: 'builtin', key: definitionId } } },
          instances: { [surfaceId]: { id: surfaceId, definitionId, name: surface.title, data: {}, childIds: [],
            container: { kind: surface.kind, designSize: surface.designSize,
              background: background.paint ? { mode: 'own', paint: background.paint } : { mode: 'own', ...background } } } },
          global: { underlay: [], overlay: [] }, rootIds: [surfaceId], entry: { rootInstanceId: surfaceId } }
      }
      return screenshot({ kind: 'published', published, surfaceId, instanceId, spatialFrameId, staticExport: true,
        stateId: backgroundOnly ? null : surface.presentation?.initialStateId ?? null })
    })
    queue = work.then(() => {}, () => {})
    return work
  }
  return { captureInstance: (surfaceId, instanceId) => capture(surfaceId, instanceId),
    captureSurface: (surfaceId, spatialFrameId) => capture(surfaceId, undefined, spatialFrameId),
    captureBackground: (surfaceId, layer) => capture(surfaceId, undefined, undefined, layer ?? 'effective'),
    async dispose() { disposed = true; await queue } }
}
