// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-workspace-')); roots.push(root)
 const userData = path.join(root, 'app'), workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
 return { root, userData, workspace, service: new LessonWorkspaceService(userData), conversations: new LessonConversationRepository(userData) }
}
describe('real lesson ownership', () => {
 it('creates independent same-name lessons, preserves teacher files, rejects overwrite and reopens identity', async () => {
  const f = await fixture(); const a = await f.service.create(f.workspace, '课例')
  await expect(f.service.create(f.workspace, '课例')).rejects.toMatchObject({ code: 'EEXIST' })
  const nested = path.join(f.workspace, '其他'); await fs.mkdir(nested)
  const b = await f.service.create(nested, '课例'); expect(a.identity.lessonId).not.toBe(b.identity.lessonId)
  await fs.writeFile(path.join(nested, '教案.md'), '# 保留')
  await f.service.open(nested); expect(await fs.readFile(path.join(nested, '教案.md'), 'utf8')).toBe('# 保留')
  expect((await new LessonWorkspaceService(f.userData).open(a.identity.normalizedDirectory)).identity).toEqual(a.identity)
  expect(await f.service.list(f.workspace)).toHaveLength(3)
 })
 it('registers only actual confined documents and rejects stale symlink targets', async () => {
  const f = await fixture(), lesson = await f.service.create(f.workspace, '课例')
  await expect(f.service.registerDocument(lesson.identity, 'teaching-plan', 'plan.md')).rejects.toMatchObject({ code: 'ENOENT' })
  await fs.writeFile(path.join(lesson.identity.normalizedDirectory, 'plan.md'), '# 当前稿')
  expect((await f.service.registerDocument(lesson.identity, 'teaching-plan', 'plan.md')).manifest.documents['teaching-plan']).toBe('plan.md')
  await expect(f.service.registerDocument(lesson.identity, 'teaching-plan', '../outside.md')).rejects.toThrow()
  const elsewhere = path.join(f.workspace, 'redirected'); await fs.rename(lesson.identity.normalizedDirectory, elsewhere)
  await fs.symlink(elsewhere, lesson.identity.normalizedDirectory, 'junction')
  await expect(f.service.read(lesson.identity)).rejects.toThrow('真实目录已变化')
 })
 it('first save retains conversation and external Save As cannot escape relative manifest', async () => {
  const f = await fixture(), lesson = await f.service.create(f.workspace, '课例')
  const c = await f.conversations.create(lesson.identity); const file = path.join(lesson.identity.normalizedDirectory, 'course.h5lesson')
  await fs.writeFile(file, 'fixture'); const target = createWorkspaceIdentity('project', file)
  expect((await f.service.bindProject(lesson.identity, file)).manifest.coursePath).toBe('course.h5lesson')
  const bound = await f.conversations.bindFirstProject(lesson.identity, c.conversationId, target)
  expect(bound.conversationId).toBe(c.conversationId); expect(bound.epoch).toBe(1)
  await expect(f.conversations.attachSession(lesson.identity, c.conversationId, randomUUID(), 0)).rejects.toThrow('失效')
  const outside = path.join(f.root, 'other.h5lesson'); await fs.writeFile(outside, 'fixture')
  expect((await f.service.bindProject(lesson.identity, outside)).manifest.coursePath).toBe('course.h5lesson')
  await expect(f.conversations.bindFirstProject(lesson.identity, c.conversationId, createWorkspaceIdentity('project', outside))).rejects.toThrow('新对话')
 })
 it('isolates malformed records and deletes only records after epoch invalidation and stop', async () => {
  const f = await fixture(), lesson = await f.service.create(f.workspace, '课例')
  const c = await f.conversations.create(lesson.identity), session = randomUUID()
  await f.conversations.attachSession(lesson.identity, c.conversationId, session, 0)
  const directory = path.join(f.userData, 'lesson-conversations', 'v1', lesson.identity.lessonId)
  const bad = randomUUID(); await fs.writeFile(path.join(directory, `${bad}.json`), '{')
  const listed = await f.conversations.list(lesson.identity); expect(listed.records).toHaveLength(1); expect(listed.damaged).toHaveLength(1)
  const draft = path.join(f.userData, 'recovery.md'); await fs.writeFile(draft, 'unsaved')
  await f.conversations.delete(lesson.identity, c.conversationId, async ids => {
   expect(ids).toEqual([session]); const record = JSON.parse(await fs.readFile(path.join(directory, `${c.conversationId}.json`), 'utf8')); expect(record.epoch).toBe(1)
  })
  expect((await f.conversations.list(lesson.identity)).records).toHaveLength(0)
  expect(await fs.readFile(draft, 'utf8')).toBe('unsaved'); expect((await f.service.read(lesson.identity)).manifest.lessonId).toBe(lesson.identity.lessonId)
 })
 it('reassociates moved lessons and refuses identical live copies', async () => {
  const f = await fixture(), lesson = await f.service.create(f.workspace, '课例'), c = await f.conversations.create(lesson.identity)
  const copy = path.join(f.workspace, '副本'); await fs.cp(lesson.identity.normalizedDirectory, copy, { recursive: true })
  await expect(f.service.open(copy)).rejects.toThrow('LESSON_COPY_REQUIRED')
  await expect(f.service.open(lesson.identity.normalizedDirectory, { asCopy: true })).rejects.toThrow('自身副本')
  const copied = await f.service.open(copy, { asCopy: true }); expect(copied.identity.lessonId).not.toBe(lesson.identity.lessonId)
  const moved = path.join(f.workspace, '移动'); await fs.rename(lesson.identity.normalizedDirectory, moved)
  const reopened = await f.service.open(moved); expect(reopened.previousIdentity).toEqual(lesson.identity); expect(reopened.identity.lessonId).toBe(lesson.identity.lessonId)
  await f.conversations.relocate(lesson.identity, reopened.identity)
  expect((await f.conversations.list(reopened.identity)).records[0]!.conversationId).toBe(c.conversationId)
 })
})
