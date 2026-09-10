// @vitest-environment node

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalAgentHarness } from '../../src/main/localAgent/harness'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import type { LocalAgentCapabilities, LocalAgentConfiguration } from '../../src/shared/localAgentContract'
import type { LocalAgentCliAdapterV2, LocalAgentNativeEvent } from '../../src/shared/localAgentTaskContract'
import { generationRequestSchema, type GenerationRequest, type GenerationCommitReceipt } from '../../src/shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE, GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE } from '../../src/shared/generationResult'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-native-'))
  directories.push(directory)
  return { directory, workspace: createWorkspaceIdentity('native-project', path.join(directory, 'course.h5lesson')) }
}
function capabilities(configuration: LocalAgentConfiguration = { model: 'default', effort: null }): LocalAgentCapabilities {
  return {
    version: 1, adapter: 'claude', cliVersion: 'fixture',
    models: [
      { id: 'default', resolvedModel: null, label: 'Default', image: 'unknown', effort: { kind: 'unsupported' } },
      { id: 'selected', resolvedModel: 'resolved-selected', label: 'Selected', image: 'supported', effort: { kind: 'supported', values: ['low', 'high'], default: 'low' } },
    ],
    current: { ...configuration, resolvedModel: configuration.model === 'selected' ? 'resolved-selected' : null },
    input: { image: 'supported', readFile: 'supported', question: 'structured', correction: 'active-turn', cancel: 'supported' },
  }
}
class NativeAdapter implements LocalAgentCliAdapterV2 {
  readonly id = 'claude' as const
  confirmedIdentity: string | null = null
  opens: Parameters<LocalAgentCliAdapterV2['open']>[0][] = []
  turns: Parameters<LocalAgentCliAdapterV2['startTurn']>[0][] = []
  configurations: LocalAgentConfiguration[] = []
  requested: LocalAgentConfiguration | undefined
  nativeIdentity = 'native-confirmed-session'
  reply = 'native reply'
  async discoverCapabilities() { return capabilities() }
  getExternalSessionId() { return this.confirmedIdentity }
  async open(input: Parameters<LocalAgentCliAdapterV2['open']>[0]) {
    this.opens.push(input)
    return { externalSessionId: null, capabilities: capabilities() }
  }
  async configure(configuration: LocalAgentConfiguration): Promise<LocalAgentCapabilities> {
    this.configurations.push(configuration)
    this.requested = configuration
    return { ...capabilities(), requestedConfiguration: configuration }
  }
  async startTurn(input: Parameters<LocalAgentCliAdapterV2['startTurn']>[0]) {
    this.turns.push(input)
    return { nativeTurnId: 'native-turn' }
  }
  async input(input: Parameters<LocalAgentCliAdapterV2['input']>[0]): ReturnType<LocalAgentCliAdapterV2['input']> {
    return { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, inputId: input.inputId, turnId: input.turnId, status: 'rejected' as const, reason: 'fixture' }
  }
  async *events(): AsyncIterable<LocalAgentNativeEvent> {
    const input = this.turns.at(-1)!
    const identity = { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, runId: input.runId, nativeTurnId: 'native-turn' }
    this.confirmedIdentity = this.nativeIdentity
    yield { ...identity, kind: 'configuration', capabilities: capabilities(this.requested) }
    yield { ...identity, kind: 'text', phase: 'body', itemId: 'reply', operation: 'replace', text: this.reply }
    yield { ...identity, kind: 'turn-ended', status: 'completed', failure: null }
  }
  async close() {}
}

