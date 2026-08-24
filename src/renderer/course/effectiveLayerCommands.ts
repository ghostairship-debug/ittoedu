import { makeAuthoringAddress } from '../../shared/authoringAddress'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import {
  getEffectiveCourseLayerOrder,
  type EffectiveCourseLayerItem,
} from '../../shared/courseProjectModel'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  LayerFrame,
  LayerItem,
  LayerItemOverride,
  LocationVisibility,
  ScopedLayerItem,
  SlidePresentationState,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'
import type { TextNode } from '../../shared/projectTypes'
import { constrainTeacherControllerAuthoringFrame } from '../../shared/teacherControllerLayout'
import {
  CONTROLLER_MOVE_REASON,
  CROSS_OWNER_REORDER_REASON,
  LAYER_REJECT_LOCKED,
  LAYER_REJECT_WRONG_OWNER,
  allocateCourseLayerOrder,
  carrierForLayerItem,
  collectCourseLayerItemIds,
  deleteGlobalLayerItem,
  duplicateGlobalLayerItem,
  failLayerCommand,
  isTeacherControllerLayerItem,
  makeGlobalLayerAuthoringAddress,
  nextDuplicateLayerItemId,
  ownerBackToFrontIds,
  parseLayerAuthoringAddress,
  patchGlobalLayerItem,
  refuseLockedLayerWrite,
  rejectIfStaleDocument,
  reorderGlobalLayerItems,
  reorderOwnerOrderSlots,
  shiftCourseLayerOrdersAtOrAbove,
  sortAllCourseLayerLists,
  succeedLayerMutation,
  succeedLayerNoop,
  type EffectiveLayerCommandTarget,
  type LayerCommandOptions,
  type LayerCommandResult,
} from './globalLayerCommands'
import { commitSlideProjectMutation } from './slideEditorCommands'
import {
  spatialLayerCoordinateSpace,
  type SpatialEditorLayerScope,
} from './spatialEditorView'

export type {
  EffectiveLayerCommandTarget,
  LayerCommandOptions,
  LayerCommandResult,
} from './globalLayerCommands'

export type LayerOwnerSource = EffectiveCourseLayerItem['source']

export const SPATIAL_CROSS_COORDINATE_MOVE_REASON =
  '空间画布中的全课图层固定在视口，本页和世界图层跟随画布；当前不能跨这两种定位移动。'

function isSpatialLayerOwner(source: LayerOwnerSource): source is SpatialEditorLayerScope {
  return source === 'global' || source === 'surface' || source === 'world'
}

export function isSpatialCrossCoordinateOwnerMove(
  item: LayerItem,
  source: LayerOwnerSource,
  destination: LayerOwnerSource,
): boolean {
  if (!isSpatialLayerOwner(source) || !isSpatialLayerOwner(destination)) return false
  return spatialLayerCoordinateSpace(source, item) !==
    spatialLayerCoordinateSpace(destination, item)
}

export interface EffectiveLayerCommandItem {
  readonly id: string
  readonly name: string
  readonly source: LayerOwnerSource
  readonly authoringAddress: string
  readonly locked: boolean
  readonly hidden: boolean
  /** Named-state override is not a source string; storage remains `scene`. */
  readonly stateOverride: boolean
  readonly surfaceId: string | null
  readonly sceneId: string | null
}

export interface EffectiveLayerCommandContext {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly stateId?: string | null
}

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
}

export interface EffectiveLayerPropertyUpdate {
  readonly target: EffectiveLayerCommandTarget
  readonly patch: EffectiveLayerPropertyPatch
}

function requireLocationSurface(
  project: CourseProjectDocument,
  locationId: string,
) {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface) throw new Error(`找不到表面：${location.surfaceId}`)
  return { location, surface }
}

function activeSlideScene(
  surface: CourseSurfaceDocument,
  location: CourseProjectDocument['locations'][number],
): SlideSceneDocument | null {
  if (surface.type !== 'slide' || location.kind !== 'slide-scene') return null
  return surface.scenes.find((scene) => scene.id === location.sceneId) ?? null
}

