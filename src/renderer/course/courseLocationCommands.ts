import { nanoid } from 'nanoid'
import { DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR } from '../../shared/courseProjectModel'
import type {
  CourseLocation,
  CourseProjectDocument,
  MixedPrintEntry,
  MixedPrintPlan,
  SlideSceneDocument,
  SlideSurfaceDocument,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import { createBlankFlowSurface } from './flowDocumentModel'
import {
  controllerTargetIdsForLocations,
  repairRemovedCourseReferences,
} from './courseReferenceCleanup'
import {
  LAYER_REJECT_STALE_REVISION,
  rejectIfStaleDocument,
} from './globalLayerCommands'
import { commitSlideProjectMutation } from './slideEditorCommands'

export const COURSE_LAST_LOCATION_REASON = '不能删除最后一个课程位置'

/** Outline order is course order: the first location is always the start. */
export function syncStartLocationToFirstLocation(draft: CourseProjectDocument): void {
  const first = draft.locations[0]
  if (first) draft.startLocationId = first.id
}

export type CourseLocationCommandResult =
  | { ok: true; project: CourseProjectDocument; activatedLocationId: string }
  | { ok: false; reason: string; project: CourseProjectDocument }

export interface CourseLocationCommandOptions {
  readonly expectedRevision?: number
  readonly now?: string
}

function stableId(prefix: string, preferred?: string): string {
  return preferred ?? `${prefix}-${nanoid(10)}`
}

function fail(
  reason: string,
  project: CourseProjectDocument,
): CourseLocationCommandResult {
  return { ok: false, reason, project }
}

function succeed(
  project: CourseProjectDocument,
  activatedLocationId: string,
): CourseLocationCommandResult {
  return { ok: true, project, activatedLocationId }
}

function runMutation(
  project: CourseProjectDocument,
  mutate: (draft: CourseProjectDocument) => string,
  options: CourseLocationCommandOptions = {},
): CourseLocationCommandResult {
  const stale = rejectIfStaleDocument(project, options.expectedRevision)
  if (stale) return fail(stale.reason ?? LAYER_REJECT_STALE_REVISION, project)
  try {
    let activatedLocationId = ''
    const next = commitSlideProjectMutation(project, (draft) => {
      activatedLocationId = mutate(draft)
    }, options.now)
    return succeed(next, activatedLocationId)
  } catch (error) {
    const reason = error instanceof Error && error.message.trim()
      ? error.message
      : '命令失败'
    return fail(reason, project)
  }
}

function defaultMixedPrintPlan(): MixedPrintPlan {
  return { pageSize: 'A4', orientation: 'auto', entries: [] }
}

function buildPrintEntryForSurface(
  surface: CourseProjectDocument['surfaces'][number],
  entryId?: string,
): MixedPrintEntry {
  if (surface.type === 'slide') {
    return {
      id: entryId ?? stableId('print'),
      kind: 'slide-scenes',
      surfaceId: surface.id,
      sceneIds: surface.scenes.map((scene) => scene.id),
    }
  }
  if (surface.type === 'flow') {
    return {
      id: entryId ?? stableId('print'),
      kind: 'flow-document',
      surfaceId: surface.id,
    }
  }
  return {
    id: entryId ?? stableId('print'),
    kind: 'spatial-frames',
    surfaceId: surface.id,
    cameraFrameIds: surface.camera.frames.map((frame) => frame.id),
  }
}

function syncMixedPrintPlan(draft: CourseProjectDocument): void {
  if (draft.surfaces.length <= 1) {
    delete draft.mixedPrintPlan
    return
  }
  const existingBySurface = new Map(
    (draft.mixedPrintPlan?.entries ?? []).map((entry) => [entry.surfaceId, entry]),
  )
  draft.mixedPrintPlan = draft.mixedPrintPlan ?? defaultMixedPrintPlan()
  draft.mixedPrintPlan.entries = draft.surfaces.map((surface) => {
    const previous = existingBySurface.get(surface.id)
    if (previous) {
      if (previous.kind === 'slide-scenes' && surface.type === 'slide') {
        return {
          ...previous,
          sceneIds: surface.scenes.map((scene) => scene.id),
        }
      }
      if (previous.kind === 'spatial-frames' && surface.type === 'spatial-2d') {
        return {
          ...previous,
          cameraFrameIds: surface.camera.frames.map((frame) => frame.id),
        }
      }
      return previous
    }
    return buildPrintEntryForSurface(surface)
  })
}

function initialSlidePresentation(): NonNullable<SlideSceneDocument['presentation']> {
  return {
    initialStateId: 'state_initial',
    thumbnailStateId: 'state_initial',
    states: [{ id: 'state_initial', name: '初始', layerItemOverrides: {} }],
  }
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

function requireLocation(project: CourseProjectDocument, locationId: string): CourseLocation {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  return location
}

function appendFlowPageInDraft(
  draft: CourseProjectDocument,
  title: string,
): { locationId: string; surfaceId: string } {
  const created = createBlankFlowSurface({
    id: `surface-flow-${nanoid(10)}`,
    title,
  })
  draft.surfaces.push(created.surface)
  draft.locations.push(created.location)
  syncMixedPrintPlan(draft)
  return { locationId: created.location.id, surfaceId: created.surface.id }
}

function mutateAddSlideScene(
  draft: CourseProjectDocument,
  surfaceId: string,
  options: { title?: string } = {},
): string {
  const surface = mutableSlideSurface(draft, surfaceId)
  const sceneId = stableId('scene')
  if (surface.scenes.some((scene) => scene.id === sceneId)) {
    throw new Error(`场景 ID 已存在：${sceneId}`)
  }
  const scene: SlideSceneDocument = {
    id: sceneId,
    name: options.title ?? `第 ${surface.scenes.length + 1} 幕`,
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
  return sceneId
}

function createBlankSlideSurface(input: {
  id: string
  title: string
  sceneId?: string
}): {
  surface: SlideSurfaceDocument
  location: Extract<CourseLocation, { kind: 'slide-scene' }>
  sceneId: string
} {
  const sceneId = input.sceneId ?? stableId('scene')
  const scene: SlideSceneDocument = {
    id: sceneId,
    name: '第 1 幕',
    backgroundColor: '#ffffff',
    layerItems: [],
    presentation: initialSlidePresentation(),
    interactions: [],
  }
  const surface: SlideSurfaceDocument = {
    id: input.id,
    title: input.title,
    type: 'slide',
    canvas: { width: 1280, height: 720 },
    surfaceLayerItems: [],
    scenes: [scene],
  }
  return {
    surface,
    sceneId,
    location: {
      id: sceneId,
      label: `${input.title} · ${scene.name}`,
      kind: 'slide-scene',
      surfaceId: input.id,
      sceneId,
    },
  }
}

function createAppendSpatialSurface(input: {
  id: string
  title: string
  frameId?: string
}): {
  surface: SpatialSurfaceDocument
  location: Extract<CourseLocation, { kind: 'spatial-camera' }>
  frameId: string
} {
  const frameId = input.frameId ?? stableId('camera')
  const pose = { x: 0, y: 0, zoom: 1 }
  const surface: SpatialSurfaceDocument = {
    id: input.id,
    title: input.title,
    type: 'spatial-2d',
    backgroundColor: DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR,
    surfaceLayerItems: [],
    world: {
      bounds: { mode: 'infinite' },
      layerItems: [],
      paths: [],
      relations: [],
    },
    camera: {
      home: pose,
      frames: [{ id: frameId, name: '全景', ...pose }],
    },
    semanticZoom: [],
  }
  return {
    surface,
    frameId,
    location: {
      id: frameId,
      label: `${input.title} · 全景`,
      kind: 'spatial-camera',
      surfaceId: input.id,
      cameraFrameId: frameId,
    },
  }
}

function deleteSurfaceFromDraft(
  draft: CourseProjectDocument,
  surfaceId: string,
  preferredLocationId?: string,
): string {
  const removedSurface = draft.surfaces.find((surface) => surface.id === surfaceId)
  if (!removedSurface) throw new Error(`找不到课程页面：${surfaceId}`)
  const removedLocations = draft.locations.filter((location) => location.surfaceId === surfaceId)
  const removedLocationIds = new Set(removedLocations.map((location) => location.id))
  const removedLayerItemIds = new Set(
    removedSurface.surfaceLayerItems.map((entry) => entry.item.layerItemId),
  )
  if (removedSurface.type === 'slide') {
    removedSurface.scenes.forEach((scene) => (
      scene.layerItems.forEach((item) => removedLayerItemIds.add(item.layerItemId))
    ))
  } else if (removedSurface.type === 'spatial-2d') {
    removedSurface.world.layerItems.forEach((item) => removedLayerItemIds.add(item.layerItemId))
  }
  draft.surfaces = draft.surfaces.filter((surface) => surface.id !== surfaceId)
  draft.locations = draft.locations.filter((location) => !removedLocationIds.has(location.id))
  repairRemovedCourseReferences(draft, {
    removedLocationIds,
    ...(removedSurface.type === 'slide'
      ? { removedInteractionSceneIds: new Set(removedSurface.scenes.map((scene) => scene.id)) }
      : {}),
    removedControllerTargetIds: controllerTargetIdsForLocations(removedLocations),
    removedLayerItemIds,
  })
  if (draft.mixedPrintPlan) {
    draft.mixedPrintPlan.entries = draft.mixedPrintPlan.entries.filter(
      (entry) => entry.surfaceId !== surfaceId,
    )
  }
  syncMixedPrintPlan(draft)
  if (preferredLocationId && draft.locations.some((location) => location.id === preferredLocationId)) {
    return preferredLocationId
  }
  if (draft.locations.some((location) => location.id === draft.startLocationId)) {
    return draft.startLocationId
  }
  draft.startLocationId = draft.locations[0]?.id ?? ''
  return draft.startLocationId
}

function deleteSlideSceneFromDraft(
  draft: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  preferredLocationId?: string,
): string {
  const surface = mutableSlideSurface(draft, surfaceId)
  if (surface.scenes.length <= 1) {
    if (draft.locations.length <= 1) throw new Error(COURSE_LAST_LOCATION_REASON)
    return deleteSurfaceFromDraft(draft, surfaceId, preferredLocationId)
  }
  const sceneIndex = surface.scenes.findIndex((scene) => scene.id === sceneId)
  if (sceneIndex < 0) throw new Error(`找不到 Slide 场景：${sceneId}`)
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
  if (preferredLocationId && draft.locations.some((location) => location.id === preferredLocationId)) {
    return preferredLocationId
  }
  return draft.startLocationId
}

function deleteSpatialCameraFromDraft(
  draft: CourseProjectDocument,
  surfaceId: string,
  frameId: string,
  preferredLocationId?: string,
): string {
  const surface = draft.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'spatial-2d') {
    throw new Error(`找不到 Spatial 表面：${surfaceId}`)
  }
  if (surface.camera.frames.length <= 1) {
    if (draft.locations.length <= 1) throw new Error(COURSE_LAST_LOCATION_REASON)
    return deleteSurfaceFromDraft(draft, surfaceId, preferredLocationId)
  }
  const frameIndex = surface.camera.frames.findIndex((frame) => frame.id === frameId)
  if (frameIndex < 0) throw new Error('找不到镜头画面，请刷新后重试')
  surface.camera.frames.splice(frameIndex, 1)
  const removedLocations = draft.locations.filter((location) =>
    location.kind === 'spatial-camera' &&
    location.surfaceId === surfaceId &&
    location.cameraFrameId === frameId
  )
  const removedLocationIds = new Set(removedLocations.map((location) => location.id))
  draft.locations = draft.locations.filter((location) => !removedLocationIds.has(location.id))
  repairRemovedCourseReferences(draft, {
    removedLocationIds,
    removedControllerTargetIds: controllerTargetIdsForLocations(removedLocations),
  })
  if (removedLocationIds.has(draft.startLocationId)) {
    draft.startLocationId = draft.locations.find((location) =>
      location.kind === 'spatial-camera' && location.surfaceId === surfaceId,
    )?.id ?? draft.locations[0]?.id ?? ''
  }
  const printEntry = draft.mixedPrintPlan?.entries.find((entry) =>
    entry.kind === 'spatial-frames' && entry.surfaceId === surfaceId,
  )
  if (printEntry?.kind === 'spatial-frames') {
    printEntry.cameraFrameIds = printEntry.cameraFrameIds.filter((id) => id !== frameId)
    if (printEntry.cameraFrameIds.length === 0) {
      printEntry.cameraFrameIds = [surface.camera.frames[0]!.id]
    }
  }
  if (preferredLocationId && draft.locations.some((location) => location.id === preferredLocationId)) {
    return preferredLocationId
  }
  return draft.startLocationId
}

export function addCourseScene(
  project: CourseProjectDocument,
  input: { surfaceId: string; title?: string } & CourseLocationCommandOptions,
): CourseLocationCommandResult {
  return runMutation(project, (draft) => {
    const sceneId = mutateAddSlideScene(draft, input.surfaceId, { title: input.title })
    const location = draft.locations.find((candidate) =>
      candidate.kind === 'slide-scene' &&
      candidate.surfaceId === input.surfaceId &&
      candidate.sceneId === sceneId &&
      candidate.stateId === undefined,
    )
    return location?.id ?? sceneId
  }, input)
}

export function addCourseSlidePage(
  project: CourseProjectDocument,
  input: { title?: string } & CourseLocationCommandOptions = {},
): CourseLocationCommandResult {
  const title = input.title ?? '演示页面'
  return runMutation(project, (draft) => {
    const created = createBlankSlideSurface({
      id: stableId('surface-slide'),
      title,
    })
    draft.surfaces.push(created.surface)
    draft.locations.push(created.location)
    syncMixedPrintPlan(draft)
    return created.location.id
  }, input)
}

export function addCourseFlowPage(
  project: CourseProjectDocument,
  input: { title?: string } & CourseLocationCommandOptions = {},
): CourseLocationCommandResult {
  const title = input.title ?? '流式讲义'
  return runMutation(project, (draft) => {
    return appendFlowPageInDraft(draft, title).locationId
  }, input)
}

export function addCourseSpatialPage(
  project: CourseProjectDocument,
  input: { title?: string } & CourseLocationCommandOptions = {},
): CourseLocationCommandResult {
  const title = input.title ?? '无限画布'
  return runMutation(project, (draft) => {
    const created = createAppendSpatialSurface({
      id: stableId('surface-spatial'),
      title,
    })
    draft.surfaces.push(created.surface)
    draft.locations.push(created.location)
    syncMixedPrintPlan(draft)
    return created.location.id
  }, input)
}

export function deleteCourseLocation(
  project: CourseProjectDocument,
  locationId: string,
  input: CourseLocationCommandOptions & { activeLocationId?: string } = {},
): CourseLocationCommandResult {
  if (project.locations.length <= 1) {
    return fail(COURSE_LAST_LOCATION_REASON, project)
  }
  const location = requireLocation(project, locationId)
  const siblings = project.locations.filter((candidate) => candidate.surfaceId === location.surfaceId)
  return runMutation(project, (draft) => {
    if (siblings.length <= 1) {
      return deleteSurfaceFromDraft(draft, location.surfaceId, input.activeLocationId)
    }
    if (location.kind === 'slide-scene') {
      return deleteSlideSceneFromDraft(
        draft,
        location.surfaceId,
        location.sceneId,
        input.activeLocationId,
      )
    }
    if (location.kind === 'flow-block') {
      throw new Error('请通过 Flow 编辑器删除本页内的标题块')
    }
    return deleteSpatialCameraFromDraft(
      draft,
      location.surfaceId,
      location.cameraFrameId,
      input.activeLocationId,
    )
  }, input)
}

export function deleteCourseSurface(
  project: CourseProjectDocument,
  surfaceId: string,
  input: CourseLocationCommandOptions & { activeLocationId?: string } = {},
): CourseLocationCommandResult {
  const surfaceLocations = project.locations.filter((location) => location.surfaceId === surfaceId)
  if (surfaceLocations.length >= project.locations.length) {
    return fail(COURSE_LAST_LOCATION_REASON, project)
  }
  return runMutation(project, (draft) => (
    deleteSurfaceFromDraft(draft, surfaceId, input.activeLocationId)
  ), input)
}

export function duplicateCourseLocation(
  project: CourseProjectDocument,
  locationId: string,
  input: CourseLocationCommandOptions = {},
): CourseLocationCommandResult {
  const location = requireLocation(project, locationId)
  if (location.kind !== 'slide-scene') {
    return fail('当前仅支持复制 Slide 场景位置', project)
  }
  return runMutation(project, (draft) => {
    const surface = mutableSlideSurface(draft, location.surfaceId)
    const source = surface.scenes.find((scene) => scene.id === location.sceneId)
    if (!source) throw new Error(`找不到 Slide 场景：${location.sceneId}`)
    const duplicateId = stableId('scene')
    const duplicate: SlideSceneDocument = {
      ...structuredClone(source),
      id: duplicateId,
      name: `${source.name} 副本`,
    }
    const sourceIndex = surface.scenes.findIndex((scene) => scene.id === location.sceneId)
    surface.scenes.splice(sourceIndex + 1, 0, duplicate)
    insertAfterLastSlideLocation(draft, location.surfaceId, [{
      id: duplicateId,
      label: `${surface.title} · ${duplicate.name}`,
      kind: 'slide-scene',
      surfaceId: location.surfaceId,
      sceneId: duplicateId,
    }])
    reorderSlideLocationsForSurface(draft, location.surfaceId)
    const printEntry = draft.mixedPrintPlan?.entries.find(
      (entry): entry is Extract<MixedPrintEntry, { kind: 'slide-scenes' }> =>
        entry.kind === 'slide-scenes' && entry.surfaceId === location.surfaceId,
    )
    const printIndex = printEntry?.sceneIds.indexOf(location.sceneId) ?? -1
    if (printEntry && printIndex >= 0) printEntry.sceneIds.splice(printIndex + 1, 0, duplicateId)
    reorderSlidePrintEntry(draft, location.surfaceId)
    return duplicateId
  }, input)
}

export function renameCourseLocation(
  project: CourseProjectDocument,
  locationId: string,
  label: string,
  input: CourseLocationCommandOptions = {},
): CourseLocationCommandResult {
  const trimmed = label.trim()
  if (!trimmed) return fail('名称不能为空', project)
  requireLocation(project, locationId)
  return runMutation(project, (draft) => {
    const target = requireLocation(draft, locationId)
    if (target.kind === 'slide-scene' && target.stateId === undefined) {
      const surface = mutableSlideSurface(draft, target.surfaceId)
      const scene = surface.scenes.find((candidate) => candidate.id === target.sceneId)
      if (!scene) throw new Error(`找不到 Slide 场景：${target.sceneId}`)
      scene.name = trimmed
      target.label = `${surface.title} · ${trimmed}`
      draft.locations.forEach((candidate) => {
        if (
          candidate.kind === 'slide-scene' &&
          candidate.surfaceId === target.surfaceId &&
          candidate.sceneId === target.sceneId &&
          candidate.stateId === undefined
        ) {
          candidate.label = target.label
        }
      })
      return target.id
    }
    if (target.kind === 'spatial-camera') {
      const surface = draft.surfaces.find((candidate) => candidate.id === target.surfaceId)
      if (!surface || surface.type !== 'spatial-2d') {
        throw new Error(`找不到 Spatial 表面：${target.surfaceId}`)
      }
      const frame = surface.camera.frames.find((candidate) => candidate.id === target.cameraFrameId)
      if (!frame) throw new Error('找不到镜头画面，请刷新后重试')
      frame.name = trimmed
      target.label = `${surface.title} · ${trimmed}`
      return target.id
    }
    target.label = trimmed
    return target.id
  }, input)
}

function regroupLocationsBySurfaces(draft: CourseProjectDocument): void {
  const grouped = new Map<string, CourseLocation[]>()
  draft.locations.forEach((location) => {
    const entries = grouped.get(location.surfaceId) ?? []
    entries.push(location)
    grouped.set(location.surfaceId, entries)
  })
  draft.locations = draft.surfaces.flatMap((surface) => grouped.get(surface.id) ?? [])
}

function mutateMoveSlideScene(
  draft: CourseProjectDocument,
  locationId: string,
  targetSurfaceId: string,
  toIndex?: number,
): string {
  const location = requireLocation(draft, locationId)
  if (location.kind !== 'slide-scene') {
    throw new Error('只能移动演示场景')
  }
  const sourceSurfaceId = location.surfaceId
  if (sourceSurfaceId === targetSurfaceId) {
    throw new Error('场景已在该演示页面中')
  }
  const source = mutableSlideSurface(draft, sourceSurfaceId)
  const target = mutableSlideSurface(draft, targetSurfaceId)
  const sceneIndex = source.scenes.findIndex((scene) => scene.id === location.sceneId)
  if (sceneIndex < 0) throw new Error(`找不到 Slide 场景：${location.sceneId}`)
  if (target.scenes.some((scene) => scene.id === location.sceneId)) {
    throw new Error('目标页面已有该场景')
  }
  const [scene] = source.scenes.splice(sceneIndex, 1)
  if (!scene) throw new Error(`找不到 Slide 场景：${location.sceneId}`)
  const insertAt = Math.max(0, Math.min(toIndex ?? target.scenes.length, target.scenes.length))
  target.scenes.splice(insertAt, 0, scene)
  draft.locations.forEach((candidate) => {
    if (
      candidate.kind !== 'slide-scene' ||
      candidate.sceneId !== scene.id ||
      candidate.surfaceId !== sourceSurfaceId
    ) {
      return
    }
    candidate.surfaceId = targetSurfaceId
    candidate.label = `${target.title} · ${scene.name}`
  })
  if (source.scenes.length === 0) {
    deleteSurfaceFromDraft(draft, sourceSurfaceId, location.id)
  }
  regroupLocationsBySurfaces(draft)
  if (draft.surfaces.some((surface) => surface.id === sourceSurfaceId)) {
    reorderSlideLocationsForSurface(draft, sourceSurfaceId)
  }
  reorderSlideLocationsForSurface(draft, targetSurfaceId)
  syncMixedPrintPlan(draft)
  syncStartLocationToFirstLocation(draft)
  return location.id
}

export function moveCourseSlideScene(
  project: CourseProjectDocument,
  locationId: string,
  targetSurfaceId: string,
  input: CourseLocationCommandOptions & {
    toIndex?: number
    activeLocationId?: string
  } = {},
): CourseLocationCommandResult {
  let location: CourseLocation
  try {
    location = requireLocation(project, locationId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : '找不到课程位置', project)
  }
  if (location.kind !== 'slide-scene') {
    return fail('只能移动演示场景', project)
  }
  const target = project.surfaces.find((candidate) => candidate.id === targetSurfaceId)
  if (!target || target.type !== 'slide') {
    return fail('只能把演示场景移到另一演示页面', project)
  }
  if (location.surfaceId === targetSurfaceId) {
    return fail('场景已在该演示页面中', project)
  }
  return runMutation(project, (draft) => (
    mutateMoveSlideScene(draft, locationId, targetSurfaceId, input.toIndex)
  ), input)
}

export function reorderCourseSurfaces(
  project: CourseProjectDocument,
  surfaceIds: readonly string[],
  input: CourseLocationCommandOptions & { activeLocationId?: string } = {},
): CourseLocationCommandResult {
  if (surfaceIds.length !== project.surfaces.length) {
    return fail('页面排序必须包含全部页面', project)
  }
  if (new Set(surfaceIds).size !== surfaceIds.length) {
    return fail('页面排序不能包含重复项', project)
  }
  if (surfaceIds.some((surfaceId) => !project.surfaces.some((surface) => surface.id === surfaceId))) {
    return fail('页面排序包含未知页面', project)
  }
  return runMutation(project, (draft) => {
    const byId = new Map(draft.surfaces.map((surface) => [surface.id, surface]))
    draft.surfaces = surfaceIds.map((surfaceId) => byId.get(surfaceId)!)
    const grouped = new Map<string, CourseLocation[]>()
    draft.locations.forEach((location) => {
      const entries = grouped.get(location.surfaceId) ?? []
      entries.push(location)
      grouped.set(location.surfaceId, entries)
    })
    draft.locations = surfaceIds.flatMap((surfaceId) => grouped.get(surfaceId) ?? [])
    if (draft.mixedPrintPlan) {
      const printBySurface = new Map(
        draft.mixedPrintPlan.entries.map((entry) => [entry.surfaceId, entry]),
      )
      draft.mixedPrintPlan.entries = surfaceIds.flatMap((surfaceId) => {
        const entry = printBySurface.get(surfaceId)
        return entry ? [entry] : []
      })
    }
    syncStartLocationToFirstLocation(draft)
    if (input.activeLocationId && draft.locations.some((candidate) => candidate.id === input.activeLocationId)) {
      return input.activeLocationId
    }
    return draft.startLocationId
  }, input)
}
