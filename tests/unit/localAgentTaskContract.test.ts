import { createScriptedAgentV2Fixture } from '../fixtures/local-agent-v2/scriptedAdapter'
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { aiTaskSchema, aiObservationSchema, aiProposalSchema, aiHostResultSchema, aiUserInputSchema, localAgentCapabilitiesSchema, localAgentRecordV2Schema, localAgentEventV2Schema, projectLegacyAgentHistory } from '../../src/shared/localAgentTaskContract'
import { acceptAiHostResult, AiCandidateScopeError, assertAiProposalCurrent, stopAiTask } from '../../src/shared/localAgentTaskGuards'
import { generationRequestSchema } from '../../src/shared/generationContract'

function fixture() {
  const workspace = { version: 1 as const, projectId: 'lesson', normalizedPath: 'c:/lessons/example.h5lesson' }
  const taskId = randomUUID(), sessionId = randomUUID(), observationId = randomUUID(), requestId = randomUUID(), candidateId = randomUUID()
  const destination = { kind: 'update' as const, target: { projectId: 'lesson', documentRevision: 7, revisionPolicy: { kind: 'exact' as const }, sessionGeneration: 3, surfaceType: 'slide' as const, surfaceId: 'slide', locationId: 'page', stateId: null, owner: 'scene' as const, ownerKey: 'scene:page', itemId: 'title', authoringAddress: 'page/title' } }
  const task = aiTaskSchema.parse({ version: 1, taskId, epoch: 0, workspace, sessionId, adapter: 'codex', goal: '标题放大', intent: 'edit', applyPolicy: 'auto', readScope: { kind: 'location', surfaceId: 'slide', locationId: 'page' }, writeDestinations: [destination], status: 'running', observationId, committedResultIds: [] })
  const observation = aiObservationSchema.parse({ version: 1, taskId, epoch: 0, workspace, observationId, capturedAt: 1, documentRevision: 7, sessionGeneration: 3, draftEpoch: 0, viewEpoch: 1, runtime: null, surfaceId: 'slide', locationId: 'page', stateId: null, source: 'authoring', readScope: task.readScope, files: [] })
  const request = generationRequestSchema.parse({ version: 1, requestId, workspace, documentRevision: 7, sessionGeneration: 3, purpose: 'local-edit', instruction: task.goal, destinations: [destination], context: {}, allowedCarriers: ['native'] })
  const proposal = aiProposalSchema.parse({ version: 1, taskId, epoch: 0, workspace, observationId, requestId, candidateId, candidate: { version: 1, requestId, candidateId, summary: '标题放大', steps: [{ id: 'title', tool: 'native.item.update', carrier: 'native', destination, input: { fontSize: 48 } }] } })
  const result = aiHostResultSchema.parse({ version: 1, taskId, epoch: 0, workspace, observationId, requestId, candidateId, resultId: randomUUID(), status: 'committed', beforeRevision: 7, afterRevision: 8, receipts: [{ version: 1, requestId, candidateId, workspace, status: 'committed', beforeRevision: 7, afterRevision: 8, affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }], summary: '已放大', diagnostics: [] })
  return { task, observation, request, proposal, result }
}

