import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PublishedInteractionController,
} from '@/player/interactions/PublishedInteractionController'
import type {
  PublishedInteractionDiagnostic,
  PublishedInteractionSessionPort,
  PublishedInteractionSurfacePort,
  PublishedNodeMotionContext,
} from '@/player/interactions/PublishedInteractionSurfacePort'
import { CourseStateStore } from '@/player/CourseStateStore'
import type {
  InteractionActionPayload,
  InteractionActionStep,
  InteractionCondition,
  InteractionRule,
  NodeMotionAction,
} from '@/shared/contracts/interaction-v1/types'

function motion(
  type: NodeMotionAction['type'],
  nodeId: string,
): NodeMotionAction {
  return {
    type,
    nodeId,
    durationMs: 120,
    easing: 'ease-out',
    effect: 'fade',
  }
}

function actionStep(
  id: string,
  action: InteractionActionPayload,
  options: Partial<Pick<InteractionActionStep, 'start' | 'delayMs'>> = {},
): InteractionActionStep {
  return {
    id,
    start: options.start ?? 'after-previous',
    delayMs: options.delayMs ?? 0,
    action,
  }
}

function clickRule(
  id: string,
  nodeId: string,
  actions: InteractionActionStep[],
  conditions: InteractionCondition[] = [],
): InteractionRule {
  return {
    id,
    enabled: true,
    trigger: { type: 'node.click', nodeId },
    conditions,
    actions,
  }
}

function surfaceHarness(overrides: {
  bindNodeClick?: PublishedInteractionSurfacePort['bindNodeClick']
  executeNodeMotion?: PublishedInteractionSurfacePort['executeNodeMotion']
  bindVideoEvent?: PublishedInteractionSurfacePort['bindVideoEvent']
  executeVideoAction?: PublishedInteractionSurfacePort['executeVideoAction']
} = {}) {
  const listeners = new Map<string, () => void>()
  const videoListeners = new Map<string, Set<(seconds?: number) => void>>()
  const videoDisposed: string[] = []
  const disposed: string[] = []
  const executeNodeMotion = vi.fn((
    _action: NodeMotionAction,
    _context: PublishedNodeMotionContext,
  ) => true)
  const executeVideoAction = vi.fn((
    action: Extract<InteractionActionPayload, { type: `video.${string}` }>,
  ) => action.nodeId === 'video-a')
  const surface: PublishedInteractionSurfacePort = {
    bindNodeClick: overrides.bindNodeClick ?? ((nodeId, listener) => {
      listeners.set(nodeId, listener)
      return () => {
        disposed.push(nodeId)
        listeners.delete(nodeId)
      }
    }),
    executeNodeMotion: overrides.executeNodeMotion ?? executeNodeMotion,
    bindVideoEvent: overrides.bindVideoEvent ?? ((nodeId, kind, listener) => {
      const key = `${nodeId}::${kind}`
      let registrations = videoListeners.get(key)
      if (!registrations) {
        registrations = new Set()
        videoListeners.set(key, registrations)
      }
      registrations.add(listener)
      return () => {
        videoDisposed.push(key)
        videoListeners.get(key)?.delete(listener)
      }
    }),
    executeVideoAction: overrides.executeVideoAction ?? executeVideoAction,
  }
  return {
    surface,
    listeners,
    disposed,
    executeNodeMotion,
    videoListeners,
    videoDisposed,
    executeVideoAction,
    emitVideo(nodeId: string, kind: string, seconds?: number) {
      for (const listener of [...(videoListeners.get(`${nodeId}::${kind}`) ?? [])]) {
        listener(seconds)
      }
    },
  }
}

