// @vitest-environment node

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticLog } from '../../src/main/diagnosticLog'
import { APP_NAME } from '../../src/shared/constants'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { LocalAgentHarness } from '../../src/main/localAgent/harness'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import type { LocalAgentId } from '../../src/shared/localAgentContract'
import { createScriptedAgentV2Fixture } from '../fixtures/local-agent-v2/scriptedAdapter'
import { generationRequestSchema } from '../../src/shared/generationContract'
import { parseGenerationText, readGenerationResult, GENERATION_OPEN, GENERATION_CLOSE, GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE } from '../../src/shared/generationResult'
import { CandidateStaging } from '../../src/main/localAgent/candidateStaging'
import { randomUUID } from 'node:crypto'

function generationTransportFixture(directory: string) {
  const workspace = createWorkspaceIdentity('generation-project', path.join(directory, 'course.h5lesson'))
  const request = generationRequestSchema.parse({ version: 1, requestId: randomUUID(), workspace, documentRevision: 0, sessionGeneration: 1,
    purpose: 'single-page', instruction: '生成一页', context: { title: '示例' }, allowedCarriers: ['native'], destinations: [{ kind: 'create', scope: {
      projectId: workspace.projectId, documentRevision: 0, sessionGeneration: 1, revisionPolicy: { kind: 'exact' },
      surfaceType: 'slide', surfaceId: 'surface', locationId: 'location', stateId: null, owner: 'scene', ownerKey: 'scene:scene',
      parent: { kind: 'owner' }, insertion: { kind: 'append' },
    } }] })
  const candidate = { version: 1, requestId: request.requestId, candidateId: randomUUID(), summary: '添加文字', steps: [{ id: 's1', tool: 'native.content', carrier: 'native',
    destination: request.destinations[0], input: { operation: 'insert', template: { nativeType: 'text', text: '分数' } } }] }
  return { workspace, request, candidate }
}

