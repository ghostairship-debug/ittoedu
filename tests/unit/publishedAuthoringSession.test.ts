import { describe, expect, it, vi } from 'vitest'
import {
  PublishedAuthoringSessionCoordinator,
  type PublishedAuthoringPatchResult,
  type PublishedAuthoringPatchSurface,
} from '../../src/player/surfaces/publishedAuthoringSession'
import { createRectangleNode } from '../../src/renderer/project/nativeNodeFactories'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  PUBLISHED_AUTHORING_CAPABILITIES,
  type PlayerAuthoringHostMessage,
  type PlayerAuthoringPatchCommand,
} from '../../src/shared/playerAuthoringProtocol'

function command(
  revision: number,
  overrides: Partial<PlayerAuthoringPatchCommand> = {},
): PlayerAuthoringPatchCommand {
  return {
    type: PLAYER_AUTHORING_MESSAGE_TYPES.patch,
    protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
    sessionId: 'session-a',
    requestId: `request-${revision}`,
    revision,
    context: { sceneId: 'scene-a', stateId: 'state-a' },
    patch: {
      kind: 'native-node',
      target: { kind: 'native-node', scope: 'scene', nodeId: 'node-a' },
      node: createRectangleNode({ id: 'node-a' }),
    },
    ...overrides,
  }
}

function createHarness(
  apply: PublishedAuthoringPatchSurface['applyAuthoringPatch'] = (
    _context,
    patch,
  ): PublishedAuthoringPatchResult => ({ ok: true, target: patch.target }),
) {
  const context = { sceneId: 'scene-a', stateId: 'state-a' as string | null }
  let generation = 0
  const surface: PublishedAuthoringPatchSurface = {
    getAuthoringContext: vi.fn(() => ({ ...context })),
    getAuthoringGeneration: vi.fn(() => generation),
    applyAuthoringPatch: vi.fn(apply),
  }
  const messages: PlayerAuthoringHostMessage[] = []
  const coordinator = new PublishedAuthoringSessionCoordinator({
    sessionId: 'session-a',
    surface,
    onMessage: (message) => messages.push(message),
  })
  return {
    context,
    surface,
    messages,
    coordinator,
    setGeneration: (value: number) => { generation = value },
  }
}

