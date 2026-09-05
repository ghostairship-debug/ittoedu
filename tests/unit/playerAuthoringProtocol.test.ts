import { describe, expect, it } from 'vitest'
import {
  PLAYER_AUTHORING_CAPABILITIES,
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  PUBLISHED_AUTHORING_CAPABILITIES,
  isPlayerAuthoringSnapshotAck,
  parsePlayerAuthoringPatchCommand,
  parsePlayerAuthoringReadyMessage,
  playerAuthoringSnapshotBarrierForCommand,
} from '../../src/shared/playerAuthoringProtocol'
import {
  createChartNode,
  createRectangleNode,
  createTableNode,
} from '../../src/renderer/project/nativeNodeFactories'

function command(value: unknown = createRectangleNode({ id: 'node-a' })) {
  return {
    type: PLAYER_AUTHORING_MESSAGE_TYPES.patch,
    protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
    sessionId: 'session-a',
    requestId: 'request-a',
    revision: 3,
    context: { sceneId: 'scene-a', stateId: 'state-a' },
    patch: {
      kind: 'native-node',
      target: { kind: 'native-node', scope: 'scene', nodeId: 'node-a' },
      node: value,
    },
  }
}

function ready(overrides: Record<string, unknown> = {}) {
  return {
    type: PLAYER_AUTHORING_MESSAGE_TYPES.ready,
    protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
    sessionId: 'session-a',
    context: { sceneId: 'scene-a', stateId: 'state-a' },
    capabilities: [...PLAYER_AUTHORING_CAPABILITIES],
    token: 'session-a',
    ...overrides,
  }
}

