import { z } from 'zod'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ToolTarget } from '../../shared/workbench/tools'
import { STAGE_VIEWPORT_WIDTH, STAGE_VIEWPORT_HEIGHT } from '../../shared/stageViewport'
import { spatialStructureToolInputSchema, spatialGatewayInputSchema } from './spatialStructureSchema'
import { spatialSurfaceIn, resolveSpatialSurface } from './spatialInsertion'
import { locateCourseLayer } from '../drivers/course/layerProperties'
import { addSpatialEditorCameraFrame, renameSpatialCameraFrame, updateSpatialCameraFramePose, deleteSpatialCameraFrame, setSpatialCameraHome } from './spatialCamera'
import { addSpatialPath, updateSpatialPath, deleteSpatialPath } from './spatialPath'
import { addSpatialRelation, updateSpatialRelation, deleteSpatialRelation } from './spatialRelation'
import { spatialHasWorldContent, spatialCameraFittingWorldContent } from './spatialWorldFit'

export function spatialReferenceHandles(value: z.infer<typeof spatialGatewayInputSchema>): string[] {
  if ('path' in value) return value.path.layerItemIds ?? []
  if ('relation' in value) return [value.relation.sourceLayerItemId, value.relation.targetLayerItemId].filter((id): id is string => id !== undefined)
  return []
}

/** All authority is already resolved by Gateway; planners receive exact domain identities only here. */
export function planSpatialStructure(project: CourseProjectDocument, target: ToolTarget,
  input: z.infer<typeof spatialGatewayInputSchema>, references: readonly ToolTarget[], fitSurface?: ToolTarget,
): { project: CourseProjectDocument; target: ToolTarget } {
  const operation = input.operation
  let surfaceId: string, frameId: string | undefined
  if (operation === 'add-camera' || operation === 'set-home' || operation === 'add-path' || operation === 'add-relation') {
    if (target.kind !== 'course-surface') throw new Error('创建空间结构或设置home需要明确surface句柄')
    surfaceId = target.surfaceId
  } else if (operation === 'update-camera' || operation === 'delete-camera' || operation === 'fit-world-content') {
    if (target.kind !== 'course-location') throw new Error('镜头操作需要明确location句柄')
    const resolved = resolveSpatialSurface(project, target.locationId)
    surfaceId = resolved.surface.id; frameId = resolved.frame.id
    if (operation === 'fit-world-content' && (fitSurface?.kind !== 'course-surface' || fitSurface.surfaceId !== surfaceId)) throw new Error('取景需要同一surface的写权限')
  } else {
    const graph = operation.endsWith('path') ? 'path' : 'relation'
    if (target.kind !== 'spatial-graph' || target.graph !== graph) throw new Error('空间结构操作需要匹配的graph句柄')
    surfaceId = target.surfaceId
  }
  const surface = spatialSurfaceIn(project, surfaceId)
  const ids = references.map(reference => {
    if (reference.kind !== 'course-object' || reference.stateId) throw new Error('路径和关系端点需要world对象句柄')
    const location = project.locations.find(location => location.id === reference.locationId)
    const layer = locateCourseLayer(project, reference.itemId)
    if (location?.surfaceId !== surfaceId || layer?.surfaceId !== surfaceId || layer.source !== 'world') throw new Error('路径和关系只能引用同一surface的world对象')
    return reference.itemId
  })
  const { target: _target, ...raw } = input
  if ('surface' in raw) delete (raw as {surface?:string}).surface
  if ('path' in raw && raw.path.layerItemIds !== undefined) raw.path = { ...raw.path, layerItemIds: ids }
  if ('relation' in raw) {
    let index = 0
    raw.relation = { ...raw.relation,
      ...(raw.relation.sourceLayerItemId !== undefined ? { sourceLayerItemId: ids[index++] } : {}),
      ...(raw.relation.targetLayerItemId !== undefined ? { targetLayerItemId: ids[index++] } : {}),
    }
  }
  const value = spatialStructureToolInputSchema.parse(raw)
  let next = project
  switch (value.operation) {
    case 'add-camera': next = addSpatialEditorCameraFrame(next, surfaceId, value.pose, { name: value.name }); break
    case 'update-camera':
      if (value.name !== undefined) next = renameSpatialCameraFrame(next, surfaceId, frameId!, value.name)
      if (value.pose !== undefined) next = updateSpatialCameraFramePose(next, surfaceId, frameId!, value.pose)
      break
    case 'delete-camera': next = deleteSpatialCameraFrame(next, surfaceId, frameId!); break
    case 'set-home': next = setSpatialCameraHome(next, surfaceId, value.pose); break
    case 'fit-world-content': {
      if (target.kind !== 'course-location') throw new Error('取景需要location')
      if (!spatialHasWorldContent(next, target.locationId)) break
      const pose = spatialCameraFittingWorldContent(next, target.locationId, { viewportWidth: STAGE_VIEWPORT_WIDTH, viewportHeight: STAGE_VIEWPORT_HEIGHT })
      next = setSpatialCameraHome(next, surfaceId, pose)
      next = updateSpatialCameraFramePose(next, surfaceId, frameId!, pose)
      break
    }
    case 'add-path': next = addSpatialPath(next, { surfaceId, ...value.path }); break
    case 'update-path': if (target.kind === 'spatial-graph') next = updateSpatialPath(next, surfaceId, target.graphId, value.path); break
    case 'delete-path': if (target.kind === 'spatial-graph') next = deleteSpatialPath(next, surfaceId, target.graphId); break
    case 'add-relation': next = addSpatialRelation(next, { surfaceId, ...value.relation }); break
    case 'update-relation': if (target.kind === 'spatial-graph') next = updateSpatialRelation(next, surfaceId, target.graphId, value.relation); break
    case 'delete-relation': if (target.kind === 'spatial-graph') next = deleteSpatialRelation(next, surfaceId, target.graphId); break
  }
  if (operation.startsWith('add-')) {
    const nextSurface = spatialSurfaceIn(next, surfaceId)
    if (operation === 'add-camera') {
      const location = next.locations.find(location => !project.locations.some(old => old.id === location.id))!
      target = { kind: 'course-location', locationId: location.id }
    } else {
      const graph = operation === 'add-path' ? 'path' : 'relation'
      const previous = graph === 'path' ? surface.world.paths : surface.world.relations
      const created = (graph === 'path' ? nextSurface.world.paths : nextSurface.world.relations)!.find(entity => !previous?.some(old => old.id === entity.id))!
      target = { kind: 'spatial-graph', surfaceId, graph, graphId: created.id }
    }
  }
  return { project: next, target }
}
