import {
  spatialPathIn,
  spatialPathAuthoringAddress,
  summarizeSpatialWorldReferenceCleanup,
  AddSpatialPathInput,
  SpatialPathUpdate,
  addSpatialPath as planAddSpatialPath,
  updateSpatialPath as planUpdateSpatialPath,
  deleteSpatialPath as planDeleteSpatialPath,
  reorderSpatialPathWaypoints as planReorderSpatialPathWaypoints,
} from '../../core/tools/spatialPath'

import {
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  rejectSpatialIfStale,
  replaceSpatialSession,
  succeedSpatialCommand,
  type SpatialAuthoringHistory,
  type SpatialAuthoringSession,
  type SpatialAuthoringTarget,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'
import {
  deleteSpatialWorldLayersInSession,
  spatialSurfaceIn,
} from './spatialEditorCommands'

export function makeSpatialPathAuthoringTarget(
  session: SpatialAuthoringSession,
  pathId: string,
  field = 'world.paths',
): SpatialAuthoringTarget {
  const surfaceId = session.selection.surfaceId
  spatialPathIn(spatialSurfaceIn(session.history.present, surfaceId), pathId)
  return Object.freeze({
    sessionId: session.sessionId,
    revision: session.history.present.revision,
    generation: session.generation,
    authoringAddress: spatialPathAuthoringAddress(
      session.history.present.id,
      surfaceId,
      pathId,
      field,
    ),
    scope: 'surface',
    coordinateSpace: 'world',
    layerItemId: pathId,
  })
}

export function commitSpatialGraphHistoryResult(
  session: SpatialAuthoringSession,
  history: SpatialAuthoringHistory,
): SpatialCommandResult {
  if (history === session.history) return succeedSpatialCommand(session, false)
  return succeedSpatialCommand(replaceSpatialSession(session, { history }), true)
}

/**
 * Calls R5-A world delete (including its cascade) and reports the human-readable
 * cleanup that will happen. Path/relation dedicated commands still refuse
 * dangling writes with explicit reasons.
 */
export function deleteSpatialWorldLayersReportingReferences(
  session: SpatialAuthoringSession,
  options: SpatialCommandOptions = {},
): SpatialCommandResult & { readonly cleanupSummary: string } {
  const surface = spatialSurfaceIn(session.history.present, session.selection.surfaceId)
  const cleanupSummary = summarizeSpatialWorldReferenceCleanup(
    surface,
    session.selection.selectionIds,
  )
  return { ...deleteSpatialWorldLayersInSession(session, options), cleanupSummary }
}

export function addSpatialPath(
  history: SpatialAuthoringHistory,
  input: AddSpatialPathInput,
): SpatialAuthoringHistory {
  const next = planAddSpatialPath(history.present, input)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function updateSpatialPath(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pathId: string,
  update: SpatialPathUpdate,
  now?: string,
): SpatialAuthoringHistory {
  const next = planUpdateSpatialPath(history.present, surfaceId, pathId, update, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function deleteSpatialPath(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pathId: string,
  now?: string,
): SpatialAuthoringHistory {
  const next = planDeleteSpatialPath(history.present, surfaceId, pathId, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function reorderSpatialPathWaypoints(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pathId: string,
  layerItemIds: readonly string[],
  now?: string,
): SpatialAuthoringHistory {
  const next = planReorderSpatialPathWaypoints(history.present, surfaceId, pathId, layerItemIds, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function addSpatialPathInSession(
  session: SpatialAuthoringSession,
  input: Omit<AddSpatialPathInput, 'surfaceId'> & { readonly surfaceId?: string },
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(session, addSpatialPath(session.history, {
      ...input,
      surfaceId: input.surfaceId ?? session.selection.surfaceId,
      now: input.now ?? options.now,
    }))
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function updateSpatialPathInSession(
  session: SpatialAuthoringSession,
  pathId: string,
  update: SpatialPathUpdate,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      updateSpatialPath(session.history, session.selection.surfaceId, pathId, update, options.now),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function deleteSpatialPathInSession(
  session: SpatialAuthoringSession,
  pathId: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      deleteSpatialPath(session.history, session.selection.surfaceId, pathId, options.now),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function reorderSpatialPathWaypointsInSession(
  session: SpatialAuthoringSession,
  pathId: string,
  layerItemIds: readonly string[],
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  return updateSpatialPathInSession(session, pathId, { layerItemIds: [...layerItemIds] }, options)
}

/** G1: dashed camera-frame overlay. Session-only; never writes revision. */
export function setSpatialShowCameraFrames(
  session: SpatialAuthoringSession,
  showCameraFrames: boolean,
): SpatialCommandResult {
  if (session.showCameraFrames === showCameraFrames) {
    return succeedSpatialCommand(session, false)
  }
  return succeedSpatialCommand(replaceSpatialSession(session, { showCameraFrames }), false)
}
