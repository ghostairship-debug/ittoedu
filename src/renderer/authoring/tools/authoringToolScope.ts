import type { AuthoringToolDestinationV1 } from '../../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { courseAuthoringScopeFromLocation, resolveCourseLocation } from '../courseAuthoringScope'

export function resolveAuthoringToolScope(document: CourseProjectDocument, destination: AuthoringToolDestinationV1) {
  const target = destination.kind === 'update' ? destination.target : destination.scope
  if (target.projectId !== document.id || target.documentRevision !== document.revision) throw new Error('工程或 revision 已失效')
  const { surface, location } = resolveCourseLocation(document, target.locationId)
  const scope = courseAuthoringScopeFromLocation({ project: document, locationId: target.locationId, owner: target.owner, stateId: target.stateId })
  if (surface.type !== target.surfaceType || surface.id !== target.surfaceId || scope.ownerKey !== target.ownerKey) throw new Error('canonical target 的 Surface / owner 不匹配')
  if (target.owner === 'world' && surface.type !== 'spatial-2d') throw new Error('world owner 只能用于 Spatial')
  if (target.owner === 'scene' && surface.type !== 'slide') throw new Error('scene owner 只能用于 Slide')
  if (surface.type !== 'slide' && target.stateId !== null) throw new Error('非 Slide target 不允许 stateId')
  if (surface.type === 'slide' && location.kind === 'slide-scene' && target.stateId !== null) {
    const scene = surface.scenes.find((entry) => entry.id === location.sceneId)
    if (!scene?.presentation?.states.some((state) => state.id === target.stateId)) throw new Error('目标呈现状态已失效')
  }
  return { target, surface, location, scope }
}

export function insertionIndex(ids: readonly string[], insertion: { kind: 'append' } | { kind: 'before' | 'after'; siblingId: string }): number {
  if (insertion.kind === 'append') return ids.length
  const index = ids.indexOf(insertion.siblingId)
  if (index < 0) throw new Error('插入位置的相邻对象已失效')
  return index + (insertion.kind === 'after' ? 1 : 0)
}
