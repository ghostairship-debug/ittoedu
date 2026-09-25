import { z } from 'zod'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ToolTarget } from '../../shared/workbench/tools'
import { slideSceneContext } from './slideInsertion'
/** Name normalization remains in the shared domain planners used by manual editing. */
export const presentationStateNameSchema = z.string()
export function stateToolContext(project: CourseProjectDocument, target: ToolTarget) {
  if (target.kind !== 'course-state' && (target.kind !== 'course-owner' || target.owner !== 'scene' || target.stateId)) throw new Error('状态操作需要明确的状态或场景基础态 owner')
  const context = slideSceneContext(project, { scope: 'scene', selection: { locationId: target.locationId, stateId: target.kind === 'course-state' ? target.stateId : null } })
  const state = target.kind === 'course-state' ? context.scene.presentation?.states.find(state => state.id === target.stateId) : undefined
  if (target.kind === 'course-state' && !state) throw new Error('命名状态不存在或不属于目标场景')
  return { ...context, state }
}
export function stateChildren(project: CourseProjectDocument, locationId: string): { target: ToolTarget; label: string }[] {
  const location = project.locations.find(location => location.id === locationId)
  if (location?.kind !== 'slide-scene') return []
  const { scene } = stateToolContext(project, { kind: 'course-owner', owner: 'scene', locationId })
  return (scene.presentation?.states ?? []).map(state => ({ target: { kind: 'course-state', locationId, stateId: state.id }, label: state.name }))
}
