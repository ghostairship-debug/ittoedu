import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ToolTarget } from '../../shared/workbench/tools'
import { composeCourseProjectLocation } from '../../shared/courseLayerComposition'
import { locateCourseLayer } from '../drivers/course/layerProperties'
import { makeEffectiveLayerAuthoringAddress, namedState } from './layerCommands'

export type ObjectTarget = Extract<ToolTarget, { kind: 'course-object' }>
/** Canonical composition supplies owner, plane, lock and exact-state geometry, regardless of mounting. */
export function layerToolContext(project: CourseProjectDocument, target: ToolTarget) {
  if (target.kind !== 'course-object') throw new Error('图层操作需要对象句柄')
  const located = locateCourseLayer(project, target.itemId)
  const composition = composeCourseProjectLocation({ project, locationId: target.locationId, stateId: target.stateId ?? null })
  const entry = composition.entries.find(entry => entry.item.layerItemId === target.itemId)
  if (target.stateId && (!located || !namedState(project, located, target.stateId))) throw new Error('对象命名态不存在或不属于 scene owner')
  if (!located || !entry) throw new Error('对象不属于目标位置')
  return { located, entry, composition, command: { authoringAddress: makeEffectiveLayerAuthoringAddress(project.id, located), locationId: target.locationId, stateId: target.stateId ?? null }, target }
}
export function sameLayerGroup(left: ReturnType<typeof layerToolContext>, right: ReturnType<typeof layerToolContext>): boolean {
  return left.target.locationId === right.target.locationId && left.target.stateId === right.target.stateId && left.entry.source === right.entry.source
    && left.entry.globalPlane === right.entry.globalPlane && left.entry.flowBodyPlane === right.entry.flowBodyPlane
}
export function requireLayerOwner(project: CourseProjectDocument, target: ToolTarget, owner: ToolTarget) {
  const context = layerToolContext(project, target)
  if (owner.kind !== 'course-owner' || owner.locationId !== context.target.locationId || owner.owner !== context.entry.source || owner.stateId !== context.target.stateId) throw new Error('复制或排序需要相同命名态或基础态 owner 授权')
  return context
}
