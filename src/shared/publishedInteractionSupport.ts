import type {
  InteractionActionPayload,
  InteractionRule,
  InteractionCondition,
  InteractionTrigger,
} from './interactionTypes'
import type { LayerItem } from './courseProjectTypes'

/**
 * Current declarative-interaction slice executed by the Published Course V2
 * host. This is playback capability, not the broader V9 authoring contract.
 */
export const PUBLISHED_INTERACTION_PLAYBACK_SUPPORT = {
  status: 'partial',
  triggerTypes: ['node.click', 'input.submit', 'scene.enter', 'presenter.command',
    'audio.ended', 'video.started', 'video.paused', 'video.ended', 'video.time'],
  conditionTypes: [
    'scene.in',
    'course-state.exists',
    'course-state.compare',
  ],
  actionTypes: [
    'step.next',
    'step.previous',
    'node.enter',
    'node.exit',
    'scene.go',
    'scene.next',
    'scene.previous',
    'scene.replay',
    'course.restart',
    'course-state.set',
    'audio.play', 'audio.pause', 'audio.resume', 'audio.stop', 'audio.toggle-mute',
    'video.play', 'video.pause', 'video.restart', 'video.stop', 'video.toggle', 'video.seek',
  ],
  conditionalActions: { 'presentation.set': 'Slide-current-scene only; global requires scene.in; no-scene-enter-trigger; no-transition; final-action; sole-last-group; rejects-whole-rule-otherwise' },
  courseState: 'declared-defaults-and-declarative-read-write-shared-with-runtime-and-component-hosts',
  navigationGuards: 'cross-location-go-next-previous-only; replay-not-guarded; restart-bypasses-guards',
  bindingSemantics: {
    nodeClick: 'auto-hit-native-text-image-formula-shape-only',
    sceneIn: 'slide-scene-id-only',
  },
  navigationSemantics: {
    sceneGo: 'slide-scene-id-only',
    nextPrevious: 'scene-occurrence-order-and-guarded-across-locations',
    replay: 'current-scene-first-step-and-not-guarded',
    restart: 'guard-bypassed-and-course-state-reset-to-declared-defaults',
  },
  limitations: [
    'no-assessment-branch-condition',
  ],
} as const satisfies {
  status: 'partial'
  triggerTypes: readonly InteractionTrigger['type'][]
  conditionTypes: readonly InteractionCondition['type'][]
  actionTypes: readonly InteractionActionPayload['type'][]
  conditionalActions: Readonly<{ 'presentation.set': 'Slide-current-scene only; global requires scene.in; no-scene-enter-trigger; no-transition; final-action; sole-last-group; rejects-whole-rule-otherwise' }>
  courseState: 'declared-defaults-and-declarative-read-write-shared-with-runtime-and-component-hosts'
  navigationGuards: 'cross-location-go-next-previous-only; replay-not-guarded; restart-bypasses-guards'
  bindingSemantics: Readonly<{
    nodeClick: 'auto-hit-native-text-image-formula-shape-only'
    sceneIn: 'slide-scene-id-only'
  }>
  navigationSemantics: Readonly<{
    sceneGo: 'slide-scene-id-only'
    nextPrevious: 'scene-occurrence-order-and-guarded-across-locations'
    replay: 'current-scene-first-step-and-not-guarded'
    restart: 'guard-bypassed-and-course-state-reset-to-declared-defaults'
  }>
  limitations: readonly ['no-assessment-branch-condition']
}

function includesType<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.includes(value as T)
}

export function isPublishedInteractionTriggerSupported(
  type: InteractionTrigger['type'],
): boolean {
  return includesType(PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.triggerTypes, type)
}

export function isPublishedInteractionConditionSupported(
  type: InteractionCondition['type'],
): boolean {
  return includesType(PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.conditionTypes, type)
}

export function isPublishedInteractionActionSupported(
  type: InteractionActionPayload['type'],
): boolean {
  // Type-level availability includes conditional actions. A complete rule must
  // still pass isPublishedInteractionActionStepSupported before execution.
  return includesType(PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.actionTypes, type)
    || Object.hasOwn(PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.conditionalActions, type)
}

/** Mirrors the stable native click ownership policy of all Published surfaces. */
export function isPublishedInteractionClickBindable(item: LayerItem): boolean {
  if (item.kind !== 'native' || item.hitPolicy !== 'auto') return false
  return item.content.nativeType === 'text'
    || item.content.nativeType === 'image'
    || item.content.nativeType === 'formula'
    || item.content.nativeType === 'shape'
}

/** Conditional support is shared by playback binding and authoring diagnostics. */
export function publishedPresentationSetUnsupportedReason(
  rule: InteractionRule,
  actionIndex: number,
  scope: 'scene' | 'global' = 'scene',
): string | null {
  const step = rule.actions[actionIndex]
  if (!step || step.action.type !== 'presentation.set') return null
  if (scope === 'global' && !rule.conditions.some((condition) => condition.type === 'scene.in')) {
    return '全局 presentation.set 必须使用 scene.in 限定当前 Slide 场景；整条规则未执行'
  }
  if (rule.trigger.type === 'scene.enter') {
    return 'presentation.set 暂不支持 scene.enter 触发，避免同场景重入；整条规则未执行'
  }
  if (step.action.transition !== undefined) return 'presentation.set 暂不支持 transition；整条规则未执行'
  if (actionIndex !== rule.actions.length - 1) return 'presentation.set 必须是最后一个动作；整条规则未执行'
  if (actionIndex > 0 && step.start !== 'after-previous') return 'presentation.set 必须独占最后执行组；整条规则未执行'
  return null
}

export function isPublishedInteractionActionStepSupported(
  rule: InteractionRule,
  actionIndex: number,
  scope: 'scene' | 'global' = 'scene',
): boolean {
  const step = rule.actions[actionIndex]
  if (!step) return false
  return step.action.type === 'presentation.set'
    ? publishedPresentationSetUnsupportedReason(rule, actionIndex, scope) === null
    : isPublishedInteractionActionSupported(step.action.type)
}
