import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { promises as fs } from 'node:fs'
import os from 'node:os'

afterEach(() => {
  vi.restoreAllMocks()
})
import { createInterface } from 'node:readline'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import * as processModule from '../../src/main/localAgent/process'
import {
  CodexAppServerAdapter,
  discoverCodexCapabilities,
  parseCodexCapabilities,
  codexCandidateOutputSchema,
  codexTurnOutputSchema,
  decodeCodexStructuredOutput,
} from '../../src/main/localAgent/codexAppServer'
import { localAgentCapabilitiesSchema } from '../../src/shared/localAgentContract'
import type { GenerationRequest } from '../../src/shared/generationContract'

function createMockCodexProcess(responder?: (msg: any, send: (reply: any) => void) => void): {
  child: ChildProcessWithoutNullStreams
  stdinStream: PassThrough
  stdoutStream: PassThrough
  stderrStream: PassThrough
} {
  const stdinStream = new PassThrough()
  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()

  const send = (reply: any) => {
    stdoutStream.write(JSON.stringify(reply) + '\n')
  }

  const lines = createInterface({ input: stdinStream })
  lines.on('line', (line) => {
    if (!line.trim()) return
    try {
      const msg = JSON.parse(line)
      if (responder) {
        responder(msg, send)
      } else {
        // Default standard Codex app-server responses
        if (msg.method === 'initialize') {
          send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
        } else if (msg.method === 'model/list') {
          send({
            id: msg.id,
            result: {
              data: [
                {
                  id: 'gpt-6-astra',
                  model: 'gpt-6-astra',
                  displayName: 'GPT-6-Astra',
                  supportedReasoningEfforts: [
                    { reasoningEffort: 'low' },
                    { reasoningEffort: 'medium' },
                    { reasoningEffort: 'high' },
                    { reasoningEffort: 'xhigh' },
                    { reasoningEffort: 'max' },
                    { reasoningEffort: 'ultra' },
                  ],
                  defaultReasoningEffort: 'medium',
                  inputModalities: ['text', 'image'],
                  isDefault: true,
                },
                {
                  id: 'gpt-5.6-sol',
                  model: 'gpt-5.6-sol',
                  displayName: 'GPT-5.6-Sol',
                  supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
                  defaultReasoningEffort: 'low',
                  inputModalities: ['text', 'image'],
                  isDefault: false,
                },
              ],
            },
          })
        } else if (msg.method === 'config/read') {
          send({ id: msg.id, result: { config: { model: 'gpt-6-astra', model_reasoning_effort: 'xhigh' } } })
        } else if (msg.method === 'thread/start') {
          send({ id: msg.id, result: { thread: { id: 'thread-test-123' }, model: 'gpt-6-astra' } })
        } else if (msg.method === 'thread/resume') {
          send({ id: msg.id, result: { thread: { id: msg.params.threadId }, model: 'gpt-6-astra' } })
        } else if (msg.method === 'turn/start') {
          send({ id: msg.id, result: { turn: { id: 'turn-test-456', status: 'inProgress' } } })
          // Send turn/started notification
          setTimeout(() => {
            send({ method: 'turn/started', params: { threadId: msg.params.threadId, turn: { id: 'turn-test-456' } } })
          }, 5)
        } else if (msg.method === 'turn/steer') {
          send({ id: msg.id, result: { turnId: msg.params.expectedTurnId } })
        } else if (msg.method === 'turn/interrupt') {
          send({ id: msg.id, result: {} })
          send({ method: 'turn/completed', params: { threadId: msg.params.threadId, turn: { id: msg.params.turnId, status: 'interrupted' } } })
        }
      }
    } catch {}
  })

  const child = {
    stdin: stdinStream,
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: 12345,
    exitCode: null,
    kill: vi.fn(() => {
      (child as any).exitCode = 0
      stdoutStream.end()
    }),
    once: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'close') {
        // Can be triggered when child exits
      }
      return child
    }),
    on: vi.fn(),
  } as unknown as ChildProcessWithoutNullStreams

  return { child, stdinStream, stdoutStream, stderrStream }
}

