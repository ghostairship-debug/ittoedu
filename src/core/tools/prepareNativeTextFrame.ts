import type { NativeTextFramePort } from '../drivers/course/layerProperties'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { nativeTextMeasuredFrame, prepareNativeLayerTextMeasurement, unsupportedNativeTextMeasurement, type NativeLayerTextLayoutPatch, type NativeTextMeasurementSpec } from './nativeTextLayout'

export interface NativeTextMeasurementResult {
  measurementMode: 'browser-canvas'
  requiredWidth: number
  requiredHeight: number
}
export type AsyncNativeTextMeasurePort = (spec: NativeTextMeasurementSpec, options?: { signal?: AbortSignal }) => Promise<NativeTextMeasurementResult>

/** Prepare outside the canonical transaction, then give the synchronous planner
 * a port bound to the exact effective text, runs, geometry and styles measured. */
export async function prepareNativeTextFrame(item: LayerItem, patch: NativeLayerTextLayoutPatch, measure?: AsyncNativeTextMeasurePort, options?: { signal?: AbortSignal }): Promise<NativeTextFramePort> {
  const spec = prepareNativeLayerTextMeasurement(item, patch), identity = JSON.stringify(spec)
  options?.signal?.throwIfAborted()
  if (spec && !measure) throw unsupportedNativeTextMeasurement()
  const result = spec ? await measure!(structuredClone(spec), options) : null
  options?.signal?.throwIfAborted()
  if (result && result.measurementMode !== 'browser-canvas') throw Object.assign(new Error('宿主未返回真实 Canvas 字体测量，未应用修改'), { code: 'unsupported-measurement' })
  const frame = spec ? nativeTextMeasuredFrame(spec, result!) : {}
  return (currentItem, currentPatch) => {
    if (JSON.stringify(prepareNativeLayerTextMeasurement(currentItem, currentPatch)) !== identity) throw Object.assign(new Error('文字或样式已改变，原测量结果不能应用到新内容'), { code: 'stale-measurement' })
    return { ...frame }
  }
}
