import { nanoid } from 'nanoid'
import { makeAuthoringAddress, type AuthoringCarrier } from '../../shared/authoringAddress'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  LayerItemOverride,
  MixedPrintEntry,
  ScopedLayerItem,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import type { InteractionRule } from '../../shared/interactionTypes'
import type { TeacherControllerButton } from '../../shared/projectTypes'
import {
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  commitSlideAuthoringHistory,
  commitSlideProjectMutation,
  createSlideAuthoringHistory,
  redoSlideAuthoringHistory,
  selectSlideEditorLayers,
  slideAuthoringRedoResourceTransition,
  slideAuthoringUndoResourceTransition,
  transformSelectedSlideNativeLayers,
  undoSlideAuthoringHistory,
  SlideCommandError,
  type SlideAuthoringHistory,
  type SlideAuthoringSelection,
  type SlideAuthoringSessionRef,
  type SlideAuthoringResourceTransition,
  type SlideAuthoringTarget,
  type SlideCommandOptions,
  type SlideCommandResult,
  type SlideEditorTransformInput,
} from './slideEditorCommands'
import {
  buildSlideEditorView,
  type SlideEditorLayerScope,
  type SlideEditorLayerView,
} from './slideEditorView'
import {
  COURSE_LAST_LOCATION_REASON,
  deleteCourseLocation,
  syncStartLocationToFirstLocation,
} from './courseLocationCommands'
import {
  controllerTargetIdsForLocations,
  repairRemovedCourseReferences,
} from './courseReferenceCleanup'

export type {
  SlideAuthoringHistory,
  SlideAuthoringSelection,
  SlideAuthoringTarget,
  SlideCommandOptions,
  SlideCommandResult,
} from './slideEditorCommands'
export {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  selectSlideEditorLayers,
  transformSelectedSlideNativeLayers,
} from './slideEditorCommands'
export {
  buildSlideEditorView,
  type SlideEditorLayerScope,
  type SlideEditorView,
} from './slideEditorView'

export type SlideAuthoringSession = SlideAuthoringSessionRef

export interface SlideAuthoringSnapshot {
  readonly sessionId: string
  readonly locationId: string
  readonly surfaceId: string
  readonly sceneId: string
  readonly stateId: string | null
  readonly scope: SlideEditorLayerScope
  readonly selection: SlideAuthoringSelection
  readonly revision: number
}

const authoringGenerations = new Map<string, number>()

export function slideAuthoringGeneration(sessionId: string): number {
  return authoringGenerations.get(sessionId) ?? 0
}

function freezeSelection(selection: SlideAuthoringSelection): SlideAuthoringSelection {
  return Object.freeze({
    locationId: selection.locationId,
    stateId: selection.stateId,
    selectionIds: Object.freeze([...selection.selectionIds]),
  })
}

function freezeHistory(history: SlideAuthoringHistory): SlideAuthoringHistory {
  if (Object.isFrozen(history) && Object.isFrozen(history.past) && Object.isFrozen(history.future)) {
    return history
  }
  return Object.freeze({
    present: history.present,
    past: Object.freeze([...history.past]),
    future: Object.freeze([...history.future]),
  })
}

function freezeSession(session: SlideAuthoringSession): SlideAuthoringSession {
  return Object.freeze({
    sessionId: session.sessionId,
    history: freezeHistory(session.history),
    selection: freezeSelection(session.selection),
    scope: session.scope,
    generation: session.generation,
  })
}

function succeed(
  next: SlideAuthoringSession,
  historyEntry: boolean,
  resourceTransition?: SlideAuthoringResourceTransition,
): SlideCommandResult {
  const session = freezeSession(next)
  return {
    ok: true,
    nextSession: session,
    historyEntry,
    selection: session.selection,
    ...(resourceTransition ? { resourceTransition } : {}),
  }
}

function reject(session: SlideAuthoringSession, reason: string): SlideCommandResult {
  const current = freezeSession(session)
  return {
    ok: false,
    reason,
    nextSession: current,
    historyEntry: false,
    selection: current.selection,
  }
}