describe('CodexAppServer capabilities discovery', () => {
  it('parses models, reasoning efforts, defaults and image support correctly', () => {
    const rawData = [
      {
        id: 'gpt-6-astra',
        model: 'gpt-6-astra',
        displayName: 'GPT-6-Astra',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Deep' },
          { reasoningEffort: 'xhigh', description: 'Extra high' },
          { reasoningEffort: 'max', description: 'Max' },
          { reasoningEffort: 'ultra', description: 'Ultra' },
        ],
        defaultReasoningEffort: 'medium',
        inputModalities: ['text', 'image'],
        isDefault: true,
      },
      {
        id: 'gpt-5.3-codex-spark',
        model: 'gpt-5.3-codex-spark',
        displayName: 'GPT-5.3-Codex-Spark',
        supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
        defaultReasoningEffort: 'high',
        inputModalities: ['text'],
        isDefault: false,
      },
    ]

    const caps = parseCodexCapabilities(rawData, '0.153.4')
    expect(localAgentCapabilitiesSchema.parse(caps)).toEqual(caps)
    expect(caps.adapter).toBe('codex')
    expect(caps.cliVersion).toBe('0.153.4')
    expect(caps.models).toHaveLength(2)

    const astra = caps.models.find(m => m.id === 'gpt-6-astra')!
    expect(astra.image).toBe('supported')
    expect(astra.effort).toEqual({
      kind: 'supported',
      values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      default: 'medium',
    })

    const spark = caps.models.find(m => m.id === 'gpt-5.3-codex-spark')!
    expect(spark.image).toBe('unsupported')
    expect(spark.effort).toEqual({
      kind: 'supported',
      values: ['high'],
      default: 'high',
    })

    expect(caps.current).toEqual({ model: null, resolvedModel: null, effort: null })
    expect(parseCodexCapabilities(rawData, '0.153.4', { model: 'gpt-6-astra', effort: 'xhigh' }))
      .toMatchObject({ current: { model: 'gpt-6-astra', effort: 'xhigh' }, currentSource: 'native-config' })
    expect(caps.input).toEqual({
      image: 'supported',
      readFile: 'supported',
      question: 'structured',
      correction: 'active-turn',
      cancel: 'supported',
    })
  })

  it('discoverCodexCapabilities runs app-server --stdio and queries initialize and model/list', async () => {
    const { child } = createMockCodexProcess()
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const caps = await discoverCodexCapabilities({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    expect(caps.adapter).toBe('codex')
    expect(caps.cliVersion).toBe('0.153.4')
    expect(caps.models[0]?.id).toBe('gpt-6-astra')
    expect(caps.current.model).toBe('gpt-6-astra')
    expect(caps.current.effort).toBe('xhigh')
    expect(caps.currentSource).toBe('native-config')
  })
})

describe('CodexAppServerAdapter lifecycle and wire protocol', () => {
  const workspace = { version: 1 as const, projectId: 'proj-1', normalizedPath: 'c:/lessons/test.h5lesson' }

  it('probes status correctly based on version and login status', async () => {
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)

    vi.spyOn(processModule, 'captureAgent')
      .mockResolvedValueOnce({ code: 0, text: 'codex-cli 0.153.4' })
      .mockResolvedValueOnce({ code: 0, text: 'Logged in' })

    const probe = await adapter.probe()
    expect(probe.status).toBe('ready')
    expect(probe.version).toBe('0.153.4')

    vi.spyOn(processModule, 'captureAgent')
      .mockResolvedValueOnce({ code: 0, text: 'codex-cli 0.152.0' })

    const unsupported = await adapter.probe()
    expect(unsupported.status).toBe('unsupported-version')

    mockResolve.mockResolvedValueOnce(null)
    const missing = await adapter.probe()
    expect(missing.status).toBe('missing')
  })

  it('opens session and starts a new thread or resumes existing thread', async () => {
    const { child } = createMockCodexProcess()
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)

    const opened = await adapter.open({ cwd: 'C:/test', externalSessionId: null })
    expect(opened.externalSessionId).toBe('thread-test-123')
    expect(opened.capabilities.adapter).toBe('codex')

    await adapter.close()

    const { child: child2 } = createMockCodexProcess()
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child2)
    const resumed = await adapter.open({ cwd: 'C:/test', externalSessionId: 'existing-thread-777' })
    expect(resumed.externalSessionId).toBe('existing-thread-777')
    await adapter.close()
  })

  it('resumes a large native history without replaying turns into the transport', async () => {
    const { child } = createMockCodexProcess((msg, send) => {
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'codex/0.153.4' } })
      if (msg.method === 'model/list') send({ id: msg.id, result: { data: [{ id: 'native-model', model: 'native-model',
        displayName: 'Native', isDefault: true, inputModalities: ['text'], supportedReasoningEfforts: [] }] } })
      if (msg.method === 'thread/resume') send({ id: msg.id, result: {
        thread: { id: msg.params.threadId, turns: msg.params.excludeTurns ? []
          : [{ id: 'previous-turn', items: [{ type: 'commandExecution', aggregatedOutput: 'x'.repeat(1_200_000) }] }] },
        model: 'native-model',
      } })
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()
    const adapter = new CodexAppServerAdapter(async () => ({ executable: 'C:\\bin\\codex.exe', prefix: [] }))
    try {
      const opened = await adapter.open({ cwd: 'C:/test', externalSessionId: 'stored-large-history' })
      expect(opened.externalSessionId).toBe('stored-large-history')
      expect(opened.capabilities.current.model).toBe('native-model')
    } finally { await adapter.close() }
  })

  it('keeps requested model and effort pending until native confirmation', async () => {
    const { child } = createMockCodexProcess()
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    const configured = await adapter.configure({ model: 'gpt-5.6-sol', effort: 'medium' })
    expect(configured.current.model).toBe('gpt-6-astra')
    expect(configured.requestedConfiguration).toEqual({ model: 'gpt-5.6-sol', effort: 'medium' })

    // An explicit selection must never silently become another effort.
    await expect(adapter.configure({ model: 'gpt-5.6-sol', effort: 'ultra' })).rejects.toThrow('请重新选择')

    // Unknown model throws
    await expect(adapter.configure({ model: 'unknown-model', effort: null })).rejects.toThrow('不在 Codex 原生目录中')
    await adapter.close()
  })

  it('starts turn with text and localImage, and streams deltas and items', async () => {
    let mockSend: (reply: any) => void
    const { child, stdoutStream } = createMockCodexProcess((msg, send) => {
      mockSend = send
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
      else if (msg.method === 'model/list') {
        send({ id: msg.id, result: { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', inputModalities: ['text', 'image'], isDefault: true }] } })
      } else if (msg.method === 'thread/start') {
        send({ id: msg.id, result: { thread: { id: 'thread-1' } } })
      } else if (msg.method === 'turn/start') {
        expect(msg.params.threadId).toBe('thread-1')
        expect(msg.params.input).toEqual([
          { type: 'text', text: 'Analyze this slide' },
          { type: 'localImage', path: path.resolve('C:/test/image1.png') },
        ])
        send({ id: msg.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } })
        setTimeout(() => {
          send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } })
          send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: 'Hello ' } })
          send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: 'World' } })
          send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'msg-1', type: 'agentMessage', text: 'Hello World', phase: 'final_answer' } } })
          send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage: { last: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 }, total: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 } } } })
          send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })
        }, 10)
      }
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    const files = new Map<string, string>([['img-1', 'C:/test/image1.png']])
    const { nativeTurnId } = await adapter.startTurn({
      taskId: randomUUID(),
      epoch: 0,
      workspace,
      runId: randomUUID(),
      observationId: randomUUID(),
      text: 'Analyze this slide',
      imageFileIds: ['img-1'],
    }, files)

    expect(nativeTurnId).toBe('turn-1')

    const events: any[] = []
    for await (const event of adapter.events()) {
      events.push(event)
    }

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'text',
      itemId: 'msg-1',
      operation: 'append',
      text: 'Hello ',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'text',
      itemId: 'msg-1',
      operation: 'append',
      text: 'World',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'text',
      itemId: 'msg-1',
      operation: 'replace',
      text: 'Hello World',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'usage',
      inputTokens: 10,
      outputTokens: 5,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'turn-ended',
      status: 'completed',
      failure: null,
    }))

    await adapter.close()
  })

  it('handles item/tool/requestUserInput structured questions and answers', async () => {
    let capturedAnswerRpc: any = null
    const { child } = createMockCodexProcess((msg, send) => {
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
      else if (msg.method === 'model/list') {
        send({ id: msg.id, result: { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', inputModalities: ['text'], isDefault: true }] } })
      } else if (msg.method === 'thread/start') {
        send({ id: msg.id, result: { thread: { id: 'thread-1' } } })
      } else if (msg.method === 'turn/start') {
        send({ id: msg.id, result: { turn: { id: 'turn-q', status: 'inProgress' } } })
        setTimeout(() => {
          send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-q' } } })
          // Server asks question with RPC ID 10
          send({
            id: 10,
            method: 'item/tool/requestUserInput',
            params: {
              threadId: 'thread-1',
              turnId: 'turn-q',
              itemId: 'call-q1',
              questions: [
                {
                  id: 'color_choice',
                  header: 'Color choice',
                  question: 'Red or Blue?',
                  options: [{ label: 'Red' }, { label: 'Blue' }],
                },
              ],
            },
          })
        }, 10)
      } else if (msg.id === 10) {
        capturedAnswerRpc = msg
        // Question answered, complete turn
        send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-q', status: 'completed' } } })
      }
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    const taskId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace,
      runId: randomUUID(),
      observationId: randomUUID(),
      text: 'Ask question',
      imageFileIds: [],
    }, new Map())

    // Iterate events and answer question when received
    const collected: any[] = []
    for await (const event of adapter.events()) {
      collected.push(event)
      if (event.kind === 'question') {
        const delivery = await adapter.input({
          version: 1,
          taskId,
          epoch: 0,
          workspace,
          inputId: randomUUID(),
          turnId: 'turn-q',
          kind: 'answer',
          questionId: event.question.questionId,
          answers: [{ id: 'color_choice', values: ['Red'] }],
        })
        expect(delivery.status).toBe('accepted')
      }
    }

    expect(capturedAnswerRpc).toEqual({
      id: 10,
      result: {
        answers: {
          color_choice: {
            answers: ['Red'],
          },
        },
      },
    })
    expect(collected.some(e => e.kind === 'turn-ended' && e.status === 'completed')).toBe(true)
    await adapter.close()
  })

  it('handles mid-turn steer correction', async () => {
    let capturedSteer: any = null
    const { child } = createMockCodexProcess((msg, send) => {
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
      else if (msg.method === 'model/list') {
        send({ id: msg.id, result: { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', inputModalities: ['text'], isDefault: true }] } })
      } else if (msg.method === 'thread/start') {
        send({ id: msg.id, result: { thread: { id: 'thread-1' } } })
      } else if (msg.method === 'turn/start') {
        send({ id: msg.id, result: { turn: { id: 'turn-steer', status: 'inProgress' } } })
        setTimeout(() => {
          send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-steer' } } })
        }, 5)
      } else if (msg.method === 'turn/steer') {
        capturedSteer = msg
        send({ id: msg.id, result: { turnId: msg.params.expectedTurnId } })
        send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-steer', status: 'completed' } } })
      }
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    const taskId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace,
      runId: randomUUID(),
      observationId: randomUUID(),
      text: 'Long generation',
      imageFileIds: [],
    }, new Map())

    // Mid-turn correction
    const delivery = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace,
      inputId: randomUUID(),
      turnId: 'turn-steer',
      kind: 'correct',
      text: 'Correction: stop early',
    })

    expect(delivery.status).toBe('accepted')
    expect(capturedSteer.params).toEqual({
      threadId: 'thread-1',
      expectedTurnId: 'turn-steer',
      input: [{ type: 'text', text: 'Correction: stop early' }],
    })

    for await (const _ev of adapter.events()) {
      // drain
    }
    await adapter.close()
  })

  it('handles cancellation and turn/interrupt', async () => {
    let capturedInterrupt: any = null
    const { child } = createMockCodexProcess((msg, send) => {
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
      else if (msg.method === 'model/list') {
        send({ id: msg.id, result: { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', inputModalities: ['text'], isDefault: true }] } })
      } else if (msg.method === 'thread/start') {
        send({ id: msg.id, result: { thread: { id: 'thread-1' } } })
      } else if (msg.method === 'turn/start') {
        send({ id: msg.id, result: { turn: { id: 'turn-cancel', status: 'inProgress' } } })
        setTimeout(() => {
          send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-cancel' } } })
        }, 5)
      } else if (msg.method === 'turn/interrupt') {
        capturedInterrupt = msg
        send({ id: msg.id, result: {} })
        send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-cancel', status: 'interrupted' } } })
      }
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    await adapter.startTurn({
      taskId: randomUUID(),
      epoch: 0,
      workspace,
      runId: randomUUID(),
      observationId: randomUUID(),
      text: 'Long text to cancel',
      imageFileIds: [],
    }, new Map())

    await adapter.cancel()
    expect(capturedInterrupt.params).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-cancel',
    })

    const events: any[] = []
    for await (const event of adapter.events()) {
      events.push(event)
    }

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'turn-ended',
      status: 'cancelled',
      failure: null,
    }))

    await adapter.close()
  })

  it('enforces D-06 identity checks on input', async () => {
    const { child } = createMockCodexProcess((msg, send) => {
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
      else if (msg.method === 'model/list') send({ id: msg.id, result: { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra' }] } })
      else if (msg.method === 'thread/start') send({ id: msg.id, result: { thread: { id: 'thread-1' } } })
      else if (msg.method === 'turn/start') {
        send({ id: msg.id, result: { turn: { id: 'turn-identity', status: 'inProgress' } } })
        send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-identity' } } })
      }
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    const taskId = randomUUID()

    // 1. Rejected if no turn context is active
    const rejectedNoContext = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace,
      inputId: randomUUID(),
      turnId: null,
      kind: 'stop',
    })
    expect(rejectedNoContext.status).toBe('rejected')

    // Start turn
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace,
      runId: randomUUID(),
      observationId: randomUUID(),
      text: 'Hello',
      imageFileIds: [],
    }, new Map())

    // 2. Rejected if taskId mismatch
    const rejectedTaskId = await adapter.input({
      version: 1,
      taskId: randomUUID(),
      epoch: 0,
      workspace,
      inputId: randomUUID(),
      turnId: 'turn-identity',
      kind: 'correct',
      text: 'Mismatch task',
    })
    expect(rejectedTaskId.status).toBe('rejected')

    // 3. Rejected if epoch mismatch
    const rejectedEpoch = await adapter.input({
      version: 1,
      taskId,
      epoch: 99,
      workspace,
      inputId: randomUUID(),
      turnId: 'turn-identity',
      kind: 'correct',
      text: 'Mismatch epoch',
    })
    expect(rejectedEpoch.status).toBe('rejected')

    await adapter.close()
  })

  it('enforces D-04 steer turnId checks on correct and supplement inputs', async () => {
    let capturedSteer: any = null
    const { child } = createMockCodexProcess((msg, send) => {
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
      else if (msg.method === 'model/list') send({ id: msg.id, result: { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra' }] } })
      else if (msg.method === 'thread/start') send({ id: msg.id, result: { thread: { id: 'thread-1' } } })
      else if (msg.method === 'turn/start') {
        send({ id: msg.id, result: { turn: { id: 'turn-active-1', status: 'inProgress' } } })
        send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-active-1' } } })
      }
      else if (msg.method === 'turn/steer') {
        capturedSteer = msg
        send({ id: msg.id, result: { turnId: msg.params.expectedTurnId } })
      }
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    const taskId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace,
      runId: randomUUID(),
      observationId: randomUUID(),
      text: 'Hello',
      imageFileIds: [],
    }, new Map())

    // 1. Rejected if input.turnId does not match activeTurnId
    const rejectedTurnId = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace,
      inputId: randomUUID(),
      turnId: 'wrong-turn-id',
      kind: 'correct',
      text: 'Wrong turn id',
    })
    expect(rejectedTurnId.status).toBe('rejected')
    expect(capturedSteer).toBeNull()

    // 2. Accepted if input.turnId matches activeTurnId
    const acceptedMatchingTurnId = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace,
      inputId: randomUUID(),
      turnId: 'turn-active-1',
      kind: 'correct',
      text: 'Matching turn id',
    })
    expect(acceptedMatchingTurnId.status).toBe('accepted')
    expect(capturedSteer?.params?.expectedTurnId).toBe('turn-active-1')

    // 3. Accepted if input.turnId is null
    capturedSteer = null
    const acceptedNullTurnId = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace,
      inputId: randomUUID(),
      turnId: null,
      kind: 'supplement',
      text: 'Null turn id supplement',
    })
    expect(acceptedNullTurnId.status).toBe('accepted')
    expect(capturedSteer?.params?.expectedTurnId).toBe('turn-active-1')

    await adapter.close()
  })

  it('rejects question answers when questionId does not match without loose fallback', async () => {
    const { child } = createMockCodexProcess((msg, send) => {
      if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'courseware_editor/0.153.4' } })
      else if (msg.method === 'model/list') send({ id: msg.id, result: { data: [{ id: 'gpt-6-astra', model: 'gpt-6-astra' }] } })
      else if (msg.method === 'thread/start') send({ id: msg.id, result: { thread: { id: 'thread-1' } } })
      else if (msg.method === 'turn/start') {
        send({ id: msg.id, result: { turn: { id: 'turn-q', status: 'inProgress' } } })
        send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-q' } } })
        setTimeout(() => {
          send({
            id: 20,
            method: 'item/tool/requestUserInput',
            params: {
              threadId: 'thread-1',
              turnId: 'turn-q',
              itemId: 'call-exact-id',
              questions: [{ id: 'q1', question: 'Favorite color?', options: ['Red', 'Blue'] }],
            },
          })
        }, 5)
      }
    })
    vi.spyOn(processModule, 'launchAgent').mockReturnValue(child)
    vi.spyOn(processModule, 'stopAgent').mockResolvedValue()

    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\codex.exe', prefix: [] })
    const adapter = new CodexAppServerAdapter(mockResolve)
    await adapter.open({ cwd: 'C:/test', externalSessionId: null })

    const taskId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace,
      runId: randomUUID(),
      observationId: randomUUID(),
      text: 'Ask question',
      imageFileIds: [],
    }, new Map())

    for await (const event of adapter.events()) {
      if (event.kind === 'question') {
        // Attempt answering with wrong questionId - must be rejected and not fall back
        const rejected = await adapter.input({
          version: 1,
          taskId,
          epoch: 0,
          workspace,
          inputId: randomUUID(),
          turnId: 'turn-q',
          kind: 'answer',
          questionId: 'wrong-question-id',
          answers: [{ id: 'q1', values: ['Red'] }],
        })
        expect(rejected.status).toBe('rejected')

        // Answering with correct questionId should succeed
        const accepted = await adapter.input({
          version: 1,
          taskId,
          epoch: 0,
          workspace,
          inputId: randomUUID(),
          turnId: 'turn-q',
          kind: 'answer',
          questionId: event.question.questionId,
          answers: [{ id: 'q1', values: ['Red'] }],
        })
        expect(accepted.status).toBe('accepted')
        break
      }
    }

    await adapter.close()
  })

  it('keeps backward compatible helper functions intact', () => {
    const requestId = randomUUID()
    const request: GenerationRequest = {
      version: 1,
      requestId,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'C:/p1' },
      documentRevision: 1,
      sessionGeneration: 1,
      purpose: 'local-edit',
      instruction: 'Edit title',
      destinations: [{
        kind: 'update',
        target: {
          projectId: 'p1',
          documentRevision: 1,
          revisionPolicy: { kind: 'exact' },
          sessionGeneration: 1,
          surfaceType: 'slide',
          surfaceId: 's1',
          locationId: 'l1',
          stateId: null,
          owner: 'scene',
          ownerKey: 'scene:s1',
          itemId: 'title-1',
          authoringAddress: 'l1/title-1',
        },
      }],
      context: {},
      allowedCarriers: ['native'],
      expectedResult: 'auto',
    }

    const schema = codexTurnOutputSchema(request)
    expect(schema).toHaveProperty('properties')
    const candidateSchema = codexCandidateOutputSchema(request)
    expect(candidateSchema).toHaveProperty('properties')

    const replyJson = JSON.stringify({
      version: 1,
      requestId,
      kind: 'reply',
      reply: 'No edits needed',
      candidate: null,
    })
    expect(decodeCodexStructuredOutput(replyJson, request)).toBe('No edits needed')
  })

  it.runIf(process.env.TEST_LIVE_CODEX === '1')('runs live discovery with installed codex', async () => {
    const caps = await discoverCodexCapabilities()
    expect(caps.adapter).toBe('codex')
    expect(caps.models.length).toBeGreaterThan(0)
    expect(caps.current.model).toBeTruthy()
  }, 30000)
})

