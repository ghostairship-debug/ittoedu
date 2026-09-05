import { nanoid } from 'nanoid'
import type {
  CourseLocation,
  CourseProjectDocument,
  LayerItem,
  LayerItemOverride,
  ScopedLayerItem,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'
import type { InteractionRule } from '../../shared/interactionTypes'
import type { TeacherControllerButton } from '../../shared/contracts/native-v1'

export interface RemovedCourseReferences {
  /** Course-location ids only. These never stand in for scene, block, or layer ids. */
  readonly removedLocationIds: ReadonlySet<string>
  /** Candidate Slide-scene ids removed by the command. */
  readonly removedInteractionSceneIds?: ReadonlySet<string>
  /** Candidate location/scene/block/frame aliases previously accepted by teacher controllers. */
  readonly removedControllerTargetIds?: ReadonlySet<string>
  /** Candidate unified-layer ids removed together with a scene or surface. */
  readonly removedLayerItemIds?: ReadonlySet<string>
}

export function controllerTargetIdsForLocations(
  locations: readonly CourseLocation[],
): Set<string> {
  return new Set(locations.flatMap((location) => [
    location.id,
    location.kind === 'slide-scene'
      ? location.sceneId
      : location.kind === 'flow-block'
        ? location.blockId
        : location.cameraFrameId,
  ]))
}

function remainingInteractionSceneIds(project: CourseProjectDocument): Set<string> {
  return new Set(project.surfaces.flatMap((surface) => (
    surface.type === 'slide' ? surface.scenes.map((scene) => scene.id) : []
  )))
}

function remainingControllerTargetIds(project: CourseProjectDocument): Set<string> {
  return controllerTargetIdsForLocations(project.locations)
}

function visitAllLayerItems(
  project: CourseProjectDocument,
  visit: (item: LayerItem) => void,
): void {
  project.globalLayerItems.forEach((entry) => visit(entry.item))
  project.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach((entry) => visit(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(visit))
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach(visit)
    }
  })
}

function remainingLayerItemIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  visitAllLayerItems(project, (item) => ids.add(item.layerItemId))
  return ids
}

function unresolvedIds(
  removedIds: ReadonlySet<string> | undefined,
  remainingIds: ReadonlySet<string>,
): Set<string> {
  if (!removedIds || removedIds.size === 0) return new Set()
  return new Set([...removedIds].filter((id) => !remainingIds.has(id)))
}

function removeDeletedLocationVisibility(
  entries: ScopedLayerItem[],
  removedLocationIds: ReadonlySet<string>,
  removedLayerItemIds: Set<string>,
): void {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.visibility.mode === 'all') continue
    entry.visibility.locationIds = entry.visibility.locationIds.filter(
      (locationId) => !removedLocationIds.has(locationId),
    )
    if (entry.visibility.locationIds.length > 0) continue
    if (entry.visibility.mode === 'include') {
      removedLayerItemIds.add(entry.item.layerItemId)
      entries.splice(index, 1)
    } else entry.visibility = { mode: 'all', locationIds: [] }
  }
}

function removeDeletedNavigationGuards(
  project: CourseProjectDocument,
  removedLocationIds: ReadonlySet<string>,
): void {
  project.navigationGuards = project.navigationGuards.flatMap((guard) => {
    const fromLocationIds = guard.fromLocationIds?.filter(
      (locationId) => !removedLocationIds.has(locationId),
    )
    if (guard.fromLocationIds !== undefined && fromLocationIds?.length === 0) return []
    const toLocationIds = guard.toLocationIds.filter(
      (locationId) => !removedLocationIds.has(locationId),
    )
    if (toLocationIds.length === 0) return []
    return [{
      ...guard,
      ...(fromLocationIds === undefined ? {} : { fromLocationIds }),
      toLocationIds,
    }]
  })
}