function rejectIfStale(
  session: SlideAuthoringSession,
  expectedRevision?: number,
): SlideCommandResult | null {
  if (
    expectedRevision !== undefined &&
    expectedRevision !== session.history.present.revision
  ) {
    return reject(session, SLIDE_REJECT_STALE_REVISION)
  }
  return null
}

function catchCommand(session: SlideAuthoringSession, error: unknown): SlideCommandResult {
  if (error instanceof SlideCommandError) return reject(session, error.reason)
  if (error instanceof Error) return reject(session, error.message)
  return reject(session, '命令失败')
}

function bumpGeneration(session: SlideAuthoringSession): number {
  const generation = session.generation + 1
  authoringGenerations.set(session.sessionId, generation)
  return generation
}

function firstSlideLocation(
  project: CourseProjectDocument,
  preferredId?: string,
) {
  if (preferredId) {
    const preferred = project.locations.find((candidate) => candidate.id === preferredId)
    if (preferred?.kind === 'slide-scene') return preferred
  }
  const start = project.locations.find((candidate) => candidate.id === project.startLocationId)
  if (start?.kind === 'slide-scene') return start
  return project.locations.find((candidate) => candidate.kind === 'slide-scene')
}

export function openSlideAuthoringSession(
  project: CourseProjectDocument,
  options: { locationId?: string; sessionId?: string } = {},
): SlideAuthoringSession {
  const parsed = courseProjectDocumentSchema.parse(structuredClone(project))
  const location = firstSlideLocation(parsed, options.locationId)
  if (!location || location.kind !== 'slide-scene') {
    throw new Error('找不到 Slide 场景位置')
  }
  const selection = selectSlideEditorLayers({
    project: parsed,
    locationId: location.id,
    stateId: location.stateId ?? null,
    selectionIds: [],
  })
  const sessionId = options.sessionId ?? `slide-session-${nanoid(10)}`
  authoringGenerations.set(sessionId, 0)
  return freezeSession({
    sessionId,
    history: createSlideAuthoringHistory(parsed),
    selection,
    scope: 'scene',
    generation: 0,
  })
}

export function buildSlideAuthoringSnapshot(
  session: SlideAuthoringSession,
): SlideAuthoringSnapshot {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  return Object.freeze({
    sessionId: session.sessionId,
    locationId: view.locationId,
    surfaceId: view.surfaceId,
    sceneId: view.sceneId,
    stateId: view.presentation?.activeStateId ?? session.selection.stateId,
    scope: session.scope,
    selection: freezeSelection(session.selection),
    revision: view.revision,
  })
}

function slideLayerCarrier(item: LayerItem): AuthoringCarrier {
  if (item.kind === 'runtime') return 'runtime'
  if (item.kind === 'component') return 'component'
  return 'native'
}

function defaultSlideAuthoringField(item: LayerItem): string {
  if (item.kind === 'native' && item.content.nativeType === 'text') return 'content.data.text'
  if (item.kind === 'native' && item.content.nativeType === 'formula') return 'content.data'
  if (
    item.kind === 'native' &&
    (item.content.nativeType === 'image' || item.content.nativeType === 'video')
  ) {
    return 'content.data.assetId'
  }
  return 'item'
}

export function makeSlideAuthoringTarget(
  session: SlideAuthoringSession,
  layerItemId: string,
  field?: string,
): SlideAuthoringTarget {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer) throw new Error('所选元素已失效，请重新选择')
  const authoringAddress = makeAuthoringAddress({
    projectId: session.history.present.id,
    scope: layer.source,
    surfaceId: layer.source === 'global' ? undefined : view.surfaceId,
    sceneId: layer.source === 'scene' ? view.sceneId : undefined,
    carrier: slideLayerCarrier(layer.item as LayerItem),
    layerItemId,
    field: field ?? defaultSlideAuthoringField(layer.item as LayerItem),
  })
  return Object.freeze({
    sessionId: session.sessionId,
    revision: session.history.present.revision,
    generation: session.generation,
    authoringAddress,
    scope: layer.source,
    layerItemId,
  })
}

