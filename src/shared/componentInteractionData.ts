import { z } from 'zod'
import { componentDefinitionBuiltinKey, componentIsLocked, componentSurface, owningContainer, type ComponentContainer, type ComponentDefinition, type ComponentInstance, type ComponentTarget, type CourseProjectV10, type JsonValue } from './contracts/component-platform/project'
import type { ComponentEdit } from './contracts/component-platform/operations'
import { sceneInteractionsSchema } from './interactionSchema'
import type { InteractionActionPayload, InteractionRule } from './interactionTypes'
import { courseSoundReference, courseSurfaceReference, prepareCourseInteractionRules, type CourseAuthoringReferences } from '../core/course/courseAuthoringReferences'

export const componentInteractionDataSchema = z.object({ rules: sceneInteractionsSchema }).strict()
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

export const INTERACTIONS_DEFINITION: ComponentDefinition = {
  id: 'guoling.interactions', title: '互动与动画', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' },
}
export const interactionRules = (instance: ComponentInstance | undefined): InteractionRule[] => instance ? componentInteractionDataSchema.parse(instance.data).rules : []

/** Object triggers and the actions they complete form one family, across behavior owners. */
export function associatedInteractionRules(rules: readonly InteractionRule[], instances: ReadonlySet<string>, explicit: ReadonlySet<string> = new Set()): InteractionRule[] {
  const selected = new Set(rules.filter(rule => explicit.has(rule.id) || 'nodeId' in rule.trigger && instances.has(rule.trigger.nodeId)))
  let changed = true
  while (changed) {
    changed = false
    const actions = new Set([...selected].flatMap(rule => rule.actions.map(action => action.id)))
    for (const rule of rules) if (!selected.has(rule) && rule.trigger.type === 'animation.completed' && actions.has(rule.trigger.actionId)) {
      selected.add(rule); changed = true
    }
  }
  return rules.filter(rule => selected.has(rule))
}

export function componentInteractionOwner(project: CourseProjectV10, instance: ComponentInstance): ComponentTarget {
  const attached = instance.attachments?.find(attachment => attachment.instanceId === instance.id)?.target
  if (attached) return attached
  let owner = owningContainer(project, instance.id)
  while (owner?.kind === 'instance') {
    if (project.instances[owner.instanceId]?.container || project.rootIds.includes(owner.instanceId)) return { kind: 'instance', instanceId: owner.instanceId }
    owner = owningContainer(project, owner.instanceId)
  }
  if (owner?.kind === 'project' && project.rootIds.includes(instance.id)) return { kind: 'instance', instanceId: instance.id }
  return owner?.kind === 'surface' ? { kind: 'surface', surfaceId: owner.surfaceId } : { kind: 'project' }
}

/** Keeps the actual writer with every selected family; data overrides use the same relation. */
export function associatedComponentInteractionRules(project: CourseProjectV10, instances: ReadonlySet<string>, explicit: ReadonlySet<string> = new Set(), data: Readonly<Record<string, JsonValue>> = {}) {
  const owners = Object.values(project.instances)
    .filter(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === INTERACTIONS_DEFINITION.id)
    .flatMap(instance => {
      const parsed = componentInteractionDataSchema.safeParse(data[instance.id] ?? instance.data)
      return parsed.success ? [{ instance, target: componentInteractionOwner(project, instance), rules: parsed.data.rules }] : []
    })
  const selectedRules = new Set([...explicit, ...owners.filter(owner => instances.has(owner.instance.id)).flatMap(owner => owner.rules.map(rule => rule.id))])
  const selected = new Set(associatedInteractionRules(owners.flatMap(owner => owner.rules), instances, selectedRules))
  return owners.map(owner => ({ ...owner, rules: owner.rules.filter(rule => selected.has(rule)) })).filter(owner => owner.rules.length)
}
export function interactionBehavior(project: CourseProjectV10, target: ComponentTarget): ComponentInstance | undefined {
  const identity = (value: ComponentTarget) => value.kind === 'surface' ? `instance:${value.surfaceId}`
    : value.kind === 'instance' ? `instance:${value.instanceId}` : JSON.stringify(value)
  return Object.values(project.instances).find(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === INTERACTIONS_DEFINITION.id
    && instance.attachments?.some(attachment => attachment.instanceId === instance.id && identity(attachment.target) === identity(target)))
}
/** Main and Renderer prepare the same canonical interaction edits. */
export function componentRuleEdits(project: CourseProjectV10, target: ComponentTarget, rules: readonly InteractionRule[], references?: CourseAuthoringReferences, behaviorId?: string): ComponentEdit[] {
  const data = componentInteractionDataSchema.parse({ rules: prepareCourseInteractionRules(project, target, rules, references) })
  const current = behaviorId ? project.instances[behaviorId] : interactionBehavior(project, target)
  const before = interactionRules(current)
  for (const rule of [...before, ...data.rules]) {
    const previous = before.find(value => value.id === rule.id), next = data.rules.find(value => value.id === rule.id)
    if (JSON.stringify(previous) === JSON.stringify(next)) continue
    const ids = [...('nodeId' in rule.trigger ? [rule.trigger.nodeId] : []),
      ...rule.actions.flatMap(step => 'nodeId' in step.action ? [step.action.nodeId] : [])]
    if (ids.some(id => componentIsLocked(project, id))) throw new Error('锁定对象的互动不能修改，请先解锁。')
  }
  if (current) return [{ type: 'data.set', instanceId: current.id, path: ['rules'], value: json(data.rules) }]
  const id = crypto.randomUUID()
  const instanceTarget = target.kind === 'surface' ? componentSurface(project, target.surfaceId)?.id
    : target.kind === 'instance' && (project.instances[target.instanceId]?.container || project.rootIds.includes(target.instanceId)) ? target.instanceId : undefined
  const container: ComponentContainer = instanceTarget ? { kind: 'instance', instanceId: instanceTarget } : { kind: 'global', plane: 'underlay' }
  const children = container.kind === 'instance' ? project.instances[container.instanceId]?.childIds ?? [] : project.global.underlay
  if (target.kind === 'surface' && !instanceTarget) throw new Error('互动目标表面已不存在')
  if (!children) throw new Error('互动目标表面已不存在')
  return [
    ...(project.definitions[INTERACTIONS_DEFINITION.id] ? [] : [{ type: 'definition.set' as const, definition: INTERACTIONS_DEFINITION }]),
    { type: 'instance.insert', container, index: children.length, rootIds: [id], instances: [{ id, definitionId: INTERACTIONS_DEFINITION.id,
      name: '互动与动画', data: json(data), attachments: [{ instanceId: id, target }] }] },
  ]
}

