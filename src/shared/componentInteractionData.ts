import { z } from 'zod'
import { componentDefinitionBuiltinKey, componentIsLocked, type ComponentDefinition, type ComponentInstance, type ComponentTarget, type CourseProjectV10, type JsonValue } from './contracts/component-platform/project'
import type { ComponentEdit } from './contracts/component-platform/operations'
import { sceneInteractionsSchema } from './interactionSchema'
import type { InteractionRule } from './interactionTypes'
import { courseSoundReference, courseSurfaceReference, prepareCourseInteractionRules, type CourseAuthoringReferences } from '../core/course/courseAuthoringReferences'

export const componentInteractionDataSchema = z.object({ rules: sceneInteractionsSchema }).strict()
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

export const INTERACTIONS_DEFINITION: ComponentDefinition = {
  id: 'guoling.interactions', title: '互动与动画', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' },
}
export const interactionRules = (instance: ComponentInstance | undefined): InteractionRule[] => instance ? componentInteractionDataSchema.parse(instance.data).rules : []
export function interactionBehavior(project: CourseProjectV10, target: ComponentTarget): ComponentInstance | undefined {
  return Object.values(project.instances).find(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === INTERACTIONS_DEFINITION.id
    && instance.attachments?.some(attachment => attachment.instanceId === instance.id && JSON.stringify(attachment.target) === JSON.stringify(target)))
}
/** Main and Renderer prepare the same canonical interaction edits. */
export function componentRuleEdits(project: CourseProjectV10, target: ComponentTarget, rules: readonly InteractionRule[], references?: CourseAuthoringReferences): ComponentEdit[] {
  const data = componentInteractionDataSchema.parse({ rules: prepareCourseInteractionRules(project, target, rules, references) })
  const current = interactionBehavior(project, target)
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
  const container = target.kind === 'surface' ? { kind: 'surface' as const, surfaceId: target.surfaceId } : { kind: 'global' as const, plane: 'underlay' as const }
  const children = container.kind === 'surface' ? project.surfaces.find(surface => surface.id === container.surfaceId)?.childIds : project.global.underlay
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
    for (const condition of rule.conditions) if (condition.type === 'scene.in') condition.sceneIds = condition.sceneIds.map(id => identities.surfaces.get(id) ?? id)
    else if (condition.type === 'course-state.exists' || condition.type === 'course-state.compare') condition.key = identities.stateKeys?.get(condition.key) ?? condition.key
    for (const step of rule.actions) {
      step.id = steps.get(step.id)!
      const action = step.action
      if ('nodeId' in action) action.nodeId = identities.instances.get(action.nodeId) ?? action.nodeId
      if (action.type === 'scene.go') action.sceneId = identities.surfaces.get(action.sceneId) ?? action.sceneId
      if (action.type === 'location.go') action.locationId = identities.surfaces.get(action.locationId) ?? action.locationId
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

export function componentClickInteractionEdits(target: ComponentInteractionAuthoringTarget, kind: 'audio-play' | 'location-go', value: string, references?: CourseAuthoringReferences): ComponentEdit[] {
  const { project, instanceId, surfaceId, activeStateId } = target
  if (!instanceId || !project.instances[instanceId] || !surfaceId) throw new Error('点击互动目标已不存在')
  if (componentIsLocked(project, instanceId)) throw new Error('锁定对象的互动不能修改，请先解锁。')
  value = kind === 'audio-play' ? courseSoundReference(project, value, references) : courseSurfaceReference(project, value, references)
  if (kind === 'audio-play' && !project.media?.audio.sounds[value]) throw new Error('声音已不存在')
  if (kind === 'location-go' && !project.surfaces.some(surface => surface.id === value)) throw new Error('目标页面已不存在')
  const visited = new Set<string>()
  const owns = (id: string): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    return id === instanceId || (project.instances[id]?.childIds ?? []).some(owns)
  }
  const global = [...project.global.underlay, ...project.global.overlay].some(owns)
  const owner: ComponentTarget = global ? { kind: 'project' } : { kind: 'surface', surfaceId }
  const rules = structuredClone(interactionRules(interactionBehavior(project, owner)))
  const matches = rules.filter(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === instanceId)
  const simple = matches.length === 1 && matches[0]!.conditions.length === 0
  if (matches.length && !simple) throw new Error('此对象已有多条或带条件的点击规则，请在“互动与动画”中选择规则编辑。')
  if (activeStateId) throw new Error('命名状态中的条件点击规则请在“互动与动画”中编辑。')
  const action = kind === 'audio-play' ? { type: 'audio.play' as const, soundId: value } : { type: 'location.go' as const, locationId: value }
  if (simple) {
    const step = matches[0]!.actions.find(step => step.action.type === action.type)
    if (step) step.action = action
    else matches[0]!.actions.push({ id: crypto.randomUUID(), start: 'after-previous', delayMs: 0, action })
  }
  else rules.push({ id: crypto.randomUUID(), name: kind === 'audio-play' ? '点击播放声音' : '点击前往页面', enabled: true,
    trigger: { type: 'node.click', nodeId: instanceId }, conditions: [],
    actions: [{ id: crypto.randomUUID(), start: 'after-previous', delayMs: 0, action }] })
  return componentRuleEdits(project, owner, rules)
}

export function duplicateComponentRule(rule: InteractionRule): InteractionRule {
  const next = structuredClone(rule), actions = new Map(next.actions.map(step => [step.id, crypto.randomUUID()]))
  next.id = crypto.randomUUID(); next.name += ' 副本'
  next.actions = next.actions.map(step => ({ ...step, id: actions.get(step.id)! }))
  if (next.trigger.type === 'animation.completed' && actions.has(next.trigger.actionId)) next.trigger.actionId = actions.get(next.trigger.actionId)!
  return next
}
