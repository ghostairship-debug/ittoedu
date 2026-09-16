// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {} }))
vi.mock('../../src/main/localAgent/service', () => ({ operateLocalAgent: vi.fn(), registerLessonRecordsInvalidator: vi.fn() }))
vi.mock('../../src/main/lessonDocumentDesktopService', () => ({ lessonDocumentFiles: vi.fn() }))
import { LessonDocumentAiTasks } from '../../src/main/lessonDocumentAiTask'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import type { LocalAgentResponse } from '../../src/shared/localAgentContract'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe temporary path'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'document-ai-')); roots.push(root)
 const lessonId = randomUUID(), ref = { lessonId, lessonDirectory: root, relativePath: 'plan.md' }
 const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId, normalizedDirectory: root.replace(/\\/g, '/').toLowerCase(), conversationId: randomUUID() }
 await fs.writeFile(path.join(root, 'plan.md'), '甲原稿\n乙原稿\n丙原稿')
 const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), validateTarget: async () => {} })
 const session = new DocumentFileSession(ref, files); await session.open()
 const sessionId = randomUUID()
 const agent = vi.fn(async (request: { operation: string }) => ({ enabled: true, ...(request.operation === 'lesson-start' ? { sessionId } : request.operation === 'lesson-read' ? { records: [{ id: sessionId, status: 'completed' }] } : {}) }) as LocalAgentResponse)
 const tasks = new LessonDocumentAiTasks({ directory: path.join(root, 'staging'), files, agent })
 const source = session.getSnapshot().source, ranges = [{ from: 0, to: source.length, before: source, after: source }]
 const prepared = await session.prepareAiEdit(ranges, 10); if (prepared.status !== 'ready') throw Error(prepared.message)
 const run = await tasks.operate({ operation: 'start', workspace, ref, ranges, baseVersion: prepared.document.version, epoch: 10, adapter: 'codex', instruction: '修改甲和乙两句' })
 return { root, ref, workspace, files, session, tasks, run, agent, candidate: async (edits: unknown) => fs.writeFile(path.join(root, 'staging', run.taskId, 'candidate.json'), JSON.stringify({ edits })) }
}
it('native staging applies only nonconflicting ranges, retains suggestions, survives reopen and selectively reverts', async () => {
 const f = await fixture()
 try {
  await f.candidate([{ from: 0, to: 3, before: '甲原稿', after: '甲AI稿' }, { from: 4, to: 7, before: '乙原稿', after: '乙AI稿' }])
  f.session.edit('甲教师稿\n乙原稿\n丙手改'); await f.session.flush()
  const ready = await f.tasks.operate({ operation: 'read', workspace: f.workspace, taskId: f.run.taskId })
  expect(ready.status).toBe('candidate')
  const applied = await f.session.applyAiEdit(ready.apply!)
  expect(applied.status).toBe('partial')
  expect(await fs.readFile(path.join(f.root, 'plan.md'), 'utf8')).toBe('甲教师稿\n乙AI稿\n丙手改')
  expect(f.session.getSnapshot().aiSuggestions[0]!.edit.after).toBe('甲AI稿')
  await f.session.close()
  const reopened = new DocumentFileSession(f.ref, f.files); await reopened.open()
  expect(reopened.getSnapshot().aiRecords).toHaveLength(1)
  await reopened.revertAiEdit(reopened.getSnapshot().aiRecords[0]!)
  expect(await fs.readFile(path.join(f.root, 'plan.md'), 'utf8')).toBe('甲教师稿\n乙原稿\n丙手改')
  await reopened.clearAiMarkers(); await reopened.close()
  expect(await f.files.readAiRecords(f.ref)).toEqual([])
 } finally { f.session.dispose() }
})
it('deleted conversation invalidates even an already delivered candidate', async () => {
 const f = await fixture()
 try {
  await f.candidate([{ from: 0, to: 3, before: '甲原稿', after: '甲AI稿' }])
  const ready = await f.tasks.operate({ operation: 'read', workspace: f.workspace, taskId: f.run.taskId })
  await f.tasks.invalidate({ lesson: { schemaVersion: 1, lessonId: f.ref.lessonId, normalizedDirectory: f.root }, conversationId: f.workspace.conversationId })
  expect((await f.session.applyAiEdit(ready.apply!)).status).toBe('failed')
  expect((await f.tasks.operate({ operation: 'read', workspace: f.workspace, taskId: f.run.taskId })).status).toBe('stopped')
  expect(await fs.readFile(path.join(f.root, 'plan.md'), 'utf8')).toContain('甲原稿')
 } finally { f.session.dispose() }
})
it('rejects wrong baseline text before file application', async () => {
 const f = await fixture()
 try {
  await f.candidate([{ from: 0, to: 3, before: '伪造原文', after: 'AI稿' }])
  expect((await f.tasks.operate({ operation: 'read', workspace: f.workspace, taskId: f.run.taskId })).status).toBe('failed')
  expect(await fs.readFile(path.join(f.root, 'plan.md'), 'utf8')).toContain('甲原稿')
 } finally { f.session.dispose() }
})
it('explicitly accepting a merged recovery clears the resolved older draft instead of blocking the stage forever', async () => {
 const f = await fixture()
 try {
  const disk = await f.files.openDocument(f.ref)
  const recoveryKey = createHash('sha256').update(JSON.stringify([f.ref.lessonId, f.ref.relativePath])).digest('hex')
  const recoveryDirectory = path.join(f.root, 'recovery', recoveryKey)
  await fs.mkdir(recoveryDirectory, { recursive: true })
  // Reproduce the previous build's clean-preserve record, then an external/new candidate write.
  await fs.writeFile(path.join(recoveryDirectory, 'draft.json'), JSON.stringify({ source: disk.source, baseSource: disk.source, expectedVersion: disk.version, attachments: [] }))
  await fs.writeFile(path.join(f.root, 'plan.md'), disk.source + '\n外部文字')
  await f.session.close()
  const reopened = new DocumentFileSession(f.ref, f.files); await reopened.open()
  expect(reopened.getSnapshot().recovery).toBe(true)
  expect(reopened.getSnapshot().conflictHunks).toEqual([])
  const hunks = reopened.getSnapshot().conflictHunks
  for (const hunk of hunks) await reopened.resolveConflictHunk(hunk.id, 'remote')
  if (reopened.getSnapshot().recovery) await reopened.resolveConflict('recovery')
  expect(await f.files.readRecovery(f.ref)).toBeNull()
  await reopened.close()
 } finally { f.session.dispose() }
})