/** Copies only the professional rule identities and declared references; prose/source stay intact. */
export function remapComponentInteractionData(data: JsonValue, identities: {
  instances: ReadonlyMap<string, string>; surfaces: ReadonlyMap<string, string>
  rules?: ReadonlyMap<string, string>; actions?: ReadonlyMap<string, string>; stateKeys?: ReadonlyMap<string, string>
}): JsonValue {
  const parsed = componentInteractionDataSchema.parse(data)
  const rules = structuredClone(parsed.rules)
  const steps = identities.actions ?? new Map(rules.flatMap(rule => rule.actions.map(step => [step.id, crypto.randomUUID()] as const)))
  for (const rule of rules) {
    rule.id = identities.rules?.get(rule.id) ?? crypto.randomUUID()
    if ('nodeId' in rule.trigger) rule.trigger.nodeId = identities.instances.get(rule.trigger.nodeId) ?? rule.trigger.nodeId
    if (rule.trigger.type === 'animation.completed') rule.trigger.actionId = steps.get(rule.trigger.actionId) ?? rule.trigger.actionId
    for (const condition of rule.conditions) if (condition.type === 'scene.in') condition.sceneIds = condition.sceneIds.map(id => identities.surfaces.get(id) ?? identities.instances.get(id) ?? id)
    else if (condition.type === 'course-state.exists' || condition.type === 'course-state.compare') condition.key = identities.stateKeys?.get(condition.key) ?? condition.key
    for (const step of rule.actions) {
      step.id = steps.get(step.id)!
      const action = step.action
      if ('nodeId' in action) action.nodeId = identities.instances.get(action.nodeId) ?? action.nodeId
      if ('containerId' in action && action.containerId) action.containerId = identities.instances.get(action.containerId) ?? identities.surfaces.get(action.containerId) ?? action.containerId
      if (action.type === 'scene.go') action.sceneId = identities.surfaces.get(action.sceneId) ?? identities.instances.get(action.sceneId) ?? action.sceneId
      if (action.type === 'location.go') action.locationId = identities.surfaces.get(action.locationId) ?? identities.instances.get(action.locationId) ?? action.locationId
      if (action.type === 'course-state.set') action.key = identities.stateKeys?.get(action.key) ?? action.key
    }
  }
  return json({ rules })
}
/** Software preallocates these IDs when another professional object references a rule family. */
export function createComponentInteractionCopyIdentities(data: JsonValue) {
  const rules = componentInteractionDataSchema.parse(data).rules
  return { rules: new Map(rules.map(rule => [rule.id, crypto.randomUUID()] as const)),
    actions: new Map(rules.flatMap(rule => rule.actions.map(step => [step.id, crypto.randomUUID()] as const))) }
}

