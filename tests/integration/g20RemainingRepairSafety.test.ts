// @vitest-environment node
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }) })
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-repair-safety-')); roots.push(root); return root }
const record = (runId: string, continuedFrom?: string): ExecutionRunRecord => ({ schemaVersion: 1, runId, version: 1,
  status: 'completed', createdAt: 1, updatedAt: 1, input: { conversationId: 'same-conversation', taskId: runId, instruction: 'test', selection: {} as never, documents: [] },
  budget: { maxRequests: null, maxToolCalls: null, maxContextBytes: 10000 }, messages: [], requests: [], tools: [], initialMessageCount: 0,
  ...(continuedFrom ? { taskContinuedFrom: continuedFrom } : {}) })

it('isolates one corrupt run and one corrupt submission while a new independent conversation remains usable', async () => {
  const root = await directory(), execution = path.join(root, 'execution')
  const runs = new ExecutionRunStore(path.join(execution, 'runs'))
  await runs.save(record('good'))
  const bad = path.join(execution, 'runs', 'e'.repeat(64) + '.json')
  const submission = path.join(execution, 'submissions', 'f'.repeat(64) + '.json')
  await fs.mkdir(path.dirname(submission), { recursive: true }); await fs.writeFile(bad, '{broken run'); await fs.writeFile(submission, '{broken submission')
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => Buffer.from(bytes).toString() } })
  const service = new ExecutionDesktopService({ directory: execution, documents, settings, authorizeWorkspaceRoot: async value => ({ resolvedPath: value }) })
  const workspace = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string }; recoveryIssues: string[] }
  expect(workspace.recoveryIssues).toEqual(expect.arrayContaining([expect.stringContaining('历史运行'), expect.stringContaining('历史提交')]))
  const created = await service.operate({ type: 'create-conversation', workspaceId: workspace.workspace.workspaceId }) as ConversationRecord
  expect(created.conversationId).toBeTruthy()
  expect(await fs.readFile(bad, 'utf8')).toBe('{broken run'); expect(await fs.readFile(submission, 'utf8')).toBe('{broken submission')
  expect((await runs.list()).map(value => value.runId)).toEqual(['good'])
})

