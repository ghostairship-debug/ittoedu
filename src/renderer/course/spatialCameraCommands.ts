import {
  spatialHasWorldContent,
  spatialCameraFittingWorldContent,
  type SpatialWorldContentFitInput,
} from '../../core/tools/spatialWorldFit'
export type { SpatialWorldContentFitInput } from '../../core/tools/spatialWorldFit'
import {
  SpatialCameraPoseInput,
  AddSpatialEditorCameraFrameOptions,
  addSpatialEditorCameraFrame as planAddSpatialEditorCameraFrame,
  renameSpatialCameraFrame as planRenameSpatialCameraFrame,
  reorderSpatialCameraFrames as planReorderSpatialCameraFrames,
  deleteSpatialCameraFrame as planDeleteSpatialCameraFrame,
  setSpatialCameraHome as planSetSpatialCameraHome,
  updateSpatialCameraFramePose as planUpdateSpatialCameraFramePose,
} from '../../core/tools/spatialCamera'
import type {
  CourseProjectDocument,
} from '../../shared/courseProjectTypes'
import {
  bumpSpatialGeneration,
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  freezeSpatialSelection,
  rejectSpatialCommand,
  rejectSpatialIfStale,
  replaceSpatialSession,
  succeedSpatialCommand,
  type SpatialAuthoringHistory,
  type SpatialAuthoringSession,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'
import {
  buildSpatialEditorView,
  copySpatialSessionCamera,
  spatialSessionCameraFromPose,
  type SpatialSessionCamera,
} from './spatialEditorView'
import {
  selectSpatialEditorLayers,
  spatialSurfaceIn,
} from './spatialEditorCommands'

function locationForFrame(
  project: CourseProjectDocument,
  surfaceId: string,
  frameId: string,
) {
  return project.locations.find((location) =>
    location.kind === 'spatial-camera' &&
    location.surfaceId === surfaceId &&
    location.cameraFrameId === frameId,
  )
}

/**
 * Adds one camera frame from a pose (usually the session camera).
 * Session pan/zoom itself is never written. One revision / one history entry.
 */
export function addSpatialEditorCameraFrame(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pose: SpatialCameraPoseInput,
  options: AddSpatialEditorCameraFrameOptions = {},
): SpatialAuthoringHistory {
  const next = planAddSpatialEditorCameraFrame(history.present, surfaceId, pose, options)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function renameSpatialCameraFrame(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  name: string,
  now?: string,
): SpatialAuthoringHistory {
  const next = planRenameSpatialCameraFrame(history.present, surfaceId, frameId, name, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function reorderSpatialCameraFrames(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  toIndex: number,
  now?: string,
): SpatialAuthoringHistory {
  const next = planReorderSpatialCameraFrames(history.present, surfaceId, frameId, toIndex, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function deleteSpatialCameraFrame(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  now?: string,
): SpatialAuthoringHistory {
  const next = planDeleteSpatialCameraFrame(history.present, surfaceId, frameId, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

/** The only camera command that writes `camera.home`. Session pan/zoom is never persisted here. */
export function setSpatialCameraHome(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pose: SpatialCameraPoseInput,
  now?: string,
): SpatialAuthoringHistory {
  const next = planSetSpatialCameraHome(history.present, surfaceId, pose, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

export function updateSpatialCameraFramePose(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  pose: SpatialCameraPoseInput,
  now?: string,
): SpatialAuthoringHistory {
  const next = planUpdateSpatialCameraFramePose(history.present, surfaceId, frameId, pose, now)
  return next === history.present ? history : commitSpatialAuthoringHistory(history, next)
}

function commitHistoryResult(
  session: SpatialAuthoringSession,
  history: SpatialAuthoringHistory,
): SpatialCommandResult {
  if (history === session.history) return succeedSpatialCommand(session, false)
  return succeedSpatialCommand(replaceSpatialSession(session, { history }), true)
}

export function addSpatialCameraFrameFromSession(
  session: SpatialAuthoringSession,
  options: AddSpatialEditorCameraFrameOptions & SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const history = addSpatialEditorCameraFrame(
      session.history,
      session.selection.surfaceId,
      session.sessionCamera,
      options,
    )
    return commitHistoryResult(session, history)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function updateActiveSpatialCameraFrameFromSession(
  session: SpatialAuthoringSession,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const view = buildSpatialEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
      sessionCamera: session.sessionCamera,
    })
    const history = updateSpatialCameraFramePose(
      session.history,
      session.selection.surfaceId,
      view.camera.activeFrameId,
      session.sessionCamera,
      options.now,
    )
    return commitHistoryResult(session, history)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function setSpatialCameraHomeFromSession(
  session: SpatialAuthoringSession,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const history = setSpatialCameraHome(
      session.history,
      session.selection.surfaceId,
      session.sessionCamera,
      options.now,
    )
    return commitHistoryResult(session, history)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function renameSpatialCameraFrameInSession(
  session: SpatialAuthoringSession,
  frameId: string,
  name: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const history = renameSpatialCameraFrame(
      session.history,
      session.selection.surfaceId,
      frameId,
      name,
      options.now,
    )
    return commitHistoryResult(session, history)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function reorderSpatialCameraFramesInSession(
  session: SpatialAuthoringSession,
  frameId: string,
  toIndex: number,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const history = reorderSpatialCameraFrames(
      session.history,
      session.selection.surfaceId,
      frameId,
      toIndex,
      options.now,
    )
    return commitHistoryResult(session, history)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function deleteSpatialCameraFrameInSession(
  session: SpatialAuthoringSession,
  frameId: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const history = deleteSpatialCameraFrame(
      session.history,
      session.selection.surfaceId,
      frameId,
      options.now,
    )
    const locationStillExists = history.present.locations.some(
      (location) => location.id === session.selection.locationId,
    )
    if (locationStillExists) return commitHistoryResult(session, history)
    const fallback = history.present.locations.find((location) =>
      location.kind === 'spatial-camera' && location.surfaceId === session.selection.surfaceId,
    )
    if (!fallback || fallback.kind !== 'spatial-camera') {
      return rejectSpatialCommand(session, '找不到 Spatial 镜头位置')
    }
    const surface = spatialSurfaceIn(history.present, fallback.surfaceId)
    const frame = surface.camera.frames.find((candidate) => candidate.id === fallback.cameraFrameId)
    if (!frame) return rejectSpatialCommand(session, '找不到镜头画面，请刷新后重试')
    const selection = selectSpatialEditorLayers({
      project: history.present,
      locationId: fallback.id,
      selectionIds: [],
    })
    return succeedSpatialCommand(replaceSpatialSession(session, {
      history,
      selection,
      sessionCamera: spatialSessionCameraFromPose(frame),
      generation: bumpSpatialGeneration(session),
    }), true)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

/**
 * G2: 「适合窗口」= restore the persisted home camera into the session.
 * Does not write the project.
 */
export function fitSpatialSessionToHomeCamera(
  session: SpatialAuthoringSession,
): SpatialCommandResult {
  const surface = spatialSurfaceIn(session.history.present, session.selection.surfaceId)
  return succeedSpatialCommand(replaceSpatialSession(session, {
    sessionCamera: spatialSessionCameraFromPose(surface.camera.home),
  }), false)
}

export function spatialSessionHasWorldContent(session: SpatialAuthoringSession): boolean {
  return spatialHasWorldContent(session.history.present, session.selection.locationId)
}
export function spatialSessionCameraFittingWorldContent(session: SpatialAuthoringSession, input: SpatialWorldContentFitInput): SpatialSessionCamera {
  return copySpatialSessionCamera(spatialCameraFittingWorldContent(session.history.present, session.selection.locationId, input))
}

export function fitSpatialSessionToWorldContent(
  session: SpatialAuthoringSession,
  input: SpatialWorldContentFitInput,
): SpatialCommandResult {
  try {
    return succeedSpatialCommand(replaceSpatialSession(session, {
      sessionCamera: spatialSessionCameraFittingWorldContent(session, input),
    }), false)
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

/**
 * Left-nav camera row: activate the frame location and fly the session camera
 * to the stored pose. Session-only; no project revision.
 */
export function activateSpatialCameraFrame(
  session: SpatialAuthoringSession,
  frameId: string,
): SpatialCommandResult {
  const surface = spatialSurfaceIn(session.history.present, session.selection.surfaceId)
  const frame = surface.camera.frames.find((candidate) => candidate.id === frameId)
  if (!frame) return rejectSpatialCommand(session, '找不到镜头画面，请刷新后重试')
  const location = locationForFrame(session.history.present, session.selection.surfaceId, frameId)
  if (!location) return rejectSpatialCommand(session, '找不到 Spatial 镜头位置')
  const alreadyActive = session.selection.locationId === location.id
  const camera = spatialSessionCameraFromPose(frame)
  const sameCamera =
    session.sessionCamera.x === camera.x &&
    session.sessionCamera.y === camera.y &&
    session.sessionCamera.zoom === camera.zoom
  if (alreadyActive && sameCamera) return succeedSpatialCommand(session, false)
  const selection = freezeSpatialSelection({
    locationId: location.id,
    surfaceId: session.selection.surfaceId,
    selectionIds: [],
  })
  return succeedSpatialCommand(replaceSpatialSession(session, {
    selection,
    sessionCamera: camera,
    generation: alreadyActive ? session.generation : bumpSpatialGeneration(session),
  }), false)
}
