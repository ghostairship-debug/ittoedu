import type {
  InteractionActionPayload,
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
  triggerTypes: ['node.click'],
  conditionTypes: ['scene.in'],
  actionTypes: [
    'node.enter',
    'node.exit',
    'scene.go',
    'scene.next',
    'scene.previous',
    'scene.replay',
    'course.restart',
  ],
  courseState: 'declared-defaults-shared-with-runtime-and-component-hosts',
  navigationGuards: 'cross-location-go-next-previous-only; replay-not-guarded; restart-bypasses-guards',
  bindingSemantics: {
    nodeClick: 'auto-hit-native-text-image-formula-shape-only',
    sceneIn: 'slide-scene-id-only',
  },
  navigationSemantics: {
    sceneGo: 'slide-scene-id-only',
    nextPrevious: 'course-location-order-and-guarded-across-locations',
    replay: 'same-location-and-not-guarded',
    restart: 'guard-bypassed-and-course-state-reset-to-declared-defaults',
  },
  limitations: [
    'no-declarative-course-state-condition',
    'no-declarative-course-state-mutation-action',
    'no-assessment-branch-condition',
  ],
} as const satisfies {
  status: 'partial'
  triggerTypes: readonly InteractionTrigger['type'][]
  conditionTypes: readonly InteractionCondition['type'][]
  actionTypes: readonly InteractionActionPayload['type'][]
  courseState: 'declared-defaults-shared-with-runtime-and-component-hosts'
  navigationGuards: 'cross-location-go-next-previous-only; replay-not-guarded; restart-bypasses-guards'
  bindingSemantics: Readonly<{
    nodeClick: 'auto-hit-native-text-image-formula-shape-only'
    sceneIn: 'slide-scene-id-only'
  }>
  navigationSemantics: Readonly<{
    sceneGo: 'slide-scene-id-only'
    nextPrevious: 'course-location-order-and-guarded-across-locations'
    replay: 'same-location-and-not-guarded'
    restart: 'guard-bypassed-and-course-state-reset-to-declared-defaults'
  }>
  limitations: readonly [
    'no-declarative-course-state-condition',
    'no-declarative-course-state-mutation-action',
    'no-assessment-branch-condition',
  ]
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
  return includesType(PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.actionTypes, type)
}

/** Mirrors the stable native click ownership policy of all Published surfaces. */
export function isPublishedInteractionClickBindable(item: LayerItem): boolean {
  if (item.kind !== 'native' || item.hitPolicy !== 'auto') return false
  return item.content.nativeType === 'text'
    || item.content.nativeType === 'image'
    || item.content.nativeType === 'formula'
    || item.content.nativeType === 'shape'
}