function sessionHarness(initialSceneId = 'scene_one') {
  let sceneId: string | null = initialSceneId
  const courseState = new CourseStateStore()
  const goToScene = vi.fn((
    _targetSceneId: string,
    _targetStateId: string | undefined,
    _signal: AbortSignal,
  ) => true)
  const nextScene = vi.fn((_signal: AbortSignal) => true)
  const previousScene = vi.fn((_signal: AbortSignal) => true)
  const replayScene = vi.fn((_signal: AbortSignal) => true)
  const restartCourse = vi.fn((_signal: AbortSignal) => true)
  const session: PublishedInteractionSessionPort = {
    courseState,
    currentSceneId: () => sceneId,
    goToScene,
    nextScene,
    previousScene,
    replayScene,
    restartCourse,
  }
  return {
    session,
    goToScene,
    nextScene,
    previousScene,
    replayScene,
    restartCourse,
    courseState,
    setSceneId(next: string | null) {
      sceneId = next
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PublishedInteractionController', () => {
  it('deduplicates click bindings and runs only enabled rules in the current scene', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness('scene_one')
    const current = clickRule('current', 'button', [
      actionStep('current_enter', motion('node.enter', 'answer')),
    ], [{ type: 'scene.in', sceneIds: ['scene_one'] }])
    const elsewhere = clickRule('elsewhere', 'button', [
      actionStep('elsewhere_enter', motion('node.enter', 'elsewhere')),
    ], [{ type: 'scene.in', sceneIds: ['scene_two'] }])
    const disabled = {
      ...clickRule('disabled', 'button', [
        actionStep('disabled_enter', motion('node.enter', 'disabled')),
      ]),
      enabled: false,
    }

    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [current, elsewhere, disabled],
      surface: host.surface,
      session: navigation.session,
    })

    expect([...host.listeners.keys()]).toEqual(['button'])
    host.listeners.get('button')?.()

    await vi.waitFor(() => expect(host.executeNodeMotion).toHaveBeenCalledTimes(1))
    expect(host.executeNodeMotion.mock.calls[0]?.[0]).toMatchObject({
      type: 'node.enter',
      nodeId: 'answer',
    })

    controller.destroy()
    expect(host.disposed).toEqual(['button'])
  })

  it('ANDs course-state conditions once and exposes a synchronous set to later steps', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness()
    const diagnostics: PublishedInteractionDiagnostic[] = []
    navigation.courseState.set('score', 2)
    navigation.courseState.set('unlocked', false)
    navigation.nextScene.mockImplementation(() => (
      navigation.courseState.get('unlocked') === true
    ))
    const rule = clickRule('unlock', 'button', [
      actionStep('set-unlocked', {
        type: 'course-state.set',
        key: 'unlocked',
        value: true,
      }),
      actionStep('show-result', motion('node.enter', 'result')),
      actionStep('continue', { type: 'scene.next' }),
    ], [
      { type: 'course-state.exists', key: 'score', exists: true },
      { type: 'course-state.compare', key: 'score', operator: 'gte', value: 2 },
      { type: 'course-state.compare', key: 'unlocked', operator: 'eq', value: false },
    ])
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [rule],
      surface: host.surface,
      session: navigation.session,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    host.listeners.get('button')?.()

    await vi.waitFor(() => expect(navigation.nextScene).toHaveBeenCalledOnce())
    expect(navigation.courseState.get('unlocked')).toBe(true)
    expect(host.executeNodeMotion).toHaveBeenCalledOnce()
    expect(diagnostics).toEqual([])

    navigation.courseState.set('score', 1)
    navigation.courseState.set('unlocked', false)
    host.listeners.get('button')?.()
    await Promise.resolve()
    expect(navigation.nextScene).toHaveBeenCalledOnce()
    expect(navigation.courseState.get('unlocked')).toBe(false)

    controller.destroy()
  })

  it('routes every supported terminal navigation through the Published session port', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness()
    const rules = [
      clickRule('go', 'go', [
        actionStep('go_step', { type: 'scene.go', sceneId: 'scene_two', targetStateId: 'result' }),
      ]),
      clickRule('next', 'next', [actionStep('next_step', { type: 'scene.next' })]),
      clickRule('previous', 'previous', [
        actionStep('previous_step', { type: 'scene.previous' }),
      ]),
      clickRule('replay', 'replay', [actionStep('replay_step', { type: 'scene.replay' })]),
      clickRule('restart', 'restart', [
        actionStep('restart_step', { type: 'course.restart' }),
      ]),
    ]
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules,
      surface: host.surface,
      session: navigation.session,
    })

    for (const nodeId of ['go', 'next', 'previous', 'replay', 'restart']) {
      host.listeners.get(nodeId)?.()
    }

    await vi.waitFor(() => {
      expect(navigation.goToScene).toHaveBeenCalledTimes(1)
      expect(navigation.nextScene).toHaveBeenCalledTimes(1)
      expect(navigation.previousScene).toHaveBeenCalledTimes(1)
      expect(navigation.replayScene).toHaveBeenCalledTimes(1)
      expect(navigation.restartCourse).toHaveBeenCalledTimes(1)
    })
    expect(navigation.goToScene).toHaveBeenCalledWith(
      'scene_two',
      'result',
      expect.any(AbortSignal),
    )
    controller.destroy()
  })

  it('honors parallel delays, serial groups and terminal ownership of later groups', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const host = surfaceHarness({
      executeNodeMotion: (action) => {
        order.push(`${action.type}:${action.nodeId}`)
        return true
      },
    })
    const navigation = sessionHarness()
    navigation.session.nextScene = (_signal) => {
      order.push('scene.next')
      return true
    }
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [clickRule('timed', 'button', [
        actionStep('a', motion('node.enter', 'a'), { delayMs: 10 }),
        actionStep('b', motion('node.enter', 'b'), { start: 'with-previous', delayMs: 20 }),
        actionStep('c', motion('node.exit', 'c'), { delayMs: 5 }),
        actionStep('navigate', { type: 'scene.next' }),
        actionStep('too_late', motion('node.enter', 'too_late')),
      ])],
      surface: host.surface,
      session: navigation.session,
    })

    host.listeners.get('button')?.()
    await vi.advanceTimersByTimeAsync(9)
    expect(order).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(order).toEqual(['node.enter:a'])
    await vi.advanceTimersByTimeAsync(10)
    expect(order).toEqual(['node.enter:a', 'node.enter:b'])
    await vi.advanceTimersByTimeAsync(5)
    expect(order).toEqual([
      'node.enter:a',
      'node.enter:b',
      'node.exit:c',
      'scene.next',
    ])
    await vi.runAllTimersAsync()
    expect(order).not.toContain('node.enter:too_late')
    controller.destroy()
  })

  it('cancels the previous run when one rule is triggered repeatedly', async () => {
    const contexts: PublishedNodeMotionContext[] = []
    const host = surfaceHarness({
      executeNodeMotion: (_action, context) => {
        contexts.push(context)
        if (contexts.length > 1) return true
        return new Promise<boolean>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(false), { once: true })
        })
      },
    })
    const navigation = sessionHarness()
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [clickRule('repeat', 'button', [
        actionStep('motion', motion('node.enter', 'answer')),
      ])],
      surface: host.surface,
      session: navigation.session,
    })

    host.listeners.get('button')?.()
    await vi.waitFor(() => expect(contexts).toHaveLength(1))
    host.listeners.get('button')?.()
    await vi.waitFor(() => expect(contexts).toHaveLength(2))

    expect(contexts[0]?.signal.aborted).toBe(true)
    expect(contexts[0]?.restartFromBeginning).toBe(false)
    expect(contexts[1]?.signal.aborted).toBe(false)
    expect(contexts[1]?.restartFromBeginning).toBe(true)
    controller.destroy()
  })

  it('cancels delayed scene-scoped work after the current scene changes', async () => {
    vi.useFakeTimers()
    const host = surfaceHarness()
    const navigation = sessionHarness('scene_one')
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [clickRule('scoped', 'button', [
        actionStep('delayed', motion('node.enter', 'answer'), { delayMs: 50 }),
      ], [{ type: 'scene.in', sceneIds: ['scene_one'] }])],
      surface: host.surface,
      session: navigation.session,
    })

    host.listeners.get('button')?.()
    navigation.setSceneId('scene_two')
    await vi.advanceTimersByTimeAsync(50)

    expect(host.executeNodeMotion).not.toHaveBeenCalled()
    controller.destroy()
  })

  it('aborts timers and releases click bindings exactly once on destroy', async () => {
    vi.useFakeTimers()
    const host = surfaceHarness()
    const navigation = sessionHarness()
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [clickRule('delayed', 'button', [
        actionStep('delayed_step', motion('node.enter', 'answer'), { delayMs: 500 }),
      ])],
      surface: host.surface,
      session: navigation.session,
    })
    const staleListener = host.listeners.get('button')

    staleListener?.()
    controller.destroy()
    controller.destroy()
    staleListener?.()
    await vi.runAllTimersAsync()

    expect(host.disposed).toEqual(['button'])
    expect(host.executeNodeMotion).not.toHaveBeenCalled()
  })

  it('diagnoses and skips unsupported trigger, condition and action families', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness()
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const unsupportedTrigger: InteractionRule = {
      id: 'scene_enter',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [actionStep('scene_enter_step', motion('node.enter', 'answer'))],
    }
    const unsupportedCondition = clickRule('state_condition', 'button', [
      actionStep('state_step', motion('node.enter', 'state_answer')),
    ], [{ type: 'presentation.in', stateIds: ['result'] }])
    const unsupportedOnly = clickRule('state_condition_only', 'unsupported_only', [
      actionStep('state_only_step', motion('node.enter', 'state_only_answer')),
    ], [{ type: 'presentation.in', stateIds: ['result'] }])
    const disabledOnly = {
      ...clickRule('disabled_only', 'disabled_only', [
        actionStep('disabled_only_step', motion('node.enter', 'disabled_only_answer')),
      ]),
      enabled: false,
    }
    const unsupportedAction = clickRule('audio_action', 'button', [
      actionStep('audio_step', { type: 'audio.play', soundId: 'ding' }),
      actionStep('motion_step', motion('node.enter', 'supported_answer')),
    ])

    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [
        unsupportedTrigger,
        unsupportedCondition,
        unsupportedOnly,
        disabledOnly,
        unsupportedAction,
      ],
      surface: host.surface,
      session: navigation.session,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    expect(diagnostics.map((item) => item.code)).toEqual([
      'unsupported-trigger',
      'unsupported-condition',
      'unsupported-condition',
      'unsupported-action',
    ])
    expect(diagnostics.every((item) => (
      item.surfaceId === 'slide_surface' && item.phase === 'execute'
    ))).toBe(true)

    expect([...host.listeners.keys()]).toEqual(['button'])
    host.listeners.get('button')?.()
    await vi.waitFor(() => expect(host.executeNodeMotion).toHaveBeenCalledTimes(1))
    expect(host.executeNodeMotion.mock.calls[0]?.[0]).toMatchObject({
      nodeId: 'supported_answer',
    })
    expect(diagnostics).toHaveLength(4)
    controller.destroy()
  })

  it('isolates binding, motion and navigation failures across rules', async () => {
    const listeners = new Map<string, () => void>()
    const executeNodeMotion = vi.fn((action: NodeMotionAction) => {
      if (action.nodeId === 'broken') throw new Error('motion boom')
      return true
    })
    const host = surfaceHarness({
      bindNodeClick: (nodeId, listener) => {
        if (nodeId === 'bind_error') throw new Error('bind boom')
        if (nodeId === 'missing') return null
        listeners.set(nodeId, listener)
        return () => listeners.delete(nodeId)
      },
      executeNodeMotion,
    })
    const navigation = sessionHarness()
    navigation.previousScene.mockImplementation(() => false)
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [
        clickRule('bind_error_rule', 'bind_error', [
          actionStep('bind_error_step', motion('node.enter', 'unused')),
        ]),
        clickRule('missing_rule', 'missing', [
          actionStep('missing_step', motion('node.enter', 'unused')),
        ]),
        clickRule('broken_motion', 'shared', [
          actionStep('broken_step', motion('node.enter', 'broken')),
          actionStep('after_broken', motion('node.enter', 'must_not_run')),
        ]),
        clickRule('independent_navigation', 'shared', [
          actionStep('next_step', { type: 'scene.next' }),
        ]),
        clickRule('failed_navigation', 'nav_fail', [
          actionStep('previous_step', { type: 'scene.previous' }),
          actionStep('after_previous', motion('node.enter', 'must_not_run_either')),
        ]),
      ],
      surface: host.surface,
      session: navigation.session,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    listeners.get('shared')?.()
    listeners.get('nav_fail')?.()

    await vi.waitFor(() => {
      expect(navigation.nextScene).toHaveBeenCalledTimes(1)
      expect(navigation.previousScene).toHaveBeenCalledTimes(1)
      expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
        'bind-failed',
        'bind-unavailable',
        'motion-failed',
        'navigation-failed',
      ]))
    })
    expect(executeNodeMotion.mock.calls.map(([action]) => action.nodeId)).toEqual(['broken'])
    controller.destroy()
  })

  it('contains disposer and diagnostic-sink failures during teardown', () => {
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const host = surfaceHarness({
      bindNodeClick: () => () => {
        throw new Error('dispose boom')
      },
    })
    const navigation = sessionHarness()
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [clickRule('rule', 'button', [])],
      surface: host.surface,
      session: navigation.session,
      reportDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic)
        if (diagnostic.code === 'dispose-failed') throw new Error('sink boom')
      },
    })

    expect(() => controller.destroy()).not.toThrow()
    expect(diagnostics.map((item) => item.code)).toContain('dispose-failed')
  })

  it('routes video actions only to the addressed node and diagnoses misses', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness()
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [clickRule('video_route', 'button', [
        actionStep('play_supported', { type: 'video.play', nodeId: 'video-a' }),
        actionStep('pause_missing', { type: 'video.pause', nodeId: 'video-b' }),
        actionStep('never_reached', motion('node.enter', 'answer')),
      ])],
      surface: host.surface,
      session: navigation.session,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    host.listeners.get('button')?.()
    await vi.waitFor(() => expect(host.executeVideoAction).toHaveBeenCalledTimes(2))
    expect(host.executeVideoAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'video.play', nodeId: 'video-a' },
      { type: 'video.pause', nodeId: 'video-b' },
    ])
    expect(host.executeNodeMotion).not.toHaveBeenCalled()
    expect(diagnostics.map((item) => item.code)).toEqual(['video-failed'])
    expect(diagnostics[0]).toMatchObject({
      ruleId: 'video_route',
      stepId: 'pause_missing',
      nodeId: 'video-b',
      interactionType: 'video.pause',
    })
    controller.destroy()
  })

  it('fires video started/paused/ended triggers only in the current scene', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness('scene_one')
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [
        clickRule('unused_click', 'button', []),
        {
          id: 'on_started',
          enabled: true,
          trigger: { type: 'video.started', nodeId: 'video-a' },
          conditions: [{ type: 'scene.in', sceneIds: ['scene_one'] }],
          actions: [actionStep('show_started', motion('node.enter', 'started_target'))],
        },
        {
          id: 'on_paused',
          enabled: true,
          trigger: { type: 'video.paused', nodeId: 'video-a' },
          conditions: [],
          actions: [actionStep('show_paused', motion('node.enter', 'paused_target'))],
        },
        {
          id: 'on_ended_elsewhere',
          enabled: true,
          trigger: { type: 'video.ended', nodeId: 'video-a' },
          conditions: [{ type: 'scene.in', sceneIds: ['scene_two'] }],
          actions: [actionStep('show_ended', motion('node.enter', 'ended_target'))],
        },
      ],
      surface: host.surface,
      session: navigation.session,
    })

    host.emitVideo('video-a', 'started')
    host.emitVideo('video-a', 'paused')
    host.emitVideo('video-a', 'ended')

    await vi.waitFor(() => expect(host.executeNodeMotion).toHaveBeenCalledTimes(2))
    expect(host.executeNodeMotion.mock.calls.map(([action]) => action.nodeId).sort()).toEqual(
      ['paused_target', 'started_target'],
    )
    controller.destroy()
  })

  it('treats video.time as a crossing threshold and rearms after rewind', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness()
    const timeRule = (id: string, seconds: number): InteractionRule => ({
      id,
      enabled: true,
      trigger: { type: 'video.time', nodeId: 'video-a', seconds },
      conditions: [],
      actions: [actionStep(`${id}_step`, motion('node.enter', `${id}_target`))],
    })
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [timeRule('five', 5), timeRule('ten', 10)],
      surface: host.surface,
      session: navigation.session,
    })

    host.emitVideo('video-a', 'time', 3)
    await Promise.resolve()
    expect(host.executeNodeMotion).not.toHaveBeenCalled()

    host.emitVideo('video-a', 'time', 6)
    await vi.waitFor(() => expect(host.executeNodeMotion).toHaveBeenCalledTimes(1))
    expect(host.executeNodeMotion.mock.calls[0]?.[0]).toMatchObject({ nodeId: 'five_target' })

    host.emitVideo('video-a', 'time', 7)
    await Promise.resolve()
    expect(host.executeNodeMotion).toHaveBeenCalledTimes(1)

    host.emitVideo('video-a', 'time', 11)
    await vi.waitFor(() => expect(host.executeNodeMotion).toHaveBeenCalledTimes(2))
    expect(host.executeNodeMotion.mock.calls[1]?.[0]).toMatchObject({ nodeId: 'ten_target' })

    host.emitVideo('video-a', 'time', 2)
    await Promise.resolve()
    expect(host.executeNodeMotion).toHaveBeenCalledTimes(2)

    host.emitVideo('video-a', 'time', 6)
    await vi.waitFor(() => expect(host.executeNodeMotion).toHaveBeenCalledTimes(3))
    expect(host.executeNodeMotion.mock.calls[2]?.[0]).toMatchObject({ nodeId: 'five_target' })
    controller.destroy()
  })

  it('ignores video events after destroy and cancels delayed video work on scene change', async () => {
    vi.useFakeTimers()
    const host = surfaceHarness()
    const navigation = sessionHarness('scene_one')
    const controller = new PublishedInteractionController({
      surfaceId: 'slide_surface',
      rules: [{
        id: 'video_delayed',
        enabled: true,
        trigger: { type: 'video.started', nodeId: 'video-a' },
        conditions: [{ type: 'scene.in', sceneIds: ['scene_one'] }],
        actions: [actionStep('delayed', motion('node.enter', 'answer'), { delayMs: 50 })],
      }],
      surface: host.surface,
      session: navigation.session,
    })

    host.emitVideo('video-a', 'started')
    navigation.setSceneId('scene_two')
    await vi.advanceTimersByTimeAsync(60)
    expect(host.executeNodeMotion).not.toHaveBeenCalled()

    navigation.setSceneId('scene_one')
    host.emitVideo('video-a', 'started')
    controller.destroy()
    await vi.advanceTimersByTimeAsync(60)
    expect(host.executeNodeMotion).not.toHaveBeenCalled()
    expect(host.videoDisposed.length).toBeGreaterThan(0)
  })

  it('diagnoses video triggers as unavailable when the surface has no video port', async () => {
    const listeners = new Map<string, () => void>()
    const executeNodeMotion = vi.fn(() => true)
    const surface: PublishedInteractionSurfacePort = {
      bindNodeClick: (nodeId, listener) => {
        listeners.set(nodeId, listener)
        return () => listeners.delete(nodeId)
      },
      executeNodeMotion,
    }
    const navigation = sessionHarness()
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const controller = new PublishedInteractionController({
      surfaceId: 'flow_surface',
      rules: [{
        id: 'video_elsewhere',
        enabled: true,
        trigger: { type: 'video.started', nodeId: 'video-a' },
        conditions: [],
        actions: [actionStep('video_elsewhere_step', motion('node.enter', 'answer'))],
      }],
      surface,
      session: navigation.session,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    expect(diagnostics.map((item) => item.code)).toEqual(['bind-unavailable'])
    expect(diagnostics[0]).toMatchObject({ nodeId: 'video-a' })
    controller.destroy()
  })
})
