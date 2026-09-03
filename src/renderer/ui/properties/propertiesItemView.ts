import type {
  NativeRenderableNode,
  TextNode,
} from '../../../shared/contracts/native-v1'
import type { LayerItem } from '../../../shared/courseProjectTypes'
import type { EffectiveLayerPropertiesPatchAtTarget } from '../../course/effectiveLayerCommands'
import { renderTextNodeCanvas } from '../../../shared/textLayout'
import type {
  PropertiesItemBase,
  PropertiesItemView,
  PropertiesPatch,
} from './SlideNativePropertiesPanel'

const NATIVE_LAYOUT_PATCH_KEYS = new Set([
  'id',
  'name',
  'type',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'playbackInitialVisibility',
  'component',
  'props',
])

export function propertiesViewFromLayerItem(item: LayerItem): PropertiesItemView {
  const base: PropertiesItemBase = {
    id: item.layerItemId,
    name: item.label,
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
    opacity: item.opacity,
    visible: item.visible,
    locked: item.locked,
    playbackInitialVisibility: item.playbackInitialVisibility,
  }
  if (item.kind === 'component') {
    return {
      ...base,
      type: 'external-component',
      component: structuredClone(item.component),
      props: structuredClone(item.props),
    }
  }
  if (item.kind === 'runtime') return { ...base, type: 'runtime' }
  return {
    ...base,
    type: item.content.nativeType,
    ...structuredClone(item.content.data),
  } as NativeRenderableNode
}

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

export function normalizePropertiesPatch(
  node: PropertiesItemView,
  patch: PropertiesPatch,
): PropertiesPatch {
  if (node.type !== 'text') return patch
  const textPatch = patch as DeepPartial<TextNode>
  const nextNode = {
    ...node,
    ...textPatch,
    style: { ...node.style, ...textPatch.style },
  } as TextNode
  const affectsTextLayout = (
    'text' in textPatch
    || 'runs' in textPatch
    || 'style' in textPatch
    || 'width' in textPatch
    || 'height' in textPatch
  )
  if (!affectsTextLayout || nextNode.style.overflow !== 'auto-height') return patch
  const rendered = renderTextNodeCanvas(nextNode, nextNode.width)
  return {
    ...patch,
    width: rendered.width,
    height: rendered.height,
  }
}

export function nativeDataFromProperties(
  item: LayerItem,
  patch: PropertiesPatch,
): Record<string, unknown> | null {
  if (item.kind !== 'native') return null
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || NATIVE_LAYOUT_PATCH_KEYS.has(key)) continue
    data[key] = value
  }
  return Object.keys(data).length > 0 ? data : null
}

export function effectivePatchFromProperties(
  item: LayerItem,
  patch: PropertiesPatch,
): EffectiveLayerPropertiesPatchAtTarget {
  const frame: NonNullable<EffectiveLayerPropertiesPatchAtTarget['frame']> = {}
  if (typeof patch.x === 'number') frame.x = patch.x
  if (typeof patch.y === 'number') frame.y = patch.y
  if (typeof patch.width === 'number') frame.width = patch.width
  if (typeof patch.height === 'number') frame.height = patch.height
  const nativeData = nativeDataFromProperties(item, patch)
  return {
    ...(typeof patch.name === 'string' ? { label: patch.name } : {}),
    ...(Object.keys(frame).length > 0 ? { frame } : {}),
    ...(typeof patch.rotation === 'number' ? { rotation: patch.rotation } : {}),
    ...(typeof patch.opacity === 'number' ? { opacity: patch.opacity } : {}),
    ...(typeof patch.visible === 'boolean' ? { visible: patch.visible } : {}),
    ...(typeof patch.locked === 'boolean' ? { locked: patch.locked } : {}),
    ...(
      patch.playbackInitialVisibility === 'inherit'
      || patch.playbackInitialVisibility === 'hidden'
        ? { playbackInitialVisibility: patch.playbackInitialVisibility }
        : {}
    ),
    ...(nativeData ? { nativeData } : {}),
    ...(item.kind === 'component' && 'props' in patch && patch.props
      ? { componentProps: patch.props as Record<string, unknown> }
      : {}),
  }
}