describe('V2 Harness native lifecycle', () => {
  it('persists an unanswered native question while the event stream is suspended', async () => {
    const { directory, workspace } = await fixture()
    let release!: () => void
    const quiet = new Promise<void>(resolve => { release = resolve })
    const adapter = new NativeAdapter()
    adapter.events = async function* () {
      const input = this.turns.at(-1)!
      const identity = { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, runId: input.runId, nativeTurnId: 'native-turn' }
      yield { ...identity, kind: 'question', question: {
        taskId: input.taskId, epoch: input.epoch, workspace: input.workspace,
        questionId: 'permission-0', turnId: 'native-turn', purpose: 'permission',
        questions: [{ id: 'permission-0', title: 'Read current request?', options: ['Allow once', 'Reject'], multiple: false }],
      } }
      await quiet
    }
    adapter.close = async () => { release() }
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => adapter)
    try {
      const id = await harness.start(workspace, 'claude', 'read the current request')
      await expect.poll(async () => {
        const stored = (await new LocalAgentRepository(directory).list(workspace)).v2.find(record => record.id === id)
        return { status: stored?.tasks.at(-1)?.status, event: stored?.events.at(-1)?.kind }
      }).toEqual({ status: 'waiting-input', event: 'question' })
      expect(harness.running).toBe(true)
    } finally { await harness.close() }
  })

  it('expires an unanswered waiting-input at the original absolute deadline without a commit or renewed budget', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapter = new NativeAdapter(), eventsStarted = deferred<void>(), ask = deferred<void>(), finishEvents = deferred<void>()
    const waitingSaved = deferred<void>(), terminalSaved = deferred<void>()
    const write = repository.write.bind(repository)
    repository.write = async record => {
      await write(record)
      if (record.tasks.at(-1)?.status === 'waiting-input') waitingSaved.resolve()
      if (record.tasks.at(-1)?.status === 'failed') terminalSaved.resolve()
    }
    let closes = 0
    adapter.events = async function* () {
      const input = this.turns.at(-1)!
      const identity = { taskId: input.taskId, epoch: input.epoch, workspace, runId: input.runId, nativeTurnId: 'native-turn' }
      eventsStarted.resolve()
      await ask.promise
      yield { ...identity, kind: 'question', question: { taskId: input.taskId, epoch: input.epoch, workspace,
        questionId: 'deadline-question', turnId: 'native-turn', purpose: 'clarification',
        questions: [{ id: 'title', title: '确认要修改的标题', options: ['当前标题', '全部标题'], multiple: false }] } }
      await finishEvents.promise
    }
    adapter.close = async () => { closes++; finishEvents.resolve() }
    const harness = new LocalAgentHarness(repository, () => adapter)
    const startedAt = Date.now(), deadlineAt = startedAt + 1_000
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(startedAt)
    try {
      const request = generationRequestSchema.parse({ ...generation(workspace), execution: { version: 1, startedAt, deadlineAt } })
      const id = await harness.generate(workspace, 'claude', request)
      await eventsStarted.promise
      await vi.advanceTimersByTimeAsync(600)
      ask.resolve(); await waitingSaved.promise
      const waiting = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(waiting.tasks[0]).toMatchObject({ status: 'waiting-input', execution: { startedAt, deadlineAt, turnCount: 1 } })
      expect(waiting.events.at(-1)).toMatchObject({ kind: 'question', time: startedAt + 600 })
      await vi.advanceTimersByTimeAsync(399)
      expect(harness.running).toBe(true)
      expect(closes).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(closes).toBeGreaterThan(0)
      await terminalSaved.promise
      await harness.close()
      const persisted = (await new LocalAgentRepository(directory).list(workspace)).v2.find(record => record.id === id)!
      expect(persisted.tasks[0]).toMatchObject({ status: 'failed', committedResultIds: [], execution: { startedAt, deadlineAt, turnCount: 1 } })
      expect(persisted.tasks[0]!.completion).toBeUndefined()
      expect(persisted.hostResults).toEqual([])
      expect(persisted.events.filter(event => event.kind === 'input-delivery')).toEqual([])
      expect(persisted.events.filter(event => event.kind === 'turn-ended')).toEqual([
        expect.objectContaining({ status: 'failed', time: deadlineAt, failure: { category: 'limit', message: expect.any(String) } }),
      ])
      await expect(harness.candidate(workspace, id)).rejects.toThrow('尚未成功结束')
      const reopened = new LocalAgentHarness(new LocalAgentRepository(directory), () => new NativeAdapter())
      try {
        const loaded = await reopened.list(workspace), record = loaded.records.find(record => record.id === id)!
        expect(record).toMatchObject({ status: 'failed', task: { status: 'failed', deadlineAt, committedStages: 0 } })
        expect((await reopened.repository.list(workspace)).v2.find(value => value.id === id)).toEqual(persisted)
        await expect(reopened.continue(workspace, id, generation(workspace))).rejects.toThrow('没有可续轮')
      } finally { await reopened.close() }
      expect(adapter.turns).toHaveLength(1)
    } finally { ask.resolve(); finishEvents.resolve(); await harness.close(); vi.useRealTimers() }
  })

  it('persists an identity returned by open before the native model emits any events', async () => {
    const { directory, workspace } = await fixture()
    let release!: () => void
    const quiet = new Promise<void>(resolve => { release = resolve })
    const base = new NativeAdapter()
    const adapter: LocalAgentCliAdapterV2 = {
      id: 'claude',
      async open() { return { externalSessionId: 'confirmed-before-output', capabilities: capabilities() } },
      getExternalSessionId() { return 'confirmed-before-output' },
      configure: input => base.configure(input),
      startTurn: input => base.startTurn(input),
      input: input => base.input(input),
      async *events() { await quiet },
      async close() { release() },
    }
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => adapter)
    try {
      const id = await harness.start(workspace, 'claude', 'wait for native output')
      await expect.poll(async () => (await new LocalAgentRepository(directory).list(workspace)).v2.find(record => record.id === id)?.externalSessionId)
        .toBe('confirmed-before-output')
      expect(harness.running).toBe(true)
      expect((await new LocalAgentRepository(directory).list(workspace)).v2.find(record => record.id === id)?.events).toEqual([])
    } finally { await harness.close() }
  })

  it('persists the first native-confirmed identity and resumes it after reopening the repository', async () => {
    const { directory, workspace } = await fixture()
    const first = new NativeAdapter()
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => first)
    const id = await harness.start(workspace, 'claude', 'remember this')
    await expect.poll(() => harness.running).toBe(false)
    const stored = (await new LocalAgentRepository(directory).list(workspace)).v2.find(record => record.id === id)!
    expect(stored.externalSessionId).toBe('native-confirmed-session')
    expect(stored.events.at(-1)).toMatchObject({ kind: 'turn-ended', nativeTurnId: 'native-turn' })
    expect(new Set(stored.events.map(event => event.nativeTurnId))).toEqual(new Set(['native-turn']))
    expect(stored.events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })

    const second = new NativeAdapter()
    const reopened = new LocalAgentHarness(new LocalAgentRepository(directory), () => second)
    const resumed = await reopened.resume(workspace, id, 'continue')
    await expect.poll(() => reopened.running).toBe(false)
    expect(second.opens[0]).toMatchObject({ externalSessionId: 'native-confirmed-session', cwd: first.opens[0]!.cwd })
    expect((await reopened.list(workspace)).records.find(record => record.id === resumed)?.status).toBe('completed')
  })

  it('fails a resumed run when the native process confirms a different session', async () => {
    const { directory, workspace } = await fixture()
    let first = true
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => {
      const adapter = new NativeAdapter()
      if (!first) adapter.nativeIdentity = 'wrong-session'
      first = false
      return adapter
    })
    const id = await harness.start(workspace, 'claude', 'hello')
    await expect.poll(() => harness.running).toBe(false)
    const next = await harness.resume(workspace, id, 'continue')
    await expect.poll(() => harness.running).toBe(false)
    const record = (await harness.list(workspace)).records.find(record => record.id === next)!
    expect(record.status).toBe('failed')
    expect(record.externalSessionId).toBeUndefined()
    expect(record.events.some(event => event.kind === 'completed')).toBe(false)
  })

  it('keeps a preference pending, applies it before both initial and resumed turns, and waits for native confirmation', async () => {
    const { directory, workspace } = await fixture()
    const adapters: NativeAdapter[] = []
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => {
      const adapter = new NativeAdapter(); adapters.push(adapter); return adapter
    })
    const preference = { model: 'selected', effort: 'high' }
    const selected = await harness.configure('claude', preference, workspace)
    expect(selected.current.model).toBe('default')
    expect(selected.requestedConfiguration).toEqual(preference)
    const id = await harness.start(workspace, 'claude', 'hello')
    await expect.poll(() => harness.running).toBe(false)
    expect(adapters[1]!.configurations).toEqual([preference])
    expect(adapters[1]!.turns).toHaveLength(1)
    expect(await harness.capabilities('claude', { workspace })).toMatchObject({ current: { model: 'selected', effort: 'high' }, requestedConfiguration: null })
    await harness.resume(workspace, id, 'continue')
    await expect.poll(() => harness.running).toBe(false)
    expect(adapters[2]!.configurations).toEqual([preference])
  })

  it('does not start a user turn when the native adapter rejects the requested configuration', async () => {
    const { directory, workspace } = await fixture()
    const adapter = new NativeAdapter()
    adapter.configure = async () => capabilities()
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => adapter)
    await harness.configure('claude', { model: 'selected', effort: 'high' })
    const id = await harness.start(workspace, 'claude', 'hello')
    await expect.poll(() => harness.running).toBe(false)
    expect(adapter.turns).toHaveLength(0)
    expect((await harness.list(workspace)).records.find(record => record.id === id)?.status).toBe('failed')
    const failure = (await new LocalAgentRepository(directory).list(workspace)).v2.find(record => record.id === id)?.events.at(-1)
    expect(failure).toMatchObject({ kind: 'turn-ended', failure: { message: 'CLI 未完成（应用模型配置）：原生CLI没有接受所选模型配置' } })
    expect((await harness.capabilities('claude')).current.model).toBe('default')
  })

  it('discovers an OpenCode model effort directory without a model turn and preserves an explicit max preference', async () => {
    const { directory, workspace } = await fixture()
    const initial = (): LocalAgentCapabilities => ({ ...capabilities(), adapter: 'opencode',
      models: capabilities().models.map(model => model.id === 'selected' ? { ...model, effort: { kind: 'unknown' } } : model) })
    const selected = (effort: string): LocalAgentCapabilities => ({ ...initial(),
      models: initial().models.map(model => model.id === 'selected'
        ? { ...model, effort: { kind: 'supported', values: ['none', 'low', 'max'], default: 'none' } } : model),
      current: { model: 'selected', resolvedModel: null, effort } })
    const calls: Array<{ configurations: LocalAgentConfiguration[]; turns: number; closed: boolean }> = []
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => {
      const call = { configurations: [] as LocalAgentConfiguration[], turns: 0, closed: false }; calls.push(call)
      let current = initial(), turn: Parameters<LocalAgentCliAdapterV2['startTurn']>[0]
      return {
        id: 'opencode', discoverCapabilities: async () => initial(),
        getExternalSessionId: () => 'native-effort-session',
        open: async () => ({ externalSessionId: 'native-effort-session', capabilities: current }),
        configure: async configuration => { call.configurations.push(configuration); current = selected(configuration.effort ?? 'none'); return current },
        startTurn: async input => { call.turns++; turn = input; return { nativeTurnId: 'effort-turn' } },
        input: async input => ({ taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, inputId: input.inputId, turnId: input.turnId, status: 'rejected', reason: 'fixture' }),
        async *events() {
          const identity = { taskId: turn.taskId, epoch: turn.epoch, workspace: turn.workspace, runId: turn.runId, nativeTurnId: 'effort-turn' }
          yield { ...identity, kind: 'configuration', capabilities: current } as LocalAgentNativeEvent
          yield { ...identity, kind: 'text', phase: 'body', itemId: 'reply', operation: 'replace', text: 'hello' } as LocalAgentNativeEvent
          yield { ...identity, kind: 'turn-ended', status: 'completed', failure: null } as LocalAgentNativeEvent
        },
        close: async () => { call.closed = true },
      }
    })
    const pending = await harness.configure('opencode', { model: 'selected', effort: 'max' }, workspace)
    expect(pending.current).toMatchObject({ model: 'default', effort: null })
    expect(pending.requestedConfiguration).toEqual({ model: 'selected', effort: 'max' })
    expect(pending.models.find(model => model.id === 'selected')?.effort).toEqual({ kind: 'supported', values: ['none', 'low', 'max'], default: 'none' })
    expect(calls).toEqual([{ configurations: [], turns: 0, closed: true },
      { configurations: [{ model: 'selected', effort: null }], turns: 0, closed: true }])
    const id = await harness.start(workspace, 'opencode', 'hello')
    await expect.poll(() => harness.running).toBe(false)
    expect(calls[2]?.configurations).toEqual([{ model: 'selected', effort: 'max' }])
    expect((await harness.capabilities('opencode', { workspace })).current).toMatchObject({ model: 'selected', effort: 'max' })
    expect((await harness.list(workspace)).records.find(record => record.id === id)?.status).toBe('completed')
    const resumed = await harness.resume(workspace, id, 'continue')
    await expect.poll(() => harness.running).toBe(false)
    expect(calls[3]?.configurations).toEqual([{ model: 'selected', effort: 'max' }])
    expect((await harness.list(workspace)).records.find(record => record.id === resumed)?.status).toBe('completed')
    await harness.close()
  })

  it('keeps native default effort visible while rejecting unsupported explicit overrides', async () => {
    const { directory, workspace } = await fixture()
    const adapter = new NativeAdapter()
    adapter.configure = async configuration => { adapter.requested = { ...configuration, effort: configuration.effort ?? 'low' }; return capabilities(adapter.requested) }
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => adapter)
    await expect(harness.configure('claude', { model: 'default', effort: 'max' })).rejects.toThrow('不支持强度')
    await expect(harness.configure('claude', { model: 'selected', effort: 'max' })).rejects.toThrow('原生目录')
    await harness.configure('claude', { model: 'selected', effort: null })
    const id = await harness.start(workspace, 'claude', 'hello')
    await expect.poll(() => harness.running).toBe(false)
    expect((await harness.capabilities('claude', { workspace })).current).toMatchObject({ model: 'selected', effort: 'low' })
    expect((await harness.list(workspace)).records.find(record => record.id === id)?.status).toBe('completed')
    await harness.close()
  })

  it('cancels while native open is pending, starts no late turn and releases the running slot', async () => {
    const { directory, workspace } = await fixture()
    const adapter = new NativeAdapter()
    let rejectOpen: ((error: Error) => void) | undefined
    adapter.open = () => new Promise((_resolve, reject) => { rejectOpen = reject })
    adapter.close = async () => { rejectOpen?.(new Error('transport closed')) }
    let first = true
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => {
      if (first) { first = false; return adapter }
      return new NativeAdapter()
    })
    const id = await harness.start(workspace, 'claude', 'hello')
    await harness.cancel(workspace, id)
    expect(harness.running).toBe(false)
    expect(adapter.turns).toHaveLength(0)
    const cancelled = (await harness.list(workspace)).records.find(record => record.id === id)!
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.events.filter(event => ['completed', 'failed', 'cancelled'].includes(event.kind))).toHaveLength(1)
    const next = await harness.start(workspace, 'claude', 'try again')
    await expect.poll(() => harness.running).toBe(false)
    expect((await harness.list(workspace)).records.find(record => record.id === next)?.status).toBe('completed')
  })
})

