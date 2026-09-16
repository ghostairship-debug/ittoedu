// @vitest-environment node

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalAgentHarness } from '../../src/main/localAgent/harness'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { CandidateStaging } from '../../src/main/localAgent/candidateStaging'
import { generationRepairInputs } from '../../src/main/localAgent/generationRepairInputs'
import { buildGenerationPrompt } from '../../src/main/localAgent/profile'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import type { LocalAgentCapabilities, LocalAgentConfiguration } from '../../src/shared/localAgentContract'
import type { LocalAgentCliAdapterV2, LocalAgentNativeEvent } from '../../src/shared/localAgentTaskContract'
import { generationRequestSchema, MAX_GENERATION_PROMPT_BYTES, DEFAULT_GENERATION_TASK_DURATION_MS, MAX_GENERATION_TASK_DURATION_MS, type GenerationRequest, type GenerationCommitReceipt } from '../../src/shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE, GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE, generationStagedCandidateMarker } from '../../src/shared/generationResult'
import { randomUUID } from 'node:crypto'
import { projectV2RecordToV1 } from '../../src/shared/localAgentProjection'
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
  it.each(['repeat', 'progress'] as const)('counts changed native text and increasing usage, not repeated snapshots: %s', async scenario => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapter = new NativeAdapter(), emitted = deferred<void>(), update = deferred<void>(), updated = deferred<void>(), finish = deferred<void>(), saved = deferred<void>()
    const write = repository.write.bind(repository)
    repository.write = async record => { await write(record); if (record.tasks.at(-1)?.status === 'failed') saved.resolve() }
    adapter.events = async function* () {
      const input = this.turns.at(-1)!
      const identity = { taskId: input.taskId, epoch: input.epoch, workspace, runId: input.runId, nativeTurnId: 'native-turn' }
      yield { ...identity, kind: 'text', itemId: 'work', phase: 'body', operation: 'replace', text: 'working' }
      yield { ...identity, kind: 'usage', inputTokens: 10, outputTokens: 1, cachedInputTokens: 0 }
      emitted.resolve(); await update.promise
      yield { ...identity, kind: 'text', itemId: 'work', phase: 'body', operation: 'replace', text: scenario === 'repeat' ? 'working' : 'new result' }
      yield { ...identity, kind: 'usage', inputTokens: 10, outputTokens: scenario === 'repeat' ? 1 : 2, cachedInputTokens: 0 }
      updated.resolve(); await finish.promise
    }
    adapter.close = async () => { finish.resolve() }
    const harness = new LocalAgentHarness(repository, () => adapter), startedAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(startedAt)
    try {
      const id = await harness.generate(workspace, 'claude', { ...generation(workspace), execution: { version: 1, startedAt, deadlineAt: startedAt + 40 * 60_000 } })
      await emitted.promise
      await vi.advanceTimersByTimeAsync(19 * 60_000)
      update.resolve(); await updated.promise
      expect((await harness.read(workspace, id)).records![0]!.task!.lastActivityAt).toBe(startedAt + (scenario === 'repeat' ? 0 : 19 * 60_000))
      await vi.advanceTimersByTimeAsync(60_000)
      if (scenario === 'progress') { expect(harness.running).toBe(true); await vi.advanceTimersByTimeAsync(19 * 60_000) }
      await saved.promise
      expect((await harness.read(workspace, id)).records![0]!.task!.budgetStopReason).toBe('native-inactivity')
    } finally { update.resolve(); finish.resolve(); await harness.close(); vi.useRealTimers() }
  })
  it.each(['quiet', 'tool', 'question'] as const)('separates native inactivity from the explicit resource budget for %s', async scenario => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapter = new NativeAdapter(), emitted = deferred<void>(), finish = deferred<void>(), saved = deferred<void>()
    const write = repository.write.bind(repository)
    repository.write = async record => { await write(record); if (record.tasks.at(-1)?.status === 'failed') saved.resolve() }
    adapter.events = async function* () {
      const input = this.turns.at(-1)!
      const identity = { taskId: input.taskId, epoch: input.epoch, workspace, runId: input.runId, nativeTurnId: 'native-turn' }
      if (scenario === 'tool') yield { ...identity, kind: 'tool', itemId: 'long-tool', name: 'command', status: 'running', detail: {} }
      if (scenario === 'question') yield { ...identity, kind: 'question', question: { taskId: input.taskId, epoch: input.epoch, workspace,
        questionId: 'permission', turnId: 'native-turn', purpose: 'permission', questions: [{ id: 'allow', title: '允许工具执行', options: ['允许', '拒绝'], multiple: false }] } }
      emitted.resolve()
      await finish.promise
    }
    adapter.close = async () => { finish.resolve() }
    const harness = new LocalAgentHarness(repository, () => adapter), startedAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(startedAt)
    try {
      const id = await harness.generate(workspace, 'claude', { ...generation(workspace), execution: { version: 1, startedAt, deadlineAt: startedAt + 40 * 60_000 } })
      await emitted.promise
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      if (scenario === 'quiet') {
        await saved.promise
        expect((await harness.read(workspace, id)).records?.[0]?.task).toMatchObject({ status: 'failed', budgetStopReason: 'native-inactivity' })
      } else {
        expect(harness.running).toBe(true)
        await vi.advanceTimersByTimeAsync(20 * 60_000)
        await saved.promise
        expect((await harness.read(workspace, id)).records?.[0]?.task).toMatchObject({ status: 'failed', budgetStopReason: 'resource-budget' })
      }
      await expect(harness.candidate(workspace, id)).rejects.toThrow('尚未成功结束')
    } finally { finish.resolve(); await harness.close(); vi.useRealTimers() }
  })

  it('extends only on an explicit current input, preserves the owner deadline past the old timer and caps the total budget', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapter = new NativeAdapter(), emitted = deferred<void>(), finish = deferred<void>()
    adapter.events = async function* () {
      const input = this.turns.at(-1)!
      yield { taskId: input.taskId, epoch: input.epoch, workspace, runId: input.runId, nativeTurnId: 'native-turn',
        kind: 'tool', itemId: 'long-tool', name: 'command', status: 'running', detail: {} }
      emitted.resolve(); await finish.promise
    }
    adapter.close = async () => { finish.resolve() }
    const harness = new LocalAgentHarness(repository, () => adapter), startedAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(startedAt)
    try {
      const id = await harness.generate(workspace, 'claude', generation(workspace))
      await emitted.promise
      const task = (await harness.read(workspace, id)).records![0]!.task!
      expect(task.deadlineAt).toBe(startedAt + DEFAULT_GENERATION_TASK_DURATION_MS)
      const input = { version: 1 as const, kind: 'extend-budget' as const, minutes: 20 as const, taskId: task.taskId,
        epoch: task.epoch, workspace, inputId: randomUUID(), turnId: task.turnId }
      const failedWrite = vi.spyOn(repository, 'write').mockRejectedValueOnce(new Error('budget storage failed'))
      await expect(harness.input(workspace, id, input)).rejects.toThrow('budget storage failed')
      expect((await harness.read(workspace, id)).records![0]!.task!.deadlineAt).toBe(startedAt + DEFAULT_GENERATION_TASK_DURATION_MS)
      failedWrite.mockRestore()
      expect(await harness.input(workspace, id, input)).toMatchObject({ status: 'accepted' })
      expect(await harness.input(workspace, id, input)).toMatchObject({ status: 'accepted' })
      const persisted = (await repository.list(workspace)).v2[0]!
      expect(persisted.tasks[0]!.execution!.deadlineAt).toBe(startedAt + 40 * 60_000)
      expect(persisted.tasks[0]!.pendingInputs).toEqual([])
      await vi.advanceTimersByTimeAsync(DEFAULT_GENERATION_TASK_DURATION_MS + 1)
      expect(harness.running).toBe(true)
      for (let i = 0; i < 4; i++) expect(await harness.input(workspace, id, { ...input, inputId: randomUUID() })).toMatchObject({ status: 'accepted' })
      expect((await harness.read(workspace, id)).records![0]!.task!.deadlineAt).toBe(startedAt + MAX_GENERATION_TASK_DURATION_MS)
      expect(await harness.input(workspace, id, { ...input, inputId: randomUUID() })).toMatchObject({ status: 'rejected' })
      expect(adapter.turns).toHaveLength(1)
      finish.resolve(); await harness.cancel(workspace, id)
      await expect(harness.input(workspace, id, { ...input, inputId: randomUUID() })).rejects.toThrow()
    } finally { finish.resolve(); await harness.close(); vi.useRealTimers() }
  })
  it('reads one live session without listing history or overlaying another session or workspace', async () => {
    const { directory } = await fixture(), repository = new LocalAgentRepository(directory)
    const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: createWorkspaceIdentity('normalization', directory).normalizedPath, conversationId: randomUUID() }
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const ready = deferred<void>()
    let streams = 0
    const harness = new LocalAgentHarness(repository, () => {
      const adapter = new NativeAdapter()
      adapter.events = async function* () { if (++streams === 2) ready.resolve(); await gate; yield* NativeAdapter.prototype.events.call(this) }
      return adapter
    })
    const id = await harness.start(workspace, 'claude', 'first discussion')
    const otherId = await harness.start(workspace, 'claude', 'second discussion')
    await ready.promise // Startup receipt discovery is independent of the read endpoint under test.
    const list = vi.spyOn(repository, 'list')
    try {
      const result = await harness.read(workspace, id)
      expect(result.records).toHaveLength(1)
      expect(result.records[0]).toMatchObject({ id, status: 'running', task: { status: 'running' } })
      expect((await harness.read(workspace, otherId)).records.map(record => record.id)).toEqual([otherId])
      expect((await harness.read({ ...workspace, conversationId: randomUUID() }, id)).records).toEqual([])
      expect((await harness.read(workspace, randomUUID())).records).toEqual([])
      expect(list).not.toHaveBeenCalled()
    } finally { list.mockRestore(); release(); await harness.close() }
  })

  it('projects cancelled lesson tasks while transport close is pending and ignores late native events', async () => {
    const { directory } = await fixture(), repository = new LocalAgentRepository(directory), adapter = new NativeAdapter()
    const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: createWorkspaceIdentity('normalization', directory).normalizedPath, conversationId: randomUUID() }
    let releaseEvents!: () => void, releaseClose!: () => void
    const eventsGate = new Promise<void>(resolve => { releaseEvents = resolve })
    const closeGate = new Promise<void>(resolve => { releaseClose = resolve })
    let closing = false
    adapter.events = async function* () {
      await eventsGate
      yield* NativeAdapter.prototype.events.call(this)
    }
    adapter.close = async () => { closing = true; await closeGate }
    const harness = new LocalAgentHarness(repository, () => adapter)
    const id = await harness.start(workspace, 'claude', 'read current lesson')
    await expect.poll(() => adapter.turns.length).toBe(1)
    const stopping = harness.cancel(workspace, id)
    try {
      await expect.poll(() => closing).toBe(true)
      expect(harness.running).toBe(true)
      const cancelled = (await harness.list(workspace)).records.find(record => record.id === id)!
      expect(cancelled).toMatchObject({ status: 'cancelled', task: { status: 'cancelled' } })
      expect(cancelled.events.filter(event => event.kind === 'cancelled')).toHaveLength(1)
      expect((await harness.read(workspace, id)).records).toEqual([cancelled])
      releaseEvents()
      const stillCancelled = (await harness.list(workspace)).records.find(record => record.id === id)!
      expect(stillCancelled.status).toBe('cancelled')
      expect(stillCancelled.events.some(event => event.kind === 'text')).toBe(false)
    } finally { releaseEvents(); releaseClose(); await stopping; await harness.close() }
    expect((await harness.list(workspace)).records.find(record => record.id === id)).toMatchObject({ status: 'cancelled', task: { status: 'cancelled' } })
    const native = (await repository.list(workspace)).v2.find(record => record.id === id)!
    // An old cancelled task/event cannot override a genuinely new current task.
    const nextTask = { ...native.tasks.at(-1)!, taskId: randomUUID(), status: 'running' as const }
    expect(projectV2RecordToV1({ ...native, tasks: [...native.tasks, nextTask] }, { live: true }))
      .toMatchObject({ status: 'running', task: { taskId: nextTask.taskId, status: 'running' } })
  })
  it('runs a real-directory lesson discussion through the existing native loop without a project', async () => {
    const { directory } = await fixture(), repository = new LocalAgentRepository(directory), adapter = new NativeAdapter()
    const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: createWorkspaceIdentity('normalization', directory).normalizedPath, conversationId: randomUUID() }
    const harness = new LocalAgentHarness(repository, () => adapter)
    try {
      const id = await harness.start(workspace, 'claude', '读取当前教学文档并讨论', 'plan')
      await expect.poll(() => harness.running).toBe(false)
      const result = await harness.list(workspace)
      expect(result.records[0]).toMatchObject({ id, status: 'completed', workspace })
      expect((await repository.list(workspace)).v2[0]).toMatchObject({ version: 3, tasks: [{ intent: 'plan', writeDestinations: [] }] })
      expect(adapter.opens[0]!.cwd.toLowerCase()).toBe(directory.toLowerCase())
      expect(adapter.turns[0]!.workspace).toEqual(workspace)
      expect((await new LocalAgentRepository(directory).list({ ...workspace, conversationId: randomUUID() })).records).toEqual([])
      const restored = new LocalAgentHarness(new LocalAgentRepository(directory), () => new NativeAdapter())
      expect((await restored.list(workspace)).records[0]!.status).toBe('completed')
      await restored.close()
    } finally { await harness.close() }
  })
  it('keeps saved project tasks in the same lesson conversation without weakening project target identity', async () => {
    const { directory, workspace: project } = await fixture(), repository = new LocalAgentRepository(directory)
    const lesson = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: createWorkspaceIdentity('normalization', directory).normalizedPath, conversationId: randomUUID() }
    const harness = new LocalAgentHarness(repository, () => new NativeAdapter())
    try {
      const discussion = await harness.start(lesson, 'claude', '讨论课例')
      await expect.poll(() => harness.running).toBe(false)
      const edit = await harness.generate(project, 'claude', generation(project), undefined, undefined, lesson)
      await expect.poll(() => harness.running).toBe(false)
      const joined = await harness.list(lesson)
      expect(joined.records.map(record => record.id).sort()).toEqual([discussion, edit].sort())
      expect(joined.records.find(record => record.id === edit)).toMatchObject({ workspace: project, lessonWorkspace: lesson })
      expect((await repository.list(project)).v2.map(record => record.id)).toEqual([edit])
      expect((await repository.list({ ...lesson, conversationId: randomUUID() })).v2).toHaveLength(0)
      await harness.delete(lesson)
      expect((await harness.list(lesson)).records).toHaveLength(0)
      expect((await repository.list(project)).v2).toHaveLength(0)
    } finally { await harness.close() }
  })
  it('moves current lesson task records and invalidates the prior native resume handle', async () => {
    const { directory } = await fixture(), repository = new LocalAgentRepository(directory)
    const lesson = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: createWorkspaceIdentity('normalization', directory).normalizedPath, conversationId: randomUUID() }
    const harness = new LocalAgentHarness(repository, () => new NativeAdapter())
    try {
      const id = await harness.start(lesson, 'claude', '讨论')
      await expect.poll(() => harness.running).toBe(false)
      const moved = { ...lesson, normalizedDirectory: lesson.normalizedDirectory + '/moved' }
      await repository.relocateLessonWorkspace(lesson, moved)
      const record = (await repository.list(moved)).v2[0]!
      expect(record.id).toBe(id); expect(record.externalSessionId).toBeNull(); expect(record.tasks[0]!.workspace).toEqual(moved)
      expect((await repository.list(lesson)).v2).toHaveLength(0)
    } finally { await harness.close() }
  })
  it('stops a running lesson before deleting its only task record and staging', async () => {
    const { directory } = await fixture(), repository = new LocalAgentRepository(directory), adapter = new NativeAdapter(), quiet = deferred<void>()
    adapter.events = async function* () { await quiet.promise }
    adapter.close = async () => { quiet.resolve() }
    const lesson = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: createWorkspaceIdentity('normalization', directory).normalizedPath, conversationId: randomUUID() }
    const harness = new LocalAgentHarness(repository, () => adapter)
    try {
      const id = await harness.start(lesson, 'claude', '讨论')
      await expect.poll(() => adapter.turns.length).toBe(1)
      await harness.delete(lesson)
      expect(harness.running).toBe(false); expect((await repository.list(lesson)).v2).toHaveLength(0)
      await expect(fs.stat(repository.stagingPath(lesson, id))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { quiet.resolve(); await harness.close() }
  })
  it('quarantines an unknown current record without reading old records or damaging its neighbour', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory), harness = new LocalAgentHarness(repository, () => new NativeAdapter())
    try {
      const id = await harness.start(workspace, 'claude', 'hello')
      await expect.poll(() => harness.running).toBe(false)
      const current = (await repository.list(workspace)).v2[0]!
      const oldId = randomUUID(); await fs.mkdir(repository.directory(workspace), { recursive: true })
      await fs.writeFile(path.join(repository.directory(workspace), `${oldId}.json`), JSON.stringify({ ...current, id: oldId, version: 2 }))
      const badId = randomUUID(); await fs.writeFile(path.join(repository.v2Directory(workspace), `${badId}.json`), JSON.stringify({ ...current, id: badId, version: 99 }))
      const listed = await repository.list(workspace)
      expect(listed.records.map(record => record.id)).toEqual([id]); expect(listed.damaged).toHaveLength(1)
      expect(await fs.readFile(path.join(repository.directory(workspace), `${oldId}.json`), 'utf8')).toContain('"version":2')
    } finally { await harness.close() }
  })

  it('persists accepted answer values with saved question titles and omits unmatched internal IDs', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory), release = deferred<void>()
    const adapter = new NativeAdapter()
    adapter.events = async function* () {
      const turn = this.turns.at(-1)!
      const identity = { taskId: turn.taskId, epoch: turn.epoch, workspace, runId: turn.runId, nativeTurnId: 'native-turn' }
      yield { ...identity, kind: 'question', question: { taskId: turn.taskId, epoch: turn.epoch, workspace,
        questionId: 'private-question-id', turnId: 'native-turn', purpose: 'clarification',
        questions: [{ id: 'private-item-id', title: '背景选择', options: ['浅色', '保持原图'], multiple: true }] } }
      await release.promise
    }
    adapter.input = async input => ({ taskId: input.taskId, epoch: input.epoch, workspace, inputId: input.inputId,
      turnId: input.turnId, status: 'accepted', reason: null })
    adapter.close = async () => { release.resolve() }
    const harness = new LocalAgentHarness(repository, () => adapter)
    try {
      const id = await harness.start(workspace, 'claude', '选择背景')
      await expect.poll(async () => (await repository.list(workspace)).v2[0]?.tasks[0]?.status).toBe('waiting-input')
      const task = (await repository.list(workspace)).v2[0]!.tasks[0]!
      const input = { version: 1 as const, taskId: task.taskId, epoch: task.epoch, workspace, inputId: randomUUID(), turnId: 'native-turn',
        kind: 'answer' as const, questionId: 'private-question-id', answers: [{ id: 'private-item-id', values: ['浅色', '保持原图'] },
          { id: 'unmatched-private-id', values: ['备用答案原文'] }] }
      await harness.input(workspace, id, input)
      await harness.input(workspace, id, input)
      const answers = (await repository.list(workspace)).v2[0]!.events.filter(event => event.kind === 'user-message' && event.purpose === 'answer')
      expect(answers).toHaveLength(1)
      expect(answers[0]).toMatchObject({ itemId: input.inputId, text: '背景选择：浅色、保持原图\n备用答案原文' })
      expect(JSON.stringify(answers[0])).not.toContain('private-id')
    } finally { release.resolve(); await harness.close() }
  })
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
      expect((await new LocalAgentRepository(directory).list(workspace)).v2.find(record => record.id === id)?.events).toEqual([expect.objectContaining({ kind: 'user-message', text: 'wait for native output' })])
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
    expect(new Set(stored.events.filter(event => event.kind !== 'user-message').map(event => event.nativeTurnId))).toEqual(new Set(['native-turn']))
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

  it('waits for a concurrent preference save and restores the selection after a harness restart', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const writing = deferred<void>(), release = deferred<void>(), preference = { model: 'selected', effort: 'high' }
    const write = repository.writeConfiguration.bind(repository)
    vi.spyOn(repository, 'writeConfiguration').mockImplementation(async (...args) => { writing.resolve(); await release.promise; return write(...args) })
    const adapter = new NativeAdapter(), harness = new LocalAgentHarness(repository, () => adapter)
    const saving = harness.configure('claude', preference, workspace)
    await writing.promise
    const id = await harness.start(workspace, 'claude', 'hello')
    expect(adapter.turns).toHaveLength(0)
    release.resolve(); await saving
    await expect.poll(() => harness.running).toBe(false)
    expect(adapter.configurations).toEqual([preference])
    expect((await repository.list(workspace)).v2[0]?.tasks[0]?.configurationRuns).toEqual([
      expect.objectContaining({ requested: preference, confirmed: { ...preference, resolvedModel: 'resolved-selected' } }),
    ])
    await harness.close()
    const restoredAdapter = new NativeAdapter(), restored = new LocalAgentHarness(new LocalAgentRepository(directory), () => restoredAdapter)
    try {
      expect(await restored.capabilities('claude', { workspace })).toMatchObject({ selectedConfiguration: preference, requestedConfiguration: preference })
      await restored.resume(workspace, id, 'continue after restart')
      await expect.poll(() => restored.running).toBe(false)
      expect(restoredAdapter.configurations).toEqual([preference])
    } finally { await restored.close() }
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

async function writeMediaReferenceCandidate(root: string, reference: unknown = { $candidateFile: 'resources/小狗.png' }) {
  const request = JSON.parse(await fs.readFile(path.join(root, 'request.json'), 'utf8'))
  await fs.mkdir(path.join(root, 'resources'), { recursive: true })
  await fs.copyFile(candidatePng, path.join(root, 'resources/小狗.png'))
  await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify({ version: 2, requestId: request.requestId,
    summary: 'Import native generated image file', afterCommit: { version: 1, action: 'finish' },
    steps: [{ id: 'image', tool: 'asset.media.import', destination: 'd1',
      input: { kind: 'image', filename: '小狗.png', mimeType: 'image/png', base64: reference } }] }))
}

