import { analyzeTextNodeLayout } from '../../shared/textLayout'
import { nativeTextAutoSizeFrame as planTextFrame, nativeLayerTextAutoSizeFrame as planLayerFrame } from '../../core/tools/nativeTextLayout'
export type { NativeTextLayoutPatch } from '../../core/tools/nativeTextLayout'

/** The renderer supplies actual canvas/font measurements to the canonical size decision. */
export function nativeTextAutoSizeFrame(node: Parameters<typeof planTextFrame>[0], patch: Parameters<typeof planTextFrame>[1]) {
  return planTextFrame(node, patch, analyzeTextNodeLayout)
}
export function nativeLayerTextAutoSizeFrame(item: Parameters<typeof planLayerFrame>[0], patch: Parameters<typeof planLayerFrame>[1]) {
  return planLayerFrame(item, patch, analyzeTextNodeLayout)
}