function generation(workspace: Awaited<ReturnType<typeof fixture>>['workspace'], revision = 1): GenerationRequest {
  return generationRequestSchema.parse({ version: 1, requestId: randomUUID(), workspace, documentRevision: revision, sessionGeneration: 1,
    purpose: 'local-edit', expectedResult: 'auto', intent: 'edit', applyPolicy: 'preview', instruction: '分两阶段修改标题', allowedCarriers: ['native'], context: {},
    destinations: [{ kind: 'update', target: { projectId: workspace.projectId, documentRevision: revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
      surfaceType: 'slide', surfaceId: 'slides', locationId: 'page', stateId: null, owner: 'scene', ownerKey: 'scene:page', itemId: 'title', authoringAddress: 'page/title' } }],
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

const candidatePng = path.resolve(__dirname, '../../examples/sample-counter-component/thumbnail.png')
function fileCandidateRequest(workspace: Awaited<ReturnType<typeof fixture>>['workspace']) {
  const request = generation(workspace), target = request.destinations[0]!
  if (target.kind !== 'update') throw new Error('Expected fixture update target')
  const { itemId: _itemId, authoringAddress: _address, ...scope } = target.target
  return generationRequestSchema.parse({ ...request, destinations: [{ kind: 'create', scope: {
    ...scope, owner: 'global', ownerKey: 'global', parent: { kind: 'owner' }, insertion: { kind: 'append' },
  } }] })
}

// This native-tool fixture reads real PNG bytes and serializes them on disk.
// It deliberately never copies the payload through assistant text events.
function writeNativeFileCandidate(root: string) {
  execFileSync(process.execPath, ['-e', `
    const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
    const root = process.argv[1], request = JSON.parse(fs.readFileSync(path.join(root, 'request.json'), 'utf8'));
    const candidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: 'Imported fallback image',
      steps: [{ id: 'fallback-image', tool: 'asset.media.import', carrier: 'native', destination: request.destinations[0],
        input: { kind: 'image', filename: 'fallback.png', mimeType: 'image/png', base64: fs.readFileSync(process.argv[2]).toString('base64') } }] };
    fs.writeFileSync(path.join(root, 'candidate.json'), JSON.stringify(candidate));
  `, root, candidatePng], { windowsHide: true })
}

class FileNativeAdapter extends NativeAdapter {
  candidateText: string | null = null
  constructor(private readonly write: (root: string) => Promise<void> | void) { super(); this.reply = '候选已写入文件，等待宿主检查。' }
  override async *events(): AsyncIterable<LocalAgentNativeEvent> {
    const root = this.opens.at(-1)?.candidateRoot
    if (!root) throw new Error('Claude native adapter must receive the current request candidate root')
    await this.write(root)
    try { this.candidateText = await fs.readFile(path.join(root, 'candidate.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    yield* super.events()
  }
}

describe('Claude native candidate file delivery', () => {
  it('delivers the native-script PNG bytes exactly and awaits a host receipt without committing or completing the task', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const request = fileCandidateRequest(workspace), adapter = new FileNativeAdapter(writeNativeFileCandidate)
    const harness = new LocalAgentHarness(repository, () => adapter)
    const projectBytes = Buffer.from('untouched live project sentinel')
    await fs.writeFile(workspace.normalizedPath, projectBytes)
    const id = await harness.generate(workspace, 'claude', request)
    try {
      await expect.poll(() => harness.running).toBe(false)
      const result = await harness.candidate(workspace, id)
      if (result.kind !== 'candidate') throw new Error(`Expected file candidate, got ${result.kind}`)
      const png = await fs.readFile(candidatePng), input = result.candidate.steps[0]!.input as { base64: string }
      expect(input.base64.length).toBeGreaterThan(16_000)
      expect(Buffer.from(input.base64, 'base64')).toEqual(png)
      const stored = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(stored.tasks.at(-1)).toMatchObject({ status: 'checking', committedResultIds: [] })
      expect(stored.hostResults).toEqual([])
      expect(await fs.readFile(workspace.normalizedPath)).toEqual(projectBytes)
      const fileText = stored.events.filter(event => event.kind === 'text' && event.itemId === `candidate-file:${request.requestId}`)
      expect(fileText).toHaveLength(1)
      const candidate = adapter.candidateText
      expect(candidate).not.toBeNull()
      expect(fileText[0]).toMatchObject({ text: `${GENERATION_OPEN}${candidate}${GENERATION_CLOSE}` })
      expect(adapter.reply).not.toContain(input.base64)
    } finally { await harness.close() }
  })

  it('does not ingest a native-script file written after Stop', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const waiting = deferred<void>(), release = deferred<void>(), closed = deferred<void>()
    const adapter = new FileNativeAdapter(async root => { waiting.resolve(); await release.promise; writeNativeFileCandidate(root) })
    adapter.close = async () => { closed.resolve() }
    const harness = new LocalAgentHarness(repository, () => adapter), request = fileCandidateRequest(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    try {
      await waiting.promise
      const stopping = harness.cancel(workspace, id)
      await closed.promise
      release.resolve(); await stopping
      expect(adapter.candidateText!.length).toBeGreaterThan(16_000)
      const stored = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(stored.tasks.at(-1)).toMatchObject({ status: 'cancelled', committedResultIds: [] })
      expect(stored.hostResults).toEqual([])
      expect(stored.events.some(event => event.kind === 'text' && event.itemId?.startsWith('candidate-file:'))).toBe(false)
      await expect(harness.candidate(workspace, id)).rejects.toThrow('尚未成功结束')
    } finally { release.resolve(); await harness.close() }
  })

  it('keeps a new request plain reply natural instead of reusing the previous request file', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const first = new FileNativeAdapter(writeNativeFileCandidate)
    const second = new FileNativeAdapter(async root => {
      const oldRoot = first.opens[0]!.candidateRoot!
      expect(root).not.toBe(oldRoot)
      // A native tool finishes a stale write while the new request is active.
      // Its bytes are real, but only the new request root is eligible for intake.
      await fs.mkdir(oldRoot, { recursive: true })
      await fs.writeFile(path.join(oldRoot, 'candidate.json'), first.candidateText!)
    })
    second.reply = '当前无法完成修改，需要核对素材。'
    const adapters = [first, second]
    let created = 0
    const harness = new LocalAgentHarness(repository, () => adapters[created++]!)
    const request = fileCandidateRequest(workspace), id = await harness.generate(workspace, 'claude', request)
    try {
      await expect.poll(() => harness.running).toBe(false)
      const candidate = await harness.candidate(workspace, id)
      if (candidate.kind !== 'candidate') throw new Error('Expected current file candidate')
      await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: candidate.candidate.candidateId, status: 'rejected', summary: '检查后备素材' })
      const next = fileCandidateRequest(workspace)
      await harness.continue(workspace, id, next)
      await expect.poll(() => harness.running).toBe(false)
      expect(second.opens[0]!.candidateRoot).not.toBe(first.opens[0]!.candidateRoot)
      expect(second.opens[0]!.externalSessionId).toBe(first.nativeIdentity)
      expect((await fs.readFile(path.join(first.opens[0]!.candidateRoot!, 'candidate.json'))).length).toBeGreaterThan(16_000)
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'incomplete', requestId: next.requestId })
      const stored = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(stored.events.some(event => event.kind === 'text' && event.text === second.reply)).toBe(true)
      expect(stored.events.some(event => event.kind === 'text' && event.itemId === `candidate-file:${next.requestId}`)).toBe(false)
      expect(stored.tasks.at(-1)!.committedResultIds).toEqual([])
      expect(second.turns).toHaveLength(1)
    } finally { await harness.close() }
  })
})

