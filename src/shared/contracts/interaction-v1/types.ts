import type { RuntimePresentationTransition } from '../runtime/types'
import type {
  CourseStateCondition,
  CourseStateScalar,
} from '../course-state/types'

/** Defensive authoring limits; these are not normal courseware targets. */
export const MAX_SCENE_INTERACTIONS = 1_000
export const MAX_INTERACTION_CONDITIONS = 16
export const MAX_INTERACTION_ACTIONS = 32

/** Runtime-visible discriminators shared by Schema and generated AI contracts. */
export const INTERACTION_TRIGGER_TYPES = [
  'node.click',
  'scene.enter',
  'presentation.enter',
  'component.event',
  'runtime.event',
  'audio.ended',
  'video.started',
  'video.paused',
  'video.ended',
  'video.time',
  'node.activated',
  'animation.completed',
  'presenter.command',
  'input.submit',
] as const

export const INTERACTION_CONDITION_TYPES = [
  'presentation.in',
  'scene.in',
  'course-state.exists',
  'course-state.compare',
] as const

export const INTERACTION_ACTION_TYPES = [
  'presentation.set',
  'scene.go',
  'scene.next',
  'scene.previous',
  'scene.replay',
  'course.restart',
  'course-state.set',
  'audio.play',
  'audio.pause',
  'audio.resume',
  'audio.stop',
  'audio.toggle-mute',
  'video.play',
  'video.pause',
  'video.restart',
  'video.stop',
  'video.toggle',
  'video.seek',
  'node.enter',
  'node.exit',
] as const

export type AudioChannel = 'music' | 'narration' | 'sfx' | 'ui'

export interface InputSubmitTrigger {
  type: 'input.submit'
  nodeId: string
}

export type InteractionTrigger =
  | { type: 'node.click'; nodeId: string }
  | { type: 'scene.enter' }
  | { type: 'presentation.enter'; stateId: string }
  | { type: 'component.event'; nodeId: string; eventName: string }
  | {
      type: 'runtime.event'
      scope: 'scene' | 'global'
      eventName: string
    }
  | { type: 'audio.ended'; soundId: string }
  | { type: 'video.started'; nodeId: string }
  | { type: 'video.paused'; nodeId: string }
  | { type: 'video.ended'; nodeId: string }
  | { type: 'video.time'; nodeId: string; seconds: number }
  | { type: 'node.activated'; nodeId: string }
  | { type: 'animation.completed'; actionId: string }
  | { type: 'presenter.command'; command: 'next' | 'previous' }
  | InputSubmitTrigger

export type InteractionCourseStateCondition =
  | (Omit<Extract<CourseStateCondition, { type: 'exists' }>, 'type'> & {
      type: 'course-state.exists'
    })
  | (Omit<Extract<CourseStateCondition, { type: 'compare' }>, 'type'> & {
      type: 'course-state.compare'
    })

/** Different conditions are ANDed. State ids inside one condition are ORed. */
export type InteractionCondition =
  | {
      type: 'presentation.in'
      stateIds: string[]
    }
  | {
      type: 'scene.in'
      sceneIds: string[]
    }
  | InteractionCourseStateCondition

