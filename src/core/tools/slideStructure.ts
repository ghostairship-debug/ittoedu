import { remapDuplicatedInputState } from './inputAuthoringState'
import { rebuildTableItemIds } from './nativeNodeFactories'
import { rebuildChartItemIds } from './chartIdentity'
import { presentationStateNameSchema } from './presentationStateTools'
import { nanoid } from 'nanoid'
import type { TeacherControllerButton } from '../../shared/teacherControllerConfig'
import type { CourseProjectDocument, LayerItem, LayerItemOverride, MixedPrintEntry, ScopedLayerItem, SlideSceneDocument, SlideSurfaceDocument } from '../../shared/courseProjectTypes'
import type { InteractionRule } from '../../shared/interactionTypes'
import { commitCourseProjectMutation as commitSlideProjectMutation } from './courseProjectMutation'
import { syncStartLocationToFirstLocation } from './courseLocationOrder'
import { controllerTargetIdsForLocations, repairRemovedCourseReferences } from './courseReferenceCleanup'
function stableId(prefix: string, preferred?: string): string {
  return preferred ?? `${prefix}-${nanoid(10)}`
}

function initialSlidePresentation(): NonNullable<SlideSceneDocument['presentation']> {
  return {
    initialStateId: 'state_initial',
    thumbnailStateId: 'state_initial',
    states: [{ id: 'state_initial', name: '初始', layerItemOverrides: {} }],
  }
}

function findMutableSlideScene(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
): SlideSceneDocument {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error(`找不到 Slide 表面：${surfaceId}`)
  const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene) throw new Error(`找不到 Slide 场景：${sceneId}`)
  return scene
}

function mutableSlideSurface(
  project: CourseProjectDocument,
  surfaceId: string,
): SlideSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error(`找不到 Slide 表面：${surfaceId}`)
  return surface
}

function insertAfterLastSlideLocation(
  project: CourseProjectDocument,
  surfaceId: string,
  locations: CourseProjectDocument['locations'],
): void {
  let insertionIndex = project.locations.length
  project.locations.forEach((location, index) => {
    if (location.kind === 'slide-scene' && location.surfaceId === surfaceId) {
      insertionIndex = index + 1
    }
  })
  project.locations.splice(insertionIndex, 0, ...locations)
}

function reorderSlideLocationsForSurface(
  project: CourseProjectDocument,
  surfaceId: string,
): void {
  const surface = mutableSlideSurface(project, surfaceId)
  const belongsToSurface = (location: CourseProjectDocument['locations'][number]) =>
    location.kind === 'slide-scene' && location.surfaceId === surfaceId
  const original = project.locations
  let lastTargetIndex = -1
  original.forEach((location, index) => {
    if (belongsToSurface(location)) lastTargetIndex = index
  })
  const byScene = new Map<string, CourseProjectDocument['locations']>()
  original.forEach((location) => {
    if (!belongsToSurface(location) || location.kind !== 'slide-scene') return
    const entries = byScene.get(location.sceneId) ?? []
    entries.push(location)
    byScene.set(location.sceneId, entries)
  })
  const ordered = surface.scenes.flatMap((scene) => byScene.get(scene.id) ?? [])
  if (lastTargetIndex < 0) {
    project.locations = [...original, ...ordered]
    return
  }
  let cursor = 0
  project.locations = original.flatMap((location, index) => {
    const replacement = belongsToSurface(location) && cursor < ordered.length
      ? [ordered[cursor++]!]
      : belongsToSurface(location)
        ? []
        : [location]
    if (index === lastTargetIndex && cursor < ordered.length) {
      replacement.push(...ordered.slice(cursor))
      cursor = ordered.length
    }
    return replacement
  })
}

function reorderSlidePrintEntry(
  project: CourseProjectDocument,
  surfaceId: string,
): void {
  const surface = mutableSlideSurface(project, surfaceId)
  const entry = project.mixedPrintPlan?.entries.find(
    (candidate): candidate is Extract<MixedPrintEntry, { kind: 'slide-scenes' }> =>
      candidate.kind === 'slide-scenes' && candidate.surfaceId === surfaceId,
  )
  if (!entry) return
  const rank = new Map(surface.scenes.map((scene, index) => [scene.id, index]))
  entry.sceneIds = entry.sceneIds
    .filter((sceneId) => rank.has(sceneId))
    .sort((left, right) => rank.get(left)! - rank.get(right)!)
}

