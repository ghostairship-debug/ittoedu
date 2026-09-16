import type { LessonWorkspace } from '../shared/lessonWorkspace'
import { readCourseProjectFileIdentity } from './projectFileIdentity'
import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { lessonDesktopRequestSchema, type LessonDesktopResult } from '../shared/lessonDesktopContract'
import { LessonWorkspaceService } from './lessonWorkspace'
import { LessonConversationRepository } from './localAgent/lessonConversationRepository'
import { createWorkspaceIdentity } from './workspaceIdentity'
import { openSelectedProjectFile } from './fileDialogs'
import { relocateLocalAgentLesson, deleteLocalAgentLessonRecords, searchLocalAgentLessonConversations, deleteAllLocalAgentApplicationRecords, assertLocalAgentRecordsAvailable } from './localAgent/service'

let workspaces: LessonWorkspaceService | undefined
let conversations: LessonConversationRepository | undefined
const recentSchema = z.object({ version: z.literal(1), directories: z.array(z.string().min(1)).max(20) }).strict()
async function recentWorkspaces(): Promise<string[]> {
  try { return recentSchema.parse(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'lesson-workspaces-v1.json'), 'utf8'))).directories }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error('最近工作空间记录不可用，请重新打开工作空间') }
}
async function openWorkspace(directory: string): Promise<string> {
  const real = await fs.realpath(directory)
  if (!(await fs.stat(real)).isDirectory()) throw new Error('请选择工作空间目录')
  const directories = [real, ...(await recentWorkspaces()).filter(value => value !== real)].slice(0, 20)
  const destination = path.join(app.getPath('userData'), 'lesson-workspaces-v1.json'), temporary = `${destination}.${randomUUID()}.tmp`
  try { await fs.writeFile(temporary, JSON.stringify({ version: 1, directories }), { flag: 'wx' }); await fs.rename(temporary, destination) }
  finally { await fs.rm(temporary, { force: true }) }
  return real
}
async function currentLessonProjectTarget(service: LessonWorkspaceService, lesson: LessonWorkspace) {
  if (!lesson.manifest.coursePath) return undefined
  const filename = await fs.realpath(path.join(lesson.identity.normalizedDirectory, lesson.manifest.coursePath))
  const relative = path.relative(lesson.identity.normalizedDirectory, filename)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('当前工程已移出课例，请重新打开课例')
  const target = await readCourseProjectFileIdentity(filename)
  const current = await service.read(lesson.identity)
  if (current.manifest.coursePath !== lesson.manifest.coursePath) throw new Error('课例工程目标已变化，请重新创建对话')
  return target
}
export async function operateLessonDesktop(window: BrowserWindow, request: unknown): Promise<LessonDesktopResult> {
  const input = lessonDesktopRequestSchema.parse(request)
  assertLocalAgentRecordsAvailable()
  workspaces ??= new LessonWorkspaceService(app.getPath('userData'))
  conversations ??= new LessonConversationRepository(app.getPath('userData'))
  switch (input.operation) {
    case 'delete-all-application-records': await deleteAllLocalAgentApplicationRecords(); return { conversations: [] }
    case 'search-conversations': { await workspaces.read(input.lesson); return { matches: await searchLocalAgentLessonConversations(input.lesson, input.query) } }
    case 'branch-conversation': { await workspaces.read(input.lesson); return { conversation: await conversations.branch(input.lesson, input.conversationId) } }
    case 'open-project': {
      const filename = await fs.realpath(input.path)
      if (path.extname(filename).toLowerCase() !== '.h5lesson') throw new Error('请选择课件工程文件')
      return { projectFile: await openSelectedProjectFile(filename) }
    }
    case 'recent-workspaces': return { recent: await recentWorkspaces() }
    case 'choose-workspace': {
      const result = await dialog.showOpenDialog(window, { title: input.create ? '新建工作空间：选择或创建目录' : '打开工作空间', properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths[0]) return { cancelled: true }
      return { directory: await openWorkspace(result.filePaths[0]) }
    }
    case 'open-workspace': return { directory: await openWorkspace(input.directory) }
    case 'list-directory': {
      const directory = await fs.realpath(input.directory)
      const entries = await fs.readdir(directory, { withFileTypes: true })
      return { directory, entries: entries.filter(entry => entry.isDirectory() || entry.isFile()).map(entry => ({ name: entry.name, path: path.join(directory, entry.name), kind: entry.isDirectory() ? 'directory' as const : 'file' as const })).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'directory' ? -1 : 1) }
    }
    case 'create-lesson': {
      const lesson = await workspaces.create(input.directory, input.name)
      return { lesson, conversation: await conversations.create(lesson.identity) }
    }
    case 'open-lesson': {
      let directory = input.directory
      if (!directory) {
        const result = await dialog.showOpenDialog(window, { title: '打开课例目录', properties: ['openDirectory'] })
        if (result.canceled || !result.filePaths[0]) return { cancelled: true }
        directory = result.filePaths[0]
      }
      const lesson = await workspaces.open(directory, { asCopy: input.asCopy })
      if (lesson.previousIdentity) {
        await relocateLocalAgentLesson(lesson.previousIdentity, lesson.identity)
        await conversations.relocate(lesson.previousIdentity, lesson.identity)
      }
      const records = await conversations.list(lesson.identity)
      const target = await currentLessonProjectTarget(workspaces, lesson)
      let conversation = [...records.records].filter(record => target
        ? record.projectTarget?.projectId === target.projectId && record.projectTarget.normalizedPath === target.normalizedPath
        : !record.projectTarget).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (!conversation) {
        assertLocalAgentRecordsAvailable()
        conversation = await conversations.create(lesson.identity, undefined, target)
      }
      return { lesson, conversations: records.records.some(record => record.conversationId === conversation.conversationId) ? records.records : [...records.records, conversation], damaged: records.damaged, conversation }
    }
    case 'list-lessons': return { lessons: await workspaces.list(input.directory) }
    case 'delete-conversation': {
      await workspaces.read(input.lesson)
      await deleteLocalAgentLessonRecords(input.lesson, input.conversationId)
      return { conversations: (await conversations.list(input.lesson)).records }
    }
    case 'register-document': return { lesson: await workspaces.registerDocument(input.lesson, input.role, input.relativePath) }
    case 'list-conversations': {
      await workspaces.read(input.lesson)
      const result = await conversations.list(input.lesson)
      return { conversations: result.records, damaged: result.damaged }
    }
    case 'create-conversation': {
      const lesson = await workspaces.read(input.lesson)
      const target = await currentLessonProjectTarget(workspaces, lesson)
      assertLocalAgentRecordsAvailable()
      return { conversation: await conversations.create(input.lesson, input.title, target) }
    }
    case 'bind-project': {
      // Validate the files before binding, and resolve conversation ownership before
      // changing the lesson's current project. A rejected target must leave it intact.
      await workspaces.read(input.lesson)
      await fs.realpath(input.projectPath)
      const target = createWorkspaceIdentity(input.projectId, input.projectPath)
      const conversation = input.saveAs
        ? await conversations.create(input.lesson, '另存工程对话', target)
        : await conversations.bindFirstProject(input.lesson, input.conversationId, target)
      const lesson = await workspaces.bindProject(input.lesson, input.projectPath)
      return { lesson, conversation }
    }
  }
}
