// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
const fake = vi.hoisted(() => ({ userData: '', owners: [] as { closed: boolean }[], events: [] as unknown[] }))
vi.mock('electron', () => ({ app: { getPath: () => fake.userData }, session: { defaultSession: { resolveProxy: vi.fn() } } }))
vi.mock('../../src/main/localAgent/harness', () => ({ LocalAgentHarness: class {
  closed = false
  constructor(readonly repository: unknown) { fake.owners.push(this) }
  async close() { this.closed = true }
  async delete() { if (!this.closed) throw new Error('Must stop all owners first') }
  async start() { if (this.closed) throw new Error('closed'); return 'b80f5f4c-f7fd-427f-a3f1-0bf407b7ec44' }
  async list() { return { records: [{ events: fake.events }], damaged: [] } }
} }))
vi.mock('../../src/main/localAgent/nativeProxy', () => ({ configureNativeSystemProxy: vi.fn() }))
vi.mock('../../src/main/lessonDocumentDesktopService', () => ({ lessonDocumentFiles: vi.fn() }))
vi.mock('../../src/main/lessonAuthoring', () => ({ LessonAuthoring: class {} }))
vi.mock('../../src/main/lessonMaterials', () => ({ LessonMaterials: class {} }))
vi.mock('../../src/main/localAgent/lessonGenerationContext', () => ({ readLessonGenerationContext: vi.fn() }))
vi.mock('../../src/main/projectFileObservation', () => ({ projectFileStatus: vi.fn() }))

beforeEach(async () => { vi.resetModules(); fake.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-records-')); fake.owners = []; fake.events = [] })
afterEach(async () => { await fs.rm(fake.userData, { recursive: true, force: true }) })
const lesson = () => ({ schemaVersion: 1 as const, lessonId: randomUUID(), normalizedDirectory: 'c:/lessons/example' })

describe('application conversation navigation records', () => {
  it('branches with a shared target reference and independent empty sessions', async () => {
    const repository = new LessonConversationRepository(fake.userData), identity = lesson()
    const target = { version: 1 as const, projectId: 'project', normalizedPath: 'c:/lessons/example/course.h5lesson' }
    const parent = await repository.create({ kind: 'lesson', lesson: identity }, '主讨论', target)
    await repository.attachSession({ kind: 'lesson', lesson: identity }, parent.conversationId, randomUUID(), parent.epoch)
    const branch = await repository.branch({ kind: 'lesson', lesson: identity }, parent.conversationId)
    expect(branch.parentConversationId).toBe(parent.conversationId)
    expect(branch.projectTarget).toEqual(target)
    expect(branch.sessionIds).toEqual([])
    expect(branch.conversationId).not.toBe(parent.conversationId)
    expect((await repository.list({ kind: 'lesson', lesson: identity })).records).toHaveLength(2)
  })
  it('rebuilds search from real titles and human message events without indexing tool payloads', async () => {
    const identity = lesson(), repository = new LessonConversationRepository(fake.userData)
    const conversation = await repository.create({ kind: 'lesson', lesson: identity }, '电路讨论')
    fake.events = [{ kind: 'text', payload: { text: '串联电路的电', messageId: 'message', delta: true } }, { kind: 'text', payload: { text: '流处处相等', messageId: 'message', delta: true } }, { kind: 'tool-result', payload: { text: '不应搜索的内部候选' } }]
    fake.events = fake.events.map((event, index) => ({ ...(event as object), sessionId: 'session', sequence: index + 1, time: 0 }))
    const service = await import('../../src/main/localAgent/service')
    expect(await service.searchLocalAgentLessonConversations(identity, '电流')).toEqual([{ conversationId: conversation.conversationId, excerpt: '串联电路的电流处处相等' }])
    expect(await service.searchLocalAgentLessonConversations(identity, '内部候选')).toEqual([])
    fake.events = []
    expect(await service.searchLocalAgentLessonConversations(identity, '电流')).toEqual([])
    expect(await service.searchLocalAgentLessonConversations(identity, '电路讨论')).toHaveLength(1)
  })
  it('stops owners and invalidates file candidates, removes records, preserves real files/recovery, and permits a fresh session', async () => {
    const identity = lesson(), repository = new LessonConversationRepository(fake.userData)
    await repository.create({ kind: 'lesson', lesson: identity })
    const folders = ['flow-document-recovery/v1', 'lesson-document-recovery', 'actual-lesson', 'local-agent/preferences/v1']
    for (const folder of folders) { await fs.mkdir(path.join(fake.userData, folder), { recursive: true }); await fs.writeFile(path.join(fake.userData, folder, 'keep'), 'source') }
    await fs.mkdir(path.join(fake.userData, 'local-agent/v3/bad'), { recursive: true })
    await fs.writeFile(path.join(fake.userData, 'local-agent/v3/bad/record.json.damaged'), 'broken')
    const service = await import('../../src/main/localAgent/service')
    const invalidated = vi.fn(async () => { expect(fake.owners[0]!.closed).toBe(true) })
    service.registerLessonRecordsInvalidator(invalidated)
    await service.deleteAllLocalAgentApplicationRecords()
    expect(invalidated).toHaveBeenCalledWith({ all: true })
    expect(await repository.listAll()).toEqual([])
    await expect(fs.stat(path.join(fake.userData, 'local-agent/v3'))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const folder of folders) expect(await fs.readFile(path.join(fake.userData, folder, 'keep'), 'utf8')).toBe('source')
    const result = await service.operateLocalAgent({ operation: 'start', projectId: 'new', projectPath: 'c:/lessons/new.h5lesson', adapter: 'codex', prompt: '讨论' })
    expect(result.sessionId).toBe('b80f5f4c-f7fd-427f-a3f1-0bf407b7ec44')
    expect(fake.owners.at(-1)!.closed).toBe(false)
  })
  it('preserves records and releases the gate when candidate invalidation fails', async () => {
    const identity = lesson(), repository = new LessonConversationRepository(fake.userData)
    await repository.create({ kind: 'lesson', lesson: identity })
    const service = await import('../../src/main/localAgent/service')
    const stop = service.registerLessonRecordsInvalidator(async () => { throw new Error('cannot preserve writer') })
    await expect(service.deleteAllLocalAgentApplicationRecords()).rejects.toThrow('cannot preserve writer')
    expect(await repository.listAll()).toHaveLength(1)
    expect(() => service.assertLocalAgentRecordsAvailable()).not.toThrow()
    stop()
    await service.deleteAllLocalAgentApplicationRecords()
    expect(await repository.listAll()).toEqual([])
  })
})