it('reserves an unresolved physical move only at its paths; unrelated open/edit/save keeps working', async () => {
  const root = await directory(), journal = path.join(root, 'documents')
  const old = path.join(root, 'old.md'), target = path.join(root, 'missing-new.md'), good = path.join(root, 'good.md')
  await fs.writeFile(old, 'preserved original'); await fs.writeFile(good, 'good original')
  const first = new DocumentHostService(journal), opened = await first.open(old)
  if (opened.binding.kind !== 'file') throw new Error('file')
  await fs.rename(old, path.join(root, 'preserved-backup.md'))
  const intent = path.join(journal, 'binding-intents', 'a'.repeat(64) + '.json')
  await fs.mkdir(path.dirname(intent), { recursive: true })
  const value = { schemaVersion: 1, operationId: 'move-interrupted', source: old, target, kind: 'rename', entries: [
    { documentId: opened.documentId, before: opened.binding, after: { ...opened.binding, path: target, bindingVersion: 2 } }] }
  await fs.writeFile(intent, JSON.stringify(value))
  const restarted = new DocumentHostService(journal), active = await restarted.open(good)
  expect(restarted.recoveryIssues.some(message => message.includes('文件绑定恢复'))).toBe(true)
  await expect(restarted.assertFileAvailable(old)).rejects.toThrow('恢复未完成')
  await expect(restarted.assertFileAvailable(target)).rejects.toThrow('恢复未完成')
  await restarted.internalAPI.dispatch({ documentId: active.documentId, epoch: active.epoch, baseRevision: active.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'good revised' } } })
  await restarted.saveWithFact(active.documentId)
  expect(await fs.readFile(good, 'utf8')).toBe('good revised')
  expect(await fs.readFile(intent, 'utf8')).toBe(JSON.stringify(value))
  expect(await fs.readFile(path.join(root, 'preserved-backup.md'), 'utf8')).toBe('preserved original')
  await expect(fs.stat(old)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('verifies only explicit task lineage, never an ordinary context continuation, and rejects a broken chain', async () => {
  const root = await directory(), store = new ExecutionRunStore(root)
  await store.save(record('parent')); await store.save(record('child', 'parent'))
  await store.save({ ...record('context-only'), continuedFrom: 'parent' })
  expect(await store.taskLineage('child')).toEqual(['child', 'parent'])
  expect(await store.taskLineage('context-only')).toEqual(['context-only'])
  await store.save({ ...record('parent'), taskContinuedFrom: 'child' })
  await expect(store.taskLineage('child')).rejects.toThrow('循环')
})

it('retains more than 2048 timing marks with append-size growth, idempotence and immutable legacy records', async () => {
  const root = await directory(), store = new ExecutionEventStore({ directory: root })
  const mark = (index: number) => ({ markId: `mark-${index}`, conversationId: 'conversation', taskId: 'task', stage: 'tool.finished' as const,
    process: 'main' as const, clock: 'performance.now' as const, clockInstanceId: 'test', monotonicMs: index, wallTimeMs: index })
  await store.recordTiming(mark(0))
  const files = async (where: string): Promise<string[]> => (await Promise.all((await fs.readdir(where, { withFileTypes: true })).map(entry => entry.isDirectory()
    ? files(path.join(where, entry.name)) : [path.join(where, entry.name)]))).flat()
  const log = (await files(root)).find(name => name.endsWith('.ndjson'))!
  const legacy = log.slice(0, -7), legacyBytes = JSON.stringify({ version: 1, conversationId: 'conversation', taskId: 'task', marks: [] })
  await fs.writeFile(legacy, legacyBytes)
  const start = performance.now()
  for (let index = 1; index < 2200; index++) await store.recordTiming(mark(index))
  const originalSize = (await fs.stat(log)).size
  await store.recordTiming(Object.fromEntries(Object.entries(mark(2199)).reverse()) as ReturnType<typeof mark>)
  expect((await fs.stat(log)).size).toBe(originalSize)
  const loaded = await new ExecutionEventStore({ directory: root }).readTiming('conversation', 'task')
  expect(loaded).toHaveLength(2200); expect(loaded.at(-1)?.markId).toBe('mark-2199')
  expect(originalSize).toBeLessThan(2200 * 700)
  expect(await fs.readFile(legacy, 'utf8')).toBe(legacyBytes)
  console.log('TIMING_TRACE_MEASUREMENT', JSON.stringify({ marks: loaded.length, bytes: originalSize, ms: performance.now() - start }))
  await expect(store.recordTiming({ ...mark(2199), monotonicMs: 999 })).rejects.toThrow('冲突')
}, 30_000)


it('recovers a move-blocked document as an explicit untitled draft, preserving history and old files', async () => {
  const root = await directory(), journal = path.join(root, 'documents'), old = path.join(root, 'old.md'), target = path.join(root, 'missing-new.md')
  await fs.writeFile(old, 'original')
  const first = new DocumentHostService(journal), opened = await first.open(old)
  if (opened.binding.kind !== 'file') throw new Error('file')
  await first.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
    operationId: 'human-draft', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'important draft' } } })
  await fs.rename(old, path.join(root, 'backup.md'))
  const intent = path.join(journal, 'binding-intents', 'a'.repeat(64) + '.json')
  await fs.mkdir(path.dirname(intent), { recursive: true })
  await fs.writeFile(intent, JSON.stringify({ schemaVersion: 1, operationId: 'move', source: old, target, kind: 'rename', entries: [
    { documentId: opened.documentId, before: opened.binding, after: { ...opened.binding, path: target, bindingVersion: 2 } }] }))
  const restarted = new DocumentHostService(journal)
  expect(await restarted.internalAPI.recoverable()).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: opened.documentId, undoDepth: 1 })]))
  await expect(restarted.internalAPI.restore(opened.documentId)).rejects.toThrow('恢复未完成')
  const restored = await restarted.operate({ type: 'restore', documentId: opened.documentId, mode: 'unbound' }) as import('../../src/shared/workbench/document').DocumentSnapshot
  expect(restored).toMatchObject({ documentId: opened.documentId, dirty: true, undoDepth: 1, binding: { kind: 'untitled' }, model: { source: 'important draft' } })
  const saved = path.join(root, 'recovered.md')
  await restarted.saveWithFact(restored.documentId, saved)
  expect(await fs.readFile(saved, 'utf8')).toBe('important draft')
  const current = await restarted.internalAPI.read(restored.documentId)
  await restarted.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })
  expect((await restarted.internalAPI.read(restored.documentId)).model).toMatchObject({ source: 'original' })
  expect(await fs.readFile(path.join(root, 'backup.md'), 'utf8')).toBe('original')
  await expect(fs.stat(old)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
})


it('permits healthy file reading with an unidentifiable corrupt move intent but does not grant an unsafe disk write', async () => {
  const root = await directory(), journal = path.join(root, 'documents'), intent = path.join(journal, 'binding-intents', 'f'.repeat(64) + '.json')
  await fs.mkdir(path.dirname(intent), { recursive: true }); await fs.writeFile(intent, '{corrupt untouched')
  const file = path.join(root, 'healthy.md'); await fs.writeFile(file, 'healthy disk content')
  const host = new DocumentHostService(journal), snapshot = await host.open(file)
  expect(snapshot.model).toMatchObject({ source: 'healthy disk content' })
  expect(host.recoveryIssues.length).toBeGreaterThan(0)
  await expect(host.saveToPath(snapshot.documentId, path.join(root, 'unsafe-new.md'))).rejects.toThrow()
  expect(await fs.readFile(file, 'utf8')).toBe('healthy disk content')
  expect(await fs.readFile(intent, 'utf8')).toBe('{corrupt untouched')
})
