import path from 'node:path'
import { promises as fs } from 'node:fs'
import { workspaceFilesRequestSchema, type RegisteredWorkspaceRoot, type WorkspaceFilesAPI, type WorkspaceFilesChange, type WorkspaceItemResult, type WorkspaceOperationResult } from '../../shared/workbench/workspaceFiles'
import type { WorkspaceFiles } from './WorkspaceFiles'
import { createBlankCourseProject } from '../../core/course/createCourseProject'
import { createDefaultTeacherControllerPackage } from '../../shared/defaultTeacherControllerComponent'
import { createCourseProjectArchive } from '../../core/drivers/codecs/courseProjectArchive'
import { readWorkspaceMediaSelection } from '../fileDialogs'

const pathKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
type HomeRelocation = { from: string; to: string | null; targetWorkspaceId?: string }
type RelocateConversationHomes = (input: { workspaceId: string; sourceRoot: string; targetRoot?: string; changes: HomeRelocation[] }) => Promise<void>

/** Root authorization is granted by native selection or a previously confirmed recent workspace. */
export class WorkspaceFilesDesktopService {
  private readonly authorized = new Map<string, RegisteredWorkspaceRoot>()
  private readonly listeners = new Set<(event: WorkspaceFilesChange) => void>()
  private readonly watchers = new Map<string, () => void>()
  private readonly preparedCourses = new Map<string, { input: string; bytes: Uint8Array }>()
  constructor(private readonly files: WorkspaceFiles, private readonly relocateConversationHomes?: RelocateConversationHomes) { this.operate.subscribe = this.subscribe }
  readonly subscribe = (listener: (event: WorkspaceFilesChange) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  dispose() { for (const close of this.watchers.values()) close(); this.watchers.clear(); this.listeners.clear() }
  private watch(workspaceId: string) {
    if (!this.watchers.has(workspaceId)) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const close = this.files.watch(workspaceId, () => {
        clearTimeout(timer); timer = setTimeout(() => { for (const listener of this.listeners) listener({ workspaceId }) }, 80)
        timer.unref?.()
      })
      this.watchers.set(workspaceId, () => { clearTimeout(timer); close() })
    }
    return { workspaceId, watching: true }
  }
  async authorizeRoot(directory: string): Promise<RegisteredWorkspaceRoot> {
    const root = await this.files.registerRoot(directory)
    this.authorized.set(pathKey(root.resolvedPath), root)
    this.authorized.set(pathKey(directory), root)
    return root
  }
  private async relocate(input: Extract<Parameters<WorkspaceFilesAPI>[0], { type: 'rename' | 'move' | 'trash' }>, result: WorkspaceOperationResult): Promise<WorkspaceOperationResult> {
    if (!this.relocateConversationHomes) return result
    const sourceRoot = [...this.authorized.values()].find(root => root.workspaceId === input.workspaceId)
    const targetWorkspaceId = input.type === 'move' ? input.targetWorkspaceId ?? input.workspaceId : input.workspaceId
    const targetRoot = [...this.authorized.values()].find(root => root.workspaceId === targetWorkspaceId)
    if (!sourceRoot || !targetRoot) return result
    const relative = (root: RegisteredWorkspaceRoot, filename: string) => path.relative(root.resolvedPath, filename).split(path.sep).join('/')
    const changes: HomeRelocation[] = []
    for (const item of result.items) {
      if (item.status !== 'success' && item.status !== 'partial' || !item.sourcePath) continue
      const from = relative(sourceRoot, item.sourcePath)
      if (!from || from === '..' || from.startsWith('../')) continue
      if (input.type === 'trash') {
        try { await fs.lstat(item.sourcePath); continue }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue }
        changes.push({ from, to: null })
      } else if (item.targetPath) {
        const to = relative(targetRoot, item.targetPath)
        if (!to || to === '..' || to.startsWith('../')) continue
        if (item.status === 'partial') {
          try { await fs.lstat(item.targetPath) } catch { continue }
          if (pathKey(item.sourcePath) !== pathKey(item.targetPath)) {
            try { await fs.lstat(item.sourcePath); continue }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue }
          }
        }
        changes.push({ from, to, ...(targetWorkspaceId !== input.workspaceId ? { targetWorkspaceId } : {}) })
      }
    }
    if (!changes.length) return result
    try {
      await this.relocateConversationHomes({ workspaceId: input.workspaceId, sourceRoot: sourceRoot.resolvedPath,
        ...(targetWorkspaceId !== input.workspaceId ? { targetRoot: targetRoot.resolvedPath } : {}), changes })
      // Watcher events can arrive before the conversation index is durable. Emit a
      // second notification after relocation so the session rail reads the new home.
      for (const workspaceId of new Set([input.workspaceId, targetWorkspaceId])) {
        for (const listener of this.listeners) listener({ workspaceId })
      }
      return result
    } catch {
      return { ...result, status: 'partial', items: result.items.map(item => item.status === 'success'
        ? { ...item, status: 'partial', error: { code: 'conversation-home-update-failed', message: '文件操作已发生，但会话所属位置暂未同步；请重试该操作以恢复关联。' } }
        : item) }
    }
  }
  readonly operate: WorkspaceFilesAPI = (async (request: unknown) => {
    const input = workspaceFilesRequestSchema.parse(request)
    if (input.type === 'root') {
      const root = this.authorized.get(pathKey(input.directory))
      if (!root) throw new Error('请先通过工作空间选择器授权此目录')
      return { ...root }
    }
    if (![...this.authorized.values()].some(root => root.workspaceId === input.workspaceId)) throw new Error('工作空间尚未授权')
    if (input.type === 'move' && input.targetWorkspaceId
      && ![...this.authorized.values()].some(root => root.workspaceId === input.targetWorkspaceId)) {
      throw new Error('目标工作空间尚未授权')
    }
    switch (input.type) {
      case 'watch': return this.watch(input.workspaceId)
      case 'list': return this.files.listChildren(input)
      case 'resolve': return this.files.resolveEntry(input.workspaceId, input.entryId)
      case 'read-media': {
        const resolved = await this.files.resolveEntry(input.workspaceId, input.entryId)
        if (resolved.kind !== 'file') throw new Error('只能将媒体文件拖入课件内容')
        const media = await readWorkspaceMediaSelection(resolved.resolvedPath)
        const current = await this.files.resolveEntry(input.workspaceId, input.entryId)
        if (current.kind !== 'file' || pathKey(current.resolvedPath) !== pathKey(resolved.resolvedPath)) throw new Error('媒体文件已变化，请重新拖入')
        return { workspaceId: input.workspaceId, entryId: input.entryId, ...media }
      }
      case 'create-markdown': return this.files.createFile({ ...input, format: 'markdown', bytes: Buffer.from(`# ${input.name.replace(/\.md$/i, '')}\n\n`, 'utf8') })
      case 'create-text': {
        if (/\.h5lesson$/i.test(input.name)) throw new Error('课件请使用“新建课件”，不能创建空的课件文件')
        return this.files.createFile({ ...input, format: 'file', bytes: new Uint8Array() })
      }
      case 'create-course': {
        const identity = JSON.stringify(input), old = this.preparedCourses.get(input.operationId)
        if (old && old.input !== identity) throw new Error('同一文件操作不能改变参数')
        if (!old) {
          const project = createBlankCourseProject({ title: input.name.replace(/\.h5lesson$/i, '') })
          const component = createDefaultTeacherControllerPackage()
          this.preparedCourses.set(input.operationId, { input: identity, bytes: createCourseProjectArchive({ project, assetFiles: {}, componentFiles: { [`${component.manifest.id}@${component.manifest.version}`]: component.files } }) })
        }
        return this.files.createFile({ ...input, format: 'course-v9', bytes: this.preparedCourses.get(input.operationId)!.bytes })
      }
      case 'import-files': {
        const items: WorkspaceItemResult[] = [], directories = new Map<string, string>([['', input.targetDirectoryId]])
        const needed = new Set(input.directories ?? [])
        for (const file of input.files) { const parts = file.name.split('/'); for (let length = 1; length < parts.length; length++) needed.add(parts.slice(0, length).join('/')) }
        for (const directory of [...needed]) { const parts = directory.split('/'); for (let length = 1; length < parts.length; length++) needed.add(parts.slice(0, length).join('/')) }
        if (!needed.size && !input.files.length) throw new Error('没有可导入的文件')
        for (const [directoryIndex, directory] of [...needed].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).entries()) {
          const pieces = directory.split('/'), name = pieces.pop()!, parent = directories.get(pieces.join('/'))
          if (!parent) { items.push({ status: 'failed', affectedPaths: [], error: { code: 'import-parent-failed', message: `${directory}：父文件夹未创建，已跳过` } }); continue }
          try {
            const result = await this.files.mkdir({ workspaceId: input.workspaceId, operationId: `${input.operationId}:d:${directoryIndex}`, targetDirectoryId: parent, name })
            const created = result.items.find(item => item.status === 'success' && item.entryId)
            if (created) directories.set(directory, created.entryId!)
            items.push(...result.items)
          } catch (error) { items.push({ status: 'failed', affectedPaths: [], error: { code: 'import-failed', message: `${directory}：${error instanceof Error ? error.message : String(error)}` } }) }
        }
        for (const [index, file] of input.files.entries()) {
          try {
            const pieces = file.name.split('/'), name = pieces.pop()!, parent = directories.get(pieces.join('/'))
            if (!parent) throw new Error('父文件夹未创建，原文件未覆盖')
            const result = await this.files.createFile({ workspaceId: input.workspaceId, operationId: `${input.operationId}:f:${index}`, targetDirectoryId: parent, name, bytes: file.bytes, format: 'file' })
            items.push(...result.items)
          } catch (error) { items.push({ status: 'failed', affectedPaths: [], error: { code: 'import-failed', message: `${file.name}：${error instanceof Error ? error.message : String(error)}` } }) }
        }
        return { operationId: input.operationId, status: items.every(item => item.status === 'success') ? 'success' : items.some(item => item.status === 'success') ? 'partial' : 'failed', items, affectedPaths: [...new Set(items.flatMap(item => item.affectedPaths))] } satisfies WorkspaceOperationResult
      }
      case 'mkdir': return this.files.mkdir(input)
      case 'rename': return this.relocate(input, await this.files.rename(input))
      case 'copy': return this.files.copy(input)
      case 'move': return this.relocate(input, await this.files.move(input))
      case 'trash': return this.relocate(input, await this.files.trash(input))
      case 'reveal': return this.files.reveal(input)
    }
  }) as WorkspaceFilesAPI
}