function codexNativeProcess(options: { exitAt?: string; hangAt?: string; rejectAt?: string; confirmedModel?: string; omitEffort?: boolean } = {}): string {
  return `
const options = ${JSON.stringify(options)};
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
let threadId = null, model = 'native-default', effort = 'medium';
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params = {} } = JSON.parse(line);
  if (options.exitAt && method === options.exitAt) process.exit(23);
  if (options.hangAt && method === options.hangAt) return;
  if (options.rejectAt && method === options.rejectAt) { send({ id, error: { code: -32602, message: 'native configuration refused' } }); return; }
  if (method === 'initialize') send({ id, result: { userAgent: 'codex/0.153.4' } });
  else if (method === 'config/read') send({ id, result: { config: { model: 'native-default', model_reasoning_effort: 'high' } } });
  else if (method === 'model/list') send({ id, result: { data: ['native-default', 'native-selected'].map((name, i) => ({ id: name, model: name, displayName: name, isDefault: i === 0, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'medium' })) } });
  else if (method === 'thread/start' || method === 'thread/resume') {
    threadId = params.threadId || 'confirmed-native-thread';
    model = params.model || model;
    send({ id, result: { thread: { id: threadId }, model, reasoningEffort: effort } });
  } else if (method === 'turn/start') {
    model = params.model || model; effort = params.effort || effort;
    send({ id, result: { turn: { id: 'native-turn', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });
  } else if (method === 'thread/read') {
    send({ id, result: { thread: { id: threadId, model: options.confirmedModel || model, reasoningEffort: options.omitEffort ? null : effort } } });
    setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }), 5);
  } else if (method === 'turn/interrupt') {
    send({ id, result: {} });
    send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'interrupted' } } });
  }
});
process.stdin.on('end', () => process.exit(0));
`
}

function realCodexAdapter(script: string | (() => string), timeouts: { rpcTimeoutMs?: number; cancelTimeoutMs?: number; terminalCheckMs?: number; generationRequest?: GenerationRequest } = {}) {
  const messages: any[] = []
  const children: ChildProcessWithoutNullStreams[] = []
  const launch = processModule.launchAgent
  vi.spyOn(processModule, 'launchAgent').mockImplementation((binary, args, cwd, candidateRoot) => {
    const child = launch(binary, args, cwd, candidateRoot)
    children.push(child)
    const write = child.stdin.write.bind(child.stdin)
    vi.spyOn(child.stdin, 'write').mockImplementation((chunk: any, ...rest: any[]) => {
      for (const line of String(chunk).trim().split('\n')) if (line) messages.push(JSON.parse(line))
      return (write as (...args: any[]) => boolean)(chunk, ...rest)
    })
    return child
  })
  const adapter = new CodexAppServerAdapter({
    resolve: async () => ({ executable: process.execPath, prefix: ['-e', typeof script === 'function' ? script() : script, '--'] }),
    ...timeouts,
  })
  return { adapter, messages, children }
}

function nativeCodexTurn() {
  return { taskId: randomUUID(), epoch: 0, workspace: { version: 1 as const, projectId: 'native-test', normalizedPath: 'c:/lessons/native-test.h5lesson' },
    runId: randomUUID(), observationId: randomUUID(), text: 'deterministic protocol test', imageFileIds: [] }
}