describe('Native candidate media file ingestion', () => {
  it.each(['finish', 'stop'] as const)('reuses a helper-delivered image after a malformed candidate and releases it on %s', async ending => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    let turn = 0
    const adapters: FileNativeAdapter[] = []
    const harness = new LocalAgentHarness(repository, () => {
      const index = turn++
      const adapter = new FileNativeAdapter(async root => {
        const request = JSON.parse(await fs.readFile(path.join(root, 'request.json'), 'utf8'))
        let source: { $candidateFile: string }
        if (index === 0) {
          source = { $candidateFile: 'resources/dog.png' }
          await fs.mkdir(path.join(root, 'resources'), { recursive: true })
          await fs.copyFile(candidatePng, path.join(root, source.$candidateFile))
          await fs.writeFile(path.join(root, 'delivered-media.jsonl'), JSON.stringify({ version: 1, source }) + '\n')
        } else {
          expect(request.reusableMedia).toHaveLength(1)
          source = request.reusableMedia[0].source
          expect(source.$candidateFile).toMatch(/^resources\/reused\//)
          expect(await fs.readFile(path.join(root, source.$candidateFile))).toEqual(await fs.readFile(candidatePng))
        }
        await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify({ version: 2, requestId: request.requestId,
          summary: 'Reuse delivered image', afterCommit: { version: 1, action: 'finish' }, steps: [{ id: 'image', tool: 'media.apply',
            destination: 'd1', input: { kind: 'image', source, fit: index === 0 ? 'invalid-fit' : 'contain' } }] }))
      })
      adapters.push(adapter); return adapter
    })
    try {
      const first = generation(workspace), id = await harness.generate(workspace, 'claude', first)
      await expect.poll(() => harness.running).toBe(false)
      const invalid = await harness.candidate(workspace, id)
      expect(invalid.kind).toBe('candidate-format-error')
      const prior = (await repository.list(workspace)).v2.find(record => record.id === id)!
      const retainedRoot = path.join(repository.stagingPath(workspace, prior.workingDirectoryId, 2), 'task-media', prior.tasks[0]!.taskId)
      expect(await fs.readdir(retainedRoot)).toHaveLength(1)
      await harness.hostResult(workspace, id, { requestId: first.requestId, status: 'rejected', summary: '修复显示方式，复用已交付素材' })
      const next = generation(workspace)
      await harness.continue(workspace, id, next)
      await expect.poll(() => harness.running).toBe(false)
      const result = await harness.candidate(workspace, id)
      if (result.kind !== 'candidate') throw new Error(JSON.stringify(result))
      expect(result.candidate.steps[0]!.input).toMatchObject({ source: { base64: (await fs.readFile(candidatePng)).toString('base64') } })
      const current = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(current.tasks[0]!.taskId).toBe(prior.tasks[0]!.taskId)
      expect(current.tasks[0]!.execution!.deadlineAt).toBe(prior.tasks[0]!.execution!.deadlineAt)
      expect(current.observations).toHaveLength(2)
      if (ending === 'stop') await harness.cancel(workspace, id)
      else {
        const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: next.requestId, candidateId: result.candidate.candidateId,
          status: 'committed', beforeRevision: 1, afterRevision: 2, affected: [], resources: { assetIds: ['applied-image'], packageIds: [] } }
        await harness.hostResult(workspace, id, { requestId: next.requestId, candidateId: receipt.candidateId, status: 'committed',
          summary: '正式宿主已应用', afterCommit: { version: 1, action: 'finish' } }, receipt)
      }
      await expect(fs.access(retainedRoot)).rejects.toThrow()
      const retainedProposals = Reflect.get(harness, 'proposals') as Map<string, unknown>
      expect(JSON.stringify([...retainedProposals.values()])).not.toContain((await fs.readFile(candidatePng)).toString('base64'))
      expect(adapters).toHaveLength(2)
    } finally { await harness.close() }
  })

  it('expands real media bytes once while keeping file references in native text and waiting for the host', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapter = new FileNativeAdapter(writeMediaReferenceCandidate), request = fileCandidateRequest(workspace)
    const harness = new LocalAgentHarness(repository, () => adapter)
    try {
      const id = await harness.generate(workspace, 'claude', request)
      await expect.poll(() => harness.running).toBe(false)
      const result = await harness.candidate(workspace, id)
      if (result.kind !== 'candidate') throw new Error(`Expected media candidate, got ${JSON.stringify(result)}`)
      const bytes = await fs.readFile(candidatePng)
      expect((result.candidate.steps[0]!.input as { base64: string }).base64).toBe(bytes.toString('base64'))
      await expect(fs.access(adapter.opens.at(-1)!.candidateRoot!)).rejects.toThrow()
      expect(await harness.candidate(workspace, id)).toEqual(result)
      const record = (await repository.list(workspace)).v2.find(value => value.id === id)!
      expect(JSON.stringify(record.events)).toContain('$candidateFile')
      expect(JSON.stringify(record.events)).not.toContain(bytes.toString('base64'))
      expect(record.tasks.at(-1)).toMatchObject({ status: 'checking', committedResultIds: [] })
      expect(record.hostResults).toEqual([])
    } finally { await harness.close() }
  })

  it.each(['missing', 'traversal', 'absolute', 'extra-field', 'oversize', 'linked-directory'] as const)('rejects %s media references with an exact step diagnostic and no host result', async scenario => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapter = new FileNativeAdapter(async root => {
      const file = scenario === 'missing' ? 'resources/missing.png' : scenario === 'traversal' ? 'resources/../request.json'
        : scenario === 'absolute' ? candidatePng : scenario === 'linked-directory' ? 'resources/link/image.png' : 'resources/小狗.png'
      await writeMediaReferenceCandidate(root, { $candidateFile: file, ...(scenario === 'extra-field' ? { encoding: 'base64' } : {}) })
      if (scenario === 'oversize') await fs.truncate(path.join(root, file), 12 * 1024 * 1024 + 1)
      if (scenario === 'linked-directory') {
        const outside = path.join(directory, 'outside-candidate')
        await fs.mkdir(outside)
        await fs.copyFile(candidatePng, path.join(outside, 'image.png'))
        await fs.symlink(outside, path.join(root, 'resources/link'), 'junction')
      }
    })
    const harness = new LocalAgentHarness(repository, () => adapter), request = fileCandidateRequest(workspace)
    try {
      const id = await harness.generate(workspace, 'claude', request)
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'candidate-rejected', requestId: request.requestId,
        failure: { stepId: 'image', tool: 'asset.media.import', diagnostics: [{ code: 'candidate-media-file', path: ['steps', 0, 'input', 'base64'] }] } })
      const record = (await repository.list(workspace)).v2.find(value => value.id === id)!
      expect(record.hostResults).toEqual([])
      expect(record.tasks.at(-1)!.committedResultIds).toEqual([])
    } finally { await harness.close() }
  })

  it('does not return media or revive checking when Stop arrives during file ingestion', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapter = new FileNativeAdapter(writeMediaReferenceCandidate), request = fileCandidateRequest(workspace)
    const harness = new LocalAgentHarness(repository, () => adapter), reading = deferred<void>(), release = deferred<void>()
    const resolve = CandidateStaging.prototype.resolveMediaFiles
    const spy = vi.spyOn(CandidateStaging.prototype, 'resolveMediaFiles').mockImplementation(async function (this: CandidateStaging, candidate) {
      reading.resolve(); await release.promise; return resolve.call(this, candidate)
    })
    try {
      const id = await harness.generate(workspace, 'claude', request)
      await expect.poll(() => harness.running).toBe(false)
      const candidate = harness.candidate(workspace, id)
      await reading.promise
      await harness.cancel(workspace, id)
      release.resolve()
      await expect(candidate).rejects.toThrow(/inactive-task|stale-task/)
      const record = (await repository.list(workspace)).v2.find(value => value.id === id)!
      expect(record.tasks.at(-1)).toMatchObject({ status: 'cancelled', committedResultIds: [] })
      expect(record.hostResults).toEqual([])
    } finally { release.resolve(); spy.mockRestore(); await harness.close() }
  })
})

