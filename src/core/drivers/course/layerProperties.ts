import type { CourseProjectDocument, LayerFrame, LayerItem, ScopedLayerItem } from '../../../shared/courseProjectTypes'
import type { TextNode } from '../../../shared/contracts/native-v1'
import type { NativeLineGeometry } from '../../../shared/contracts/native-v1/types'
import { mergeCourseNativeData } from '../../../shared/courseProjectSchema'
import { convertLineGeometryForShapeType } from '../../../shared/nativeLineGeometry'
import { isTeacherController as isTeacherControllerLayerItem } from '../../../shared/teacherControllerRole'

export type LayerOwnerSource = 'global' | 'surface' | 'scene' | 'world'
const LAYER_REJECT_LOCKED = 'locked'
export type NativeTextFramePort = (item: LayerItem, patch: EffectiveLayerPropertyPatch) => Partial<Pick<LayerFrame, 'width' | 'height'>>

export interface LocatedCourseLayer {
  readonly item: LayerItem
  readonly source: LayerOwnerSource
  readonly surfaceId: string | null
  readonly sceneId: string | null
  readonly scoped?: ScopedLayerItem
}

export interface EffectiveLayerPropertyPatch {
  readonly label?: string
  readonly frame?: Partial<Pick<LayerFrame, 'x' | 'y' | 'width' | 'height'>>
  readonly rotation?: number
  readonly opacity?: number
  readonly visible?: boolean
  readonly locked?: boolean
  readonly playbackInitialVisibility?: LayerItem['playbackInitialVisibility']
  /** Whole-node text style only. Rich-text runs keep their dedicated edit command. */
  readonly nativeTextStyle?: Partial<TextNode['style']>
  /** Sparse surface-owned Native content; the Course V9 schema validates the merge. */
  readonly nativeData?: Record<string, unknown>
}

export function locateCourseLayer(
  project: CourseProjectDocument,
  layerItemId: string,
): LocatedCourseLayer | null {
  const global = project.globalLayerItems.find(
    (entry) => entry.item.layerItemId === layerItemId,
  )
  if (global) {
    return {
      item: global.item,
      source: 'global',
      surfaceId: null,
      sceneId: null,
      scoped: global,
    }
  }
  for (const surface of project.surfaces) {
    const shared = surface.surfaceLayerItems.find(
      (entry) => entry.item.layerItemId === layerItemId,
    )
    if (shared) {
      return {
        item: shared.item,
        source: 'surface',
        surfaceId: surface.id,
        sceneId: null,
        scoped: shared,
      }
    }
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
        if (item) {
          return {
            item,
            source: 'scene',
            surfaceId: surface.id,
            sceneId: scene.id,
          }
        }
      }
    }
    if (surface.type === 'spatial-2d') {
      const item = surface.world.layerItems.find(
        (candidate) => candidate.layerItemId === layerItemId,
      )
      if (item) {
        return {
          item,
          source: 'world',
          surfaceId: surface.id,
          sceneId: null,
        }
      }
    }
  }
  return null
}

export function writeBasePropertyPatch(
  item: LayerItem,
  patch: EffectiveLayerPropertyPatch,
): void {
  if (patch.label !== undefined) item.label = patch.label
  if (patch.frame) Object.assign(item.frame, patch.frame)
  if (patch.rotation !== undefined) item.rotation = patch.rotation
  if (patch.opacity !== undefined) item.opacity = patch.opacity
  if (patch.visible !== undefined) item.visible = patch.visible
  if (patch.locked !== undefined) item.locked = patch.locked
  if (patch.playbackInitialVisibility !== undefined) {
    item.playbackInitialVisibility = patch.playbackInitialVisibility
  }
  if (patch.nativeTextStyle !== undefined) {
    if (item.kind !== 'native' || item.content.nativeType !== 'text') {
      throw new Error('当前元素不支持文字整节点样式')
    }
    Object.assign(item.content.data.style, patch.nativeTextStyle)
  }
  if (patch.nativeData !== undefined) {
    if (item.kind !== 'native' || isTeacherControllerLayerItem(item)) {
      throw new Error('当前元素不支持原生内容属性')
    }
    item.content.data = mergeCourseNativeData(
      item.content.data as Record<string, unknown>,
      patch.nativeData,
    ) as typeof item.content.data
  }
}

const EFFECTIVE_LAYER_PROPERTY_KEYS = new Set<keyof EffectiveLayerPropertyPatch>([
  'label',
  'frame',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'playbackInitialVisibility',
  'nativeTextStyle',
  'nativeData',
])