export function mutateAddSlideScene(
  project: CourseProjectDocument,
  surfaceId: string,
  options: { name?: string; now?: string } = {},
): CourseProjectDocument {
  const sceneId = stableId('scene')
  return commitSlideProjectMutation(project, (draft) => {
    const surface = draft.surfaces.find((candidate) => candidate.id === surfaceId)
    if (!surface || surface.type !== 'slide') throw new Error('目标不是 Slide 表面')
    if (surface.scenes.some((scene) => scene.id === sceneId)) throw new Error(`场景 ID 已存在：${sceneId}`)
    const scene: SlideSceneDocument = {
      id: sceneId,
      name: options.name ?? `第 ${surface.scenes.length + 1} 幕`,
      backgroundColor: '#ffffff',
      layerItems: [],
      presentation: initialSlidePresentation(),
      interactions: [],
    }
    surface.scenes.push(scene)
    const printEntry = draft.mixedPrintPlan?.entries.find(
      (entry): entry is Extract<MixedPrintEntry, { kind: 'slide-scenes' }> =>
        entry.kind === 'slide-scenes' && entry.surfaceId === surfaceId,
    )
    printEntry?.sceneIds.push(sceneId)
    insertAfterLastSlideLocation(draft, surfaceId, [{
      id: sceneId,
      label: `${surface.title} · ${scene.name}`,
      kind: 'slide-scene',
      surfaceId,
      sceneId,
    }])
    reorderSlideLocationsForSurface(draft, surfaceId)
  }, options.now)
}

export function mutateRenameSlideScene(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  name: string,
  now?: string,
): CourseProjectDocument {
  return commitSlideProjectMutation(project, (draft) => {
    const surface = mutableSlideSurface(draft, surfaceId)
    const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
    if (!scene) throw new Error(`找不到 Slide 场景：${sceneId}`)
    scene.name = name
    draft.locations.forEach((location) => {
      if (
        location.kind === 'slide-scene' &&
        location.surfaceId === surfaceId &&
        location.sceneId === sceneId &&
        location.stateId === undefined
      ) {
        location.label = `${surface.title} · ${name}`
      }
    })
  }, now)
}

export function mutateReorderSlideScenes(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneIds: readonly string[],
  now?: string,
): CourseProjectDocument {
  return commitSlideProjectMutation(project, (draft) => {
    const surface = mutableSlideSurface(draft, surfaceId)
    if (
      sceneIds.length !== surface.scenes.length ||
      new Set(sceneIds).size !== sceneIds.length ||
      sceneIds.some((id) => !surface.scenes.some((scene) => scene.id === id))
    ) {
      throw new Error('场景排序必须且只能包含该 Slide 表面的全部场景')
    }
    const byId = new Map(surface.scenes.map((scene) => [scene.id, scene]))
    surface.scenes = sceneIds.map((id) => byId.get(id)!)
    reorderSlideLocationsForSurface(draft, surfaceId)
    reorderSlidePrintEntry(draft, surfaceId)
    syncStartLocationToFirstLocation(draft)
  }, now)
}

function remapTeacherControllerButtonList(
  buttons: TeacherControllerButton[],
  sceneIdMap: ReadonlyMap<string, string>,
  stateIdMap: ReadonlyMap<string, string>,
): TeacherControllerButton[] {
  return buttons.map((button) => {
    if (button.action.type !== 'scene.go') return button
    const duplicateSceneId = sceneIdMap.get(button.action.sceneId)
    if (!duplicateSceneId) return button
    return {
      ...button,
      action: {
        ...button.action,
        sceneId: duplicateSceneId,
        ...(button.action.targetStateId
          ? { targetStateId: stateIdMap.get(button.action.targetStateId) ?? button.action.targetStateId }
          : {}),
      },
    }
  })
}

function remapTeacherControllerButtons(
  item: LayerItem,
  sceneIdMap: ReadonlyMap<string, string>,
  stateIdMap: ReadonlyMap<string, string>,
): void {
  if (item.kind !== 'component' || item.role !== 'teacher-controller' || !Array.isArray(item.props.buttons)) return
  item.props.buttons = remapTeacherControllerButtonList(
    item.props.buttons as TeacherControllerButton[],
    sceneIdMap,
    stateIdMap,
  )
}

