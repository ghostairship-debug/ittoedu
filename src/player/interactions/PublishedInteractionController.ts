import {
  isNodeMotionAction,
  isTerminalNavigationAction,
  type InteractionActionPayload,
  type InteractionActionStep,
  type InteractionRule,
} from '../../shared/contracts/interaction-v1/types'
import type {
  PublishedInteractionDiagnostic,
  PublishedInteractionDiagnosticCode,
  PublishedInteractionSessionPort,
  PublishedInteractionSurfacePort,
} from './PublishedInteractionSurfacePort'
import { matchesPublishedCourseStateCondition } from '../surfaces/publishedCourseState'

type StepOutcome = 'completed' | 'cancelled' | 'terminal'

interface ActiveRuleRun {
  readonly token: symbol
  readonly controller: AbortController
  readonly restarted: boolean
}

interface CurrentSceneResult {
  ok: boolean
  sceneId: string | null
}

export interface PublishedInteractionControllerOptions {
  surfaceId: string
  rules: readonly InteractionRule[]
  surface: PublishedInteractionSurfacePort
  session: PublishedInteractionSessionPort
  reportDiagnostic?(diagnostic: PublishedInteractionDiagnostic): void
}

const SUPPORTED_ACTION_TYPES = new Set<InteractionActionPayload['type']>([
  'node.enter',
  'node.exit',
  'scene.go',
  'scene.next',
  'scene.previous',
  'scene.replay',
  'course.restart',
  'course-state.set',
])

function boundedDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return 0
  return Math.max(0, Math.min(60_000, delayMs))
}

/**
 * Executes the first Published Course V2 interaction slice without depending
 * on renderer Store or the legacy PlayerScene. Construction installs the
 * Surface-owned click bindings; destroy releases them and all active runs.
 */
