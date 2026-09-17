// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { zipSync, strToU8 } from 'fflate'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData }, dialog: {} }))
vi.mock('../../src/main/localAgent/service', () => ({ assertLocalAgentRecordsAvailable: vi.fn() }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
let root: string
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'new-conversation-target-')); state.userData = path.join(root, 'app') })
afterAll(async () => { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root'); await fs.rm(root, { recursive: true, force: true }) })
const window = {} as BrowserWindow
function archive(id: string) {
  const project = { ...createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), id }
  return { project, bytes: createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }) }
}
describe('new lesson conversation current file target', () => {
  it('opens a saved independent copy with exactly one target-bound conversation and reuses it on reopen', async () => {
    const created = await operateLessonDesktop(window, { operation: 'create-lesson', directory: root, name: '原保存课例副本验证' })
    const lesson = created.lesson!, workspaces = new LessonWorkspaceService(state.userData), repository = new LessonConversationRepository(state.userData)
    const saved = archive('copied-real-project'), filename = path.join(lesson.identity.normalizedDirectory, 'course.h5lesson')
    await fs.writeFile(filename, saved.bytes)
    await workspaces.bindProject(lesson.identity, filename)
    const copyDirectory = path.join(root, '真实复制目录')
    await fs.cp(lesson.identity.normalizedDirectory, copyDirectory, { recursive: true })
    const opened = await operateLessonDesktop(window, { operation: 'open-lesson', directory: copyDirectory, asCopy: true })
    expect(opened.lesson!.identity.lessonId).not.toBe(lesson.identity.lessonId)
    expect(opened.conversations).toHaveLength(1)
    expect(opened.conversation!.projectTarget).toEqual({ version: 1, projectId: saved.project.id, normalizedPath: path.join(copyDirectory, 'course.h5lesson').replace(/\\/g, '/').toLowerCase() })
    expect(opened.conversation!.sessionIds).toEqual([])
    expect((await repository.list({ kind: 'lesson', lesson: opened.lesson!.identity })).records).toHaveLength(1)
    const again = await operateLessonDesktop(window, { operation: 'open-lesson', directory: copyDirectory })
    expect(again.conversation!.conversationId).toBe(opened.conversation!.conversationId)
    expect(again.conversations).toHaveLength(1)
    expect((await repository.list({ kind: 'lesson', lesson: lesson.identity })).records).toHaveLength(1)
  })
  it('keeps unsaved lesson conversations independent without inventing a project target', async () => {
    const created = await operateLessonDesktop(window, { operation: 'create-lesson', directory: root, name: '未保存课例' })
    const result = await operateLessonDesktop(window, { operation: 'create-conversation', lesson: created.lesson!.identity })
    expect(result.conversation!.projectTarget).toBeUndefined()
    expect(result.conversation!.sessionIds).toEqual([])
  })
  it('reads the current strict V9 file after first save and Save As instead of guessing a historical conversation target', async () => {
    const created = await operateLessonDesktop(window, { operation: 'create-lesson', directory: root, name: '保存课例' })
    const lesson = created.lesson!, repository = new LessonConversationRepository(state.userData), workspaces = new LessonWorkspaceService(state.userData)
    const first = archive('actual-first-project'), firstPath = path.join(lesson.identity.normalizedDirectory, 'first.h5lesson')
    await fs.writeFile(firstPath, first.bytes)
    await workspaces.bindProject(lesson.identity, firstPath)
    await repository.create({ kind: 'lesson', lesson: lesson.identity }, '历史旧目标', { version: 1, projectId: 'unrelated-old-project', normalizedPath: firstPath.replace(/\\/g, '/').toLowerCase() })
    const result = await operateLessonDesktop(window, { operation: 'create-conversation', lesson: lesson.identity, title: '新普通对话' })
    expect(result.conversation!.projectTarget).toEqual({ version: 1, projectId: first.project.id, normalizedPath: firstPath.replace(/\\/g, '/').toLowerCase() })
    expect(result.conversation!.sessionIds).toEqual([])
    expect(result.conversation!.parentConversationId).toBeUndefined()
    expect(await fs.readFile(firstPath)).toEqual(Buffer.from(first.bytes))
    const copy = archive('actual-saved-as-project'), copyPath = path.join(lesson.identity.normalizedDirectory, 'copy.h5lesson')
    await fs.writeFile(copyPath, copy.bytes); await workspaces.bindProject(lesson.identity, copyPath)
    const next = await operateLessonDesktop(window, { operation: 'create-conversation', lesson: lesson.identity })
    expect(next.conversation!.projectTarget?.projectId).toBe(copy.project.id)
    expect(next.conversation!.projectTarget?.normalizedPath).toBe(copyPath.replace(/\\/g, '/').toLowerCase())
    expect((await repository.list({ kind: 'lesson', lesson: lesson.identity })).records.find(record => record.conversationId === result.conversation!.conversationId)?.projectTarget?.projectId).toBe(first.project.id)
    expect(await fs.readFile(copyPath)).toEqual(Buffer.from(copy.bytes))
  })
  it('rejects a damaged, missing, or obsolete target without creating an unbound conversation or rewriting the lesson', async () => {
    const created = await operateLessonDesktop(window, { operation: 'create-lesson', directory: root, name: '损坏课例' })
    const lesson = created.lesson!, repository = new LessonConversationRepository(state.userData), workspaces = new LessonWorkspaceService(state.userData)
    const filename = path.join(lesson.identity.normalizedDirectory, 'course.h5lesson')
    await fs.writeFile(filename, 'damaged')
    await workspaces.bindProject(lesson.identity, filename)
    const before = await workspaces.read(lesson.identity), request = { operation: 'create-conversation', lesson: lesson.identity }
    await expect(operateLessonDesktop(window, request)).rejects.toThrow()
    const obsolete = archive('obsolete').project
    await fs.writeFile(filename, zipSync({ 'project.json': strToU8(JSON.stringify({ ...obsolete, schemaVersion: 8 })) }))
    await expect(operateLessonDesktop(window, request)).rejects.toThrow()
    await fs.unlink(filename)
    await expect(operateLessonDesktop(window, request)).rejects.toThrow()
    expect((await repository.list({ kind: 'lesson', lesson: lesson.identity })).records).toHaveLength(1)
    expect(await workspaces.read(lesson.identity)).toEqual(before)
  })
})