describe('Codex candidate environment anchor', () => {
  it('refreshes a live native thread anchor while preserving its identity and requested configuration', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-candidate-env-'))
    const snapshotPath = path.join(directory, 'environment.json')
    const { adapter, messages, children } = realCodexAdapter(`require('node:fs').writeFileSync(${JSON.stringify(snapshotPath)}, JSON.stringify({
      cwd:process.cwd(),candidateRoot:process.env.COURSEWARE_CANDIDATE_ROOT??null,nativeSetting:process.env.COURSEWARE_NATIVE_ENV_TEST,
    }));` + codexNativeProcess())
    const candidateA = path.join(directory, '候选 A'), candidateB = path.join(directory, '候选 B')
    vi.stubEnv('COURSEWARE_CANDIDATE_ROOT', 'stale-parent-root')
    vi.stubEnv('COURSEWARE_NATIVE_ENV_TEST', 'keep-native-setting')
    try {
      const opened = await adapter.open({ cwd: directory, externalSessionId: null, candidateRoot: candidateA,
        configuration: { model: 'native-selected', effort: 'high' } })
      const expectSnapshot = async (candidateRoot: string | null) => {
        expect(JSON.parse(await fs.readFile(snapshotPath, 'utf8'))).toEqual({ cwd: directory, candidateRoot, nativeSetting: 'keep-native-setting' })
        expect(process.env.COURSEWARE_CANDIDATE_ROOT).toBe('stale-parent-root')
      }
      await expectSnapshot(candidateA)
      await adapter.open({ cwd: directory, externalSessionId: opened.externalSessionId, candidateRoot: candidateA })
      expect(children).toHaveLength(1)
      // A live null-ID reopen normally reuses the current thread; changing only
      // the environment must retain that identity through thread/resume.
      const reopened = await adapter.open({ cwd: directory, externalSessionId: null, candidateRoot: candidateB })
      expect(reopened.externalSessionId).toBe(opened.externalSessionId)
      expect(children).toHaveLength(2)
      await expectSnapshot(candidateB)
      expect(messages.filter(message => message.method === 'thread/resume').at(-1)?.params).toMatchObject({
        threadId: opened.externalSessionId, model: 'native-selected', excludeTurns: true,
      })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      for await (const _ of adapter.events()) { /* wait for native configuration confirmation */ }
      expect(messages.filter(message => message.method === 'turn/start').at(-1)?.params).toMatchObject({ model: 'native-selected', effort: 'high' })

      const withoutRoot = await adapter.open({ cwd: directory, externalSessionId: opened.externalSessionId })
      expect(withoutRoot.externalSessionId).toBe(opened.externalSessionId)
      expect(children).toHaveLength(3)
      await expectSnapshot(null)
      await adapter.close()
      await adapter.open({ cwd: directory, externalSessionId: null })
      expect(children).toHaveLength(4)
      expect(messages.filter(message => /^thread\/(start|resume)$/.test(message.method)).at(-1)?.method).toBe('thread/start')
    } finally { await adapter.close(); await fs.rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs() }
  })
})

function shortPathRequest(): GenerationRequest {
  return {
    version: 1, requestId: randomUUID(), workspace: nativeCodexTurn().workspace,
    documentRevision: 1, sessionGeneration: 1, purpose: 'local-edit', instruction: 'Enlarge the title',
    destinations: [{ kind: 'update', target: {
      projectId: 'native-test', documentRevision: 1, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
      surfaceType: 'slide', surfaceId: 's1', locationId: 'l1', stateId: null, owner: 'scene', ownerKey: 'scene:s1',
      itemId: 'title', authoringAddress: 'l1/title',
    } }], context: {}, allowedCarriers: ['native'], expectedResult: 'auto',
  }
}

function shortPathCandidate(request: GenerationRequest) {
  return { version: 2, requestId: request.requestId, summary: 'Title enlarged', afterCommit: { version: 1, action: 'finish' },
    steps: [{ id: 'title', tool: 'native.patch', destination: 'd1', input: '{"fontSize":48}', lowerCarrierReason: null }] }
}

