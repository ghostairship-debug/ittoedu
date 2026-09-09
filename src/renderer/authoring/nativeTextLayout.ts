import type { TextNode } from '../../shared/contracts/native-v1'
import type { LayerFrame, LayerItem } from '../../shared/courseProjectTypes'
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import { analyzeTextNodeLayout, isVerticalWritingMode } from '../../shared/textLayout'

type TextSize = Pick<TextNode, 'width' | 'height'>
export type NativeTextLayoutPatch = Partial<Pick<TextNode, 'text' | 'runs' | 'width' | 'height'>> & {
  readonly style?: Partial<TextNode['style']>
}

/** Derive only the automatic axis; an explicit size in this edit remains authoritative. */
export function nativeTextAutoSizeFrame(
  node: TextNode,
  patch: NativeTextLayoutPatch,
): Partial<TextSize> {
  if (!['text', 'runs', 'style', 'width', 'height'].some(
    key => patch[key as keyof NativeTextLayoutPatch] !== undefined,
  )) return {}
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  const next = { ...node, ...defined, style: { ...node.style, ...patch.style } } as TextNode
  if (next.style.overflow !== 'auto-height') return {}
  const vertical = isVerticalWritingMode(next.style.writingMode)
  const axis = vertical ? 'width' : 'height'
  if (patch[axis] !== undefined) return {}
  const layout = analyzeTextNodeLayout(next, next.width)
  return { [axis]: Math.max(16, vertical ? layout.requiredWidth : layout.requiredHeight) }
}

/** The effective item already includes the current named-state overrides. */
export function nativeLayerTextAutoSizeFrame(
  item: LayerItem,
  patch: {
    readonly frame?: Partial<Pick<LayerFrame, 'x' | 'y' | 'width' | 'height'>>
    readonly nativeTextStyle?: Partial<TextNode['style']>
    readonly nativeData?: Record<string, unknown>
  },
): Partial<TextSize> {
  if (item.kind !== 'native' || item.content.nativeType !== 'text') return {}
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
  return nativeTextAutoSizeFrame(node, {
    ...(patch.nativeData?.text !== undefined ? { text: nextData.text } : {}),
    ...(patch.nativeData?.runs !== undefined ? { runs: nextData.runs } : {}),
    ...(patch.nativeTextStyle !== undefined || patch.nativeData?.style !== undefined
      ? { style: nextData.style } : {}),
    ...(patch.frame?.width !== undefined ? { width: patch.frame.width } : {}),
    ...(patch.frame?.height !== undefined ? { height: patch.frame.height } : {}),
  })
}
