import { z } from 'zod'
import type { JsonValue } from './contracts/component-platform/project'
import { sceneInteractionsSchema } from './interactionSchema'

export const componentInteractionDataSchema = z.object({ rules: sceneInteractionsSchema }).strict()
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

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