describe('generation output channels and staging ingestion', () => {
  it('distinguishes ordinary discussion, required missing candidates and bounded format failures', () => {
    const { request } = generationTransportFixture(os.tmpdir())
    expect(readGenerationResult('这里讨论 { 一个选项 }', request)).toEqual({ kind: 'answer', requestId: request.requestId })
    expect(readGenerationResult('已准备修改', { ...request, expectedResult: 'candidate' })).toMatchObject({ kind: 'candidate-format-error', requestId: request.requestId, finding: expect.stringContaining('缺少') })
    const edit = `${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request.requestId, kind: 'edit' })}${GENERATION_RESULT_CLOSE}`
    expect(readGenerationResult(edit, request).kind).toBe('candidate-format-error')
    const invalid = readGenerationResult(`${GENERATION_OPEN}{broken:${'x'.repeat(20000)}}${GENERATION_CLOSE}`, request)
    expect(invalid.kind).toBe('candidate-format-error')
    if (invalid.kind !== 'candidate-format-error') throw new Error('Missing finding')
    expect(invalid.excerpt.length).toBeLessThanOrEqual(8000)
    expect(invalid.finding.length).toBeLessThanOrEqual(4000)
    expect(invalid.requestId).toBe(request.requestId)
  })
  it('only parses one explicit candidate channel bound to the current request', () => {
    const { request, candidate } = generationTransportFixture(os.tmpdir())
    const block = `${GENERATION_OPEN}${JSON.stringify(candidate)}${GENERATION_CLOSE}`
    expect(parseGenerationText(JSON.stringify(candidate), request.requestId)).toBeNull()
    expect(parseGenerationText('仅解释问题，不修改工程', request.requestId)).toBeNull()
    expect(parseGenerationText(block, request.requestId)).toEqual(candidate)
    expect(() => parseGenerationText(block, randomUUID())).toThrow('其他请求')
    expect(() => parseGenerationText(block + block, request.requestId)).toThrow('重复')
    expect(() => parseGenerationText(GENERATION_OPEN + '{}', request.requestId)).toThrow('不完整')
    expect(() => parseGenerationText(`${GENERATION_OPEN}${JSON.stringify({ ...candidate, project: {} })}${GENERATION_CLOSE}`, request.requestId)).toThrow()
  })

  it('reads a bounded local candidate and refuses request reuse, other identities, and linked roots', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-stage-')); directories.push(directory)
    const { request, candidate } = generationTransportFixture(directory)
    const staging = new CandidateStaging(directory)
    const root = await staging.create(request)
    expect(await staging.read(request.requestId)).toBeNull()
    await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify(candidate))
    expect(await staging.read(request.requestId)).toEqual(candidate)
    await fs.writeFile(path.join(root, 'candidate.json'), '{broken')
    expect(await staging.readText(request.requestId)).toBe('{broken')
    await expect(staging.read(request.requestId)).rejects.toThrow()
    await expect(staging.create(request)).rejects.toThrow()
    await fs.writeFile(path.join(root, 'candidate.json'), JSON.stringify({ ...candidate, requestId: randomUUID() }))
    await expect(staging.read(request.requestId)).rejects.toThrow('其他请求')
    await staging.remove(request.requestId)
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-outside-')); directories.push(outside)
    await fs.writeFile(path.join(outside, 'candidate.json'), JSON.stringify(candidate))
    await fs.symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(staging.read(request.requestId)).rejects.toThrow('链接')
    await expect(staging.remove(request.requestId)).rejects.toThrow('链接')
    expect(JSON.parse(await fs.readFile(path.join(outside, 'candidate.json'), 'utf8'))).toEqual(candidate)
    await fs.unlink(root)
  })

  it('keeps an invalid OpenCode candidate as a repairable format result before cleanup', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-format-stage-')); directories.push(directory)
    const { workspace, request } = generationTransportFixture(directory)
    let stagingRoot = ''
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), id => createScriptedAgentV2Fixture(id, {
      async *turn(_prompt, { candidateRoot }) {
        if (!candidateRoot) throw new Error('The native adapter did not receive the current candidate root')
        stagingRoot = candidateRoot
        await fs.writeFile(path.join(stagingRoot, 'candidate.json'), '{broken')
        yield { type: 'acp_session', sessionID: 'external-opencode' }
        yield { type: 'acp_result', sessionID: 'external-opencode', stopReason: 'end_turn' }
      },
    }))
    try {
      const id = await harness.generate(workspace, 'opencode', { ...request, expectedResult: 'candidate' })
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, id)).toMatchObject({ kind: 'candidate-format-error', requestId: request.requestId })
      await expect(fs.stat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await harness.close() }
  })

  it('routes a generation through the actual harness and resumes with fresh request identity in the same CLI directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-harness-')); directories.push(directory)
    const { workspace, request, candidate } = generationTransportFixture(directory)
    const cwdValues: string[] = []
    const capabilityRoots: string[] = []
    let output = candidate
    const adapter = (id: LocalAgentId) => createScriptedAgentV2Fixture(id, {
      async *turn(prompt, { cwd, externalSessionId, candidateRoot }) {
        if (externalSessionId) expect(externalSessionId).toBe('external-generation')
        expect(prompt).toContain(request.instruction); cwdValues.push(cwd)
        expect(cwd).toBe(await fs.realpath(directory))
        if (!candidateRoot) throw new Error('The native adapter did not receive the current candidate root')
        const staged = JSON.parse(await fs.readFile(path.join(candidateRoot, 'request.json'), 'utf8'))
        expect(staged.requestId).toBe(output.requestId)
        capabilityRoots.push(staged.fileAccess.capabilities)
        yield { type: 'thread.started', thread_id: 'external-generation' }
        yield { type: 'item.completed', item: { type: 'agent_message', text: `${GENERATION_OPEN}${JSON.stringify(output)}${GENERATION_CLOSE}` } }
        yield { type: 'turn.completed' }
      },
    })
    const repository = new LocalAgentRepository(directory)
    const harness = new LocalAgentHarness(repository, adapter)
    try {
      const id = await harness.generate(workspace, 'codex', request)
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, id)).toEqual({ kind: 'candidate', requestId: request.requestId, candidate })
      expect((await repository.list(workspace)).records[0]?.generationRequest).toEqual(request)
      const hostResult = { requestId: request.requestId, status: 'committed' as const, beforeRevision: 0, afterRevision: 1, candidateId: candidate.candidateId, summary: '已应用文字' }
      const receipt = { version: 1 as const, requestId: request.requestId, candidateId: candidate.candidateId, workspace, status: 'committed' as const, beforeRevision: 0, afterRevision: 1, affected: [], resources: { assetIds: [], packageIds: [] } }
      await harness.hostResult(workspace, id, hostResult, receipt)
      expect((await repository.list(workspace)).records[0]?.hostResult).toMatchObject({ requestId: request.requestId, status: 'committed', beforeRevision: 0, afterRevision: 1 })
      await expect(harness.hostResult(workspace, id, { ...hostResult, requestId: randomUUID() }, receipt)).rejects.toThrow('不属于')
      await expect(fs.stat(path.join(repository.stagingPath(workspace, id, 2), 'candidates', request.requestId))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(harness.generate(workspace, 'codex', request)).rejects.toThrow('新的请求身份')
      const next = { ...request, requestId: randomUUID() }
      output = { ...candidate, requestId: next.requestId, candidateId: randomUUID() }
      const resumed = await harness.generate(workspace, 'codex', next, id)
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, resumed)).toEqual({ kind: 'candidate', requestId: next.requestId, candidate: output })
      expect(cwdValues[1]).toBe(cwdValues[0])
      await expect(harness.candidate(createWorkspaceIdentity(workspace.projectId, path.join(directory, 'other.h5lesson')), resumed)).rejects.toThrow('没有')
      await harness.hostResult(workspace, resumed, { requestId: next.requestId, status: 'rejected', summary: '需要修复' })
      const repair = { ...next, requestId: randomUUID(), expectedResult: 'candidate' as const, repair: { logicalRequestId: next.requestId, attempt: 1 as const } }
      await expect(harness.generate(workspace, 'codex', { ...repair, instruction: '更换原任务' }, resumed)).rejects.toThrow('原请求')
      output = { ...candidate, requestId: repair.requestId }
      const repaired = await harness.generate(workspace, 'codex', repair, resumed)
      await expect.poll(() => harness.running).toBe(false)
      expect(await harness.candidate(workspace, repaired)).toMatchObject({ kind: 'candidate', requestId: repair.requestId })
      await expect(harness.generate(workspace, 'codex', { ...repair, requestId: randomUUID() }, resumed)).rejects.toThrow('唯一一次')
      expect(new Set(capabilityRoots).size).toBe(1)
      expect(await fs.readFile(path.join(capabilityRoots[0]!, 'discovery.json'), 'utf8')).toContain('runtime-api2')
      await harness.delete(workspace, id)
      await harness.delete(workspace, resumed)
      expect((await fs.stat(capabilityRoots[0]!)).isDirectory()).toBe(true)
      await harness.delete(workspace, repaired)
      await expect(fs.stat(capabilityRoots[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await harness.close() }
  })
})