export function makeEffectiveLayerAuthoringAddress(
  projectId: string,
  located: Pick<LocatedCourseLayer, 'source' | 'surfaceId' | 'sceneId' | 'item'>,
  field = 'item',
): string {
  const carrier = carrierForLayerItem(located.item)
  if (located.source === 'global') {
    return makeGlobalLayerAuthoringAddress(projectId, located.item.layerItemId, carrier, field)
  }
  if (located.source === 'scene') {
    return makeAuthoringAddress({
      projectId,
      scope: 'scene',
      surfaceId: located.surfaceId ?? undefined,
      sceneId: located.sceneId ?? undefined,
      carrier,
      layerItemId: located.item.layerItemId,
      field,
    })
  }
  return makeAuthoringAddress({
    projectId,
    scope: 'surface',
    surfaceId: located.surfaceId ?? undefined,
    carrier,
    layerItemId: located.item.layerItemId,
    field,
  })
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

export function resolveEffectiveLayerTarget(
  project: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
): LocatedCourseLayer {
  const parts = parseLayerAuthoringAddress(target.authoringAddress)
  if (parts.projectId !== project.id) {
    throw new Error('作者地址不属于当前工程')
  }
  requireLocationSurface(project, target.locationId)
  const located = locateCourseLayer(project, parts.layerItemId)
  if (!located) throw new Error(`找不到图层：${parts.layerItemId}`)
  const expected = makeEffectiveLayerAuthoringAddress(project.id, located, parts.field)
  if (expected !== target.authoringAddress) {
    throw new Error(LAYER_REJECT_WRONG_OWNER)
  }
  if (parts.scope === 'global' && located.source !== 'global') {
    throw new Error(LAYER_REJECT_WRONG_OWNER)
  }
  if (parts.scope === 'scene' && located.source !== 'scene') {
    throw new Error(LAYER_REJECT_WRONG_OWNER)
  }
  if (parts.scope === 'surface' && located.source !== 'surface' && located.source !== 'world') {
    throw new Error(LAYER_REJECT_WRONG_OWNER)
  }
  return located
}

function namedState(
  project: CourseProjectDocument,
  located: LocatedCourseLayer,
  stateId: string | null | undefined,
): { scene: SlideSceneDocument; state: SlidePresentationState } | null {
  if (!stateId || located.source !== 'scene' || !located.surfaceId || !located.sceneId) {
    return null
  }
  const surface = project.surfaces.find((candidate) => candidate.id === located.surfaceId)
  if (!surface || surface.type !== 'slide') return null
  const scene = surface.scenes.find((candidate) => candidate.id === located.sceneId)
  const state = scene?.presentation?.states.find((candidate) => candidate.id === stateId)
  if (!scene || !state) return null
  return { scene, state }
}

function deleteEmptyOverride(
  overrides: Record<string, LayerItemOverride>,
  layerItemId: string,
): void {
  if (Object.keys(overrides[layerItemId] ?? {}).length === 0) {
    delete overrides[layerItemId]
  }
}

function isNamedStateOwnedLayer(
  base: LayerItem,
  presentationState: SlidePresentationState,
): boolean {
  return base.visible === false &&
    presentationState.layerItemOverrides[base.layerItemId]?.visible === true
}

export function listEffectiveLayerCommandItems(
  context: EffectiveLayerCommandContext,
): readonly EffectiveLayerCommandItem[] {
  const { project, locationId } = context
  const { location, surface } = requireLocationSurface(project, locationId)
  const scene = activeSlideScene(surface, location)
  const state = context.stateId
    ? scene?.presentation?.states.find((candidate) => candidate.id === context.stateId)
    : undefined
  return getEffectiveCourseLayerOrder({
    project,
    surfaceId: surface.id,
    locationId,
  }).map((entry) => {
    const located: LocatedCourseLayer = {
      item: entry.item,
      source: entry.source,
      surfaceId: entry.source === 'global' ? null : surface.id,
      sceneId: entry.source === 'scene' ? scene?.id ?? null : null,
    }
    const override = entry.source === 'scene'
      ? state?.layerItemOverrides[entry.item.layerItemId]
      : undefined
    return {
      id: entry.item.layerItemId,
      name: override?.label ?? entry.item.label,
      source: entry.source,
      authoringAddress: makeEffectiveLayerAuthoringAddress(project.id, located),
      locked: override?.locked ?? entry.item.locked,
      hidden: override?.visible !== undefined ? !override.visible : !entry.item.visible,
      stateOverride: override !== undefined,
      surfaceId: located.surfaceId,
      sceneId: located.sceneId,
    } satisfies EffectiveLayerCommandItem
  })
}

export function listOwnedLayerItems(
  project: CourseProjectDocument,
  source: LayerOwnerSource,
  scope: { readonly surfaceId?: string | null; readonly sceneId?: string | null } = {},
): LayerItem[] {
  if (source === 'global') return project.globalLayerItems.map((entry) => entry.item)
  if (source === 'surface' && scope.surfaceId) {
    return project.surfaces.find((surface) => surface.id === scope.surfaceId)
      ?.surfaceLayerItems.map((entry) => entry.item) ?? []
  }
  if (source === 'scene' && scope.sceneId) {
    for (const surface of project.surfaces) {
      if (surface.type !== 'slide') continue
      const scene = surface.scenes.find((candidate) => candidate.id === scope.sceneId)
      if (scene) return scene.layerItems
    }
  }
  if (source === 'world' && scope.surfaceId) {
    const surface = project.surfaces.find((candidate) => candidate.id === scope.surfaceId)
    return surface?.type === 'spatial-2d' ? surface.world.layerItems : []
  }
  return []
}

function runMutation(
  document: CourseProjectDocument,
  mutate: (draft: CourseProjectDocument) => void,
  reason: string,
  options: LayerCommandOptions,
  createdLayerItemId?: string,
): LayerCommandResult {
  try {
    const next = commitSlideProjectMutation(document, mutate, options.now)
    return succeedLayerMutation(next, reason, createdLayerItemId)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '命令失败')
  }
}

