import { nanoid } from 'nanoid'
import type { CourseProjectDocument, SpatialCameraPose, SpatialSurfaceDocument } from '../../shared/courseProjectTypes'
import { spatialSurfaceIn } from './spatialInsertion'
import { commitCourseProjectMutation as commitSpatialProjectMutation } from './courseProjectMutation'
import { controllerTargetIdsForLocations, repairRemovedCourseReferences } from './courseReferenceCleanup'

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

export function addSpatialEditorCameraFrame(
  project: CourseProjectDocument,
  surfaceId: string,
  pose: SpatialCameraPoseInput,
  options: AddSpatialEditorCameraFrameOptions = {},
): CourseProjectDocument {
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

  return next
}

export function renameSpatialCameraFrame(
  project: CourseProjectDocument,
  surfaceId: string,
  frameId: string,
  name: string,
  now?: string,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, surfaceId)
  const frame = spatialCameraFrameIn(surface, frameId)
  const trimmed = validateCameraFrameName(name)
  if (frame.name === trimmed) return project

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

  return next
}

export function reorderSpatialCameraFrames(
  project: CourseProjectDocument,
  surfaceId: string,
  frameId: string,
  toIndex: number,
  now?: string,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, surfaceId)
  const frames = surface.camera.frames
  const fromIndex = frames.findIndex((frame) => frame.id === frameId)
  if (fromIndex < 0) throw new Error('找不到镜头画面，请刷新后重试')
  if (!Number.isFinite(toIndex)) throw new Error('排序位置必须是有效数字')
  const destination = Math.max(0, Math.min(Math.trunc(toIndex), frames.length - 1))
  if (fromIndex === destination) return project

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const draftFrames = draftSurface.camera.frames
    const index = draftFrames.findIndex((frame) => frame.id === frameId)
    if (index < 0) throw new Error('找不到镜头画面，请刷新后重试')
    const [frame] = draftFrames.splice(index, 1)
    const target = Math.max(0, Math.min(Math.trunc(toIndex), draftFrames.length))
    draftFrames.splice(target, 0, frame!)
  }, now)

  return next
}

export function deleteSpatialCameraFrame(
  project: CourseProjectDocument,
  surfaceId: string,
  frameId: string,
  now?: string,
): CourseProjectDocument {
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

  return next
}

export function setSpatialCameraHome(
  project: CourseProjectDocument,
  surfaceId: string,
  pose: SpatialCameraPoseInput,
  now?: string,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, surfaceId)
  const validPose = validateSpatialCameraPose(pose)
  const home = surface.camera.home
  if (home.x === validPose.x && home.y === validPose.y && home.zoom === validPose.zoom) {
    return project
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    spatialSurfaceIn(draft, surfaceId).camera.home = validPose
  }, now)

  return next
}

export function updateSpatialCameraFramePose(
  project: CourseProjectDocument,
  surfaceId: string,
  frameId: string,
  pose: SpatialCameraPoseInput,
  now?: string,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, surfaceId)
  const frame = spatialCameraFrameIn(surface, frameId)
  const validPose = validateSpatialCameraPose(pose)
  if (frame.x === validPose.x && frame.y === validPose.y && frame.zoom === validPose.zoom) {
    return project
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftFrame = spatialCameraFrameIn(spatialSurfaceIn(draft, surfaceId), frameId)
    draftFrame.x = validPose.x
    draftFrame.y = validPose.y
    draftFrame.zoom = validPose.zoom
  }, now)

  return next
}
