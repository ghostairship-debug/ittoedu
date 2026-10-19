import type { ComponentEdit } from './contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked } from './contracts/component-platform/project'
import { componentInteractionDataSchema, componentInteractionOwner, componentRuleEdits,
  interactionBehavior, interactionRules, type ComponentInteractionAuthoringTarget } from './componentInteractionData'
import { isNodeMotionAction, type InteractionRule, type MotionDirection, type MotionEasing, type MotionEffect, type NodeMotionAction } from './interactionTypes'

export interface ComponentMotionPreset {
  effect: MotionEffect
  direction?: MotionDirection
  durationMs: number
  delayMs: number
  easing: MotionEasing
}
export const DEFAULT_COMPONENT_MOTION: ComponentMotionPreset = { effect: 'fade', durationMs: 320, delayMs: 0, easing: 'ease-out' }
export interface ComponentMotionActionView {
  behaviorId: string
  ruleId: string
  stepId: string
  label: string
  enabled: boolean
  config: ComponentMotionPreset
}

function programs(target: ComponentInteractionAuthoringTarget) {
  return Object.values(target.project.instances).flatMap(instance => {
    if (componentDefinitionBuiltinKey(target.project.definitions[instance.definitionId]) !== 'guoling.interactions') return []
    const parsed = componentInteractionDataSchema.safeParse(instance.data)
    const owner = componentInteractionOwner(target.project, instance)
    return parsed.success && (owner.kind !== 'surface' || owner.surfaceId === target.surfaceId)
      ? [{ instance, owner, rules: parsed.data.rules }] : []
  })
}
function applies(rule: InteractionRule, target: ComponentInteractionAuthoringTarget): boolean {
  return rule.conditions.every(condition => condition.type === 'presentation.in'
    ? target.activeStateId !== null && condition.stateIds.includes(target.activeStateId)
    : condition.type !== 'scene.in' || target.surfaceId !== null && condition.sceneIds.includes(target.surfaceId))
}
function simpleEntrance(rule: InteractionRule, target: ComponentInteractionAuthoringTarget): boolean {
  if (rule.trigger.type !== 'node.activated' || rule.trigger.nodeId !== target.instanceId || rule.actions.length !== 1) return false
  const step = rule.actions[0]!
  if (step.start !== 'after-previous' || step.action.type !== 'node.enter' || step.action.nodeId !== target.instanceId) return false
  return target.activeStateId === null ? rule.conditions.length === 0 : rule.conditions.length === 1
    && rule.conditions[0]!.type === 'presentation.in' && rule.conditions[0]!.stateIds.length === 1
    && rule.conditions[0]!.stateIds[0] === target.activeStateId
}
function preset(action: NodeMotionAction, delayMs: number): ComponentMotionPreset {
  return { effect: action.effect, ...(action.effect === 'slide' ? { direction: action.direction } : {}),
    durationMs: action.durationMs, delayMs, easing: action.easing }
}
function actionView(behaviorId: string, rule: InteractionRule, step: InteractionRule['actions'][number]): ComponentMotionActionView {
  if (!isNodeMotionAction(step.action)) throw new Error('此动作不是宿主动效')
  return { behaviorId, ruleId: rule.id, stepId: step.id, label: rule.name ?? rule.trigger.type,
    enabled: rule.enabled, config: preset(step.action, step.delayMs) }
}

/** A property projection of the existing interaction program; it never creates a second motion state. */
export function componentMotionPropertiesView(target: ComponentInteractionAuthoringTarget) {
  const motion = programs(target).flatMap(program => program.rules.filter(rule => applies(rule, target)).flatMap(rule =>
    rule.actions.filter(step => isNodeMotionAction(step.action) && step.action.nodeId === target.instanceId)
      .map(step => ({ program, rule, step }))))
  const entrances = motion.filter(item => item.step.action.type === 'node.enter')
  const simple = entrances.length === 1 && simpleEntrance(entrances[0]!.rule, target) ? entrances[0] : undefined
  return {
    entrance: simple ? actionView(simple.program.instance.id, simple.rule, simple.step) : null,
    entranceUnavailableReason: target.instanceId && componentIsLocked(target.project, target.instanceId) ? '请先解锁对象，再修改动画。'
      : entrances.length && !simple ? '已有条件或编排的出现动作，请在“互动与动画”中编辑。' : null,
    exits: motion.filter(item => item.step.action.type === 'node.exit').map(item => actionView(item.program.instance.id, item.rule, item.step)),
  }
}
function motionAction(type: NodeMotionAction['type'], nodeId: string, config: ComponentMotionPreset): NodeMotionAction {
  const common = { type, nodeId, durationMs: config.effect === 'none' ? 0 : config.durationMs, easing: config.easing }
  return config.effect === 'slide' ? { ...common, effect: 'slide', direction: config.direction ?? 'left' }
    : { ...common, effect: config.effect }
}

/** The ordinary entrance is a single node.activated rule, committed by the canonical rules writer. */
export function componentEntranceMotionEdits(target: ComponentInteractionAuthoringTarget, config: ComponentMotionPreset, enabled: boolean): ComponentEdit[] {
  if (!target.instanceId || !target.project.instances[target.instanceId]) throw new Error('动画目标已不存在')
  const view = componentMotionPropertiesView(target)
  if (view.entranceUnavailableReason) throw new Error(view.entranceUnavailableReason)
  const current = view.entrance, owner = current ? programs(target).find(program => program.instance.id === current.behaviorId)!.owner
    : componentInteractionOwner(target.project, target.project.instances[target.instanceId]!)
  const behavior = current ? target.project.instances[current.behaviorId] : interactionBehavior(target.project, owner)
  const rules = structuredClone(interactionRules(behavior))
  const rule = current ? rules.find(rule => rule.id === current.ruleId)! : undefined
  if (!rule && !enabled) return []
  if (rule) {
    rule.enabled = enabled
    rule.actions[0] = { ...rule.actions[0]!, delayMs: config.delayMs, action: motionAction('node.enter', target.instanceId, config) }
  } else rules.push({ id: crypto.randomUUID(), name: '进入时出现', enabled,
    trigger: { type: 'node.activated', nodeId: target.instanceId },
    conditions: target.activeStateId === null ? [] : [{ type: 'presentation.in', stateIds: [target.activeStateId] }],
    actions: [{ id: crypto.randomUUID(), start: 'after-previous', delayMs: config.delayMs,
      action: motionAction('node.enter', target.instanceId, config) }] })
  return componentRuleEdits(target.project, owner, rules, undefined, behavior?.id)
}

/** Edit an explicit exit action in place, retaining its trigger, conditions, order and completion identity. */
export function componentExitMotionEdits(target: ComponentInteractionAuthoringTarget, reference: Pick<ComponentMotionActionView, 'behaviorId' | 'ruleId' | 'stepId'>, config: ComponentMotionPreset): ComponentEdit[] {
  const program = programs(target).find(program => program.instance.id === reference.behaviorId)
  const rules = program && structuredClone(program.rules), rule = rules?.find(rule => rule.id === reference.ruleId)
  const step = rule?.actions.find(step => step.id === reference.stepId)
  if (!program || !rules || !step || step.action.type !== 'node.exit' || step.action.nodeId !== target.instanceId) throw new Error('退出动作已改变，请重新选择对象。')
  step.delayMs = config.delayMs
  step.action = motionAction('node.exit', step.action.nodeId, config)
  return componentRuleEdits(target.project, program.owner, rules, undefined, program.instance.id)
}