describe('Codex explicit candidate file delivery', () => {
  it('does not ingest or revive a cancelled turn while its candidate file is being read', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const request = fileCandidateRequest(workspace), adapter = new FileNativeAdapter(writeMediaReferenceCandidate)
    Object.defineProperty(adapter, 'id', { value: 'codex' })
    const stream = adapter.events.bind(adapter), reading = deferred<void>(), release = deferred<void>()
    adapter.events = async function* () {
      for await (const event of stream()) yield event.kind === 'text'
        ? { ...event, phase: 'candidate', text: generationStagedCandidateMarker(request.requestId) }
        : event.kind === 'configuration' ? { ...event, capabilities: { ...event.capabilities, adapter: 'codex' } } : event
    }
    const read = CandidateStaging.prototype.readText
    const spy = vi.spyOn(CandidateStaging.prototype, 'readText').mockImplementation(async function (this: CandidateStaging, requestId) {
      const text = await read.call(this, requestId); reading.resolve(); await release.promise; return text
    })
    const harness = new LocalAgentHarness(repository, () => adapter)
    try {
      const id = await harness.generate(workspace, 'codex', request)
      await reading.promise
      const stopping = harness.cancel(workspace, id)
      release.resolve(); await stopping
      const record = (await repository.list(workspace)).v2[0]!
      expect(record.tasks.at(-1)).toMatchObject({ status: 'cancelled', committedResultIds: [] })
      expect(record.events.some(event => event.kind === 'text' && event.itemId?.startsWith('candidate-file:'))).toBe(false)
      await expect(harness.candidate(workspace, id)).rejects.toThrow('尚未成功结束')
    } finally { release.resolve(); spy.mockRestore(); await harness.close() }
  })

  it.each(['valid', 'codex-wire', 'wire-missing-reason', 'wire-invalid-input', 'undeclared', 'missing', 'wrong-request', 'malformed'] as const)('handles %s staged results only after a successful native final', async scenario => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const request = fileCandidateRequest(workspace)
    const adapter = new FileNativeAdapter(async root => {
      if (scenario === 'missing') return
      await writeMediaReferenceCandidate(root)
      if (scenario === 'codex-wire' || scenario === 'wire-missing-reason' || scenario === 'wire-invalid-input') {
        const candidate = JSON.parse(await fs.readFile(path.join(root, 'candidate.json'), 'utf8'))
        candidate.steps.forEach((step: Record<string, unknown>) => {
          step.input = JSON.stringify(step.input)
          step.lowerCarrierReason = null
          if (scenario === 'wire-missing-reason') step.tool = 'component.package'
          if (scenario === 'wire-invalid-input') step.input = '{'
        })
        await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify(candidate))
      }
      if (scenario === 'wrong-request') {
        const candidate = JSON.parse(await fs.readFile(path.join(root, 'candidate.json'), 'utf8'))
        candidate.requestId = randomUUID()
        await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify(candidate))
      }
      if (scenario === 'malformed') await fs.writeFile(path.join(root, 'candidate.json'), '{')
    })
    Object.defineProperty(adapter, 'id', { value: 'codex' })
    const stream = adapter.events.bind(adapter)
    adapter.events = async function* () {
      for await (const event of stream()) {
        if (event.kind === 'text' && scenario !== 'undeclared') yield { ...event, phase: 'candidate', text: generationStagedCandidateMarker(request.requestId) }
        else if (event.kind === 'configuration') yield { ...event, capabilities: { ...event.capabilities, adapter: 'codex' } }
        else yield event
      }
    }
    const harness = new LocalAgentHarness(repository, () => adapter)
    try {
      const id = await harness.generate(workspace, 'codex', request)
      await expect.poll(() => harness.running).toBe(false)
      const record = (await repository.list(workspace)).v2[0]!
      if (scenario === 'missing') {
        // A declared but missing candidate file is a recoverable omission, not a
        // terminal protocol failure: the turn completes, the task stays checking
        // and the diagnosis names the cause, expected artifact and next step.
        expect(record.tasks.at(-1)?.status).toBe('checking')
        const missing = await harness.candidate(workspace, id)
        expect(missing).toMatchObject({ kind: 'candidate-format-error', requestId: request.requestId,
          finding: expect.stringContaining('candidate.json'),
          failure: { stage: 'candidate-parse', requestId: request.requestId, diagnostics: [{ code: 'missing-candidate-delivery' }] } })
        expect(record.events.some(event => event.kind === 'text' && event.itemId?.startsWith('candidate-file:'))).toBe(false)
      } else {
        const result = await harness.candidate(workspace, id)
        expect(result.kind).toBe(scenario === 'valid' || scenario === 'codex-wire' || scenario === 'wire-missing-reason' ? 'candidate' : scenario === 'undeclared' ? 'incomplete' : 'candidate-format-error')
        if (result.kind === 'candidate') {
          // Valid wire JSON is decoded; malformed input remains a format failure above.
          if (scenario === 'wire-missing-reason') expect(result.candidate.steps[0]!.input).toMatchObject({ base64: { $candidateFile: 'resources/小狗.png' } })
          else expect((result.candidate.steps[0]!.input as { base64: string }).base64).toBe((await fs.readFile(candidatePng)).toString('base64'))
          expect(await harness.candidate(workspace, id)).toEqual(result)
        }
      }
      expect(record.hostResults).toEqual([])
      expect(record.tasks.at(-1)?.committedResultIds).toEqual([])
      if (scenario === 'undeclared') expect(record.events.some(event => event.kind === 'text' && event.itemId?.startsWith('candidate-file:'))).toBe(false)
    } finally { await harness.close() }
  })

  it('recovers a declared-but-missing candidate file through one bounded native continuation', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapters: FileNativeAdapter[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const correction = adapters.length > 0
      const adapter = new FileNativeAdapter(async root => {
        if (!correction) return // First turn declares delivery but only prechecks: no candidate.json.
        const staged = JSON.parse(await fs.readFile(path.join(root, 'request.json'), 'utf8'))
        await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify({ version: 2, requestId: staged.requestId,
          summary: '修正候选交付', afterCommit: { version: 1, action: 'finish' },
          steps: [{ id: 'title', tool: 'native.content', destination: 'd1', input: { operation: 'edit', text: '修改后' } }] }))
      })
      Object.defineProperty(adapter, 'id', { value: 'codex' })
      const stream = adapter.events.bind(adapter)
      adapter.events = async function* () {
        for await (const event of stream()) {
          if (event.kind === 'text') yield { ...event, phase: 'candidate', text: generationStagedCandidateMarker(request!.requestId) }
          else if (event.kind === 'configuration') yield { ...event, capabilities: { ...event.capabilities, adapter: 'codex' } }
          else yield event
        }
      }
      adapters.push(adapter)
      return adapter
    })
    let request = fileCandidateRequest(workspace)
    try {
      const id = await harness.generate(workspace, 'codex', request)
      await expect.poll(() => harness.running).toBe(false)
      const missing = await harness.candidate(workspace, id)
      if (missing.kind !== 'candidate-format-error') throw new Error(`Expected a recoverable missing-delivery diagnosis, got ${missing.kind}`)
      expect(missing.finding).toContain('candidate.json')
      expect(missing.finding).toContain('--check')
      expect(missing.failure).toMatchObject({ stage: 'candidate-parse', requestId: request.requestId,
        diagnostics: [{ code: 'missing-candidate-delivery' }] })
      const before = (await repository.list(workspace)).v2[0]!
      expect(before.tasks[0]).toMatchObject({ status: 'checking', committedResultIds: [] })
      expect(before.events.some(event => event.kind === 'text' && event.itemId?.startsWith('candidate-file:'))).toBe(false)
      await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: missing.finding, failure: missing.failure })
      expect((await repository.list(workspace)).v2[0]!.tasks[0]!.execution!.formatRepairs).toBe(1)
      request = fileCandidateRequest(workspace)
      await harness.continue(workspace, id, request)
      await expect.poll(() => harness.running).toBe(false)
      const corrected = await harness.candidate(workspace, id)
      expect(corrected).toMatchObject({ kind: 'candidate', requestId: request.requestId })
      expect(adapters[1]!.opens[0]!.externalSessionId).toBe(adapters[0]!.nativeIdentity)
      expect(adapters[1]!.opens[0]!.candidateRoot).not.toBe(adapters[0]!.opens[0]!.candidateRoot)
      const current = (await repository.list(workspace)).v2[0]!
      expect(current.tasks[0]!.taskId).toBe(before.tasks[0]!.taskId)
      expect(current.tasks[0]!.execution).toMatchObject({ turnCount: 2, formatRepairs: 1, deadlineAt: before.tasks[0]!.execution!.deadlineAt })
      expect(current.hostResults.flatMap(result => result.receipts)).toEqual([])
    } finally { await harness.close() }
  })
})

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
  firstStatus: 'completed' | 'cancelled' = 'completed'
  observeFirstCancellation?: () => void
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
    const terminal = { ...identity, kind: 'turn-ended' as const, status: index === 0 ? this.firstStatus : 'completed' as const, failure: null }
    if (index === 0 && this.firstStatus === 'cancelled' && this.observeFirstCancellation) Object.defineProperty(terminal, 'status', {
      get: () => { this.observeFirstCancellation?.(); return 'cancelled' },
    })
    yield terminal
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
  it.each(['continue', 'stop', 'failed-ack'] as const)('persists correction before native interrupt and fences the old candidate on %s', async scenario => {
    const { repository, workspace, adapter, harness, id, input } = await inputBoundaryFixture()
    const interrupting = adapter as InputBoundaryAdapter & { interruptTurn(): Promise<void> }
    const interrupted = deferred<void>(), release = deferred<void>()
    const cancellationObserved = deferred<void>()
    adapter.observeFirstCancellation = () => cancellationObserved.resolve()
    interrupting.interruptTurn = async () => {
      const saved = (await repository.list(workspace)).v2[0]!
      expect(saved.tasks[0]!.pendingInputs).toEqual([{ inputId: input.inputId, kind: 'correct', text: input.text }])
      interrupted.resolve()
      await release.promise
      adapter.firstStatus = 'cancelled'
      adapter.finishFirst.resolve()
      if (scenario === 'failed-ack') { await cancellationObserved.promise; throw new Error('native interrupt was not confirmed') }
    }
    try {
      adapter.inputAck.resolve()
      const delivery = harness.input(workspace, id, { ...input, kind: 'correct' })
      const outcome = delivery.catch(error => error)
      await interrupted.promise
      expect(adapter.turns).toHaveLength(1)
      if (scenario === 'stop') await harness.cancel(workspace, id)
      release.resolve()
      await outcome
      if (scenario === 'continue') {
        await adapter.secondStarted.promise
        expect(adapter.turns[1]).toMatchObject({ taskId: input.taskId, epoch: input.epoch, text: expect.stringContaining(input.text) })
        adapter.secondAck.resolve()
        await expect.poll(() => harness.running).toBe(false)
        expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'candidate', candidate: { candidateId: adapter.candidateIds[1] } })
        expect((await repository.list(workspace)).v2[0]!.tasks[0]!.pendingInputs).toEqual([])
      } else {
        await expect.poll(() => harness.running).toBe(false)
        expect(adapter.turns).toHaveLength(1)
        await expect(harness.candidate(workspace, id)).rejects.toThrow('尚未成功结束')
        if (scenario === 'failed-ack') expect((await repository.list(workspace)).v2[0]!.tasks[0]!.pendingInputs).toHaveLength(1)
      }
    } finally { release.resolve(); adapter.secondAck.resolve(); await harness.close() }
  })
  it('does not mark a live turn interrupted when it finishes while an older session is being cleaned up', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    const request = generation(workspace)
    const adapter = new InputBoundaryAdapter(request)
    let first = true
    const harness = new LocalAgentHarness(repository, () => { if (first) { first = false; return new NativeAdapter() }; return adapter })
    const previousId = await harness.generate(workspace, 'claude', generation(workspace))
    await expect.poll(() => harness.running).toBe(false)
    await harness.cancel(workspace, previousId)
    const id = await harness.generate(workspace, 'claude', request)
    await adapter.firstEvents.promise
    const remove = CandidateStaging.prototype.remove
    let interleaved = false
    const cleanup = vi.spyOn(CandidateStaging.prototype, 'remove').mockImplementation(async function (this: CandidateStaging, requestId) {
      if (!interleaved) {
        interleaved = true
        adapter.finishFirst.resolve()
        await expect.poll(() => harness.running).toBe(false)
      }
      return remove.call(this, requestId)
    })
    try {
      await harness.list(workspace)
      expect(interleaved).toBe(true)
      const record = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(record.events.filter(event => event.kind === 'turn-ended')).toEqual([expect.objectContaining({ status: 'completed' })])
      expect(record.tasks.at(-1)?.status).toBe('checking')
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'candidate', candidate: { candidateId: adapter.candidateIds[0] } })
    } finally { cleanup.mockRestore(); await harness.close() }
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
      expect(waiting.events.filter(event => event.kind === 'user-message')).toMatchObject([
        { purpose: 'initial' }, { itemId: input.inputId, purpose: input.kind, text: input.text },
      ])
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
      expect(finished.events.filter(event => event.kind === 'user-message')).toHaveLength(2)
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
  it('continues an early answer once in the same native session and stops repeated incomplete replies within the existing budget', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapters: NativeAdapter[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      adapter.reply = `宿主不支持，所以尚未修改。${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, kind: 'answer' })}${GENERATION_RESULT_CLOSE}`
      adapters.push(adapter); return adapter
    })
    let request = { ...generation(workspace), intent: 'edit' as const }
    try {
      const id = await harness.generate(workspace, 'claude', request)
      for (let turn = 0; turn < 2; turn++) {
        await expect.poll(() => harness.running).toBe(false)
        const result = await harness.candidate(workspace, id)
        if (result.kind !== 'incomplete') throw new Error('Expected recoverable incomplete reply')
        expect(result.finding).toContain('project.document')
        await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: result.finding })
        request = { ...request, requestId: randomUUID() }
        if (turn === 0) await harness.continue(workspace, id, request)
        else await expect(harness.continue(workspace, id, request)).rejects.toThrow('预算已到或连续两轮没有进展')
      }
      expect(adapters).toHaveLength(2)
      expect(adapters[1]!.opens[0]!.externalSessionId).toBe(adapters[0]!.nativeIdentity)
      const record = (await repository.list(workspace)).v2[0]!
      expect(record.tasks).toHaveLength(1)
      expect(record.tasks[0]).toMatchObject({ committedResultIds: [], execution: { turnCount: 2, formatRepairs: 2 } })
      expect(record.hostResults.flatMap(result => result.receipts)).toEqual([])
    } finally { await harness.close() }
  })
  it('ends a blocked edit after rejected output with an honest reply instead of demanding a diagnostic candidate', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapters: NativeAdapter[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      adapter.reply = adapters.length === 0
        ? `${GENERATION_OPEN}${JSON.stringify({ version: 2, requestId: request!.requestId, summary: '无法取得所需素材', steps: [] })}${GENERATION_CLOSE}`
        : `当前已连接工具无法生成所需图片，也没有可用素材，课件尚未修改。${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, kind: 'answer' })}${GENERATION_RESULT_CLOSE}`
      adapters.push(adapter)
      return adapter
    })
    const request = { ...generation(workspace), instruction: '把图片替换为卡通小狗' }
    try {
      const id = await harness.generate(workspace, 'claude', request)
      await expect.poll(() => harness.running).toBe(false)
      const first = await harness.candidate(workspace, id)
      if (first.kind !== 'candidate-format-error') throw new Error('Empty candidate must remain invalid')
      await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: first.finding, failure: first.failure })
      const next = { ...request, requestId: randomUUID() }
      await harness.continue(workspace, id, next)
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'incomplete', requestId: next.requestId })
      const prompt = adapters[1]!.turns[0]!.text
      expect(prompt).toContain('CLI工具保持开放')
      expect(prompt).toContain('Keep cwd/permissions')
      expect(prompt).toContain('确实受阻时通过答复通道说明未完成')
      expect(prompt).not.toContain('若未完成请给下一阶段候选')
      const saved = (await repository.list(workspace)).v2[0]!
      expect(saved.tasks[0]).toMatchObject({ status: 'checking', committedResultIds: [], execution: { turnCount: 2, formatRepairs: 1 } })
      expect(saved.hostResults).toHaveLength(1)
      expect(saved.hostResults[0]).toMatchObject({ status: 'rejected', receipts: [] })
      expect(adapters).toHaveLength(2)
    } finally { await harness.close() }
  })

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
      expect(adapters[0]!.turns[0]!.text).toContain('修改先用实际能力准备有效候选')
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
      expect(prompt).not.toContain('本轮目标是修改')
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

  it('stops repeated same-reason rejections even when candidate content, summaries and step ids change', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter(), destination = structuredClone(request!.destinations[0]!)
      if (destination.kind === 'update') destination.target.authoringAddress = 'page/tile'
      // The invalid destination stays at steps[0] while every other aspect of the
      // candidate is rewritten, so only the failure reason repeats, not the change key.
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, candidateId: randomUUID(), summary: `修改标题 ${randomUUID()}`,
        steps: [{ id: randomUUID(), tool: 'native.content', carrier: 'native', destination, input: { label: `修改后 ${randomUUID()}` } }] })}${GENERATION_CLOSE}`
      return adapter
    })
    let request = generation(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    try {
      for (let index = 0; index < 3; index++) {
        await expect.poll(() => harness.running).toBe(false)
        const rejected = await harness.candidate(workspace, id)
        if (rejected.kind !== 'candidate-rejected') throw new Error('Expected semantic rejection')
        expect(rejected.failure).toMatchObject({ diagnostics: [{ code: 'scope-mismatch', path: ['steps', 0, 'destination'] }] })
        await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: rejected.candidateId,
          status: 'rejected', summary: `${rejected.finding} 第${index + 1}次改写说明`, failure: rejected.failure })
        if (index < 2) { request = generation(workspace); await harness.continue(workspace, id, request) }
      }
      const execution = (await repository.list(workspace)).v2[0]!.tasks[0]!.execution!
      expect(execution).toMatchObject({ formatRepairs: 0, stagnantCandidates: 2 })
      expect(execution.lastReasonKey).toMatch(/^failure-reason-v2:/)
      await expect(harness.continue(workspace, id, generation(workspace))).rejects.toThrow('连续两轮没有进展')
    } finally { await harness.close() }
  })

  it('stops reordered attempts of the same failing operation without relying on raw step ids', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    let turns = 0
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter(), bad = structuredClone(request!.destinations[0]!)
      if (bad.kind === 'update') bad.target.authoringAddress = 'page/tile'
      const steps = [
        { id: randomUUID(), tool: 'native.content', carrier: 'native', destination: bad, input: { label: 'same' } },
        { id: randomUUID(), tool: 'native.content', carrier: 'native', destination: request!.destinations[0], input: { label: 'valid' } },
      ]
      if (turns++ % 2) steps.reverse()
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId,
        candidateId: randomUUID(), summary: 'same operations', steps })}${GENERATION_CLOSE}`
      return adapter
    })
    let request = generation(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    try {
      for (let index = 0; index < 3; index++) {
        await expect.poll(() => harness.running).toBe(false)
        const result = await harness.candidate(workspace, id)
        if (result.kind !== 'candidate-rejected') throw new Error('Expected semantic rejection')
        await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: result.candidateId,
          status: 'rejected', summary: result.finding, failure: result.failure })
        if (index < 2) { request = generation(workspace); await harness.continue(workspace, id, request) }
      }
      expect((await repository.list(workspace)).v2[0]!.tasks[0]!.execution!.stagnantCandidates).toBe(2)
      await expect(harness.continue(workspace, id, generation(workspace))).rejects.toThrow('连续两轮没有进展')
    } finally { await harness.close() }
  })

  it('allows distinct field repairs through the same native task instead of treating their error code as stagnation', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    let turns = 0
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId,
        candidateId: randomUUID(), summary: 'repair field', steps: [{ id: 'edit', tool: 'native.content', carrier: 'native',
          destination: request!.destinations[0], input: { fontSize: ++turns } }] })}${GENERATION_CLOSE}`
      return adapter
    })
    let request = generation(workspace)
    const id = await harness.generate(workspace, 'claude', request)
    try {
      for (let index = 0; index < 3; index++) {
        await expect.poll(() => harness.running).toBe(false)
        const result = await harness.candidate(workspace, id)
        if (result.kind !== 'candidate') throw new Error('Expected candidate')
        await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: result.candidate.candidateId,
          status: 'rejected', summary: 'correct parameter', failure: { version: 1, stage: 'prepare', stepId: 'edit', tool: 'native.content',
            diagnostics: [{ code: 'invalid-input', message: 'correct parameter', path: ['input', 'fontSize'] }], assetIds: [], packageIds: [] } })
        expect((await repository.list(workspace)).v2[0]!.tasks[0]!.execution!.stagnantCandidates).toBe(0)
        request = generation(workspace); await harness.continue(workspace, id, request)
      }
      await expect.poll(() => harness.running).toBe(false)
      expect((await harness.candidate(workspace, id)).kind).toBe('candidate')
    } finally { await harness.close() }
  })

  it('marks an unfulfilled edit answer with a structured missing-delivery failure for bounded recovery', async () => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      adapter.reply = `宿主不支持，所以尚未修改。${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, kind: 'answer' })}${GENERATION_RESULT_CLOSE}`
      return adapter
    })
    const request = { ...generation(workspace), intent: 'edit' as const }
    try {
      const id = await harness.generate(workspace, 'claude', request)
      await expect.poll(() => harness.running).toBe(false)
      const result = await harness.candidate(workspace, id)
      expect(result).toMatchObject({ kind: 'incomplete', requestId: request.requestId,
        failure: { stage: 'candidate-parse', requestId: request.requestId,
          diagnostics: [{ code: 'missing-candidate-delivery', path: [] }], recovery: { action: 'repair-candidate' } } })
      if (result.kind !== 'incomplete' || !result.failure) throw new Error('Expected a structured missing-delivery failure')
      await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: result.finding, failure: result.failure })
      const record = (await repository.list(workspace)).v2[0]!
      expect(record.hostResults[0]).toMatchObject({ status: 'rejected', failure: { diagnostics: [{ code: 'missing-candidate-delivery' }] } })
      expect(record.tasks[0]!.execution).toMatchObject({ formatRepairs: 1, lastReasonKey: expect.stringMatching(/^failure-reason-v2:/) })
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
      expect(stored.tasks[0]!.status).toBe(intent === 'edit' ? 'checking' : 'completed')
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

  it.each(['repair', 'full-resources', 'prompt-budget'] as const)('offers rejected component source as read-only current-request input with %s', async scenario => {
    const { directory, workspace } = await fixture(), repository = new LocalAgentRepository(directory)
    const adapters: NativeAdapter[] = [], source = 'export const repaired = "previous uncommitted work";'
    let readRepair: any
    const request = { ...generation(workspace), allowedCarriers: ['native', 'generated-component'] as GenerationRequest['allowedCarriers'] }
    const harness = new LocalAgentHarness(repository, (_id, current) => {
      const adapter = new NativeAdapter()
      adapter.open = async function (input) {
        if (adapters.length === 2 && scenario === 'repair') {
          // A real child reads the source during native open, before startTurn,
          // using only this turn's advertised root and request resource index.
          readRepair = JSON.parse(execFileSync(process.execPath, ['-e', `
            const fs=require('node:fs'),path=require('node:path'),root=process.argv[1];
            const request=JSON.parse(fs.readFileSync(path.join(root,'request.json'),'utf8'));
            const entry=request.resourceIndex.find(file=>file.path.startsWith('resources/repair/')&&file.path.endsWith('/index.json'));
            const index=JSON.parse(fs.readFileSync(path.join(root,entry.path),'utf8'));
            process.stdout.write(JSON.stringify({index,files:index.changes.flatMap(change=>change.sources.map(source=>({
              packagePath:source.packagePath,text:fs.readFileSync(path.join(root,source.resourcePath),'utf8')
            })))}));
          `, input.candidateRoot!], { encoding: 'utf8', windowsHide: true }))
        }
        return NativeAdapter.prototype.open.call(this, input)
      }
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: current!.requestId, candidateId: randomUUID(), summary: '修复组件',
        steps: [{ id: 'component', tool: 'component.package', carrier: 'generated-component', destination: current!.destinations[0],
          input: { operation: 'patch', mode: 'shared', basePackageId: 'com.example.fixture', baseVersion: '1.0.0', baseContentIdentity: 'frozen-base',
            changedFiles: { 'runtime.js': { encoding: 'utf8', text: source }, 'manifest.json': Buffer.from('{"name":"修复"}').toString('base64'),
              ...(scenario === 'prompt-budget' ? Object.fromEntries(Array.from({ length: 850 }, (_, i) => [`part-${i}.js`, { encoding: 'utf8', text: 'export{}' }])) : {}) }, deleteFiles: [] } },
        { id: 'layout', tool: 'native.content', carrier: 'native', destination: current!.destinations[0], input: { operation: 'invalid-layout' } }] })}${GENERATION_CLOSE}`
      adapters.push(adapter); return adapter
    })
    try {
      const id = await harness.generate(workspace, 'claude', request)
      await expect.poll(() => harness.running).toBe(false)
      const output = await harness.candidate(workspace, id)
      if (output.kind !== 'candidate') throw new Error('Expected a parsed candidate')
      await expect(fs.access(adapters[0]!.opens[0]!.candidateRoot!)).rejects.toMatchObject({ code: 'ENOENT' })
      const failure = { version: 1 as const, stage: 'prepare' as const, requestId: request.requestId, candidateId: output.candidate.candidateId,
        stepId: 'layout', tool: 'native.content', destination: request.destinations[0],
        diagnostics: [{ code: 'unsupported-operation', path: ['input', 'operation'], message: 'Use the current layout tool.' }], assetIds: [], packageIds: [] }
      await harness.hostResult(workspace, id, { requestId: request.requestId, candidateId: output.candidate.candidateId,
        status: 'rejected', summary: '后置布局步骤失败，整个候选未提交', failure })
      const saved = (await repository.list(workspace)).v2[0]!, task = saved.tasks[0]!, result = saved.hostResults[0]!
      const next = { ...request, requestId: randomUUID(), ...(scenario === 'full-resources'
        ? { resourceFiles: Array.from({ length: 1000 }, (_, i) => ({ path: `input/${i}.txt`, encoding: 'utf8' as const, content: '' })) } : {}),
        ...(scenario === 'prompt-budget' ? { context: { requiredContext: 'x'.repeat(80_000) } } : {}) }
      const proposal = { version: 1 as const, taskId: task.taskId, epoch: task.epoch, workspace, observationId: task.observationId!,
        requestId: request.requestId, candidateId: output.candidate.candidateId, candidate: output.candidate }
      // Only the same task's current accepted proposal can supply read-only work.
      for (const changed of [{ ...proposal, taskId: randomUUID() }, { ...proposal, epoch: task.epoch + 1 },
        { ...proposal, requestId: randomUUID() }, { ...proposal, candidateId: randomUUID() }, undefined]) {
        expect(generationRepairInputs(next, request, task, result, changed)).toEqual({ request: next })
      }
      expect(generationRepairInputs(next, request, { ...task, status: 'cancelled' }, result, proposal)).toEqual({ request: next })
      expect(generationRepairInputs(next, request, { ...task, execution: { ...task.execution!, deadlineAt: Date.now() - 1 } }, result, proposal)).toEqual({ request: next })
      expect(generationRepairInputs(next, request, task, { ...result, status: 'stale' }, proposal)).toEqual({ request: next })
      if (scenario === 'prompt-budget') {
        const enriched = generationRepairInputs(next, request, task, result, proposal)
        const root = path.join(path.dirname(adapters[0]!.opens[0]!.candidateRoot!), next.requestId)
        expect(Buffer.byteLength(buildGenerationPrompt('claude', next, root, 'host-feedback'))).toBeLessThan(MAX_GENERATION_PROMPT_BYTES)
        expect(Buffer.byteLength(buildGenerationPrompt('claude', enriched.request, root, 'host-feedback'))).toBeGreaterThan(MAX_GENERATION_PROMPT_BYTES)
      }
      await harness.continue(workspace, id, next)
      await expect.poll(() => harness.running).toBe(false)
      const root = adapters[1]!.opens[0]!.candidateRoot!
      const staged = JSON.parse(await fs.readFile(path.join(root, 'request.json'), 'utf8'))
      expect(staged.requestId).toBe(next.requestId)
      const entry = staged.resourceIndex.find((file: { path: string }) => file.path.startsWith('resources/repair/') && file.path.endsWith('/index.json'))
      const prompt = adapters[1]!.turns[0]!.text
      if (scenario === 'repair') {
        expect(prompt).toContain(entry.path)
        expect(prompt).toContain('不得沿用原 requestId')
        const read = readRepair
        expect(read.index).toMatchObject({ purpose: 'repair-input-only', origin: { taskId: task.taskId, requestId: request.requestId,
          candidateId: output.candidate.candidateId, documentRevision: request.documentRevision }, changes: [{ stepId: 'component' }] })
        expect(read.files).toEqual([{ packagePath: 'runtime.js', text: source }, { packagePath: 'manifest.json', text: '{"name":"修复"}' }])
        expect(read.index.changes).toHaveLength(1)
        expect(read.index.changes[0].originalInput).not.toHaveProperty('changedFiles')
      } else {
        expect(entry).toBeUndefined()
        expect(staged.resourceIndex).toHaveLength(scenario === 'full-resources' ? 1000 : 0)
        expect(prompt).toContain('已省略复用')
      }
      const after = (await repository.list(workspace)).v2[0]!
      expect(after.tasks[0]!.execution!.deadlineAt).toBe(task.execution!.deadlineAt)
      expect(after.tasks[0]!.committedResultIds).toEqual([])
      expect(after.hostResults).toHaveLength(1)
      expect(after.hostResults[0]).toMatchObject({ status: 'rejected', beforeRevision: 1, afterRevision: 1, receipts: [] })
      await harness.cancel(workspace, id)
      await expect(harness.continue(workspace, id, { ...request, requestId: randomUUID() })).rejects.toThrow('没有可续轮')
      await harness.list(workspace)
      await expect(fs.access(root)).rejects.toMatchObject({ code: 'ENOENT' })
      await harness.generate(workspace, 'claude', { ...request, requestId: randomUUID() }, id)
      await expect.poll(() => harness.running).toBe(false)
      const fresh = JSON.parse(await fs.readFile(path.join(adapters[2]!.opens[0]!.candidateRoot!, 'request.json'), 'utf8'))
      expect(fresh.resourceIndex.some((file: { path: string }) => file.path.startsWith('resources/repair/'))).toBe(false)
    } finally { await harness.close() }
  })

  it('preserves fully prepared feedback inputs while launch persistence races with session listing', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory), adapters: NativeAdapter[] = []
    const inputsRead: string[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter()
      adapter.open = async function (input) {
        const staged = JSON.parse(await fs.readFile(path.join(input.candidateRoot!, 'request.json'), 'utf8'))
        expect(staged.requestId).toBe(request!.requestId)
        expect(await fs.readFile(staged.resourceIndex.find((file: { path: string }) => file.path.endsWith('source.txt')).localPath, 'utf8')).toBe('frozen source')
        await fs.access(staged.fileAccess.discovery)
        await fs.access(staged.fileAccess.candidateHelper)
        inputsRead.push(staged.requestId)
        return NativeAdapter.prototype.open.call(this, input)
      }
      adapters.push(adapter)
      return adapter
    })
    const request = { ...generation(workspace), resourceFiles: [{ path: 'source.txt', encoding: 'utf8' as const, content: 'frozen source' }] }
    const id = await harness.generate(workspace, 'claude', request)
    await expect.poll(() => harness.running).toBe(false)
    const incomplete = await harness.candidate(workspace, id)
    expect(incomplete.kind).toBe('incomplete')
    await harness.hostResult(workspace, id, { requestId: request.requestId, status: 'rejected', summary: '请修正候选' })
    const prior = (await repository.list(workspace)).v2[0]!
    const next = { ...request, requestId: randomUUID() }
    const staged = path.join(repository.stagingPath(workspace, prior.workingDirectoryId, 2), 'candidates', next.requestId)
    const persisted = deferred<void>(), release = deferred<void>()
    const originalWrite = repository.write.bind(repository)
    let held = false
    const write = vi.spyOn(repository, 'write').mockImplementation(async record => {
      await originalWrite(record)
      if (!held && record.id === id && record.tasks.at(-1)?.status === 'running') {
        held = true; persisted.resolve(); await release.promise
      }
    })
    const continuing = harness.continue(workspace, id, next)
    try {
      await persisted.promise
      expect(adapters[1]!.opens).toHaveLength(0)
      await fs.access(path.join(staged, 'request.json'))
      // The durable record still projects the previous native turn's completion.
      // Listing must honor the launch owner before active.set registers the run.
      await harness.list(workspace)
      await harness.read(workspace, id)
      await expect(fs.access(path.join(staged, 'request.json'))).resolves.toBeUndefined()
      release.resolve(); await continuing
      await expect.poll(() => harness.running).toBe(false)
      expect(inputsRead).toEqual([request.requestId, next.requestId])
      expect(adapters[1]!.opens[0]!.externalSessionId).toBe('native-confirmed-session')
      expect(adapters[1]!.turns).toHaveLength(1)
      expect(adapters[1]!.turns[0]!.text).toContain('rejected')
      const after = (await repository.list(workspace)).v2[0]!
      expect(after.tasks[0]!.execution!.deadlineAt).toBe(prior.tasks[0]!.execution!.deadlineAt)
      await harness.cancel(workspace, id)
      await harness.list(workspace)
      await expect(fs.access(staged)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { release.resolve(); await continuing; write.mockRestore(); await harness.close() }
  })

  it('keeps a feedback turn live while its acknowledged receipt is persisting, and preserves Stop', async () => {
    const { directory, workspace } = await fixture()
    const repository = new LocalAgentRepository(directory)
    const candidates: string[] = []
    const harness = new LocalAgentHarness(repository, (_id, request) => {
      const adapter = new NativeAdapter(), candidateId = randomUUID(); candidates.push(candidateId)
      adapter.reply = `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: request!.requestId, candidateId, summary: '修改标题',
        steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination: request!.destinations[0], input: { operation: 'properties', properties: { label: '阶段' } } }] })}${GENERATION_CLOSE}`
      return adapter
    })
    const request = generation(workspace), id = await harness.generate(workspace, 'claude', request)
    await expect.poll(() => harness.running).toBe(false)
    expect((await harness.candidate(workspace, id)).kind).toBe('candidate')
    const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: request.requestId, candidateId: candidates[0]!, status: 'committed',
      beforeRevision: 1, afterRevision: 2, affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }
    const result = { requestId: request.requestId, candidateId: candidates[0]!, status: 'committed' as const, beforeRevision: 1, afterRevision: 2, summary: '已提交第一阶段' }
    await harness.hostResult(workspace, id, result, receipt)
    let release!: () => void, persisting = false
    const gate = new Promise<void>(resolve => { release = resolve }), originalWrite = repository.write.bind(repository)
    const write = vi.spyOn(repository, 'write').mockImplementation(async record => {
      if (!persisting && record.id === id && record.tasks.at(-1)?.status === 'running' && record.hostResults.some(value => value.receiptDelivery === 'delivered')) {
        persisting = true; await gate
      }
      return originalWrite(record)
    })
    try {
      const next = generation(workspace, 2)
      await harness.continue(workspace, id, next)
      await expect.poll(() => persisting).toBe(true)
      const live = (await harness.list(workspace)).records.find(record => record.id === id)!
      expect(live).toMatchObject({ status: 'running', generationRequestId: next.requestId, task: { status: 'running' } })
      expect(live.events.some(event => ['completed', 'failed', 'cancelled'].includes(event.kind))).toBe(false)
      expect((await harness.read(workspace, id)).records).toEqual([live])
      await expect(harness.hostResult(workspace, id, result, receipt)).rejects.toThrow('宿主结果不属于已结束的当前请求')
      const stopping = harness.cancel(workspace, id)
      try {
        await expect.poll(async () => (await harness.list(workspace)).records.find(record => record.id === id)?.task?.status).toBe('partial')
        expect((await harness.list(workspace)).records.find(record => record.id === id)?.status).toBe('failed')
      } finally { release(); await stopping }
      const saved = (await repository.list(workspace)).v2.find(record => record.id === id)!
      expect(saved.hostResults).toHaveLength(1)
      expect(saved.hostResults[0]!.receipts).toEqual([receipt])
    } finally { release(); await harness.close(); write.mockRestore() }
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
    const feedbackResult = JSON.parse(adapters[1]!.turns[0]!.text.split('已记录的宿主结果（拒绝不代表提交）：\n')[1]!.split('\n')[0]!)
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
      const pending = await f.harness.read(f.workspace, f.id)
      expect(pending.records).toHaveLength(1)
      expect(pending.records[0]).toMatchObject({ id: f.id, task: { status: 'completed' }, hostResult: { status: 'committed' } })
      expect(pending.damaged).not.toEqual([])
      expect(await f.harness.read({ ...f.workspace, projectId: 'other-project' }, f.id)).toEqual({ records: [], damaged: [] })
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
      expect(adapter.turns[0]!.text).toContain('保留已经提交的成果，不重复执行')
      const feedback = JSON.parse(adapter.turns[0]!.text.split('\n')[1]!)
      expect(feedback.workspace).toEqual(f.workspace)
      expect(feedback.results).toHaveLength(1)
      expect(feedback.results[0]).toMatchObject({ requestId: f.receipt.requestId, candidateId: f.receipt.candidateId,
        status: 'committed', beforeRevision: f.receipt.beforeRevision, afterRevision: f.receipt.afterRevision,
        affected: f.receipt.affected.map(({ id, operation, ownerKey }) => ({ id, operation, ownerKey })), resources: [f.receipt.resources] })
      expect(feedback.results[0]).not.toHaveProperty('receipts')
      expect((await f.repository.list(f.workspace)).v2.find(record => record.id === f.id)!.hostResults[0]!.receipts).toEqual([f.receipt])
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
  it('delivers rejected diagnostics on explicit recovery only after native acknowledgement and persists the real user message', async () => {
    const f = await finishFixture()
    const failure = { version: 1 as const, stage: 'prepare' as const, requestId: f.request.requestId, candidateId: f.receipt.candidateId,
      stepId: 'background', tool: 'native.content', destination: f.request.destinations[0]!,
      diagnostics: [{ code: 'controlled-fast-path-failure', message: 'Use a supported base command', path: ['steps', 0] }], assetIds: ['reusable-image'], packageIds: [] }
    await f.harness.hostResult(f.workspace, f.id, { requestId: f.request.requestId, candidateId: f.receipt.candidateId, status: 'rejected', summary: '背景快捷入口失败', failure })
    const ack = deferred<void>(), adapter = new NativeAdapter(), reopened = new LocalAgentHarness(new LocalAgentRepository(f.directory), () => adapter)
    const original = adapter.startTurn.bind(adapter)
    adapter.startTurn = async input => { const result = await original(input); await ack.promise; return result }
    try {
      const next = generation(f.workspace)
      next.instruction = `${f.request.instruction}\n用户明确继续：继续`
      const id = await reopened.generate(f.workspace, 'claude', next, f.id, '继续')
      await expect.poll(() => adapter.turns.length).toBe(1)
      const text = adapter.turns[0]!.text
      expect(text).toContain('rejected / stale / failed 均未应用该候选')
      expect(text).toContain('本轮若仅询问状态或停止原因，只作解释，不自动继续编辑')
      expect(JSON.parse(text.split('\n')[1]!).results[0]).toMatchObject({ status: 'rejected', failure, affected: [], resources: [] })
      let records = (await f.repository.list(f.workspace)).v2
      expect(records.find(record => record.id === f.id)!.hostResults.at(-1)?.receiptDelivery).toBe('pending')
      expect(records.find(record => record.id === id)!.events.filter(event => event.kind === 'user-message')).toMatchObject([{ text: '继续', purpose: 'initial' }])
      ack.resolve(); await expect.poll(() => reopened.running).toBe(false)
      records = (await f.repository.list(f.workspace)).v2
      expect(records.find(record => record.id === f.id)!.hostResults.at(-1)?.receiptDelivery).toBe('delivered')
      expect(records.flatMap(record => record.hostResults).flatMap(result => result.receipts)).toEqual([])
    } finally { ack.resolve(); await reopened.close(); await f.harness.close() }
  })
  it('keeps rejected feedback pending when recovery transport refuses the native turn', async () => {
    const f = await finishFixture()
    await f.harness.hostResult(f.workspace, f.id, { requestId: f.request.requestId, candidateId: f.receipt.candidateId, status: 'rejected', summary: '可恢复失败' })
    const adapter = new NativeAdapter()
    adapter.startTurn = async () => { throw new Error('native start rejected') }
    const reopened = new LocalAgentHarness(new LocalAgentRepository(f.directory), () => adapter)
    try {
      await reopened.resume(f.workspace, f.id, '为什么停止')
      await expect.poll(() => reopened.running).toBe(false)
      expect((await f.repository.list(f.workspace)).v2.find(record => record.id === f.id)!.hostResults.at(-1)?.receiptDelivery).toBe('pending')
    } finally { await reopened.close(); await f.harness.close() }
  })
  it('archives a delayed rejection after Stop without reviving the task or accepting a late checked candidate', async () => {
    const f = await finishFixture()
    try {
      await f.harness.cancel(f.workspace, f.id)
      const stopped = (await f.repository.list(f.workspace)).v2[0]!.tasks.at(-1)!
      const result = { requestId: f.request.requestId, candidateId: f.receipt.candidateId, status: 'rejected' as const, summary: 'IPC重试补存的失败原因' }
      await f.harness.hostResult(f.workspace, f.id, result)
      await f.harness.hostResult(f.workspace, f.id, result)
      const stored = (await f.repository.list(f.workspace)).v2[0]!
      expect(stored.tasks.at(-1)).toMatchObject({ status: stopped.status, epoch: stopped.epoch })
      expect(stored.hostResults).toHaveLength(1)
      expect(stored.hostResults[0]).toMatchObject({ status: 'rejected', receiptDelivery: 'pending', receipts: [] })
      await expect(f.harness.hostResult(f.workspace, f.id, { ...result, status: 'checked' })).rejects.toThrow('停止')
      await expect(f.harness.continue(f.workspace, f.id, generation(f.workspace))).rejects.toThrow('没有可续轮')
    } finally { await f.harness.close() }
  })
  it('persists idle user corrections once without changing the last candidate run or losing its completed native status', async () => {
    const f = await finishFixture()
    try {
      const before = (await f.repository.list(f.workspace)).v2[0]!, task = before.tasks.at(-1)!, runId = before.events.at(-1)!.runId
      const input = { version: 1 as const, taskId: task.taskId, epoch: task.epoch, workspace: f.workspace, inputId: randomUUID(), turnId: null,
        kind: 'supplement' as const, text: '请保留已经生成的图片' }
      await f.harness.input(f.workspace, f.id, input)
      await f.harness.input(f.workspace, f.id, input)
      const saved = (await f.repository.list(f.workspace)).v2[0]!
      expect(saved.events.at(-1)).toMatchObject({ kind: 'user-message', itemId: input.inputId, runId, text: input.text })
      expect(saved.events.filter(event => event.kind === 'user-message' && event.itemId === input.inputId)).toHaveLength(1)
      expect((await f.harness.list(f.workspace)).records[0]!.status).toBe('completed')
      expect(await f.harness.candidate(f.workspace, f.id)).toMatchObject({ kind: 'incomplete', requestId: f.request.requestId,
        finding: expect.stringContaining('旧候选尚未应用') })
    } finally { await f.harness.close() }
  })

  it('does not revive an idle task when correction persistence resumes after Stop', async () => {
    const f = await finishFixture(), captured = deferred<void>(), release = deferred<void>()
    const before = (await f.repository.list(f.workspace)).v2[0]!, task = before.tasks.at(-1)!
    const list = f.repository.list.bind(f.repository)
    let delayed = false
    f.repository.list = async workspace => {
      const value = await list(workspace)
      if (!delayed) { delayed = true; captured.resolve(); await release.promise }
      return value
    }
    try {
      const input = f.harness.input(f.workspace, f.id, { version: 1, taskId: task.taskId, epoch: task.epoch, workspace: f.workspace,
        inputId: randomUUID(), turnId: null, kind: 'correct', text: '以最新要求为准' })
      const result = input.catch(error => error)
      await captured.promise
      await f.harness.cancel(f.workspace, f.id)
      release.resolve()
      expect(await result).toMatchObject({ message: expect.stringContaining('任务已停止') })
      const after = (await f.repository.list(f.workspace)).v2[0]!
      expect(after.tasks.at(-1)).toMatchObject({ status: 'cancelled', epoch: task.epoch + 1 })
      expect(f.harness.running).toBe(false)
      await expect(f.harness.candidate(f.workspace, f.id)).rejects.toThrow('尚未成功结束')
    } finally { release.resolve(); await f.harness.close() }
  })
})
