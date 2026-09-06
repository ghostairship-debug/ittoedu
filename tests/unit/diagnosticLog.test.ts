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
import type { LocalAgentCliAdapterV1, LocalAgentId } from '../../src/shared/localAgentContract'

const directories: string[] = []

describe('local CLI sessions', () => {
  it('reports a failed final disk write without pretending the result is durable', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-storage-failure-')); directories.push(directory)
    const workspace = createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux')
    class FailingRepository extends LocalAgentRepository {
      override async write(record: Parameters<LocalAgentRepository['write']>[0]) {
        if (record.status === 'completed') throw new Error('disk full')
        return super.write(record)
      }
    }
    const harness = new LocalAgentHarness(new FailingRepository(directory), id => ({ id,
      async probe() { return { adapter: id, status: 'ready', message: '' } },
      async *start() { yield { type: 'thread.started', thread_id: 'external' }; yield { type: 'turn.completed' } },
      resume() { return this.start('', '') }, async cancel() {},
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
      return { id,
        async probe() { return { adapter: id, status: 'ready', message: '' } },
        async *start() { yield { type: 'thread.started', thread_id: 'external' }; await cancelled; yield { type: 'item.completed', item: { id: 'late', type: 'agent_message', text: 'late' } } },
        resume() { return this.start('', '') }, async cancel() { release() },
      }
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
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), id => ({ id,
      async probe() { return { adapter: id, status: 'ready', message: '' } },
      async *start() { yield* wire; yield wire.at(-1) }, resume() { return this.start('', '') }, async cancel() {},
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
    const workspace = createWorkspaceIdentity('project', 'C:\\lessons\\one.h5lesson', 'win32')
    const other = createWorkspaceIdentity('project', 'C:\\lessons\\two.h5lesson', 'win32')
    const resumed: string[] = []
    const workingDirectories: string[] = []
    const factory = (id: LocalAgentId): LocalAgentCliAdapterV1 => ({ id,
      async probe() { return { adapter: id, status: 'ready', message: 'fixture' } },
      async *start(_prompt, cwd) {
        workingDirectories.push(cwd)
        yield { type: 'thread.started', thread_id: 'external' }
        yield { type: 'item.completed', item: { id: 'text', type: 'agent_message', text: 'hello' } }
        yield { type: 'turn.completed', usage: { input_tokens: 1 } }
      },
      resume(external, prompt, cwd) { resumed.push(external); return this.start(prompt, cwd) }, async cancel() {},
    })
    const repository = new LocalAgentRepository(directory)
    const harness = new LocalAgentHarness(repository, factory)
    const id = await harness.start(workspace, 'codex', 'hello')
    await expect.poll(async () => (await harness.list(workspace)).records[0]?.status).toBe('completed')
    const saved = (await new LocalAgentRepository(directory).list(workspace)).records[0]!
    expect(saved.events.map(event => event.kind)).toEqual(['session', 'text', 'usage', 'completed'])
    expect(saved.events.map(event => event.sequence)).toEqual([1, 2, 3, 4])
    expect((await harness.list(other)).records).toEqual([])
    const next = await harness.resume(workspace, id, 'continue')
    expect(next).not.toBe(id); expect(resumed).toEqual(['external'])
    await expect.poll(async () => (await harness.list(workspace)).records.find(record => record.id === next)?.status).toBe('completed')
    expect(workingDirectories[1]).toBe(workingDirectories[0])
    expect((await harness.list(workspace)).records.find(record => record.id === next)?.workingDirectoryId).toBe(id)
    await fs.writeFile(path.join(repository.directory(workspace), `${id}.json`), '{bad')
    const result = await harness.list(workspace)
    expect(result.records.map(record => record.id)).toEqual([next]); expect(result.damaged).toHaveLength(1)
    await harness.delete(workspace, id)
    expect((await fs.stat(workingDirectories[0]!)).isDirectory()).toBe(true)
    await harness.delete(workspace, next)
    await expect(fs.stat(workingDirectories[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await harness.delete(workspace)
    expect((await harness.list(workspace)).records).toEqual([])
  })
  it('rejects out-of-order tool results and never changes a terminal state for late output', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-state-')); directories.push(directory)
    const workspace = createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux')
    const harness = new LocalAgentHarness(new LocalAgentRepository(directory), id => ({ id,
      async probe() { return { adapter: id, status: 'ready', message: '' } },
      async *start() { yield { type: 'thread.started', thread_id: 'external' }; yield { type: 'item.completed', item: { id: 'unknown', type: 'command_execution' } }; yield { type: 'turn.completed' } },
      resume() { return this.start('', '') }, async cancel() {},
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