/** Real JSONL subprocess with explicit wire ordering; no installed CLI or network is used. */
function shortPathProcess(notifications: Array<{ method: string; params: any }>): string {
  return codexNativeProcess().replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });", `
    send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });
    setTimeout(() => { for (const notification of ${JSON.stringify(notifications)}) send(notification); }, 5);
  `)
}

function shortPathWire(method: string, params: Record<string, unknown>) {
  return { method, params: { threadId: 'confirmed-native-thread', turnId: 'native-turn', ...params } }
}

describe('Codex short path transport', () => {
  it('replays the captured native turn final snapshot and publishes only explicit public reasoning summaries', async () => {
    const fixture = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tests/fixtures/local-agent-native/codex.json'), 'utf8'))
    const captured = fixture.examples.conversation.find((entry: any) => entry.direction === 'in' && entry.value.method === 'turn/completed').value.params.turn
    const expected = captured.items.filter((item: any) => item.type === 'agentMessage').map((item: any) => item.text)
    const wire = [
      shortPathWire('item/reasoning/textDelta', { itemId: 'reasoning', delta: 'PRIVATE_RAW_REASONING' }),
      shortPathWire('item/reasoning/summaryTextDelta', { itemId: 'reasoning', summaryIndex: 0, delta: 'Checking the public evidence.' }),
      shortPathWire('item/completed', { item: { id: 'reasoning', type: 'reasoning', summary: ['Checking the public evidence.'], content: ['PRIVATE_RAW_REASONING'] } }),
      shortPathWire('turn/completed', { turn: { ...captured, id: 'native-turn' } }),
    ]
    const { adapter } = realCodexAdapter(shortPathProcess(wire))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      const text = events.filter(event => event.kind === 'text')
      expect(text.filter(event => event.phase === 'final').map(event => event.text)).toEqual(expected)
      expect(text.filter(event => event.phase === 'public-summary')).toEqual([
        expect.objectContaining({ itemId: 'reasoning:summary:0', operation: 'append', text: 'Checking the public evidence.' }),
        expect.objectContaining({ itemId: 'reasoning:summary:0', operation: 'replace', text: 'Checking the public evidence.' }),
      ])
      expect(JSON.stringify(text)).not.toContain('PRIVATE_RAW_REASONING')
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
    } finally { await adapter.close() }
  })

  it.each(['started-and-completed', 'completed-only'] as const)('excludes native userMessage %s while preserving command, MCP, and typed agent output', async sequence => {
    const request = shortPathRequest(), prompt = 'PRIVATE_NATIVE_REQUEST_WITH_FULL_HOST_CONTEXT'
    // Captured native item shape; only the request text, image path, and ID are fixture values.
    const userMessage = { type: 'userMessage', id: 'native-user-input', clientId: null, content: [
      { type: 'text', text: prompt, text_elements: [] }, { type: 'localImage', detail: null, path: 'C:/fixture/observation.png' },
    ] }
    const wire = [
      ...(sequence === 'started-and-completed' ? [shortPathWire('item/started', { item: userMessage })] : []),
      shortPathWire('item/completed', { item: userMessage }),
      shortPathWire('item/started', { item: { type: 'commandExecution', id: 'command', command: 'read local input' } }),
      shortPathWire('item/completed', { item: { type: 'commandExecution', id: 'command', command: 'read local input' } }),
      shortPathWire('item/started', { item: { type: 'mcpToolCall', id: 'mcp', server: 'fixture', tool: 'read_resource' } }),
      shortPathWire('item/completed', { item: { type: 'mcpToolCall', id: 'mcp', server: 'fixture', tool: 'read_resource' } }),
      shortPathWire('item/started', { item: { type: 'agentMessage', id: 'public', phase: 'commentary' } }),
      shortPathWire('item/agentMessage/delta', { itemId: 'public', delta: 'Inspecting the title.' }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'public', phase: 'commentary', text: 'Inspecting the title.' } }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer',
        text: JSON.stringify({ version: 1, requestId: request.requestId, kind: 'reply', reply: 'Inspection finished.', candidate: null }) } }),
      shortPathWire('turn/completed', { turn: { id: 'native-turn', status: 'completed' } }),
    ]
    const { adapter } = realCodexAdapter(shortPathProcess(wire), { generationRequest: request })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(JSON.stringify(events)).not.toContain(prompt)
      expect(events.some(event => 'itemId' in event && event.itemId === 'native-user-input')).toBe(false)
      expect(events.filter(event => event.kind === 'tool')).toEqual([
        expect.objectContaining({ itemId: 'command', name: 'commandExecution', status: 'running' }),
        expect.objectContaining({ itemId: 'command', name: 'commandExecution', status: 'completed' }),
        expect.objectContaining({ itemId: 'mcp', name: 'read_resource', status: 'running' }),
        expect.objectContaining({ itemId: 'mcp', name: 'read_resource', status: 'completed' }),
      ])
      expect(events).toContainEqual(expect.objectContaining({ kind: 'text', itemId: 'public', phase: 'progress', operation: 'append', text: 'Inspecting the title.' }))
      expect(events).toContainEqual(expect.objectContaining({ kind: 'text', itemId: 'final', phase: 'final', operation: 'replace', text: 'Inspection finished.' }))
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
    } finally { await adapter.close() }
  })

  it('discovers models in the requested project directory and keeps its cache scoped to that directory', async () => {
    const script = codexNativeProcess().replace('displayName: name,', 'displayName: process.cwd(),')
    const { adapter, children } = realCodexAdapter(script)
    const firstCwd = process.cwd(), secondCwd = path.dirname(firstCwd)
    try {
      const first = await adapter.discoverCapabilities({ cwd: firstCwd })
      expect(first.models[0]?.label).toBe(firstCwd)
      expect(await adapter.discoverCapabilities({ cwd: firstCwd })).toEqual(first)
      const second = await adapter.discoverCapabilities({ cwd: secondCwd })
      expect(second.models[0]?.label).toBe(secondCwd)
      expect(await adapter.discoverCapabilities()).toEqual(second)
      expect(children).toHaveLength(2)
    } finally { await adapter.close() }
  })

  it('uses one stable short output schema across requests and checks both request identifiers at decode', () => {
    const request = shortPathRequest(), other = { ...request, requestId: randomUUID() }
    const schema = codexCandidateOutputSchema(request) as any
    expect(schema).toEqual(codexCandidateOutputSchema(other))
    expect(codexTurnOutputSchema(request)).toEqual(codexTurnOutputSchema(other))
    const version = schema.properties.version
    const resolvedVersion = version.$ref ? schema.$defs[version.$ref.split('/').at(-1)!] : version
    expect(resolvedVersion.const).toBe(2)
    expect(schema.properties.requestId).toEqual({ type: 'string' })
    expect(JSON.stringify(schema)).not.toMatch(/candidateId|authoringAddress|revisionPolicy|"carrier"/)
    expect(JSON.stringify(schema)).toContain('A complete JSON serialization')
    const candidate = shortPathCandidate(request)
    const edit = { version: 1, requestId: request.requestId, kind: 'edit', reply: null, candidate }
    const decoded = decodeCodexStructuredOutput(JSON.stringify(edit), request)
    expect(decoded).toContain('"input":{"fontSize":48}')
    expect(decoded).not.toContain('lowerCarrierReason')
    expect(() => decodeCodexStructuredOutput(JSON.stringify(edit), other)).toThrow('其他请求')
    expect(() => decodeCodexStructuredOutput(JSON.stringify({ ...edit, candidate: { ...candidate, requestId: other.requestId } }), request)).toThrow('其他请求')
    expect(() => decodeCodexStructuredOutput(JSON.stringify(candidate), { ...other, expectedResult: 'candidate' })).toThrow('其他请求')
  })

  it('accepts only an explicit current-request candidate.json reference and retains inline compatibility', () => {
    const request = shortPathRequest()
    const envelope = { version: 1, requestId: request.requestId, kind: 'edit', reply: null,
      candidate: { version: 1, requestId: request.requestId, candidateFile: 'candidate.json' } }
    expect(decodeCodexStructuredOutput(JSON.stringify(envelope), request)).toContain('"kind":"edit"')
    expect(decodeCodexStructuredOutput(JSON.stringify(envelope), { ...request, expectedResult: 'candidate' })).toContain('courseware-result-v1')
    for (const candidate of [{ ...envelope.candidate, candidateFile: '../candidate.json' },
      { ...envelope.candidate, requestId: randomUUID() }, { ...envelope.candidate, extra: true }]) {
      expect(() => decodeCodexStructuredOutput(JSON.stringify({ ...envelope, candidate }), request)).toThrow()
    }
    expect(decodeCodexStructuredOutput(JSON.stringify(shortPathCandidate(request)), { ...request, expectedResult: 'candidate' })).toContain('courseware-candidate-v1')
  })

  it.each([null, 'saved-native-thread'])('applies the selected model at initial open %s and confirms effort on the first turn', async externalSessionId => {
    const { adapter, messages } = realCodexAdapter(codexNativeProcess())
    try {
      const opened = await adapter.open({ cwd: process.cwd(), externalSessionId, configuration: { model: 'native-selected', effort: 'high' } })
      const create = messages.find(message => message.method === (externalSessionId ? 'thread/resume' : 'thread/start'))
      expect(create.params).toEqual({ cwd: process.cwd(), model: 'native-selected', ...(externalSessionId ? { threadId: externalSessionId, excludeTurns: true } : {}) })
      expect(opened.capabilities.current).toMatchObject({ model: 'native-selected', effort: 'medium' })
      expect(opened.capabilities.requestedConfiguration).toEqual({ model: 'native-selected', effort: 'high' })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(messages.find(message => message.method === 'turn/start').params).toMatchObject({ model: 'native-selected', effort: 'high' })
      expect(events.find(event => event.kind === 'configuration')).toMatchObject({ capabilities: { current: { model: 'native-selected', effort: 'high' }, requestedConfiguration: null } })
    } finally { await adapter.close() }
  })

  it('publishes public text and tool progress but holds all machine output until the successful final outcome', async () => {
    const request = shortPathRequest(), candidate = shortPathCandidate(request)
    const intermediateReply = JSON.stringify({ version: 1, requestId: request.requestId, kind: 'reply', reply: 'I will adjust the title.', candidate: null })
    const final = JSON.stringify({ version: 1, requestId: request.requestId, kind: 'edit', reply: null, candidate })
    const previous = JSON.stringify({ version: 1, requestId: request.requestId, kind: 'reply', reply: 'Superseded final', candidate: null })
    const wire = [
      shortPathWire('item/started', { item: { type: 'agentMessage', id: 'public', phase: 'commentary' } }),
      shortPathWire('item/agentMessage/delta', { itemId: 'public', delta: 'Checking title. ' }),
      shortPathWire('item/agentMessage/delta', { itemId: 'public', delta: 'Ready.' }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'public', phase: 'commentary', text: 'Checking title. Ready.' } }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'json', phase: 'commentary', text: '{"example":{"fontSize":48}}' } }),
      ...[intermediateReply.slice(0, 10), intermediateReply.slice(10)].map(delta => shortPathWire('item/agentMessage/delta', { itemId: 'reply', delta })),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'reply', phase: 'commentary', text: intermediateReply } }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'nonfinal-edit', phase: 'commentary', text: final } }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'superseded', phase: 'final_answer', text: previous } }),
      // No item/started phase: the JSON prefix must still remain private while ambiguous.
      ...[final.slice(0, 1), final.slice(1, 35), final.slice(35)].map(delta => shortPathWire('item/agentMessage/delta', { itemId: 'final', delta })),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text: final } }),
      shortPathWire('item/agentMessage/delta', { itemId: 'final', delta: 'duplicate late delta' }),
      shortPathWire('item/completed', { turnId: 'old-turn', item: { type: 'agentMessage', id: 'stale', phase: 'final_answer', text: previous } }),
      shortPathWire('item/started', { item: { type: 'commandExecution', id: 'after-final' } }),
      shortPathWire('item/completed', { item: { type: 'commandExecution', id: 'after-final' } }),
      shortPathWire('turn/completed', { turn: { id: 'native-turn', status: 'completed' } }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'too-late', phase: 'final_answer', text: final } }),
    ]
    const { adapter } = realCodexAdapter(shortPathProcess(wire), { generationRequest: request })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      const text = events.filter(event => event.kind === 'text')
      expect(text).toContainEqual(expect.objectContaining({ itemId: 'public', operation: 'append', text: 'Checking title. ' }))
      expect(text).toContainEqual(expect.objectContaining({ itemId: 'json', phase: 'progress', text: '{"example":{"fontSize":48}}' }))
      expect(text).toContainEqual(expect.objectContaining({ itemId: 'reply', text: 'I will adjust the title.' }))
      expect(text.filter(event => event.phase === 'candidate')).toEqual([expect.objectContaining({ itemId: 'final', operation: 'replace', text: expect.stringContaining('"version":2') })])
      expect(text.filter(event => event.phase !== 'candidate').every(event => !event.text.includes('requestId'))).toBe(true)
      expect(text.some(event => ['nonfinal-edit', 'superseded', 'stale', 'too-late'].includes(event.itemId))).toBe(false)
      expect(events.findIndex(event => event.kind === 'text' && event.phase === 'candidate')).toBeGreaterThan(events.findIndex(event => event.kind === 'tool' && event.itemId === 'after-final' && event.status === 'completed'))
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
    } finally { await adapter.close() }
  })

  it.each(['failed', 'interrupted'])('does not publish a completed final candidate when the native turn is %s', async status => {
    const request = shortPathRequest(), candidate = JSON.stringify(shortPathCandidate(request))
    const wire = [
      shortPathWire('item/started', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer' } }),
      shortPathWire('item/agentMessage/delta', { itemId: 'final', delta: candidate }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text: candidate } }),
      shortPathWire('turn/completed', { turn: { id: 'native-turn', status } }),
    ]
    const { adapter } = realCodexAdapter(shortPathProcess(wire), { generationRequest: { ...request, expectedResult: 'candidate' } })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.some(event => event.kind === 'text')).toBe(false)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: status === 'interrupted' ? 'cancelled' : 'failed' })
    } finally { await adapter.close() }
  })

  it('discards a buffered candidate when the user cancels before native completion', async () => {
    const request = shortPathRequest(), candidate = JSON.stringify(shortPathCandidate(request))
    const wire = [
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text: candidate } }),
      shortPathWire('item/started', { item: { type: 'commandExecution', id: 'cancel-here' } }),
    ]
    const { adapter, messages } = realCodexAdapter(shortPathProcess(wire), { generationRequest: { ...request, expectedResult: 'candidate' } })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []
      for await (const event of adapter.events()) {
        events.push(event)
        if (event.kind === 'tool') await adapter.cancel()
      }
      expect(messages.filter(message => message.method === 'turn/interrupt')).toHaveLength(1)
      expect(events.some(event => event.kind === 'text')).toBe(false)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'cancelled' })
    } finally { await adapter.close() }
  })

  it.each(['malformed', 'other-request'])('fails a native successful turn with an invalid final transport: %s', async variant => {
    const request = shortPathRequest()
    const text = variant === 'malformed' ? '{"version":2,"requestId":' : JSON.stringify(shortPathCandidate({ ...request, requestId: randomUUID() }))
    const { adapter } = realCodexAdapter(shortPathProcess([
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text } }),
      shortPathWire('turn/completed', { turn: { id: 'native-turn', status: 'completed' } }),
    ]), { generationRequest: { ...request, expectedResult: 'candidate' } })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.some(event => event.kind === 'text')).toBe(false)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'failed' })
    } finally { await adapter.close() }
  })

  it('keeps a final reply quoting a candidate tag on the public text channel', async () => {
    const request = shortPathRequest(), reply = '<courseware-candidate-v1>{"example":true}</courseware-candidate-v1>'
    const text = JSON.stringify({ version: 1, requestId: request.requestId, kind: 'reply', reply, candidate: null })
    const { adapter } = realCodexAdapter(shortPathProcess([
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text } }),
      shortPathWire('turn/completed', { turn: { id: 'native-turn', status: 'completed' } }),
    ]), { generationRequest: request })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.filter(event => event.kind === 'text')).toEqual([expect.objectContaining({ phase: 'final', text: reply })])
    } finally { await adapter.close() }
  })

  it('buffers an unphased reply envelope until its final item and successful turn are known', async () => {
    const request = shortPathRequest(), reply = 'This final reply must be discarded.'
    const text = JSON.stringify({ version: 1, requestId: request.requestId, kind: 'reply', reply, candidate: null })
    const { adapter } = realCodexAdapter(shortPathProcess([
      shortPathWire('item/agentMessage/delta', { itemId: 'final', delta: text }),
      shortPathWire('item/completed', { item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text } }),
      shortPathWire('turn/completed', { turn: { id: 'native-turn', status: 'failed' } }),
    ]), { generationRequest: request })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.some(event => event.kind === 'text')).toBe(false)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'failed' })
    } finally { await adapter.close() }
  })

  it('keeps native last and total usage distinct and deduplicates only identified cumulative snapshots', async () => {
    const last = { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, reasoningOutputTokens: 2, totalTokens: 15 }
    const total1 = { inputTokens: 110, outputTokens: 25, cachedInputTokens: 54, reasoningOutputTokens: 12, totalTokens: 135 }
    const total2 = { inputTokens: 120, outputTokens: 30, cachedInputTokens: 58, reasoningOutputTokens: 14, totalTokens: 150 }
    const usages = [
      { last, total: total1 }, { last, total: total1 }, { last, total: total2 }, { last, total: total1 },
      { last: { inputTokens: -1, outputTokens: 1.5, cachedInputTokens: 0 } },
      { last: { inputTokens: -1, outputTokens: 1.5, cachedInputTokens: 0 } }, { total: { inputTokens: 130 } },
    ]
    const wire = [...usages.map(tokenUsage => shortPathWire('thread/tokenUsage/updated', { tokenUsage })),
      shortPathWire('turn/completed', { turn: { id: 'native-turn', status: 'completed' } })]
    const { adapter } = realCodexAdapter(shortPathProcess(wire))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      // Repeating the same native totals on a new run must not inherit the preceding turn's dedup set.
      for (let i = 0; i < 2; i++) {
        await adapter.startTurn(nativeCodexTurn(), new Map())
        const events = []; for await (const event of adapter.events()) events.push(event)
        const usage = events.filter(event => event.kind === 'usage')
        expect(usage).toHaveLength(5)
        expect(usage[0]).toMatchObject({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 4,
          tokenUsage: { version: 1, source: 'codex-app-server', last: { ...last, cacheWriteInputTokens: null }, total: { ...total1, cacheWriteInputTokens: null } } })
        expect(usage[1]?.tokenUsage?.total).toEqual({ ...total2, cacheWriteInputTokens: null })
        expect(usage[2]).toMatchObject({ inputTokens: null, outputTokens: null, cachedInputTokens: 0,
          tokenUsage: { last: { inputTokens: null, outputTokens: null, reasoningOutputTokens: null, cacheWriteInputTokens: null, totalTokens: null }, total: null } })
        expect(usage[4]).toMatchObject({ inputTokens: null, outputTokens: null, cachedInputTokens: null,
          tokenUsage: { last: null, total: { inputTokens: 130, outputTokens: null } } })
      }
    } finally { await adapter.close() }
  })
})

describe('Codex native subprocess failure and configuration boundaries', () => {
  it.each(['imageGeneration', 'extension'] as const)('accepts generated image frames and sustained traffic without copying base64 into the display trace: %s', async type => {
    const script = codexNativeProcess().replace("send({ id, result: { thread: { id: threadId, model: options.confirmedModel || model, reasoningEffort: options.omitEffort ? null : effort } } });",
      `send({ id, result: { thread: { id: threadId, model, reasoningEffort: effort } } });
      for (let i = 0; i < 6; i++) send({ method: 'item/completed', params: { threadId, turnId: 'native-turn', item: {
        type: '${type}', ${type === 'extension' ? "kind: 'image_gen.generation'," : ''} id: 'image-' + i, status: 'completed',
        result: 'a'.repeat(1861132), savedPath: 'generated/puppy.png' } } });`)
    const { adapter } = realCodexAdapter(script)
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null, configuration: { model: 'native-selected', effort: 'high' } })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
      const completed = events.filter(event => event.kind === 'tool' && event.status === 'completed')
      expect(completed).toHaveLength(6)
      expect(completed[0]).toMatchObject({ detail: { savedPath: 'generated/puppy.png', imageBase64Bytes: 1861132 } })
      expect(JSON.stringify(events).length).toBeLessThan(20000)
    } finally { await adapter.close() }
  })

  it('reports oversized individual frames as a limit failure', async () => {
    const script = codexNativeProcess().replace("send({ id, result: { thread: { id: threadId, model: options.confirmedModel || model, reasoningEffort: options.omitEffort ? null : effort } } });",
      "send({ id, result: { thread: { id: threadId, model, reasoningEffort: effort } } });\nsetTimeout(() => send({ method: 'oversized', params: { data: 'a'.repeat(32 * 1024 * 1024) } }), 1);")
    const { adapter } = realCodexAdapter(script)
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null, configuration: { model: 'native-selected', effort: 'high' } })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'failed', failure: { category: 'limit' } })
    } finally { await adapter.close() }
  })

  it('rejects an initialization exit and can open another native process on the same adapter', async () => {
    let launchCount = 0
    const { adapter, children } = realCodexAdapter(() => codexNativeProcess(++launchCount === 1 ? { exitAt: 'initialize' } : {}))
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: null })).rejects.toThrow('exit 23')
      expect((adapter as any).pendingRpc.size).toBe(0)
      expect(adapter.getExternalSessionId()).toBeNull()
      const reopened = await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      expect(reopened.externalSessionId).toBe('confirmed-native-thread')
      expect(children).toHaveLength(2)
    } finally { await adapter.close() }
  })

  it('rejects pending initialization on a real process launch error', async () => {
    const adapter = new CodexAppServerAdapter(async () => ({ executable: path.join(process.cwd(), 'missing-codex-native.exe'), prefix: [] }))
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: null })).rejects.toThrow(/ENOENT/)
      expect((adapter as any).pendingRpc.size).toBe(0)
      expect(adapter.getExternalSessionId()).toBeNull()
    } finally { await adapter.close() }
  })

  it('closes an unresponsive initialization immediately and repeated close is idempotent', async () => {
    const { adapter, messages, children } = realCodexAdapter(codexNativeProcess({ hangAt: 'initialize' }))
    const opened = adapter.open({ cwd: process.cwd(), externalSessionId: null })
    const rejected = expect(opened).rejects.toThrow('closed')
    try {
      await vi.waitFor(() => expect(messages.some(message => message.method === 'initialize')).toBe(true))
      await Promise.all([adapter.close(), adapter.close()])
      await rejected
      expect((adapter as any).pendingRpc.size).toBe(0)
      await vi.waitFor(() => expect(children[0]!.exitCode).not.toBeNull())
    } finally { await adapter.close() }
  })

  it('does not launch a late process after close while executable resolution is pending', async () => {
    let resolved!: (value: processModule.AgentExecutable) => void
    const adapter = new CodexAppServerAdapter(() => new Promise(resolve => { resolved = resolve }))
    const launch = vi.spyOn(processModule, 'launchAgent')
    const opened = adapter.open({ cwd: process.cwd(), externalSessionId: null })
    const rejected = expect(opened).rejects.toThrow('interrupted')
    await adapter.close()
    resolved({ executable: process.execPath, prefix: ['-e', codexNativeProcess(), '--'] })
    await rejected
    expect(launch).not.toHaveBeenCalled()
  })

  it('bounds an unanswered RPC and clears its request before ending the process', async () => {
    const { adapter } = realCodexAdapter(codexNativeProcess({ hangAt: 'initialize' }), { rpcTimeoutMs: 150 })
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: null })).rejects.toThrow('initialize timeout')
      expect((adapter as any).pendingRpc.size).toBe(0)
    } finally { await adapter.close() }
  })

  it.each(['idle', 'quiet'] as const)('reconciles a persisted turn_aborted through native turn summaries after %s, without an interrupt request', async trigger => {
    // Actual rollout evidence uses event_msg.turn_aborted(reason=interrupted).
    // The app-server represents it as Turn.status=interrupted, not a wire
    // notification named turn_aborted.
    const aborted = { turn_id: 'native-turn', reason: 'interrupted' }
    let script = codexNativeProcess()
      .replace("    setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }), 5);", '')
      .replace("  } else if (method === 'thread/read') {", `
  } else if (method === 'thread/turns/list') {
    send({ id, result: { data: [{ id: '${aborted.turn_id}', status: '${aborted.reason}', items: [], itemsView: 'summary' }], nextCursor: null } });
    setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'interrupted', items: [] } } }), 5);
  } else if (method === 'thread/read') {`)
    if (trigger === 'idle') script = script.replace(
      "send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });",
      "send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } }); setTimeout(() => send({method:'thread/status/changed',params:{threadId,status:{type:'idle'}}}),5);")
    const { adapter, messages } = realCodexAdapter(script, { terminalCheckMs: trigger === 'idle' ? 1000 : 30 })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.filter(event => event.kind === 'turn-ended')).toEqual([
        expect.objectContaining({ nativeTurnId: 'native-turn', status: 'cancelled', failure: null }),
      ])
      expect(messages.some(message => message.method === 'turn/interrupt')).toBe(false)
      expect(messages.filter(message => message.method === 'thread/turns/list').map(message => message.params)).toEqual([
        { threadId: 'confirmed-native-thread', limit: 1, sortDirection: 'desc', itemsView: 'summary' },
      ])
    } finally { await adapter.close() }
  })

  it('does not end a quiet native turn from idle, a different turn, or an inProgress summary', async () => {
    const script = 'let probes=0;\n' + codexNativeProcess()
      .replace("    setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }), 5);", '')
      .replace("  } else if (method === 'thread/read') {", `
  } else if (method === 'thread/turns/list') {
    probes++;
    send({ id, result: { data: [{ id: probes===1?'another-turn':'native-turn', status: probes===2?'inProgress':'interrupted', items: [] }] } });
  } else if (method === 'thread/read') {`)
    const { adapter, messages } = realCodexAdapter(script, { terminalCheckMs: 30 })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(messages.filter(message => message.method === 'thread/turns/list')).toHaveLength(3)
      expect(events.filter(event => event.kind === 'turn-ended')).toHaveLength(1)
      expect(events.at(-1)).toMatchObject({ status: 'cancelled' })
    } finally { await adapter.close() }
  })

  it('ignores a delayed terminal summary from the previous turn after a new turn starts', async () => {
    let script = 'let turnNumber=0;\n' + codexNativeProcess()
      .replace("    setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }), 5);", '')
      .replace("    model = params.model || model; effort = params.effort || effort;", "    turnNumber++; model = params.model || model; effort = params.effort || effort;")
      .replaceAll("id: 'native-turn'", "id: 'native-turn-' + turnNumber")
      .replace("  } else if (method === 'thread/read') {", `
  } else if (method === 'thread/turns/list') {
    if (turnNumber===1) {
      send({ method:'turn/completed', params:{threadId,turn:{id:'native-turn-1',status:'completed',items:[]}} });
      setTimeout(()=>send({id,result:{data:[{id:'native-turn-1',status:'interrupted',items:[]}]}}),60);
    } else send({id,result:{data:[{id:'native-turn-2',status:'completed',items:[]}]}});
  } else if (method === 'thread/read') {`)
    const { adapter } = realCodexAdapter(script, { terminalCheckMs: 30 })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const first = []; for await (const event of adapter.events()) first.push(event)
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const second = []; for await (const event of adapter.events()) second.push(event)
      expect(first.filter(event => event.kind === 'turn-ended')).toEqual([
        expect.objectContaining({nativeTurnId:'native-turn-1',status:'completed'}),
      ])
      expect(second.filter(event => event.kind === 'turn-ended')).toEqual([
        expect.objectContaining({nativeTurnId:'native-turn-2',status:'completed'}),
      ])
    } finally { await adapter.close() }
  })

  it('ends cancellation once when the native interrupt does not respond', async () => {
    const { adapter, messages } = realCodexAdapter(codexNativeProcess({ hangAt: 'turn/interrupt' }), { cancelTimeoutMs: 100 })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const collect = (async () => { const events = []; for await (const event of adapter.events()) events.push(event); return events })()
      await Promise.all([adapter.cancel(), adapter.cancel()])
      const events = await collect
      expect(events.filter(event => event.kind === 'turn-ended')).toEqual([expect.objectContaining({ status: 'cancelled', failure: null })])
      expect(messages.filter(message => message.method === 'turn/interrupt')).toHaveLength(1)
      expect((adapter as any).pendingRpc.size).toBe(0)
    } finally { await adapter.close() }
  })

  it.each([null, 'saved-native-thread'])('sends the selected configuration after opening %s and confirms it from native metadata', async externalSessionId => {
    const { adapter, messages } = realCodexAdapter(codexNativeProcess())
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId })
      const pending = await adapter.configure({ model: 'native-selected', effort: 'high' })
      expect(pending.current).toEqual({ model: 'native-default', resolvedModel: 'native-default', effort: 'medium' })
      expect(pending.requestedConfiguration).toEqual({ model: 'native-selected', effort: 'high' })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(messages.find(message => message.method === 'turn/start').params).toMatchObject({ model: 'native-selected', effort: 'high' })
      const confirmation = events.find(event => event.kind === 'configuration')
      expect(confirmation).toMatchObject({ capabilities: { current: { model: 'native-selected', resolvedModel: 'native-selected', effort: 'high' }, requestedConfiguration: null } })
      expect(adapter.getExternalSessionId()).toBe(externalSessionId ?? 'confirmed-native-thread')
    } finally { await adapter.close() }
  })

  it.each([
    { confirmedModel: 'native-default' },
    { omitEffort: true },
    { rejectAt: 'turn/start' },
  ])('does not confirm or continue a configuration that the native process rejects: %j', async options => {
    const { adapter } = realCodexAdapter(codexNativeProcess(options))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.configure({ model: 'native-selected', effort: 'high' })
      await expect(adapter.startTurn(nativeCodexTurn(), new Map())).rejects.toThrow(/未确认|refused/)
      expect((adapter as any).capabilities.current.model).toBe('native-default')
      await expect(adapter.startTurn(nativeCodexTurn(), new Map())).rejects.toThrow('not open')
    } finally { await adapter.close() }
  })
})

describe('Codex native configuration and permission passthrough', () => {
  it.each([null, 'saved-native-thread'])('inherits already confirmed settings for %s without reading an empty rollout or waiting for a change', async externalSessionId => {
    const script = codexNativeProcess({ rejectAt: 'thread/read' }).replace(
      "send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });",
      "send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });\n    setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }), 5);")
    const { adapter, messages } = realCodexAdapter(script)
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId, configuration: { model: 'native-selected', effort: 'medium' } })
      const started = await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      const params = messages.find(message => message.method === 'turn/start').params
      expect(params).toMatchObject({ model: 'native-selected', effort: 'medium' })
      expect(started.configuration).toMatchObject({ sent: { model: 'native-selected', effort: 'medium' }, confirmed: { model: 'native-selected', effort: 'medium' } })
      expect(messages.some(message => message.method === 'thread/read')).toBe(false)
      expect(events.find(event => event.kind === 'configuration')).toMatchObject({ nativeTurnId: started.nativeTurnId,
        capabilities: { current: { model: 'native-selected', effort: 'medium' }, requestedConfiguration: null } })
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
    } finally { await adapter.close() }
  })

  it.each(['before-ack', 'after-null-read', 'after-old-read', 'after-empty-rollout'] as const)('uses effective settings %s without aborting on unready thread metadata', async ordering => {
    const settings = "send({ method: 'thread/settings/updated', params: { threadId, threadSettings: { model, effort } } });"
    let script = codexNativeProcess()
    if (ordering === 'before-ack') {
      script = script.replace("send({ id, result: { turn: { id: 'native-turn', status: 'inProgress' } } });",
        settings + "\n    send({ id, result: { turn: { id: 'native-turn', status: 'inProgress' } } });")
      script = script.replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });",
        "send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });\n    setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }), 20);")
    } else if (ordering === 'after-empty-rollout') {
      script = script.replace("send({ id, result: { thread: { id: threadId, model: options.confirmedModel || model, reasoningEffort: options.omitEffort ? null : effort } } });",
        "send({ id, error: { message: 'failed to read thread: failed to read session metadata rollout.jsonl: rollout at rollout.jsonl is empty' } });\n    setTimeout(() => { " + settings + " }, 1);")
    } else {
      script = script.replace("send({ id, result: { thread: { id: threadId, model: options.confirmedModel || model, reasoningEffort: options.omitEffort ? null : effort } } });",
        "send({ id, result: { thread: { id: threadId, model: " + (ordering === 'after-null-read' ? "null" : "'native-default'") + ", reasoningEffort: null } } });\n    setTimeout(() => { " + settings + " }, 1);")
    }
    const { adapter, messages } = realCodexAdapter(script)
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.configure({ model: 'native-selected', effort: 'high' })
      const started = await adapter.startTurn(nativeCodexTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.find(event => event.kind === 'configuration')).toMatchObject({ nativeTurnId: started.nativeTurnId,
        capabilities: { current: { model: 'native-selected', effort: 'high' }, requestedConfiguration: null } })
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
      expect(messages.filter(message => message.method === 'turn/start')).toHaveLength(1)
      if (ordering === 'before-ack') expect(messages.some(message => message.method === 'thread/read')).toBe(false)
    } finally { await adapter.close() }
  })

  it.each([null, 'confirmed-native-thread'])('inherits native configuration for session %s without product permission overrides', async externalSessionId => {
    const { adapter, messages } = realCodexAdapter(codexNativeProcess())
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId })
      const opened = messages.find(message => message.method === (externalSessionId ? 'thread/resume' : 'thread/start'))
      expect(opened.params).toEqual({ cwd: process.cwd(), ...(externalSessionId ? { threadId: externalSessionId, excludeTurns: true } : {}) })
    } finally { await adapter.close() }
  })

  it.each([
    ['item/commandExecution/requestApproval', '允许一次', 'accept'],
    ['item/commandExecution/requestApproval', '拒绝', 'decline'],
    ['item/fileChange/requestApproval', '允许本会话', 'acceptForSession'],
    ['item/fileChange/requestApproval', '取消', 'cancel'],
  ])('relays %s decision %s through the exact pending native request', async (method, choice, decision) => {
    const script = codexNativeProcess().replace("const { id, method, params = {} } = JSON.parse(line);", `
  const { id, method, params = {} } = JSON.parse(line);
  if (!method && id === 'approval-1') { send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }); return; }