class InputBoundaryAdapter extends NativeAdapter {
  readonly firstEvents = deferred<void>()
  readonly finishFirst = deferred<void>()
  readonly firstDrained = deferred<void>()
  readonly inputStarted = deferred<void>()
  readonly inputAck = deferred<void>()
  readonly secondStarted = deferred<void>()
  readonly secondAck = deferred<void>()
  readonly candidateIds = [randomUUID(), randomUUID()]
  constructor(private readonly request: GenerationRequest) { super() }
  override async startTurn(input: Parameters<LocalAgentCliAdapterV2['startTurn']>[0]) {
    this.turns.push(input)
    if (this.turns.length === 2) {
      this.secondStarted.resolve()
      await this.secondAck.promise
    }
    return { nativeTurnId: `native-turn-${this.turns.length}` }
  }
  override async input(input: Parameters<LocalAgentCliAdapterV2['input']>[0]) {
    this.inputStarted.resolve()
    await this.inputAck.promise
    return { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, inputId: input.inputId,
      turnId: input.turnId, status: 'queued' as const, reason: null }
  }
  override async *events(): AsyncIterable<LocalAgentNativeEvent> {
    const index = this.turns.length - 1
    const input = this.turns[index]!
    const identity = { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, runId: input.runId,
      nativeTurnId: `native-turn-${index + 1}` }
    this.confirmedIdentity = this.nativeIdentity
    yield { ...identity, kind: 'configuration', capabilities: capabilities() }
    const candidate = { version: 1, requestId: this.request.requestId, candidateId: this.candidateIds[index], summary: `阶段 ${index + 1}`,
      steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination: this.request.destinations[0],
        input: { operation: 'properties', properties: { label: `阶段 ${index + 1}` } } }] }
    yield { ...identity, kind: 'text', phase: 'body', itemId: 'candidate', operation: 'replace',
      text: `${GENERATION_OPEN}${JSON.stringify(candidate)}${GENERATION_CLOSE}` }
    if (index === 0) {
      this.firstEvents.resolve()
      await this.finishFirst.promise
    }
    yield { ...identity, kind: 'turn-ended', status: 'completed', failure: null }
    if (index === 0) this.firstDrained.resolve()
  }
  override async close() {
    this.finishFirst.resolve()
    this.secondAck.resolve()
  }
}

async function inputBoundaryFixture() {
  const { directory, workspace } = await fixture()
  const repository = new LocalAgentRepository(directory)
  const request = generation(workspace)
  const adapter = new InputBoundaryAdapter(request)
  const harness = new LocalAgentHarness(repository, () => adapter)
  const id = await harness.generate(workspace, 'claude', request)
  await adapter.firstEvents.promise
  const turn = adapter.turns[0]!
  const input = { version: 1 as const, taskId: turn.taskId, epoch: turn.epoch, workspace, inputId: randomUUID(),
    turnId: 'native-turn-1', kind: 'correct' as const, text: '标题改为新的补充要求' }
  return { repository, workspace, request, adapter, harness, id, input }
}

