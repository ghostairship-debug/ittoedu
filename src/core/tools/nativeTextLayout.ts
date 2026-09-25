import type { TextNode } from '../../shared/contracts/native-v1'
import type { LayerFrame, LayerItem } from '../../shared/courseProjectTypes'
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import { isVerticalWritingMode } from '../../shared/textLayout'

export type NativeTextMeasurePort = (node: TextNode, width: number) => { requiredWidth: number; requiredHeight: number }
export interface NativeTextMeasurementSpec { node: TextNode; width: number; axis: 'width' | 'height' }
export type NativeLayerTextLayoutPatch = {
  readonly frame?: Partial<Pick<LayerFrame, 'x' | 'y' | 'width' | 'height'>>
  readonly nativeTextStyle?: Partial<TextNode['style']>
  readonly nativeData?: Record<string, unknown>
}

type TextSize = Pick<TextNode, 'width' | 'height'>
export type NativeTextLayoutPatch = Partial<Pick<TextNode, 'text' | 'runs' | 'width' | 'height'>> & {
  readonly style?: Partial<TextNode['style']>
}

/** Derive only the automatic axis; an explicit size in this edit remains authoritative. */
export function prepareNativeTextMeasurement(
  node: TextNode,
  patch: NativeTextLayoutPatch,
): NativeTextMeasurementSpec | null {
  if (!['text', 'runs', 'style', 'width', 'height'].some(
    key => patch[key as keyof NativeTextLayoutPatch] !== undefined,
  )) return null
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  const next = { ...node, ...defined, style: { ...node.style, ...patch.style } } as TextNode
  // Reapplying current properties must not materialize a different auto-sized box
  // (and an undo entry) for an otherwise unchanged authored node.
  const changed = next.text !== node.text
    || JSON.stringify(next.runs) !== JSON.stringify(node.runs)
    || next.width !== node.width || next.height !== node.height
    || Object.entries(next.style).some(([key, value]) => value !== node.style[key as keyof TextNode['style']])
  if (!changed) return null
  if (next.style.overflow !== 'auto-height') return null
  const vertical = isVerticalWritingMode(next.style.writingMode)
  const axis = vertical ? 'width' : 'height'
  if (patch[axis] !== undefined) return null
  return { node: structuredClone(next), width: next.width, axis }
}

export function unsupportedNativeTextMeasurement(): Error {
  return Object.assign(new Error('该文字修改需要真实字体测量，当前宿主尚未提供测量端口'), { code: 'unsupported-measurement' })
}
export function nativeTextMeasuredFrame(spec: NativeTextMeasurementSpec, layout: ReturnType<NativeTextMeasurePort>): Partial<TextSize> {
  if (![layout.requiredWidth, layout.requiredHeight].every(value => Number.isFinite(value) && value >= 0)) {
    throw Object.assign(new Error('文字测量返回了无效尺寸，未应用修改'), { code: 'invalid-measurement' })
  }
  return { [spec.axis]: Math.max(16, spec.axis === 'width' ? layout.requiredWidth : layout.requiredHeight) }
}
export function nativeTextAutoSizeFrame(node: TextNode, patch: NativeTextLayoutPatch, measure?: NativeTextMeasurePort): Partial<TextSize> {
  const spec = prepareNativeTextMeasurement(node, patch)
  if (!spec) return {}
  if (!measure) throw unsupportedNativeTextMeasurement()
  return nativeTextMeasuredFrame(spec, measure(spec.node, spec.width))
}

/** The effective item already includes the current named-state overrides. */
export function prepareNativeLayerTextMeasurement(
  item: LayerItem,
  patch: NativeLayerTextLayoutPatch,
): NativeTextMeasurementSpec | null {
  if (item.kind !== 'native' || item.content.nativeType !== 'text') return null
  const data = item.content.data
  const styled = patch.nativeTextStyle
    ? mergeCourseNativeData(data, { style: patch.nativeTextStyle })
    : data
  const merged = patch.nativeData
    ? mergeCourseNativeData(styled, patch.nativeData)
    : styled
  const nextData = merged as typeof data
  const node: TextNode = {
    id: item.layerItemId, name: item.label, type: 'text',
    x: item.frame.x, y: item.frame.y, width: item.frame.width, height: item.frame.height,
    rotation: item.rotation, opacity: item.opacity, visible: item.visible, locked: item.locked,
    playbackInitialVisibility: item.playbackInitialVisibility,
    ...data,
  }
  return prepareNativeTextMeasurement(node, {
    ...(patch.nativeData?.text !== undefined ? { text: nextData.text } : {}),
    ...(patch.nativeData?.runs !== undefined ? { runs: nextData.runs } : {}),
    ...(patch.nativeTextStyle !== undefined || patch.nativeData?.style !== undefined
      ? { style: nextData.style } : {}),
    ...(patch.frame?.width !== undefined ? { width: patch.frame.width } : {}),
    ...(patch.frame?.height !== undefined ? { height: patch.frame.height } : {}),
  })
}

export function nativeLayerTextAutoSizeFrame(item: LayerItem, patch: NativeLayerTextLayoutPatch, measure?: NativeTextMeasurePort): Partial<TextSize> {
  const spec = prepareNativeLayerTextMeasurement(item, patch)
  if (!spec) return {}
  if (!measure) throw unsupportedNativeTextMeasurement()
  return nativeTextMeasuredFrame(spec, measure(spec.node, spec.width))
}
