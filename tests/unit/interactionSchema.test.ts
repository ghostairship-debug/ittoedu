import { describe, expect, it } from 'vitest'
import {
  interactionRuleSchema,
  parseSceneInteractions,
  sceneInteractionsSchema,
} from '@/shared/interactionSchema'
import {
  isTerminalNavigationAction,
  type InteractionActionPayload,
  type InteractionActionStep,
  type InteractionRule,
  type InteractionTrigger,
} from '@/shared/interactionTypes'

function steps(actions: InteractionActionPayload[]): InteractionActionStep[] {
  return actions.map((action, index) => ({
    id: `action_${index + 1}`,
    start: 'after-previous',
    delayMs: 0,
    action,
  }))
}

function rule(
  trigger: InteractionTrigger = { type: 'node.click', nodeId: 'button' },
  actions: InteractionActionStep[] = steps([{
    type: 'presentation.set',
    stateId: 'feedback',
  }]),
): InteractionRule {
  return {
    id: 'rule_one',
    name: '按钮到反馈',
    enabled: true,
    trigger,
    conditions: [{
      type: 'presentation.in',
      stateIds: ['question'],
    }],
    actions,
  }
}

describe('interaction schema', () => {
  it('accepts strict course-state conditions and a non-terminal typed set action', () => {
    const key = 'k'.repeat(240)
    const candidate = rule(undefined, steps([
      { type: 'course-state.set', key, value: 3 },
      { type: 'scene.next' },
    ]))
    candidate.conditions = [
      { type: 'course-state.exists', key, exists: true },
      { type: 'course-state.compare', key, operator: 'gte', value: 2 },
    ]

    expect(interactionRuleSchema.parse(candidate)).toEqual(candidate)
    expect(isTerminalNavigationAction(candidate.actions[0]!.action)).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...candidate,
      conditions: [{
        type: 'course-state.exists',
        key,
        exists: true,
        unknown: true,
      }],
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...candidate,
      actions: steps([{ type: 'course-state.set', key, value: Number.POSITIVE_INFINITY }]),
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...candidate,
      conditions: [{
        type: 'course-state.compare',
        key: `${key}x`,
        operator: 'eq',
        value: 2,
      }],
    }).success).toBe(false)
  })

  it('accepts the authorable trigger family and preserves strict data', () => {
    const triggers: InteractionTrigger[] = [
      { type: 'node.click', nodeId: 'button' },
      { type: 'node.activated', nodeId: 'result_card' },
      { type: 'scene.enter' },
      { type: 'presentation.enter', stateId: 'question' },
      { type: 'component.event', nodeId: 'quiz', eventName: 'answer:correct' },
      { type: 'runtime.event', scope: 'scene', eventName: 'answer:correct' },
      { type: 'runtime.event', scope: 'global', eventName: 'course:unlocked' },
      { type: 'audio.ended', soundId: 'narration_intro' },
      { type: 'video.started', nodeId: 'video_demo' },
      { type: 'video.paused', nodeId: 'video_demo' },
      { type: 'video.ended', nodeId: 'video_demo' },
      { type: 'video.time', nodeId: 'video_demo', seconds: 12.5 },
      { type: 'animation.completed', actionId: 'enter_result' },
    ]

    for (const trigger of triggers) {
      expect(interactionRuleSchema.parse(rule(trigger)).trigger).toEqual(trigger)
    }
    expect(() => interactionRuleSchema.parse({
      ...rule(),
      unexpected: true,
    })).toThrow()
  })

  it('accepts state, host, audio, video, and motion actions', () => {
    const payloads: InteractionActionPayload[] = [
      {
        type: 'presentation.set',
        stateId: 'feedback',
        transition: { duration: 240, ease: 'Sine.easeInOut' },
      },
      {
        type: 'audio.play',
        soundId: 'correct',
        volume: 0.8,
        loop: false,
        fadeInMs: 120,
        lifetime: 'scene',
        ifPlaying: 'restart',
      },
      {
        type: 'audio.pause',
        target: { kind: 'channel', channel: 'music' },
        fadeOutMs: 300,
      },
      {
        type: 'audio.resume',
        target: { kind: 'sound', soundId: 'narration' },
        fadeInMs: 300,
      },
      { type: 'audio.stop', target: { kind: 'all' } },
      { type: 'audio.toggle-mute', target: { kind: 'channel', channel: 'sfx' } },
      { type: 'video.play', nodeId: 'video_demo' },
      { type: 'video.pause', nodeId: 'video_demo' },
      { type: 'video.restart', nodeId: 'video_demo' },
      { type: 'video.stop', nodeId: 'video_demo' },
      { type: 'video.toggle', nodeId: 'video_demo' },
      { type: 'video.seek', nodeId: 'video_demo', seconds: 15.25 },
      {
        type: 'node.enter',
        nodeId: 'result_card',
        effect: 'slide',
        direction: 'left',
        durationMs: 320,
        easing: 'ease-out',
      },
      {
        type: 'node.exit',
        nodeId: 'hint',
        effect: 'fade',
        durationMs: 180,
        easing: 'ease-in',
      },
      { type: 'scene.go', sceneId: 'scene_result', targetStateId: 'state_summary' },
    ]
    const actionSteps = steps(payloads)

    expect(interactionRuleSchema.parse(rule(undefined, actionSteps)).actions)
      .toEqual(actionSteps)
  })

  it('requires navigation to own the final independent action group', () => {
    const invalid = rule(undefined, steps([
      { type: 'scene.next' },
      { type: 'audio.play', soundId: 'click' },
    ]))
    const result = interactionRuleSchema.safeParse(invalid)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['actions', 0] }),
      ]))
    }

    expect(() => interactionRuleSchema.parse(rule(undefined, steps([
      { type: 'audio.play', soundId: 'click' },
      { type: 'scene.next' },
    ])))).not.toThrow()

    const parallelNavigation = steps([{ type: 'scene.next' }])
    parallelNavigation[0]!.start = 'with-previous'
    expect(interactionRuleSchema.safeParse(rule(undefined, parallelNavigation)).success)
      .toBe(false)
  })

  it('rejects invalid media/motion ranges and duplicate state ids', () => {
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      actions: steps([{ type: 'audio.play', soundId: 'music', volume: 1.1 }]),
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      actions: steps([{ type: 'video.seek', nodeId: 'video', seconds: -1 }]),
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      actions: steps([{
        type: 'node.enter',
        nodeId: 'node',
        effect: 'slide',
        durationMs: 200,
        easing: 'ease-out',
      } as unknown as InteractionActionPayload]),
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      actions: steps([{
        type: 'node.exit',
        nodeId: 'node',
        effect: 'fade',
        direction: 'left',
        durationMs: 200,
        easing: 'ease-in',
      } as unknown as InteractionActionPayload]),
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      conditions: [{ type: 'presentation.in', stateIds: ['question', 'question'] }],
    }).success).toBe(false)
    expect(interactionRuleSchema.parse({
      ...rule(),
      conditions: [{ type: 'scene.in', sceneIds: ['intro', 'practice'] }],
    }).conditions).toEqual([
      { type: 'scene.in', sceneIds: ['intro', 'practice'] },
    ])
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      conditions: [{ type: 'scene.in', sceneIds: ['intro', 'intro'] }],
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      actions: steps([{ type: 'scene.go', sceneId: 'scene', targetStateId: '   ' }]),
    }).success).toBe(false)
    expect(interactionRuleSchema.safeParse({
      ...rule(),
      trigger: { type: 'runtime.event', scope: 'course', eventName: 'complete' },
    }).success).toBe(false)
  })

  it('rejects duplicate rule/action ids and returns independent parsed data', () => {
    const first = rule()
    const duplicateRule = { ...rule(), name: '重复' }
    expect(sceneInteractionsSchema.safeParse([first, duplicateRule]).success).toBe(false)

    const duplicateAction = {
      ...rule(),
      actions: [first.actions[0]!, structuredClone(first.actions[0]!)],
    }
    expect(interactionRuleSchema.safeParse(duplicateAction).success).toBe(false)

    const crossRuleDuplicateAction = {
      ...rule(),
      id: 'rule_two',
    }
    expect(sceneInteractionsSchema.safeParse([first, crossRuleDuplicateAction]).success)
      .toBe(false)

    const parsed = parseSceneInteractions([
      first,
      {
        ...rule(),
        id: 'rule_three',
        actions: [{ ...rule().actions[0]!, id: 'action_three' }],
      },
    ])
    expect(parsed.map((item) => item.id)).toEqual(['rule_one', 'rule_three'])
  })
})
