import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import * as processModule from '../../src/main/localAgent/process'
import {
  buildOpenCodeCapabilities,
  discoverOpenCodeCapabilities,
  OpenCodeAcpAdapter,
} from '../../src/main/localAgent/openCodeAcp'
import { localAgentCapabilitiesSchema } from '../../src/shared/localAgentContract'
import { localAgentEventV2Schema } from '../../src/shared/localAgentTaskContract'
import type { AgentExecutable } from '../../src/main/localAgent/process'
import type { GenerationRequest } from '../../src/shared/generationContract'

afterEach(() => { vi.restoreAllMocks() })

function createMockProcess(): {
  child: ChildProcessWithoutNullStreams
  stdinStream: PassThrough
  stdoutStream: PassThrough
  stderrStream: PassThrough
} {
  const stdinStream = new PassThrough()
  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()

  const child = {
    stdin: stdinStream,
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: 12345,
    exitCode: null,
    kill: vi.fn(() => {
      (child as any).exitCode = 0
    }),
    once: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'close') {
        // do not close immediately
      }
      return child
    }),
    on: vi.fn(),
  } as unknown as ChildProcessWithoutNullStreams

  return { child, stdinStream, stdoutStream, stderrStream }
}

describe('openCodeAcp capabilities discovery', () => {
  it('builds capabilities with unknown vision, unsupported effort and text question mode', () => {
    const caps = buildOpenCodeCapabilities('1.18.26', {
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: 'opencode/big-pickle',
      options: [
        { value: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle' },
        { value: 'opencode/muse-spark-1.3', name: 'OpenCode Zen/Muse Spark 1.3' },
      ],
    })

    expect(localAgentCapabilitiesSchema.parse(caps)).toEqual(caps)
    expect(caps.adapter).toBe('opencode')
    expect(caps.cliVersion).toBe('1.18.26')
    expect(caps.models).toHaveLength(2)
    expect(caps.models[0]).toEqual({
      id: 'opencode/big-pickle',
      resolvedModel: null,
      label: 'OpenCode Zen/Big Pickle',
      image: 'unknown',
      effort: { kind: 'unsupported' },
    })
    expect(caps.current).toEqual({
      model: 'opencode/big-pickle',
      resolvedModel: null,
      effort: null,
    })
    expect(caps.input).toEqual({
      image: 'supported',
      readFile: 'supported',
      question: 'text',
      correction: 'turn-boundary',
      cancel: 'supported',
    })
  })

  it('keeps unavailable native model configuration unknown without inventing a fallback', () => {
    const caps = buildOpenCodeCapabilities('1.0.0', undefined)
    expect(caps.models).toEqual([])
    expect(caps.current.model).toBeNull()
    expect(caps.current.effort).toBeNull()
    expect(buildOpenCodeCapabilities('1.0.0', { options: [{ value: 'available-only' }] }).current.model).toBeNull()
  })

  it('deduplicates options with duplicate values', () => {
    const caps = buildOpenCodeCapabilities('1.18.26', {
      id: 'model',
      currentValue: 'opencode/model-a',
      options: [
        { value: 'opencode/model-a', name: 'Model A' },
        { value: 'opencode/model-a', name: 'Model A Duplicate' },
        { value: 'opencode/model-b', name: 'Model B' },
      ],
    })
    expect(caps.models).toHaveLength(2)
    expect(new Set(caps.models.map(m => m.id)).size).toBe(2)
  })

  it('discovers only the current model effort directory and preserves native none', () => {
    const model = { id: 'model', currentValue: 'native/luna', options: [{ value: 'native/luna' }, { value: 'native/other' }] }
    const caps = buildOpenCodeCapabilities('1.18.26', model, {
      id: 'effort', category: 'thought_level', type: 'select', currentValue: 'none',
      options: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'max'].map(value => ({ value })),
    })
    expect(caps.current.effort).toBe('none')
    expect(caps.models[0].effort).toEqual({ kind: 'supported', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], default: null })
    expect(caps.models[1].effort).toEqual({ kind: 'unknown' })
    expect(buildOpenCodeCapabilities('1.18.26', model).models[0].effort).toEqual({ kind: 'unsupported' })
    expect(buildOpenCodeCapabilities('1.18.26', model, { id: 'effort', currentValue: 'max', options: [{ value: 'low' }] }).current.effort).toBeNull()
  })

  it('reads grouped native model and effort options without selecting group identifiers', () => {
    const caps = buildOpenCodeCapabilities('1.18.26', {
      id: 'model', type: 'select', currentValue: 'provider-a/default', options: [
        { group: 'provider-a', name: 'Provider A', options: [
          { value: 'provider-a/default', name: 'Default' }, { value: 'provider-a/selected', name: 'Selected' },
        ] },
        { group: 'provider-b', name: 'Provider B', options: [
          { value: 'provider-b/other', name: 'Other' }, { value: 'provider-a/default', name: 'Duplicate' },
        ] },
      ],
    }, {
      id: 'effort', category: 'thought_level', type: 'select', currentValue: 'none',
      options: [{ group: 'reasoning', name: 'Reasoning', options: [{ value: 'none' }, { value: 'max' }, { value: 'max' }] }],
    })
    expect(caps.models.map(model => ({ id: model.id, label: model.label }))).toEqual([
      { id: 'provider-a/default', label: 'Provider A/Default' },
      { id: 'provider-a/selected', label: 'Provider A/Selected' },
      { id: 'provider-b/other', label: 'Provider B/Other' },
    ])
    expect(caps.current).toEqual({ model: 'provider-a/default', resolvedModel: null, effort: 'none' })
    expect(caps.models[0].effort).toEqual({ kind: 'supported', values: ['none', 'max'], default: null })
    expect(caps.models.slice(1).every(model => model.effort.kind === 'unknown')).toBe(true)
  })

  it('ignores unsupported configuration types instead of advertising unusable model controls', () => {
    const model = { id: 'model', type: 'future-control', currentValue: 'native/default', options: [{ value: 'native/default' }] }
    const unsupported = buildOpenCodeCapabilities('1.18.26', model)
    expect(unsupported.models).toEqual([])
    expect(unsupported.current).toEqual({ model: null, resolvedModel: null, effort: null })
    const effort = buildOpenCodeCapabilities('1.18.26', { ...model, type: 'select' }, {
      id: 'effort', type: 'future-control', currentValue: 'max', options: [{ value: 'max' }],
    })
    expect(effort.current.effort).toBeNull()
    expect(effort.models[0].effort).toEqual({ kind: 'unsupported' })
  })
})

