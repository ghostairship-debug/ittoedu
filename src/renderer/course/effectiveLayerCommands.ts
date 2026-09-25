import { patchEffectiveLayerPropertiesAtTargets as planPropertyTargets, patchEffectiveLayerPropertiesAtTarget as planPropertyTarget, materializeNamedStateItem, writeNamedStatePropertyPatch, type EffectiveLayerPropertiesPatchAtTarget } from '../../core/tools/layerProperties'
export type { EffectiveLayerPropertiesPatchAtTarget } from '../../core/tools/layerProperties'
import { LayerOwnerSource, requireLocationSurface, activeSlideScene, makeEffectiveLayerAuthoringAddress, resolveEffectiveLayerTarget, namedState, deleteEmptyOverride, runMutation, removeLocatedItem } from '../../core/tools/layerCommands'
import { locateCourseLayer, normalizeEffectiveLayerPropertyPatch as normalizeLayerPropertyPatch, type LocatedCourseLayer, type EffectiveLayerPropertyPatch } from '../../core/drivers/course/layerProperties'
export { locateCourseLayer, type LocatedCourseLayer, type EffectiveLayerPropertyPatch } from '../../core/drivers/course/layerProperties'

import { produce } from 'immer'

import { getEffectiveCourseLayerOrder } from '../../shared/courseProjectModel'
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import type { CourseProjectDocument, LayerItem, LocationVisibility } from '../../shared/courseProjectTypes'

import { nativeLayerTextAutoSizeFrame } from '../authoring/nativeTextLayout'
import { CONTROLLER_MOVE_REASON, CROSS_OWNER_REORDER_REASON, LAYER_REJECT_LOCKED, LAYER_REJECT_WRONG_OWNER, failLayerCommand, isTeacherControllerLayerItem, makeGlobalLayerAuthoringAddress, patchGlobalLayerItem, refuseLockedLayerWrite, rejectIfStaleDocument, succeedLayerNoop, type EffectiveLayerCommandTarget, type LayerCommandOptions, type LayerCommandResult } from '../../core/tools/globalLayers'
import { allocateCourseLayerOrder, sortAllCourseLayerLists } from './globalLayerCommands'

import { spatialLayerCoordinateSpace, type SpatialEditorLayerScope } from './spatialEditorView'

export type { EffectiveLayerCommandTarget, LayerCommandOptions, LayerCommandResult } from '../../core/tools/globalLayers'

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

export interface EffectiveLayerPropertyUpdate {
  readonly target: EffectiveLayerCommandTarget
  readonly patch: EffectiveLayerPropertyPatch
}

/**
 * One exact Properties submit. Component props are a complete resolved object
 * so named-state overrides can also represent removed keys.
 */
export function previewNativeLayerData(
  project: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  nativeData: Record<string, unknown>,
): CourseProjectDocument {
  try {
    const located = resolveEffectiveLayerTarget(project, target)
    const state = namedState(project, located, target.stateId)
    const effective = materializeNamedStateItem(located.item, state?.state.layerItemOverrides[located.item.layerItemId])
    if (effective.kind !== 'native' || effective.locked || (target.stateId && located.source === 'scene' && !state)) return project
    const nextData = mergeCourseNativeData(effective.content.data as Record<string, unknown>, nativeData) as typeof effective.content.data
    const nextOverride = structuredClone(state?.state.layerItemOverrides[located.item.layerItemId] ?? {})
    if (state) writeNamedStatePropertyPatch(located.item, nextOverride, { nativeData })
    return produce(project, draft => {
      const current = locateCourseLayer(draft, located.item.layerItemId)!
      const stateView = namedState(draft, current, target.stateId)
      if (stateView) {
        stateView.state.layerItemOverrides[current.item.layerItemId] = nextOverride
      } else if (current.item.kind === 'native') {
        current.item.content.data = nextData
      }
    })
  } catch {
    return project
  }
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

function normalizeEffectiveLayerPropertyPatch(
  item: LayerItem, source: LayerOwnerSource, patch: EffectiveLayerPropertyPatch,
  options: { readonly allowOwnedNativeData?: boolean } = {},
) {
  return normalizeLayerPropertyPatch(item, source, patch, { ...options, measureTextFrame: nativeLayerTextAutoSizeFrame })
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
      const located = resolveEffectiveLayerTarget(document, target)
      // stateId is a viewing context; only scene storage materializes named-state
      // overrides, which this atomic batch write does not support. Surface /
      // global / world targets keep stateId but always write the base item.
      if (target.stateId && located.source === 'scene') {
        throw new Error('当前原子属性写入不支持命名状态')
      }
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
        if (patch.nativeData !== undefined) {
          if (located.item.kind !== 'native' || isTeacherControllerLayerItem(located.item)) {
            throw new Error('当前元素不支持原生内容属性')
          }
          located.item.content.data = mergeCourseNativeData(
            located.item.content.data as Record<string, unknown>,
            patch.nativeData,
          ) as typeof located.item.content.data
        }
      }
    }, `已更新 ${plans.filter((plan) => plan.changed).length} 个图层属性`, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新图层属性')
  }
}

/**
 * Commits every field from one Properties submit through one strict Course V9
 * document mutation. Unlike the multi-item batch command, this exact-target
 * use case supports sparse Slide named-state overrides.
 */
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
      plane: 'overlay',
      visibility: visibility ?? { mode: 'all', locationIds: [] },
    })
    return
  }
  if (destination.source === 'surface' && destination.surfaceId) {
    const surface = project.surfaces.find((candidate) => candidate.id === destination.surfaceId)
    if (!surface) throw new Error('目标表面已失效')
    const scoped = {
      item,
      visibility: visibility ?? { mode: 'all' as const, locationIds: [] },
    }
    if (surface.type === 'flow') {
      surface.surfaceLayerItems.push({ ...scoped, bodyPlane: 'overlay' })
    } else {
      surface.surfaceLayerItems.push(scoped)
    }
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

export { CROSS_OWNER_REORDER_REASON, CONTROLLER_MOVE_REASON, LAYER_REJECT_LOCKED, LAYER_REJECT_STALE_REVISION, LAYER_REJECT_WRONG_OWNER, describeGlobalLayerDeleteImpact, findGlobalTeacherController, isTeacherControllerLayerItem, makeGlobalLayerAuthoringAddress, setGlobalLayerLocationVisibility, setGlobalLayerVisibleAtLocation } from '../../core/tools/globalLayers'
export { restoreDefaultTeacherController } from './globalLayerCommands'

/** Manual Properties adapters supply measured text bounds to the one pure planner. */
export function patchEffectiveLayerPropertiesAtTargets(document: Parameters<typeof planPropertyTargets>[0], updates: Parameters<typeof planPropertyTargets>[1], options: LayerCommandOptions = {}) {
  return planPropertyTargets(document, updates, { ...options, measureTextFrame: nativeLayerTextAutoSizeFrame })
}
export function patchEffectiveLayerPropertiesAtTarget(document: Parameters<typeof planPropertyTarget>[0], target: Parameters<typeof planPropertyTarget>[1], patch: Parameters<typeof planPropertyTarget>[2], options: LayerCommandOptions = {}) {
  return planPropertyTarget(document, target, patch, { ...options, measureTextFrame: nativeLayerTextAutoSizeFrame })
}
