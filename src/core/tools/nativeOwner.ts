import type { CourseProjectDocument, LayerItem } from '../../shared/courseProjectTypes'
import type { ToolTarget } from '../../shared/workbench/tools'
import { slideSceneContext } from './slideInsertion'
import { resolveSpatialSurface } from './spatialInsertion'

export function resolveNativeOwner(project: CourseProjectDocument, target: Extract<ToolTarget, { kind: 'course-owner' }>) {
  const location = project.locations.find(value => value.id === target.locationId)
  if (!location) throw new Error('创建目标位置不存在')
  const surface = project.surfaces.find(value => value.id === location.surfaceId)
  if (!surface) throw new Error('创建目标表面不存在')
  if (target.stateId && (surface.type !== 'slide' || target.owner !== 'scene')) throw new Error('只有 Slide 场景 owner 可绑定命名态')
  if (target.insertionOrigin && (surface.type !== 'spatial-2d' || target.owner !== 'world')) throw new Error('插入中心只属于 Spatial 世界 owner')
  if (target.insertionOrigin && ![target.insertionOrigin.x, target.insertionOrigin.y].every(Number.isFinite)) throw new Error('插入中心坐标无效')
  let items: LayerItem[], center: { x: number; y: number } | undefined
  if (surface.type === 'slide') {
    if (!['scene', 'surface', 'global'].includes(target.owner)) throw new Error('Slide 不支持该创建 owner')
    const { scene } = slideSceneContext(project, { scope: target.owner, selection: { locationId: target.locationId, stateId: target.stateId ?? null } })
    if (target.stateId && !scene.presentation?.states.some(state => state.id === target.stateId)) throw new Error('创建目标命名态不存在')
    items = target.owner === 'scene' ? scene.layerItems : target.owner === 'surface' ? surface.surfaceLayerItems.map(entry => entry.item) : project.globalLayerItems.map(entry => entry.item)
  } else if (surface.type === 'flow') {
    if (target.owner !== 'surface' && target.owner !== 'global') throw new Error('Flow 浮层只支持 surface/global owner')
    items = (target.owner === 'global' ? project.globalLayerItems : surface.surfaceLayerItems).map(entry => entry.item)
  } else {
    if (target.owner !== 'world') throw new Error('Spatial 创建只支持 world owner')
    const { frame } = resolveSpatialSurface(project, target.locationId)
    center = target.insertionOrigin ? { ...target.insertionOrigin } : { x: frame.x, y: frame.y }
    items = surface.world.layerItems
  }
  return { location, surface, items, center }
}