function selectableLayers(
  session: SlideAuthoringSession,
): Map<string, SlideEditorLayerView> {
  const location = session.history.present.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (location?.kind !== 'slide-scene') return new Map()
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  return new Map(view.layers.flatMap((layer) => {
    if (layer.source !== session.scope) return []
    if (
      layer.item.kind === 'native' &&
      session.scope !== 'global' &&
      layer.item.content.nativeType === 'teacher-controller'
    ) {
      return []
    }
    return [[layer.selectionId, layer] as const]
  }))
}

function sameSelection(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function selectSlideLayers(
  session: SlideAuthoringSession,
  input: { readonly nodeIds: readonly string[]; readonly additive?: boolean },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  if (new Set(input.nodeIds).size !== input.nodeIds.length) {
    return reject(session, 'invalid-selection')
  }
  const selectable = selectableLayers(session)
  if (input.nodeIds.some((nodeId) => !selectable.has(nodeId))) {
    return reject(session, 'invalid-selection')
  }
  let nextSelectionIds: string[]
  if (input.additive) {
    nextSelectionIds = [...session.selection.selectionIds]
    for (const nodeId of input.nodeIds) {
      const index = nextSelectionIds.indexOf(nodeId)
      if (index >= 0) nextSelectionIds.splice(index, 1)
      else nextSelectionIds.push(nodeId)
    }
  } else {
    nextSelectionIds = [...input.nodeIds]
  }
  if (sameSelection(nextSelectionIds, session.selection.selectionIds)) {
    return succeed(session, false)
  }
  try {
    const selection = selectSlideEditorLayers({
      project: session.history.present,
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds: nextSelectionIds,
    })
    return succeed({ ...session, selection }, false)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function setSlideEditingScope(
  session: SlideAuthoringSession,
  scope: SlideEditorLayerScope,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  if (session.scope === scope && session.selection.selectionIds.length === 0) {
    return succeed(session, false)
  }
  try {
    const selection = selectSlideEditorLayers({
      project: session.history.present,
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds: [],
    })
    return succeed({
      ...session,
      selection,
      scope,
      generation: bumpGeneration(session),
    }, false)
  } catch (error) {
    return catchCommand(session, error)
  }
}

function slideSurfaceForScene(
  project: CourseProjectDocument,
  sceneId: string,
): SlideSurfaceDocument {
  const surface = project.surfaces.find((candidate) =>
    candidate.type === 'slide' && candidate.scenes.some((scene) => scene.id === sceneId),
  )
  if (!surface || surface.type !== 'slide') throw new Error('找不到对应的幻灯片')
  return surface
}

function activeSlideSurface(session: SlideAuthoringSession): SlideSurfaceDocument {
  const location = session.history.present.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = session.history.present.surfaces.find(
    (candidate) => candidate.id === location.surfaceId,
  )
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  return surface
}

function baseSelectionForScene(
  project: CourseProjectDocument,
  sceneId: string,
): SlideAuthoringSelection {
  const surface = slideSurfaceForScene(project, sceneId)
  const location = project.locations.find((candidate) =>
    candidate.kind === 'slide-scene' &&
    candidate.surfaceId === surface.id &&
    candidate.sceneId === sceneId &&
    candidate.stateId === undefined,
  ) ?? project.locations.find((candidate) =>
    candidate.kind === 'slide-scene' &&
    candidate.surfaceId === surface.id &&
    candidate.sceneId === sceneId,
  )
  if (!location) throw new Error('当前幻灯片缺少课程位置')
  return selectSlideEditorLayers({
    project,
    locationId: location.id,
    stateId: null,
    selectionIds: [],
  })
}

function commitDocument(
  session: SlideAuthoringSession,
  project: CourseProjectDocument,
  selection: SlideAuthoringSelection = session.selection,
  scope: SlideEditorLayerScope = session.scope,
  generation = session.generation,
): SlideAuthoringSession {
  return {
    sessionId: session.sessionId,
    history: commitSlideAuthoringHistory(session.history, project),
    selection,
    scope,
    generation,
  }
}

export function activateSlideScene(
  session: SlideAuthoringSession,
  sceneId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const selection = baseSelectionForScene(session.history.present, sceneId)
    if (
      session.scope === 'scene' &&
      session.selection.locationId === selection.locationId &&
      session.selection.stateId === null &&
      session.selection.selectionIds.length === 0
    ) {
      return succeed(session, false)
    }
    return succeed({
      ...session,
      selection,
      scope: 'scene',
      generation: bumpGeneration(session),
    }, false)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlideScene(
  session: SlideAuthoringSession,
  options: SlideCommandOptions & { name?: string } = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const surface = activeSlideSurface(session)
    const priorIds = new Set(surface.scenes.map((scene) => scene.id))
    const project = mutateAddSlideScene(
      session.history.present,
      surface.id,
      { name: options.name, now: options.now },
    )
    const nextSurface = project.surfaces.find((candidate) => candidate.id === surface.id)
    if (!nextSurface || nextSurface.type !== 'slide') throw new Error('新建后当前幻灯片集已失效')
    const added = nextSurface.scenes.find((scene) => !priorIds.has(scene.id))
    if (!added) throw new Error('新建幻灯片失败')
    return succeed(commitDocument(
      session,
      project,
      baseSelectionForScene(project, added.id),
      'scene',
      bumpGeneration(session),
    ), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function renameSlideScene(
  session: SlideAuthoringSession,
  sceneId: string,
  name: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const surface = slideSurfaceForScene(session.history.present, sceneId)
    const scene = surface.scenes.find((candidate) => candidate.id === sceneId)!
    const normalized = name.trim().slice(0, 200)
    if (!normalized || normalized === scene.name) return succeed(session, false)
    const project = mutateRenameSlideScene(
      session.history.present, surface.id, sceneId, normalized, options.now,
    )
    return succeed(commitDocument(session, project), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function reorderSlideScenes(
  session: SlideAuthoringSession,
  sceneIds: readonly string[],
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const firstId = sceneIds[0]
    if (!firstId) return succeed(session, false)
    const surface = slideSurfaceForScene(session.history.present, firstId)
    if (surface.scenes.map((scene) => scene.id).every((id, index) => id === sceneIds[index])) {
      return succeed(session, false)
    }
    const project = mutateReorderSlideScenes(
      session.history.present, surface.id, sceneIds, options.now,
    )
    return succeed(commitDocument(session, project), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function duplicateSlideScene(
  session: SlideAuthoringSession,
  sceneId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const surface = slideSurfaceForScene(session.history.present, sceneId)
    const priorIds = new Set(surface.scenes.map((scene) => scene.id))
    const project = mutateDuplicateSlideScene(
      session.history.present, surface.id, sceneId, options.now,
    )
    const nextSurface = project.surfaces.find((candidate) => candidate.id === surface.id)
    if (!nextSurface || nextSurface.type !== 'slide') throw new Error('复制后当前幻灯片集已失效')
    const duplicate = nextSurface.scenes.find((scene) => !priorIds.has(scene.id))
    if (!duplicate) throw new Error('复制幻灯片失败')
    return succeed(commitDocument(
      session,
      project,
      baseSelectionForScene(project, duplicate.id),
      'scene',
      bumpGeneration(session),
    ), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlideScene(
  session: SlideAuthoringSession,
  sceneId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const surface = slideSurfaceForScene(session.history.present, sceneId)
    const index = surface.scenes.findIndex((scene) => scene.id === sceneId)
    const fallback = surface.scenes[index - 1] ?? surface.scenes[index + 1]
    if (!fallback) {
      const present = session.history.present
      const location = present.locations.find((candidate) =>
        candidate.kind === 'slide-scene' &&
        candidate.sceneId === sceneId &&
        candidate.stateId === undefined,
      )
      if (!location) throw new Error('找不到当前幻灯片')
      const deleted = deleteCourseLocation(present, location.id, {
        expectedRevision: present.revision,
        now: options.now,
        activeLocationId: session.selection.locationId,
      })
      if (!deleted.ok) throw new Error(deleted.reason || COURSE_LAST_LOCATION_REASON)
      const nextLocation = deleted.project.locations.find(
        (candidate) => candidate.id === deleted.activatedLocationId,
      )
      if (nextLocation?.kind === 'slide-scene') {
        return succeed(commitDocument(
          session,
          deleted.project,
          baseSelectionForScene(deleted.project, nextLocation.sceneId),
          'scene',
          bumpGeneration(session),
        ), true)
      }
      return succeed({
        ...session,
        history: commitSlideAuthoringHistory(session.history, deleted.project),
        selection: {
          locationId: deleted.activatedLocationId,
          stateId: null,
          selectionIds: [],
        },
        generation: bumpGeneration(session),
      }, true)
    }
    const activeLocation = session.history.present.locations.find(
      (candidate) => candidate.id === session.selection.locationId,
    )
    const deletingActiveScene = activeLocation?.kind === 'slide-scene' &&
      activeLocation.sceneId === sceneId
    const project = mutateDeleteSlideScene(
      session.history.present, surface.id, sceneId, options.now,
    )
    if (deletingActiveScene) {
      return succeed(commitDocument(
        session,
        project,
        baseSelectionForScene(project, fallback.id),
        'scene',
        bumpGeneration(session),
      ), true)
    }
    let selection: SlideAuthoringSelection
    try {
      selection = selectSlideEditorLayers({
        project,
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
        selectionIds: session.selection.selectionIds,
      })
    } catch {
      selection = selectSlideEditorLayers({
        project,
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
        selectionIds: [],
      })
    }
    return succeed(commitDocument(session, project, selection, session.scope), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

function activeSlideSceneContext(session: SlideAuthoringSession) {
  const location = session.history.present.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = session.history.present.surfaces.find(
    (candidate) => candidate.id === location.surfaceId,
  )
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  return { location, surface, scene }
}

function presentationSelection(
  session: SlideAuthoringSession,
  project: CourseProjectDocument,
  stateId: string | null,
): SlideAuthoringSelection {
  return selectSlideEditorLayers({
    project,
    locationId: session.selection.locationId,
    stateId,
    selectionIds: [],
  })
}

export function activateSlidePresentationState(
  session: SlideAuthoringSession,
  stateId: string | null,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const { scene } = activeSlideSceneContext(session)
    if (stateId !== null && !scene.presentation?.states.some((candidate) => candidate.id === stateId)) {
      throw new Error('当前命名状态已失效')
    }
    const selection = presentationSelection(session, session.history.present, stateId)
    if (
      session.scope === 'scene' &&
      session.selection.stateId === selection.stateId &&
      session.selection.selectionIds.length === 0
    ) {
      return succeed(session, false)
    }
    return succeed({
      ...session,
      selection,
      scope: 'scene',
      generation: bumpGeneration(session),
    }, false)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function addSlidePresentationState(
  session: SlideAuthoringSession,
  name?: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const { surface, scene } = activeSlideSceneContext(session)
    const priorIds = new Set(scene.presentation?.states.map((candidate) => candidate.id) ?? [])
    const project = mutateAddSlidePresentationState(
      session.history.present, surface.id, scene.id, name, options.now,
    )
    const nextSurface = project.surfaces.find((candidate) => candidate.id === surface.id)
    const nextScene = nextSurface?.type === 'slide'
      ? nextSurface.scenes.find((candidate) => candidate.id === scene.id)
      : undefined
    const added = nextScene?.presentation?.states.find((candidate) => !priorIds.has(candidate.id))
    if (!added) throw new Error('新建命名状态失败')
    return succeed(commitDocument(
      session,
      project,
      presentationSelection(session, project, added.id),
      'scene',
      bumpGeneration(session),
    ), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function duplicateSlidePresentationState(
  session: SlideAuthoringSession,
  stateId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const { surface, scene } = activeSlideSceneContext(session)
    const priorIds = new Set(scene.presentation?.states.map((candidate) => candidate.id) ?? [])
    const project = mutateDuplicateSlidePresentationState(
      session.history.present, surface.id, scene.id, stateId, options.now,
    )
    const nextSurface = project.surfaces.find((candidate) => candidate.id === surface.id)
    const nextScene = nextSurface?.type === 'slide'
      ? nextSurface.scenes.find((candidate) => candidate.id === scene.id)
      : undefined
    const duplicate = nextScene?.presentation?.states.find((candidate) => !priorIds.has(candidate.id))
    if (!duplicate) throw new Error('复制命名状态失败')
    return succeed(commitDocument(
      session,
      project,
      presentationSelection(session, project, duplicate.id),
      'scene',
      bumpGeneration(session),
    ), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function renameSlidePresentationState(
  session: SlideAuthoringSession,
  stateId: string,
  name: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const { surface, scene } = activeSlideSceneContext(session)
    const current = scene.presentation?.states.find((candidate) => candidate.id === stateId)
    if (!current) throw new Error('当前命名状态已失效')
    const normalized = name.trim().slice(0, 120)
    if (!normalized || normalized === current.name) return succeed(session, false)
    const project = mutateRenameSlidePresentationState(
      session.history.present, surface.id, scene.id, stateId, normalized, options.now,
    )
    return succeed(commitDocument(session, project), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function reorderSlidePresentationStates(
  session: SlideAuthoringSession,
  stateIds: readonly string[],
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const { surface, scene } = activeSlideSceneContext(session)
    const currentIds = scene.presentation?.states.map((state) => state.id) ?? []
    if (currentIds.every((id, index) => id === stateIds[index])) return succeed(session, false)
    const project = mutateReorderSlidePresentationStates(
      session.history.present, surface.id, scene.id, stateIds, options.now,
    )
    return succeed(commitDocument(session, project), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlidePresentationState(
  session: SlideAuthoringSession,
  stateId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const { surface, scene } = activeSlideSceneContext(session)
    if (!scene.presentation?.states.some((candidate) => candidate.id === stateId)) {
      throw new Error('当前命名状态已失效')
    }
    if (scene.presentation.states.length <= 1) {
      throw new Error('幻灯片至少需要一个命名状态')
    }
    const project = mutateDeleteSlidePresentationState(
      session.history.present, surface.id, scene.id, stateId, options.now,
    )
    const nextSurface = project.surfaces.find((candidate) => candidate.id === surface.id)
    const nextScene = nextSurface?.type === 'slide'
      ? nextSurface.scenes.find((candidate) => candidate.id === scene.id)
      : undefined
    if (!nextScene?.presentation) throw new Error('删除后当前幻灯片状态已失效')
    const selection = session.selection.stateId === stateId
      ? presentationSelection(session, project, nextScene.presentation.initialStateId)
      : selectSlideEditorLayers({
          project,
          locationId: session.selection.locationId,
          stateId: session.selection.stateId,
          selectionIds: session.selection.selectionIds,
        })
    const generation = session.selection.stateId === stateId
      ? bumpGeneration(session)
      : session.generation
    return succeed(commitDocument(session, project, selection, 'scene', generation), true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function transformSlideNativeLayers(
  session: SlideAuthoringSession,
  input: SlideEditorTransformInput,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  if (session.scope !== 'scene' && session.scope !== 'global') {
    return reject(session, SLIDE_REJECT_WRONG_OWNER)
  }
  try {
    const history = transformSelectedSlideNativeLayers(
      session.history,
      session.selection,
      input,
      session.scope,
      options.now,
    )
    if (history === session.history) return succeed(session, false)
    return succeed({ ...session, history }, true)
  } catch (error) {
    return catchCommand(session, error)
  }
}

function selectionForHistory(
  session: SlideAuthoringSession,
  history: SlideAuthoringHistory,
): SlideAuthoringSelection {
  try {
    return selectSlideEditorLayers({
      project: history.present,
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds: session.selection.selectionIds,
    })
  } catch {
    try {
      return selectSlideEditorLayers({
        project: history.present,
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
        selectionIds: [],
      })
    } catch {
      try {
        return selectSlideEditorLayers({
          project: history.present,
          locationId: session.selection.locationId,
          stateId: null,
          selectionIds: [],
        })
      } catch {
        const start = firstSlideLocation(history.present)
        if (!start) throw new Error('找不到 Slide 场景位置')
        return selectSlideEditorLayers({
          project: history.present,
          locationId: start.id,
          stateId: null,
          selectionIds: [],
        })
      }
    }
  }
}

export function undoSlideAuthoring(
  session: SlideAuthoringSession,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const resourceTransition = slideAuthoringUndoResourceTransition(session.history)
  const history = undoSlideAuthoringHistory(session.history)
  if (history === session.history) return succeed(session, false)
  return succeed({
    ...session,
    history,
    selection: selectionForHistory(session, history),
    generation: bumpGeneration(session),
  }, false, resourceTransition)
}

export function redoSlideAuthoring(
  session: SlideAuthoringSession,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  const resourceTransition = slideAuthoringRedoResourceTransition(session.history)
  const history = redoSlideAuthoringHistory(session.history)
  if (history === session.history) return succeed(session, false)
  return succeed({
    ...session,
    history,
    selection: selectionForHistory(session, history),
    generation: bumpGeneration(session),
  }, false, resourceTransition)
}

/**
 * V9 Slide authoring backend. Holds one in-memory session.
 */
export interface SlideAuthoringBackend {
  readonly kind: 'slide-authoring'
  getSession(): SlideAuthoringSession
  getSnapshot(): SlideAuthoringSnapshot
  makeTarget(layerItemId: string, field?: string): SlideAuthoringTarget
  selectLayers(
    nodeIds: readonly string[],
    additive?: boolean,
    options?: SlideCommandOptions,
  ): SlideCommandResult
  setScope(scope: SlideEditorLayerScope, options?: SlideCommandOptions): SlideCommandResult
  activateScene(sceneId: string, options?: SlideCommandOptions): SlideCommandResult
  addScene(options?: SlideCommandOptions & { name?: string }): SlideCommandResult
  renameScene(sceneId: string, name: string, options?: SlideCommandOptions): SlideCommandResult
  reorderScenes(sceneIds: readonly string[], options?: SlideCommandOptions): SlideCommandResult
  duplicateScene(sceneId: string, options?: SlideCommandOptions): SlideCommandResult
  deleteScene(sceneId: string, options?: SlideCommandOptions): SlideCommandResult
  activateState(stateId: string | null, options?: SlideCommandOptions): SlideCommandResult
  addState(name?: string, options?: SlideCommandOptions): SlideCommandResult
  renameState(stateId: string, name: string, options?: SlideCommandOptions): SlideCommandResult
  reorderStates(stateIds: readonly string[], options?: SlideCommandOptions): SlideCommandResult
  duplicateState(stateId: string, options?: SlideCommandOptions): SlideCommandResult
  deleteState(stateId: string, options?: SlideCommandOptions): SlideCommandResult
  transformNativeLayers(
    input: SlideEditorTransformInput,
    options?: SlideCommandOptions,
  ): SlideCommandResult
  undo(options?: SlideCommandOptions): SlideCommandResult
  redo(options?: SlideCommandOptions): SlideCommandResult
}

function bindBackend(
  read: () => SlideAuthoringSession,
  write: (session: SlideAuthoringSession) => void,
  run: (session: SlideAuthoringSession) => SlideCommandResult,
): SlideCommandResult {
  const result = run(read())
  if (result.ok && result.nextSession) write(result.nextSession)
  return result
}

export function createSlideAuthoringBackend(
  initial: SlideAuthoringSession,
): SlideAuthoringBackend {
  let session = freezeSession(initial)
  const run = (
    execute: (current: SlideAuthoringSession) => SlideCommandResult,
  ): SlideCommandResult => bindBackend(() => session, (next) => { session = next }, execute)
  return {
    kind: 'slide-authoring',
    getSession: () => session,
    getSnapshot: () => buildSlideAuthoringSnapshot(session),
    makeTarget: (layerItemId, field) => makeSlideAuthoringTarget(session, layerItemId, field),
    selectLayers: (nodeIds, additive, options) =>
      run((current) => selectSlideLayers(current, { nodeIds, additive }, options)),
    setScope: (scope, options) => run((current) => setSlideEditingScope(current, scope, options)),
    activateScene: (sceneId, options) =>
      run((current) => activateSlideScene(current, sceneId, options)),
    addScene: (options) => run((current) => addSlideScene(current, options)),
    renameScene: (sceneId, name, options) =>
      run((current) => renameSlideScene(current, sceneId, name, options)),
    reorderScenes: (sceneIds, options) =>
      run((current) => reorderSlideScenes(current, sceneIds, options)),
    duplicateScene: (sceneId, options) =>
      run((current) => duplicateSlideScene(current, sceneId, options)),
    deleteScene: (sceneId, options) =>
      run((current) => deleteSlideScene(current, sceneId, options)),
    activateState: (stateId, options) =>
      run((current) => activateSlidePresentationState(current, stateId, options)),
    addState: (name, options) =>
      run((current) => addSlidePresentationState(current, name, options)),
    renameState: (stateId, name, options) =>
      run((current) => renameSlidePresentationState(current, stateId, name, options)),
    reorderStates: (stateIds, options) =>
      run((current) => reorderSlidePresentationStates(current, stateIds, options)),
    duplicateState: (stateId, options) =>
      run((current) => duplicateSlidePresentationState(current, stateId, options)),
    deleteState: (stateId, options) =>
      run((current) => deleteSlidePresentationState(current, stateId, options)),
    transformNativeLayers: (input, options) =>
      run((current) => transformSlideNativeLayers(current, input, options)),
    undo: (options) => run((current) => undoSlideAuthoring(current, options)),
    redo: (options) => run((current) => redoSlideAuthoring(current, options)),
  }
}

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

function mutateAddSlideScene(
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

function mutateRenameSlideScene(
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

function mutateReorderSlideScenes(
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
  if (item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') return
  item.content.data.buttons = remapTeacherControllerButtonList(
    item.content.data.buttons,
    sceneIdMap,
    stateIdMap,
  )
}

function teacherControllerOverrideButtons(
  item: LayerItem | undefined,
  override: LayerItemOverride,
): TeacherControllerButton[] | undefined {
  if (
    item?.kind !== 'native' ||
    item.content.nativeType !== 'teacher-controller' ||
    !override.nativeData ||
    !Array.isArray(override.nativeData.buttons)
  ) {
    return undefined
  }
  return override.nativeData.buttons as TeacherControllerButton[]
}

function duplicateSlideSceneDocument(
  source: SlideSceneDocument,
  sceneId: string,
  name: string,
): SlideSceneDocument {
  const scene = structuredClone(source)
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
          if (buttons && override.nativeData) {
            override.nativeData.buttons = remapTeacherControllerButtonList(
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
    rule.id = stableId('rule')
    const trigger = rule.trigger
    if ('nodeId' in trigger) trigger.nodeId = layerIdMap.get(trigger.nodeId) ?? trigger.nodeId
    if (trigger.type === 'presentation.enter') {
      trigger.stateId = stateIdMap.get(trigger.stateId) ?? trigger.stateId
    } else if (trigger.type === 'animation.completed') {
      trigger.actionId = actionIdMap.get(trigger.actionId) ?? trigger.actionId
    }
    rule.conditions.forEach((condition) => {
      if (condition.type === 'presentation.in') {
        condition.stateIds = condition.stateIds.map((stateId) => stateIdMap.get(stateId) ?? stateId)
      } else if (condition.type === 'scene.in') {
        condition.sceneIds = condition.sceneIds.map((id) => sceneIdMap.get(id) ?? id)
      }
    })
    rule.actions.forEach((step) => {
      step.id = actionIdMap.get(step.id)!
      const action = step.action
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

function mutateDuplicateSlideScene(
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
      source,
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
      if (buttons && override.nativeData) override.nativeData.buttons = update(buttons)
    })
  })
}

function mutateDeleteSlideScene(
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

function mutateAddSlidePresentationState(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  name?: string,
  now?: string,
): CourseProjectDocument {
  const stateId = stableId('state')
  return commitSlideProjectMutation(project, (draft) => {
    const scene = findMutableSlideScene(draft, surfaceId, sceneId)
    const normalized = name?.trim().slice(0, 120)
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

function mutateDuplicateSlidePresentationState(
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

function mutateRenameSlidePresentationState(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  stateId: string,
  name: string,
  now?: string,
): CourseProjectDocument {
  return commitSlideProjectMutation(project, (draft) => {
    const scene = findMutableSlideScene(draft, surfaceId, sceneId)
    const state = scene.presentation?.states.find((candidate) => candidate.id === stateId)
    if (!state) throw new Error(`找不到命名状态：${stateId}`)
    state.name = name
  }, now)
}

function mutateReorderSlidePresentationStates(
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
    if (item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') return
    item.content.data.buttons = clearSceneGoTargetStateButtonList(
      item.content.data.buttons,
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

function mutateDeleteSlidePresentationState(
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
