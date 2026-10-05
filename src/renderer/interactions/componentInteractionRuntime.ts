import type { ComponentRuntimeContext, ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { isNodeMotionAction, isTerminalNavigationAction, type InteractionAction, type InteractionCondition, type InteractionRule, type InteractionTrigger } from '../../shared/interactionTypes'
import { matchesPublishedCourseStateCondition } from '../../player/surfaces/publishedCourseState'
import { componentInteractionDataSchema } from './componentInteractionAuthoring'

/** Facts/actions belong to the existing world; this module only executes rule programs. */
export interface ComponentInteractionPorts {
  currentSurfaceId(): string | null
  currentStateId(): string | null
  courseState: { get(key: string): unknown; set(key: string, value: unknown): void }
  subscribeTrigger(trigger: InteractionTrigger, listener: (payload?: unknown) => void): () => void
  /** The actual host action must recheck signal/scope before an asynchronous write. */
  executeAction(action: InteractionAction, context: { signal: AbortSignal; ruleId: string; stepId: string; restartFromBeginning: boolean }): boolean | void | PromiseLike<boolean | void>
  report(message: string): void
}

export type ComponentInteractionPortsFactory = (context: ComponentRuntimeContext, rules: readonly InteractionRule[]) => ComponentInteractionPorts

function triggerMatches(expected: InteractionTrigger, actual: InteractionTrigger): boolean {
  if (expected.type !== actual.type) return false
  return Object.entries(expected).every(([key, value]) => Reflect.get(actual, key) === value)
}

/** Preserve the existing parallel-group and retrigger cancellation semantics. */
export function createComponentInteractionRuntime(createPorts: ComponentInteractionPortsFactory): ComponentRuntimeImplementation {
  return {
    mount(context) {
      let disposed = false, generation = 0, off: (() => void) | undefined
      let rules = componentInteractionDataSchema.parse(context.instance.data).rules
      let ports = createPorts(context, rules)
      const runs = new Map<string, AbortController>()
      const active = () => !disposed && context.scope.isActive() && !context.scope.signal.aborted
      const matches = (condition: InteractionCondition) => {
        if (condition.type === 'scene.in') return condition.sceneIds.includes(ports.currentSurfaceId() ?? '')
        if (condition.type === 'presentation.in') return condition.stateIds.includes(ports.currentStateId() ?? '')
        return matchesPublishedCourseStateCondition({ get: <T,>(key: string) => ports.courseState.get(key) as T | undefined }, condition)
      }
      const inScope = (rule: InteractionRule) => {
        const attachment = context.instance.attachments?.find(value => value.instanceId === context.instance.id)
        if (attachment?.target.kind === 'surface' && attachment.target.surfaceId !== ports.currentSurfaceId()) return false
        return rule.conditions.filter(condition => condition.type === 'scene.in').every(matches)
      }
      const delay = (ms: number, signal: AbortSignal) => new Promise<boolean>(resolve => {
        if (signal.aborted) { resolve(false); return }
        let timer: ReturnType<typeof setTimeout>
        const finish = (done: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(done) }
        const abort = () => finish(false)
        timer = setTimeout(() => finish(true), Math.max(0, ms))
        signal.addEventListener('abort', abort, { once: true })
      })
      const dispatch = (trigger: InteractionTrigger) => {
        if (!active()) return
        for (const rule of rules) {
          if (!rule.enabled || !triggerMatches(rule.trigger, trigger) || !inScope(rule) || !rule.conditions.every(matches)) continue
          const previous = runs.get(rule.id), controller = new AbortController(), runGeneration = generation
          runs.set(rule.id, controller); previous?.abort()
          const current = () => active() && runGeneration === generation && runs.get(rule.id) === controller && !controller.signal.aborted
          void (async () => {
            const groups: typeof rule.actions[] = []
            for (const step of rule.actions) {
              if (!groups.length || step.start === 'after-previous') groups.push([step])
              else groups[groups.length - 1]!.push(step)
            }
            for (const group of groups) {
              if (!current()) return
              const outcomes = await Promise.all(group.map(async step => {
                if (step.delayMs && !await delay(step.delayMs, controller.signal)) return false
                if (!current() || !inScope(rule)) return false
                const done = await ports.executeAction(step.action, { signal: controller.signal, ruleId: rule.id, stepId: step.id, restartFromBeginning: Boolean(previous) })
                if (!current()) return false
                if (done === false) { ports.report(`互动“${rule.name}”的动作 ${step.action.type} 未完成`); return false }
                if (isNodeMotionAction(step.action)) dispatch({ type: 'animation.completed', actionId: step.id })
                return !isTerminalNavigationAction(step.action)
              }))
              if (outcomes.some(value => !value)) return
            }
          })().catch(error => { if (current()) ports.report(error instanceof Error ? error.message : String(error)) }).finally(() => {
            if (runs.get(rule.id) === controller) runs.delete(rule.id)
          })
        }
      }
      const retire = () => { generation++; off?.(); off = undefined; for (const run of runs.values()) run.abort(); runs.clear() }
      const subscribe = () => {
        const triggers = new Map(rules.filter(rule => rule.enabled).map(rule => [JSON.stringify(rule.trigger), rule.trigger]))
        const stops: (() => void)[] = []
        try { for (const trigger of triggers.values()) stops.push(ports.subscribeTrigger(trigger, () => dispatch(trigger))) }
        catch (error) { for (const stop of stops.reverse()) stop(); throw error }
        return () => { for (const stop of stops.reverse()) stop() }
      }
      const dispose = () => { if (disposed) return; disposed = true; retire() }
      context.scope.cleanup(dispose)
      if (active()) off = subscribe()
      return {
        update(instance) {
          if (!active()) return
          retire()
          rules = componentInteractionDataSchema.parse(instance.data).rules
          context = { ...context, instance }
          ports = createPorts(context, rules)
          off = subscribe()
        },
        dispose,
      }
    },
  }
}