`).replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });", `
    send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });
    send({ id: 'stale-approval', method: ${JSON.stringify(method)}, params: { threadId: 'another-thread', turnId: 'native-turn', command: 'wrong command' } });
    send({ id: 'approval-1', method: ${JSON.stringify(method)}, params: { threadId, turnId: 'native-turn', itemId: 'native-item', reason: 'Apply requested change', command: 'native command' } });
`)
    const { adapter, messages } = realCodexAdapter(script)
    const turn = nativeCodexTurn()
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(turn, new Map())
      let questionCount = 0
      for await (const event of adapter.events()) {
        if (event.kind !== 'question') continue
        questionCount++
        expect(event.question.purpose).toBe('permission')
        const input = { version: 1 as const, taskId: turn.taskId, epoch: turn.epoch, workspace: turn.workspace, inputId: randomUUID(),
          kind: 'answer' as const, turnId: event.question.turnId, questionId: event.question.questionId,
          answers: [{ id: event.question.questionId, values: [choice!] }] }
        expect((await adapter.input({ ...input, turnId: 'old-turn' })).status).toBe('rejected')
        expect((await adapter.input({ ...input, workspace: { ...input.workspace, projectId: 'another-project' } })).status).toBe('rejected')
        expect((await adapter.input(input)).status).toBe('accepted')
        expect((await adapter.input(input)).status).toBe('rejected')
      }
      expect(questionCount).toBe(1)
      expect(messages.find(message => message.id === 'approval-1')).toEqual({ id: 'approval-1', result: { decision } })
      expect(messages.find(message => message.id === 'stale-approval')?.error?.code).toBe(-32602)
    } finally { await adapter.close() }
  })

  it('cancels native approval before interrupting the turn', async () => {
    const script = codexNativeProcess().replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });", `
    send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });
    send({ id: 'approval-cancel', method: 'item/commandExecution/requestApproval', params: { threadId, turnId: 'native-turn', command: 'native command' } });
