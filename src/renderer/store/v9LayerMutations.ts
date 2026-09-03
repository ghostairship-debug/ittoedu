import type { ComponentPackageData } from '../../shared/componentTypes'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MIN_NODE_SIZE,
  MIN_VISIBLE_NODE_EDGE,
} from '../../shared/constants'
import { constrainTeacherControllerAuthoringFrame } from '../../shared/teacherControllerLayout'
import { isCourseTeacherControllerLayerItem } from '../../shared/teacherControllerConsistency'
import type {
  CourseProjectDocument,
  LayerItem,
  LayerItemOverride,
  LocationVisibility,
  NativeLayerItem,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'
import type { GlobalLayerVisibility } from '../../shared/projectTypes'
import { commandTargetFromRow } from '../course/effectiveLayerProjection'
import type { EffectiveLayerProjectionRow } from '../course/effectiveLayerProjection'
import type { EffectiveLayerPropertyPatch } from '../course/effectiveLayerCommands'
import type { LayerCommandResult } from '../course/effectiveLayerCommands'
import { commitSlideAuthoringHistory } from '../course/slideEditorCommands'
import type { SlideAuthoringSession, SlideCommandResult } from '../course/slideAuthoringBackend'
import type {
  EditorCanvasNode,
  EditorCanvasNodePatch,
} from '../phaser/editorCanvasNode'

export function findCourseSlideScene(
  project: CourseProjectDocument,
  sceneId: string,
): SlideSceneDocument | null {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    const scene = surface.scenes.find((item) => item.id === sceneId)
    if (scene) return scene
  }
  return null
}

export function findMutableCourseLayerItem(
  draft: CourseProjectDocument,
  layerItemId: string,
): LayerItem | null {
  const global = draft.globalLayerItems.find((entry) => entry.item.layerItemId === layerItemId)
  if (global) return global.item
  for (const surface of draft.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
      if (item) return item
    }
    const shared = surface.surfaceLayerItems.find((entry) => entry.item.layerItemId === layerItemId)
    if (shared) return shared.item
  }
  return null
}

interface EditorCanvasGeometry {
  x: number
  y: number
  width: number
  height: number
  type?: string
  component?: { packageId: string; version?: string }
  preserveAspectRatio?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
}

function mergeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return structuredClone(base)
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return structuredClone(override)
  }
  const result: Record<string, unknown> = structuredClone(base)
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    Object.defineProperty(result, key, {
      value: mergeValue(base[key], value),
      configurable: true,
      enumerable: true,
      writable: true,
    })
  }
  return result
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => valuesEqual(left[key], right[key]))
}

