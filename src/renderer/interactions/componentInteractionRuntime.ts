import type { ComponentRuntimeContext, ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { isNodeMotionAction, isTerminalNavigationAction, type InteractionAction, type InteractionCondition, type InteractionRule, type InteractionTrigger } from '../../shared/interactionTypes'
import { matchesPublishedCourseStateCondition } from '../../player/surfaces/publishedCourseState'
import { componentInteractionDataSchema } from '../../shared/componentInteractionData'

/** Facts/actions belong to the existing world; this module only executes rule programs. */
export interface ComponentInteractionPorts {
  currentSurfaceId(): string | null
  currentStateId(): string | null
  courseState: { get(key: string): unknown; set(key: string, value: unknown): void }
  subscribeTrigger(trigger: InteractionTrigger, listener: (payload?: unknown) => boolean | void | PromiseLike<boolean | void>): () => void
  /** The actual host action must recheck signal/scope before an asynchronous write. */
  executeAction(action: InteractionAction, context: { signal: AbortSignal; ruleId: string; stepId: string; restartFromBeginning: boolean; onNavigationCommit?: () => void }): boolean | void | PromiseLike<boolean | void>
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
      const runs = new Map<string, { controller: AbortController; surfaceId: string | null; navigating: number; navigationCommitted?: boolean; adoptedPresentation?: string }>()
      const presentationIdentity = () => JSON.stringify([ports.currentSurfaceId(), ports.currentStateId()])
      const active = () => !disposed && context.scope.isActive() && !context.scope.signal.aborted
      const matches = (condition: InteractionCondition) => {
        if (condition.type === 'scene.in') return condition.sceneIds.includes(ports.currentSurfaceId() ?? '')
        if (condition.type === 'presentation.in') return condition.stateIds.includes(ports.currentStateId() ?? '')
        return matchesPublishedCourseStateCondition({ get: <T,>(key: string) => ports.courseState.get(key) as T | undefined }, condition)
      }
      const inScope = (rule: InteractionRule) => {
        const attachment = context.instance.attachments?.find(value => value.instanceId === context.instance.id)
        if (attachment?.target.kind === 'surface' && attachment.target.surfaceId !== ports.currentSurfaceId()) return false
        return rule.conditions.filter(condition => condition.type === 'scene.in' || condition.type === 'presentation.in').every(matches)
      }
      const delay = (ms: number, signal: AbortSignal) => new Promise<boolean>(resolve => {
        if (signal.aborted) { resolve(false); return }
        let timer: ReturnType<typeof setTimeout>
        const finish = (done: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(done) }
        const abort = () => finish(false)
        timer = setTimeout(() => finish(true), Math.max(0, ms))
        signal.addEventListener('abort', abort, { once: true })
      })
      const dispatch = (trigger: InteractionTrigger): Promise<boolean> => {
        if (!active()) return Promise.resolve(false)
        const completions: Promise<boolean>[] = []
        // All branches of one input observe its state before any matching action mutates it.
        const matching = rules.filter(rule => rule.enabled && triggerMatches(rule.trigger, trigger) && inScope(rule) && rule.conditions.every(matches))
        for (const rule of matching) {
          const previous = runs.get(rule.id), controller = new AbortController(), runGeneration = generation
          const run = { controller, surfaceId: ports.currentSurfaceId(), navigating: 0, navigationCommitted: false, adoptedPresentation: undefined as string | undefined }
          runs.set(rule.id, run); previous?.controller.abort()
          const current = () => active() && runGeneration === generation && runs.get(rule.id)?.controller === controller && !controller.signal.aborted
          const completion = (async (): Promise<boolean> => {
            const groups: typeof rule.actions[] = []
            for (const step of rule.actions) {
              if (!groups.length || step.start === 'after-previous') groups.push([step])
              else groups[groups.length - 1]!.push(step)
            }
            for (const group of groups) {
              if (!current()) return false
              const outcomes = await Promise.all(group.map(async step => {
                if (step.delayMs && !await delay(step.delayMs, controller.signal)) return { success: false, terminal: false }
                if (!current() || !inScope(rule)) return { success: false, terminal: false }
                const navigating = isTerminalNavigationAction(step.action) || step.action.type === 'presentation.set'
                if (navigating) run.navigating++
                let done: boolean | void
                try { done = await ports.executeAction(step.action, { signal: controller.signal, ruleId: rule.id, stepId: step.id, restartFromBeginning: Boolean(previous), onNavigationCommit: () => { run.navigationCommitted = true } }) }
                finally { if (navigating) { run.navigating--; run.navigationCommitted = false } }
                if (!current()) return { success: false, terminal: false }
                if (done === false) { ports.report(`互动“${rule.name}”的动作 ${step.action.type} 未完成`); return { success: false, terminal: false } }
                if (isNodeMotionAction(step.action)) void dispatch({ type: 'animation.completed', actionId: step.id })
                return { success: true, terminal: isTerminalNavigationAction(step.action) }
              }))
              if (outcomes.some(value => !value.success)) return false
              if (outcomes.some(value => value.terminal)) return true
            }
            return true
          })().catch(error => { if (current()) ports.report(error instanceof Error ? error.message : String(error)); return false }).finally(() => {
            if (runs.get(rule.id)?.controller === controller) runs.delete(rule.id)
          })
          completions.push(completion)
        }
        return completions.length ? Promise.all(completions).then(values => values.every(Boolean)) : Promise.resolve(false)
      }
      const retire = () => { generation++; off?.(); off = undefined; for (const run of runs.values()) if (!run.navigationCommitted) run.controller.abort(); runs.clear() }
      const subscribe = () => {
        const triggers = new Map(rules.filter(rule => rule.enabled).map(rule => [JSON.stringify(rule.trigger), rule.trigger]))
        const stops: (() => void)[] = []
        try { for (const trigger of triggers.values()) stops.push(ports.subscribeTrigger(trigger, () => dispatch(trigger))) }
        catch (error) { for (const stop of stops.reverse()) stop(); throw error }
        return () => { for (const stop of stops.reverse()) stop() }
      }
      const dispose = () => { if (disposed) return; disposed = true; retire() }
      context.scope.events.subscribe('__runtime.scene.reset', surfaceId => {
        if (!active() || surfaceId !== ports.currentSurfaceId()) return
        for (const [ruleId, run] of runs) {
          if (run.surfaceId !== surfaceId) continue
          run.controller.abort(); runs.delete(ruleId)
        }
      })
      context.scope.events.subscribe('__runtime.presentation', () => {
        for (const [ruleId, run] of runs) if (!inScope(rules.find(rule => rule.id === ruleId)!)) {
          // A rule's own committed navigation must finish with its real result.
          // It adopts only that presentation while the action completes; a
          // subsequent departure still aborts it, and later steps keep inScope.
          const identity = presentationIdentity()
          if (run.navigating && (run.adoptedPresentation === undefined || run.adoptedPresentation === identity)) { run.adoptedPresentation = identity; continue }
          run.controller.abort(); runs.delete(ruleId)
        }
      })
      context.scope.cleanup(dispose)
      if (active()) off = subscribe()
      return {
        update(instance) {
          if (!active()) return
          const nextRules = componentInteractionDataSchema.parse(instance.data).rules
          // A newly projected target refreshes behaviors with the same data.
          // Dynamic world ports already read those targets; keep this program's
          // live subscriptions and runs unless its authored rules changed.
          if (JSON.stringify(nextRules) === JSON.stringify(rules)) { context = { ...context, instance }; return }
          retire()
          rules = nextRules
          context = { ...context, instance }
          ports = createPorts(context, rules)
          off = subscribe()
        },
        dispose,
      }
    },
  }
}
