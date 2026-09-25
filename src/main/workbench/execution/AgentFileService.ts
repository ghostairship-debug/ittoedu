import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { AgentFileContext, AgentFileOutcome, AgentFileService as AgentFilePort, AgentFileToolName } from '../../../core/tools/AgentFileTools'
import { AgentFileOutcomeUnknown, agentFileSchemas } from '../../../core/tools/AgentFileTools'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import type { DocumentHostService } from '../DocumentHostService'
import { createBlankCourseProject } from '../../../core/course/createCourseProject'
import { createDefaultTeacherControllerPackage } from '../../../shared/defaultTeacherControllerComponent'
import { createCourseProjectArchive } from '../../../core/drivers/codecs/courseProjectArchive'
import { validateWorkspaceEntryName } from '../WorkspaceFiles'

const supported = /\.(?:md|markdown|h5lesson)$/i
function startDirectory(context: AgentFileContext): { directory: string; fallback: boolean } {
  const home = context.conversationHome
  if (!home) return { directory: context.workspaceRoot, fallback: false }
  const relative = home.kind === 'file' ? path.dirname(home.path) : home.path
  return { directory: path.resolve(context.conversationHomeRoot ?? context.workspaceRoot, relative), fallback: !!home.missing }
}

/** Main-only file tools. Paths are rechecked at use time, including symlink resolution. */
export class AgentFileService implements AgentFilePort {
  constructor(private readonly host: DocumentHostService) {}
  private async directory(context: AgentFileContext, raw?: string, allowOutside = false): Promise<{ directory: string; fallback: boolean }> {
    const preferred = startDirectory(context)
    const wanted = raw ? path.resolve(context.workspaceRoot, raw) : preferred.directory
    let directory: string, fallback = false
    try { directory = await fs.realpath(wanted) }
    catch (error) {
      if (raw || wanted === context.workspaceRoot || !error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
      directory = await fs.realpath(context.workspaceRoot); fallback = true
    }
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目标不是可访问文件夹')
    if (!allowOutside && context.permission !== 'full' && !isInsideRoot(context.workspaceRoot, directory)) throw new Error('当前权限不允许访问工作空间外文件夹')
    return { directory, fallback }
  }
  private async filename(context: AgentFileContext, raw: string): Promise<string> {
    const filename = await fs.realpath(path.resolve(context.workspaceRoot, raw))
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('目标不是可访问文件')
    if (context.permission !== 'full' && !isInsideRoot(context.workspaceRoot, filename)) throw new Error('当前权限不允许访问工作空间外文件')
    if (!supported.test(filename)) throw new Error('当前只支持打开 Markdown 和 V9 课件')
    return filename
  }
  async preflightCreate(context: AgentFileContext, raw: unknown): Promise<{ directory: string; outside: boolean }> {
    const input = agentFileSchemas['file.create'].parse(raw)
    if (context.permission === 'read-only') throw new Error('只读任务不能创建文件')
    validateWorkspaceEntryName(input.name)
    if (path.extname(input.name).toLowerCase() !== (input.kind === 'markdown' ? '.md' : '.h5lesson')) throw new Error(`文件名与${input.kind}格式不符`)
    const { directory } = await this.directory(context, input.path, true)
    return { directory, outside: !isInsideRoot(context.workspaceRoot, directory) }
  }
  async execute(context: AgentFileContext, name: AgentFileToolName, raw: unknown, operationId: string): Promise<AgentFileOutcome> {
    if (!context.workspaceRoot || !path.isAbsolute(context.workspaceRoot)) throw new Error('任务缺少已冻结的工作空间位置')
    if (name === 'file.list') {
      const input = agentFileSchemas[name].parse(raw), { directory, fallback } = await this.directory(context, input.path)
      const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      const limit = input.limit ?? 50
      return { data: { path: directory, entries: entries.slice(0, limit).map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'unsupported' })), truncated: entries.length > limit, homeMissingFallback: fallback } }
    }
    if (name === 'file.search') {
      const input = agentFileSchemas[name].parse(raw), { directory, fallback } = await this.directory(context, input.path)
      const found: string[] = [], pending = [directory], limit = input.limit ?? 50
      let visited = 0
      while (pending.length && found.length < limit && visited < 2000) {
        const current = pending.shift()!
        for (const entry of await fs.readdir(current, { withFileTypes: true })) {
          if (++visited > 2000) break
          const candidate = path.join(current, entry.name)
          if (entry.name.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) found.push(candidate)
          if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(candidate)
          if (found.length >= limit) break
        }
      }
      return { data: { path: directory, matches: found, truncated: pending.length > 0 || visited >= 2000, homeMissingFallback: fallback } }
    }
    if (name === 'file.open') {
      const input = agentFileSchemas[name].parse(raw), filename = await this.filename(context, input.path)
      const snapshot = await this.host.open(filename)
      return { data: { path: filename, documentId: snapshot.documentId, kind: snapshot.model.kind }, opened: {
        documentId: snapshot.documentId, kind: snapshot.model.kind, name: filename, writable: context.permission !== 'read-only',
      } }
    }
    const input = agentFileSchemas['file.create'].parse(raw)
    if (context.permission === 'read-only') throw new Error('只读任务不能创建文件')
    const preflight = await this.preflightCreate(context, input)
    const { directory, fallback } = await this.directory(context, input.path, true)
    if (directory !== preflight.directory) throw new Error('目标文件夹已改变，请重新确认')
    if (preflight.outside && context.permission !== 'full' && context.approvedOutsideDirectory !== directory) throw new Error('工作空间外新建文件需要明确批准')
    const root = await this.host.files.registerRoot(directory)
    const bytes = input.kind === 'markdown' ? Buffer.from('', 'utf8') : (() => {
      const project = createBlankCourseProject({ title: input.name.replace(/\.h5lesson$/i, '') })
      const component = createDefaultTeacherControllerPackage()
      return createCourseProjectArchive({ project, assetFiles: {}, componentFiles: { [`${component.manifest.id}@${component.manifest.version}`]: component.files } })
    })()
    const receipt = await this.host.files.createFile({ operationId, workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId,
      name: input.name, format: input.kind, bytes }).catch(error => { throw new AgentFileOutcomeUnknown(error instanceof Error ? error.message : String(error)) })
    const created = receipt.items.find(item => item.status === 'success' && item.targetPath)
    if (!created?.targetPath) return { data: { operation: receipt, homeMissingFallback: fallback } }
    const snapshot = await this.host.open(created.targetPath).catch(() => null)
    if (!snapshot) return { data: { operation: receipt, path: created.targetPath, homeMissingFallback: fallback,
      openError: '文件已创建，但暂时无法打开；请检查目录后用 file.open 重试' } }
    return { data: { operation: receipt, path: created.targetPath, homeMissingFallback: fallback, documentId: snapshot.documentId }, opened: {
      documentId: snapshot.documentId, kind: snapshot.model.kind, name: created.targetPath, writable: true,
    } }
  }
}