function diffValue(base: unknown, effective: unknown): unknown {
  if (valuesEqual(base, effective)) return undefined
  if (!isPlainObject(base) || !isPlainObject(effective)) {
    return structuredClone(effective)
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(effective)) {
    const difference = diffValue(base[key], effective[key])
    if (difference !== undefined) {
      Object.defineProperty(result, key, {
        value: difference,
        configurable: true,
        enumerable: true,
        writable: true,
      })
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function nativeContentRecord(item: LayerItem): Record<string, unknown> | null {
  if (item.kind !== 'native') return null
  return item.content.data as Record<string, unknown>
}

function canvasTypeOfLayerItem(item: LayerItem): string {
  if (item.kind === 'component') return 'external-component'
  if (item.kind === 'native') return item.content.nativeType
  return 'runtime'
}

function layerItemGeometry(item: LayerItem): EditorCanvasGeometry {
  const data = nativeContentRecord(item)
  return {
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    type: canvasTypeOfLayerItem(item),
    ...(item.kind === 'component' ? { component: item.component } : {}),
    ...(item.kind === 'native' && item.content.nativeType === 'image'
      ? { preserveAspectRatio: Boolean(data?.preserveAspectRatio) }
      : {}),
  }
}

function writeLayerItemGeometry(item: LayerItem, geometry: EditorCanvasGeometry): void {
  item.frame = {
    ...item.frame,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  }
}

function patchNativeContentData(
  data: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...data }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (
      (key === 'style' || key === 'crop' || key === 'feather' || key === 'poster') &&
      isRecord(data[key]) &&
      isRecord(value)
    ) {
      next[key] = { ...data[key], ...value }
      continue
    }
    if (key === 'buttons' && Array.isArray(data.buttons) && Array.isArray(value)) {
      const currentButtons = data.buttons
      next.buttons = value.map((button, index) => {
        const current = currentButtons[index]
        return {
          ...(isRecord(current) ? current : {}),
          ...(isRecord(button) ? button : {}),
        }
      })
      continue
    }
    next[key] = value
  }
  return next
}

function applyCanvasPatchFields(item: LayerItem, patch: EditorCanvasNodePatch): void {
  const source: Record<string, unknown> = { ...patch }
  delete source.id
  delete source.type

  if (typeof source.name === 'string') item.label = source.name
  delete source.name

  const frame = { ...item.frame }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof source[key] === 'number') frame[key] = source[key]
    delete source[key]
  }
  item.frame = frame

  if (typeof source.visible === 'boolean') item.visible = source.visible
  if (typeof source.locked === 'boolean') item.locked = source.locked
  if (typeof source.rotation === 'number') item.rotation = source.rotation
  if (typeof source.opacity === 'number') item.opacity = source.opacity
  if (source.playbackInitialVisibility === 'inherit' || source.playbackInitialVisibility === 'hidden') {
    item.playbackInitialVisibility = source.playbackInitialVisibility
  }
  delete source.visible
  delete source.locked
  delete source.rotation
  delete source.opacity
  delete source.playbackInitialVisibility

  if (item.kind === 'component') {
    if (isRecord(source.component)) {
      const nextPackageId = source.component.packageId
      const nextVersion = source.component.version
      item.component = {
        packageId: typeof nextPackageId === 'string' ? nextPackageId : item.component.packageId,
        version: typeof nextVersion === 'string' ? nextVersion : item.component.version,
      }
    }
    delete source.component
    if (isRecord(source.props)) {
      item.props = mergeValue(item.props, source.props) as Record<string, unknown>
    }
    delete source.props
    return
  }

  if (item.kind !== 'native' || Object.keys(source).length === 0) return
  const current = item.content.data as Record<string, unknown>
  item.content = {
    nativeType: item.content.nativeType,
    data: patchNativeContentData(current, source),
  } as NativeLayerItem['content']
}

function applyLayerItemOverride(base: LayerItem, override?: LayerItemOverride): LayerItem {
  if (!override) return structuredClone(base)
  const next = structuredClone(base)
  if (override.label !== undefined) next.label = override.label
  if (override.visible !== undefined) next.visible = override.visible
  if (override.locked !== undefined) next.locked = override.locked
  if (override.rotation !== undefined) next.rotation = override.rotation
  if (override.opacity !== undefined) next.opacity = override.opacity
  if (override.playbackInitialVisibility !== undefined) {
    next.playbackInitialVisibility = override.playbackInitialVisibility
  }
  if (override.frame) next.frame = { ...next.frame, ...override.frame }
  if (next.kind === 'native' && override.nativeData) {
    const merged = mergeValue(next.content.data, override.nativeData)
    const data = (
      next.content.nativeType === 'formula' && Object.hasOwn(override.nativeData, 'ast')
        ? { ...(isRecord(merged) ? merged : {}), ast: structuredClone(override.nativeData.ast) }
        : merged
    )
    next.content = {
      nativeType: next.content.nativeType,
      data,
    } as NativeLayerItem['content']
  }
  if (next.kind === 'component' && override.componentProps) {
    next.props = mergeValue(next.props, override.componentProps) as Record<string, unknown>
  }
  return next
}

function deriveLayerItemOverride(
  base: LayerItem,
  effective: LayerItem,
): LayerItemOverride | undefined {
  const override: LayerItemOverride = {}
  if (effective.label !== base.label) override.label = effective.label
  const frame: NonNullable<LayerItemOverride['frame']> = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (effective.frame[key] !== base.frame[key]) frame[key] = effective.frame[key]
  }
  if (Object.keys(frame).length > 0) override.frame = frame
  if (effective.visible !== base.visible) override.visible = effective.visible
  if (effective.locked !== base.locked) override.locked = effective.locked
  if (effective.rotation !== base.rotation) override.rotation = effective.rotation
  if (effective.opacity !== base.opacity) override.opacity = effective.opacity
  if (effective.playbackInitialVisibility !== base.playbackInitialVisibility) {
    override.playbackInitialVisibility = effective.playbackInitialVisibility
  }
  if (base.kind === 'native' && effective.kind === 'native') {
    const nativeData = diffValue(base.content.data, effective.content.data)
    if (isRecord(nativeData) && Object.keys(nativeData).length > 0) {
      override.nativeData = nativeData
    }
  }
  if (base.kind === 'component' && effective.kind === 'component') {
    const componentProps = diffValue(base.props, effective.props)
    if (isRecord(componentProps) && Object.keys(componentProps).length > 0) {
      override.componentProps = componentProps
    }
  }
  return Object.keys(override).length > 0 ? override : undefined
}