function teacherControllerOverrideButtons(item: LayerItem | undefined, override: LayerItemOverride): TeacherControllerButton[] | undefined {
  return item?.kind === 'component' && item.role === 'teacher-controller' && Array.isArray(override.componentProps?.buttons) ? override.componentProps.buttons as TeacherControllerButton[] : undefined
}

function duplicateSlideSceneDocument(
  draft: CourseProjectDocument,
  source: SlideSceneDocument,
  sceneId: string,
  name: string,
): SlideSceneDocument {
  const scene = structuredClone(source)
  const ruleIds = new Map(source.interactions.map(rule => [rule.id, stableId('rule')]))
  const stateKeys = new Map<string, string>()
  const sceneIdMap = new Map([[source.id, sceneId]])
  const layerIdMap = new Map(source.layerItems.map((item) => [
    item.layerItemId,
    stableId('layer'),
  ]))
  const stateIdMap = new Map((source.presentation?.states ?? []).map((state) => [
    state.id,
    stableId('state'),
  ]))
  const actionIdMap = new Map(source.interactions.flatMap((rule) =>
    rule.actions.map((step) => [step.id, stableId('action')] as const),
  ))

  scene.id = sceneId
  scene.name = name
  scene.layerItems.forEach((item) => {
    item.layerItemId = layerIdMap.get(item.layerItemId)!
    if (item.kind === 'native' && item.content.nativeType === 'table') item.content.data = rebuildTableItemIds(item.content.data)
    if (item.kind === 'native' && item.content.nativeType === 'chart') item.content.data = rebuildChartItemIds(item.content.data)
    remapDuplicatedInputState(draft, item, stateKeys, ruleIds)
    if (item.kind === 'runtime' && item.runtime.nodeBindings) {
      item.runtime.nodeBindings = Object.fromEntries(
        Object.entries(item.runtime.nodeBindings).map(([key, layerItemId]) => [
          key,
          layerIdMap.get(layerItemId) ?? layerItemId,
        ]),
      )
    }
    remapTeacherControllerButtons(item, sceneIdMap, stateIdMap)
  })
  if (scene.presentation) {
    scene.presentation.initialStateId = stateIdMap.get(scene.presentation.initialStateId)!
    if (scene.presentation.thumbnailStateId) {
      scene.presentation.thumbnailStateId = stateIdMap.get(scene.presentation.thumbnailStateId)!
    }
    scene.presentation.states.forEach((state) => {
      state.id = stateIdMap.get(state.id)!
      state.layerItemOverrides = Object.fromEntries(
        Object.entries(state.layerItemOverrides).map(([layerItemId, override]) => {
          const buttons = teacherControllerOverrideButtons(
            source.layerItems.find((item) => item.layerItemId === layerItemId),
            override,
          )
          if (buttons && override.componentProps) {
            override.componentProps!.buttons = remapTeacherControllerButtonList(
              buttons,
              sceneIdMap,
              stateIdMap,
            )
          }
          return [layerIdMap.get(layerItemId) ?? layerItemId, override]
        }),
      )
      if (state.layerItemOrder) {
        state.layerItemOrder = state.layerItemOrder.map((layerItemId) =>
          layerIdMap.get(layerItemId) ?? layerItemId,
        )
      }
    })
  }
  scene.interactions.forEach((rule) => {
    rule.id = ruleIds.get(rule.id)!
    const trigger = rule.trigger
    if ('nodeId' in trigger) trigger.nodeId = layerIdMap.get(trigger.nodeId) ?? trigger.nodeId
    if (trigger.type === 'presentation.enter') {
      trigger.stateId = stateIdMap.get(trigger.stateId) ?? trigger.stateId
    } else if (trigger.type === 'animation.completed') {
      trigger.actionId = actionIdMap.get(trigger.actionId) ?? trigger.actionId
    }
    rule.conditions.forEach((condition) => {
      if ('key' in condition && stateKeys.has(condition.key)) condition.key = stateKeys.get(condition.key)!
      if (condition.type === 'presentation.in') {
        condition.stateIds = condition.stateIds.map((stateId) => stateIdMap.get(stateId) ?? stateId)
      } else if (condition.type === 'scene.in') {
        condition.sceneIds = condition.sceneIds.map((id) => sceneIdMap.get(id) ?? id)
      }
    })
    rule.actions.forEach((step) => {
      step.id = actionIdMap.get(step.id)!
      const action = step.action
      if (action.type === 'course-state.set' && stateKeys.has(action.key)) action.key = stateKeys.get(action.key)!
      if ('nodeId' in action) action.nodeId = layerIdMap.get(action.nodeId) ?? action.nodeId
      if (action.type === 'presentation.set') {
        action.stateId = stateIdMap.get(action.stateId) ?? action.stateId
      } else if (action.type === 'scene.go' && action.sceneId === source.id) {
        action.sceneId = sceneId
        if (action.targetStateId) {
          action.targetStateId = stateIdMap.get(action.targetStateId) ?? action.targetStateId
        }
      }
    })
  })
  return scene
}