describe('native input turn boundaries', () => {
  it('does not mark a live turn interrupted when it finishes while an older session is being cleaned up', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    const request = generation(workspace)
    const adapter = new InputBoundaryAdapter(request)
    let first = true
    const harness = new LocalAgentHarness(repository, () => { if (first) { first = false; return new NativeAdapter() }; return adapter })
    const previousId = await harness.generate(workspace, 'claude', generation(workspace))
    await expect.poll(() => harness.running).toBe(false)
    const id = await harness.generate(workspace, 'claude', request)
    await adapter.firstEvents.promise
    const isLegacy = repository.isLegacy.bind(repository)
    let interleaved = false
    repository.isLegacy = async (owner, sessionId) => {
      if (sessionId === previousId && !interleaved) {
        interleaved = true
        adapter.finishFirst.resolve()
        await expect.poll(() => harness.running).toBe(false)
      }
      return isLegacy(owner, sessionId)
    }
    try {
      await harness.list(workspace)
      expect(interleaved).toBe(true)
      const record = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(record.events.filter(event => event.kind === 'turn-ended')).toEqual([expect.objectContaining({ status: 'completed' })])
      expect(record.tasks.at(-1)?.status).toBe('checking')
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'candidate', candidate: { candidateId: adapter.candidateIds[0] } })
    } finally { await harness.close() }
  })

  it('waits for a late input ACK after EOF and consumes it only after the next native start ACK', async () => {
    const { repository, workspace, adapter, harness, id, input } = await inputBoundaryFixture()
    try {
      const delivery = harness.input(workspace, id, input)
      await adapter.inputStarted.promise
      adapter.finishFirst.resolve()
      await adapter.firstDrained.promise
      expect(adapter.turns).toHaveLength(1)
      expect(harness.running).toBe(true)
      adapter.inputAck.resolve()
      await expect(delivery).resolves.toMatchObject({ status: 'queued' })
      await adapter.secondStarted.promise
      const waiting = (await repository.list(workspace)).v2[0]!
      expect(waiting.tasks[0]!.pendingInputs).toEqual([{ inputId: input.inputId, kind: input.kind, text: input.text }])
      expect(waiting.events.filter(event => event.kind === 'input-delivery').map(event => event.delivery.status)).toEqual(['queued'])
      expect(adapter.opens).toHaveLength(1)
      expect(adapter.turns[1]).toMatchObject({ taskId: adapter.turns[0]!.taskId, epoch: adapter.turns[0]!.epoch,
        observationId: adapter.turns[0]!.observationId, workspace })
      expect(adapter.turns[1]!.runId).not.toBe(adapter.turns[0]!.runId)
      expect(adapter.turns[1]!.text).toContain(input.text)
      adapter.secondAck.resolve()
      await expect.poll(() => harness.running).toBe(false)
      const finished = (await repository.list(workspace)).v2[0]!
      expect(finished.externalSessionId).toBe('native-confirmed-session')
      expect(finished.tasks[0]!.pendingInputs).toEqual([])
      expect(finished.tasks[0]!.execution!.deadlineAt).toBe(waiting.tasks[0]!.execution!.deadlineAt)
      expect(finished.events.filter(event => event.kind === 'input-delivery').map(event => event.delivery.status)).toEqual(['queued', 'consumed'])
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'candidate', candidate: { candidateId: adapter.candidateIds[1] } })
    } finally { adapter.inputAck.resolve(); await harness.close() }
  })

  it('keeps queued input unconsumed when the next native turn fails to start', async () => {
    const { repository, workspace, adapter, harness, id, input } = await inputBoundaryFixture()
    try {
      const delivery = harness.input(workspace, id, input)
      await adapter.inputStarted.promise
      adapter.inputAck.resolve()
      await delivery
      adapter.finishFirst.resolve()
      await adapter.secondStarted.promise
      adapter.secondAck.reject(new Error('native start failed'))
      await expect.poll(() => harness.running).toBe(false)
      const failed = (await repository.list(workspace)).v2[0]!
      expect(failed.tasks[0]!.status).toBe('failed')
      expect(failed.tasks[0]!.pendingInputs).toEqual([{ inputId: input.inputId, kind: input.kind, text: input.text }])
      expect(failed.events.filter(event => event.kind === 'input-delivery').map(event => event.delivery.status)).toEqual(['queued'])
      await expect(harness.candidate(workspace, id)).rejects.toThrow('尚未成功结束')
    } finally { adapter.inputAck.resolve(); await harness.close() }
  })

  it.each(['input-ack', 'next-start-ack'] as const)('ignores a late %s after Stop', async phase => {
    const { repository, workspace, adapter, harness, id, input } = await inputBoundaryFixture()
    try {
      const delivery = harness.input(workspace, id, input)
      const outcome = delivery.then(value => ({ value }), error => ({ error: error as Error }))
      await adapter.inputStarted.promise
      if (phase === 'next-start-ack') {
        adapter.inputAck.resolve()
        await delivery
        adapter.finishFirst.resolve()
        await adapter.secondStarted.promise
      }
      await harness.cancel(workspace, id)
      adapter.inputAck.resolve()
      const returned = await outcome
      if (phase === 'input-ack') expect(returned).toMatchObject({ error: { message: '输入返回时任务已停止' } })
      const stopped = (await repository.list(workspace)).v2[0]!
      expect(stopped.tasks[0]!.status).toBe('cancelled')
      expect(stopped.events.filter(event => event.kind === 'input-delivery').map(event => event.delivery.status))
        .toEqual(phase === 'input-ack' ? [] : ['queued'])
      expect(stopped.events.filter(event => event.kind === 'turn-ended' && event.status === 'cancelled')).toHaveLength(1)
      expect(stopped.events.filter(event => event.kind === 'turn-ended' && event.status === 'failed')).toHaveLength(0)
      expect(stopped.tasks[0]!.pendingInputs).toEqual([])
      expect(adapter.turns).toHaveLength(phase === 'input-ack' ? 1 : 2)
      await expect(harness.candidate(workspace, id)).rejects.toThrow('尚未成功结束')
    } finally { adapter.inputAck.resolve(); await harness.close() }
  })
})