function hasPatchKey(
  patch: EditorCanvasNodePatch,
  key: 'width' | 'height',
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key)
}

export function normalizeNodeGeometry<T extends EditorCanvasGeometry>(
  previous: T,
  next: T,
  patch: EditorCanvasNodePatch,
  components: Readonly<Record<string, ComponentPackageData>>,
): T {
  const changedWidth = hasPatchKey(patch, 'width')
  const changedHeight = hasPatchKey(patch, 'height')
  let minimumWidth = MIN_NODE_SIZE
  let minimumHeight = MIN_NODE_SIZE
  let preserveAspectRatio = false

  if (previous.type === 'image') {
    preserveAspectRatio = Boolean(previous.preserveAspectRatio)
  } else if (previous.type === 'video') {
    preserveAspectRatio = true
  } else if (previous.type === 'external-component') {
    const manifest = previous.component
      ? components[previous.component.packageId]?.manifest
      : undefined
    preserveAspectRatio = manifest?.preserveAspectRatio ?? true
    minimumWidth = manifest?.minSize.width ?? MIN_NODE_SIZE
    minimumHeight = manifest?.minSize.height ?? MIN_NODE_SIZE
  }

  let width = Math.max(minimumWidth, next.width)
  let height = Math.max(minimumHeight, next.height)
  if (preserveAspectRatio && changedWidth !== changedHeight) {
    const ratio = previous.width / previous.height
    if (changedWidth) {
      height = width / ratio
      if (height < minimumHeight) {
        height = minimumHeight
        width = height * ratio
      }
    } else {
      width = height * ratio
      if (width < minimumWidth) {
        width = minimumWidth
        height = width / ratio
      }
    }
  }

  const x = Math.min(
    CANVAS_WIDTH - MIN_VISIBLE_NODE_EDGE,
    Math.max(-width + MIN_VISIBLE_NODE_EDGE, next.x),
  )
  const y = Math.min(
    CANVAS_HEIGHT - MIN_VISIBLE_NODE_EDGE,
    Math.max(-height + MIN_VISIBLE_NODE_EDGE, next.y),
  )
  return { ...next, x, y, width, height }
}

export function normalizeNewNodeGeometry<T extends EditorCanvasGeometry>(
  node: T,
  components: Readonly<Record<string, ComponentPackageData>>,
): T {
  return normalizeNodeGeometry(node, node, {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }, components)
}

export function applySceneNodePatchToLayerItem(
  item: LayerItem,
  patch: EditorCanvasNodePatch,
  componentPackages: Record<string, ComponentPackageData>,
): void {
  if (item.kind === 'runtime') return
  const previous = layerItemGeometry(item)
  applyCanvasPatchFields(item, patch)
  writeLayerItemGeometry(
    item,
    normalizeNodeGeometry(previous, layerItemGeometry(item), patch, componentPackages),
  )
}

export function applySceneNodePatchToCourseOverride(
  draft: CourseProjectDocument,
  sceneId: string,
  stateId: string,
  nodeId: string,
  patch: EditorCanvasNodePatch,
  componentPackages: Record<string, ComponentPackageData>,
): void {
  const scene = findCourseSlideScene(draft, sceneId)
  if (!scene) return
  const baseItem = scene.layerItems.find((item) => item.layerItemId === nodeId)
  if (!baseItem || (baseItem.locked && patch.locked !== false)) return
  if (baseItem.kind === 'runtime') return
  const presentation = scene.presentation
  const state = presentation?.states.find((candidate) => candidate.id === stateId)
  if (!state) return
  const current = applyLayerItemOverride(baseItem, state.layerItemOverrides[nodeId])
  applySceneNodePatchToLayerItem(current, patch, componentPackages)
  const nextOverride = deriveLayerItemOverride(baseItem, current)
  if (!nextOverride) {
    delete state.layerItemOverrides[nodeId]
    return
  }
  state.layerItemOverrides[nodeId] = nextOverride
}

const V9_SPECIALIZED_NODE_PATCH_KEYS = new Set([
  'locked',
  'visible',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'text',
  'style',
  'name',
])

