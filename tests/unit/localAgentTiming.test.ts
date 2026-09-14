// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalAgentHarness } from '../../src/main/localAgent/harness'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import { generationRequestSchema, type GenerationRequest, type GenerationCommitReceipt } from '../../src/shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE } from '../../src/shared/generationResult'
import { aiTaskSchema, localAgentRecordV2Schema, MAX_AI_TASK_TIMING_ENTRIES,
  type AiTask, type LocalAgentCapabilities, type LocalAgentCliAdapterV2, type LocalAgentNativeEvent } from '../../src/shared/localAgentTaskContract'
import { recordAiTaskTiming, summarizeAiTaskTiming } from '../../src/shared/localAgentTiming'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-timing-'))
  directories.push(directory)
  const workspace = createWorkspaceIdentity('timing-project', path.join(directory, '中文 course.h5lesson'))
  return { directory, workspace, repository: new LocalAgentRepository(directory) }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(accept => { resolve = accept })
  return { promise, resolve }
}
function request(workspace: Awaited<ReturnType<typeof fixture>>['workspace']): GenerationRequest {
  return generationRequestSchema.parse({ version: 1, requestId: randomUUID(), workspace, documentRevision: 1, sessionGeneration: 1,
    purpose: 'local-edit', intent: 'edit', applyPolicy: 'preview', instruction: '修改标题', context: {}, allowedCarriers: ['native'],
    destinations: [{ kind: 'update', target: { projectId: workspace.projectId, documentRevision: 1, revisionPolicy: { kind: 'exact' },
      sessionGeneration: 1, surfaceType: 'slide', surfaceId: 'slides', locationId: 'page', stateId: null, owner: 'scene',
      ownerKey: 'scene:page', itemId: 'title', authoringAddress: 'page/title' } }],
  })
}
const capabilities: LocalAgentCapabilities = { version: 1, adapter: 'claude', cliVersion: 'timing-fixture', models: [],
  current: { model: null, resolvedModel: null, effort: null },
  input: { image: 'unknown', readFile: 'supported', question: 'unknown', correction: 'turn-boundary', cancel: 'supported' } }
class TimingAdapter implements LocalAgentCliAdapterV2 {
  readonly id = 'claude' as const
  phase: 'idle' | 'open' | 'start' | 'events' = 'idle'
  gate = deferred()
  blocked?: 'open' | 'start' | 'events'
  failOpen = false
  publicUpdates = 128
  turns: Parameters<LocalAgentCliAdapterV2['startTurn']>[0][] = []
  constructor(private readonly generation?: GenerationRequest) {}
  async open() {
    this.phase = 'open'
    if (this.failOpen) throw new Error('native unavailable')
    if (this.blocked === 'open') await this.gate.promise
    return { externalSessionId: 'timing-session', capabilities }
  }
  async configure() { return capabilities }
  async startTurn(input: Parameters<LocalAgentCliAdapterV2['startTurn']>[0]) {
    this.turns.push(input); this.phase = 'start'
    if (this.blocked === 'start') await this.gate.promise
    return { nativeTurnId: input.runId }
  }
  async input(input: Parameters<LocalAgentCliAdapterV2['input']>[0]): ReturnType<LocalAgentCliAdapterV2['input']> {
    return { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, inputId: input.inputId,
      turnId: input.turnId, status: 'rejected', reason: 'fixture' }
  }
  async *events(): AsyncIterable<LocalAgentNativeEvent> {
    this.phase = 'events'
    if (this.blocked === 'events') await this.gate.promise
    const turn = this.turns.at(-1)!
    const identity = { taskId: turn.taskId, epoch: turn.epoch, workspace: turn.workspace, runId: turn.runId, nativeTurnId: turn.runId }
    yield { ...identity, kind: 'configuration', capabilities }
    for (let index = 0; index < this.publicUpdates; index++) yield { ...identity, kind: 'text', itemId: 'progress', phase: 'public-summary', operation: 'append', text: '.' }
    const text = this.generation ? `${GENERATION_OPEN}${JSON.stringify({ version: 1, requestId: this.generation.requestId,
      candidateId: randomUUID(), summary: '修改标题', steps: [{ id: 'title', tool: 'native.content', carrier: 'native',
        destination: this.generation.destinations[0], input: {} }] })}${GENERATION_CLOSE}` : 'done'
    yield { ...identity, kind: 'text', itemId: 'reply', phase: 'body', operation: 'replace', text }
    yield { ...identity, kind: 'turn-ended', status: 'completed', failure: null }
  }
  async close() { this.gate.resolve() }
}