function validateFiniteProperty(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有效数字`)
}

export function normalizeEffectiveLayerPropertyPatch(
  item: LayerItem,
  source: LayerOwnerSource,
  patch: EffectiveLayerPropertyPatch,
  options: { readonly allowOwnedNativeData?: boolean; readonly measureTextFrame?: NativeTextFramePort } = {},
): { readonly patch: EffectiveLayerPropertyPatch; readonly changed: boolean } {
  const unknownKey = Object.keys(patch).find(
    (key) => !EFFECTIVE_LAYER_PROPERTY_KEYS.has(key as keyof EffectiveLayerPropertyPatch),
  )
  if (unknownKey) throw new Error(`当前元素不支持属性“${unknownKey}”`)
  const definedKeys = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
  if (
    item.locked &&
    !(patch.locked === false && definedKeys.length === 1 && definedKeys[0] === 'locked')
  ) {
    throw new Error(LAYER_REJECT_LOCKED)
  }

  if (patch.label !== undefined && typeof patch.label !== 'string') {
    throw new Error('名称必须是文字')
  }
  if (patch.frame !== undefined && (
    patch.frame === null || typeof patch.frame !== 'object' || Array.isArray(patch.frame)
  )) {
    throw new Error('画面范围无效')
  }
  if (patch.visible !== undefined && typeof patch.visible !== 'boolean') {
    throw new Error('显示状态无效')
  }
  if (patch.locked !== undefined && typeof patch.locked !== 'boolean') {
    throw new Error('锁定状态无效')
  }

  const label = patch.label?.trim()
  if (patch.label !== undefined && !label) throw new Error('名称不能为空')

  const frame = patch.frame
    ? Object.fromEntries(
        Object.entries(patch.frame).filter(([, value]) => value !== undefined),
      ) as EffectiveLayerPropertyPatch['frame']
    : undefined
  if (frame) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const value = frame[key]
      if (value === undefined) continue
      validateFiniteProperty(value, key === 'width' ? '宽度' : key === 'height' ? '高度' : key.toUpperCase())
      if ((key === 'width' || key === 'height') && value <= 0) {
        throw new Error(`${key === 'width' ? '宽度' : '高度'}必须大于 0`)
      }
    }
  }
  if (patch.rotation !== undefined) {
    validateFiniteProperty(patch.rotation, '旋转角度')
    if (patch.rotation < -36_000 || patch.rotation > 36_000) {
      throw new Error('旋转角度超出允许范围')
    }
  }
  if (patch.opacity !== undefined) {
    validateFiniteProperty(patch.opacity, '不透明度')
    if (patch.opacity < 0 || patch.opacity > 1) throw new Error('不透明度必须介于 0 和 1 之间')
  }
  if (
    patch.playbackInitialVisibility !== undefined &&
    patch.playbackInitialVisibility !== 'inherit' &&
    patch.playbackInitialVisibility !== 'hidden'
  ) {
    throw new Error('播放初始状态无效')
  }

  let nativeTextStyle: EffectiveLayerPropertyPatch['nativeTextStyle']
  if (patch.nativeTextStyle !== undefined) {
    if (item.kind !== 'native' || item.content.nativeType !== 'text') {
      throw new Error('当前元素不支持文字整节点样式')
    }
    if (
      patch.nativeTextStyle === null ||
      typeof patch.nativeTextStyle !== 'object' ||
      Array.isArray(patch.nativeTextStyle)
    ) {
      throw new Error('文字整节点样式无效')
    }
    nativeTextStyle = Object.fromEntries(
      Object.entries(patch.nativeTextStyle).filter(([, value]) => value !== undefined),
    ) as EffectiveLayerPropertyPatch['nativeTextStyle']
  }

  let nativeData: EffectiveLayerPropertyPatch['nativeData']
  let currentNativeData: Record<string, unknown> | null = null
  let mergedNativeData: Record<string, unknown> | null = null
  if (patch.nativeData !== undefined) {
    if (
      (source !== 'surface' && !options.allowOwnedNativeData)
      || item.kind !== 'native'
      || isTeacherControllerLayerItem(item)
    ) {
      throw new Error('当前元素不支持原生内容属性')
    }
    if (
      patch.nativeData === null ||
      typeof patch.nativeData !== 'object' ||
      Array.isArray(patch.nativeData)
    ) {
      throw new Error('原生内容属性无效')
    }
    nativeData = Object.fromEntries(
      Object.entries(patch.nativeData).filter(([, value]) => value !== undefined),
    )
    currentNativeData = item.content.data as Record<string, unknown>
    mergedNativeData = mergeCourseNativeData(
      currentNativeData,
      nativeData,
    )
    if (item.content.nativeType === 'shape') {
      if (nativeData.shapeType !== undefined && !['brace-left', 'brace-right'].includes(String(nativeData.shapeType)) && mergedNativeData.braceGeometry !== undefined) {
        nativeData = { ...nativeData, braceGeometry: null }
        mergedNativeData = mergeCourseNativeData(currentNativeData, nativeData)
      }
      if (nativeData.shapeType !== undefined && nativeData.pathGeometry === undefined && mergedNativeData.pathGeometry !== undefined) {
        nativeData = { ...nativeData, pathGeometry: null }
        mergedNativeData = mergeCourseNativeData(currentNativeData, nativeData)
      }
      // shapeType/lineGeometry invariant: switching away from line/elbow-arrow
      // deletes the geometry; a kind that disagrees with the target shapeType
      // is converted instead of failing strict schema validation downstream.
      const mergedShapeType = mergedNativeData.shapeType
      const mergedGeometry = mergedNativeData.lineGeometry as NativeLineGeometry | undefined
      if (
        mergedShapeType !== 'line' &&
        mergedShapeType !== 'elbow-arrow' &&
        mergedGeometry !== undefined
      ) {
        nativeData = { ...nativeData, lineGeometry: null }
        mergedNativeData = mergeCourseNativeData(currentNativeData, nativeData)
      } else if (
        (mergedShapeType === 'line' || mergedShapeType === 'elbow-arrow') &&
        mergedGeometry !== undefined
      ) {
        const converted = convertLineGeometryForShapeType(mergedGeometry, mergedShapeType)
        if (JSON.stringify(converted) !== JSON.stringify(mergedGeometry)) {
          nativeData = { ...nativeData, lineGeometry: converted }
          mergedNativeData = mergeCourseNativeData(currentNativeData, nativeData)
        }
      }
    }
  }

  const textFrame = options.measureTextFrame?.(item, { frame, nativeTextStyle, nativeData }) ?? {}
  const sizedFrame = Object.keys(textFrame).length > 0 ? { ...frame, ...textFrame } : frame
  const normalizedFrame = sizedFrame

  const normalized: EffectiveLayerPropertyPatch = {
    ...(patch.label !== undefined ? { label: label!.slice(0, 200) } : {}),
    ...(normalizedFrame && Object.keys(normalizedFrame).length > 0 ? { frame: normalizedFrame } : {}),
    ...(patch.rotation !== undefined ? { rotation: patch.rotation } : {}),
    ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
    ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
    ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
    ...(patch.playbackInitialVisibility !== undefined
      ? { playbackInitialVisibility: patch.playbackInitialVisibility }
      : {}),
    ...(nativeTextStyle && Object.keys(nativeTextStyle).length > 0 ? { nativeTextStyle } : {}),
    ...(nativeData && Object.keys(nativeData).length > 0 ? { nativeData } : {}),
  }
  const currentTextStyle = item.kind === 'native' && item.content.nativeType === 'text'
    ? item.content.data.style
    : null
  const changed =
    (normalized.label !== undefined && normalized.label !== item.label) ||
    (normalized.frame !== undefined && Object.entries(normalized.frame).some(
      ([key, value]) => item.frame[key as keyof typeof normalized.frame] !== value,
    )) ||
    (normalized.rotation !== undefined && normalized.rotation !== item.rotation) ||
    (normalized.opacity !== undefined && normalized.opacity !== item.opacity) ||
    (normalized.visible !== undefined && normalized.visible !== item.visible) ||
    (normalized.locked !== undefined && normalized.locked !== item.locked) ||
    (normalized.playbackInitialVisibility !== undefined &&
      normalized.playbackInitialVisibility !== item.playbackInitialVisibility) ||
    (normalized.nativeTextStyle !== undefined &&
      currentTextStyle !== null &&
      Object.entries(normalized.nativeTextStyle).some(
        ([key, value]) => currentTextStyle[key as keyof TextNode['style']] !== value,
      )) ||
    (normalized.nativeData !== undefined &&
      currentNativeData !== null &&
      mergedNativeData !== null &&
      JSON.stringify(mergedNativeData) !== JSON.stringify(currentNativeData))
  return { patch: normalized, changed }
}