`)
    const { adapter, messages } = realCodexAdapter(script)
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeCodexTurn(), new Map())
      for await (const event of adapter.events()) if (event.kind === 'question') await adapter.cancel()
      expect(messages.find(message => message.id === 'approval-cancel')?.result).toEqual({ decision: 'cancel' })
      expect(messages.findIndex(message => message.id === 'approval-cancel')).toBeLessThan(messages.findIndex(message => message.method === 'turn/interrupt'))
    } finally { await adapter.close() }
  })

  it('reuses one native thread across two turns without leaking previous run events', async () => {
    const script = codexNativeProcess().replace("let threadId = null, model = 'native-default', effort = 'medium';", "let threadId = null, model = 'native-default', effort = 'medium', turnNumber = 0;")
      .replace('model = params.model || model; effort = params.effort || effort;', 'turnNumber++; model = params.model || model; effort = params.effort || effort;')
      .replaceAll("'native-turn'", "'native-turn-' + turnNumber")
      .replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn-' + turnNumber } } });", `
    send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn-' + turnNumber } } });
    send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'native-turn-' + (turnNumber - 1), itemId: 'late-old-item', delta: 'stale output' } });
    if (turnNumber > 1) setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn-' + turnNumber, status: 'completed' } } }), 5);
`)
    const { adapter, messages } = realCodexAdapter(script)
    const first = nativeCodexTurn(), second = { ...first, runId: randomUUID(), observationId: randomUUID(), text: 'second observation and host result' }
    try {
      const opened = await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.configure({ model: 'native-selected', effort: 'high' })
      const ids: string[] = []
      for (const turn of [first, second]) {
        const started = await adapter.startTurn(turn, new Map()); ids.push(started.nativeTurnId!)
        const events = []; for await (const event of adapter.events()) events.push(event)
        expect(events.every(event => event.runId === turn.runId && event.nativeTurnId === started.nativeTurnId)).toBe(true)
        expect(events.some(event => event.kind === 'text' && event.text === 'stale output')).toBe(false)
        expect(events.filter(event => event.kind === 'turn-ended')).toEqual([expect.objectContaining({ status: 'completed' })])
        expect(adapter.getExternalSessionId()).toBe(opened.externalSessionId)
      }
      expect(new Set(ids).size).toBe(2)
      expect(messages.filter(message => message.method === 'thread/start')).toHaveLength(1)
      expect(messages.filter(message => message.method === 'turn/start')).toHaveLength(2)
    } finally { await adapter.close() }
  })

  it('returns granted native permission fields without adding access that was not requested', async () => {
    const permissions = { network: { enabled: true } }
    const script = codexNativeProcess().replace("const { id, method, params = {} } = JSON.parse(line);", `
  const { id, method, params = {} } = JSON.parse(line);
  if (!method && id === 'permissions-1') { send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }); return; }