describe('local AI task identity and canonical commit fence', () => {
  it('keeps historical text unclassified and validates persisted user message ownership and strict fields', () => {
    const f = fixture(), base = { version: 2, taskId: f.task.taskId, epoch: f.task.epoch, workspace: f.task.workspace,
      sessionId: f.task.sessionId, runId: randomUUID(), nativeTurnId: null, sequence: 1, time: 1 }
    const text = localAgentEventV2Schema.parse({ ...base, kind: 'text', itemId: 'legacy-text', operation: 'append', text: '旧记录' })
    expect(text).not.toHaveProperty('phase')
    expect(localAgentEventV2Schema.safeParse({ ...text, phase: 'invented-private-reasoning' }).success).toBe(false)
    const message = localAgentEventV2Schema.parse({ ...base, kind: 'user-message', itemId: 'input-id', purpose: 'supplement', text: '保留背景' })
    const record = { version: 2, id: f.task.sessionId, adapter: 'codex', workspace: f.task.workspace, externalSessionId: null,
      workingDirectoryId: f.task.sessionId, tasks: [f.task], observations: [f.observation], hostResults: [], events: [message] }
    expect(localAgentRecordV2Schema.safeParse(record).success).toBe(true)
    expect(localAgentRecordV2Schema.safeParse({ ...record, events: [{ ...message, taskId: randomUUID() }] }).success).toBe(false)
    expect(localAgentEventV2Schema.safeParse({ ...message, rawStore: {} }).success).toBe(false)
  })
  it('preserves canonical nulls and accepts the exact authorized candidate', () => {
    const f = fixture()
    expect(() => assertAiProposalCurrent(f.task, f.observation, f.request, f.proposal)).not.toThrow()
    expect(JSON.parse(JSON.stringify(f.proposal)).candidate.steps[0].destination.target.stateId).toBeNull()
    expect(aiTaskSchema.safeParse({ ...f.task, version: 2 }).success).toBe(false)
    expect(aiTaskSchema.safeParse({ ...f.task, extra: true }).success).toBe(false)
  })
  it.each(['discuss', 'plan'] as const)('rejects a %s candidate even when it has valid canonical identity', intent => {
    const f = fixture()
    expect(aiTaskSchema.safeParse({ ...f.task, intent }).success).toBe(false)
    expect(() => assertAiProposalCurrent({ ...f.task, intent, writeDestinations: [] }, f.observation, f.request, f.proposal)).toThrow('read-only-intent')
  })
  it('keeps the current manual preview path without inventing future observation coverage', () => {
    const f = fixture()
    const partial = aiObservationSchema.parse({ ...f.observation, source: 'generation-snapshot', draftEpoch: null, viewEpoch: null })
    expect(() => assertAiProposalCurrent({ ...f.task, applyPolicy: 'preview' }, partial, f.request, f.proposal)).not.toThrow()
    expect(() => assertAiProposalCurrent(f.task, partial, f.request, f.proposal)).toThrow('incomplete-observation')
    expect(aiObservationSchema.safeParse({ ...partial, draftEpoch: 0 }).success).toBe(false)
    expect(aiObservationSchema.safeParse({ ...f.observation, draftEpoch: null }).success).toBe(false)
  })
  it('rejects same project ID at another path, stale epochs and refreshed observations', () => {
    const f = fixture()
    expect(() => assertAiProposalCurrent(f.task, f.observation, f.request, { ...f.proposal, workspace: { ...f.task.workspace, normalizedPath: 'c:/lessons/copy.h5lesson' } })).toThrow('stale-task')
    expect(() => assertAiProposalCurrent({ ...f.task, epoch: 1 }, f.observation, f.request, f.proposal)).toThrow('stale-task')
    expect(() => assertAiProposalCurrent({ ...f.task, observationId: randomUUID() }, f.observation, f.request, f.proposal)).toThrow('stale-observation')
    expect(() => assertAiProposalCurrent(f.task, { ...f.observation, documentRevision: 8 }, f.request, f.proposal)).toThrow('stale-request')
  })
  it('rejects an expanded destination and does not care about JSON key insertion order', () => {
    const f = fixture()
    const reordered = Object.fromEntries(Object.entries(f.request.destinations[0]!).reverse())
    expect(() => assertAiProposalCurrent(f.task, f.observation, generationRequestSchema.parse({ ...f.request, destinations: [reordered] }), f.proposal)).not.toThrow()
    const destination = structuredClone(f.request.destinations[0]!)
    if (destination.kind === 'update') destination.target.itemId = 'other-title'
    expect(() => assertAiProposalCurrent(f.task, f.observation, { ...f.request, destinations: [destination] }, f.proposal)).toThrow('scope-mismatch')
  })
  it('makes only the candidate destination mismatch repairable, never stale or unauthorized requests', () => {
    const f = fixture()
    const proposal = structuredClone(f.proposal)
    const destination = proposal.candidate.steps[0]!.destination
    if (!('target' in destination)) throw new Error('Expected update destination')
    destination.target.authoringAddress = 'page/tile'
    expect(() => assertAiProposalCurrent(f.task, f.observation, f.request, proposal)).toThrow(AiCandidateScopeError)
    for (const call of [
      () => assertAiProposalCurrent({ ...f.task, epoch: 1 }, f.observation, f.request, proposal),
      () => assertAiProposalCurrent(f.task, f.observation, { ...f.request, destinations: [destination] }, proposal),
      () => assertAiProposalCurrent(f.task, { ...f.observation, readScope: { kind: 'course' } }, f.request, proposal),
    ]) {
      expect(call).toThrow()
      try { call() } catch (error) { expect(error).not.toBeInstanceOf(AiCandidateScopeError) }
    }
  })
  it('invalidates stop immediately and preserves earlier real commits', () => {
    const f = fixture()
    const stopped = stopAiTask(f.task)
    expect(stopped.epoch).toBe(1)
    expect(stopped.status).toBe('cancelled')
    expect(() => assertAiProposalCurrent(stopped, f.observation, f.request, f.proposal)).toThrow('inactive-task')
    const applied = acceptAiHostResult({ ...f.task, status: 'committing' }, f.proposal, f.result, []).task
    const partial = stopAiTask(applied)
    expect(partial.status).toBe('partial')
    expect(partial.committedResultIds).toEqual([f.result.resultId])
    expect(stopAiTask(partial)).toEqual(partial)
    expect(() => acceptAiHostResult(partial, f.proposal, { ...f.result, resultId: randomUUID() }, [f.result])).toThrow()
  })
  it('deduplicates identical receipts and rejects conflicts without adding a second commit', () => {
    const f = fixture()
    const applied = acceptAiHostResult({ ...f.task, status: 'committing' }, f.proposal, f.result, [])
    expect(acceptAiHostResult(applied.task, f.proposal, f.result, [f.result])).toEqual({ task: applied.task, duplicate: true })
    expect(() => acceptAiHostResult(applied.task, f.proposal, { ...f.result, summary: 'different' }, [f.result])).toThrow('conflicting-result')
    expect(() => acceptAiHostResult({ ...f.task, status: 'checking' }, f.proposal, f.result, [])).toThrow('missing-commit-lease')
  })
  it('cannot report a checked candidate or an empty receipt as a real commit', () => {
    const { result } = fixture()
    expect(aiHostResultSchema.safeParse({ ...result, receipts: [] }).success).toBe(false)
    expect(aiHostResultSchema.safeParse({ ...result, status: 'checked' }).success).toBe(false)
    expect(aiHostResultSchema.safeParse({ ...result, receipts: [{ ...result.receipts[0], afterRevision: 9 }] }).success).toBe(false)
  })
  it('rejects traversal and duplicate observation file handles', () => {
    const { observation } = fixture()
    const file = { fileId: 'image', relativePath: 'images/a.png', mediaType: 'image/png', byteLength: 10, role: 'image' }
    for (const relativePath of ['../a.png', 'c:/a.png', '/a.png', 'images\\a.png']) expect(aiObservationSchema.safeParse({ ...observation, files: [{ ...file, relativePath }] }).success).toBe(false)
    expect(aiObservationSchema.safeParse({ ...observation, files: [file, file] }).success).toBe(false)
  })
  it('requires question identity for answers, without treating user input as consumed', () => {
    const { task } = fixture()
    const input = { version: 1, taskId: task.taskId, epoch: 0, workspace: task.workspace, inputId: randomUUID(), turnId: null, kind: 'answer', answers: [{ id: 'colour', values: ['Green'] }] }
    expect(aiUserInputSchema.safeParse(input).success).toBe(false)
    expect(aiUserInputSchema.safeParse({ ...input, questionId: 'q1' }).success).toBe(true)
  })
  it('does not invent effort options or infer model vision from protocol image support', () => {
    const capabilities = { version: 1, adapter: 'opencode', cliVersion: '1.18.26', models: [{ id: 'native/default', resolvedModel: null, label: 'Default', image: 'unknown', effort: { kind: 'unsupported' } }], current: { model: 'native/default', resolvedModel: null, effort: null }, input: { image: 'supported', readFile: 'supported', question: 'text', correction: 'turn-boundary', cancel: 'supported' } }
    expect(localAgentCapabilitiesSchema.parse(capabilities).models[0]?.image).toBe('unknown')
    expect(localAgentCapabilitiesSchema.safeParse({ ...capabilities, current: { model: 'native/default', resolvedModel: null, effort: 'low' } }).success).toBe(false)
  })
  it('projects V1 history read-only and drops every executable recovery handle', () => {
    const { task, request } = fixture()
    const history = projectLegacyAgentHistory({ version: 1, id: task.sessionId, adapter: 'codex', workspace: task.workspace, status: 'running', externalSessionId: 'old-native', generationRequest: request, generationRequestId: request.requestId, events: [] })
    expect(history.status).toBe('interrupted')
    expect(history.canReplayCandidate).toBe(false)
    expect(history.requiresFreshObservation).toBe(true)
    expect(history).not.toHaveProperty('externalSessionId')
    expect(history).not.toHaveProperty('generationRequest')
  })
  it('rejects corrupt V1 event identities before projecting history', () => {
    const { task } = fixture()
    expect(() => projectLegacyAgentHistory({ version: 1, id: task.sessionId, adapter: 'codex', workspace: task.workspace, status: 'completed', events: [{ version: 1, adapter: 'codex', sessionId: randomUUID(), sequence: 1, time: 0, kind: 'completed', payload: {} }] })).toThrow('Event identity mismatch')
  })
  it('round-trips V2 records without treating a native turn end as task completion', () => {
    const f = fixture()
    const event = localAgentEventV2Schema.parse({ version: 2, taskId: f.task.taskId, epoch: 0, workspace: f.task.workspace, sessionId: f.task.sessionId, runId: randomUUID(), nativeTurnId: 'native-1', sequence: 1, time: 0, kind: 'turn-ended', status: 'completed', failure: null })
    const record = { version: 2, id: f.task.sessionId, adapter: 'codex', workspace: f.task.workspace, externalSessionId: 'native-session', workingDirectoryId: randomUUID(), tasks: [f.task], observations: [f.observation], hostResults: [], events: [event] }
    expect(localAgentRecordV2Schema.parse(JSON.parse(JSON.stringify(record))).tasks[0]?.status).toBe('running')
    expect(localAgentRecordV2Schema.safeParse({ ...record, events: [{ ...event, sequence: 2 }] }).success).toBe(false)
    expect(localAgentRecordV2Schema.safeParse({ ...record, events: [{ ...event, taskId: randomUUID() }] }).success).toBe(false)
    expect(localAgentRecordV2Schema.safeParse({ ...record, tasks: [{ ...f.task, committedResultIds: [randomUUID()] }] }).success).toBe(false)
  })
})

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { LocalAgentHarness } from '../../src/main/localAgent/harness'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'