type AssertExactly<Left, Right> =
  [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
    ? true
    : never

const triggerTypesMatchContract: AssertExactly<
  InteractionTrigger['type'],
  (typeof INTERACTION_TRIGGER_TYPES)[number]
> = true

const conditionTypesMatchContract: AssertExactly<
  InteractionCondition['type'],
  (typeof INTERACTION_CONDITION_TYPES)[number]
> = true

export type AudioActionTarget =
  | { kind: 'sound'; soundId: string }
  | { kind: 'channel'; channel: AudioChannel }
  | { kind: 'all' }

export interface AudioPlayAction {
  type: 'audio.play'
  soundId: string
  volume?: number
  loop?: boolean
  fadeInMs?: number
  lifetime?: 'scene' | 'course'
  ifPlaying?: 'restart' | 'continue' | 'ignore'
}

export interface AudioPauseAction {
  type: 'audio.pause'
  target: AudioActionTarget
  fadeOutMs?: number
}

export interface AudioResumeAction {
  type: 'audio.resume'
  target: AudioActionTarget
  fadeInMs?: number
}

export interface AudioStopAction {
  type: 'audio.stop'
  target: AudioActionTarget
  fadeOutMs?: number
}

export interface AudioToggleMuteAction {
  type: 'audio.toggle-mute'
  target: AudioActionTarget
}

export type AudioInteractionAction =
  | AudioPlayAction
  | AudioPauseAction
  | AudioResumeAction
  | AudioStopAction
  | AudioToggleMuteAction

export type VideoInteractionAction =
  | { type: 'video.play'; nodeId: string }
  | { type: 'video.pause'; nodeId: string }
  | { type: 'video.restart'; nodeId: string }
  | { type: 'video.stop'; nodeId: string }
  | { type: 'video.toggle'; nodeId: string }
  | { type: 'video.seek'; nodeId: string; seconds: number }

export interface CourseStateSetAction {
  type: 'course-state.set'
  key: string
  value: CourseStateScalar
}

export type MotionEffect = 'none' | 'fade' | 'slide' | 'scale'
export type MotionDirection = 'left' | 'right' | 'up' | 'down'
export type MotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

interface NodeMotionActionBase {
  nodeId: string
  durationMs: number
  easing: MotionEasing
}

type NodeMotionDescriptor =
  | { effect: 'slide'; direction: MotionDirection }
  | { effect: Exclude<MotionEffect, 'slide'>; direction?: never }

/** A host-level entrance/exit action. Timing lives on its enclosing step. */
export type NodeMotionAction = (
  | { type: 'node.enter' }
  | { type: 'node.exit' }
) & NodeMotionActionBase & NodeMotionDescriptor

/** Payload family used by both sequential and parallel Project V8 action steps. */
export type InteractionActionPayload =
  | {
      type: 'presentation.set'
      stateId: string
      transition?: RuntimePresentationTransition
    }
  | {
      type: 'scene.go'
      sceneId: string
      /** Omit to enter the target scene's authored initial state. */
      targetStateId?: string
    }
  | { type: 'scene.next' }
  | { type: 'scene.previous' }
  | { type: 'scene.replay' }
  | { type: 'course.restart' }
  | CourseStateSetAction
  | AudioInteractionAction
  | VideoInteractionAction
  | NodeMotionAction

/** Action payload carried by a Project V8 interaction step. */
export type InteractionAction = InteractionActionPayload

const actionTypesMatchContract: AssertExactly<
  InteractionActionPayload['type'],
  (typeof INTERACTION_ACTION_TYPES)[number]
> = true

void triggerTypesMatchContract
void conditionTypesMatchContract
void actionTypesMatchContract

export interface InteractionActionStep {
  /** Stable within one scene/global interaction scope; completion triggers reference it. */
  id: string
  start: 'after-previous' | 'with-previous'
  /** Relative to the triggering event or previous completed action group. */
  delayMs: number
  action: InteractionActionPayload
}

export interface InteractionRule {
  id: string
  name?: string
  enabled: boolean
  trigger: InteractionTrigger
  conditions: InteractionCondition[]
  /** Steps execute as sequential/parallel groups. Terminal navigation owns the last group. */
  actions: InteractionActionStep[]
}

export type TerminalNavigationAction = Extract<
  InteractionActionPayload,
  {
    type:
      | 'scene.go'
      | 'scene.next'
      | 'scene.previous'
      | 'scene.replay'
      | 'course.restart'
  }
>

const terminalNavigationTypes = new Set<InteractionActionPayload['type']>([
  'scene.go',
  'scene.next',
  'scene.previous',
  'scene.replay',
  'course.restart',
])

export function isTerminalNavigationAction(
  action: InteractionActionPayload,
): action is TerminalNavigationAction {
  return terminalNavigationTypes.has(action.type)
}

export function isAudioInteractionAction(
  action: InteractionActionPayload,
): action is AudioInteractionAction {
  return action.type.startsWith('audio.')
}

export function isVideoInteractionAction(
  action: InteractionActionPayload,
): action is VideoInteractionAction {
  return action.type.startsWith('video.')
}

export function isNodeMotionAction(
  action: InteractionActionPayload,
): action is NodeMotionAction {
  return action.type === 'node.enter' || action.type === 'node.exit'
}
