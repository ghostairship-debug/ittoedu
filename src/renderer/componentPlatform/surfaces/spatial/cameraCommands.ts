import type { ComponentEdit, ComponentSpatialAuthoring, ComponentSpatialPose, CourseProjectV10 } from '../../../../shared/contracts/component-platform'
import { frameCorners } from '../../../../core/components/geometry'
import { spatialWorldTargets } from './targets'

/** V10 camera authoring uses one Surface field and the document's canonical History. */
export function spatialAuthoringEdit(project: CourseProjectV10, surfaceId: string, change: (spatial: ComponentSpatialAuthoring) => void): ComponentEdit {
  const surface = project.surfaces.find(value => value.id === surfaceId && value.kind === 'spatial')
  if (!surface) throw new Error('空间表面已不存在')
  const spatial = structuredClone(surface.spatial ?? { home: { x: 0, y: 0, zoom: 1 }, frames: [] })
  change(spatial)
  return { type: 'spatial.set', surfaceId, spatial }
}

export function addSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, pose: ComponentSpatialPose, title?: string): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => spatial.frames.push({ id: crypto.randomUUID(), title: title ?? `镜头 ${spatial.frames.length + 1}`, pose: { ...pose } }))
}
export function renameSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, frameId: string, title: string): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    const frame = spatial.frames.find(value => value.id === frameId)
    if (!frame) throw new Error('镜头已不存在')
    frame.title = title
  })
}
export function reorderSpatialCameraFramesEdit(project: CourseProjectV10, surfaceId: string, frameIds: readonly string[]): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    if (new Set(frameIds).size !== spatial.frames.length || frameIds.length !== spatial.frames.length) throw new Error('镜头顺序已变化，请重新排序')
    spatial.frames = frameIds.map(id => { const frame = spatial.frames.find(value => value.id === id); if (!frame) throw new Error('镜头已不存在'); return frame })
  })
}
export function deleteSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, frameId: string): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    if (!spatial.frames.some(value => value.id === frameId)) throw new Error('镜头已不存在')
    spatial.frames = spatial.frames.filter(value => value.id !== frameId)
    for (const path of spatial.paths ?? []) path.frameIds = path.frameIds.filter(id => id !== frameId)
  })
}
export function setSpatialCameraHomeEdit(project: CourseProjectV10, surfaceId: string, pose: ComponentSpatialPose): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => { spatial.home = { ...pose } })
}
export function updateSpatialCameraFrameEdit(project: CourseProjectV10, surfaceId: string, frameId: string, pose: ComponentSpatialPose): ComponentEdit {
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    const frame = spatial.frames.find(value => value.id === frameId)
    if (!frame) throw new Error('镜头已不存在')
    frame.pose = { ...pose }
  })
}
export function updateSpatialCameraFrameTargetEdit(project: CourseProjectV10, surfaceId: string, frameId: string, instanceId: string | null): ComponentEdit {
  if (instanceId && !spatialWorldTargets(project, surfaceId).some(value => value.instanceId === instanceId)) throw new Error('镜头跟随对象已不在当前世界中')
  return spatialAuthoringEdit(project, surfaceId, spatial => {
    const frame = spatial.frames.find(value => value.id === frameId)
    if (!frame) throw new Error('镜头已不存在')
    if (instanceId) frame.targetInstanceId = instanceId
    else delete frame.targetInstanceId
  })
}
export function fitSpatialComponentWorld(project: CourseProjectV10, surfaceId: string, viewport: { width: number; height: number }): ComponentSpatialPose {
  const points = spatialWorldTargets(project, surfaceId).flatMap(target => [...frameCorners(target.frame, target.parentToSurface)])
  if (!points.length) return project.surfaces.find(value => value.id === surfaceId)?.spatial?.home ?? { x: 0, y: 0, zoom: 1 }
  const left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x))
  const top = Math.min(...points.map(point => point.y)), bottom = Math.max(...points.map(point => point.y))
  return { x: (left + right) / 2, y: (top + bottom) / 2, zoom: Math.min(viewport.width / Math.max(1, right - left), viewport.height / Math.max(1, bottom - top)) * 0.9 }
}