function appendDuplicatedVisibility(
  project: CourseProjectDocument,
  locationIdMap: ReadonlyMap<string, string>,
): void {
  const append = (entries: ScopedLayerItem[]) => {
    entries.forEach((entry) => {
      if (entry.visibility.mode === 'all') return
      const additions = entry.visibility.locationIds.flatMap((locationId) => {
        const duplicate = locationIdMap.get(locationId)
        return duplicate ? [duplicate] : []
      })
      entry.visibility.locationIds.push(...additions)
    })
  }
  append(project.globalLayerItems)
  project.surfaces.forEach((surface) => append(surface.surfaceLayerItems))
}

function appendDuplicatedSceneConditions(
  project: CourseProjectDocument,
  sourceSceneId: string,
  duplicateSceneId: string,
): void {
  const append = (interactions: InteractionRule[]) => {
    interactions.forEach((rule) => {
      rule.conditions.forEach((condition) => {
        if (
          condition.type === 'scene.in' &&
          condition.sceneIds.includes(sourceSceneId) &&
          !condition.sceneIds.includes(duplicateSceneId)
        ) {
          condition.sceneIds.push(duplicateSceneId)
        }
      })
    })
  }
  append(project.globalInteractions)
  project.surfaces.forEach((surface) => {
    if (surface.type === 'slide') surface.scenes.forEach((scene) => append(scene.interactions))
  })
}

export function mutateDuplicateSlideScene(
  project: CourseProjectDocument,
  surfaceId: string,
  sourceSceneId: string,
  now?: string,
): CourseProjectDocument {
  const duplicateId = stableId('scene')
  return commitSlideProjectMutation(project, (draft) => {
    const surface = mutableSlideSurface(draft, surfaceId)
    const sourceIndex = surface.scenes.findIndex((scene) => scene.id === sourceSceneId)
    if (sourceIndex < 0) throw new Error(`找不到 Slide 场景：${sourceSceneId}`)
    if (surface.scenes.some((scene) => scene.id === duplicateId)) {
      throw new Error(`场景 ID 已存在：${duplicateId}`)
    }
    const source = surface.scenes[sourceIndex]!
    const duplicate = duplicateSlideSceneDocument(
      draft, source,
      duplicateId,
      `${source.name} 副本`,
    )
    surface.scenes.splice(sourceIndex + 1, 0, duplicate)

    const sourceLocations = draft.locations.filter(
      (location): location is Extract<
        CourseProjectDocument['locations'][number],
        { kind: 'slide-scene' }
      > =>
        location.kind === 'slide-scene' &&
        location.surfaceId === surfaceId &&
        location.sceneId === sourceSceneId,
    )
    const stateIds = new Map((source.presentation?.states ?? []).map((state, index) => [
      state.id,
      duplicate.presentation?.states[index]?.id,
    ]))
    const locationIdMap = new Map<string, string>()
    const duplicateLocations = sourceLocations.map((location) => {
      const locationId = location.id === sourceSceneId
        ? duplicateId
        : stableId('location')
      locationIdMap.set(location.id, locationId)
      return {
        ...structuredClone(location),
        id: locationId,
        label: `${surface.title} · ${duplicate.name}`,
        sceneId: duplicateId,
        ...(location.stateId
          ? { stateId: stateIds.get(location.stateId) ?? location.stateId }
          : {}),
      }
    })
    if (duplicateLocations.length === 0) {
      duplicateLocations.push({
        id: duplicateId,
        label: `${surface.title} · ${duplicate.name}`,
        kind: 'slide-scene',
        surfaceId,
        sceneId: duplicateId,
      })
    }
    insertAfterLastSlideLocation(draft, surfaceId, duplicateLocations)
    duplicate.interactions.forEach((rule) => rule.actions.forEach(({ action }) => {
      if (action.type === 'location.go') {
        action.locationId = locationIdMap.get(action.locationId) ?? action.locationId
      }
    }))
    appendDuplicatedVisibility(draft, locationIdMap)
    appendDuplicatedSceneConditions(draft, sourceSceneId, duplicateId)
    reorderSlideLocationsForSurface(draft, surfaceId)
    const printEntry = draft.mixedPrintPlan?.entries.find(
      (entry): entry is Extract<MixedPrintEntry, { kind: 'slide-scenes' }> =>
        entry.kind === 'slide-scenes' && entry.surfaceId === surfaceId,
    )
    const printIndex = printEntry?.sceneIds.indexOf(sourceSceneId) ?? -1
    if (printEntry && printIndex >= 0) printEntry.sceneIds.splice(printIndex + 1, 0, duplicateId)
    reorderSlidePrintEntry(draft, surfaceId)
  }, now)
}

