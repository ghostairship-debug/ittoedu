import { z } from 'zod'
import { componentDefinitionBuiltinKey, componentIsLocked, type ComponentDefinition, type ComponentInstance, type ComponentTarget, type CourseProjectV10, type JsonValue } from './contracts/component-platform/project'
import type { ComponentEdit } from './contracts/component-platform/operations'
import { sceneInteractionsSchema } from './interactionSchema'
import type { InteractionRule } from './interactionTypes'

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
export function componentRuleEdits(project: CourseProjectV10, target: ComponentTarget, rules: readonly InteractionRule[]): ComponentEdit[] {
  const data = componentInteractionDataSchema.parse({ rules })
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
