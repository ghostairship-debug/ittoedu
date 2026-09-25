import { authorizeWorkspaceFilesRoot } from './workbench/workspaceFilesDesktopService'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { lessonDesktopRequestSchema, type LessonDesktopResult } from '../shared/lessonDesktopContract'
import { LessonWorkspaceService } from './lessonWorkspace'
import { LessonProjectRegistry } from './lessonProjects'
import { openSelectedProjectFile } from './fileDialogs'

let workspaces: LessonWorkspaceService | undefined
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
  await authorizeWorkspaceFilesRoot(real)
  return real
}
export async function operateLessonDesktop(window: BrowserWindow, request: unknown): Promise<LessonDesktopResult> {
  const input = lessonDesktopRequestSchema.parse(request)
  workspaces ??= new LessonWorkspaceService(app.getPath('userData'))
  projects ??= new LessonProjectRegistry(app.getPath('userData'))
  switch (input.operation) {
    case 'open-external': {
      // F06：经系统关联宿主打开真实文件；无关联程序或失败时回执明确，不抛错中断流程。
      const filename = await fs.realpath(input.path)
      const error = await shell.openPath(filename)
      return error ? { opened: false, openError: error } : { opened: true }
    }
    case 'list-projects': return { projects: await projects.list(input.directory) }
    case 'create-project': return { project: await projects.designate(input.directory, input.name, input.path) }
    case 'remove-project': return { projects: await projects.remove(input.directory, input.path) }
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
    case 'open-workspace': {
      const real = await fs.realpath(input.directory)
      const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
      if (!(await recentWorkspaces()).some(directory => key(directory) === key(real))) throw new Error('请通过工作空间选择器授权新的目录')
      return { directory: await openWorkspace(real) }
    }
    case 'list-directory': {
      const directory = await fs.realpath(input.directory)
      const entries = await fs.readdir(directory, { withFileTypes: true })
      return { directory, entries: entries.filter(entry => entry.isDirectory() || entry.isFile()).map(entry => ({ name: entry.name, path: path.join(directory, entry.name), kind: entry.isDirectory() ? 'directory' as const : 'file' as const })).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'directory' ? -1 : 1) }
    }
    case 'create-lesson': {
      const lesson = await workspaces.create(input.directory, input.name)
      return { lesson }
    }
    case 'open-lesson': {
      let directory = input.directory
      if (!directory) {
        const result = await dialog.showOpenDialog(window, { title: '打开课例目录', properties: ['openDirectory'] })
        if (result.canceled || !result.filePaths[0]) return { cancelled: true }
        directory = result.filePaths[0]
      }
      const lesson = await workspaces.open(directory, { asCopy: input.asCopy })
      return { lesson }
    }
    case 'list-lessons': return { lessons: await workspaces.list(input.directory) }
    case 'register-document': return { lesson: await workspaces.registerDocument(input.lesson, input.role, input.relativePath) }
  }
}
