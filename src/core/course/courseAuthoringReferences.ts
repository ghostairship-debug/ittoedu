import { componentContainerForInstance, componentSurface } from '../../shared/contracts/component-platform/project'
import type { ComponentFlowPlacement, ComponentInstance, ComponentTarget, CourseProjectLogic, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { InteractionAction, InteractionCondition, InteractionRule, InteractionTrigger } from '../../shared/interactionTypes'
import { componentAudioSounds } from '../../shared/componentAudioSounds'

/** Current facts captured by the input adapter, never a public model-authored registry. */
export type CourseAuthoringReference =
  | { kind: 'unavailable' } // A known host token outside this run/document/epoch is never authored literal data.
  | { kind: 'instance'; instanceId: string }
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'presentation-state'; surfaceId: string; stateId: string }
  | { kind: 'sound'; soundId: string }
  | { kind: 'action'; actionId: string; owner: ComponentTarget }
  | { kind: 'rule'; ruleId: string; owner: ComponentTarget }
export type CourseAuthoringReferences = ReadonlyMap<string, CourseAuthoringReference>

function mismatch(value: string, role: string): never { throw new Error(`引用“${value}”不是${role}目标`) }
export function courseSurfaceReference(project: CourseProjectV10, value: string, references?: CourseAuthoringReferences): string {
  const reference = references?.get(value)
  if (!reference) return value // Existing human selections and observed canonical references remain supported.
  const id = reference.kind === 'instance' ? reference.instanceId
    : reference.kind === 'surface' || reference.kind === 'presentation-state' ? reference.surfaceId : mismatch(value, '页面')
  if (!componentSurface(project,id) && !project.rootIds.includes(id)) throw new Error('引用的页面已不存在')
  return id
}
export function courseRootReference(project: CourseProjectV10, value: string, references?: CourseAuthoringReferences): string {
  const id = courseSurfaceReference(project,value,references)
  if (references?.has(value) && !project.rootIds.includes(id)) throw new Error('引用不属于作品根目录')
  return id
}
function containerReference(project: CourseProjectV10, value: string, references?: CourseAuthoringReferences): string {
  const id = courseSurfaceReference(project,value,references)
  if (references?.has(value) && !componentSurface(project,id)) throw new Error('引用的对象不是可呈现容器')
  return id
}
function instanceReference(project: CourseProjectV10, value: string, references?: CourseAuthoringReferences): string {
  const reference = references?.get(value)
  if (!reference) return value
  if (reference.kind !== 'instance') return mismatch(value, '对象')
  if (!project.instances[reference.instanceId]) throw new Error('引用的对象已不存在')
  return reference.instanceId
}
function stateReference(project: CourseProjectV10, value: string, surfaceId: string | null, references?: CourseAuthoringReferences): string {
  const reference = references?.get(value)
  if (!reference) return value
  if (reference.kind !== 'presentation-state') return mismatch(value, '命名状态')
  if (surfaceId && reference.surfaceId !== surfaceId) throw new Error('命名状态引用属于另一页面')
  if (!componentSurface(project,reference.surfaceId)?.presentation?.states.some(state => state.id === reference.stateId)) throw new Error('引用的命名状态已不存在')
  return reference.stateId
}
function stateScope(project: CourseProjectV10, owner: ComponentTarget): string | null {
  if (owner.kind === 'surface') return owner.surfaceId
  if (owner.kind === 'instance' || owner.kind === 'text-range') return componentSurface(project,owner.instanceId)?.id
    ?? componentContainerForInstance(project,owner.instanceId)?.id ?? null
  return null
}
export function courseSoundReference(project: CourseProjectV10, value: string, references?: CourseAuthoringReferences): string {
  const reference = references?.get(value)
  if (!reference) return value
  if (reference.kind !== 'sound') return mismatch(value, '声音')
  if (!componentAudioSounds(project)[reference.soundId]) throw new Error('引用的声音已不存在')
  return reference.soundId
}
function scopedReference(value: string, kind: 'action' | 'rule', owner: ComponentTarget, references?: CourseAuthoringReferences): string {
  const reference = references?.get(value)
  if (!reference) return value
  if (reference.kind !== kind) return mismatch(value, kind === 'rule' ? '规则' : '动作')
  const captured = reference.owner
  const identity = (target: ComponentTarget) => target.kind === 'surface' ? target.surfaceId : target.kind === 'instance' ? target.instanceId : undefined
  const sameOwner = captured.kind === 'project' && owner.kind === 'project'
    || identity(captured) !== undefined && identity(captured) === identity(owner)
    || captured.kind === 'text-range' && owner.kind === 'text-range' && captured.instanceId === owner.instanceId
      && captured.rangeId === owner.rangeId && captured.dataPath.join('\0') === owner.dataPath.join('\0')
  if (!sameOwner) throw new Error('规则或动作引用属于另一互动范围')
  return reference.kind === 'rule' ? reference.ruleId : reference.actionId
}
export function courseInteractionRuleReference(value: string, owner: ComponentTarget, references?: CourseAuthoringReferences): string {
  return scopedReference(value, 'rule', owner, references)
}

