import { isNativeProjectFilename, nativeProjectFilename, nativeProjectStem } from '../../../shared/nativeProjectFile'
import { FileBrowsePages } from './FileBrowsePages'
import { FileGrepPages } from './FileGrepPages'
import { AgentFileText } from './AgentFileText'
import { sourceFileKind } from '../../../shared/workbench/sourceFileKind'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { AgentFileContext, AgentFileMutationName, AgentFileOutcome, AgentFileService as AgentFilePort, AgentFileToolName } from '../../../core/tools/AgentFileTools'
import { AgentFileMissingParent, AgentFileOutcomeUnknown, agentFileSchemas } from '../../../core/tools/AgentFileTools'
import { officeContentSchemas, type OfficeContentToolName } from '../../../core/tools/OfficeContentTools'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import type { OfficeFormat } from '../../../shared/workbench/officeFiles'
import type { OfficeFileService } from '../office/OfficeFileService'
import { isSourceDocumentModel, type DocumentSnapshot } from '../../../shared/workbench/document'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import type { DocumentHostService } from '../DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../core/course/createCourseProjectV10'
import { createCourseProjectV10Archive } from '../../../core/drivers/codecs/courseProjectV10Archive'
import { validateWorkspaceEntryName } from '../WorkspaceFiles'

export function startDirectory(context: Pick<AgentFileContext, 'workspaceRoot' | 'conversationHomeRoot' | 'conversationHome'>): { directory: string; fallback: boolean } {
  const home = context.conversationHome
  if (!home) return { directory: context.workspaceRoot, fallback: false }
  const relative = home.kind === 'file' ? path.dirname(home.path) : home.path
  return { directory: path.resolve(context.conversationHomeRoot ?? context.workspaceRoot, relative), fallback: !!home.missing }
}

function createKind(name: string, requested?: 'markdown' | 'text' | 'html' | 'course-v10'): 'markdown' | 'text' | 'html' | 'course-v10' {
  const detected = /\.html$/i.test(name) ? 'html' : sourceFileKind(name)
  const kind = requested ?? detected
  if (kind === 'course-v9') throw new Error('此入口只创建 Project V10，旧格式原件不转换')
  if (kind !== detected && !(kind === 'text' && sourceFileKind(name) === 'text')) throw new Error(`文件名与${kind}格式不符`)
  return kind
}
function creationInput(raw: unknown) {
  const input = agentFileSchemas['file.create'].parse(raw)
  validateWorkspaceEntryName(input.name)
  const extension = input.kind === 'course-v10' ? '.glx' : input.kind === 'markdown' ? '.md' : input.kind === 'html' ? '.html' : ''
  if (input.kind === 'course-v10' || !input.kind && isNativeProjectFilename(input.name)) return { ...input, name: nativeProjectFilename(input.name) }
  return extension && path.extname(input.name) === '' ? { ...input, name: input.name + extension } : input
}
function officeFormat(filename: string): OfficeFormat {
  const format = path.extname(filename).slice(1).toLowerCase()
  if (format !== 'docx' && format !== 'xlsx' && format !== 'pptx') throw new Error('Office 内容操作只支持 .docx、.xlsx 和 .pptx 原格式文件')
  return format
}

