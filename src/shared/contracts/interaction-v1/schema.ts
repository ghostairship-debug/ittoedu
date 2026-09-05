import { z } from 'zod'
import {
  courseStateCompareOperatorSchema,
  courseStateKeySchema,
  courseStateScalarSchema,
} from '../course-state/schema'
import {
  MAX_INTERACTION_ACTIONS,
  MAX_INTERACTION_CONDITIONS,
  MAX_SCENE_INTERACTIONS,
  isTerminalNavigationAction,
  type InteractionRule,
} from './types'

const stableIdSchema = z.string().trim().min(1).max(200)
const eventNameSchema = z.string().trim().min(1).max(160)
const millisecondsSchema = z.number().finite().min(0).max(60_000)
const mediaSecondsSchema = z.number().finite().min(0).max(604_800)
const audioChannelSchema = z.enum(['music', 'narration', 'sfx', 'ui'])

const triggerSchemas = [
  z.object({
    type: z.literal('node.click'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('scene.enter'),
  }).strict(),
  z.object({
    type: z.literal('presentation.enter'),
    stateId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('component.event'),
    nodeId: stableIdSchema,
    eventName: eventNameSchema,
  }).strict(),
  z.object({
    type: z.literal('runtime.event'),
    scope: z.enum(['scene', 'global']),
    eventName: eventNameSchema,
  }).strict(),
  z.object({
    type: z.literal('audio.ended'),
    soundId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.started'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.paused'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.ended'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.time'),
    nodeId: stableIdSchema,
    seconds: mediaSecondsSchema,
  }).strict(),
] as const

export const inputSubmitTriggerSchema = z.object({
  type: z.literal('input.submit'),
  nodeId: stableIdSchema,
}).strict()

export const interactionTriggerSchema = z.discriminatedUnion('type', [
  ...triggerSchemas,
  z.object({
    type: z.literal('node.activated'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('animation.completed'),
    actionId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('presenter.command'),
    command: z.enum(['next', 'previous']),
  }).strict(),
  inputSubmitTriggerSchema,
])

const presentationInConditionSchema = z.object({
  type: z.literal('presentation.in'),
  stateIds: z.array(stableIdSchema).min(1).max(256),
}).strict().superRefine((condition, context) => {
  if (new Set(condition.stateIds).size !== condition.stateIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['stateIds'],
      message: '状态条件不能包含重复 ID',
    })
  }
})

const sceneInConditionSchema = z.object({
  type: z.literal('scene.in'),
  sceneIds: z.array(stableIdSchema).min(1).max(1_000),
}).strict().superRefine((condition, context) => {
  if (new Set(condition.sceneIds).size !== condition.sceneIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['sceneIds'],
      message: '场景条件不能包含重复 ID',
    })
  }
})

export const interactionConditionSchema = z.union([
  presentationInConditionSchema,
  sceneInConditionSchema,
  z.object({
    type: z.literal('course-state.exists'),
    key: courseStateKeySchema,
    exists: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal('course-state.compare'),
    key: courseStateKeySchema,
    operator: courseStateCompareOperatorSchema,
    value: courseStateScalarSchema,
  }).strict(),
])

export const audioActionTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sound'),
    soundId: stableIdSchema,
  }).strict(),
  z.object({
    kind: z.literal('channel'),
    channel: audioChannelSchema,
  }).strict(),
  z.object({
    kind: z.literal('all'),
  }).strict(),
])

const presentationActionSchema = z.object({
  type: z.literal('presentation.set'),
  stateId: stableIdSchema,
  transition: z.object({
    duration: z.number().finite().min(0).max(10_000).optional(),
    ease: z.string().trim().min(1).max(80).optional(),
  }).strict().optional(),
}).strict()

const audioActionSchemas = [
  z.object({
    type: z.literal('audio.play'),
    soundId: stableIdSchema,
    volume: z.number().finite().min(0).max(1).optional(),
    loop: z.boolean().optional(),
    fadeInMs: millisecondsSchema.optional(),
    lifetime: z.enum(['scene', 'course']).optional(),
    ifPlaying: z.enum(['restart', 'continue', 'ignore']).optional(),
  }).strict(),
  z.object({
    type: z.literal('audio.pause'),
    target: audioActionTargetSchema,
    fadeOutMs: millisecondsSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('audio.resume'),
    target: audioActionTargetSchema,
    fadeInMs: millisecondsSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('audio.stop'),
    target: audioActionTargetSchema,
    fadeOutMs: millisecondsSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('audio.toggle-mute'),
    target: audioActionTargetSchema,
  }).strict(),
] as const