describe('bounded native task timing', () => {
  it('does not count hidden body candidate envelopes as a first visible reply', async () => {
    const { workspace, repository } = await fixture()
    const harness = new LocalAgentHarness(repository, (_id, generation) => {
      const adapter = new TimingAdapter(generation); adapter.publicUpdates = 0; return adapter
    })
    try {
      const id = await harness.generate(workspace, 'claude', request(workspace))
      await expect.poll(() => harness.running).toBe(false)
      expect((await harness.candidate(workspace, id)).kind).toBe('candidate')
      const timing = summarizeAiTaskTiming((await repository.list(workspace)).v2[0]!.tasks[0]!)[0]!
      expect(timing.marks.candidateParsed).toBeTypeOf('number')
      expect(timing.marks.firstVisibleText).toBeUndefined()
      expect(timing.durationsMs.acceptedToFirstVisibleText).toBeNull()
    } finally { await harness.close() }
  })
  it('persists distinct candidate, preview and actual commit boundaries without per-token writes', async () => {
    const { workspace, repository, directory } = await fixture()
    const writes = vi.spyOn(repository, 'write')
    const harness = new LocalAgentHarness(repository, (_id, generation) => new TimingAdapter(generation))
    try {
      const generation = request(workspace), id = await harness.generate(workspace, 'claude', generation)
      await expect.poll(() => harness.running).toBe(false)
      const result = await harness.candidate(workspace, id)
      if (result.kind !== 'candidate') throw new Error('Expected candidate')
      const before = (await repository.list(workspace)).v2[0]!.tasks[0]!
      expect(summarizeAiTaskTiming(before)[0]!.durationsMs.candidateParsedToHostCommitRecorded).toBeNull()
      await harness.candidate(workspace, id)
      const checked = { requestId: generation.requestId, candidateId: result.candidate.candidateId, status: 'checked' as const, summary: '检查通过' }
      await harness.hostResult(workspace, id, checked)
      await harness.hostResult(workspace, id, checked)
      const preview = (await repository.list(workspace)).v2[0]!.tasks[0]!
      expect(summarizeAiTaskTiming(preview)[0]!.marks.hostCommitRecorded).toBeUndefined()
      const receipt: GenerationCommitReceipt = { version: 1, workspace, requestId: generation.requestId, candidateId: result.candidate.candidateId,
        status: 'committed', beforeRevision: 1, afterRevision: 2,
        affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }
      const applied = { ...checked, status: 'committed' as const, summary: '已应用' }
      await harness.hostResult(workspace, id, applied, receipt)
      await harness.hostResult(workspace, id, applied, receipt)
      const saved = (await new LocalAgentRepository(directory).list(workspace)).v2[0]!
      const entries = saved.tasks[0]!.execution!.timing!.entries
      expect(entries.map(entry => entry.stage)).toEqual(['requestPrepared', 'nativeOpenStarted', 'nativeOpened', 'turnDispatchStarted',
        'turnAccepted', 'firstNativeEvent', 'firstVisibleText', 'candidateParsed', 'resourcePreparationStarted', 'resourcePrepared', 'hostResultRecorded', 'hostCommitRecorded'])
      expect(entries.map(entry => entry.at)).toEqual(entries.map(entry => entry.at).sort((a, b) => a - b))
      expect(entries.find(entry => entry.stage === 'candidateParsed')).toEqual(before.execution!.timing!.entries.find(entry => entry.stage === 'candidateParsed'))
      expect(entries.find(entry => entry.stage === 'hostResultRecorded')).toEqual(preview.execution!.timing!.entries.at(-1))
      const { preparedToTaskEnded, ...confirmedDurations } = summarizeAiTaskTiming(saved.tasks[0]!)[0]!.durationsMs
      expect(preparedToTaskEnded).toBeNull() // This candidate requested another observation, not task completion.
      expect(Object.values(confirmedDurations).every(value => value !== null && value >= 0)).toBe(true)
      expect(writes.mock.calls.length).toBeLessThan(20)
    } finally { await harness.close() }
  })

  it('separates continued observations, retains the task deadline and reads old records without timing', async () => {
    const { workspace, repository, directory } = await fixture()
    const harness = new LocalAgentHarness(repository, (_id, generation) => new TimingAdapter(generation))
    try {
      const first = request(workspace), id = await harness.generate(workspace, 'claude', first)
      await expect.poll(() => harness.running).toBe(false)
      const candidate = await harness.candidate(workspace, id)
      if (candidate.kind !== 'candidate') throw new Error('Expected candidate')
      await harness.hostResult(workspace, id, { requestId: first.requestId, candidateId: candidate.candidate.candidateId, status: 'rejected', summary: '需要修复' })
      const before = (await repository.list(workspace)).v2[0]!.tasks[0]!
      await harness.continue(workspace, id, request(workspace))
      await expect.poll(() => harness.running).toBe(false)
      const saved = (await repository.list(workspace)).v2[0]!, task = saved.tasks[0]!
      const runs = summarizeAiTaskTiming(task)
      expect(runs).toHaveLength(2)
      expect(runs[0]!.observationId).not.toBe(runs[1]!.observationId)
      expect(runs[1]!.marks.candidateParsed).toBeUndefined()
      expect(runs[1]!.marks.hostResultRecorded).toBeUndefined()
      expect(task.execution!.deadlineAt).toBe(before.execution!.deadlineAt)
      expect(task.execution!.turnCount).toBe(2)
      const { timing: _timing, ...oldExecution } = task.execution!
      saved.tasks[0] = aiTaskSchema.parse({ ...task, execution: oldExecution })
      await repository.write(saved)
      const old = (await new LocalAgentRepository(directory).list(workspace)).v2[0]!
      expect(summarizeAiTaskTiming(old.tasks[0]!)).toEqual([])
      expect(localAgentRecordV2Schema.safeParse({ ...old, tasks: [{ ...task, execution: { ...task.execution, timing: {
        version: 1, entries: [{ ...task.execution!.timing!.entries[0], observationId: randomUUID() }],
      } } }] }).success).toBe(false)
    } finally { await harness.close() }
  })

  it.each(['open', 'start', 'events'] as const)('ignores late native %s work after Stop and keeps a new task independent', async blocked => {
    const { workspace, repository } = await fixture()
    const oldAdapter = new TimingAdapter(); oldAdapter.blocked = blocked
    let calls = 0
    const harness = new LocalAgentHarness(repository, () => calls++ ? new TimingAdapter() : oldAdapter)
    try {
      const id = await harness.start(workspace, 'claude', 'wait')
      await expect.poll(() => oldAdapter.phase).toBe(blocked)
      await harness.cancel(workspace, id)
      const stopped = (await repository.list(workspace)).v2.find(record => record.id === id)!.tasks[0]!
      const marks = summarizeAiTaskTiming(stopped)[0]!.marks
      expect(stopped.status).toBe('cancelled')
      expect(marks.firstNativeEvent).toBeUndefined()
      if (blocked === 'open') expect(marks.nativeOpened).toBeUndefined()
      if (blocked !== 'events') expect(marks.turnAccepted).toBeUndefined()
      const next = await harness.start(workspace, 'claude', 'fresh')
      await expect.poll(() => harness.running).toBe(false)
      const records = (await repository.list(workspace)).v2
      expect(records.find(record => record.id === id)!.tasks[0]!.execution!.timing).toEqual(stopped.execution!.timing)
      expect(summarizeAiTaskTiming(records.find(record => record.id === next)!.tasks[0]!)[0]!.marks.firstNativeEvent).toBeTypeOf('number')
    } finally { await harness.close() }
  })

  it('does not invent successful boundaries on native failure, stale identity, full buffers or clock reversal', async () => {
    const { workspace, repository } = await fixture()
    const adapter = new TimingAdapter(); adapter.failOpen = true
    const harness = new LocalAgentHarness(repository, () => adapter)
    try {
      await harness.start(workspace, 'claude', 'fail open')
      await expect.poll(() => harness.running).toBe(false)
      const task = (await repository.list(workspace)).v2[0]!.tasks[0]!
      expect(task.status).toBe('failed')
      expect(summarizeAiTaskTiming(task)[0]!.durationsMs.nativeOpen).toBeNull()
      const observed = { taskId: task.taskId, epoch: task.epoch - 1, observationId: task.observationId }
      expect(recordAiTaskTiming(task, observed, randomUUID(), 'nativeOpened')).toBe(task)
      expect(recordAiTaskTiming(task, { ...task, observationId: randomUUID() }, randomUUID(), 'nativeOpened')).toBe(task)
      let full: AiTask = { ...task, execution: { ...task.execution!, timing: { version: 1, entries: [] } } }
      for (let index = 0; index < MAX_AI_TASK_TIMING_ENTRIES; index++) full = recordAiTaskTiming(full, full, randomUUID(), 'requestPrepared', index)
      expect(recordAiTaskTiming(full, full, randomUUID(), 'nativeOpened')).toBe(full)
      expect(aiTaskSchema.safeParse(full).success).toBe(true)
      const runId = randomUUID(), empty: AiTask = { ...task, execution: { ...task.execution!, timing: { version: 1, entries: [] } } }
      const start = recordAiTaskTiming(empty, empty, runId, 'nativeOpenStarted', 50)
      const backwards = recordAiTaskTiming(start, start, runId, 'nativeOpened', 40)
      expect(summarizeAiTaskTiming(backwards)[0]!.durationsMs.nativeOpen).toBeNull()
      expect(recordAiTaskTiming(backwards, backwards, runId, 'nativeOpened', 60)).toBe(backwards)
      expect(aiTaskSchema.safeParse({ ...task, execution: { ...task.execution, timing: { version: 1,
        entries: [task.execution!.timing!.entries[0], task.execution!.timing!.entries[0]],
      } } }).success).toBe(false)
    } finally { await harness.close() }
  })
})
