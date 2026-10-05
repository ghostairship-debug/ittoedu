import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'
import type { CaptureObservationInput } from '../../../shared/ipcTypes'
import type { ComponentOutputCapture } from './delivery'

export type ComponentScreenshot = (input: CaptureObservationInput) => Promise<{ dataUrl: string; width: number; height: number }>

/** Capture the frozen publication in the existing isolated host, without touching the App view. */
export async function createComponentDeliveryCapture(payload: PublishedCourseV3, screenshot: ComponentScreenshot): Promise<ComponentOutputCapture> {
  let disposed = false, queue = Promise.resolve()
  const capture = (surfaceId: string, instanceId?: string, spatialFrameId?: string) => {
    const work = queue.then(async () => {
      if (disposed) throw new Error('输出捕获已结束')
      const surface = payload.surfaces.find(value => value.id === surfaceId)
      if (!surface) throw new Error(`捕获表面已不存在：${surfaceId}`)
      return screenshot({ kind: 'published', published: payload, surfaceId, instanceId, spatialFrameId,
        stateId: surface.presentation?.initialStateId ?? null })
    })
    queue = work.then(() => {}, () => {})
    return work
  }
  return { captureInstance: (surfaceId, instanceId) => capture(surfaceId, instanceId),
    captureSurface: (surfaceId, spatialFrameId) => capture(surfaceId, undefined, spatialFrameId),
    async dispose() { disposed = true; await queue } }
}