`).replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });", `
    send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });
    send({ id: 'permissions-1', method: 'item/permissions/requestApproval', params: { threadId, turnId: 'native-turn', itemId: 'permission-item', permissions: ${JSON.stringify(permissions)} } });
`)
    const { adapter, messages } = realCodexAdapter(script), turn = nativeCodexTurn()
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null }); await adapter.startTurn(turn, new Map())
      for await (const event of adapter.events()) if (event.kind === 'question') {
        expect((await adapter.input({ version: 1, taskId: turn.taskId, epoch: 0, workspace: turn.workspace, inputId: randomUUID(), kind: 'answer',
          questionId: event.question.questionId, turnId: event.question.turnId, answers: [{ id: event.question.questionId, values: ['允许本次请求'] }] })).status).toBe('accepted')
      }
      expect(messages.find(message => message.id === 'permissions-1')?.result).toEqual({ permissions, scope: 'turn' })
    } finally { await adapter.close() }
  })

  it('relays native tool form input and validates it before sending the elicitation response', async () => {
    const script = codexNativeProcess().replace("const { id, method, params = {} } = JSON.parse(line);", `
  const { id, method, params = {} } = JSON.parse(line);
  if (!method && id === 'form-1') { send({ method: 'turn/completed', params: { threadId, turn: { id: 'native-turn', status: 'completed' } } }); return; }
`).replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });", `
    send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });
    send({ id: 'form-1', method: 'mcpServer/elicitation/request', params: { threadId, turnId: 'native-turn', serverName: 'native-tool', mode: 'form', message: 'Confirm native tool input', requestedSchema: { type: 'object', properties: { label: { type: 'string', minLength: 2 }, count: { type: 'integer', minimum: 1 } }, required: ['label', 'count'], additionalProperties: false } } });
`)
    const { adapter, messages } = realCodexAdapter(script), turn = nativeCodexTurn()
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null }); await adapter.startTurn(turn, new Map())
      for await (const event of adapter.events()) if (event.kind === 'question') {
        const input = { version: 1 as const, taskId: turn.taskId, epoch: 0, workspace: turn.workspace, inputId: randomUUID(), kind: 'answer' as const,
          questionId: event.question.questionId, turnId: event.question.turnId, answers: [{ id: event.question.questionId, values: ['提交'] }, { id: 'label', values: ['native'] }, { id: 'count', values: ['0'] }] }
        expect((await adapter.input(input)).status).toBe('rejected')
        expect((await adapter.input({ ...input, answers: [...input.answers.slice(0, 2), { id: 'count', values: ['2'] }] })).status).toBe('accepted')
      }
      expect(messages.find(message => message.id === 'form-1')?.result).toEqual({ action: 'accept', content: { label: 'native', count: 2 } })
    } finally { await adapter.close() }
  })
})


it.each(['priority', 'default'])('sends and confirms Codex speed %s without changing medium effort or permissions', async serviceTier => {
  let script = codexNativeProcess()
    .replace("defaultReasoningEffort: 'medium' }))", "defaultReasoningEffort: 'medium', serviceTiers: [{id:'priority',name:'Fast',description:'increased usage'}] }))")
    .replace("reasoningEffort: effort } });", "reasoningEffort: effort, serviceTier: params.serviceTier } });")
    .replace("send({ method: 'turn/started', params: { threadId, turn: { id: 'native-turn' } } });", "send({ method: 'thread/settings/updated', params: { threadId, threadSettings: { model, effort, serviceTier: params.serviceTier } } }); setTimeout(() => send({method:'turn/completed',params:{threadId,turn:{id:'native-turn',status:'completed'}}}),10);")
  const { adapter, messages } = realCodexAdapter(script)
  try {
    await adapter.open({ cwd: process.cwd(), externalSessionId: 'confirmed-native-thread', configuration: { model: 'native-selected', effort: 'medium', serviceTier } })
    const started = await adapter.startTurn(nativeCodexTurn(), new Map())
    const events = []; for await (const event of adapter.events()) events.push(event)
    expect(messages.find(message => message.method === 'thread/resume').params).toMatchObject({ model: 'native-selected', serviceTier })
    const params = messages.find(message => message.method === 'turn/start').params
    expect(params).toMatchObject({ model: 'native-selected', effort: 'medium', serviceTier })
    expect(params.approvalPolicy).toBeUndefined()
    expect(started.configuration).toMatchObject({ sent: { serviceTier, effort: 'medium' }, confirmed: { serviceTier, effort: 'medium' } })
    expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
  } finally { await adapter.close() }
})
