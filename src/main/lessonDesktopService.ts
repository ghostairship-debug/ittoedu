import type { ConversationOwner, LessonWorkspace } from '../shared/lessonWorkspace'
import { conversationOwnerOf } from '../shared/lessonWorkspace'
import { readCourseProjectFileIdentity } from './projectFileIdentity'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { lessonDesktopRequestSchema, type LessonDesktopResult } from '../shared/lessonDesktopContract'
import { LessonWorkspaceService } from './lessonWorkspace'
import { LessonProjectRegistry } from './lessonProjects'
import { LessonConversationRepository } from './localAgent/lessonConversationRepository'
import { createWorkspaceIdentity } from './workspaceIdentity'
import { normalizeWorkspacePath, type WorkspaceIdentityV1 } from '../shared/workspaceIdentity'
import { openSelectedProjectFile } from './fileDialogs'
import { relocateLocalAgentLesson, deleteLocalAgentConversationRecords, searchLocalAgentConversations, deleteAllLocalAgentApplicationRecords, assertLocalAgentRecordsAvailable } from './localAgent/service'

let workspaces: LessonWorkspaceService | undefined
let conversations: LessonConversationRepository | undefined
let projects: LessonProjectRegistry | undefined
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
/** F01：解析会话归属。旧请求只有 lesson 字段时按课例归属处理。 */
function normalizeOwnerRoot(value: string): string {
  const paths = process.platform === 'win32' ? path.win32 : path.posix
  return normalizeWorkspacePath(paths.normalize(value))
}
function resolveOwner(input: { owner?: ConversationOwner; lesson?: LessonWorkspace['identity'] }): ConversationOwner {
  if (input.owner) {
    const owner = input.owner
    if (owner.kind === 'workspace') return { kind: 'workspace', workspaceRoot: normalizeOwnerRoot(owner.workspaceRoot) }
    if (owner.kind === 'project') return { kind: 'project', workspaceRoot: normalizeOwnerRoot(owner.workspaceRoot), projectPath: normalizeOwnerRoot(owner.projectPath) }
    return owner
  }
  if (input.lesson) return { kind: 'lesson', lesson: input.lesson }
  throw new Error('缺少会话归属')
}
async function assertOwnerAvailable(owner: ConversationOwner): Promise<void> {
  if (owner.kind === 'lesson') return
  const root = owner.kind === 'workspace' ? owner.workspaceRoot : owner.projectPath
  const real = await fs.realpath(root)
  if (!(await fs.stat(real)).isDirectory()) throw new Error(owner.kind === 'workspace' ? '工作空间目录不可用' : '项目文件夹不可用')
  if (owner.kind === 'project') {
    // 项目归属要求项目目录仍位于其登记的工作空间根内
    const relative = path.relative(owner.workspaceRoot.replace(/\//g, path.sep), real)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('项目文件夹已移出工作空间，请重新指定项目')
  }
}
export async function operateLessonDesktop(window: BrowserWindow, request: unknown): Promise<LessonDesktopResult> {
  const input = lessonDesktopRequestSchema.parse(request)
  assertLocalAgentRecordsAvailable()
  workspaces ??= new LessonWorkspaceService(app.getPath('userData'))
  conversations ??= new LessonConversationRepository(app.getPath('userData'))
  projects ??= new LessonProjectRegistry(app.getPath('userData'))
  switch (input.operation) {
    case 'delete-all-application-records': await deleteAllLocalAgentApplicationRecords(); return { conversations: [] }
    case 'open-external': {
      // F06：经系统关联宿主打开真实文件；无关联程序或失败时回执明确，不抛错中断流程。
      const filename = await fs.realpath(input.path)
      const error = await shell.openPath(filename)
      return error ? { opened: false, openError: error } : { opened: true }
    }
    case 'list-projects': return { projects: await projects.list(input.directory) }
    case 'create-project': return { project: await projects.designate(input.directory, input.name, input.path) }
    case 'remove-project': return { projects: await projects.remove(input.directory, input.path) }
    case 'search-conversations': { const owner = resolveOwner(input); await assertOwnerAvailable(owner); return { matches: await searchLocalAgentConversations(owner, input.query) } }
    case 'branch-conversation': { const owner = resolveOwner(input); await assertOwnerAvailable(owner); return { conversation: await conversations.branch(owner, input.conversationId) } }
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
    case 'choose-project-directory': {
      // V3.1：新建项目先弹系统选择文件夹位置；对话框内可直接新建文件夹。
      const result = await dialog.showOpenDialog(window, { title: '选择项目文件夹（可在对话框中新建文件夹）', defaultPath: input.directory, properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled || !result.filePaths[0]) return { cancelled: true }
      return { directory: await fs.realpath(result.filePaths[0]) }
    }
    case 'create-file': {
      // V3.1：内容标签行「＋」新建 Markdown 文档，真实落盘到工作空间根目录。
      const root = await fs.realpath(input.directory)
      const name = input.name.trim()
      if (!/\.md$/i.test(name)) throw new Error('当前仅支持新建 Markdown（.md）文档')
      const folder = path.join(root)
      const target = path.join(folder, name)
      if (path.dirname(target) !== folder) throw new Error('文件名不合法')
      try {
        const handle = await fs.open(target, 'wx')
        await handle.writeFile(`# ${name.replace(/\.md$/i, '')}\n\n`, 'utf8')
        await handle.close()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('已存在同名文件')
        throw error
      }
      return { directory: root }
    }
    case 'open-workspace': return { directory: await openWorkspace(input.directory) }
    case 'list-directory': {
      const directory = await fs.realpath(input.directory)
      const entries = await fs.readdir(directory, { withFileTypes: true })
      return { directory, entries: entries.filter(entry => entry.isDirectory() || entry.isFile()).map(entry => ({ name: entry.name, path: path.join(directory, entry.name), kind: entry.isDirectory() ? 'directory' as const : 'file' as const })).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'directory' ? -1 : 1) }
    }
    case 'create-lesson': {
      const lesson = await workspaces.create(input.directory, input.name)
      return { lesson, conversation: await conversations.create({ kind: 'lesson', lesson: lesson.identity }) }
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
      const records = await conversations.list({ kind: 'lesson', lesson: lesson.identity })
      const target = await currentLessonProjectTarget(workspaces, lesson)
      let conversation = [...records.records].filter(record => target
        ? record.projectTarget?.projectId === target.projectId && record.projectTarget.normalizedPath === target.normalizedPath
        : !record.projectTarget).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (!conversation) {
        assertLocalAgentRecordsAvailable()
        conversation = await conversations.create({ kind: 'lesson', lesson: lesson.identity }, undefined, target)
      }
      return { lesson, conversations: records.records.some(record => record.conversationId === conversation.conversationId) ? records.records : [...records.records, conversation], damaged: records.damaged, conversation }
    }
    case 'list-lessons': return { lessons: await workspaces.list(input.directory) }
    case 'delete-conversation': {
      const owner = resolveOwner(input)
      await assertOwnerAvailable(owner)
      await deleteLocalAgentConversationRecords(owner, input.conversationId)
      return { conversations: (await conversations.list(owner)).records }
    }
    case 'register-document': return { lesson: await workspaces.registerDocument(input.lesson, input.role, input.relativePath) }
    case 'list-conversations': {
      const owner = resolveOwner(input)
      await assertOwnerAvailable(owner)
      const result = await conversations.list(owner)
      return { conversations: result.records, damaged: result.damaged }
    }
    case 'create-conversation': {
      const owner = resolveOwner(input)
      await assertOwnerAvailable(owner)
      let projectTarget: WorkspaceIdentityV1 | undefined
      if (owner.kind === 'lesson') {
        const lesson = await workspaces.read(owner.lesson)
        projectTarget = await currentLessonProjectTarget(workspaces, lesson)
      }
      assertLocalAgentRecordsAvailable()
      return { conversation: await conversations.create(owner, input.title, projectTarget) }
    }
    case 'bind-project': {
      // Validate the files before binding, and resolve conversation ownership before
      // changing the lesson's current project. A rejected target must leave it intact.
      const owner = resolveOwner(input)
      await fs.realpath(input.projectPath)
      const target = createWorkspaceIdentity(input.projectId, input.projectPath)
      if (owner.kind === 'lesson') {
        await workspaces.read(owner.lesson)
        const conversation = input.saveAs
          ? await conversations.create(owner, '另存工程对话', target)
          : await conversations.bindFirstProject(owner, input.conversationId, target)
        const lesson = await workspaces.bindProject(owner.lesson, input.projectPath)
        return { lesson, conversation }
      }
      await assertOwnerAvailable(owner)
      const conversation = input.saveAs
        ? await conversations.rebindProjectTarget(owner, input.conversationId, target)
        : await conversations.bindFirstProject(owner, input.conversationId, target)
      return { conversation }
    }
  }
}
