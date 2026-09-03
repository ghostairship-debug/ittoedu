import { nanoid } from 'nanoid'
import type {
  CourseProjectDocument,
  SpatialCameraPose,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  bumpSpatialGeneration,
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  commitSpatialProjectMutation,
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
import { selectSpatialEditorLayers, spatialSurfaceIn } from './spatialEditorCommands'
import {
  controllerTargetIdsForLocations,
  repairRemovedCourseReferences,
} from './courseReferenceCleanup'

export interface SpatialCameraPoseInput {
  x: number
  y: number
  zoom: number
}

export interface AddSpatialEditorCameraFrameOptions {
  id?: string
  name?: string
  now?: string
}

function stableId(prefix: string, preferred?: string): string {
  return preferred ?? `${prefix}-${nanoid(10)}`
}

function spatialCameraFrameIn(
  surface: SpatialSurfaceDocument,
  frameId: string,
): SpatialSurfaceDocument['camera']['frames'][number] {
  const frame = surface.camera.frames.find((candidate) => candidate.id === frameId)
  if (!frame) throw new Error('找不到镜头画面，请刷新后重试')
  return frame
}

export function validateSpatialCameraPose(pose: SpatialCameraPoseInput): SpatialCameraPose {
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
    throw new Error('镜头位置必须是有效数字')
  }
  if (!Number.isFinite(pose.zoom) || pose.zoom <= 0 || pose.zoom > 1_000) {
    throw new Error('镜头缩放必须大于 0 且不超过 1000')
  }
  return { x: pose.x, y: pose.y, zoom: pose.zoom }
}

function validateCameraFrameName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('镜头名称不能为空')
  if (trimmed.length > 200) throw new Error('镜头名称不能超过 200 字')
  return trimmed
}

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
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const validPose = validateSpatialCameraPose(pose)
  const frameId = stableId('camera', options.id)
  if (surface.camera.frames.some((frame) => frame.id === frameId)) {
    throw new Error('镜头 ID 已存在，请重新生成后重试')
  }
  if (project.locations.some((location) => location.id === frameId)) {
    throw new Error('位置 ID 已存在，请重新生成后重试')
  }
  const name = options.name === undefined
    ? `镜头 ${surface.camera.frames.length + 1}`
    : validateCameraFrameName(options.name)

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    draftSurface.camera.frames.push({
      id: frameId,
      name,
      x: validPose.x,
      y: validPose.y,
      zoom: validPose.zoom,
    })
    draft.locations.push({
      id: frameId,
      label: `${draftSurface.title} · ${name}`,
      kind: 'spatial-camera',
      surfaceId,
      cameraFrameId: frameId,
    })
    const printEntry = draft.mixedPrintPlan?.entries.find((entry) =>
      entry.kind === 'spatial-frames' && entry.surfaceId === surfaceId,
    )
    if (printEntry?.kind === 'spatial-frames') {
      printEntry.cameraFrameIds.push(frameId)
    }
  }, options.now)

  return commitSpatialAuthoringHistory(history, next)
}

export function renameSpatialCameraFrame(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  name: string,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const frame = spatialCameraFrameIn(surface, frameId)
  const trimmed = validateCameraFrameName(name)
  if (frame.name === trimmed) return history

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const draftFrame = spatialCameraFrameIn(draftSurface, frameId)
    draftFrame.name = trimmed
    draft.locations.forEach((location) => {
      if (
        location.kind === 'spatial-camera' &&
        location.surfaceId === surfaceId &&
        location.cameraFrameId === frameId
      ) {
        location.label = `${draftSurface.title} · ${trimmed}`
      }
    })
  }, now)

  return commitSpatialAuthoringHistory(history, next)
}

export function reorderSpatialCameraFrames(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  toIndex: number,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const frames = surface.camera.frames
  const fromIndex = frames.findIndex((frame) => frame.id === frameId)
  if (fromIndex < 0) throw new Error('找不到镜头画面，请刷新后重试')
  if (!Number.isFinite(toIndex)) throw new Error('排序位置必须是有效数字')
  const destination = Math.max(0, Math.min(Math.trunc(toIndex), frames.length - 1))
  if (fromIndex === destination) return history

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const draftFrames = draftSurface.camera.frames
    const index = draftFrames.findIndex((frame) => frame.id === frameId)
    if (index < 0) throw new Error('找不到镜头画面，请刷新后重试')
    const [frame] = draftFrames.splice(index, 1)
    const target = Math.max(0, Math.min(Math.trunc(toIndex), draftFrames.length))
    draftFrames.splice(target, 0, frame!)
  }, now)

  return commitSpatialAuthoringHistory(history, next)
}