export interface ComponentInteractionAuthoringTarget { project: CourseProjectV10; surfaceId: string | null; instanceId: string | null; activeStateId: string | null }
export type ComponentClickNavigationAction = Extract<InteractionActionPayload, { type: 'scene.go' }>

function clickInteractionProgram(target: ComponentInteractionAuthoringTarget) {
  const { project, instanceId } = target
  if (!instanceId || !project.instances[instanceId]) throw new Error('点击互动目标已不存在')
  const visited = new Set<string>()
  const owns = (id: string): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    return id === instanceId || (project.instances[id]?.childIds ?? []).some(owns)
  }
  const global = [...project.global.underlay, ...project.global.overlay].some(owns)
  const families = associatedComponentInteractionRules(project, new Set([instanceId]))
  const clickOwners = families.filter(family => family.rules.some(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === instanceId))
  const actual = clickOwners[0]
  const owner: ComponentTarget = actual?.target ?? componentInteractionOwner(project, project.instances[instanceId])
  const rules = structuredClone(interactionRules(actual?.instance ?? interactionBehavior(project, owner)))
  const matches = clickOwners.length === 1 ? rules.filter(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === instanceId)
    : clickOwners.flatMap(family => family.rules.filter(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === instanceId))
  const simple = matches.length === 1 && families.reduce((count, family) => count + family.rules.length, 0) === 1 && matches[0]!.conditions.length === 0
  const unavailableReason = componentIsLocked(project, instanceId) ? '锁定对象的互动不能修改，请先解锁。'
    : matches.length && !simple ? '此对象已有多条或带条件的点击规则，请在“互动与动画”中选择规则编辑。'
    : target.activeStateId && !global ? '命名状态中的条件点击规则请在“互动与动画”中编辑。' : null
  return { owner, behaviorId: actual?.instance.id, rules, matches, simple, unavailableReason }
}

/** The simple property editor projects the existing click program; reading it never creates a rule. */
export function componentClickNavigationView(target: ComponentInteractionAuthoringTarget) {
  const program = clickInteractionProgram(target)
  const actions = program.matches.flatMap(rule => rule.actions.map(step => step.action))
  const navigation = actions.filter(action => action.type === 'scene.go' || action.type === 'location.go')
  const current = navigation[0]
  return { action: current?.type === 'location.go' ? { type: 'scene.go' as const, sceneId: current.locationId, transition: current.transition }
    : current?.type === 'scene.go' ? current : null,
    otherActions: actions.some(action => action.type !== 'scene.go' && action.type !== 'location.go'),
    unavailableReason: program.unavailableReason ?? (navigation.length > 1 ? '此对象已有多个跳转动作，请在“互动与动画”中编辑。' : null) }
}

/** Edits just the navigation action in the ordinary object's canonical click rule. */
export function componentClickNavigationEdits(target: ComponentInteractionAuthoringTarget, action: ComponentClickNavigationAction | null): ComponentEdit[] {
  const { owner, behaviorId, rules, matches } = clickInteractionProgram(target), view = componentClickNavigationView(target)
  if (view.unavailableReason) throw new Error(view.unavailableReason)
  if (action) {
    const surface = componentSurface(target.project, action.sceneId)
    if (!surface && !target.project.rootIds.includes(action.sceneId)) throw new Error('目标页面已不存在')
    if (action.targetStateId && !surface?.spatial?.frames.some(frame => frame.id === action.targetStateId)
      && !surface?.presentation?.states.some(state => state.id === action.targetStateId)) throw new Error('目标镜头或状态已不存在')
  }
  const current = matches[0]
  if (!current) {
    if (!action) return []
    rules.push({ id: crypto.randomUUID(), name: '点击跳转到镜头', enabled: true,
      trigger: { type: 'node.click', nodeId: target.instanceId! }, conditions: [],
      actions: [{ id: crypto.randomUUID(), start: 'after-previous', delayMs: 0, action }] })
  } else {
    const index = current.actions.findIndex(step => step.action.type === 'scene.go' || step.action.type === 'location.go')
    if (action) {
      if (index >= 0) current.actions[index]!.action = action
      else current.actions.push({ id: crypto.randomUUID(), start: 'after-previous', delayMs: 0, action })
    } else if (index >= 0) {
      current.actions.splice(index, 1)
      if (!current.actions.length) rules.splice(rules.indexOf(current), 1)
    } else return []
  }
  return componentRuleEdits(target.project, owner, rules, undefined, behaviorId)
}

