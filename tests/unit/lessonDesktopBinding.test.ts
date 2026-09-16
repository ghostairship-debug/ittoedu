// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData }, dialog: {} }))
vi.mock('../../src/main/fileDialogs', () => ({ openSelectedProjectFile: vi.fn() }))
vi.mock('../../src/main/localAgent/service', () => ({ assertLocalAgentRecordsAvailable: vi.fn() }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'
import { LessonWorkspaceService } from '../../src/main/lessonWorkspace'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
let root: string
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-binding-')); state.userData = path.join(root, 'app') })
afterAll(async () => { if (!root || !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root'); await fs.rm(root, { recursive: true, force: true }) })
it('keeps the manifest and conversation on rejected rebind, while first save and Save As bind their actual targets', async () => {
  const window = {} as BrowserWindow
  const created = await operateLessonDesktop(window, { operation: 'create-lesson', directory: root, name: '课例' })
  const lesson = created.lesson!, conversation = created.conversation!
  const originalPath = path.join(lesson.identity.normalizedDirectory, 'original.h5lesson')
  const otherPath = path.join(lesson.identity.normalizedDirectory, 'other.h5lesson')
  await fs.writeFile(originalPath, 'saved original'); await fs.writeFile(otherPath, 'saved copy')
  const bind = { operation: 'bind-project', lesson: lesson.identity, conversationId: conversation.conversationId, projectId: 'original', projectPath: originalPath, saveAs: false }
  const first = await operateLessonDesktop(window, bind)
  expect(first.conversation!.conversationId).toBe(conversation.conversationId)
  expect(first.lesson!.manifest.coursePath).toBe('original.h5lesson')
  const manifestPath = path.join(lesson.identity.normalizedDirectory, '.courseware', 'lesson.json')
  const originalManifest = await fs.readFile(manifestPath, 'utf8')
  await expect(operateLessonDesktop(window, { ...bind, projectId: 'replacement', projectPath: otherPath })).rejects.toThrow('新对话')
  expect(await fs.readFile(manifestPath, 'utf8')).toBe(originalManifest)
  const repository = new LessonConversationRepository(state.userData)
  expect((await repository.list(lesson.identity)).records.find(item => item.conversationId === conversation.conversationId)!.projectTarget).toEqual(first.conversation!.projectTarget)
  const savedAs = await operateLessonDesktop(window, { ...bind, projectId: 'replacement', projectPath: otherPath, saveAs: true })
  expect(savedAs.conversation!.conversationId).not.toBe(conversation.conversationId)
  expect(savedAs.conversation!.sessionIds).toEqual([])
  expect(savedAs.conversation!.projectTarget!.projectId).toBe('replacement')
  expect((await new LessonWorkspaceService(state.userData).read(lesson.identity)).manifest.coursePath).toBe('other.h5lesson')
  expect((await repository.list(lesson.identity)).records.find(item => item.conversationId === conversation.conversationId)!.projectTarget).toEqual(first.conversation!.projectTarget)
})