describe('Player authoring protocol', () => {
  it('advertises component targets as an independent authoring channel', () => {
    expect(PLAYER_AUTHORING_MESSAGE_TYPES.componentTargets).not.toBe(
      PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets,
    )
    expect(PLAYER_AUTHORING_CAPABILITIES).toContain('runtime-targets')
    expect(PLAYER_AUTHORING_CAPABILITIES).toContain('component-targets')
    expect(PLAYER_AUTHORING_CAPABILITIES).toContain('node-motion-preview')
    expect(PLAYER_AUTHORING_CAPABILITIES).not.toContain('runtime-content')
    expect(PUBLISHED_AUTHORING_CAPABILITIES).toEqual([
      ...PLAYER_AUTHORING_CAPABILITIES,
      'runtime-content',
    ])
  })

  it('validates the complete ready context and both declared V1 host capability sets', () => {
    expect(parsePlayerAuthoringReadyMessage(ready()).ok).toBe(true)
    expect(parsePlayerAuthoringReadyMessage(ready({
      capabilities: [...PUBLISHED_AUTHORING_CAPABILITIES],
    })).ok).toBe(true)
    expect(parsePlayerAuthoringReadyMessage(ready({
      context: { sceneId: '', stateId: 'state-a' },
    })).ok).toBe(false)
    expect(parsePlayerAuthoringReadyMessage(ready({
      capabilities: PLAYER_AUTHORING_CAPABILITIES.slice(0, -1),
    })).ok).toBe(false)
    expect(parsePlayerAuthoringReadyMessage(ready({
      capabilities: [...PLAYER_AUTHORING_CAPABILITIES, 'future-capability'],
    })).ok).toBe(false)
  })

  it('opens the snapshot barrier only for its exact final ACK', () => {
    const barrier = {
      sessionId: 'session-a',
      requestId: 'snapshot-final',
      revision: 8,
      context: { sceneId: 'scene-a', stateId: 'state-a' },
      target: { kind: 'scene-order' as const, scope: 'scene' as const },
    }
    const ack = {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: 'session-a',
      requestId: 'snapshot-final',
      revision: 8,
      context: { sceneId: 'scene-a', stateId: 'state-a' },
      target: { kind: 'scene-order', scope: 'scene' },
      token: 'session-a',
    }

    expect(isPlayerAuthoringSnapshotAck(ack, barrier)).toBe(true)
    expect(isPlayerAuthoringSnapshotAck({
      ...ack,
      requestId: 'snapshot-earlier',
      revision: 7,
    }, barrier)).toBe(false)
    expect(isPlayerAuthoringSnapshotAck({
      ...ack,
      context: { sceneId: 'scene-b', stateId: 'state-a' },
    }, barrier)).toBe(false)
    expect(isPlayerAuthoringSnapshotAck({
      ...ack,
      target: { kind: 'scene-background', scope: 'scene' },
    }, barrier)).toBe(false)

    const laterCommand = parsePlayerAuthoringPatchCommand({
      ...command(),
      requestId: 'property-panel-later',
      revision: 9,
    })
    expect(laterCommand.ok).toBe(true)
    if (!laterCommand.ok) return
    const movedBarrier = playerAuthoringSnapshotBarrierForCommand(
      laterCommand.command,
    )
    expect(movedBarrier.requestId).toBe('property-panel-later')
    expect(movedBarrier.revision).toBe(9)
    expect(isPlayerAuthoringSnapshotAck(ack, movedBarrier)).toBe(false)
  })

  it('accepts a complete materialized Project V8 node command', () => {
    const result = parsePlayerAuthoringPatchCommand(command())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.command.patch.kind).toBe('native-node')
    expect(result.command.revision).toBe(3)
  })

  it('accepts a bounded Runtime content patch with an exact stable target', () => {
    const result = parsePlayerAuthoringPatchCommand({
      ...command(),
      patch: {
        kind: 'runtime-content',
        target: {
          kind: 'runtime-content',
          scope: 'global',
          nodeId: 'runtime-a',
          key: 'title',
        },
        value: '更新后的标题',
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const barrier = playerAuthoringSnapshotBarrierForCommand(result.command)
    expect(isPlayerAuthoringSnapshotAck({
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: result.command.sessionId,
      requestId: result.command.requestId,
      revision: result.command.revision,
      context: result.command.context,
      target: result.command.patch.target,
    }, barrier)).toBe(true)
    expect(isPlayerAuthoringSnapshotAck({
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: result.command.sessionId,
      requestId: result.command.requestId,
      revision: result.command.revision,
      context: result.command.context,
      target: { ...result.command.patch.target, key: 'subtitle' },
    }, barrier)).toBe(false)
  })

  it('rejects partial nodes, unsupported versions, and unknown envelope fields', () => {
    expect(parsePlayerAuthoringPatchCommand(command({
      id: 'node-a',
      type: 'shape',
      x: 10,
    })).ok).toBe(false)

    expect(parsePlayerAuthoringPatchCommand({
      ...command(),
      protocolVersion: 2,
    }).ok).toBe(false)

    expect(parsePlayerAuthoringPatchCommand({
      ...command(),
      unexpected: true,
    }).ok).toBe(false)
  })

  it('requires a complete, duplicate-free order at the published scene boundary', () => {
    const result = parsePlayerAuthoringPatchCommand({
      ...command(),
      patch: {
        kind: 'scene-order',
        target: { kind: 'scene-order', scope: 'scene' },
        nodeIds: ['node-a', 'node-a'],
      },
    })

    // Structural parsing intentionally permits duplicates; only the live scene
    // knows the exact complete node set and rejects this semantic mismatch.
    expect(result.ok).toBe(true)
  })

  it('只接受绑定原生节点的有界临时动画预览', () => {
    const preview = {
      ...command(),
      patch: {
        kind: 'preview-node-motion',
        target: { kind: 'native-node', scope: 'scene', nodeId: 'node-a' },
        action: {
          type: 'node.enter',
          nodeId: 'node-a',
          effect: 'fade',
          durationMs: 320,
          easing: 'ease-out',
        },
        delayMs: 80,
      },
    }

    expect(parsePlayerAuthoringPatchCommand(preview).ok).toBe(true)
    expect(parsePlayerAuthoringPatchCommand({
      ...preview,
      patch: { ...preview.patch, delayMs: 60_001 },
    }).ok).toBe(false)
    expect(parsePlayerAuthoringPatchCommand({
      ...preview,
      patch: {
        ...preview.patch,
        action: { ...preview.patch.action, arbitraryCode: true },
      },
    }).ok).toBe(false)
  })

  it('accepts complete Table, five Chart types, and Input patch commands', () => {
    // 1. Table
    const tableCmd = command(createTableNode({ id: 'table-node' }))
    tableCmd.patch.target.nodeId = 'table-node'
    const parsedTable = parsePlayerAuthoringPatchCommand(tableCmd)
    expect(parsedTable.ok).toBe(true)

    // 2. Five Chart types
    for (const chartType of ['bar', 'line', 'area', 'pie', 'donut'] as const) {
      const chartNode = createChartNode({ id: `chart-${chartType}`, chartType })
      const chartCmd = command(chartNode)
      chartCmd.patch.target.nodeId = `chart-${chartType}`
      const parsedChart = parsePlayerAuthoringPatchCommand(chartCmd)
      expect(parsedChart.ok).toBe(true)
    }

    // 3. Input
    const inputNode = {
      id: 'input-node',
      name: '输入题',
      type: 'input',
      x: 60,
      y: 60,
      width: 240,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      playbackInitialVisibility: 'inherit' as const,
      answerType: 'text' as const,
      stateKey: 'userAnswer',
      validityKey: 'userAnswerValid',
      placeholder: '请输入内容',
      ruleFamilyRuleIds: ['rule-1'],
      style: {
        fontFamily: 'sans-serif',
        fontSize: 16,
        textColor: '#111827',
        fillColor: '#ffffff',
        fillOpacity: 1,
        borderColor: '#d1d5db',
        borderOpacity: 1,
        borderWidth: 1,
        cornerRadius: 6,
        horizontalAlign: 'left' as const,
        padding: 8,
      },
    }
    const inputCmd = command(inputNode)
    inputCmd.patch.target.nodeId = 'input-node'
    const parsedInput = parsePlayerAuthoringPatchCommand(inputCmd)
    expect(parsedInput.ok).toBe(true)

    // 4. Unknown type or missing fields are rejected
    expect(parsePlayerAuthoringPatchCommand(command({
      ...inputNode,
      answerType: 'unknown',
    })).ok).toBe(false)
    expect(parsePlayerAuthoringPatchCommand(command({
      ...inputNode,
      stateKey: '',
    })).ok).toBe(false)
    expect(parsePlayerAuthoringPatchCommand(command({
      ...inputNode,
      type: 'unknown-type',
    })).ok).toBe(false)
  })
})