function updateTeacherControllerStateOverrides(
  scene: SlideSceneDocument,
  update: (buttons: TeacherControllerButton[]) => TeacherControllerButton[],
): void {
  const items = new Map(scene.layerItems.map((item) => [item.layerItemId, item]))
  scene.presentation?.states.forEach((state) => {
    Object.entries(state.layerItemOverrides).forEach(([layerItemId, override]) => {
      const buttons = teacherControllerOverrideButtons(items.get(layerItemId), override)
      if (buttons && override.componentProps) override.componentProps!.buttons = update(buttons)
    })
  })
}

export function mutateDeleteSlideScene(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  now?: string,
): CourseProjectDocument {
  return commitSlideProjectMutation(project, (draft) => {
    const surface = mutableSlideSurface(draft, surfaceId)
    const sceneIndex = surface.scenes.findIndex((scene) => scene.id === sceneId)
    if (sceneIndex < 0) throw new Error(`找不到 Slide 场景：${sceneId}`)
    if (surface.scenes.length <= 1) throw new Error('课件至少需要一张幻灯片')
    const removedLocations = draft.locations.filter((location) =>
      location.kind === 'slide-scene' &&
      location.surfaceId === surfaceId &&
      location.sceneId === sceneId
    )
    const deletedLocationIds = new Set(removedLocations.map((location) => location.id))
    const removedLayerItemIds = new Set(surface.scenes[sceneIndex]!.layerItems.map(
      (item) => item.layerItemId,
    ))
    surface.scenes.splice(sceneIndex, 1)
    draft.locations = draft.locations.filter((location) => !deletedLocationIds.has(location.id))
    repairRemovedCourseReferences(draft, {
      removedLocationIds: deletedLocationIds,
      removedInteractionSceneIds: new Set([sceneId]),
      removedControllerTargetIds: controllerTargetIdsForLocations(removedLocations),
      removedLayerItemIds,
    })

    if (deletedLocationIds.has(draft.startLocationId)) {
      const fallbackScene = surface.scenes[Math.max(0, sceneIndex - 1)] ?? surface.scenes[0]
      const fallback = fallbackScene && draft.locations.find((location) =>
        location.kind === 'slide-scene' &&
        location.surfaceId === surfaceId &&
        location.sceneId === fallbackScene.id &&
        location.stateId === undefined,
      )
      draft.startLocationId = fallback?.id ?? draft.locations[0]?.id ?? ''
    }
    reorderSlideLocationsForSurface(draft, surfaceId)
    const printEntry = draft.mixedPrintPlan?.entries.find(
      (entry): entry is Extract<MixedPrintEntry, { kind: 'slide-scenes' }> =>
        entry.kind === 'slide-scenes' && entry.surfaceId === surfaceId,
    )
    if (printEntry) {
      printEntry.sceneIds = printEntry.sceneIds.filter((id) => id !== sceneId)
      if (printEntry.sceneIds.length === 0) {
        const fallbackScene = surface.scenes[Math.max(0, sceneIndex - 1)] ?? surface.scenes[0]
        if (fallbackScene) printEntry.sceneIds = [fallbackScene.id]
      }
    }
  }, now)
}

