import { cloneDuplicatedLayerItem } from './layerClone'
export { cloneDuplicatedLayerItem } from './layerClone'
import { makeAuthoringAddress } from '../../shared/authoringAddress'
import type { EffectiveCourseLayerItem } from '../../shared/courseProjectModel'
import type { CourseProjectDocument, CourseSurfaceDocument, LayerItem, LayerItemOverride, ScopedLayerItem, SlidePresentationState, SlideSceneDocument } from '../../shared/courseProjectTypes'
import { synchronizeCourseTeacherControllerControls } from '../../shared/teacherControllerConsistency'
import { locateCourseLayer, type LocatedCourseLayer } from '../drivers/course/layerProperties'
import { CONTROLLER_MOVE_REASON, CROSS_OWNER_REORDER_REASON, LAYER_REJECT_LOCKED, LAYER_REJECT_WRONG_OWNER, carrierForLayerItem, collectCourseLayerItemIds, duplicateGlobalLayerItem, failLayerCommand, isTeacherControllerLayerItem, makeGlobalLayerAuthoringAddress, nextDuplicateLayerItemId, ownerBackToFrontIds, parseLayerAuthoringAddress, refuseLockedLayerWrite, rejectIfStaleDocument, reorderGlobalLayerItems, reorderOwnerOrderSlots, shiftCourseLayerOrdersAtOrAbove, succeedLayerMutation, succeedLayerNoop, type EffectiveLayerCommandTarget, type LayerCommandOptions, type LayerCommandResult } from './globalLayers'
import { sortAllCourseLayerLists } from './layerOrder'
import { repairRemovedCourseReferences } from './courseReferenceCleanup'
import { commitCourseProjectMutation as commitSlideProjectMutation } from './courseProjectMutation'

export type LayerOwnerSource = EffectiveCourseLayerItem['source']

export function requireLocationSurface(
  project: CourseProjectDocument,
  locationId: string,
) {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface) throw new Error(`找不到表面：${location.surfaceId}`)
  return { location, surface }
}