export function v9NodePatchNeedsRoundTrip(patch: EditorCanvasNodePatch): boolean {
  return Object.keys(patch).some((key) => !V9_SPECIALIZED_NODE_PATCH_KEYS.has(key))
}

function v9NodePatchTouchesFrame(patch: EditorCanvasNodePatch): boolean {
  return patch.x !== undefined ||
    patch.y !== undefined ||
    patch.width !== undefined ||
    patch.height !== undefined ||
    patch.rotation !== undefined
}

export function constrainRoundTripTeacherControllerFrame(
  item: LayerItem,
  patch: EditorCanvasNodePatch,
): void {
  if (!v9NodePatchTouchesFrame(patch) || !isCourseTeacherControllerLayerItem(item)) return
  const frame = constrainTeacherControllerAuthoringFrame(
    item.content.data,
    item.frame,
    item.rotation,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  )
  item.frame = { ...item.frame, ...frame }
}

export function commandTargetForRow(row: EffectiveLayerProjectionRow) {
  const input = commandTargetFromRow(row)
  return {
    authoringAddress: input.authoringAddress,
    locationId: input.locationId,
    stateId: input.stateId,
  }
}

export function existingLayerItemIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  project.globalLayerItems.forEach((entry) => ids.add(entry.item.layerItemId))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => ids.add(entry.item.layerItemId))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        scene.layerItems.forEach((item) => ids.add(item.layerItemId))
      })
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => ids.add(item.layerItemId))
    }
  }
  return ids
}

export function sessionFromLayerResult(
  session: SlideAuthoringSession,
  result: LayerCommandResult,
): SlideCommandResult {
  if (!result.ok || !result.nextDocument) {
    return {
      ok: false,
      reason: result.reason,
      historyEntry: false,
      nextSession: session,
      selection: session.selection,
    }
  }
  const nextHistory = result.historyEntry
    ? commitSlideAuthoringHistory(session.history, result.nextDocument)
    : {
        present: result.nextDocument,
        past: session.history.past,
        future: session.history.future,
      }
  const createdId = result.createdLayerItemId
  const remainingIds = existingLayerItemIds(result.nextDocument)
  const selectionIds = createdId
    ? [createdId]
    : session.selection.selectionIds.filter((id) => remainingIds.has(id))
  return {
    ok: true,
    reason: result.reason,
    historyEntry: Boolean(result.historyEntry),
    nextSession: {
      sessionId: session.sessionId,
      history: nextHistory,
      selection: {
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
        selectionIds,
      },
      scope: session.scope,
      generation: session.generation,
    },
    selection: {
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds,
    },
  }
}

const SPATIAL_LAYER_PROPERTY_KEYS = new Set([
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'playbackInitialVisibility',
  'style',
])

const SPATIAL_DIRECT_ROW_PROPERTY_KEYS = new Set(['name', 'visible', 'locked'])
const SPATIAL_UNSUPPORTED_PROPERTY_REASON = '当前元素不支持这项 Spatial 属性'
const SPATIAL_INVALID_PROPERTY_VALUE_REASON = 'Spatial 属性值无效'

export function isSpatialDirectRowPropertyPatch(patch: EditorCanvasNodePatch): boolean {
  const record = patch as Record<string, unknown>
  const keys = Object.keys(record).filter((key) => record[key] !== undefined)
  return keys.length > 0 && keys.every((key) => SPATIAL_DIRECT_ROW_PROPERTY_KEYS.has(key))
}

export function spatialLayerPropertyPatch(
  node: EditorCanvasNode | null,
  patch: EditorCanvasNodePatch,
): { readonly ok: true; readonly patch: EffectiveLayerPropertyPatch } |
  { readonly ok: false; readonly reason: string } {
  const record = patch as Record<string, unknown>
  const unsupported = Object.keys(record).find((key) => !SPATIAL_LAYER_PROPERTY_KEYS.has(key))
  if (unsupported) {
    return { ok: false, reason: `${SPATIAL_UNSUPPORTED_PROPERTY_REASON}：${unsupported}` }
  }
  if (record.style !== undefined && node?.type !== 'text') {
    return { ok: false, reason: `${SPATIAL_UNSUPPORTED_PROPERTY_REASON}：仅文字支持整节点样式` }
  }
  if (
    record.style !== undefined &&
    (record.style === null || typeof record.style !== 'object' || Array.isArray(record.style))
  ) {
    return { ok: false, reason: SPATIAL_INVALID_PROPERTY_VALUE_REASON }
  }
  const frame: NonNullable<EffectiveLayerPropertyPatch['frame']> = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (record[key] !== undefined) frame[key] = record[key] as number
  }
  return {
    ok: true,
    patch: {
      ...(record.name !== undefined ? { label: record.name as string } : {}),
      ...(Object.keys(frame).length > 0 ? { frame } : {}),
      ...(record.rotation !== undefined ? { rotation: record.rotation as number } : {}),
      ...(record.opacity !== undefined ? { opacity: record.opacity as number } : {}),
      ...(record.visible !== undefined ? { visible: record.visible as boolean } : {}),
      ...(record.locked !== undefined ? { locked: record.locked as boolean } : {}),
      ...(record.playbackInitialVisibility !== undefined
        ? {
            playbackInitialVisibility: record.playbackInitialVisibility as
              EffectiveLayerPropertyPatch['playbackInitialVisibility'],
          }
        : {}),
      ...(record.style !== undefined
        ? { nativeTextStyle: record.style as EffectiveLayerPropertyPatch['nativeTextStyle'] }
        : {}),
    },
  }
}