function openCodeNativeProcess(options: { exitAt?: string; hangAt?: string; rejectAt?: string; confirmedModel?: string; returnedSessionId?: string; hangPrompt?: boolean; ignoreCancel?: boolean; sessionDelayMs?: number;
  initialModel?: string; initialEffort?: string; confirmedEffort?: string; groupedConfig?: boolean; effortByModel?: Record<string, { values: string[]; initial: string }> } = {}): string {
  return `
const options = ${JSON.stringify(options)};
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
let sessionId = null, model = options.initialModel || 'native/default', promptId = null, effort = options.initialEffort || options.effortByModel?.[model]?.initial;
const selectOptions = (group, values) => options.groupedConfig ? [{ group, name: group, options: values }] : values;
const configOptions = () => [{ id: 'native-model', category: 'model', currentValue: model, options: selectOptions('Native models', [{ value: 'native/default' }, { value: 'native/selected' }]) },
  ...(options.effortByModel?.[model] ? [{ id: 'native-effort', category: 'thought_level', type: 'select', currentValue: effort, options: selectOptions('Reasoning', options.effortByModel[model].values.map(value => ({ value }))) }] : [])];
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params = {} } = JSON.parse(line);
  if (options.exitAt && method === options.exitAt) process.exit(23);
  if (options.hangAt && method === options.hangAt) return;
  if (options.rejectAt && method === options.rejectAt) { send({ id, error: { code: -32602, message: 'native configuration refused' } }); return; }
  if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentInfo: { version: '1.18.26' }, agentCapabilities: { loadSession: true } } });
  else if (method === 'session/new' || method === 'session/load') {
    sessionId = params.sessionId || 'confirmed-native-session';
    const respond = () => send({ id, result: { ...(method === 'session/new' ? { sessionId } : options.returnedSessionId ? { sessionId: options.returnedSessionId } : {}), configOptions: configOptions() } });
    if (options.sessionDelayMs) setTimeout(respond, options.sessionDelayMs); else respond();
  } else if (method === 'session/set_config_option') {
    if (params.configId === 'native-model') {
      const nextModel = options.confirmedModel || params.value;
      if (model !== nextModel) effort = options.effortByModel?.[nextModel]?.initial;
      model = nextModel;
    } else if (params.configId === 'native-effort' && options.effortByModel?.[model]?.values.includes(params.value)) {
      effort = options.confirmedEffort || params.value;
    } else { send({ id, error: { code: -32602, message: 'incorrect native config id or value' } }); return; }
    send({ id, result: { configOptions: configOptions() } });
  } else if (method === 'session/prompt') {
    promptId = id;
    if (!options.hangPrompt) setTimeout(() => send({ id, result: { stopReason: 'end_turn' } }), 5);
  } else if (method === 'session/cancel' && !options.ignoreCancel) {
    send({ id: promptId, result: { stopReason: 'cancelled' } });
  }
});
process.stdin.on('end', () => process.exit(0));
`
}

function realOpenCodeAdapter(script: string | (() => string), timeouts: { rpcTimeoutMs?: number; cancelTimeoutMs?: number } = {}) {
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
  const adapter = new OpenCodeAcpAdapter(async () => ({ executable: process.execPath, prefix: ['-e', typeof script === 'function' ? script() : script, '--'] }), undefined, timeouts)
  return { adapter, messages, children }
}

function nativeOpenCodeTurn() {
  return { taskId: randomUUID(), epoch: 0, workspace: { version: 1 as const, projectId: 'native-test', normalizedPath: 'c:/lessons/native-test.h5lesson' },
    runId: randomUUID(), observationId: randomUUID(), text: 'deterministic protocol test', imageFileIds: [] }
}

function openCodeNativeClientProcess(requests: Array<{ method: string; params: Record<string, unknown> }>): string {
  return openCodeNativeProcess({ hangPrompt: true }) + `
const requests = ${JSON.stringify(requests)};
let clientIndex = 0, terminalId = null;
const nextClientRequest = () => {
  const request = requests[clientIndex++];
  if (!request) { send({ id: promptId, result: { stopReason: 'end_turn' } }); return; }
  send({ id: 'client-' + clientIndex, method: request.method, params: { sessionId, ...request.params, ...(request.params.terminalId === '@terminal' ? { terminalId } : {}) } });
};
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'session/prompt') nextClientRequest();
  if (!message.method && String(message.id).startsWith('client-')) {
    if (message.result?.terminalId) terminalId = message.result.terminalId;
    nextClientRequest();
  }
});
`
}

describe('OpenCode candidate environment anchor', () => {
  it('refreshes the candidate anchor in both ACP and native client terminals on every open', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-candidate-env-'))
    const childSnapshot = path.join(directory, 'acp.json'), terminalSnapshot = path.join(directory, 'terminal.json')
    const snapshot = `JSON.stringify({cwd:process.cwd(),candidateRoot:process.env.COURSEWARE_CANDIDATE_ROOT??null,nativeSetting:process.env.COURSEWARE_NATIVE_ENV_TEST})`
    const { adapter } = realOpenCodeAdapter(`require('node:fs').writeFileSync(${JSON.stringify(childSnapshot)}, ${snapshot});` + openCodeNativeClientProcess([
      { method: 'terminal/create', params: { command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(terminalSnapshot)}, ${snapshot})`], cwd: directory } },
      { method: 'terminal/wait_for_exit', params: { terminalId: '@terminal' } },
      { method: 'terminal/release', params: { terminalId: '@terminal' } },
    ]))
    vi.stubEnv('COURSEWARE_CANDIDATE_ROOT', 'stale-parent-root')
    vi.stubEnv('COURSEWARE_NATIVE_ENV_TEST', 'keep-native-setting')
    try {
      for (const candidateRoot of [path.join(directory, '候选 A'), path.join(directory, '候选 B'), undefined]) {
        await adapter.open({ cwd: directory, externalSessionId: null, candidateRoot })
        await adapter.startTurn(nativeOpenCodeTurn(), new Map())
        for await (const _ of adapter.events()) { /* wait for the terminal read */ }
        const expected = { cwd: directory, candidateRoot: candidateRoot ?? null, nativeSetting: 'keep-native-setting' }
        expect(JSON.parse(await fs.readFile(childSnapshot, 'utf8'))).toEqual(expected)
        expect(JSON.parse(await fs.readFile(terminalSnapshot, 'utf8'))).toEqual(expected)
        expect(process.env.COURSEWARE_CANDIDATE_ROOT).toBe('stale-parent-root')
      }
    } finally { await adapter.close(); await fs.rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs() }
  })

  it.each(['COURSEWARE_CANDIDATE_ROOT', ...(process.platform === 'win32' ? ['courseware_candidate_root'] : [])])(
    'preserves the native terminal environment override for %s', async name => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-candidate-override-'))
      const resultPath = path.join(directory, 'terminal.json')
      const { adapter } = realOpenCodeAdapter(openCodeNativeClientProcess([
        { method: 'terminal/create', params: { command: process.execPath,
          args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({candidateRoot:process.env.COURSEWARE_CANDIDATE_ROOT,nativeSetting:process.env.COURSEWARE_NATIVE_ENV_TEST}))`],
          cwd: directory, env: [
            { name: 'COURSEWARE_CANDIDATE_ROOT', value: 'earlier-native-override' },
            { name, value: 'last-native-override' }, { name: 'COURSEWARE_NATIVE_ENV_TEST', value: 'native-choice' },
          ] } },
        { method: 'terminal/wait_for_exit', params: { terminalId: '@terminal' } },
        { method: 'terminal/release', params: { terminalId: '@terminal' } },
      ]))
      try {
        await adapter.open({ cwd: directory, externalSessionId: null, candidateRoot: path.join(directory, '候选') })
        await adapter.startTurn(nativeOpenCodeTurn(), new Map())
        for await (const _ of adapter.events()) { /* wait for the terminal read */ }
        expect(JSON.parse(await fs.readFile(resultPath, 'utf8'))).toEqual({ candidateRoot: 'last-native-override', nativeSetting: 'native-choice' })
      } finally { await adapter.close(); await fs.rm(directory, { recursive: true, force: true }) }
    },
  )
})