export function deleteSpatialCameraFrame(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const frameIndex = surface.camera.frames.findIndex((frame) => frame.id === frameId)
  if (frameIndex < 0) throw new Error('找不到镜头画面，请刷新后重试')
  if (surface.camera.frames.length <= 1) {
    throw new Error('空间表面至少需要一个镜头画面')
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const index = draftSurface.camera.frames.findIndex((frame) => frame.id === frameId)
    if (index < 0) throw new Error('找不到镜头画面，请刷新后重试')
    if (draftSurface.camera.frames.length <= 1) {
      throw new Error('空间表面至少需要一个镜头画面')
    }
    draftSurface.camera.frames.splice(index, 1)
    const remainingFrameIds = new Set(draftSurface.camera.frames.map((frame) => frame.id))

    const removedLocations = draft.locations.filter((location) =>
      location.kind === 'spatial-camera' &&
      location.surfaceId === surfaceId &&
      location.cameraFrameId === frameId,
    )
    const removedLocationIds = new Set(removedLocations.map((location) => location.id))
    draft.locations = draft.locations.filter((location) => !removedLocationIds.has(location.id))
    repairRemovedCourseReferences(draft, {
      removedLocationIds,
      removedControllerTargetIds: controllerTargetIdsForLocations(removedLocations),
    })

    if (
      removedLocationIds.has(draft.startLocationId) ||
      !draft.locations.some((location) => location.id === draft.startLocationId)
    ) {
      draft.startLocationId =
        draft.locations.find((location) =>
          location.kind === 'spatial-camera' &&
          location.surfaceId === surfaceId &&
          remainingFrameIds.has(location.cameraFrameId),
        )?.id ??
        draft.locations[0]?.id ??
        ''
    }

    const printEntry = draft.mixedPrintPlan?.entries.find((entry) =>
      entry.kind === 'spatial-frames' && entry.surfaceId === surfaceId,
    )
    if (printEntry?.kind === 'spatial-frames') {
      printEntry.cameraFrameIds = printEntry.cameraFrameIds.filter((id) => id !== frameId)
      if (printEntry.cameraFrameIds.length === 0) {
        printEntry.cameraFrameIds = [draftSurface.camera.frames[0]!.id]
      }
    }
  }, now)

  return commitSpatialAuthoringHistory(history, next)
}

/** The only camera command that writes `camera.home`. Session pan/zoom is never persisted here. */
export function setSpatialCameraHome(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pose: SpatialCameraPoseInput,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const validPose = validateSpatialCameraPose(pose)
  const home = surface.camera.home
  if (home.x === validPose.x && home.y === validPose.y && home.zoom === validPose.zoom) {
    return history
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    spatialSurfaceIn(draft, surfaceId).camera.home = validPose
  }, now)

  return commitSpatialAuthoringHistory(history, next)
}

export function updateSpatialCameraFramePose(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  frameId: string,
  pose: SpatialCameraPoseInput,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const frame = spatialCameraFrameIn(surface, frameId)
  const validPose = validateSpatialCameraPose(pose)
  if (frame.x === validPose.x && frame.y === validPose.y && frame.zoom === validPose.zoom) {
    return history
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftFrame = spatialCameraFrameIn(spatialSurfaceIn(draft, surfaceId), frameId)
    draftFrame.x = validPose.x
    draftFrame.y = validPose.y
    draftFrame.zoom = validPose.zoom
  }, now)

  return commitSpatialAuthoringHistory(history, next)
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

export interface SpatialWorldContentFitInput {
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly padding?: number
}

/**
 * Session-only AABB fit of world + surface (world-space) items.
 * Not the zoom-bar 「适合窗口」 action. Persist by updating a camera frame afterwards.
 */
export function spatialSessionCameraFittingWorldContent(
  session: SpatialAuthoringSession,
  input: SpatialWorldContentFitInput,
): SpatialSessionCamera {
  if (!(input.viewportWidth > 0) || !(input.viewportHeight > 0)) {
    throw new Error('适配视口尺寸必须大于零')
  }
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    sessionCamera: session.sessionCamera,
  })
  const worldItems = view.layers.filter((layer) =>
    layer.coordinateSpace === 'world' && layer.effectiveVisible,
  )
  if (worldItems.length === 0) {
    return copySpatialSessionCamera(spatialSessionCameraFromPose(view.camera.home))
  }
  const minX = Math.min(...worldItems.map((layer) => layer.item.frame.x))
  const minY = Math.min(...worldItems.map((layer) => layer.item.frame.y))
  const maxX = Math.max(...worldItems.map((layer) => layer.item.frame.x + layer.item.frame.width))
  const maxY = Math.max(...worldItems.map((layer) => layer.item.frame.y + layer.item.frame.height))
  const padding = input.padding ?? 40
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const zoom = Math.min(
    1_000,
    input.viewportWidth / (width + padding * 2),
    input.viewportHeight / (height + padding * 2),
  )
  return copySpatialSessionCamera({
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    zoom: Math.min(1_000, Math.max(zoom, 0.000_001)),
  })
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