const SLIDE_SURFACE_BASE_PROPERTY_KEYS = new Set([
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'playbackInitialVisibility',
])

export function slideSurfaceLayerPropertyPatch(
  item: LayerItem,
  node: EditorCanvasNode | null,
  patch: EditorCanvasNodePatch,
): { readonly ok: true; readonly patch: EffectiveLayerPropertyPatch } |
  { readonly ok: false; readonly reason: string } {
  if (!node) return { ok: false, reason: '当前表面图层已失效，请重新选择。' }
  const record = patch as Record<string, unknown>
  const basePatch: Record<string, unknown> = {}
  const nativeData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    if (SLIDE_SURFACE_BASE_PROPERTY_KEYS.has(key)) {
      basePatch[key] = value
      continue
    }
    if (key === 'id' || key === 'type' || key === 'component') {
      return { ok: false, reason: `当前表面图层不支持属性“${key}”。` }
    }
    if (
      item.kind !== 'native' ||
      item.content.nativeType === 'teacher-controller'
    ) {
      return { ok: false, reason: `当前表面图层不支持原生内容属性“${key}”。` }
    }
    nativeData[key] = value
  }
  const common = spatialLayerPropertyPatch(node, basePatch)
  if (!common.ok) return common
  return {
    ok: true,
    patch: {
      ...common.patch,
      ...(Object.keys(nativeData).length > 0 ? { nativeData } : {}),
    },
  }
}

export function locationIdsToSceneIds(
  document: CourseProjectDocument,
  locationIds: readonly string[],
): string[] {
  return locationIds.flatMap((locationId) => {
    const location = document.locations.find((candidate) => candidate.id === locationId)
    return location?.kind === 'slide-scene' ? [location.sceneId] : []
  })
}

export function sceneIdsToLocationIds(
  document: CourseProjectDocument,
  sceneIds: readonly string[],
): string[] {
  const wanted = new Set(sceneIds)
  return document.locations.flatMap((location) => (
    location.kind === 'slide-scene'
      && location.stateId === undefined
      && wanted.has(location.sceneId)
      ? [location.id]
      : []
  ))
}

export function locationVisibilityFromScenePatch(
  document: CourseProjectDocument,
  visibility: GlobalLayerVisibility,
): LocationVisibility {
  const remaining = document.locations.filter(
    (location) => location.kind === 'slide-scene' && location.stateId === undefined,
  )
  if (visibility.mode === 'all') return { mode: 'all', locationIds: [] }
  const locationIds = sceneIdsToLocationIds(document, visibility.sceneIds)
  if (locationIds.length > 0) return { mode: visibility.mode, locationIds }
  if (visibility.mode === 'exclude') return { mode: 'all', locationIds: [] }
  const fallback = remaining[0]?.id
  if (!fallback) return { mode: 'all', locationIds: [] }
  return { mode: visibility.mode, locationIds: [fallback] }
}

export function projectGlobalVisibilityToSlides(
  document: CourseProjectDocument,
  visibility: LocationVisibility,
): GlobalLayerVisibility | null {
  if (visibility.mode === 'all') return { mode: 'all', sceneIds: [] }
  const sceneIds = locationIdsToSceneIds(document, visibility.locationIds)
  if (sceneIds.length > 0) return { mode: visibility.mode, sceneIds }
  return visibility.mode === 'exclude'
    ? { mode: 'all', sceneIds: [] }
    : null
}