export function mutateAddSlidePresentationState(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  name?: string,
  now?: string,
): CourseProjectDocument {
  const stateId = stableId('state')
  return commitSlideProjectMutation(project, (draft) => {
    const scene = findMutableSlideScene(draft, surfaceId, sceneId)
    const normalized = name === undefined ? undefined : presentationStateNameSchema.parse(name).trim().slice(0, 120)
    if (!scene.presentation) {
      scene.presentation = {
        initialStateId: stateId,
        thumbnailStateId: stateId,
        states: [{
          id: stateId,
          name: normalized || '状态 1',
          layerItemOverrides: {},
        }],
      }
      return
    }
    if (scene.presentation.states.some((state) => state.id === stateId)) {
      throw new Error(`命名状态 ID 已存在：${stateId}`)
    }
    scene.presentation.states.push({
      id: stateId,
      name: normalized || `状态 ${scene.presentation.states.length + 1}`,
      layerItemOverrides: {},
    })
  }, now)
}

export function mutateDuplicateSlidePresentationState(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  stateId: string,
  now?: string,
): CourseProjectDocument {
  const duplicateId = stableId('state')
  return commitSlideProjectMutation(project, (draft) => {
    const scene = findMutableSlideScene(draft, surfaceId, sceneId)
    const presentation = scene.presentation
    const sourceIndex = presentation?.states.findIndex((state) => state.id === stateId) ?? -1
    if (!presentation || sourceIndex < 0) throw new Error(`找不到命名状态：${stateId}`)
    if (presentation.states.some((state) => state.id === duplicateId)) {
      throw new Error(`命名状态 ID 已存在：${duplicateId}`)
    }
    const source = presentation.states[sourceIndex]!
    presentation.states.splice(sourceIndex + 1, 0, {
      ...structuredClone(source),
      id: duplicateId,
      name: `${source.name} 副本`,
    })
    scene.interactions.forEach((rule) => {
      rule.conditions.forEach((condition) => {
        if (
          condition.type === 'presentation.in' &&
          condition.stateIds.includes(stateId) &&
          !condition.stateIds.includes(duplicateId)
        ) {
          condition.stateIds.push(duplicateId)
        }
      })
    })
  }, now)
}

export function mutateRenameSlidePresentationState(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  stateId: string,
  name: string,
  now?: string,
): CourseProjectDocument {
  const normalized = presentationStateNameSchema.parse(name).trim().slice(0, 120)
  const current = findMutableSlideScene(project, surfaceId, sceneId).presentation?.states.find(state => state.id === stateId)
  if (!current) throw new Error('当前命名状态已失效')
  if (!normalized || normalized === current.name) return project
  return commitSlideProjectMutation(project, (draft) => {
    const scene = findMutableSlideScene(draft, surfaceId, sceneId)
    const state = scene.presentation?.states.find((candidate) => candidate.id === stateId)
    if (!state) throw new Error(`找不到命名状态：${stateId}`)
    state.name = normalized
  }, now)
}

export function mutateReorderSlidePresentationStates(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  stateIds: readonly string[],
  now?: string,
): CourseProjectDocument {
  return commitSlideProjectMutation(project, (draft) => {
    const scene = findMutableSlideScene(draft, surfaceId, sceneId)
    const presentation = scene.presentation
    if (!presentation) throw new Error('当前幻灯片没有命名状态')
    if (
      stateIds.length !== presentation.states.length ||
      new Set(stateIds).size !== stateIds.length ||
      stateIds.some((id) => !presentation.states.some((state) => state.id === id))
    ) {
      throw new Error('状态排序必须且只能包含该场景的全部命名状态')
    }
    const byId = new Map(presentation.states.map((state) => [state.id, state]))
    presentation.states = stateIds.map((id) => byId.get(id)!)
  }, now)
}

