import {
  spatialRelationIn,
  spatialRelationAuthoringAddress,
  AddSpatialRelationInput,
  SpatialRelationUpdate,
  addCopiedSpatialRelations as planAddCopiedSpatialRelations,
  addSpatialRelation as planAddSpatialRelation,
  updateSpatialRelation as planUpdateSpatialRelation,
  deleteSpatialRelation as planDeleteSpatialRelation,
} from '../../core/tools/spatialRelation'

import {
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  rejectSpatialIfStale,
  type SpatialAuthoringHistory,
  type SpatialAuthoringSession,
  type SpatialAuthoringTarget,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'
import {
  spatialSurfaceIn,
} from './spatialEditorCommands'
import {
  commitSpatialGraphHistoryResult,
} from './spatialPathCommands'

export function makeSpatialRelationAuthoringTarget(
  session: SpatialAuthoringSession,
  relationId: string,
  field = 'world.relations',
): SpatialAuthoringTarget {
  const surfaceId = session.selection.surfaceId
  spatialRelationIn(spatialSurfaceIn(session.history.present, surfaceId), relationId)
  return Object.freeze({
    sessionId: session.sessionId,
    revision: session.history.present.revision,
    generation: session.generation,
    authoringAddress: spatialRelationAuthoringAddress(
      session.history.present.id,
      surfaceId,
      relationId,
      field,
    ),
    scope: 'surface',
    coordinateSpace: 'world',
    layerItemId: relationId,
  })
}

/**
 * After a world-item copy, duplicate relations whose *both* endpoints were
 * copied. One-sided copies are skipped so the new item does not dangle.
 * Original relations stay on the original ids.
 */

export function addCopiedSpatialRelations(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  copiedIdMap: ReadonlyMap<string, string>,
  now?: string,
): SpatialAuthoringHistory {
  const next = planAddCopiedSpatialRelations(history.present, surfaceId, copiedIdMap, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function addSpatialRelation(
  history: SpatialAuthoringHistory,
  input: AddSpatialRelationInput,
): SpatialAuthoringHistory {
  const next = planAddSpatialRelation(history.present, input)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function updateSpatialRelation(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  relationId: string,
  update: SpatialRelationUpdate,
  now?: string,
): SpatialAuthoringHistory {
  const next = planUpdateSpatialRelation(history.present, surfaceId, relationId, update, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function deleteSpatialRelation(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  relationId: string,
  now?: string,
): SpatialAuthoringHistory {
  const next = planDeleteSpatialRelation(history.present, surfaceId, relationId, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function addSpatialRelationInSession(
  session: SpatialAuthoringSession,
  input: Omit<AddSpatialRelationInput, 'surfaceId'> & { readonly surfaceId?: string },
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(session, addSpatialRelation(session.history, {
      ...input,
      surfaceId: input.surfaceId ?? session.selection.surfaceId,
      now: input.now ?? options.now,
    }))
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function updateSpatialRelationInSession(
  session: SpatialAuthoringSession,
  relationId: string,
  update: SpatialRelationUpdate,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      updateSpatialRelation(
        session.history,
        session.selection.surfaceId,
        relationId,
        update,
        options.now,
      ),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function deleteSpatialRelationInSession(
  session: SpatialAuthoringSession,
  relationId: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      deleteSpatialRelation(session.history, session.selection.surfaceId, relationId, options.now),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function addCopiedSpatialRelationsInSession(
  session: SpatialAuthoringSession,
  copiedIdMap: ReadonlyMap<string, string>,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      addCopiedSpatialRelations(
        session.history,
        session.selection.surfaceId,
        copiedIdMap,
        options.now,
      ),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}