const baseActionSchemas = [
  presentationActionSchema,
  z.object({
    type: z.literal('scene.go'),
    sceneId: stableIdSchema,
    targetStateId: stableIdSchema.optional(),
  }).strict(),
  z.object({ type: z.literal('scene.next') }).strict(),
  z.object({ type: z.literal('scene.previous') }).strict(),
  z.object({ type: z.literal('scene.replay') }).strict(),
  z.object({ type: z.literal('course.restart') }).strict(),
  z.object({
    type: z.literal('course-state.set'),
    key: courseStateKeySchema,
    value: courseStateScalarSchema,
  }).strict(),
  ...audioActionSchemas,
  z.object({
    type: z.literal('video.play'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.pause'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.restart'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.stop'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.toggle'),
    nodeId: stableIdSchema,
  }).strict(),
  z.object({
    type: z.literal('video.seek'),
    nodeId: stableIdSchema,
    seconds: mediaSecondsSchema,
  }).strict(),
] as const

const motionCommonFields = {
  nodeId: stableIdSchema,
  durationMs: millisecondsSchema,
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']),
} as const

function createNodeMotionActionSchema(type: 'node.enter' | 'node.exit') {
  return z.union([
    z.object({
      type: z.literal(type),
      ...motionCommonFields,
      effect: z.literal('slide'),
      direction: z.enum(['left', 'right', 'up', 'down']),
    }).strict(),
    z.object({
      type: z.literal(type),
      ...motionCommonFields,
      effect: z.enum(['none', 'fade', 'scale']),
    }).strict(),
  ])
}

export const nodeMotionActionSchema = z.union([
  createNodeMotionActionSchema('node.enter'),
  createNodeMotionActionSchema('node.exit'),
])

export const interactionActionSchema = z.union([
  z.discriminatedUnion('type', baseActionSchemas),
  nodeMotionActionSchema,
])

export const interactionActionStepSchema = z.object({
  id: stableIdSchema,
  start: z.enum(['after-previous', 'with-previous']),
  delayMs: millisecondsSchema,
  action: interactionActionSchema,
}).strict()

export const interactionRuleSchema: z.ZodType<InteractionRule> = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean(),
  trigger: interactionTriggerSchema,
  conditions: z.array(interactionConditionSchema)
    .max(MAX_INTERACTION_CONDITIONS),
  actions: z.array(interactionActionStepSchema)
    .min(1)
    .max(MAX_INTERACTION_ACTIONS),
}).strict().superRefine((rule, context) => {
  if (rule.actions[0]?.start !== 'after-previous') {
    context.addIssue({
      code: 'custom',
      path: ['actions', 0, 'start'],
      message: '规则的第一个动作必须独立开始',
    })
  }

  const actionIds = new Set<string>()
  rule.actions.forEach((step, index) => {
    if (actionIds.has(step.id)) {
      context.addIssue({
        code: 'custom',
        path: ['actions', index, 'id'],
        message: '同一规则中的动作 ID 不能重复',
      })
    }
    actionIds.add(step.id)

    if (!isTerminalNavigationAction(step.action)) return
    if (index !== rule.actions.length - 1 || step.start !== 'after-previous') {
      context.addIssue({
        code: 'custom',
        path: ['actions', index],
        message: '场景导航、重播或重开动作必须是最后一个独立动作组',
      })
    }
  })
})

function addScopeUniquenessIssues(
  rules: readonly InteractionRule[],
  context: z.RefinementCtx,
): void {
  const ruleIds = new Set<string>()
  const actionIds = new Set<string>()
  rules.forEach((rule, ruleIndex) => {
    if (ruleIds.has(rule.id)) {
      context.addIssue({
        code: 'custom',
        path: [ruleIndex, 'id'],
        message: '同一作用域中的交互规则 ID 不能重复',
      })
    }
    ruleIds.add(rule.id)
    rule.actions.forEach((step, actionIndex) => {
      if (actionIds.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: [ruleIndex, 'actions', actionIndex, 'id'],
          message: '同一作用域中的动作 ID 不能重复',
        })
      }
      actionIds.add(step.id)
    })
  })
}

export const sceneInteractionsSchema = z.array(interactionRuleSchema)
  .max(MAX_SCENE_INTERACTIONS)
  .superRefine(addScopeUniquenessIssues)

export function parseSceneInteractions(value: unknown): InteractionRule[] {
  return sceneInteractionsSchema.parse(value)
}