describe('same native task host feedback', () => {
  it.each(['delivered', 'missing'] as const)('allows one repair for a missing candidate declared by an edit marker, then handles %s delivery', async delivery => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapters: FileNativeAdapter[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const correction = adapters.length > 0
      const adapter = new FileNativeAdapter(async root => {
        if (!correction || delivery === 'missing') return
        const staged = JSON.parse(await fs.readFile(path.join(root, 'request.json'), 'utf8'))
        await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify({ version: 2, requestId: staged.requestId,
          summary: '修正候选交付', afterCommit: { version: 1, action: 'finish' },
          steps: [{ id: 'title', tool: 'native.content', destination: 'd1', input: { operation: 'edit', text: '修改后' } }] }))
      })
      adapter.reply = `已生成候选，等待宿主检查。${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, kind: 'edit' })}${GENERATION_RESULT_CLOSE}`
      adapters.push(adapter)
      return adapter
    })
    let request = generation(workspace)
    try {
      const id = await harness.generate(workspace, 'claude', request)
      await expect.poll(() => harness.running).toBe(false)
      const missing = await harness.candidate(workspace, id)
      if (missing.kind !== 'candidate-format-error') throw new Error('Expected a missing candidate delivery diagnosis')
      expect(missing.failure).toMatchObject({ stage: 'candidate-parse', requestId: request.requestId })
      await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: missing.finding, failure: missing.failure })
      const before = (await repository.list(workspace)).v2[0]!
      expect(before.tasks[0]!.execution!.formatRepairs).toBe(1)
      expect(before.hostResults.flatMap(result => result.receipts)).toEqual([])
      request = generation(workspace)
      await harness.continue(workspace, id, request)
      await expect.poll(() => harness.running).toBe(false)
      const corrected = await harness.candidate(workspace, id)
      expect(adapters[1]!.opens[0]!.externalSessionId).toBe(adapters[0]!.nativeIdentity)
      expect(adapters[1]!.opens[0]!.candidateRoot).not.toBe(adapters[0]!.opens[0]!.candidateRoot)
      const current = (await repository.list(workspace)).v2[0]!
      expect(current.tasks[0]!.taskId).toBe(before.tasks[0]!.taskId)
      expect(current.tasks[0]!.execution!.deadlineAt).toBe(before.tasks[0]!.execution!.deadlineAt)
      expect(current.tasks[0]!.execution!.turnCount).toBe(2)
      if (delivery === 'delivered') {
        expect(corrected).toMatchObject({ kind: 'candidate', requestId: request.requestId })
        expect(current.tasks[0]!.execution!.formatRepairs).toBe(1)
      } else {
        if (corrected.kind !== 'candidate-format-error') throw new Error('Expected another missing candidate diagnosis')
        await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: corrected.finding, failure: corrected.failure })
        expect((await repository.list(workspace)).v2[0]!.tasks[0]!.execution!.formatRepairs).toBe(2)
        await expect(harness.continue(workspace, id, generation(workspace))).rejects.toThrow('预算已到或连续两轮没有进展')
        expect(adapters).toHaveLength(2)
      }
    } finally { await harness.close() }
  })

  it('keeps relative edits as one applied goal and permits completion on the actual feedback channel', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory), adapters: NativeAdapter[] = [], requests: GenerationRequest[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      requests.push(request!)
      const adapter = new NativeAdapter()
      adapter.reply = adapters.length ? '已核对字号调整回执，原目标已经完成，不再累计放大。'
        : `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, candidateId: randomUUID(), summary: '字号40调整为48',
          steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination: request!.destinations[0], input: {} }] })}${GENERATION_CLOSE}`
      adapters.push(adapter)
      return adapter
    })
    const request = { ...generation(workspace), expectedResult: 'candidate' as const, instruction: '把这个标题再放大一点。' }
    const id = await harness.generate(workspace, 'claude', request)
    try {
      await expect.poll(() => harness.running).toBe(false)
      expect(adapters[0]!.turns[0]!.text).toContain('本轮要求修改，须交付候选')
      const result = await harness.candidate(workspace, id)
      if (result.kind !== 'candidate') throw new Error('Expected one initial candidate')
      const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: request.requestId, candidateId: result.candidate.candidateId,
        status: 'committed', beforeRevision: 1, afterRevision: 2, affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }
      await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: receipt.candidateId,
        status: 'committed', beforeRevision: 1, afterRevision: 2, summary: '字号已由40放大到48' }, receipt)
      const next = { ...generation(workspace, 2), expectedResult: 'candidate' as const, instruction: request.instruction }
      await harness.continue(workspace, id, next)
      await expect.poll(() => harness.running).toBe(false)
      expect(requests[1]).toMatchObject({ expectedResult: 'auto', intent: 'edit', instruction: request.instruction, destinations: next.destinations })
      const prompt = adapters[1]!.turns[0]!.text
      expect(prompt).toContain('不是重新执行原请求')
      expect(prompt).toContain('相对修改不得因收到新观察再次累计执行')
      expect(prompt).not.toContain('本轮要求修改，须交付候选')
      expect(await harness.candidate(workspace, id)).toEqual({ kind: 'answer', requestId: next.requestId })
      const finished = (await repository.list(workspace)).v2[0]!
      expect(finished.tasks.at(-1)?.status).toBe('completed')
      expect(finished.hostResults).toHaveLength(1)
    } finally { await harness.close() }
  })

  it('repairs a semantic destination error after one format repair without admitting it or spending a second format repair', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    const adapters: NativeAdapter[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter(), stage = adapters.length
      const destination = structuredClone(request!.destinations[0]!)
      if (stage === 1 && destination.kind === 'update') destination.target.authoringAddress = 'page/tile'
      adapter.reply = stage === 0 ? `${GENERATION_OPEN}{broken}${GENERATION_CLOSE}` : stage === 3 ? '已修改并完成。'
        : `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, candidateId: randomUUID(), summary: '修改标题',
          steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination, input: { label: '修改后' } }] })}${GENERATION_CLOSE}`
      adapters.push(adapter)
      return adapter
    })
    let request = generation(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    try {
      await expect.poll(() => harness.running).toBe(false)
      const malformed = await harness.candidate(workspace, id)
      if (malformed.kind !== 'candidate-format-error') throw new Error('Expected format error')
      await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: malformed.finding })
      request = generation(workspace)
      await harness.continue(workspace, id, request)
      await expect.poll(() => harness.running).toBe(false)
      const rejected = await harness.candidate(workspace, id)
      if (rejected.kind !== 'candidate-rejected') throw new Error('Expected semantic rejection')
      expect(rejected.finding).toContain('scope-mismatch')
      const fakeReceipt: GenerationCommitReceipt = { version: 1, workspace, requestId: request.requestId, candidateId: rejected.candidateId,
        status: 'committed', beforeRevision: 1, afterRevision: 2, affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }
      await expect(harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: rejected.candidateId, status: 'committed', summary: 'cannot admit rejected proposal' }, fakeReceipt)).rejects.toThrow('通过身份与范围校验')
      await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: rejected.candidateId, status: 'rejected', summary: rejected.finding })
      const failedStage = (await repository.list(workspace)).v2[0]!
      expect(failedStage.tasks[0]!.execution).toMatchObject({ formatRepairs: 1, stagnantCandidates: 0 })
      expect(failedStage.hostResults.map(result => result.status)).toEqual(['rejected', 'rejected'])
      expect(failedStage.hostResults.flatMap(result => result.receipts)).toEqual([])
      request = generation(workspace)
      await harness.continue(workspace, id, request)
      await expect.poll(() => harness.running).toBe(false)
      expect(adapters[2]!.turns[0]!.text).toContain(rejected.finding)
      expect(adapters[2]!.opens[0]!.externalSessionId).toBe(adapters[0]!.nativeIdentity)
      const accepted = await harness.candidate(workspace, id)
      if (accepted.kind !== 'candidate') throw new Error('Expected corrected candidate')
      const receipt = { ...fakeReceipt, requestId: request.requestId, candidateId: accepted.candidate.candidateId }
      await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: receipt.candidateId, status: 'committed', beforeRevision: 1, afterRevision: 2, summary: '已提交' }, receipt)
      request = generation(workspace, 2)
      await harness.continue(workspace, id, request)
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, id)).toEqual({ kind: 'answer', requestId: request.requestId })
      const finished = (await repository.list(workspace)).v2[0]!
      expect(finished.tasks[0]!.status).toBe('completed')
      expect(finished.tasks[0]!.execution).toMatchObject({ turnCount: 4, formatRepairs: 1 })
      expect(finished.hostResults.filter(result => result.status === 'committed')).toHaveLength(1)
    } finally { await harness.close() }
  })

  it('stops repeated rejected destinations even when candidate IDs and diagnostic summaries change', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter(), destination = structuredClone(request!.destinations[0]!)
      if (destination.kind === 'update') destination.target.authoringAddress = 'page/tile'
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, candidateId: randomUUID(), summary: `修改标题 ${randomUUID()}`,
        steps: [{ id: randomUUID(), tool: 'native.content', carrier: 'native', destination, input: { label: '修改后' } }] })}${GENERATION_CLOSE}`
      return adapter
    })
    let request = generation(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    try {
      for (let index = 0; index < 3; index++) {
        await expect.poll(() => harness.running).toBe(false)
        const rejected = await harness.candidate(workspace, id)
        if (rejected.kind !== 'candidate-rejected') throw new Error('Expected semantic rejection')
        await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: rejected.candidateId, status: 'rejected', summary: `${rejected.finding} 第${index + 1}次说明` })
        if (index < 2) { request = generation(workspace); await harness.continue(workspace, id, request) }
      }
      expect((await repository.list(workspace)).v2[0]!.tasks[0]!.execution).toMatchObject({ formatRepairs: 0, stagnantCandidates: 2 })
      await expect(harness.continue(workspace, id, generation(workspace))).rejects.toThrow('连续两轮没有进展')
    } finally { await harness.close() }
  })

  it('accepts an edit answer after the current task received a formal unchanged receipt', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    let turns = 0
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      adapter.reply = turns++ ? '当前效果已满足要求，无需再次修改。'
        : `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, candidateId: randomUUID(), summary: '确认当前标题',
          steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination: request!.destinations[0], input: {} }] })}${GENERATION_CLOSE}`
      return adapter
    })
    const request = generation(workspace), id = await harness.generate(workspace, 'claude', request)
    try {
      await expect.poll(() => harness.running).toBe(false)
      const result = await harness.candidate(workspace, id)
      if (result.kind !== 'candidate') throw new Error('Expected candidate')
      const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: request.requestId, candidateId: result.candidate.candidateId,
        status: 'unchanged', beforeRevision: 1, afterRevision: 1, affected: [], resources: { assetIds: [], packageIds: [] } }
      await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: receipt.candidateId, status: 'unchanged', beforeRevision: 1, afterRevision: 1, summary: '正式命令确认无需修改' }, receipt)
      const next = generation(workspace)
      await harness.continue(workspace, id, next)
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, id)).toEqual({ kind: 'answer', requestId: next.requestId })
      const stored = (await repository.list(workspace)).v2[0]!
      expect(stored.tasks[0]!.status).toBe('completed')
      expect(stored.tasks[0]!.committedResultIds).toHaveLength(0)
      expect(stored.hostResults[0]!.receipts).toEqual([receipt])
    } finally { await harness.close() }
  })

  it.each(['edit', 'discuss', 'plan'] as const)('keeps a plain %s answer visible with an honest task outcome and no extra turn', async intent => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory), adapter = new NativeAdapter()
    adapter.reply = '当前能力卡未提供此工具，本轮无法完成修改。'
    const harness = new LocalAgentHarness(repository, () => adapter)
    const request = { ...generation(workspace), intent }
    const id = await harness.generate(workspace, 'claude', request)
    try {
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: intent === 'edit' ? 'incomplete' : 'answer', requestId: request.requestId })
      const stored = (await repository.list(workspace)).v2[0]!
      expect(stored.tasks[0]!.status).toBe(intent === 'edit' ? 'failed' : 'completed')
      expect(stored.events.some(event => event.kind === 'text' && event.text === adapter.reply)).toBe(true)
      expect(stored.hostResults).toHaveLength(0)
      expect(adapter.turns).toHaveLength(1)
    } finally { await harness.close() }
  })

  it('extends creation only into locations created by the current task receipts', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    const request = generation(workspace)
    const initial = request.destinations[0]!
    if (initial.kind !== 'update') throw new Error('Fixture expects an update target')
    const { itemId: _item, authoringAddress: _address, ...scope } = initial.target
    request.destinations.push({ kind: 'create', scope: { ...scope, parent: { kind: 'course-locations' }, insertion: { kind: 'append' } } })
    const adapters: NativeAdapter[] = []
    const currentCandidateId = randomUUID()
    const harness = new LocalAgentHarness(repository, (_adapter, activeRequest) => {
      const adapter = new NativeAdapter()
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: activeRequest!.requestId,
        candidateId: currentCandidateId, summary: '创建当前任务的新页', steps: [{ id: 'page', tool: 'course.structure', carrier: 'native',
          destination: activeRequest!.destinations[1], input: { operation: 'insert', label: '新页' } }] })}${GENERATION_CLOSE}`
      adapters.push(adapter)
      return adapter
    })
    const id = await harness.generate(workspace, 'claude', request)
    await expect.poll(() => harness.running).toBe(false)
    expect((await harness.candidate(workspace, id)).kind).toBe('candidate')
    const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: request.requestId, candidateId: currentCandidateId,
      status: 'committed', beforeRevision: 1, afterRevision: 2,
      affected: [{ id: 'current-task-page', operation: 'created', ownerKey: 'scene:current-task-page', authoringAddress: 'locations/current-task-page' }],
      resources: { assetIds: [], packageIds: [] } }
    await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: currentCandidateId, status: 'committed',
      beforeRevision: 1, afterRevision: 2, summary: '当前任务已创建新页' }, receipt)
    const stored = (await repository.list(workspace)).v2[0]!
    const oldTaskId = randomUUID(), oldObservationId = randomUUID(), oldRequestId = randomUUID(), oldCandidateId = randomUUID(), oldResultId = randomUUID()
    stored.tasks.unshift({ ...stored.tasks[0]!, taskId: oldTaskId, status: 'completed', observationId: oldObservationId, committedResultIds: [oldResultId],
      execution: stored.tasks[0]!.execution ? { ...stored.tasks[0]!.execution, timing: undefined } : undefined })
    stored.observations.unshift({ ...stored.observations[0]!, taskId: oldTaskId, observationId: oldObservationId })
    stored.hostResults.unshift({ ...stored.hostResults[0]!, taskId: oldTaskId, observationId: oldObservationId, requestId: oldRequestId,
      candidateId: oldCandidateId, resultId: oldResultId, receipts: [{ ...receipt, requestId: oldRequestId, candidateId: oldCandidateId,
        affected: [{ id: 'old-task-page', operation: 'created', ownerKey: 'scene:old-task-page', authoringAddress: 'locations/old-task-page' }] }] })
    await repository.write(stored)
    const nextFor = (locationId: string): GenerationRequest => ({ ...generation(workspace, 2), destinations: [
      { kind: 'create', scope: { ...scope, documentRevision: 2, locationId, ownerKey: `scene:${locationId}`,
        parent: { kind: 'owner' }, insertion: { kind: 'append' } } },
    ] })
    await expect(harness.continue(workspace, id, nextFor('old-task-page'))).rejects.toThrow('不能扩大原任务写入范围')
    await expect(harness.continue(workspace, id, nextFor('unrelated-page'))).rejects.toThrow('不能扩大原任务写入范围')
    expect(adapters).toHaveLength(1)
    await expect(harness.continue(workspace, id, nextFor('current-task-page'))).resolves.toBe(id)
    await expect.poll(() => harness.running).toBe(false)
    expect(adapters).toHaveLength(2)
    expect(adapters[1]!.opens[0]!.externalSessionId).toBe('native-confirmed-session')
  })

  it('continues with the real recorded receipt and a fresh request while keeping task, native identity and history', async () => {
    const { directory, workspace } = await fixture()
    const adapters: NativeAdapter[] = []
    const candidates: string[] = []
    const repository = new LocalAgentRepository(directory)
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      const candidateId = randomUUID(); candidates.push(candidateId)
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, candidateId, summary: '修改标题',
        steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination: request!.destinations[0], input: { operation: 'properties', properties: { label: '阶段' } } }] })}${GENERATION_CLOSE}`
      adapters.push(adapter); return adapter
    })
    const request = generation(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    await expect.poll(() => harness.running).toBe(false)
    expect((await harness.candidate(workspace, id)).kind).toBe('candidate')
    const before = (await repository.list(workspace)).v2[0]!
    const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: request.requestId, candidateId: candidates[0]!, status: 'committed',
      beforeRevision: 1, afterRevision: 2, affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }
    const result = { requestId: request.requestId, candidateId: candidates[0]!, status: 'committed' as const, beforeRevision: 1, afterRevision: 2, summary: '已提交第一阶段' }
    await harness.hostResult(workspace, id, result, receipt)
    await harness.hostResult(workspace, id, result, receipt)
    expect((await repository.list(workspace)).v2[0]!.hostResults).toHaveLength(1)
    const next = generation(workspace, 2)
    expect(await harness.continue(workspace, id, next)).toBe(id)
    await expect.poll(() => harness.running).toBe(false)
    const after = (await repository.list(workspace)).v2[0]!
    expect(after.tasks[0]!.taskId).toBe(before.tasks[0]!.taskId)
    expect(after.observations).toHaveLength(2)
    expect(after.tasks[0]!.execution!.deadlineAt).toBe(before.tasks[0]!.execution!.deadlineAt)
    expect(adapters[1]!.opens[0]!.externalSessionId).toBe('native-confirmed-session')
    const feedbackResult = JSON.parse(adapters[1]!.turns[0]!.text.split('已记录正式提交回执：\n')[1]!.split('\n')[0]!)
    expect(feedbackResult.receipts).toEqual([receipt])
    expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'candidate', candidate: { requestId: next.requestId, candidateId: candidates[1] } })
    await harness.cancel(workspace, id)
    await expect(harness.hostResult(workspace, id, { requestId: next.requestId, status: 'checked', summary: 'late' })).rejects.toThrow('停止')
    expect((await repository.list(workspace)).v2[0]!.tasks[0]!.status).toBe('partial')
  })

  it('never accepts an editing candidate in a discussion task', async () => {
    const { directory, workspace } = await fixture()
    const request = { ...generation(workspace), intent: 'discuss' as const }
    const adapter = new NativeAdapter()
    adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request.requestId, candidateId: randomUUID(), summary: '未经授权修改', steps: [
      { id: 's', tool: 'native.content', carrier: 'native', destination: request.destinations[0], input: {} },
    ] })}${GENERATION_CLOSE}`
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), () => adapter)
    const id = await harness.generate(workspace, 'claude', request)
    await expect.poll(() => harness.running).toBe(false)
    await expect(harness.candidate(workspace, id)).rejects.toThrow('没有工程修改授权')
    expect((await harness.list(workspace)).records[0]!.task?.intent).toBe('discuss')
  })
})