/** Main-only file tools. Paths are rechecked at use time, including symlink resolution. */
export class AgentFileService implements AgentFilePort {
  private readonly pages = new FileBrowsePages()
  private readonly grepPages = new FileGrepPages()
  private readonly text: AgentFileText
  private office?: Promise<OfficeFileService>
  private readonly officeBindings = new Map<string, Map<string, FileArtifactBinding>>()
  /** Only the tuple from an explicit comparison is retained, never a second disk model. */
  private readonly fileObservations = new Map<string, Map<string, { documentId: string; epoch: string; baseRevision: number; bindingVersion: number; version: string | null }>>()
  constructor(private readonly host: DocumentHostService) { this.text = new AgentFileText(host) }
  releaseRun(runId: string): void { this.pages.releaseRun(runId); this.grepPages.releaseRun(runId); this.text.releaseRun(runId); this.officeBindings.delete(runId); this.fileObservations.delete(runId) }
  private officeService(): Promise<OfficeFileService> { return this.office ??= import('../office/OfficeFileService.js').then(module => new module.OfficeFileService(this.host)) }
  private officeKey(filename: string): string { return process.platform === 'win32' ? filename.toLowerCase() : filename }
  private rememberOfficeBinding(runId: string, binding: FileArtifactBinding): void {
    let bindings = this.officeBindings.get(runId)
    if (!bindings) { bindings = new Map(); this.officeBindings.set(runId, bindings) }
    bindings.set(this.officeKey(binding.path), binding)
  }
  private async mayRead(context: AgentFileContext, resolved: string): Promise<boolean> {
    if (context.permission === 'full' || isInsideRoot(context.workspaceRoot, resolved)) return true
    for (const candidate of context.readOnlyRoots ?? []) {
      const root = await fs.realpath(candidate).catch(() => null)
      if (root && isInsideRoot(root, resolved)) return true
    }
    return false
  }
  private mayWrite(context: AgentFileContext, resolved: string): boolean {
    return context.permission !== 'read-only' && (context.permission === 'full' || isInsideRoot(context.workspaceRoot, resolved)
      || (context.approvedOutsidePaths ?? []).some(approved => isInsideRoot(approved, resolved)))
  }
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
    if (!allowOutside && !await this.mayRead(context, directory)) throw new Error('当前权限不允许访问工作空间外文件夹')
    return { directory, fallback }
  }
  private async filename(context: AgentFileContext, raw: string, access: 'read' | 'write' = 'read', preflight = false, officeBinary = false): Promise<string> {
    const filename = await fs.realpath(path.resolve(context.workspaceRoot, raw))
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('目标不是可访问文件')
    if (access === 'read' ? !await this.mayRead(context, filename) : !preflight && !this.mayWrite(context, filename))
      throw new Error('当前权限不允许访问工作空间外文件')
    if (officeBinary) officeFormat(filename)
    else sourceFileKind(filename) // Binary and structured formats use their actual importers.
    return filename
  }
  async preflightCreate(context: AgentFileContext, raw: unknown): Promise<{ directory: string; outside: boolean }> {
    const input = creationInput(raw)
    if (context.permission === 'read-only') throw new Error('只读任务不能创建文件')
    validateWorkspaceEntryName(input.name)
    createKind(input.name, input.kind)
    const { directory } = await this.directory(context, input.path, true)
    return { directory, outside: !isInsideRoot(context.workspaceRoot, directory) }
  }
  async preflightMutation(context: AgentFileContext, name: AgentFileMutationName, raw: unknown): Promise<{ paths: string[]; outside: boolean }> {
    if (context.permission === 'read-only') throw new Error('只读任务不能修改文件')
    let paths: string[]
    if (name === 'file.create') {
      const input = creationInput(raw), preflight = await this.preflightCreate(context, input)
      paths = [path.join(preflight.directory, input.name)]
    } else if (name === 'file.write') {
      const input = agentFileSchemas[name].parse(raw)
      if (input.mode === 'create') {
        validateWorkspaceEntryName(path.basename(input.path))
        const wanted = path.resolve(context.workspaceRoot, input.path)
        try { paths = [path.join((await this.directory(context, path.dirname(wanted), true)).directory, path.basename(input.path))] }
        catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            throw new AgentFileMissingParent(error instanceof Error ? error.message : String(error), wanted)
          throw error
        }
      } else paths = [await this.filename(context, input.path, 'write', true)]
    } else if (name === 'file.reconcile') {
      const input = agentFileSchemas[name].parse(raw)
      paths = [await this.documentFilename(context, input.path, true)]
    } else if (name === 'file.patch') {
      const input = agentFileSchemas[name].parse(raw)
      paths = [await this.filename(context, input.path, 'write', true)]
    } else if (name === 'file.mkdir') {
      const input = agentFileSchemas[name].parse(raw)
      validateWorkspaceEntryName(input.name)
      paths = [path.join((await this.directory(context, input.path, true)).directory, input.name)]
    } else if (name === 'file.rename' || name === 'file.trash') {
      const inputs = name === 'file.rename' ? [agentFileSchemas[name].parse(raw).path] : agentFileSchemas[name].parse(raw).paths
      paths = await Promise.all(inputs.map(value => this.filenameOrDirectory(context, value, true)))
      if (name === 'file.rename') {
        const input = agentFileSchemas[name].parse(raw)
        validateWorkspaceEntryName(input.name)
        paths.push(path.join(path.dirname(paths[0]!), input.name))
      }
    } else {
      const input = agentFileSchemas[name].parse(raw)
      const sources = await Promise.all(input.sources.map(value => this.filenameOrDirectory(context, value, name === 'file.move')))
      const destination = (await this.directory(context, input.destination, true)).directory
      paths = [...sources, ...sources.map(source => path.join(destination, path.basename(source)))]
    }
    return { paths, outside: paths.some(value => !isInsideRoot(context.workspaceRoot, value)) }
  }
  private async filenameOrDirectory(context: AgentFileContext, raw: string, forWrite: boolean): Promise<string> {
    const value = await fs.realpath(path.resolve(context.workspaceRoot, raw))
    const stat = await fs.lstat(value)
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('目标不是可访问文件或文件夹')
    if (forWrite ? !this.mayWrite(context, value) && !(context.permission !== 'read-only' && !isInsideRoot(context.workspaceRoot, value))
      : !await this.mayRead(context, value)) throw new Error('当前权限不允许访问工作空间外文件')
    return value
  }
  private async requireMutationScope(context: AgentFileContext, paths: string[], copySources = 0): Promise<void> {
    if (context.permission === 'read-only') throw new Error('只读任务不能修改文件')
    for (let i = 0; i < paths.length; i++) {
      if (i < copySources && await this.mayRead(context, paths[i]!)) continue
      if (!this.mayWrite(context, paths[i]!)) throw new Error('工作空间外修改需要当前操作的明确批准')
    }
  }

  private async documentFilename(context: AgentFileContext, raw: string, forWrite = false): Promise<string> {
    try { return await this.filename(context, raw, forWrite ? 'write' : 'read', forWrite) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A deleted/moved file can still be compared through its existing formal binding.
      const wanted = path.resolve(context.workspaceRoot, raw)
      const bound = this.host.registry.list().find(snapshot => snapshot.binding.kind === 'file'
        && this.officeKey(snapshot.binding.path) === this.officeKey(wanted))
      if (!bound || !await this.mayRead(context, wanted)) throw error
      return wanted
    }
  }
  private openedFile(context: AgentFileContext, filename: string, snapshot: DocumentSnapshot): NonNullable<AgentFileOutcome['opened']> {
    return { documentId: snapshot.documentId, kind: snapshot.model.kind, name: filename, writable: this.mayWrite(context, filename) }
  }
  async observeFile(context: AgentFileContext, raw: unknown): Promise<AgentFileOutcome> {
    const input = agentFileSchemas['file.observe'].parse(raw)
    const filename = await this.documentFilename(context, input.path)
    context.assertActive?.()
    const bound = this.host.registry.list().find(snapshot => snapshot.binding.kind === 'file'
      && this.officeKey(snapshot.binding.path) === this.officeKey(filename))
    const opened = bound ?? await this.host.open(filename)
    const current = await this.host.registry.get(opened.documentId).drain()
    const disk = await this.host.observeFile(current.documentId)
    context.assertActive?.()
    let observations = this.fileObservations.get(context.runId)
    if (!observations) { observations = new Map(); this.fileObservations.set(context.runId, observations) }
    observations.set(this.officeKey(filename), { documentId: current.documentId, epoch: current.epoch,
      baseRevision: current.revision, bindingVersion: disk.bindingVersion, version: disk.version })
    const summary = (model: DocumentSnapshot['model'] | null) => !model ? null : isSourceDocumentModel(model)
      ? { kind: model.kind, source: model.source.slice(0, input.limit ?? 8000), total: model.source.length,
        truncated: model.source.length > (input.limit ?? 8000) }
      : { kind: model.kind, title: model.project.title, surfaces: model.project.surfaces.length }
    return { data: { path: filename, current: { ...summary(current.model), revision: current.revision, dirty: current.dirty },
      disk: { ...summary(disk.model), version: disk.version, exists: !!disk.model },
      changed: current.binding.kind === 'file' && current.binding.version !== disk.version,
      choices: disk.model && this.mayWrite(context, filename) ? ['disk', 'local'] : [], observation: 'current-and-disk-compared' },
      opened: this.openedFile(context, filename, current) }
  }
  async reconcileFile(context: AgentFileContext, raw: unknown): Promise<AgentFileOutcome> {
    const input = agentFileSchemas['file.reconcile'].parse(raw)
    const filename = await this.documentFilename(context, input.path, true)
    await this.requireMutationScope(context, [filename])
    const compared = this.fileObservations.get(context.runId)?.get(this.officeKey(filename))
    if (!compared) throw new Error('请先比较当前文件与磁盘版本，再选择采纳磁盘或保留当前稿')
    if (input.expectedVersion !== undefined && input.expectedVersion !== compared.version)
      throw new Error('指定磁盘版本不属于最近的比较，请重新比较')
    const current = await this.host.registry.get(compared.documentId).drain()
    if (current.binding.kind !== 'file' || this.officeKey(current.binding.path) !== this.officeKey(filename))
      throw new Error('比较的文档文件位置已改变，请重新比较')
    context.assertActive?.()
    const reconciled = await this.host.reconcileFile({ ...compared, choice: input.choice }, context.assertActive)
    this.fileObservations.get(context.runId)?.delete(this.officeKey(filename))
    return { data: { path: filename, choice: input.choice, status: 'reconciled', saved: false, dirty: reconciled.dirty,
      revision: reconciled.revision, undoDepth: reconciled.undoDepth, persistence: 'recoverable',
      diskVersion: reconciled.binding.kind === 'file' ? reconciled.binding.version : null },
      opened: this.openedFile(context, filename, reconciled) }
  }
  /** Original bytes for material import, browser upload, computation and component packages. */
  async readAuthorizedFile(context: AgentFileContext, raw: string): Promise<{ path: string; name: string; version: string; bytes: Uint8Array }> {
    context.assertActive?.()
    const filename = await this.filenameOrDirectory(context, raw, false)
    const binding = await this.host.artifacts.bind(filename)
    const bytes = await this.host.artifacts.read(binding)
    context.assertActive?.()
    return { path: binding.path, name: path.basename(binding.path), version: binding.fileVersion, bytes }
  }
  async preflightOffice(context: AgentFileContext, name: OfficeContentToolName, raw: unknown): Promise<{ paths: string[]; outside: boolean }> {
    if (name !== 'office.inspect' && context.permission === 'read-only') throw new Error('只读任务不能修改 Office 文件')
    let filename: string
    if (name === 'office.create') {
      const input = officeContentSchemas[name].parse(raw)
      validateWorkspaceEntryName(input.name)
      if (officeFormat(input.name) !== input.content.format) throw new Error('Office 文件名与内容格式不符')
      filename = path.join((await this.directory(context, input.path, true)).directory, input.name)
    } else {
      const input = officeContentSchemas[name].parse(raw)
      filename = await this.filename(context, input.path, name === 'office.inspect' ? 'read' : 'write', name !== 'office.inspect', true)
      if (name === 'office.edit' && officeFormat(filename) !== officeContentSchemas['office.edit'].parse(raw).content.format) throw new Error('Office 文件原格式与修改内容不符')
    }
    return { paths: [filename], outside: !isInsideRoot(context.workspaceRoot, filename) }
  }
  async executeOffice(context: AgentFileContext, name: OfficeContentToolName, raw: unknown, operationId: string): Promise<AgentFileOutcome> {
    if (!context.workspaceRoot || !path.isAbsolute(context.workspaceRoot)) throw new Error('任务缺少已冻结的工作空间位置')
    context.assertActive?.()
    const scope = await this.preflightOffice(context, name, raw)
    const service = await this.officeService()
    if (name === 'office.inspect') {
      const filename = scope.paths[0]!, binding = await this.host.artifacts.bind(filename)
      const inspected = await service.inspect(binding, officeFormat(filename), { assertActive: context.assertActive })
      this.rememberOfficeBinding(context.runId, binding)
      return { data: { path: filename, ...inspected, writable: this.mayWrite(context, filename) } }
    }
    await this.requireMutationScope(context, scope.paths)
    if (name === 'office.create') {
      const input = officeContentSchemas[name].parse(raw), directory = path.dirname(scope.paths[0]!)
      const root = await this.host.files.registerRoot(directory)
      const saved = await service.create({ operationId, workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId, name: input.name },
        { ...input.content, operation: 'create' }, { assertActive: context.assertActive })
      this.rememberOfficeBinding(context.runId, saved.binding)
      return { data: { ...saved, path: saved.binding.path, saved: true } }
    }
    const input = officeContentSchemas[name].parse(raw), filename = scope.paths[0]!
    const observed = this.officeBindings.get(context.runId)?.get(this.officeKey(filename))
    if (!input.expectedVersion && !observed) throw new Error('请先使用 office.inspect 读取当前 Office 内容和可编辑位置，再执行局部修改')
    const binding = input.expectedVersion ? await this.host.artifacts.bind(filename) : observed!
    const saved = await service.edit(binding, { ...input.content, operation: 'edit' }, {
      assertActive: context.assertActive, expectedVersion: input.expectedVersion,
    })
    this.rememberOfficeBinding(context.runId, saved.binding)
    return { data: { ...saved, path: saved.binding.path, saved: true } }
  }
  async execute(context: AgentFileContext, name: AgentFileToolName, raw: unknown, operationId: string): Promise<AgentFileOutcome> {
    if (!context.workspaceRoot || !path.isAbsolute(context.workspaceRoot)) throw new Error('任务缺少已冻结的工作空间位置')
    if (name === 'file.list') {
      const input = agentFileSchemas[name].parse(raw), { directory, fallback } = await this.directory(context, input.path)
      return { data: { path: directory, ...await this.pages.list(context.runId, directory, input.limit ?? 50, input.cursor), homeMissingFallback: fallback } }
    }
    if (name === 'file.search') {
      const input = agentFileSchemas[name].parse(raw), { directory, fallback } = await this.directory(context, input.path)
      return { data: { path: directory, ...await this.pages.search(context.runId, directory, input.query, input.limit ?? 50,
        async wanted => (await this.directory(context, wanted)).directory, input.cursor), homeMissingFallback: fallback } }
    }
    if (name === 'file.open') {
      const input = agentFileSchemas[name].parse(raw), filename = await this.filename(context, input.path)
      const snapshot = await this.host.open(filename)
      return { data: { path: filename, documentId: snapshot.documentId, kind: snapshot.model.kind }, opened: {
        documentId: snapshot.documentId, kind: snapshot.model.kind, name: filename,
        writable: context.permission !== 'read-only' && (context.permission === 'full' || isInsideRoot(context.workspaceRoot, filename)),
      } }
    }
    if (name === 'file.observe') return this.observeFile(context, raw)
    if (name === 'file.reconcile') return this.reconcileFile(context, raw)
    if (name === 'file.read') {
      const input = agentFileSchemas[name].parse(raw), filename = await this.filename(context, input.path)
      return this.text.read(context, filename, input.limit, input.cursor, operationId)
    }
    if (name === 'file.grep') {
      const input = agentFileSchemas[name].parse(raw)
      const wanted = input.path ? path.resolve(context.workspaceRoot, input.path) : startDirectory(context).directory
      const resolved = await fs.realpath(wanted), stat = await fs.lstat(resolved)
      if (stat.isSymbolicLink()) throw new Error('搜索目标不能是符号链接')
      if (stat.isFile()) await this.filename(context, resolved)
      else if (stat.isDirectory()) await this.directory(context, resolved)
      else throw new Error('搜索目标不是文件或目录')
      return { data: { path: resolved, query: input.query, ...await this.grepPages.search({ runId: context.runId, root: resolved,
        kind: stat.isFile() ? 'file' : 'directory', query: input.query, limit: input.limit ?? 50, cursor: input.cursor,
        verifyDirectory: async directory => (await this.directory(context, directory)).directory,
        readFile: async filename => {
          const permitted = await this.filename(context, filename)
          const file = await this.text.searchable(permitted)
          return { source: file.source, version: file.version }
        } }) } }
    }
    if (name === 'file.write') {
      const input = agentFileSchemas[name].parse(raw)
      const scope = await this.preflightMutation(context, name, input)
      await this.requireMutationScope(context, scope.paths)
      return this.text.write(context, scope.paths[0]!, input.content, input.mode,
        input.mode === 'replace' ? input.expectedVersion : undefined, operationId)
    }
    if (name === 'file.patch') {
      const input = agentFileSchemas[name].parse(raw)
      const scope = await this.preflightMutation(context, name, input)
      await this.requireMutationScope(context, scope.paths)
      return this.text.patch(context, scope.paths[0]!, input.expectedVersion, input.oldText, input.newText, input.range, operationId)
    }
    if (name === 'file.mkdir' || name === 'file.copy' || name === 'file.move' || name === 'file.rename' || name === 'file.trash') {
      const scope = await this.preflightMutation(context, name, raw)
      const sourceCount = name === 'file.copy' ? agentFileSchemas[name].parse(raw).sources.length : 0
      await this.requireMutationScope(context, scope.paths, sourceCount)
      return this.organize(context, name, raw, operationId, scope.paths)
    }
    const input = creationInput(raw)
    const kind = createKind(input.name, input.kind)
    const bytes = kind === 'course-v10' ? (() => {
      const project = createBlankCourseProjectV10(nativeProjectStem(input.name))
      return createCourseProjectV10Archive({ project, resources: { assets: {}, components: {} } })
    })() : Buffer.from('', 'utf8')
    return this.createPreparedFile(context, input, kind, bytes, operationId)
  }
  /** The actual PPTX converter supplies a complete V10 archive; file identity and publication stay here. */
  async createPreparedCourse(context: AgentFileContext, input: { path?: string; name: string; bytes: Uint8Array }, operationId: string,
    receipt?: { requestDigest: string; issues: readonly { page?: number; type: string; message: string }[] }): Promise<AgentFileOutcome> {
    if (receipt) {
      const previous = await this.lookupPreparedCourse(context.runId, operationId, receipt.requestDigest)
      if (previous) return previous
    }
    return this.createPreparedFile(context, { path: input.path, name: input.name, kind: 'course-v10' }, 'course-v10', input.bytes, operationId, receipt)
  }
  async lookupPreparedCourse(runId: string, operationId: string, requestDigest: string): Promise<AgentFileOutcome | null> {
    const receipt = await this.host.files.lookupCreation({ runId, operationId, requestDigest })
    return receipt ? { data: { ...receipt.details, status: 'saved', path: receipt.path, operation: receipt.operation,
      historical: true, currentContentVerified: false } } : null
  }
  private async createPreparedFile(context: AgentFileContext, input: { path?: string; name: string; kind?: 'markdown' | 'text' | 'html' | 'course-v10' },
    kind: 'markdown' | 'text' | 'html' | 'course-v10', bytes: Uint8Array, operationId: string,
    creation?: { requestDigest: string; issues: readonly { page?: number; type: string; message: string }[] }): Promise<AgentFileOutcome> {
    if (context.permission === 'read-only') throw new Error('只读任务不能创建文件')
    input = creationInput(input)
    const preflight = await this.preflightCreate(context, input)
    const { directory, fallback } = await this.directory(context, input.path, true)
    if (directory !== preflight.directory) throw new Error('目标文件夹已改变，请重新确认')
    if (preflight.outside && context.permission !== 'full' && context.approvedOutsideDirectory !== directory
      && !(context.approvedOutsidePaths ?? []).some(approved => isInsideRoot(approved, path.join(directory, input.name))))
      throw new Error('工作空间外新建文件需要明确批准')
    const root = await this.host.files.registerRoot(directory)
    context.assertActive?.()
    const receipt = await this.host.files.createFile({ operationId, workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId,
      name: input.name, format: kind === 'course-v10' ? 'course-v10' : kind === 'markdown' && /\.md$/i.test(input.name) ? 'markdown' : 'file', bytes,
      ...(creation ? { creationReceipt: { runId: context.runId, requestDigest: creation.requestDigest,
        details: { issues: creation.issues, homeMissingFallback: fallback } } } : {}) }, context.assertActive)
      .catch(error => { throw new AgentFileOutcomeUnknown(error instanceof Error ? error.message : String(error)) })
    const created = receipt.items.find(item => item.status === 'success' && item.targetPath)
    if (!created?.targetPath) return { data: { operation: receipt, homeMissingFallback: fallback } }
    // A cold replay carries no live entry handle and must not reopen a later version of the file.
    if (creation && !created.entryId) return (await this.lookupPreparedCourse(context.runId, operationId, creation.requestDigest))!
    const snapshot = await this.host.open(created.targetPath).catch(() => null)
    if (!snapshot) return { data: { operation: receipt, path: created.targetPath, homeMissingFallback: fallback,
      openError: '文件已创建，但暂时无法打开；请检查目录后用 file.open 重试' } }
    const course = snapshot.model.kind === 'course-v10' ? { surfaceCount: snapshot.model.project.surfaces.length,
      surfaces: snapshot.model.project.surfaces.map(surface => ({ title: surface.title, kind: surface.kind, childCount: surface.childIds.length })),
      note: '这些页面已在新建工程内；用 project.list/read 接续其实际内容，已有空白页可以命名和填入框架。教师控制台由宿主管理。' } : undefined
    return { data: { operation: receipt, path: created.targetPath, homeMissingFallback: fallback, documentId: snapshot.documentId,
      ...(course ? { course } : {}) }, opened: {
      documentId: snapshot.documentId, kind: snapshot.model.kind, name: created.targetPath,
      writable: this.mayWrite(context, created.targetPath),
    } }
  }
  private async rootFor(context: AgentFileContext, paths: string[]) {
    const workspace = await fs.realpath(context.workspaceRoot)
    if (paths.every(value => isInsideRoot(workspace, value))) return this.host.files.registerRoot(workspace)
    const drive = path.parse(paths[0]!).root
    if (!paths.every(value => path.parse(value).root.toLowerCase() === drive.toLowerCase()))
      throw new Error('当前文件整理不支持跨磁盘复制或移动；请分别选择同一磁盘的目标')
    return this.host.files.registerRoot(drive)
  }
  private async entryId(root: { workspaceId: string; rootEntryId: string; resolvedPath: string }, target: string): Promise<string> {
    const relative = path.relative(root.resolvedPath, target)
    if (relative === '') return root.rootEntryId
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件项不属于当前授权根')
    let current = root.rootEntryId
    for (const segment of relative.split(path.sep)) {
      let cursor: string | undefined, found: string | undefined
      do {
        const page = await this.host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: current, cursor, limit: 200 })
        const matching = page.entries.find(item => item.status === 'accessible' && (process.platform === 'win32'
          ? item.name.toLowerCase() === segment.toLowerCase() : item.name === segment))
        found = matching?.status === 'accessible' ? matching.entryId : undefined
        cursor = page.nextCursor
      } while (!found && cursor)
      if (!found) throw new Error(`文件项已改变或不可访问：${target}`)
      current = found
    }
    return current
  }
  private async organize(context: AgentFileContext, name: 'file.mkdir' | 'file.copy' | 'file.move' | 'file.rename' | 'file.trash',
    raw: unknown, operationId: string, scoped: string[]): Promise<AgentFileOutcome> {
    const root = await this.rootFor(context, scoped)
    if (name === 'file.mkdir') {
      const input = agentFileSchemas[name].parse(raw), target = scoped[0]!
      const parent = await this.entryId(root, path.dirname(target))
      context.assertActive?.()
      return { data: { operation: await this.host.files.mkdir({ operationId, workspaceId: root.workspaceId,
        targetDirectoryId: parent, name: input.name }) } }
    }
    if (name === 'file.rename') {
      const input = agentFileSchemas[name].parse(raw), source = await this.entryId(root, scoped[0]!)
      context.assertActive?.()
      return { data: { operation: await this.host.files.rename({ operationId, workspaceId: root.workspaceId,
        sourceEntryId: source, name: input.name }) } }
    }
    const sources = name === 'file.trash' ? scoped : scoped.slice(0, agentFileSchemas[name].parse(raw).sources.length)
    const destination = name === 'file.trash' ? undefined : await this.entryId(root, path.dirname(scoped[sources.length]!))
    const sourceVersion = name === 'file.copy'
      ? agentFileSchemas['file.copy'].parse(raw).sourceVersion ?? ((raw as { flushFirst?: unknown }).flushFirst === true ? 'current' : 'disk') : undefined
    const items: Array<{ status: 'success' | 'partial' | 'failed' | 'cancelled'; sourcePath?: string; targetPath?: string;
      affectedPaths: string[]; copied?: 'disk-version' | 'current-draft'; error?: { code: string; message: string } }> = []
    for (const [index, source] of sources.entries()) {
      try {
        const dirty = name === 'file.copy' && this.host.registry.list().some(snapshot => snapshot.binding.kind === 'file'
          && snapshot.binding.path.toLowerCase() === source.toLowerCase() && snapshot.dirty)
        const entry = await this.entryId(root, source)
        const id = `${operationId}:${index}`
        context.assertActive?.()
        const receipt = name === 'file.trash'
          ? await this.host.files.trash({ operationId: id, workspaceId: root.workspaceId, entryIds: [entry] })
          : name === 'file.copy'
            ? await this.host.files.copy({ operationId: id, workspaceId: root.workspaceId, sourceEntryIds: [entry], targetDirectoryId: destination!, sourceVersion })
            : await this.host.files.move({ operationId: id, workspaceId: root.workspaceId, sourceEntryIds: [entry], targetDirectoryId: destination! })
        items.push(...receipt.items.map(item => ({ ...item, sourcePath: item.sourcePath ?? source,
          ...(dirty && sourceVersion === 'disk' && item.status === 'success' ? { copied: 'disk-version' as const } : {}) })))
      } catch (error) {
        items.push({ status: 'failed', sourcePath: source, affectedPaths: [source],
          error: { code: 'file-operation-failed', message: error instanceof Error ? error.message : String(error) } })
      }
    }
    const status = items.every(item => item.status === 'success') ? 'success'
      : items.some(item => item.status === 'success' || item.status === 'partial') ? 'partial' : 'failed'
    const anyDiskVersion = items.some(item => item.copied === 'disk-version')
    const anyCurrentDraft = items.some(item => item.copied === 'current-draft')
    return { data: { operation: { operationId, status, items, affectedPaths: [...new Set(items.flatMap(item => item.affectedPaths))] },
      ...(name === 'file.copy' && (anyCurrentDraft || anyDiskVersion) ? { copied: anyCurrentDraft ? 'current-draft' as const : 'disk-version' as const } : {}) } }
  }
}