it('derives separated canonical ranges from a full replacement and preserves concurrent teacher edits', async () => {
 const f = await fixture()
 try {
  const staging = path.join(f.root, 'staging', f.run.taskId)
  await fs.writeFile(path.join(staging, 'replacement.md'), '甲AI稿\n乙AI稿\n丙原稿')
  await fs.writeFile(path.join(staging, 'candidate.json'), JSON.stringify({ replacementFile: 'replacement.md' }))
  f.session.edit('甲教师稿\n乙原稿\n丙手改'); await f.session.flush()
  const ready = await f.tasks.operate({ operation: 'read', workspace: f.workspace, taskId: f.run.taskId })
  expect(ready.status).toBe('candidate')
  expect(ready.apply!.edits).toHaveLength(2)
  const applied = await f.session.applyAiEdit(ready.apply!)
  expect(applied.status).toBe('partial')
  expect(await fs.readFile(path.join(f.root, 'plan.md'), 'utf8')).toBe('甲教师稿\n乙AI稿\n丙手改')
 } finally { f.session.dispose() }
})
it('rejects replacement paths outside the fixed staging file without writing the document', async () => {
 const f = await fixture()
 try {
  await fs.writeFile(path.join(f.root, 'staging', f.run.taskId, 'candidate.json'), JSON.stringify({ replacementFile: '../plan.md' }))
  expect((await f.tasks.operate({ operation: 'read', workspace: f.workspace, taskId: f.run.taskId })).status).toBe('failed')
  expect(await fs.readFile(path.join(f.root, 'plan.md'), 'utf8')).toBe('甲原稿\n乙原稿\n丙原稿')
 } finally { f.session.dispose() }
})