describe('PublishedAuthoringSessionCoordinator', () => {
  it('用当前 Published 上下文建立原有 V1 就绪握手', () => {
    const { coordinator, messages } = createHarness()

    const ready = coordinator.markReady()

    expect(ready).toEqual({
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ready,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: 'session-a',
      context: { sceneId: 'scene-a', stateId: 'state-a' },
      capabilities: PUBLISHED_AUTHORING_CAPABILITIES,
    })
    expect(messages).toEqual([ready])
  })

  it('拒绝无效、跨会话、未就绪及过期命令', async () => {
    const { coordinator, surface } = createHarness()

    await expect(coordinator.apply({ type: 'bad' })).resolves.toMatchObject({
      code: 'invalid-command',
    })
    await expect(coordinator.apply(command(1, {
      sessionId: 'session-b',
    }))).resolves.toMatchObject({
      code: 'invalid-session',
      sessionId: 'session-b',
    })
    await expect(coordinator.apply(command(1))).resolves.toMatchObject({
      code: 'not-ready',
    })

    coordinator.markReady()
    await expect(coordinator.apply(command(2))).resolves.toMatchObject({
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
      revision: 2,
    })
    await expect(coordinator.apply(command(2, {
      requestId: 'request-stale',
    }))).resolves.toMatchObject({
      code: 'stale-revision',
      revision: 2,
    })
    expect(surface.applyAuthoringPatch).toHaveBeenCalledTimes(1)
    expect(surface.applyAuthoringPatch).toHaveBeenCalledWith(
      command(2).context,
      command(2).patch,
      { revision: 2, generation: 0 },
    )
  })

  it('rejects a successful patch when the surface generation changes before ACK', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const harness = createHarness(async (_context, patch) => {
      await gate
      return { ok: true, target: patch.target }
    })
    harness.coordinator.markReady()
    const pending = harness.coordinator.apply(command(1))
    await Promise.resolve()
    harness.setGeneration(1)
    release?.()

    await expect(pending).resolves.toMatchObject({
      code: 'stale-revision',
      revision: 1,
    })
    expect(harness.messages.some((message) => (
      message.type === PLAYER_AUTHORING_MESSAGE_TYPES.ack
    ))).toBe(false)
    await expect(harness.coordinator.apply(command(1, {
      requestId: 'request-generation-retry',
    }))).resolves.toMatchObject({
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
      requestId: 'request-generation-retry',
      revision: 1,
    })
  })

  it('在协调器边界分别拒绝场景和呈现状态漂移', async () => {
    const { coordinator } = createHarness()
    coordinator.markReady()

    await expect(coordinator.apply(command(1, {
      context: { sceneId: 'scene-b', stateId: 'state-a' },
    }))).resolves.toMatchObject({ code: 'scene-mismatch' })
    await expect(coordinator.apply(command(2, {
      context: { sceneId: 'scene-a', stateId: null },
    }))).resolves.toMatchObject({ code: 'state-mismatch' })
  })

  it('串行应用命令，且只有成功更新才推进修订', async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const order: string[] = []
    const { coordinator } = createHarness(async (_context, patch) => {
      const nodeId = patch.target.kind === 'native-node'
        ? patch.target.nodeId
        : patch.target.kind
      order.push(`start:${nodeId}`)
      if (nodeId === 'first') await firstGate
      order.push(`end:${nodeId}`)
      if (nodeId === 'failed') {
        return { ok: false, code: 'target-not-found', message: '目标不存在' }
      }
      return { ok: true, target: patch.target }
    })
    coordinator.markReady()

    const first = coordinator.apply(command(3, {
      patch: {
        ...command(3).patch,
        target: { kind: 'native-node', scope: 'scene', nodeId: 'first' },
      } as PlayerAuthoringPatchCommand['patch'],
    }))
    const second = coordinator.apply(command(4, {
      patch: {
        ...command(4).patch,
        target: { kind: 'native-node', scope: 'scene', nodeId: 'second' },
      } as PlayerAuthoringPatchCommand['patch'],
    }))
    await Promise.resolve()
    expect(order).toEqual(['start:first'])
    releaseFirst?.()
    await expect(first).resolves.toMatchObject({ revision: 3 })
    await expect(second).resolves.toMatchObject({ revision: 4 })
    expect(order).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second',
    ])

    await expect(coordinator.apply(command(5, {
      patch: {
        ...command(5).patch,
        target: { kind: 'native-node', scope: 'scene', nodeId: 'failed' },
      } as PlayerAuthoringPatchCommand['patch'],
    }))).resolves.toMatchObject({ code: 'target-not-found' })
    await expect(coordinator.apply(command(5))).resolves.toMatchObject({
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
      revision: 5,
    })
  })

  it('为 Runtime 和 Component 目标共用一条外层单调修订', () => {
    const { coordinator, messages } = createHarness()
    coordinator.publishRuntimeTargets({
      revision: 8,
      scope: 'scene',
      sceneId: 'scene-a',
      targets: [],
    })
    coordinator.publishComponentTargets({
      revision: 3,
      scope: 'scene',
      sceneId: 'scene-a',
      nodeId: 'component-a',
      targets: [],
    })

    expect(messages.map((message) => ({
      type: message.type,
      revision: 'revision' in message ? message.revision : undefined,
    }))).toEqual([
      { type: PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets, revision: 1 },
      { type: PLAYER_AUTHORING_MESSAGE_TYPES.componentTargets, revision: 2 },
    ])
  })

  it('销毁后丢弃旧回调，并将队列中命令收口为 not-ready', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { coordinator, messages } = createHarness(async (_context, patch) => {
      await gate
      return { ok: true, target: patch.target }
    })
    coordinator.markReady()
    const pending = coordinator.apply(command(1))
    await Promise.resolve()
    coordinator.destroy()
    coordinator.publishRuntimeTargets({
      revision: 1,
      scope: 'scene',
      sceneId: 'scene-a',
      targets: [],
    })
    release?.()

    await expect(pending).resolves.toMatchObject({ code: 'not-ready' })
    await expect(coordinator.apply(command(2))).resolves.toMatchObject({
      code: 'not-ready',
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.type).toBe(PLAYER_AUTHORING_MESSAGE_TYPES.ready)
  })
})