function cloneDuplicatedLayerItem(item: LayerItem, nextId: string): LayerItem {
  const duplicate = structuredClone(item)
  duplicate.layerItemId = nextId
  duplicate.label = `${item.label} 副本`.slice(0, 200)
  duplicate.frame.x += 20
  duplicate.frame.y += 20
  duplicate.locked = false
  return duplicate
}

function ownerItemsFromDraft(
  draft: CourseProjectDocument,
  located: LocatedCourseLayer,
): LayerItem[] {
  return listOwnedLayerItems(draft, located.source, {
    surfaceId: located.surfaceId,
    sceneId: located.sceneId,
  })
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
])

function validateFiniteProperty(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有效数字`)
}

function normalizeEffectiveLayerPropertyPatch(
  item: LayerItem,
  source: LayerOwnerSource,
  patch: EffectiveLayerPropertyPatch,
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

  const normalizedFrame = source === 'global' &&
    isTeacherControllerLayerItem(item) &&
    ((frame !== undefined && Object.keys(frame).length > 0) || patch.rotation !== undefined)
    ? constrainTeacherControllerAuthoringFrame(
        item.content.data,
        { ...item.frame, ...frame },
        patch.rotation ?? item.rotation,
        { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      )
    : frame

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
      ))
  return { patch: normalized, changed }
}

/**
 * Applies one Properties gesture across one or more effective-layer owners.
 * Every address and supported top-level value is planned before the single
 * cloned document mutation; the Course V9 schema remains final validation.
 */
export function patchEffectiveLayerItems(
  document: CourseProjectDocument,
  updates: readonly EffectiveLayerPropertyUpdate[],
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  if (updates.length === 0) return succeedLayerNoop(document, '未变化')
  try {
    const plans = updates.map(({ target, patch }) => {
      if (target.stateId) throw new Error('当前原子属性写入不支持命名状态')
      const located = resolveEffectiveLayerTarget(document, target)
      const normalized = normalizeEffectiveLayerPropertyPatch(located.item, located.source, patch)
      return {
        layerItemId: located.item.layerItemId,
        patch: normalized.patch,
        changed: normalized.changed,
      }
    })
    const ids = plans.map((plan) => plan.layerItemId)
    if (new Set(ids).size !== ids.length) throw new Error('一次属性更新不能包含重复元素')
    if (!plans.some((plan) => plan.changed)) return succeedLayerNoop(document, '未变化')

    return runMutation(document, (draft) => {
      for (const plan of plans) {
        if (!plan.changed) continue
        const located = locateCourseLayer(draft, plan.layerItemId)
        if (!located) throw new Error(`找不到图层：${plan.layerItemId}`)
        const { patch } = plan
        if (patch.label !== undefined) located.item.label = patch.label
        if (patch.frame) Object.assign(located.item.frame, patch.frame)
        if (patch.rotation !== undefined) located.item.rotation = patch.rotation
        if (patch.opacity !== undefined) located.item.opacity = patch.opacity
        if (patch.visible !== undefined) located.item.visible = patch.visible
        if (patch.locked !== undefined) located.item.locked = patch.locked
        if (patch.playbackInitialVisibility !== undefined) {
          located.item.playbackInitialVisibility = patch.playbackInitialVisibility
        }
        if (patch.nativeTextStyle !== undefined) {
          if (located.item.kind !== 'native' || located.item.content.nativeType !== 'text') {
            throw new Error('当前元素不支持文字整节点样式')
          }
          Object.assign(located.item.content.data.style, patch.nativeTextStyle)
        }
      }
    }, `已更新 ${plans.filter((plan) => plan.changed).length} 个图层属性`, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新图层属性')
  }
}

export function patchEffectiveLayerItem(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  patch: { readonly visible?: boolean; readonly locked?: boolean; readonly label?: string },
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const located = resolveEffectiveLayerTarget(document, target)
    if (located.source === 'global') {
      return patchGlobalLayerItem(document, target, patch, options)
    }
    const unlocking = patch.locked === false
    const locked = refuseLockedLayerWrite(located.item, unlocking)
    if (locked) return locked
    const nextLabel = patch.label !== undefined ? patch.label.trim() : undefined
    if (nextLabel !== undefined && nextLabel.length === 0) {
      return failLayerCommand('名称不能为空')
    }
    const stateView = namedState(document, located, target.stateId)
    if (stateView && (patch.visible !== undefined || patch.locked !== undefined)) {
      const currentOverride = stateView.state.layerItemOverrides[located.item.layerItemId] ?? {}
      const currentVisible = currentOverride.visible ?? located.item.visible
      const currentLocked = currentOverride.locked ?? located.item.locked
      const unchanged =
        (patch.visible === undefined || currentVisible === patch.visible) &&
        (patch.locked === undefined || currentLocked === patch.locked) &&
        (nextLabel === undefined || (currentOverride.label ?? located.item.label) === nextLabel)
      if (unchanged) return succeedLayerNoop(document, '未变化')
      return runMutation(document, (draft) => {
        const nextState = namedState(draft, located, target.stateId)
        if (!nextState) throw new Error('当前命名状态已失效')
        const override = nextState.state.layerItemOverrides[located.item.layerItemId] ?? {}
        if (patch.visible !== undefined) {
          if (patch.visible === located.item.visible) delete override.visible
          else override.visible = patch.visible
        }
        if (patch.locked !== undefined) {
          if (patch.locked === located.item.locked) delete override.locked
          else override.locked = patch.locked
        }
        if (nextLabel !== undefined) {
          if (nextLabel === located.item.label) delete override.label
          else override.label = nextLabel.slice(0, 200)
        }
        nextState.state.layerItemOverrides[located.item.layerItemId] = override
        deleteEmptyOverride(nextState.state.layerItemOverrides, located.item.layerItemId)
      }, '已更新当前状态图层', options)
    }
    const unchanged =
      (patch.visible === undefined || located.item.visible === patch.visible) &&
      (patch.locked === undefined || located.item.locked === patch.locked) &&
      (nextLabel === undefined || located.item.label === nextLabel)
    if (unchanged) return succeedLayerNoop(document, '未变化')
    return runMutation(document, (draft) => {
      const current = locateCourseLayer(draft, located.item.layerItemId)
      if (!current) throw new Error(`找不到图层：${located.item.layerItemId}`)
      if (patch.visible !== undefined) current.item.visible = patch.visible
      if (patch.locked !== undefined) current.item.locked = patch.locked
      if (nextLabel !== undefined) current.item.label = nextLabel.slice(0, 200)
    }, nextLabel !== undefined
      ? `已重命名为“${nextLabel.slice(0, 200)}”`
      : patch.locked !== undefined
        ? (patch.locked ? '已锁定图层' : '已解锁图层')
        : (patch.visible ? '已显示图层' : '已隐藏图层'), options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新图层')
  }
}

export function duplicateEffectiveLayerItem(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const located = resolveEffectiveLayerTarget(document, target)
    if (located.source === 'global') {
      return duplicateGlobalLayerItem(document, target, options)
    }
    if (isTeacherControllerLayerItem(located.item)) {
      return failLayerCommand(CONTROLLER_MOVE_REASON)
    }
    const locked = refuseLockedLayerWrite(located.item, false)
    if (locked) return locked
    const reserved = collectCourseLayerItemIds(document)
    const createdId = nextDuplicateLayerItemId(located.item, reserved)
    return runMutation(document, (draft) => {
      const current = locateCourseLayer(draft, located.item.layerItemId)
      if (!current) throw new Error(`找不到图层：${located.item.layerItemId}`)
      const duplicate = cloneDuplicatedLayerItem(current.item, createdId)
      shiftCourseLayerOrdersAtOrAbove(draft, current.item.order + 1)
      duplicate.order = current.item.order + 1
      if (current.source === 'surface' && current.surfaceId) {
        const surface = draft.surfaces.find((candidate) => candidate.id === current.surfaceId)
        if (!surface) throw new Error('当前内容表面已失效')
        surface.surfaceLayerItems.push({
          item: duplicate,
          visibility: structuredClone(current.scoped?.visibility ?? { mode: 'all', locationIds: [] }),
        })
      } else if (current.source === 'scene' && current.surfaceId && current.sceneId) {
        const surface = draft.surfaces.find((candidate) => candidate.id === current.surfaceId)
        if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
        const scene = surface.scenes.find((candidate) => candidate.id === current.sceneId)
        if (!scene) throw new Error('当前幻灯片已失效')
        scene.layerItems.push(duplicate)
        copyNamedStateOverrides(scene, current.item.layerItemId, createdId)
      } else if (current.source === 'world' && current.surfaceId) {
        const surface = draft.surfaces.find((candidate) => candidate.id === current.surfaceId)
        if (!surface || surface.type !== 'spatial-2d') throw new Error('当前世界已失效')
        surface.world.layerItems.push(duplicate)
      } else {
        throw new Error(LAYER_REJECT_WRONG_OWNER)
      }
      sortAllCourseLayerLists(draft)
    }, `已复制“${located.item.label}”`, options, createdId)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法复制图层')
  }
}

function copyNamedStateOverrides(
  scene: SlideSceneDocument,
  sourceId: string,
  duplicateId: string,
): void {
  scene.presentation?.states.forEach((state) => {
    const sourceOverride = state.layerItemOverrides[sourceId]
    if (!sourceOverride) return
    const duplicateOverride = structuredClone(sourceOverride)
    delete duplicateOverride.locked
    delete duplicateOverride.order
    if (Object.keys(duplicateOverride).length > 0) {
      state.layerItemOverrides[duplicateId] = duplicateOverride
    }
  })
}

export function deleteEffectiveLayerItem(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const located = resolveEffectiveLayerTarget(document, target)
    if (located.source === 'global') {
      return deleteGlobalLayerItem(document, target, options)
    }
    const locked = refuseLockedLayerWrite(located.item, false)
    if (locked) return locked
    const stateView = namedState(document, located, target.stateId)
    if (stateView) {
      if (isNamedStateOwnedLayer(located.item, stateView.state)) {
        return runMutation(document, (draft) => {
          removeLocatedItem(draft, located)
        }, `已删除“${located.item.label}”`, options)
      }
      const override = stateView.state.layerItemOverrides[located.item.layerItemId] ?? {}
      if (override.visible === false || (override.visible === undefined && !located.item.visible)) {
        return failLayerCommand(`“${located.item.label}”已在当前状态隐藏`)
      }
      return runMutation(document, (draft) => {
        const nextState = namedState(draft, located, target.stateId)
        if (!nextState) throw new Error('当前命名状态已失效')
        const nextOverride = nextState.state.layerItemOverrides[located.item.layerItemId] ?? {}
        if (located.item.visible) nextOverride.visible = false
        else delete nextOverride.visible
        nextState.state.layerItemOverrides[located.item.layerItemId] = nextOverride
        deleteEmptyOverride(nextState.state.layerItemOverrides, located.item.layerItemId)
      }, `已从当前状态隐藏“${located.item.label}”`, options)
    }
    return runMutation(document, (draft) => {
      removeLocatedItem(draft, located)
    }, `已删除“${located.item.label}”`, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法删除图层')
  }
}

function removeLocatedItem(
  project: CourseProjectDocument,
  located: LocatedCourseLayer,
): LayerItem {
  if (located.source === 'global') {
    const index = project.globalLayerItems.findIndex(
      (entry) => entry.item.layerItemId === located.item.layerItemId,
    )
    if (index < 0) throw new Error(`找不到图层：${located.item.layerItemId}`)
    return project.globalLayerItems.splice(index, 1)[0]!.item
  }
  const surface = project.surfaces.find((candidate) => candidate.id === located.surfaceId)
  if (!surface) throw new Error('当前表面已失效')
  if (located.source === 'surface') {
    const index = surface.surfaceLayerItems.findIndex(
      (entry) => entry.item.layerItemId === located.item.layerItemId,
    )
    if (index < 0) throw new Error(`找不到图层：${located.item.layerItemId}`)
    return surface.surfaceLayerItems.splice(index, 1)[0]!.item
  }
  if (located.source === 'scene' && surface.type === 'slide') {
    const scene = surface.scenes.find((candidate) => candidate.id === located.sceneId)
    if (!scene) throw new Error('当前幻灯片已失效')
    const index = scene.layerItems.findIndex((item) => item.layerItemId === located.item.layerItemId)
    if (index < 0) throw new Error(`找不到图层：${located.item.layerItemId}`)
    const [removed] = scene.layerItems.splice(index, 1)
    scene.presentation?.states.forEach((state) => {
      delete state.layerItemOverrides[located.item.layerItemId]
      if (state.layerItemOrder) {
        state.layerItemOrder = state.layerItemOrder.filter((id) => id !== located.item.layerItemId)
      }
    })
    return removed!
  }
  if (located.source === 'world' && surface.type === 'spatial-2d') {
    const index = surface.world.layerItems.findIndex(
      (item) => item.layerItemId === located.item.layerItemId,
    )
    if (index < 0) throw new Error(`找不到图层：${located.item.layerItemId}`)
    return surface.world.layerItems.splice(index, 1)[0]!
  }
  throw new Error(LAYER_REJECT_WRONG_OWNER)
}

/**
 * Reorder is owner-internal. Mixed-owner id lists fail; they are never a
 * successful “暂不能调整顺序” no-op.
 */
export function reorderEffectiveLayerItems(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  orderedLayerItemIds: readonly string[],
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const located = resolveEffectiveLayerTarget(document, target)
    const siblings = listOwnedLayerItems(document, located.source, {
      surfaceId: located.surfaceId,
      sceneId: located.sceneId,
    })
    const siblingIds = new Set(siblings.map((item) => item.layerItemId))
    if (orderedLayerItemIds.some((id) => !siblingIds.has(id))) {
      return failLayerCommand(CROSS_OWNER_REORDER_REASON)
    }
    if (located.source === 'global') {
      return reorderGlobalLayerItems(document, orderedLayerItemIds, options)
    }
    const currentIds = ownerBackToFrontIds(siblings)
    if (
      orderedLayerItemIds.length !== currentIds.length ||
      new Set(orderedLayerItemIds).size !== orderedLayerItemIds.length ||
      orderedLayerItemIds.some((id) => !currentIds.includes(id))
    ) {
      return failLayerCommand('排序必须包含该来源的全部图层，且不能混入其他来源。')
    }
    if (orderedLayerItemIds.every((id, index) => id === currentIds[index])) {
      return succeedLayerNoop(document, '顺序未变化')
    }
    return runMutation(document, (draft) => {
      const items = ownerItemsFromDraft(draft, located)
      if (!reorderOwnerOrderSlots(items, orderedLayerItemIds)) {
        throw new Error('排序必须包含该来源的全部图层，且不能混入其他来源。')
      }
      sortAllCourseLayerLists(draft)
    }, '已调整图层顺序', options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法调整图层顺序')
  }
}

export interface EffectiveLayerOwnerDestination {
  readonly source: LayerOwnerSource
  readonly surfaceId?: string | null
  readonly sceneId?: string | null
}

function insertIntoOwner(
  project: CourseProjectDocument,
  destination: EffectiveLayerOwnerDestination,
  item: LayerItem,
  visibility: LocationVisibility | undefined,
): void {
  item.order = allocateCourseLayerOrder(project, item.order)
  if (destination.source === 'global') {
    project.globalLayerItems.push({
      item,
      visibility: visibility ?? { mode: 'all', locationIds: [] },
    })
    return
  }
  if (destination.source === 'surface' && destination.surfaceId) {
    const surface = project.surfaces.find((candidate) => candidate.id === destination.surfaceId)
    if (!surface) throw new Error('目标表面已失效')
    surface.surfaceLayerItems.push({
      item,
      visibility: visibility ?? { mode: 'all', locationIds: [] },
    })
    return
  }
  if (destination.source === 'scene' && destination.sceneId) {
    for (const surface of project.surfaces) {
      if (surface.type !== 'slide') continue
      const scene = surface.scenes.find((candidate) => candidate.id === destination.sceneId)
      if (!scene) continue
      scene.layerItems.push(item)
      return
    }
    throw new Error('目标幻灯片已失效')
  }
  if (destination.source === 'world' && destination.surfaceId) {
    const surface = project.surfaces.find((candidate) => candidate.id === destination.surfaceId)
    if (!surface || surface.type !== 'spatial-2d') throw new Error('目标世界已失效')
    surface.world.layerItems.push(item)
    return
  }
  throw new Error(LAYER_REJECT_WRONG_OWNER)
}

/**
 * Explicit ownership change. Reorder must not call this implicitly.
 * Teacher controllers cannot leave the global owner.
 */
export function moveEffectiveLayerOwner(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  destination: EffectiveLayerOwnerDestination,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const located = resolveEffectiveLayerTarget(document, target)
    if (
      located.source === destination.source &&
      located.surfaceId === (destination.surfaceId ?? null) &&
      located.sceneId === (destination.sceneId ?? null)
    ) {
      return succeedLayerNoop(document, '来源未变化')
    }
    const { surface } = requireLocationSurface(document, target.locationId)
    if (
      surface.type === 'spatial-2d' &&
      isSpatialCrossCoordinateOwnerMove(located.item, located.source, destination.source)
    ) {
      return failLayerCommand(SPATIAL_CROSS_COORDINATE_MOVE_REASON)
    }
    if (isTeacherControllerLayerItem(located.item) && destination.source !== 'global') {
      return failLayerCommand(CONTROLLER_MOVE_REASON)
    }
    const locked = refuseLockedLayerWrite(located.item, false)
    if (locked) return locked
    return runMutation(document, (draft) => {
      const current = locateCourseLayer(draft, located.item.layerItemId)
      if (!current) throw new Error(`找不到图层：${located.item.layerItemId}`)
      if (isTeacherControllerLayerItem(current.item) && destination.source !== 'global') {
        throw new Error(CONTROLLER_MOVE_REASON)
      }
      const visibility = current.scoped?.visibility
      const item = removeLocatedItem(draft, current)
      insertIntoOwner(draft, destination, item, visibility)
      sortAllCourseLayerLists(draft)
    }, `已将“${located.item.label}”移动到目标范围`, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法移动图层')
  }
}

export {
  CROSS_OWNER_REORDER_REASON,
  CONTROLLER_MOVE_REASON,
  LAYER_REJECT_LOCKED,
  LAYER_REJECT_STALE_REVISION,
  LAYER_REJECT_WRONG_OWNER,
  describeGlobalLayerDeleteImpact,
  findGlobalTeacherController,
  isTeacherControllerLayerItem,
  makeGlobalLayerAuthoringAddress,
  restoreDefaultTeacherController,
  setGlobalLayerLocationVisibility,
  setGlobalLayerVisibleAtLocation,
} from './globalLayerCommands'