function triggerReferences(project: CourseProjectV10, owner: ComponentTarget, trigger: InteractionTrigger, references?: CourseAuthoringReferences): InteractionTrigger {
  switch (trigger.type) {
    case 'node.click': case 'component.event': case 'video.started': case 'video.paused': case 'video.ended':
    case 'video.time': case 'node.activated': case 'input.submit':
      return { ...trigger, nodeId: instanceReference(project, trigger.nodeId, references) }
    case 'presentation.enter': return { ...trigger, stateId: stateReference(project, trigger.stateId, stateScope(project,owner), references) }
    case 'audio.ended': return { ...trigger, soundId: courseSoundReference(project, trigger.soundId, references) }
    case 'animation.completed': return { ...trigger, actionId: scopedReference(trigger.actionId, 'action', owner, references) }
    default: return { ...trigger }
  }
}
function conditionReferences(project: CourseProjectV10, owner: ComponentTarget, condition: InteractionCondition, references?: CourseAuthoringReferences): InteractionCondition {
  if (condition.type === 'scene.in') return { ...condition, sceneIds: condition.sceneIds.map(value => courseRootReference(project, value, references)) }
  if (condition.type === 'presentation.in') return { ...condition, stateIds: condition.stateIds.map(value => stateReference(project, value, stateScope(project,owner), references)) }
  return { ...condition }
}
/** Only declared platform-reference fields change; event names, state keys, values and prose stay authored. */
export function prepareCourseInteractionAction(project: CourseProjectV10, owner: ComponentTarget, action: InteractionAction, references?: CourseAuthoringReferences): InteractionAction {
  switch (action.type) {
    case 'node.enter': case 'node.exit': case 'video.play': case 'video.pause': case 'video.restart': case 'video.stop': case 'video.toggle': case 'video.seek':
      return { ...action, nodeId: instanceReference(project, action.nodeId, references) }
    case 'step.next': case 'step.previous': return { ...action,
      ...(action.containerId !== undefined ? { containerId: containerReference(project,action.containerId,references) } : {}) }
    case 'location.go': return { ...action, locationId: courseRootReference(project, action.locationId, references),
      ...(action.containerId !== undefined ? { containerId: containerReference(project,action.containerId,references) } : {}) }
    case 'scene.go': {
      const sceneId = courseRootReference(project, action.sceneId, references)
      return { ...action, sceneId, ...(action.targetStateId !== undefined ? { targetStateId: stateReference(project, action.targetStateId, sceneId, references) } : {}) }
    }
    case 'presentation.set': {
      const containerId = action.containerId !== undefined ? containerReference(project,action.containerId,references) : undefined
      return { ...action, ...(containerId !== undefined ? { containerId } : {}),
        stateId: stateReference(project,action.stateId,containerId ?? stateScope(project,owner),references) }
    }
    case 'audio.play': return { ...action, soundId: courseSoundReference(project, action.soundId, references) }
    case 'audio.pause': case 'audio.resume': case 'audio.stop': case 'audio.toggle-mute':
      return { ...action, target: action.target.kind === 'sound' ? { ...action.target, soundId: courseSoundReference(project, action.target.soundId, references) } : { ...action.target } }
    default: return { ...action }
  }
}
export function prepareCourseInteractionRules(project: CourseProjectV10, owner: ComponentTarget, rules: readonly InteractionRule[], references?: CourseAuthoringReferences): InteractionRule[] {
  return rules.map(rule => ({ ...rule, trigger: triggerReferences(project, owner, rule.trigger, references),
    conditions: rule.conditions.map(condition => conditionReferences(project, owner, condition, references)),
    actions: rule.actions.map(step => ({ ...step, action: prepareCourseInteractionAction(project, owner, step.action, references) })) }))
}
export function prepareCourseVisibility(project: CourseProjectV10, visibility: NonNullable<ComponentInstance['visibility']>, references?: CourseAuthoringReferences): NonNullable<ComponentInstance['visibility']> {
  return { ...visibility, surfaceIds: visibility.surfaceIds.map(value => courseSurfaceReference(project, value, references)) }
}
export function prepareCourseFlowPlacement(project: CourseProjectV10, placement: ComponentFlowPlacement, references?: CourseAuthoringReferences): ComponentFlowPlacement {
  return { ...placement, ...(placement.paragraphAnchor ? { paragraphAnchor: { ...placement.paragraphAnchor,
    blockId: instanceReference(project, placement.paragraphAnchor.blockId, references) } } : {}) }
}
export function prepareCourseNavigationGuard(project: CourseProjectV10, guard: CourseProjectLogic['navigationGuards'][number], references?: CourseAuthoringReferences): CourseProjectLogic['navigationGuards'][number] {
  return { ...guard, ...(guard.fromSurfaceIds ? { fromSurfaceIds: guard.fromSurfaceIds.map(value => courseRootReference(project, value, references)) } : {}),
    toSurfaceIds: guard.toSurfaceIds.map(value => courseRootReference(project, value, references)) }
}