function repairInteractionReferences(
  interactions: InteractionRule[],
  removedSceneIds: ReadonlySet<string>,
  removedLayerItemIds: ReadonlySet<string>,
): InteractionRule[] {
  const removedActionIds = new Set<string>()
  let remaining = interactions.flatMap((rule) => {
    const trigger = rule.trigger
    if ('nodeId' in trigger && removedLayerItemIds.has(trigger.nodeId)) {
      rule.actions.forEach((step) => removedActionIds.add(step.id))
      return []
    }
    let impossibleSceneCondition = false
    rule.conditions.forEach((condition) => {
      if (condition.type !== 'scene.in') return
      condition.sceneIds = condition.sceneIds.filter((id) => !removedSceneIds.has(id))
      if (condition.sceneIds.length === 0) impossibleSceneCondition = true
    })

    const keptActions = rule.actions.filter((step) => {
      const action = step.action
      const removed = (
        action.type === 'scene.go' && removedSceneIds.has(action.sceneId)
      ) || (
        'nodeId' in action && removedLayerItemIds.has(action.nodeId)
      )
      if (removed) removedActionIds.add(step.id)
      return !removed
    })
    if (impossibleSceneCondition || keptActions.length === 0) {
      rule.actions.forEach((step) => removedActionIds.add(step.id))
      return []
    }
    rule.actions = keptActions
    rule.actions[0]!.start = 'after-previous'
    return [rule]
  })

  let removedDependentRule = true
  while (removedDependentRule) {
    removedDependentRule = false
    remaining = remaining.flatMap((rule) => {
      if (
        rule.trigger.type !== 'animation.completed'
        || !removedActionIds.has(rule.trigger.actionId)
      ) {
        return [rule]
      }
      rule.actions.forEach((step) => removedActionIds.add(step.id))
      removedDependentRule = true
      return []
    })
  }
  return remaining
}

function removeControllerButtonTargets(
  buttons: TeacherControllerButton[],
  removedIds: ReadonlySet<string>,
): TeacherControllerButton[] {
  const remaining = buttons.filter((button) => (
    button.action.type !== 'scene.go' || !removedIds.has(button.action.sceneId)
  ))
  if (remaining.length === 0) {
    remaining.push({
      id: `teacher-button-${nanoid(10)}`,
      action: { type: 'scene.next' },
      label: '下一场景',
      visible: true,
    })
  }
  return remaining
}

function removeControllerTargetsFromItem(
  item: LayerItem,
  removedIds: ReadonlySet<string>,
): void {
  if (item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') return
  item.content.data.buttons = removeControllerButtonTargets(item.content.data.buttons, removedIds)
}

function teacherControllerOverrideButtons(
  item: LayerItem | undefined,
  override: LayerItemOverride,
): TeacherControllerButton[] | undefined {
  if (
    item?.kind !== 'native'
    || item.content.nativeType !== 'teacher-controller'
    || !override.nativeData
    || !Array.isArray(override.nativeData.buttons)
  ) {
    return undefined
  }
  return override.nativeData.buttons as TeacherControllerButton[]
}

function removeControllerTargetsFromSceneOverrides(
  scene: SlideSceneDocument,
  removedIds: ReadonlySet<string>,
): void {
  const items = new Map(scene.layerItems.map((item) => [item.layerItemId, item]))
  scene.presentation?.states.forEach((state) => {
    Object.entries(state.layerItemOverrides).forEach(([layerItemId, override]) => {
      const buttons = teacherControllerOverrideButtons(items.get(layerItemId), override)
      if (buttons && override.nativeData) {
        override.nativeData.buttons = removeControllerButtonTargets(buttons, removedIds)
      }
    })
  })
}

function repairProjectInteractionReferences(
  project: CourseProjectDocument,
  removedSceneIds: ReadonlySet<string>,
  removedLayerItemIds: ReadonlySet<string>,
): void {
  project.globalInteractions = repairInteractionReferences(
    project.globalInteractions,
    removedSceneIds,
    removedLayerItemIds,
  )
  project.surfaces.forEach((surface) => {
    if (surface.type !== 'slide') return
    surface.scenes.forEach((scene) => {
      scene.interactions = repairInteractionReferences(
        scene.interactions,
        removedSceneIds,
        removedLayerItemIds,
      )
    })
  })
}

function removeLayerItemReferences(
  project: CourseProjectDocument,
  removedLayerItemIds: ReadonlySet<string>,
): void {
  project.surfaces.forEach((surface) => {
    if (surface.type !== 'slide') return
    surface.scenes.forEach((scene) => {
      scene.presentation?.states.forEach((state) => {
        removedLayerItemIds.forEach((layerItemId) => {
          delete state.layerItemOverrides[layerItemId]
        })
        if (state.layerItemOrder) {
          state.layerItemOrder = state.layerItemOrder.filter(
            (layerItemId) => !removedLayerItemIds.has(layerItemId),
          )
          if (state.layerItemOrder.length === 0) delete state.layerItemOrder
        }
      })
    })
  })

  visitAllLayerItems(project, (item) => {
    if (item.kind !== 'runtime' || !item.runtime.nodeBindings) return
    const bindings = item.runtime.nodeBindings
    Object.entries(bindings).forEach(([binding, targetId]) => {
      if (removedLayerItemIds.has(targetId)) delete bindings[binding]
    })
    if (Object.keys(bindings).length === 0) {
      delete item.runtime.nodeBindings
    }
  })

  project.surfaces.forEach((surface) => {
    if (surface.type !== 'spatial-2d') return
    if (surface.world.paths) {
      surface.world.paths = surface.world.paths.flatMap((path) => {
        const layerItemIds = path.layerItemIds.filter((id) => !removedLayerItemIds.has(id))
        return layerItemIds.length === 0 ? [] : [{ ...path, layerItemIds }]
      })
    }
    if (surface.world.relations) {
      surface.world.relations = surface.world.relations.filter((relation) => (
        !removedLayerItemIds.has(relation.sourceLayerItemId)
        && !removedLayerItemIds.has(relation.targetLayerItemId)
      ))
    }
    surface.semanticZoom = surface.semanticZoom.flatMap((rule) => {
      const layerItemIds = rule.layerItemIds.filter((id) => !removedLayerItemIds.has(id))
      return layerItemIds.length === 0 ? [] : [{ ...rule, layerItemIds }]
    })
  })
}

function removeControllerTargetReferences(
  project: CourseProjectDocument,
  removedIds: ReadonlySet<string>,
): void {
  project.globalLayerItems.forEach((entry) => removeControllerTargetsFromItem(entry.item, removedIds))
  project.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach((entry) => (
      removeControllerTargetsFromItem(entry.item, removedIds)
    ))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        scene.layerItems.forEach((item) => removeControllerTargetsFromItem(item, removedIds))
        removeControllerTargetsFromSceneOverrides(scene, removedIds)
      })
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => removeControllerTargetsFromItem(item, removedIds))
    }
  })
}