describe('V2 repository owner wiring', () => {
  it('persists a new session as V2 and does not rewrite a V1 file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v2-owner-'))
    const workspace = createWorkspaceIdentity('lesson', path.join(directory, 'course.h5lesson'))
    const v1Id = randomUUID()
    const v1Dir = new LocalAgentRepository(directory).directory(workspace)
    await fs.mkdir(v1Dir, { recursive: true })
    await fs.writeFile(path.join(v1Dir, `${v1Id}.json`), JSON.stringify({
      version: 1, id: v1Id, adapter: 'codex', workspace, status: 'completed',
      events: [{ version: 1, adapter: 'codex', sessionId: v1Id, sequence: 1, time: 0, kind: 'completed', payload: {} }],
    }))
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), id => createScriptedAgentV2Fixture(id, {
      async *turn(_text, { externalSessionId }) {
        if (externalSessionId) throw new Error('must not resume a V1 external session')
        yield { type: 'thread.started', thread_id: 'native' }; yield { type: 'turn.completed' }
      },
    }))
    try {
      const id = await harness.start(workspace, 'codex', 'hello')
      await expect.poll(() => harness.running).toBe(false)
      const listed = await harness.list(workspace)
      expect(listed.records.some(record => record.id === v1Id && record.status === 'completed')).toBe(true)
      expect(JSON.parse(await fs.readFile(path.join(v1Dir, `${v1Id}.json`), 'utf8')).version).toBe(1)
      const v2Path = path.join(new LocalAgentRepository(directory).v2Directory(workspace), `${id}.json`)
      expect(JSON.parse(await fs.readFile(v2Path, 'utf8')).version).toBe(2)
      expect(JSON.parse(await fs.readFile(v2Path, 'utf8')).tasks[0]).toMatchObject({ intent: 'discuss', status: 'completed', committedResultIds: [] })
      const resumed = await harness.resume(workspace, v1Id, 'continue')
      await expect.poll(() => harness.running).toBe(false)
      expect(resumed).not.toBe(v1Id)
      expect(JSON.parse(await fs.readFile(path.join(v1Dir, `${v1Id}.json`), 'utf8')).version).toBe(1)
    } finally {
      await harness.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