function removePresentationStateReferences(
  interactions: InteractionRule[],
  stateId: string,
): InteractionRule[] {
  const removedActionIds = new Set<string>()
  let remaining = interactions.flatMap((rule) => {
    if (rule.trigger.type === 'presentation.enter' && rule.trigger.stateId === stateId) {
      rule.actions.forEach((step) => removedActionIds.add(step.id))
      return []
    }
    let valid = true
    rule.conditions = rule.conditions.filter((condition) => {
      if (condition.type !== 'presentation.in') return true
      condition.stateIds = condition.stateIds.filter((id) => id !== stateId)
      if (condition.stateIds.length === 0) valid = false
      return condition.stateIds.length > 0
    })
    if (!valid) {
      rule.actions.forEach((step) => removedActionIds.add(step.id))
      return []
    }
    rule.actions = rule.actions.filter((step) => {
      const remove = step.action.type === 'presentation.set' && step.action.stateId === stateId
      if (remove) removedActionIds.add(step.id)
      return !remove
    })
    if (rule.actions.length === 0) return []
    rule.actions[0]!.start = 'after-previous'
    return [rule]
  })
  let removed = true
  while (removed) {
    removed = false
    remaining = remaining.filter((rule) => {
      if (
        rule.trigger.type !== 'animation.completed' ||
        !removedActionIds.has(rule.trigger.actionId)
      ) {
        return true
      }
      rule.actions.forEach((step) => removedActionIds.add(step.id))
      removed = true
      return false
    })
  }
  return remaining
}

function clearSceneGoTargetStateButtonList(
  buttons: TeacherControllerButton[],
  sceneId: string,
  stateId: string,
): TeacherControllerButton[] {
  return buttons.map((button) => {
    if (
      button.action.type !== 'scene.go' ||
      button.action.sceneId !== sceneId ||
      button.action.targetStateId !== stateId
    ) {
      return button
    }
    const { targetStateId: _removed, ...action } = button.action
    return { ...button, action }
  })
}

function clearSceneGoTargetState(
  project: CourseProjectDocument,
  sceneId: string,
  stateId: string,
): void {
  const clearIn = (interactions: InteractionRule[]) => {
    interactions.forEach((rule) => {
      rule.actions.forEach((step) => {
        const action = step.action
        if (
          action.type === 'scene.go' &&
          action.sceneId === sceneId &&
          action.targetStateId === stateId
        ) {
          delete action.targetStateId
        }
      })
    })
  }
  clearIn(project.globalInteractions)
  project.surfaces.forEach((surface) => {
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        clearIn(scene.interactions)
        updateTeacherControllerStateOverrides(
          scene,
          (buttons) => clearSceneGoTargetStateButtonList(buttons, sceneId, stateId),
        )
      })
    }
  })
  const visit = (item: LayerItem) => {
    if (item.kind !== 'component' || item.role !== 'teacher-controller' || !Array.isArray(item.props.buttons)) return
    item.props.buttons = clearSceneGoTargetStateButtonList(
      item.props.buttons as TeacherControllerButton[],
      sceneId,
      stateId,
    )
  }
  project.globalLayerItems.forEach((entry) => visit(entry.item))
  project.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach((entry) => visit(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(visit))
    }
  })
}

export function mutateDeleteSlidePresentationState(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  stateId: string,
  now?: string,
): CourseProjectDocument {
  return commitSlideProjectMutation(project, (draft) => {
    const scene = findMutableSlideScene(draft, surfaceId, sceneId)
    const presentation = scene.presentation
    if (!presentation) throw new Error(`找不到命名状态：${stateId}`)
    const index = presentation.states.findIndex((candidate) => candidate.id === stateId)
    if (index < 0) throw new Error(`找不到命名状态：${stateId}`)
    if (presentation.states.length <= 1) throw new Error('幻灯片至少需要一个命名状态')
    const fallback = presentation.states.find((candidate) => candidate.id !== stateId)!
    presentation.states.splice(index, 1)
    if (presentation.initialStateId === stateId) {
      presentation.initialStateId = fallback.id
    }
    if (presentation.thumbnailStateId === stateId) {
      presentation.thumbnailStateId = presentation.initialStateId
    }
    draft.locations.forEach((location) => {
      if (
        location.kind === 'slide-scene' &&
        location.surfaceId === surfaceId &&
        location.sceneId === sceneId &&
        location.stateId === stateId
      ) {
        delete location.stateId
        location.label = `${mutableSlideSurface(draft, surfaceId).title} · ${scene.name}`
      }
    })
    scene.interactions = removePresentationStateReferences(scene.interactions, stateId)
    clearSceneGoTargetState(draft, sceneId, stateId)
  }, now)
}
