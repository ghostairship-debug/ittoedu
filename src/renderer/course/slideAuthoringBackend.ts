import { mutateAddSlideScene, mutateRenameSlideScene, mutateReorderSlideScenes, mutateDuplicateSlideScene, mutateDeleteSlideScene, mutateAddSlidePresentationState, mutateDuplicateSlidePresentationState, mutateRenameSlidePresentationState, mutateReorderSlidePresentationStates, mutateDeleteSlidePresentationState } from '../../core/tools/slideStructure'
import { canEditLayerInScope } from '../../shared/teacherControllerRole'
import { commitResourceAwareAuthoringHistory, createResourceAwareAuthoringHistory, redoResourceAwareAuthoringHistory, authoringHistoryRedoResourceTransition, authoringHistoryUndoResourceTransition, undoResourceAwareAuthoringHistory, type ResourceAwareAuthoringHistory, type AuthoringHistoryResourceTransition } from '../authoring/resourceAwareAuthoringHistory'
import { nanoid } from 'nanoid'
import { makeAuthoringAddress, type AuthoringCarrier } from '../../shared/authoringAddress'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'

import { SLIDE_REJECT_STALE_REVISION, SLIDE_REJECT_WRONG_OWNER, selectSlideEditorLayers, transformSelectedSlideNativeLayers, SlideCommandError, type SlideAuthoringSelection, type SlideAuthoringSessionRef, type SlideAuthoringTarget, type SlideCommandOptions, type SlideCommandResult, type SlideEditorTransformInput } from './slideEditorCommands'
import {
  buildSlideEditorView,
  type SlideEditorLayerScope,
  type SlideEditorLayerView,
} from '../../core/tools/slideLayerView'
import {
  COURSE_LAST_LOCATION_REASON,
  deleteCourseLocation,
} from '../../core/tools/courseLocations'

export type { SlideAuthoringSelection, SlideAuthoringTarget, SlideCommandOptions, SlideCommandResult } from './slideEditorCommands'
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
} from '../../core/tools/slideLayerView'

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

function freezeHistory(history: ResourceAwareAuthoringHistory): ResourceAwareAuthoringHistory {
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
  resourceTransition?: AuthoringHistoryResourceTransition,
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
    history: createResourceAwareAuthoringHistory(parsed),
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
    if (!canEditLayerInScope(layer, session.scope)) return []
    
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
    history: commitResourceAwareAuthoringHistory(session.history, project),
    selection,
    scope,
    generation,
  }
}

/** Opens an exact course location, including its named presentation state. */
export function activateSlideLocation(
  session: SlideAuthoringSession,
  locationId: string,
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const location = session.history.present.locations.find((candidate) => candidate.id === locationId)
    if (location?.kind !== 'slide-scene') throw new Error('找不到 Slide 场景位置')
    const selection = selectSlideEditorLayers({
      project: session.history.present,
      locationId,
      stateId: location.stateId ?? null,
      selectionIds: [],
    })
    if (
      session.scope === 'scene'
      && session.selection.locationId === selection.locationId
      && session.selection.stateId === selection.stateId
      && session.selection.selectionIds.length === 0
    ) return succeed(session, false)
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

/** Opens the scene's base editing state, independently of exact location navigation. */
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
        history: commitResourceAwareAuthoringHistory(session.history, deleted.project),
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
    const project = mutateRenameSlidePresentationState(
      session.history.present, surface.id, scene.id, stateId, name, options.now,
    )
    if (project === session.history.present) return succeed(session, false)
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
  history: ResourceAwareAuthoringHistory,
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
  const resourceTransition = authoringHistoryUndoResourceTransition(session.history)
  const history = undoResourceAwareAuthoringHistory(session.history)
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
  const resourceTransition = authoringHistoryRedoResourceTransition(session.history)
  const history = redoResourceAwareAuthoringHistory(session.history)
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
  activateLocation(locationId: string, options?: SlideCommandOptions): SlideCommandResult
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
    activateLocation: (locationId, options) =>
      run((current) => activateSlideLocation(current, locationId, options)),
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