export function activeSlideScene(
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

export function namedState(
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

/** Rendering-only sparse patch. Never enters canonical history or increments revision. */

export function deleteEmptyOverride(
  overrides: Record<string, LayerItemOverride>,
  layerItemId: string,
): void {
  if (Object.keys(overrides[layerItemId] ?? {}).length === 0) {
    delete overrides[layerItemId]
  }
}

export function isNamedStateOwnedLayer(
  base: LayerItem,
  presentationState: SlidePresentationState,
): boolean {
  return base.visible === false &&
    presentationState.layerItemOverrides[base.layerItemId]?.visible === true
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

export function runMutation(
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

export function ownerItemsFromDraft(
  draft: CourseProjectDocument,
  located: LocatedCourseLayer,
): LayerItem[] {
  return listOwnedLayerItems(draft, located.source, {
    surfaceId: located.surfaceId,
    sceneId: located.sceneId,
  })
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
        const scoped: ScopedLayerItem = {
          item: duplicate,
          visibility: structuredClone(current.scoped?.visibility ?? { mode: 'all', locationIds: [] }),
        }
        if (surface.type === 'flow') {
          const sourceEntry = surface.surfaceLayerItems.find(
            (entry) => entry.item.layerItemId === current.item.layerItemId,
          )
          surface.surfaceLayerItems.push({
            ...scoped,
            bodyPlane: sourceEntry?.bodyPlane ?? 'overlay',
          })
        } else {
          surface.surfaceLayerItems.push(scoped)
        }
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

export function copyNamedStateOverrides(
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
  return deleteEffectiveLayerItems(document, [target], options)
}

export interface EffectiveLayerDeletePlan {
  readonly target: EffectiveLayerCommandTarget
  readonly located: LocatedCourseLayer
  readonly mode: 'structural' | 'state-hide'
}

export function deleteEffectiveLayerItems(
  document: CourseProjectDocument,
  targets: readonly EffectiveLayerCommandTarget[],
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    if (targets.length === 0) return failLayerCommand('没有可删除的选择')
    const seen = new Set<string>()
    const plans: EffectiveLayerDeletePlan[] = []
    for (const target of targets) {
      const located = resolveEffectiveLayerTarget(document, target)
      if (seen.has(located.item.layerItemId)) {
        return failLayerCommand(`所选图层重复：${located.item.layerItemId}`)
      }
      seen.add(located.item.layerItemId)
      const stateView = namedState(document, located, target.stateId)
      if (target.stateId && located.source === 'scene' && !stateView) {
        return failLayerCommand('当前命名状态已失效')
      }
      const effectiveLocked = stateView?.state.layerItemOverrides[located.item.layerItemId]?.locked
        ?? located.item.locked
      if (effectiveLocked) return failLayerCommand(LAYER_REJECT_LOCKED)
      if (stateView && !isNamedStateOwnedLayer(located.item, stateView.state)) {
        const override = stateView.state.layerItemOverrides[located.item.layerItemId] ?? {}
        const effectiveVisible = override.visible ?? located.item.visible
        if (!effectiveVisible) {
          return failLayerCommand(`“${located.item.label}”已在当前状态隐藏`)
        }
        plans.push({ target, located, mode: 'state-hide' })
      } else {
        plans.push({ target, located, mode: 'structural' })
      }
    }

    const structuralIds = new Set(
      plans.filter((plan) => plan.mode === 'structural')
        .map((plan) => plan.located.item.layerItemId),
    )
    const removedTeacherController = plans.some((plan) => (
      plan.mode === 'structural' && isTeacherControllerLayerItem(plan.located.item)
    ))
    const reason = plans.length === 1
      ? plans[0]!.mode === 'state-hide'
        ? `已从当前状态隐藏“${plans[0]!.located.item.label}”`
        : `已删除“${plans[0]!.located.item.label}”`
      : plans.every((plan) => plan.mode === 'structural')
        ? `已删除 ${plans.length} 个图层`
        : `已删除或隐藏 ${plans.length} 个图层`

    return runMutation(document, (draft) => {
      for (const plan of plans) {
        const current = locateCourseLayer(draft, plan.located.item.layerItemId)
        if (!current) throw new Error(`找不到图层：${plan.located.item.layerItemId}`)
        if (plan.mode === 'structural') {
          removeLocatedItem(draft, current)
          continue
        }
        const nextState = namedState(draft, current, plan.target.stateId)
        if (!nextState) throw new Error('当前命名状态已失效')
        const nextOverride = nextState.state.layerItemOverrides[current.item.layerItemId] ?? {}
        if (current.item.visible) nextOverride.visible = false
        else delete nextOverride.visible
        nextState.state.layerItemOverrides[current.item.layerItemId] = nextOverride
        deleteEmptyOverride(nextState.state.layerItemOverrides, current.item.layerItemId)
      }
      if (structuralIds.size > 0) {
        repairRemovedCourseReferences(draft, {
          removedLocationIds: new Set(),
          removedLayerItemIds: structuralIds,
        })
      }
      if (removedTeacherController) synchronizeCourseTeacherControllerControls(draft)
    }, reason, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法删除所选图层')
  }
}

export function removeLocatedItem(
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
    if (located.source === 'surface' && located.surfaceId) {
      const surface = document.surfaces.find((candidate) => candidate.id === located.surfaceId)
      if (surface?.type === 'flow') {
        const entry = surface.surfaceLayerItems.find(
          (candidate) => candidate.item.layerItemId === located.item.layerItemId,
        )
        if (!entry) return failLayerCommand(`找不到图层：${located.item.layerItemId}`)
        const bodyPlane = entry.bodyPlane ?? 'overlay'
        const siblings = surface.surfaceLayerItems
          .filter((candidate) => (candidate.bodyPlane ?? 'overlay') === bodyPlane)
          .map((candidate) => candidate.item)
        const currentIds = ownerBackToFrontIds(siblings)
        if (
          orderedLayerItemIds.length !== currentIds.length ||
          new Set(orderedLayerItemIds).size !== orderedLayerItemIds.length ||
          orderedLayerItemIds.some((id) => !currentIds.includes(id))
        ) {
          return failLayerCommand('排序必须包含正文同一侧的全部页面浮层，且不能跨越正文边界。')
        }
        if (orderedLayerItemIds.every((id, index) => id === currentIds[index])) {
          return succeedLayerNoop(document, '顺序未变化')
        }
        return runMutation(document, (draft) => {
          const draftSurface = draft.surfaces.find((candidate) => candidate.id === located.surfaceId)
          if (!draftSurface || draftSurface.type !== 'flow') throw new Error('当前 Flow 页面已失效')
          const items = draftSurface.surfaceLayerItems
            .filter((candidate) => (candidate.bodyPlane ?? 'overlay') === bodyPlane)
            .map((candidate) => candidate.item)
          if (!reorderOwnerOrderSlots(items, orderedLayerItemIds)) {
            throw new Error('排序必须包含正文同一侧的全部页面浮层，且不能跨越正文边界。')
          }
          sortAllCourseLayerLists(draft)
        }, '已调整正文同侧浮层顺序', options)
      }
    }
    const siblings = listOwnedLayerItems(document, located.source, {
      surfaceId: located.surfaceId,
      sceneId: located.sceneId,
    })
    const siblingIds = new Set(siblings.map((item) => item.layerItemId))
    if (orderedLayerItemIds.some((id) => !siblingIds.has(id))) {
      return failLayerCommand(CROSS_OWNER_REORDER_REASON)
    }
    if (located.source === 'global') {
      return reorderGlobalLayerItems(document, target, orderedLayerItemIds, options)
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