describe('OpenCode native subprocess failure and configuration boundaries', () => {
  function outputBudgetProcess(replayBytes: number, turnBytes: number, chunkBytes = 128 * 1024) {
    return openCodeNativeProcess().replace(
      "if (options.sessionDelayMs) setTimeout(respond, options.sessionDelayMs); else respond();",
      `if (method === 'session/load') emitText(${replayBytes}); respond();`,
    ).replace(
      "promptId = id;",
      `promptId = id; emitText(${turnBytes});`,
    ) + `
function emitText(bytes) {
  while (bytes > 0) {
    const size = Math.min(bytes, ${chunkBytes}); bytes -= size;
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: 'body', content: { type: 'text', text: 'x'.repeat(size) } } } });
  }
}
`
  }

  it('resumes long native replay without charging it against the new turn output budget', async () => {
    const { adapter } = realOpenCodeAdapter(outputBudgetProcess(9 * 1024 * 1024, 512 * 1024))
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: 'saved-native-session' })).resolves.toMatchObject({ externalSessionId: 'saved-native-session' })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const events = []
      for await (const event of adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
      expect(events.reduce((size, event) => size + (event.kind === 'text' ? event.text.length : 0), 0)).toBe(512 * 1024)
    } finally { await adapter.close() }
  })

  it('gives each native turn its own bounded output budget', async () => {
    const { adapter } = realOpenCodeAdapter(outputBudgetProcess(0, 5 * 1024 * 1024))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      for (let turn = 0; turn < 2; turn++) {
        await adapter.startTurn(nativeOpenCodeTurn(), new Map())
        const events = []
        for await (const event of adapter.events()) events.push(event)
        expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
        expect(events.reduce((size, event) => size + (event.kind === 'text' ? event.text.length : 0), 0)).toBe(5 * 1024 * 1024)
      }
    } finally { await adapter.close() }
  })

  it('accepts a multi-megabyte tool patch without charging it as model text', async () => {
    const script = outputBudgetProcess(0, 2 * 1024 * 1024, 2 * 1024 * 1024).replace("sessionUpdate: 'agent_message_chunk'", "sessionUpdate: 'tool_call_update'")
    const { adapter } = realOpenCodeAdapter(script)
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
    } finally { await adapter.close() }
  })

  it('still limits one native turn exceeding the output budget', async () => {
    const { adapter } = realOpenCodeAdapter(outputBudgetProcess(0, 9 * 1024 * 1024))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const events = []
      for await (const event of adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'failed', failure: { category: 'limit', message: expect.stringContaining('output-limit: OpenCode text') } })
    } finally { await adapter.close() }
  })

  it('still limits an oversized native replay message', async () => {
    const { adapter } = realOpenCodeAdapter(outputBudgetProcess(33 * 1024 * 1024, 0, 33 * 1024 * 1024))
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: 'saved-native-session' })).rejects.toThrow('output-limit')
    } finally { await adapter.close() }
  })

  it.each(['another-session', 'rpc-request'])('does not exempt %s traffic from the load output budget', async kind => {
    const script = outputBudgetProcess(9 * 1024 * 1024, 0).replace(
      "params: { sessionId, update:",
      kind === 'another-session' ? "params: { sessionId: 'unrelated-session', update:" : "id: 'unexpected-request', params: { sessionId, update:",
    )
    const { adapter } = realOpenCodeAdapter(script)
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: 'saved-native-session' })).rejects.toThrow('output-limit')
    } finally { await adapter.close() }
  })

  it('reports the native-confirmed configuration before a quiet prompt produces any model output', async () => {
    const { adapter } = realOpenCodeAdapter(openCodeNativeProcess({ hangPrompt: true }))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.configure({ model: 'native/selected', effort: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const event = await adapter.events()[Symbol.asyncIterator]().next()
      expect(event.value).toMatchObject({ kind: 'configuration', capabilities: { current: { model: 'native/selected' } } })
      expect(adapter.getExternalSessionId()).toBe('confirmed-native-session')
    } finally { await adapter.close() }
  })
  it.each([null, 'saved-native-session'])('allows native workspace startup beyond the configuration deadline for session %s', async externalSessionId => {
    const { adapter } = realOpenCodeAdapter(openCodeNativeProcess({ sessionDelayMs: 10_100 }))
    try {
      const opened = await adapter.open({ cwd: process.cwd(), externalSessionId })
      expect(opened.externalSessionId).toBe(externalSessionId ?? 'confirmed-native-session')
      expect((adapter as any).pendingRequests.size).toBe(0)
      await expect(adapter.configure({ model: 'native/selected', effort: null })).resolves.toMatchObject({ current: { model: 'native/selected' } })
    } finally { await adapter.close() }
  }, 15_000)

  it('rejects an initialization exit and reopens a fresh process with no pending requests', async () => {
    let launchCount = 0
    const { adapter } = realOpenCodeAdapter(() => openCodeNativeProcess(++launchCount === 1 ? { exitAt: 'initialize' } : {}))
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: null })).rejects.toThrow('code: 23')
      expect((adapter as any).pendingRequests.size).toBe(0)
      expect(adapter.getExternalSessionId()).toBeNull()
      expect((await adapter.open({ cwd: process.cwd(), externalSessionId: null })).externalSessionId).toBe('confirmed-native-session')
    } finally { await adapter.close() }
  })

  it('rejects pending initialization on a real process launch error', async () => {
    const adapter = new OpenCodeAcpAdapter(async () => ({ executable: path.join(process.cwd(), 'missing-opencode-native.exe'), prefix: [] }))
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: null })).rejects.toThrow(/ENOENT/)
      expect((adapter as any).pendingRequests.size).toBe(0)
    } finally { await adapter.close() }
  })

  it('ends an unanswered initialization on close and does not duplicate process cleanup', async () => {
    const { adapter, messages, children } = realOpenCodeAdapter(openCodeNativeProcess({ hangAt: 'initialize' }))
    const opened = adapter.open({ cwd: process.cwd(), externalSessionId: null })
    const rejected = expect(opened).rejects.toThrow('closed')
    try {
      await vi.waitFor(() => expect(messages.some(message => message.method === 'initialize')).toBe(true))
      await Promise.all([adapter.close(), adapter.close()])
      await rejected
      expect((adapter as any).pendingRequests.size).toBe(0)
      await vi.waitFor(() => expect(children[0]!.exitCode).not.toBeNull())
    } finally { await adapter.close() }
  })

  it('does not launch a late process after cancellation during executable resolution', async () => {
    let resolved!: (value: AgentExecutable) => void
    const adapter = new OpenCodeAcpAdapter(() => new Promise(resolve => { resolved = resolve }))
    const launch = vi.spyOn(processModule, 'launchAgent')
    const opened = adapter.open({ cwd: process.cwd(), externalSessionId: null })
    const rejected = expect(opened).rejects.toThrow('interrupted')
    await adapter.close()
    resolved({ executable: process.execPath, prefix: ['-e', openCodeNativeProcess(), '--'] })
    await rejected
    expect(launch).not.toHaveBeenCalled()
  })

  it('bounds unanswered configuration RPCs without falling back to the previous model', async () => {
    const { adapter } = realOpenCodeAdapter(openCodeNativeProcess({ hangAt: 'session/set_config_option' }), { rpcTimeoutMs: 300 })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await expect(adapter.configure({ model: 'native/selected', effort: null })).rejects.toThrow('session/set_config_option timeout')
      expect((adapter as any).pendingRequests.size).toBe(0)
      await expect(adapter.startTurn(nativeOpenCodeTurn(), new Map())).rejects.toThrow('Session not active')
    } finally { await adapter.close() }
  })

  it('ends cancellation once when the native prompt never acknowledges cancel', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess({ hangPrompt: true, ignoreCancel: true }), { cancelTimeoutMs: 100 })
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const collect = (async () => { const events = []; for await (const event of adapter.events()) events.push(event); return events })()
      await Promise.all([adapter.cancel(), adapter.cancel()])
      expect((await collect).filter(event => event.kind === 'turn-ended')).toEqual([expect.objectContaining({ status: 'cancelled', failure: null })])
      expect(messages.filter(message => message.method === 'session/cancel')).toHaveLength(1)
    } finally { await adapter.close() }
  })

  it.each([null, 'saved-native-session'])('applies and confirms the selected model before prompting session %s', async externalSessionId => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess())
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId })
      const configured = await adapter.configure({ model: 'native/selected', effort: null })
      expect(configured.current).toEqual({ model: 'native/selected', resolvedModel: null, effort: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      for await (const _ of adapter.events()) { /* Consume the native completion. */ }
      const selection = messages.findIndex(message => message.method === 'session/set_config_option')
      const prompt = messages.findIndex(message => message.method === 'session/prompt')
      expect(selection).toBeLessThan(prompt)
      expect(messages[selection].params).toMatchObject({ sessionId: externalSessionId ?? 'confirmed-native-session', configId: 'native-model', value: 'native/selected' })
      expect(adapter.getExternalSessionId()).toBe(externalSessionId ?? 'confirmed-native-session')
    } finally { await adapter.close() }
  })

  it.each([{ confirmedModel: 'native/default' }, { rejectAt: 'session/set_config_option' }])('does not start a prompt after a refused native model selection: %j', async options => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess(options))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await expect(adapter.configure({ model: 'native/selected', effort: null })).rejects.toThrow(/预期|refused/)
      await expect(adapter.startTurn(nativeOpenCodeTurn(), new Map())).rejects.toThrow(/预期|refused/)
      expect(messages.some(message => message.method === 'session/prompt')).toBe(false)
    } finally { await adapter.close() }
  })

  it('rejects an unsupported effort instead of pretending it was applied', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess())
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await expect(adapter.configure({ model: 'native/selected', effort: 'high' })).rejects.toThrow('未暴露强度')
      expect(messages.filter(message => message.method === 'session/set_config_option').map(message => message.params.configId)).toEqual(['native-model'])
    } finally { await adapter.close() }
  })

  it('selects the model before discovering and applying its native effort', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess({ effortByModel: {
      'native/default': { values: ['none', 'low'], initial: 'low' },
      'native/selected': { values: ['none', 'max'], initial: 'none' },
    } }))
    try {
      const opened = await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      expect(opened.capabilities.current.effort).toBe('low')
      expect(opened.capabilities.models.find(model => model.id === 'native/selected')?.effort).toEqual({ kind: 'unknown' })
      const configured = await adapter.configure({ model: 'native/selected', effort: 'max' })
      expect(configured.current).toEqual({ model: 'native/selected', resolvedModel: null, effort: 'max' })
      expect(configured.models.find(model => model.id === 'native/selected')?.effort).toEqual({ kind: 'supported', values: ['none', 'max'], default: null })
      expect(configured.models.find(model => model.id === 'native/default')?.effort).toEqual({ kind: 'unknown' })
      expect(messages.filter(message => message.method === 'session/set_config_option').map(message => message.params)).toEqual([
        { sessionId: 'confirmed-native-session', configId: 'native-model', value: 'native/selected' },
        { sessionId: 'confirmed-native-session', configId: 'native-effort', value: 'max' },
      ])
      await expect(adapter.configure({ model: 'native/default', effort: 'max' })).rejects.toThrow('当前模型的原生目录')
      expect(messages.filter(message => message.method === 'session/set_config_option').at(-1)?.params).toMatchObject({ configId: 'native-model', value: 'native/default' })
      expect(messages.some(message => message.method === 'session/prompt')).toBe(false)
    } finally { await adapter.close() }
  })

  it.each([null, 'saved-native-session'])('selects grouped native model and effort options before prompting session %s', async externalSessionId => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess({ groupedConfig: true, effortByModel: {
      'native/default': { values: ['low', 'high'], initial: 'low' },
      'native/selected': { values: ['none', 'max'], initial: 'none' },
    } }))
    try {
      const opened = await adapter.open({ cwd: process.cwd(), externalSessionId })
      expect(opened.capabilities.models.map(model => model.id)).toEqual(['native/default', 'native/selected'])
      expect(opened.capabilities.current.effort).toBe('low')
      const configured = await adapter.configure({ model: 'native/selected', effort: 'max' })
      expect(configured.current).toEqual({ model: 'native/selected', resolvedModel: null, effort: 'max' })
      expect(configured.models.find(model => model.id === 'native/selected')?.effort).toEqual({ kind: 'supported', values: ['none', 'max'], default: null })
      expect(messages.filter(message => message.method === 'session/set_config_option').map(message => message.params)).toEqual([
        { sessionId: externalSessionId ?? 'confirmed-native-session', configId: 'native-model', value: 'native/selected' },
        { sessionId: externalSessionId ?? 'confirmed-native-session', configId: 'native-effort', value: 'max' },
      ])
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const events = []
      for await (const event of adapter.events()) events.push(event)
      expect(events.find(event => event.kind === 'configuration')).toMatchObject({ capabilities: { current: { model: 'native/selected', effort: 'max' } } })
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
    } finally { await adapter.close() }
  })

  it('preserves the loaded native effort when no override is requested', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess({ initialModel: 'native/selected', initialEffort: 'max',
      effortByModel: { 'native/selected': { values: ['none', 'max'], initial: 'none' } } }))
    try {
      const opened = await adapter.open({ cwd: process.cwd(), externalSessionId: 'saved-native-session' })
      expect(opened.capabilities.current).toMatchObject({ model: 'native/selected', effort: 'max' })
      expect((await adapter.configure({ model: 'native/selected', effort: null })).current.effort).toBe('max')
      expect(messages.filter(message => message.method === 'session/set_config_option').map(message => message.params.configId)).toEqual(['native-model'])
    } finally { await adapter.close() }
  })

  it('does not start a prompt after a conflicting native effort ACK', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess({ confirmedEffort: 'low',
      effortByModel: { 'native/selected': { values: ['none', 'low', 'max'], initial: 'none' } } }))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await expect(adapter.configure({ model: 'native/selected', effort: 'max' })).rejects.toThrow('配置 OpenCode 强度失败')
      await expect(adapter.startTurn(nativeOpenCodeTurn(), new Map())).rejects.toThrow('实际返回 native/selected/low')
      expect(messages.some(message => message.method === 'session/prompt')).toBe(false)
    } finally { await adapter.close() }
  })

  it.each([false, true])('publishes external model and effort changes from the same native config update (grouped=%s)', async groupedConfig => {
    const script = openCodeNativeProcess({ groupedConfig, effortByModel: {
      'native/default': { values: ['none', 'low'], initial: 'low' },
      'native/selected': { values: ['none', 'max'], initial: 'none' },
    } }).replace('promptId = id;', `promptId = id;
      model = 'native/selected'; effort = 'max';
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'config_option_update', configOptions: configOptions() } } });`)
    const { adapter } = realOpenCodeAdapter(script)
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      const latest = events.filter(event => event.kind === 'configuration').at(-1)
      expect(latest).toMatchObject({ capabilities: { current: { model: 'native/selected', effort: 'max' } } })
      if (latest?.kind !== 'configuration') throw new Error('Missing native configuration update')
      expect(latest.capabilities.models.find(model => model.id === 'native/default')?.effort).toEqual({ kind: 'unknown' })
      expect(latest.capabilities.models.find(model => model.id === 'native/selected')?.effort).toEqual({ kind: 'supported', values: ['none', 'max'], default: null })
    } finally { await adapter.close() }
  })

  it('does not publish a requested resume identity when native confirmation conflicts', async () => {
    const { adapter } = realOpenCodeAdapter(openCodeNativeProcess({ returnedSessionId: 'another-native-session' }))
    try {
      await expect(adapter.open({ cwd: process.cwd(), externalSessionId: 'saved-native-session' })).rejects.toThrow('another session')
      expect(adapter.getExternalSessionId()).toBeNull()
    } finally { await adapter.close() }
  })
})