export function componentRevealSequenceEdits(project: CourseProjectV10, target: ComponentTarget, rule: InteractionRule,
  existingRules: readonly InteractionRule[] = interactionRules(interactionBehavior(project, target)), references?: CourseAuthoringReferences): ComponentEdit[] {
  const prepared = prepareCourseInteractionRules(project, target, [rule], references)[0]
  const rules = [...existingRules, prepared]
  const edits = componentRuleEdits(project, target, rules)
  const ids = [...new Set(prepared.actions.flatMap(step => step.action.type === 'node.enter' ? [step.action.nodeId] : []))]
  for (const id of ids) {
    if (!project.instances[id]) throw new Error('依次出现的目标已不存在')
    if (componentIsLocked(project, id)) throw new Error('锁定对象不能用于依次出现模板，请先解锁。')
  }
  return [...ids.map(instanceId => ({ type: 'instance.patch' as const, instanceId, patch: { playbackInitialVisibility: 'hidden' as const } })), ...edits]
}

export function componentClickInteractionEdits(target: ComponentInteractionAuthoringTarget, kind: 'audio-play' | 'location-go' | 'scene.next' | 'scene.previous', value: string | undefined, references?: CourseAuthoringReferences): ComponentEdit[] {
  const { project, instanceId } = target
  if (!instanceId || !project.instances[instanceId]) throw new Error('点击互动目标已不存在')
  if (componentIsLocked(project, instanceId)) throw new Error('锁定对象的互动不能修改，请先解锁。')
  if (kind === 'audio-play' || kind === 'location-go')
    value = kind === 'audio-play' ? courseSoundReference(project, value ?? '', references) : courseSurfaceReference(project, value ?? '', references)
  if (kind === 'audio-play' && !project.media?.audio.sounds[value ?? '']) throw new Error('声音已不存在')
  if (kind === 'location-go' && !componentSurface(project, value!) && !project.rootIds.includes(value!)) throw new Error('目标页面已不存在')
  const { owner, behaviorId, rules, matches, simple, unavailableReason } = clickInteractionProgram(target)
  if (unavailableReason) throw new Error(unavailableReason)
  const action = kind === 'audio-play' ? { type: 'audio.play' as const, soundId: value! }
    : kind === 'location-go' ? { type: 'location.go' as const, locationId: value! } : { type: kind }
  if (simple) {
    const step = matches[0]!.actions.find(step => step.action.type === action.type
      || kind !== 'audio-play' && ['scene.go', 'location.go', 'scene.next', 'scene.previous'].includes(step.action.type))
    if (step) step.action = action
    else matches[0]!.actions.push({ id: crypto.randomUUID(), start: 'after-previous', delayMs: 0, action })
  }
  else rules.push({ id: crypto.randomUUID(), name: kind === 'audio-play' ? '点击播放声音' : '点击前往页面', enabled: true,
    trigger: { type: 'node.click', nodeId: instanceId }, conditions: [],
    actions: [{ id: crypto.randomUUID(), start: 'after-previous', delayMs: 0, action }] })
  return componentRuleEdits(project, owner, rules, undefined, behaviorId)
}

export function duplicateComponentRule(rule: InteractionRule): InteractionRule {
  const next = structuredClone(rule), actions = new Map(next.actions.map(step => [step.id, crypto.randomUUID()]))
  next.id = crypto.randomUUID(); next.name += ' 副本'
  next.actions = next.actions.map(step => ({ ...step, id: actions.get(step.id)! }))
  if (next.trigger.type === 'animation.completed' && actions.has(next.trigger.actionId)) next.trigger.actionId = actions.get(next.trigger.actionId)!
  return next
}

/** Removing an action also removes its completion program, including later followers. */
export function removeComponentRule(rules: readonly InteractionRule[], ruleId: string): InteractionRule[] {
  if (!rules.some(rule => rule.id === ruleId)) throw new Error('互动规则已不存在')
  const removed = new Set([ruleId]), actions = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const rule of rules) if (removed.has(rule.id)) for (const step of rule.actions) actions.add(step.id)
    for (const rule of rules) if (!removed.has(rule.id) && rule.trigger.type === 'animation.completed' && actions.has(rule.trigger.actionId)) {
      removed.add(rule.id); changed = true
    }
  }
  return rules.filter(rule => !removed.has(rule.id))
}

/** Click rules and automation have separate lists in the editor; move within that list. */
export function moveComponentRule(rules: readonly InteractionRule[], ruleId: string, direction: -1 | 1): InteractionRule[] {
  const index = rules.findIndex(rule => rule.id === ruleId)
  if (index < 0) throw new Error('互动规则已不存在')
  const click = rules[index].trigger.type === 'node.click'
  let next = index + direction
  while (next >= 0 && next < rules.length && (rules[next].trigger.type === 'node.click') !== click) next += direction
  if (next < 0 || next >= rules.length) return [...rules]
  const result = [...rules], [current] = result.splice(index, 1)
  result.splice(next, 0, current)
  return result
}