let singleton: Promise<WorkspaceFilesDesktopService> | undefined
async function service() {
  return singleton ??= import('./documentHost.js').then(({ documentHost }) => new WorkspaceFilesDesktopService(documentHost().files, async input => {
    const { executionDesktopService } = await import('./execution/ExecutionDesktopService.js')
    const execution = await executionDesktopService()
    const source = await execution.operate({ type: 'workspace', root: input.sourceRoot }) as { workspace: { workspaceId: string } }
    const target = input.targetRoot
      ? await execution.operate({ type: 'workspace', root: input.targetRoot }) as { workspace: { workspaceId: string } }
      : undefined
    await execution.conversations.relocateHomes({ workspaceId: source.workspace.workspaceId,
      changes: input.changes.map(change => ({ from: change.from, to: change.to,
        ...(change.targetWorkspaceId && target ? { targetWorkspaceId: target.workspace.workspaceId } : {}) })) })
  }))
}
export async function authorizeWorkspaceFilesRoot(directory: string) { return (await service()).authorizeRoot(directory) }
export const operateWorkspaceFiles: WorkspaceFilesAPI = async request => (await service()).operate(request)

export async function subscribeWorkspaceFilesChanges(listener: (event: WorkspaceFilesChange) => void) { return (await service()).subscribe(listener) }
