import { describe, expect, it } from 'vitest'
import {
  beginRuntimeTargetEditSession,
  runtimeTargetEditSessionMatchesContext,
  runtimeTargetMatchesEditSession,
  validateRuntimeTargetEditSession,
  type RuntimeTargetEditContext,
} from '@/renderer/authoring/runtimeTargetEditSession'
import type { RuntimeAuthoringTarget } from '@/shared/runtimeTypes'

function target(
  overrides: Partial<RuntimeAuthoringTarget> = {},
): RuntimeAuthoringTarget {
  return {
    targetId: 'runtime:scene:registered:1',
    nodeId: 'runtime-layer-one',
    scope: 'scene',
    sceneId: 'scene-one',
    kind: 'text',
    key: 'title',
    label: '标题',
    multiline: false,
    maxLength: 80,
    layer: 'overlay',
    source: 'registered',
    bounds: { x: 120, y: 80, width: 260, height: 48 },
    ...overrides,
  }
}

function context(
  overrides: Partial<RuntimeTargetEditContext> = {},
): RuntimeTargetEditContext {
  const liveTarget = target()
  return {
    projectId: 'project-one',
    scope: 'scene',
    sceneId: 'scene-one',
    stateId: 'state-question',
    targets: [liveTarget],
    ...overrides,
  }
}

describe('Runtime text/asset edit session', () => {
  it.each([
    ['text', target()],
    ['asset', target({
      targetId: 'runtime:scene:registered:2',
      kind: 'asset',
      key: 'hero',
    })],
  ] as const)('captures an immutable %s target identity', (_label, liveTarget) => {
    const started = beginRuntimeTargetEditSession(
      liveTarget,
      context({ targets: [liveTarget] }),
    )

    expect(started).toEqual({
      ok: true,
      session: {
        projectId: 'project-one',
        scope: 'scene',
        sceneId: 'scene-one',
        targetId: liveTarget.targetId,
        nodeId: liveTarget.nodeId,
        kind: liveTarget.kind,
        key: liveTarget.key,
      },
    })
    if (!started.ok) throw new Error('session did not start')
    expect(Object.isFrozen(started.session)).toBe(true)
    expect('stateId' in started.session).toBe(false)
  })

  it.each([
    ['project', { projectId: 'project-two' }],
    ['scope', { scope: 'global' as const }],
    ['scene', { sceneId: 'scene-two' }],
  ])('rejects a changed %s context', (_label, changed) => {
    const liveTarget = target()
    const started = beginRuntimeTargetEditSession(
      liveTarget,
      context({ targets: [liveTarget] }),
    )
    if (!started.ok) throw new Error('session did not start')
    const changedContext = context({ targets: [liveTarget], ...changed })

    expect(runtimeTargetEditSessionMatchesContext(
      started.session,
      changedContext,
    )).toBe(false)
    expect(validateRuntimeTargetEditSession(
      started.session,
      changedContext,
    )).toEqual({ ok: false, reason: 'context-changed' })
  })

  it.each([
    ['target id', target({ targetId: 'runtime:scene:registered:replacement' })],
    ['node id', target({ nodeId: 'runtime-layer-two' })],
    ['kind', target({ kind: 'asset' })],
    ['key', target({ key: 'subtitle' })],
  ] as const)('rejects a target whose %s changed', (_label, replacement) => {
    const liveTarget = target()
    const started = beginRuntimeTargetEditSession(
      liveTarget,
      context({ targets: [liveTarget] }),
    )
    if (!started.ok) throw new Error('session did not start')

    expect(runtimeTargetMatchesEditSession(
      replacement,
      started.session,
    )).toBe(false)
    expect(validateRuntimeTargetEditSession(
      started.session,
      context({ targets: [replacement] }),
    )).toEqual({ ok: false, reason: 'target-invalid' })
  })

  it('rejects an unregistered target and accepts a refreshed equivalent snapshot', () => {
    const liveTarget = target()
    const started = beginRuntimeTargetEditSession(
      liveTarget,
      context({ targets: [liveTarget] }),
    )
    if (!started.ok) throw new Error('session did not start')

    expect(validateRuntimeTargetEditSession(
      started.session,
      context({ targets: [] }),
    )).toEqual({ ok: false, reason: 'target-invalid' })

    const refreshed = target({
      label: '刷新后的标题',
      bounds: { x: 180, y: 120, width: 300, height: 52 },
    })
    expect(validateRuntimeTargetEditSession(
      started.session,
      context({ targets: [refreshed] }),
    )).toEqual({ ok: true, target: refreshed })
  })

  it('remains valid across presentation-state changes', () => {
    const liveTarget = target()
    const started = beginRuntimeTargetEditSession(
      liveTarget,
      context({ targets: [liveTarget], stateId: 'state-question' }),
    )
    if (!started.ok) throw new Error('session did not start')

    const nextState = context({
      targets: [liveTarget],
      stateId: 'state-feedback',
    })
    expect(runtimeTargetEditSessionMatchesContext(
      started.session,
      nextState,
    )).toBe(true)
    expect(validateRuntimeTargetEditSession(
      started.session,
      nextState,
    )).toEqual({ ok: true, target: liveTarget })
  })

  it('binds a global Runtime session to the active editor scene, not a state', () => {
    const globalTarget = target({
      targetId: 'runtime:global:dom:1',
      scope: 'global',
      sceneId: undefined,
      key: 'courseTitle',
      source: 'dom',
    })
    const started = beginRuntimeTargetEditSession(globalTarget, context({
      scope: 'global',
      sceneId: 'scene-one',
      stateId: 'state-question',
      targets: [globalTarget],
    }))
    if (!started.ok) throw new Error('session did not start')

    expect(validateRuntimeTargetEditSession(started.session, context({
      scope: 'global',
      sceneId: 'scene-one',
      stateId: 'state-feedback',
      targets: [globalTarget],
    }))).toEqual({ ok: true, target: globalTarget })
    expect(validateRuntimeTargetEditSession(started.session, context({
      scope: 'global',
      sceneId: 'scene-two',
      stateId: 'state-feedback',
      targets: [globalTarget],
    }))).toEqual({ ok: false, reason: 'context-changed' })
  })

  it('refuses to start from a stale or cross-scope target', () => {
    const liveTarget = target()
    expect(beginRuntimeTargetEditSession(
      liveTarget,
      context({ targets: [] }),
    )).toEqual({ ok: false, reason: 'target-invalid' })
    expect(beginRuntimeTargetEditSession(
      liveTarget,
      context({ scope: 'global', targets: [liveTarget] }),
    )).toEqual({ ok: false, reason: 'context-changed' })
  })
})
