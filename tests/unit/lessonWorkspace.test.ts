// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-workspace-')); roots.push(root)
 const userData = path.join(root, 'app'), workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
 return { root, userData, workspace, service: new LessonWorkspaceService(userData) }
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
 it('first save binds a local file and external Save As cannot escape the relative manifest', async () => {
  const f = await fixture(), lesson = await f.service.create(f.workspace, '课例')
  const file = path.join(lesson.identity.normalizedDirectory, 'course.h5lesson')
  await fs.writeFile(file, 'fixture'); const target = createWorkspaceIdentity('project', file)
  expect((await f.service.bindProject(lesson.identity, file)).manifest.coursePath).toBe('course.h5lesson')
  const outside = path.join(f.root, 'other.h5lesson'); await fs.writeFile(outside, 'fixture')
  expect((await f.service.bindProject(lesson.identity, outside)).manifest.coursePath).toBe('course.h5lesson')
 })
 
 it('reassociates moved lessons and refuses identical live copies', async () => {
  const f = await fixture(), lesson = await f.service.create(f.workspace, '课例')
  const copy = path.join(f.workspace, '副本'); await fs.cp(lesson.identity.normalizedDirectory, copy, { recursive: true })
  await expect(f.service.open(copy)).rejects.toThrow('LESSON_COPY_REQUIRED')
  await expect(f.service.open(lesson.identity.normalizedDirectory, { asCopy: true })).rejects.toThrow('自身副本')
  const copied = await f.service.open(copy, { asCopy: true }); expect(copied.identity.lessonId).not.toBe(lesson.identity.lessonId)
  const moved = path.join(f.workspace, '移动'); await fs.rename(lesson.identity.normalizedDirectory, moved)
  const reopened = await f.service.open(moved); expect(reopened.previousIdentity).toEqual(lesson.identity); expect(reopened.identity.lessonId).toBe(lesson.identity.lessonId)
 })
})