/**
 * Repairs only the reference domains explicitly removed by a course-structure command.
 * Interaction and controller candidates are independently filtered against the
 * post-mutation document, so same-named ids surviving in the relevant domain stay valid.
 */
export function repairRemovedCourseReferences(
  project: CourseProjectDocument,
  removed: RemovedCourseReferences,
): void {
  const removedLayerItemCandidates = new Set(removed.removedLayerItemIds ?? [])
  if (removed.removedLocationIds.size > 0) {
    removeDeletedNavigationGuards(project, removed.removedLocationIds)
    removeDeletedLocationVisibility(
      project.globalLayerItems,
      removed.removedLocationIds,
      removedLayerItemCandidates,
    )
    project.surfaces.forEach((surface) => (
      removeDeletedLocationVisibility(
        surface.surfaceLayerItems,
        removed.removedLocationIds,
        removedLayerItemCandidates,
      )
    ))
  }

  const removedInteractionSceneIds = unresolvedIds(
    removed.removedInteractionSceneIds,
    remainingInteractionSceneIds(project),
  )
  const removedLayerItemIds = unresolvedIds(
    removedLayerItemCandidates,
    remainingLayerItemIds(project),
  )
  if (removedInteractionSceneIds.size > 0 || removedLayerItemIds.size > 0) {
    repairProjectInteractionReferences(
      project,
      removedInteractionSceneIds,
      removedLayerItemIds,
    )
  }
  if (removedLayerItemIds.size > 0) {
    removeLayerItemReferences(project, removedLayerItemIds)
  }
  // Removing a feedback target can remove its actions/rules. Release managed
  // ownership when a listed rule disappears instead of retaining a dangling ID.
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const rules = new Set(scene.interactions.map(rule => rule.id))
      for (const item of scene.layerItems) {
        if (item.kind === 'native' && item.content.nativeType === 'input' &&
          item.content.data.ruleFamilyRuleIds.some(id => !rules.has(id))) item.content.data.ruleFamilyRuleIds = []
      }
    }
  }

  const removedControllerTargetIds = unresolvedIds(
    removed.removedControllerTargetIds,
    remainingControllerTargetIds(project),
  )
  if (removedControllerTargetIds.size > 0) {
    removeControllerTargetReferences(project, removedControllerTargetIds)
  }
}