describe('short-path durable finish and recovery', () => {
  async function finishFixture(short = false) {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory), adapters: NativeAdapter[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      if (request) adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: short ? 2 : 1, requestId: request.requestId,
        ...(short ? {} : { candidateId: randomUUID() }), summary: '目标已完成', afterCommit: { version: 1, action: 'finish' },
        steps: [{ id: 'title', tool: 'native.content', ...(short ? {} : { carrier: 'native' }), destination: short ? 'd1' : request.destinations[0], input: {} }] })}${GENERATION_CLOSE}`
      adapters.push(adapter); return adapter
    })
    const request = generation(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    await expect.poll(() => harness.running).toBe(false)
    const candidate = await harness.candidate(workspace, id)
    if (candidate.kind !== 'candidate') throw new Error('Expected candidate')
    const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: request.requestId, candidateId: candidate.candidate.candidateId,
      status: 'committed', beforeRevision: 1, afterRevision: 2,
      affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }
    const result = { requestId: request.requestId, candidateId: receipt.candidateId, status: 'committed' as const,
      summary: '已应用目标修改', beforeRevision: 1, afterRevision: 2, afterCommit: { version: 1 as const, action: 'finish' as const } }
    return { directory, repository, workspace, harness, request, id, candidate, receipt, result, adapters }
  }
  it('allocates one short candidate identity and durably finishes on the exact host receipt without a new model turn', async () => {
    const f = await finishFixture(true)
    try {
      expect(await f.harness.candidate(f.workspace, f.id)).toEqual(f.candidate)
      const response = await f.harness.hostResult(f.workspace, f.id, f.result, f.receipt)
      expect(response.task).toMatchObject({ status: 'completed', completion: { outcome: 'modified' }, receiptDelivery: 'pending' })
      expect(f.adapters).toHaveLength(1)
      const reopened = new LocalAgentHarness(new LocalAgentRepository(f.directory), () => new NativeAdapter())
      expect((await reopened.list(f.workspace)).records[0]).toMatchObject({ status: 'completed', task: { status: 'completed' }, hostResult: { afterCommit: { action: 'finish' } } })
      await expect(f.harness.continue(f.workspace, f.id, generation(f.workspace, 2))).rejects.toThrow('没有可续轮')
    } finally { await f.harness.close() }
  })
  it('durably finishes on a formal unchanged receipt and reopens without a revision or second native turn', async () => {
    const f = await finishFixture(true), reopenedAdapters: NativeAdapter[] = []
    const receipt: GenerationCommitReceipt = { ...f.receipt, status: 'unchanged', afterRevision: 1, affected: [] }
    const result = { ...f.result, status: 'unchanged' as const, afterRevision: 1, summary: '正式命令确认当前目标无需修改' }
    const reopened = new LocalAgentHarness(new LocalAgentRepository(f.directory), () => {
      const adapter = new NativeAdapter(); reopenedAdapters.push(adapter); return adapter
    })
    try {
      const response = await f.harness.hostResult(f.workspace, f.id, result, receipt)
      expect(response).toMatchObject({ status: 'completed', task: { status: 'completed', committedStages: 0,
        completion: { outcome: 'unchanged' } }, hostResult: result })
      const persisted = (await new LocalAgentRepository(f.directory).list(f.workspace)).v2.find(record => record.id === f.id)!
      expect(persisted.hostResults).toHaveLength(1)
      expect(persisted.hostResults[0]).toMatchObject({ status: 'unchanged', beforeRevision: 1, afterRevision: 1,
        receipts: [receipt], afterCommit: { action: 'finish' }, receiptDelivery: 'pending' })
      expect(persisted.tasks[0]!.completion?.resultId).toBe(persisted.hostResults[0]!.resultId)
      expect(persisted.tasks[0]!.committedResultIds).toEqual([])
      expect(persisted.tasks[0]!.execution!.turnCount).toBe(1)
      await f.harness.close()
      const loaded = await reopened.list(f.workspace), record = loaded.records.find(value => value.id === f.id)!
      expect(loaded.damaged).toEqual([])
      expect(record.task).toEqual(response.task)
      expect(record.hostResult).toEqual(response.hostResult)
      expect((await reopened.repository.list(f.workspace)).v2.find(value => value.id === f.id)).toEqual(persisted)
      await expect(reopened.continue(f.workspace, f.id, generation(f.workspace))).rejects.toThrow('没有可续轮')
      expect(f.adapters).toHaveLength(1)
      expect(f.adapters[0]!.turns).toHaveLength(1)
      expect(reopenedAdapters).toEqual([])
    } finally { await reopened.close(); await f.harness.close() }
  })
  it.each(['canonical', 'display'] as const)('retries an uncertain %s write without losing or duplicating a real finish receipt', async stage => {
    const f = await finishFixture()
    const key = stage === 'canonical' ? 'write' : 'writeDisplay'
    const original = f.repository[key].bind(f.repository)
    let fail = true
    Object.assign(f.repository, { [key]: async (...args: unknown[]) => { if (fail) throw new Error('disk unavailable'); return Reflect.apply(original, null, args) } })
    try {
      await expect(f.harness.hostResult(f.workspace, f.id, f.result, f.receipt)).rejects.toThrow('disk unavailable')
      await expect(f.harness.candidate(f.workspace, f.id)).rejects.toThrow('重试保存回执')
      expect((await f.harness.list(f.workspace)).records[0]!.task).toMatchObject({ status: 'completed' })
      fail = false
      await f.harness.hostResult(f.workspace, f.id, f.result, f.receipt)
      const stored = (await new LocalAgentRepository(f.directory).list(f.workspace)).v2[0]!
      expect(stored.hostResults).toHaveLength(1)
      expect(stored.hostResults[0]!.receipts).toEqual([f.receipt])
      expect(stored.tasks[0]!.completion?.resultId).toBe(stored.hostResults[0]!.resultId)
      expect((await f.harness.list(f.workspace)).damaged).toEqual([])
    } finally { fail = false; await f.harness.close() }
  })
  it('injects pending formal receipts only on the next real native request and marks delivery after its start acknowledgement', async () => {
    const f = await finishFixture()
    await f.harness.hostResult(f.workspace, f.id, f.result, f.receipt)
    const ack = deferred<void>(), adapter = new NativeAdapter(), reopened = new LocalAgentHarness(new LocalAgentRepository(f.directory), () => adapter)
    const original = adapter.startTurn.bind(adapter)
    adapter.startTurn = async input => { const value = await original(input); await ack.promise; return value }
    try {
      const id = await reopened.resume(f.workspace, f.id, '现在解释这次修改')
      await expect.poll(() => adapter.turns.length).toBe(1)
      expect(adapter.turns[0]!.text).toContain(f.receipt.candidateId)
      expect(adapter.turns[0]!.text).toContain('修改已经应用，请勿重复执行')
      expect((await f.repository.list(f.workspace)).v2.find(record => record.id === f.id)!.hostResults[0]!.receiptDelivery).toBe('pending')
      ack.resolve(); await expect.poll(() => reopened.running).toBe(false)
      expect((await f.repository.list(f.workspace)).v2.find(record => record.id === f.id)!.hostResults[0]!.receiptDelivery).toBe('delivered')
      expect((await reopened.list(f.workspace)).records.find(record => record.id === id)!.status).toBe('completed')
    } finally { ack.resolve(); await reopened.close(); await f.harness.close() }
  })
  it('keeps undelivered receipts pending when a resumed native turn rejects start', async () => {
    const f = await finishFixture()
    await f.harness.hostResult(f.workspace, f.id, f.result, f.receipt)
    const adapter = new NativeAdapter()
    adapter.startTurn = async () => { throw new Error('native start rejected') }
    const reopened = new LocalAgentHarness(new LocalAgentRepository(f.directory), () => adapter)
    try {
      await reopened.resume(f.workspace, f.id, '继续讨论')
      await expect.poll(() => reopened.running).toBe(false)
      expect((await f.repository.list(f.workspace)).v2.find(record => record.id === f.id)!.hostResults[0]!.receiptDelivery).toBe('pending')
    } finally { await reopened.close(); await f.harness.close() }
  })
  it('reopens an uncommitted preview as unresolved instead of inventing a commit or replaying its candidate', async () => {
    const f = await finishFixture()
    try {
      await f.harness.hostResult(f.workspace, f.id, { requestId: f.request.requestId, candidateId: f.receipt.candidateId, status: 'checked', summary: '仅检查通过' })
      const reopened = new LocalAgentHarness(new LocalAgentRepository(f.directory), () => new NativeAdapter())
      const record = (await reopened.list(f.workspace)).records[0]!
      expect(record).toMatchObject({ status: 'failed', task: { status: 'failed' } })
      expect(record.task?.completion).toBeUndefined()
      expect((await f.repository.list(f.workspace)).v2[0]!.hostResults.flatMap(result => result.receipts)).toEqual([])
      await expect(reopened.candidate(f.workspace, f.id)).rejects.toThrow('尚未成功结束')
    } finally { await f.harness.close() }
  })
  it('records structured prepare failures with their original path and target without declaring completion', async () => {
    const f = await finishFixture()
    try {
      const failure = { version: 1 as const, stage: 'prepare' as const, requestId: f.request.requestId, candidateId: f.receipt.candidateId,
        stepId: 'title', tool: 'native.content', destination: f.request.destinations[0]!, diagnostics: [{ code: 'invalid-font', message: 'Font unavailable', path: ['steps', 0, 'input', 'font'] }], assetIds: [], packageIds: [] }
      await f.harness.hostResult(f.workspace, f.id, { requestId: f.request.requestId, candidateId: f.receipt.candidateId, status: 'rejected', summary: '准备失败', failure })
      const result = (await f.repository.list(f.workspace)).v2[0]!.hostResults[0]!
      expect(result.failure).toEqual(failure); expect(result.diagnostics).toEqual(failure.diagnostics)
      expect(result.receipts).toEqual([]); expect(result.afterCommit).toBeUndefined()
    } finally { await f.harness.close() }
  })
})