export class PublishedInteractionController {
  readonly #surfaceId: string
  readonly #rules: readonly InteractionRule[]
  readonly #surface: PublishedInteractionSurfacePort
  readonly #session: PublishedInteractionSessionPort
  readonly #reportDiagnostic?: (
    diagnostic: PublishedInteractionDiagnostic,
  ) => void
  readonly #clickRules = new Map<string, InteractionRule[]>()
  readonly #disposers: Array<() => void> = []
  readonly #activeRuns = new Map<string, ActiveRuleRun>()
  #destroyed = false

  constructor(options: PublishedInteractionControllerOptions) {
    this.#surfaceId = options.surfaceId
    this.#rules = [...options.rules]
    this.#surface = options.surface
    this.#session = options.session
    this.#reportDiagnostic = options.reportDiagnostic
    this.#inspectAndBindRules()
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    for (const run of this.#activeRuns.values()) run.controller.abort()
    this.#activeRuns.clear()
    for (const dispose of this.#disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (cause) {
        this.#diagnose({
          code: 'dispose-failed',
          severity: 'error',
          message: '释放 Published 交互点击绑定失败',
          cause,
        })
      }
    }
    this.#clickRules.clear()
  }

  #inspectAndBindRules(): void {
    for (const rule of this.#rules) {
      if (!rule.enabled) continue
      if (rule.trigger.type !== 'node.click') {
        this.#diagnose({
          code: 'unsupported-trigger',
          severity: 'warning',
          message: `Published 交互尚不支持触发器 ${rule.trigger.type}，已跳过规则`,
          ruleId: rule.id,
          interactionType: rule.trigger.type,
        })
        continue
      }

      let conditionsSupported = true
      for (const condition of rule.conditions) {
        if (
          condition.type === 'scene.in'
          || condition.type === 'course-state.exists'
          || condition.type === 'course-state.compare'
        ) continue
        conditionsSupported = false
        this.#diagnose({
          code: 'unsupported-condition',
          severity: 'warning',
          message: `Published 交互尚不支持条件 ${condition.type}，已跳过规则`,
          ruleId: rule.id,
          nodeId: rule.trigger.nodeId,
          interactionType: condition.type,
        })
      }
      for (const step of rule.actions) {
        if (SUPPORTED_ACTION_TYPES.has(step.action.type)) continue
        this.#diagnose({
          code: 'unsupported-action',
          severity: 'warning',
          message: `Published 交互尚不支持动作 ${step.action.type}，执行时将跳过该步`,
          ruleId: rule.id,
          stepId: step.id,
          nodeId: rule.trigger.nodeId,
          interactionType: step.action.type,
        })
      }
      if (!conditionsSupported) continue

      const rules = this.#clickRules.get(rule.trigger.nodeId) ?? []
      rules.push(rule)
      this.#clickRules.set(rule.trigger.nodeId, rules)
    }

    for (const nodeId of this.#clickRules.keys()) {
      try {
        const dispose = this.#surface.bindNodeClick(nodeId, () => {
          this.#handleNodeClick(nodeId)
        })
        if (typeof dispose === 'function') {
          this.#disposers.push(dispose)
        } else {
          this.#diagnose({
            code: 'bind-unavailable',
            severity: 'warning',
            message: `Published 交互节点 ${nodeId} 当前不可绑定点击`,
            nodeId,
          })
        }
      } catch (cause) {
        this.#diagnose({
          code: 'bind-failed',
          severity: 'error',
          message: `Published 交互节点 ${nodeId} 点击绑定失败`,
          nodeId,
          cause,
        })
      }
    }
  }

  #handleNodeClick(nodeId: string): void {
    if (this.#destroyed) return
    const rules = this.#clickRules.get(nodeId) ?? []
    let currentScene: CurrentSceneResult | undefined
    for (const rule of rules) {
      const sceneConditions = rule.conditions.filter(
        (condition) => condition.type === 'scene.in',
      )
      if (sceneConditions.length > 0) {
        currentScene ??= this.#readCurrentScene(rule, undefined, nodeId)
        if (!currentScene.ok) continue
        if (!sceneConditions.every((condition) => (
          currentScene!.sceneId !== null
          && condition.sceneIds.includes(currentScene!.sceneId)
        ))) continue
      }
      if (!this.#matchesCourseStateConditions(rule, nodeId)) continue
      this.#startRule(rule)
    }
  }

  #startRule(rule: InteractionRule): void {
    const previous = this.#activeRuns.get(rule.id)
    previous?.controller.abort()
    const run: ActiveRuleRun = {
      token: Symbol(`published-interaction:${rule.id}`),
      controller: new AbortController(),
      restarted: previous !== undefined,
    }
    this.#activeRuns.set(rule.id, run)
    const execution = this.#executeRule(rule, run).catch((cause: unknown) => {
      if (run.controller.signal.aborted || this.#destroyed) return
      this.#diagnose({
        code: 'execution-failed',
        severity: 'error',
        message: `Published 交互规则 ${rule.id} 执行失败`,
        ruleId: rule.id,
        cause,
      })
    })
    void execution.then(() => {
      if (this.#activeRuns.get(rule.id)?.token === run.token) {
        this.#activeRuns.delete(rule.id)
      }
    })
  }

  async #executeRule(rule: InteractionRule, run: ActiveRuleRun): Promise<void> {
    const groups: InteractionActionStep[][] = []
    for (const step of rule.actions) {
      if (groups.length === 0 || step.start === 'after-previous') {
        groups.push([step])
      } else {
        groups[groups.length - 1]!.push(step)
      }
    }

    for (const group of groups) {
      if (this.#destroyed || run.controller.signal.aborted) return
      const outcomes = await Promise.all(
        group.map((step) => this.#executeStep(rule, step, run)),
      )
      if (
        this.#destroyed
        || run.controller.signal.aborted
        || outcomes.some((outcome) => outcome !== 'completed')
      ) return
    }
  }

  async #executeStep(
    rule: InteractionRule,
    step: InteractionActionStep,
    run: ActiveRuleRun,
  ): Promise<StepOutcome> {
    const signal = run.controller.signal
    if (!await this.#waitForDelay(step.delayMs, signal)) return 'cancelled'
    if (this.#destroyed || signal.aborted) return 'cancelled'
    if (!this.#matchesCurrentScene(rule, step)) return 'cancelled'
    return this.#executeAction(rule, step, run)
  }

  #matchesCurrentScene(rule: InteractionRule, step: InteractionActionStep): boolean {
    const conditions = rule.conditions.filter(
      (condition) => condition.type === 'scene.in',
    )
    if (conditions.length === 0) return true
    const current = this.#readCurrentScene(
      rule,
      step,
      rule.trigger.type === 'node.click' ? rule.trigger.nodeId : undefined,
    )
    return current.ok
      && current.sceneId !== null
      && conditions.every((condition) => condition.sceneIds.includes(current.sceneId!))
  }

  #matchesCourseStateConditions(rule: InteractionRule, nodeId: string): boolean {
    const conditions = rule.conditions.filter((condition) => (
      condition.type === 'course-state.exists'
      || condition.type === 'course-state.compare'
    ))
    if (conditions.length === 0) return true
    try {
      return conditions.every((condition) => (
        matchesPublishedCourseStateCondition(this.#session.courseState, condition)
      ))
    } catch (cause) {
      this.#diagnose({
        code: 'session-failed',
        severity: 'error',
        message: '读取 Published 课程状态失败',
        ruleId: rule.id,
        nodeId,
        cause,
      })
      return false
    }
  }

  #readCurrentScene(
    rule: InteractionRule,
    step?: InteractionActionStep,
    nodeId?: string,
  ): CurrentSceneResult {
    try {
      return { ok: true, sceneId: this.#session.currentSceneId() }
    } catch (cause) {
      this.#diagnose({
        code: 'session-failed',
        severity: 'error',
        message: '读取 Published 课程当前场景失败',
        ruleId: rule.id,
        stepId: step?.id,
        nodeId,
        cause,
      })
      return { ok: false, sceneId: null }
    }
  }

  async #executeAction(
    rule: InteractionRule,
    step: InteractionActionStep,
    run: ActiveRuleRun,
  ): Promise<StepOutcome> {
    const { action } = step
    const signal = run.controller.signal
    if (!SUPPORTED_ACTION_TYPES.has(action.type)) return 'completed'

    try {
      let result: boolean | void
      if (isNodeMotionAction(action)) {
        result = await this.#surface.executeNodeMotion(action, {
          ruleId: rule.id,
          stepId: step.id,
          signal,
          restartFromBeginning: run.restarted,
        })
        if (this.#destroyed || signal.aborted) return 'cancelled'
        if (result === false) {
          this.#reportActionFailure(
            'motion-failed',
            rule,
            step,
            `Published 交互动作 ${action.type} 未执行`,
          )
          return 'cancelled'
        }
        return 'completed'
      }

      switch (action.type) {
        case 'course-state.set':
          this.#session.courseState.set(action.key, action.value)
          return 'completed'
        case 'scene.go':
          result = await this.#session.goToScene(
            action.sceneId,
            action.targetStateId,
            signal,
          )
          break
        case 'scene.next':
          result = await this.#session.nextScene(signal)
          break
        case 'scene.previous':
          result = await this.#session.previousScene(signal)
          break
        case 'scene.replay':
          result = await this.#session.replayScene(signal)
          break
        case 'course.restart':
          result = await this.#session.restartCourse(signal)
          break
        default:
          return 'completed'
      }

      if (this.#destroyed || signal.aborted) return 'cancelled'
      if (result === false) {
        this.#reportActionFailure(
          'navigation-failed',
          rule,
          step,
          `Published 交互导航 ${action.type} 未执行`,
        )
        return 'cancelled'
      }
      return isTerminalNavigationAction(action) ? 'terminal' : 'completed'
    } catch (cause) {
      if (this.#destroyed || signal.aborted) return 'cancelled'
      const motion = isNodeMotionAction(action)
      const courseState = action.type === 'course-state.set'
      this.#reportActionFailure(
        motion
          ? 'motion-failed'
          : courseState
            ? 'course-state-failed'
            : 'navigation-failed',
        rule,
        step,
        `Published 交互动作 ${action.type} 执行失败`,
        cause,
      )
      return 'cancelled'
    }
  }

  #reportActionFailure(
    code: Extract<
      PublishedInteractionDiagnosticCode,
      'motion-failed' | 'navigation-failed' | 'course-state-failed'
    >,
    rule: InteractionRule,
    step: InteractionActionStep,
    message: string,
    cause?: unknown,
  ): void {
    this.#diagnose({
      code,
      severity: 'error',
      message,
      ruleId: rule.id,
      stepId: step.id,
      nodeId: 'nodeId' in step.action ? step.action.nodeId : undefined,
      interactionType: step.action.type,
      ...(cause === undefined ? {} : { cause }),
    })
  }

  #waitForDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
    const delay = boundedDelay(delayMs)
    if (delay === 0) return Promise.resolve(!signal.aborted)
    return new Promise((resolve) => {
      let settled = false
      const finish = (completed: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve(completed)
      }
      const abort = (): void => finish(false)
      const timer = setTimeout(() => finish(true), delay)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  #diagnose(
    diagnostic: Omit<PublishedInteractionDiagnostic, 'surfaceId' | 'phase'>,
  ): void {
    try {
      this.#reportDiagnostic?.({
        surfaceId: this.#surfaceId,
        phase: 'execute',
        ...diagnostic,
      })
    } catch {
      // Diagnostics are observational and must never break playback.
    }
  }
}