const directories: string[] = []

describe('local CLI sessions', () => {
  it('reports a failed final disk write without pretending the result is durable', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-storage-failure-')); directories.push(directory)
    const workspace = createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux')
    class FailingRepository extends LocalAgentRepository {
      override async write(record: Parameters<LocalAgentRepository['write']>[0]) {
        if (record.events.some(event => event.kind === 'turn-ended' && event.status === 'completed')) throw new Error('disk full')
        return super.write(record)
      }
    }
    const harness = new LocalAgentHarness(new FailingRepository(directory), id => createScriptedAgentV2Fixture(id, {
      async *turn() { yield { type: 'thread.started', thread_id: 'external' }; yield { type: 'turn.completed' } },
    }))
    await harness.start(workspace, 'codex', 'hello')
    await expect.poll(() => harness.running).toBe(false)
    const result = await harness.list(workspace)
    expect(result.records[0]?.status).toBe('completed')
    expect(result.damaged[0]).toContain('未能写入本地存储')
    expect((await new LocalAgentRepository(directory).list(workspace)).records[0]?.status).toBe('running')
  })
  it('reserves concurrent launches and closes pending sessions without late output', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-close-')); directories.push(directory)
    const workspace = createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux')
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), id => {
      let release!: () => void
      const cancelled = new Promise<void>(resolve => { release = resolve })
      return createScriptedAgentV2Fixture(id, {
        async *turn() { yield { type: 'thread.started', thread_id: 'external' }; await cancelled; yield { type: 'item.completed', item: { id: 'late', type: 'agent_message', text: 'late' } } },
        async close() { release() },
      })
    })
    const starts = Array.from({ length: 4 }, () => harness.start(workspace, 'codex', 'hello'))
    const outcomes = Promise.allSettled(starts)
    await harness.close()
    expect((await outcomes).filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(harness.running).toBe(false)
    const records = (await harness.list(workspace)).records
    expect(records).toHaveLength(3)
    expect(records.every(record => record.status === 'cancelled' && record.events.every(event => event.kind !== 'text'))).toBe(true)
  })
  it.each(['codex', 'claude', 'opencode'] as const)('%s keeps the same event identity and rejects a duplicate terminal marker', async adapterId => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-terminal-')); directories.push(directory)
    const workspace = createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux')
    const wire = adapterId === 'codex'
      ? [{ type: 'thread.started', thread_id: 'external' }, { type: 'turn.completed' }]
      : adapterId === 'claude'
        ? [{ type: 'system', subtype: 'init', session_id: 'external' }, { type: 'result', is_error: false }]
        : [{ type: 'step_start', sessionID: 'external' }, { type: 'step_finish', sessionID: 'external', part: { reason: 'stop' } }]
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), id => createScriptedAgentV2Fixture(id, {
      async *turn() { yield* wire; yield wire.at(-1) },
    }))
    const id = await harness.start(workspace, adapterId, 'hello')
    await expect.poll(async () => (await harness.list(workspace)).records[0]?.status).toBe('failed')
    const record = (await harness.list(workspace)).records[0]!
    expect(record.events.at(-1)).toMatchObject({ kind: 'failed', failure: 'protocol' })
    expect(record.events.every(event => event.sessionId === id && event.adapter === adapterId && event.externalSessionId === 'external')).toBe(true)
    expect(record.events.filter(event => ['failed', 'completed', 'cancelled'].includes(event.kind))).toHaveLength(1)
  })
  it('persists ordered events, isolates paths, resumes external identity and quarantines damage', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-')); directories.push(directory)
    const workspace = createWorkspaceIdentity('project', path.join(directory, 'one.h5lesson'))
    const other = createWorkspaceIdentity('project', path.join(directory, 'two.h5lesson'))
    const resumed: string[] = []
    const workingDirectories: string[] = []
    const factory = (id: LocalAgentId) => createScriptedAgentV2Fixture(id, {
      async *turn(_prompt, { cwd, externalSessionId }) {
        if (externalSessionId) resumed.push(externalSessionId)
        workingDirectories.push(cwd)
        yield { type: 'thread.started', thread_id: 'external' }
        yield { type: 'item.completed', item: { id: 'text', type: 'agent_message', text: 'hello' } }
        yield { type: 'turn.completed', usage: { input_tokens: 1 } }
      },
    })
    const repository = new LocalAgentRepository(directory)
    const harness = new LocalAgentHarness(repository, factory)
    const id = await harness.start(workspace, 'codex', 'hello')
    await expect.poll(async () => (await harness.list(workspace)).records[0]?.status).toBe('completed')
    const saved = (await new LocalAgentRepository(directory).list(workspace)).records[0]!
    expect(saved.events.map(event => event.kind)).toEqual(['session', 'user-message', 'text', 'usage', 'completed'])
    expect(saved.events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5])
    expect((await harness.list(other)).records).toEqual([])
    const next = await harness.resume(workspace, id, 'continue')
    expect(next).not.toBe(id)
    await expect.poll(async () => (await harness.list(workspace)).records.find(record => record.id === next)?.status).toBe('completed')
    expect(resumed).toEqual(['external'])
    expect(workingDirectories[1]).toBe(workingDirectories[0])
    expect((await harness.list(workspace)).records.find(record => record.id === next)?.workingDirectoryId).toBe(id)
    await fs.writeFile(path.join(repository.v2Directory(workspace), `${id}.json`), '{bad')
    const result = await harness.list(workspace)
    expect(result.records.map(record => record.id)).toEqual([next]); expect(result.damaged).toHaveLength(1)
    await harness.delete(workspace, id)
    expect((await fs.stat(repository.stagingPath(workspace, id, 2))).isDirectory()).toBe(true)
    await harness.delete(workspace, next)
    await expect(fs.stat(repository.stagingPath(workspace, id, 2))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.stat(workingDirectories[0]!)).isDirectory()).toBe(true)
    await harness.delete(workspace)
    expect((await harness.list(workspace)).records).toEqual([])
  })
  it('rejects out-of-order tool results and never changes a terminal state for late output', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-state-')); directories.push(directory)
    const workspace = createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux')
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), id => createScriptedAgentV2Fixture(id, {
      async *turn() { yield { type: 'thread.started', thread_id: 'external' }; yield { type: 'item.completed', item: { id: 'unknown', type: 'command_execution' } }; yield { type: 'turn.completed' } },
    }))
    await harness.start(workspace, 'codex', 'hello')
    await expect.poll(async () => (await harness.list(workspace)).records[0]?.status).toBe('failed')
    const record = (await harness.list(workspace)).records[0]!
    expect(record.events.at(-1)).toMatchObject({ kind: 'failed', failure: 'protocol' })
    expect(record.events.some(event => event.kind === 'completed')).toBe(false)
  })
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ))
})

describe('DiagnosticLog', () => {
  it('serializes concurrent entries and produces a support report', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'courseware-log-'))
    directories.push(directory)
    const log = new DiagnosticLog(directory)

    await Promise.all([
      log.append({ source: 'renderer', message: 'first' }),
      log.append({ source: 'component', message: 'second', stack: 'stack' }),
    ])
    const report = await log.report()

    expect(report).toContain(`${APP_NAME}诊断报告`)
    expect(report).toContain('"message":"first"')
    expect(report).toContain('"message":"second"')
    expect(report).toContain('"source":"component"')
  })
})