describe('OpenCode native filesystem terminal and permission bridge', () => {
  it('reads requested lines and writes a native file outside observations without treating it as a candidate', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-native-fs-'))
    const inputPath = path.join(root, 'input.txt'), outputPath = path.join(root, 'nested', 'output.txt')
    await fs.writeFile(inputPath, 'first\nsecond\nthird\n')
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeClientProcess([
      { method: 'fs/read_text_file', params: { path: inputPath, line: 2, limit: 1 } },
      { method: 'fs/write_text_file', params: { path: outputPath, content: 'native-write' } },
      { method: 'fs/write_text_file', params: { path: outputPath, content: 'wrong-session', sessionId: 'other-session' } },
    ]))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      const events = []; for await (const event of adapter.events()) events.push(event)
      expect(messages.find(message => message.id === 'client-1')?.result).toEqual({ content: 'second\n' })
      expect(messages.find(message => message.id === 'client-2')?.result).toEqual({})
      expect(messages.find(message => message.id === 'client-3')?.error?.code).toBe(-32602)
      expect(await fs.readFile(outputPath, 'utf8')).toBe('native-write')
      expect(events.filter(event => event.kind === 'turn-ended')).toHaveLength(1)
    } finally { await adapter.close(); await fs.rm(root, { recursive: true, force: true }) }
  })

  it('runs a hidden native terminal with cwd and env then waits reads and releases its handle', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-native-terminal-'))
    const resultPath = path.join(root, 'result.json')
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeClientProcess([
      { method: 'terminal/create', params: { command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({cwd:process.cwd(),value:process.env.COURSEWARE_TERMINAL_TEST}));process.stdout.write('start🙂abc🙂')`],
        cwd: root, env: [{ name: 'COURSEWARE_TERMINAL_TEST', value: 'inherited-choice' }], outputByteLimit: 8 } },
      { method: 'terminal/wait_for_exit', params: { terminalId: '@terminal' } },
      { method: 'terminal/output', params: { terminalId: '@terminal' } },
      { method: 'terminal/release', params: { terminalId: '@terminal' } },
      { method: 'terminal/output', params: { terminalId: '@terminal' } },
    ]))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      for await (const _ of adapter.events()) { /* consume completion */ }
      expect(messages.find(message => message.method === 'initialize')?.params.clientCapabilities.terminal).toBe(true)
      expect(JSON.parse(await fs.readFile(resultPath, 'utf8'))).toEqual({ cwd: root, value: 'inherited-choice' })
      expect(messages.find(message => message.id === 'client-2')?.result).toEqual({ exitCode: 0, signal: null })
      expect(messages.find(message => message.id === 'client-3')?.result).toEqual({ output: 'abc🙂', truncated: true, exitStatus: { exitCode: 0, signal: null } })
      expect(messages.find(message => message.id === 'client-5')?.error?.code).toBe(-32602)
      expect((adapter as any).terminals.size).toBe(0)
    } finally { await adapter.close(); await fs.rm(root, { recursive: true, force: true }) }
  })

  it.each(['Allow once', 'Reject'])('returns the actual native permission option for %s and rejects stale answers', async choice => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeClientProcess([
      { method: 'session/request_permission', params: { toolCall: { toolCallId: 'native-execute', title: 'Run native command', kind: 'execute' },
        options: [{ name: 'Allow once', kind: 'allow_once', optionId: 'native-allow' }, { name: 'Reject', kind: 'reject_once', optionId: 'native-reject' }] } },
    ]))
    const turn = nativeOpenCodeTurn()
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(turn, new Map())
      for await (const event of adapter.events()) {
        if (event.kind !== 'question') continue
        expect(event.question.purpose).toBe('permission')
        const input = { version: 1 as const, taskId: turn.taskId, epoch: 0, workspace: turn.workspace, inputId: randomUUID(),
          kind: 'answer' as const, turnId: event.question.turnId, questionId: event.question.questionId,
          answers: [{ id: event.question.questionId, values: [choice] }] }
        expect((await adapter.input({ ...input, turnId: 'old-turn' })).status).toBe('rejected')
        expect((await adapter.input(input)).status).toBe('accepted')
        expect((await adapter.input(input)).status).toBe('rejected')
      }
      expect(messages.find(message => message.id === 'client-1')?.result).toEqual({ outcome: { outcome: 'selected', optionId: choice === 'Allow once' ? 'native-allow' : 'native-reject' } })
      expect(messages.filter(message => message.method === 'session/prompt')).toHaveLength(1)
    } finally { await adapter.close() }
  })

  it('cancels a pending native permission when Stop is requested', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeClientProcess([
      { method: 'session/request_permission', params: { toolCall: { toolCallId: 'native-edit', kind: 'edit' }, options: [{ name: 'Allow', kind: 'allow_once', optionId: 'native-allow' }] } },
    ]))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      for await (const event of adapter.events()) if (event.kind === 'question') await adapter.cancel()
      expect(messages.find(message => message.id === 'client-1')?.result).toEqual({ outcome: { outcome: 'cancelled' } })
    } finally { await adapter.close() }
  })

  it('queues mid-turn corrections without replacing the native prompt request', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess({ hangPrompt: true }))
    const turn = nativeOpenCodeTurn()
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      const started = await adapter.startTurn(turn, new Map())
      const input = { version: 1 as const, taskId: turn.taskId, epoch: 0, workspace: turn.workspace, inputId: randomUUID(), kind: 'correct' as const,
        turnId: started.nativeTurnId, text: 'Preserve the requested correction for the next turn' }
      expect((await adapter.input(input)).status).toBe('queued')
      expect((await adapter.input({ ...input, turnId: 'older-turn' })).status).toBe('rejected')
      expect(messages.filter(message => message.method === 'session/prompt')).toHaveLength(1)
      await adapter.cancel()
    } finally { await adapter.close() }
  })

  it('stops an owned terminal while its native wait is pending and ends the turn once', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeClientProcess([
      { method: 'terminal/create', params: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] } },
      { method: 'terminal/wait_for_exit', params: { terminalId: '@terminal' } },
    ]))
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await adapter.startTurn(nativeOpenCodeTurn(), new Map())
      await vi.waitFor(() => expect(messages.find(message => message.id === 'client-1')?.result?.terminalId).toBeTypeOf('string'))
      const terminal = [...(adapter as any).terminals.values()][0] as { child: ChildProcessWithoutNullStreams }
      const events = (async () => { const collected = []; for await (const event of adapter.events()) collected.push(event); return collected })()
      await adapter.cancel()
      expect((await events).filter(event => event.kind === 'turn-ended')).toEqual([expect.objectContaining({ status: 'cancelled' })])
      await vi.waitFor(() => expect(terminal.child.exitCode !== null || terminal.child.signalCode !== null).toBe(true))
      expect((adapter as any).terminals.size).toBe(0)
    } finally { await adapter.close() }
  })

  it('reuses one native session across two turns with separate run and prompt identities', async () => {
    const script = openCodeNativeProcess().replace('promptId = id;', `
    promptId = id;
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'turn:' + params.prompt[0].text } } } });
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'config_option_update', configOptions: configOptions() } } });
`)
    const { adapter, messages } = realOpenCodeAdapter(script)
    const first = nativeOpenCodeTurn(), second = { ...first, runId: randomUUID(), observationId: randomUUID(), text: 'second observation and host result' }
    try {
      const opened = await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      const ids: string[] = []
      for (const turn of [first, second]) {
        const started = await adapter.startTurn(turn, new Map()); ids.push(started.nativeTurnId!)
        const events = []; for await (const event of adapter.events()) events.push(event)
        expect(events.every(event => event.runId === turn.runId && event.nativeTurnId === started.nativeTurnId)).toBe(true)
        expect(events.filter(event => event.kind === 'turn-ended')).toEqual([expect.objectContaining({ status: 'completed' })])
        expect(events.find(event => event.kind === 'configuration')).toMatchObject({ capabilities: { current: { model: 'native/default' } } })
        expect(adapter.getExternalSessionId()).toBe(opened.externalSessionId)
      }
      expect(new Set(ids).size).toBe(2)
      expect(messages.filter(message => message.method === 'session/new')).toHaveLength(1)
      expect(messages.filter(message => message.method === 'session/prompt')).toHaveLength(2)
    } finally { await adapter.close() }
  })

  it('rejects an unavailable observation image without silently sending a text-only prompt', async () => {
    const { adapter, messages } = realOpenCodeAdapter(openCodeNativeProcess())
    try {
      await adapter.open({ cwd: process.cwd(), externalSessionId: null })
      await expect(adapter.startTurn({ ...nativeOpenCodeTurn(), imageFileIds: ['missing-image'] }, new Map())).rejects.toThrow('图片不在当前观察中')
      expect(messages.some(message => message.method === 'session/prompt')).toBe(false)
    } finally { await adapter.close() }
  })
})

describe('OpenCodeAcpAdapter lifecycle and turn handling', () => {
  beforeEach(() => {
    vi.spyOn(processModule, 'stopAgent').mockImplementation(async child => {
      (child as any).exitCode = 0
    })
  })
  it('probes probe status and version accurately', async () => {
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    // With a mock capture that returns version 1.18.26
    vi.spyOn(await import('../../src/main/localAgent/process'), 'captureAgent').mockResolvedValueOnce({
      code: 0,
      text: 'opencode version 1.18.26 (x86_64-pc-windows-msvc)',
    })

    const probe = await adapter.probe()
    expect(probe.status).toBe('unknown-auth')
    expect(probe.version).toBe('1.18.26')
    expect(probe.adapter).toBe('opencode')
  })

  it('opens session, initializes protocol, and extracts config options', async () => {
    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(await import('../../src/main/localAgent/process'), 'launchAgent').mockReturnValueOnce(child)

    // Handle responses from stdin
    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: 1,
            agentInfo: { name: 'OpenCode', version: '1.18.26' },
            agentCapabilities: { loadSession: true },
          },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            sessionId: 'ses_test_123',
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                category: 'model',
                currentValue: 'opencode/big-pickle',
                options: [
                  { value: 'opencode/big-pickle', name: 'Big Pickle' },
                  { value: 'opencode/muse-spark-1.3', name: 'Muse Spark 1.3' },
                ],
              },
            ],
          },
        }) + '\n')
      }
    })

    const opened = await adapter.open({ cwd: process.cwd(), externalSessionId: null })
    expect(opened.externalSessionId).toBe('ses_test_123')
    expect(opened.capabilities.cliVersion).toBe('1.18.26')
    expect(opened.capabilities.current.model).toBe('opencode/big-pickle')

    await adapter.close()
  })

  it('configures model and updates capabilities', async () => {
    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(await import('../../src/main/localAgent/process'), 'launchAgent').mockReturnValueOnce(child)

    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: {
            sessionId: 'ses_test_456',
            configOptions: [{
              id: 'model', currentValue: 'opencode/big-pickle',
              options: [
                { value: 'opencode/big-pickle', name: 'Big Pickle' },
                { value: 'opencode/muse-spark-1.3', name: 'Muse Spark 1.3' },
              ],
            }],
          },
        }) + '\n')
      } else if (msg.method === 'session/set_config_option') {
        expect(msg.params.configId).toBe('model')
        expect(msg.params.value).toBe('opencode/muse-spark-1.3')
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: {
            configOptions: [{
              id: 'model', currentValue: 'opencode/muse-spark-1.3',
              options: [
                { value: 'opencode/big-pickle', name: 'Big Pickle' },
                { value: 'opencode/muse-spark-1.3', name: 'Muse Spark 1.3' },
              ],
            }],
          },
        }) + '\n')
      }
    })

    await adapter.open({ cwd: process.cwd(), externalSessionId: null })

    // Rejects unknown model
    await expect(adapter.configure({ model: 'nonexistent/model', effort: null })).rejects.toThrow(
      '模型 nonexistent/model 不在 OpenCode 原生目录中',
    )

    const updated = await adapter.configure({ model: 'opencode/muse-spark-1.3', effort: null })
    expect(updated.current.model).toBe('opencode/muse-spark-1.3')
    expect(updated.current.effort).toBeNull()

    // cancel() works without error
    await expect(adapter.cancel()).resolves.toBeUndefined()

    // close() is idempotent
    await expect(adapter.close()).resolves.toBeUndefined()
    await expect(adapter.close()).resolves.toBeUndefined()
  })

  it('runs startTurn, emits text and tool events, and completes turn', async () => {
    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(await import('../../src/main/localAgent/process'), 'launchAgent').mockReturnValueOnce(child)

    let promptId: number | null = null
    const longToolTitle = `C:/workspace/${'long-candidate-directory/'.repeat(15)}image.png`
    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { sessionId: 'ses_turn_test', configOptions: [] },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        promptId = msg.id
        expect(msg.params.prompt[0].text).toBe('Hello OpenCode')
        // OpenCode sends message chunks, tool calls, and thought chunks
        setTimeout(() => {
          // agent_thought_chunk should be ignored
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', method: 'session/update',
            params: {
              sessionId: 'ses_turn_test',
              update: { sessionUpdate: 'agent_thought_chunk', messageId: 'm1', content: { type: 'text', text: 'Thinking internally...' } },
            },
          }) + '\n')
          // agent_message_chunk should be emitted
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', method: 'session/update',
            params: {
              sessionId: 'ses_turn_test',
              update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Hello! ' } },
            },
          }) + '\n')
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', method: 'session/update',
            params: {
              sessionId: 'ses_turn_test',
              update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'I am ready.' } },
            },
          }) + '\n')
          // tool_call should be emitted as running
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', method: 'session/update',
            params: {
              sessionId: 'ses_turn_test',
              update: { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'read', kind: 'read', status: 'pending' },
            },
          }) + '\n')
          // tool_call_update should be emitted as completed
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', method: 'session/update',
            params: {
              sessionId: 'ses_turn_test',
              update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', title: longToolTitle, status: 'completed' },
            },
          }) + '\n')
          // An update without an earlier tool_call still has a bounded display label.
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', method: 'session/update',
            params: {
              sessionId: 'ses_turn_test',
              update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_2', title: longToolTitle, status: 'failed' },
            },
          }) + '\n')
          // The native plan is readable status, not its raw ACP envelope.
          stdoutStream.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_turn_test',
            update: { sessionUpdate: 'plan', entries: [{ content: 'Read the page', status: 'completed' }, { content: 'Prepare the result', status: 'in_progress' }] } } }) + '\n')
          // usage_update
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', method: 'session/update',
            params: {
              sessionId: 'ses_turn_test',
              update: { sessionUpdate: 'usage_update', usage: { inputTokens: 100, outputTokens: 20, cachedReadTokens: 50 } },
            },
          }) + '\n')
          // End of prompt turn
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', id: promptId,
            result: {
              stopReason: 'end_turn',
              usage: { inputTokens: 100, outputTokens: 20, cachedReadTokens: 50 },
            },
          }) + '\n')
        }, 10)
      }
    })

    await adapter.open({ cwd: process.cwd(), externalSessionId: null })

    const taskId = randomUUID()
    const runId = randomUUID()
    const started = await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      runId,
      observationId: randomUUID(),
      text: 'Hello OpenCode',
      imageFileIds: [],
    }, new Map())

    expect(started.nativeTurnId).toBeDefined()

    const events: any[] = []
    for await (const ev of adapter.events()) {
      events.push(ev)
    }

    // Verify thoughts were excluded
    expect(events.some(e => e.kind === 'text' && e.text.includes('Thinking'))).toBe(false)
    // Verify text chunks arrived
    const texts = events.filter(e => e.kind === 'text' && e.phase === 'body')
    expect(texts).toHaveLength(2)
    expect(texts[0].text).toBe('Hello! ')
    expect(texts[1].text).toBe('I am ready.')
    expect(events.filter(e => e.kind === 'text' && e.phase === 'plan')).toEqual([expect.objectContaining({ text: '已完成：Read the page\n正在进行：Prepare the result' })])
    // Verify tools
    const tools = events.filter(e => e.kind === 'tool')
    expect(tools).toHaveLength(3)
    expect(tools[0].status).toBe('running')
    expect(tools[1].status).toBe('completed')
    expect(tools[1].name).toBe('read')
    expect(tools[1].detail.title).toBe(longToolTitle)
    expect(tools[2].name).toHaveLength(200)
    expect(tools[2].detail.title).toBe(longToolTitle)
    for (const [index, event] of events.entries()) {
      expect(localAgentEventV2Schema.safeParse({
        ...event, version: 2, sessionId: taskId, sequence: index + 1, time: Date.now(),
      }).success).toBe(true)
    }
    // Verify usage
    const usages = events.filter(e => e.kind === 'usage')
    expect(usages.length).toBeGreaterThan(0)
    // Verify completion
    const terminal = events.find(e => e.kind === 'turn-ended')
    expect(terminal).toBeDefined()
    expect(terminal.status).toBe('completed')
    expect(terminal.failure).toBeNull()

    await adapter.close()
  })

  it('handles cancellation and maps cancelled response to turn-ended with cancelled status', async () => {
    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(await import('../../src/main/localAgent/process'), 'launchAgent').mockReturnValueOnce(child)

    let promptId: number | null = null
    let cancelReceived = false
    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { sessionId: 'ses_cancel_test', configOptions: [] },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        promptId = msg.id
      } else if (msg.method === 'session/cancel') {
        cancelReceived = true
        expect(msg.params.sessionId).toBe('ses_cancel_test')
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: promptId,
          result: { stopReason: 'cancelled', usage: { inputTokens: 0, outputTokens: 0 } },
        }) + '\n')
      }
    })

    await adapter.open({ cwd: process.cwd(), externalSessionId: null })

    const taskId = randomUUID()
    const runId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      runId,
      observationId: randomUUID(),
      text: 'Long prompt',
      imageFileIds: [],
    }, new Map())

    const delivery = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      inputId: randomUUID(),
      turnId: null,
      kind: 'stop',
    })

    expect(delivery.status).toBe('accepted')
    expect(cancelReceived).toBe(true)

    const events: any[] = []
    for await (const ev of adapter.events()) {
      events.push(ev)
    }

    const terminal = events.find(e => e.kind === 'turn-ended')
    expect(terminal).toBeDefined()
    expect(terminal.status).toBe('cancelled')
    expect(terminal.failure).toBeNull()

    await adapter.close()
  })

  it('allows candidate writing via fs/write_text_file during generation', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-test-'))
    const reqId = randomUUID()
    const candidateDir = path.join(tmpDir, 'candidates', reqId)
    await fs.mkdir(candidateDir, { recursive: true })

    const request: GenerationRequest = {
      version: 1,
      requestId: reqId,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/lessons/native-test.h5lesson' },
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
          surfaceId: 'slide',
          locationId: 'page',
          stateId: null,
          owner: 'scene',
          ownerKey: 'scene:page',
          itemId: 'title',
          authoringAddress: 'page/title',
        },
      }],
      context: {},
      allowedCarriers: ['native'],
    }

    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve, request)

    vi.spyOn(await import('../../src/main/localAgent/process'), 'launchAgent').mockReturnValueOnce(child)

    let promptId: number | null = null
    let writeAccepted = false
    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { sessionId: 'ses_write_test', configOptions: [] },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        promptId = msg.id
        // OpenCode attempts candidate write
        setTimeout(() => {
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', id: 99, method: 'fs/write_text_file',
            params: {
              sessionId: 'ses_write_test',
              path: path.join(candidateDir, 'candidate.json'),
              content: JSON.stringify({ candidate: 'valid' }),
            },
          }) + '\n')
        }, 10)
      } else if (msg.id === 99) {
        if (msg.result) {
          writeAccepted = true
          // complete prompt
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', id: promptId,
            result: { stopReason: 'end_turn', usage: {} },
          }) + '\n')
        }
      }
    })

    await adapter.open({ cwd: tmpDir, externalSessionId: null })

    const taskId = randomUUID()
    const runId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/lessons/native-test.h5lesson' },
      runId,
      observationId: randomUUID(),
      text: 'Write candidate',
      imageFileIds: [],
    }, new Map())

    for await (const _ of adapter.events()) {
      // consume
    }

    expect(writeAccepted).toBe(true)
    const written = await fs.readFile(path.join(candidateDir, 'candidate.json'), 'utf8')
    expect(JSON.parse(written)).toEqual({ candidate: 'valid' })

    await adapter.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('runs discoverOpenCodeCapabilities and returns validated capabilities', async () => {
    const { child, stdinStream, stdoutStream } = createMockProcess()
    vi.spyOn(processModule, 'launchAgent').mockReturnValueOnce(child)

    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: {
            protocolVersion: 1,
            agentInfo: { name: 'OpenCode', version: '1.18.26' },
          },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: {
            sessionId: 'ses_disc_123',
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                category: 'model',
                currentValue: 'opencode/big-pickle',
                options: [
                  { value: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle' },
                  { value: 'opencode/muse-spark-1.3', name: 'OpenCode Zen/Muse Spark 1.3' },
                ],
              },
            ],
          },
        }) + '\n')
      }
    })

    const caps = await discoverOpenCodeCapabilities('opencode', process.cwd())
    expect(caps.cliVersion).toBe('1.18.26')
    expect(caps.adapter).toBe('opencode')
    expect(caps.models).toHaveLength(2)
    expect(caps.current.model).toBe('opencode/big-pickle')
    expect(caps.input.image).toBe('supported')
    expect(caps.input.question).toBe('text')
  })

  it('encodes image file as base64 in session/prompt and allows reading observation file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-img-test-'))
    const imgPath = path.join(tmpDir, 'test.png')
    const obsPath = path.join(tmpDir, 'observation.txt')
    const fakePngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await fs.writeFile(imgPath, fakePngData)
    await fs.writeFile(obsPath, 'OBS-TOKEN-12345')

    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(processModule, 'launchAgent').mockReturnValueOnce(child)

    let promptParams: any = null
    let readResult: any = null
    let promptId: number | null = null

    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { sessionId: 'ses_img_test', configOptions: [] },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        promptId = msg.id
        promptParams = msg.params
        // OpenCode attempts to read observation.txt via fs/read_text_file
        setTimeout(() => {
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', id: 50, method: 'fs/read_text_file',
            params: { sessionId: 'ses_img_test', path: obsPath },
          }) + '\n')
        }, 10)
      } else if (msg.id === 50) {
        readResult = msg.result
        // finish turn
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: promptId,
          result: { stopReason: 'end_turn', usage: {} },
        }) + '\n')
      }
    })

    await adapter.open({ cwd: tmpDir, externalSessionId: null })

    const observationFiles = new Map<string, string>([
      ['img_1', imgPath],
      ['obs_1', obsPath],
    ])

    const taskId = randomUUID()
    const runId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/lessons/native-test.h5lesson' },
      runId,
      observationId: randomUUID(),
      text: 'Analyze image and file',
      imageFileIds: ['img_1'],
    }, observationFiles)

    for await (const _ of adapter.events()) {
      // consume
    }

    expect(promptParams).toBeDefined()
    expect(promptParams.prompt).toHaveLength(2)
    expect(promptParams.prompt[0]).toEqual({ type: 'text', text: 'Analyze image and file' })
    expect(promptParams.prompt[1]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: fakePngData.toString('base64'),
    })

    expect(readResult).toBeDefined()
    expect(readResult.content).toBe('OBS-TOKEN-12345')

    await adapter.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('rejects an answer without a matching native request without starting another prompt', async () => {
    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(processModule, 'launchAgent').mockReturnValueOnce(child)

    let answerPromptText = ''
    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { sessionId: 'ses_ans_test', configOptions: [] },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        const text = msg.params.prompt[0].text
        if (text !== 'Question prompt') {
          answerPromptText = text
        }
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { stopReason: 'end_turn', usage: {} },
        }) + '\n')
      }
    })

    await adapter.open({ cwd: process.cwd(), externalSessionId: null })

    const taskId = randomUUID()
    const runId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      runId,
      observationId: randomUUID(),
      text: 'Question prompt',
      imageFileIds: [],
    }, new Map())

    const delivery = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      inputId: randomUUID(),
      turnId: null,
      kind: 'answer',
      questionId: 'q1',
      answers: [{ id: 'choice', values: ['Green'] }],
    })

    expect(delivery.status).toBe('rejected')
    expect(answerPromptText).toBe('')

    await adapter.close()
  })

  it('rejects user input when turn is missing, taskId mismatches, or epoch mismatches (D-06)', async () => {
    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(processModule, 'launchAgent').mockReturnValueOnce(child)

    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { sessionId: 'ses_identity_test', configOptions: [] },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { stopReason: 'end_turn', usage: {} },
        }) + '\n')
      }
    })

    await adapter.open({ cwd: process.cwd(), externalSessionId: null })

    const taskId = randomUUID()
    const wrongTaskId = randomUUID()

    // 1. Without startTurn (currentTurnInput missing)
    const deliveryNoTurn = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      inputId: randomUUID(),
      turnId: null,
      kind: 'stop',
    })
    expect(deliveryNoTurn.status).toBe('rejected')
    expect(deliveryNoTurn.reason).toBe('任务或 Epoch 不匹配')

    // Start turn with specific taskId and epoch: 0
    const runId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      runId,
      observationId: randomUUID(),
      text: 'Start',
      imageFileIds: [],
    }, new Map())

    // 2. Task ID mismatch
    const deliveryWrongTask = await adapter.input({
      version: 1,
      taskId: wrongTaskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      inputId: randomUUID(),
      turnId: null,
      kind: 'stop',
    })
    expect(deliveryWrongTask.status).toBe('rejected')
    expect(deliveryWrongTask.reason).toBe('任务或 Epoch 不匹配')

    // 3. Epoch mismatch
    const deliveryWrongEpoch = await adapter.input({
      version: 1,
      taskId,
      epoch: 1,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      inputId: randomUUID(),
      turnId: null,
      kind: 'stop',
    })
    expect(deliveryWrongEpoch.status).toBe('rejected')
    expect(deliveryWrongEpoch.reason).toBe('任务或 Epoch 不匹配')

    // 4. Matching task and epoch is accepted
    const deliveryAccepted = await adapter.input({
      version: 1,
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/proj' },
      inputId: randomUUID(),
      turnId: null,
      kind: 'stop',
    })
    expect(deliveryAccepted.status).toBe('accepted')

    await adapter.close()
  })

  it('reads native files beyond observations and relays explicit native permission choices', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-d02-test-'))
    const secretPath = path.join(tmpDir, 'unauthorized-secret.txt')
    const obsPath = path.join(tmpDir, 'authorized-obs.txt')
    await fs.writeFile(secretPath, 'SECRET_KEY')
    await fs.writeFile(obsPath, 'OBSERVATION_DATA')

    const { child, stdinStream, stdoutStream } = createMockProcess()
    const mockResolve = vi.fn().mockResolvedValue({ executable: 'C:\\bin\\opencode.exe', prefix: [] })
    const adapter = new OpenCodeAcpAdapter(mockResolve)

    vi.spyOn(processModule, 'launchAgent').mockReturnValueOnce(child)

    let readOutsideObservationResult: any = null
    let readAuthorizedResult: any = null
    let permissionDeniedResult: any = null
    let permissionAllowedResult: any = null

    let promptId: number | null = null

    stdinStream.on('data', (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString().trim())
      if (msg.method === 'initialize') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: 1, agentInfo: { version: '1.18.26' } },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { sessionId: 'ses_d02_test', configOptions: [] },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        promptId = msg.id
        // Attempt reading unauthorized file under cwd
        setTimeout(() => {
          stdoutStream.write(JSON.stringify({
            jsonrpc: '2.0', id: 101, method: 'fs/read_text_file',
            params: { sessionId: 'ses_d02_test', path: secretPath },
          }) + '\n')
        }, 5)
      } else if (msg.id === 101) {
        readOutsideObservationResult = msg.result
        // Attempt reading authorized observation file
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: 102, method: 'fs/read_text_file',
          params: { sessionId: 'ses_d02_test', path: obsPath },
        }) + '\n')
      } else if (msg.id === 102) {
        readAuthorizedResult = msg.result
        // Attempt permission request for unauthorized file
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: 103, method: 'session/request_permission',
          params: {
            sessionId: 'ses_d02_test',
            toolCall: { kind: 'read', locations: [{ path: secretPath }] },
            options: [{ kind: 'allow_once', optionId: 'opt-read-unauthorized' }],
          },
        }) + '\n')
      } else if (msg.id === 103) {
        permissionDeniedResult = msg.result
        // Attempt permission request for authorized file
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: 104, method: 'session/request_permission',
          params: {
            sessionId: 'ses_d02_test',
            toolCall: { kind: 'read', locations: [{ path: obsPath }] },
            options: [{ kind: 'allow_once', optionId: 'opt-read-authorized' }],
          },
        }) + '\n')
      } else if (msg.id === 104) {
        permissionAllowedResult = msg.result
        // finish turn
        stdoutStream.write(JSON.stringify({
          jsonrpc: '2.0', id: promptId,
          result: { stopReason: 'end_turn', usage: {} },
        }) + '\n')
      }
    })

    await adapter.open({ cwd: tmpDir, externalSessionId: null })

    const observationFiles = new Map<string, string>([
      ['obs_1', obsPath],
    ])

    const taskId = randomUUID()
    const runId = randomUUID()
    await adapter.startTurn({
      taskId,
      epoch: 0,
      workspace: { version: 1, projectId: 'p1', normalizedPath: 'c:/lessons/native-test.h5lesson' },
      runId,
      observationId: randomUUID(),
      text: 'Test D-02 authorization',
      imageFileIds: [],
    }, observationFiles)

    for await (const event of adapter.events()) {
      if (event.kind === 'question') {
        expect(event.question.purpose).toBe('permission')
        const delivery = await adapter.input({ version: 1, taskId, epoch: 0, workspace: event.workspace, inputId: randomUUID(),
          kind: 'answer', turnId: event.question.turnId, questionId: event.question.questionId,
          answers: [{ id: event.question.questionId, values: [event.question.questions[0]!.options[0]!] }] })
        expect(delivery.status).toBe('accepted')
      }
    }

    expect(readOutsideObservationResult).toEqual({ content: 'SECRET_KEY' })

    // 2. Authorized observation file should be readable
    expect(readAuthorizedResult).toBeDefined()
    expect(readAuthorizedResult.content).toBe('OBSERVATION_DATA')

    expect(permissionDeniedResult).toEqual({ outcome: { outcome: 'selected', optionId: 'opt-read-unauthorized' } })

    // 4. Permission for authorized observation file should be selected
    expect(permissionAllowedResult).toEqual({ outcome: { outcome: 'selected', optionId: 'opt-read-authorized' } })

    await adapter.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })
})
