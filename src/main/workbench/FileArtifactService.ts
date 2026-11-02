import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileArtifactBinding, MediaArtifactBindingChanged, MediaFileDraftInput } from '../../shared/workbench/mediaFiles'
import type { DocumentHostService } from './DocumentHostService'
import { readDocumentFileVersion } from './documentJournal'
import { AgentFileOutcomeUnknown } from '../../core/tools/AgentFileTools'
import { relocatedDocumentPath } from './DocumentFileCoordinator'
import { prepareMediaFileContent, MediaFilesService } from './mediaFiles/MediaFilesService'
import { FileArtifactHistory, type ArtifactHistoryMetadata } from './FileArtifactHistory'
import type { OfficeHistorySnapshot } from '../../shared/workbench/officeFiles'

/** Binary formats share the existing physical file owner, without a second document writer. */
export class FileArtifactService {
  readonly media = new MediaFilesService(this)
  private bindings = new Map<string, FileArtifactBinding>()
  private issued = new Map<string, FileArtifactBinding>()
  private nextBindingVersion = 0
  private bindingListeners = new Set<(event: MediaArtifactBindingChanged) => void>()
  private readonly histories?: FileArtifactHistory
  constructor(private readonly host: DocumentHostService, historyDirectory?: string) {
    if (historyDirectory) this.histories = new FileArtifactHistory(historyDirectory)
    host.fileCoordinator.subscribeRelocations(async action => {
      await this.histories?.relocateMatching(filename => relocatedDocumentPath(action, filename))
      for (const before of [...this.bindings.values()]) {
        const destination = relocatedDocumentPath(action, before.path)
        if (!destination) continue
        const filename = await this.ordinary(destination)
        if (await readDocumentFileVersion(filename, 'text') !== before.fileVersion) throw new Error('移动后的媒体文件内容已改变；当前修改已保留')
        const binding = { ...before, path: filename, bindingVersion: ++this.nextBindingVersion }
        this.bindings.delete(this.key(before.path)); this.bindings.set(this.key(filename), binding)
        for (const [token, current] of this.issued) if (current === before) this.issued.set(token, binding)
        this.issued.set(this.token(binding), binding)
        for (const listener of this.bindingListeners) listener({ before: { ...before }, binding: { ...binding } })
      }
    })
  }
  subscribeBindings(listener: (event: MediaArtifactBindingChanged) => void): () => void {
    this.bindingListeners.add(listener)
    return () => { this.bindingListeners.delete(listener) }
  }
  private key(filename: string): string { return process.platform === 'win32' ? filename.toLowerCase() : filename }
  private token(binding: FileArtifactBinding): string { return JSON.stringify([this.key(binding.path), binding.fileVersion, binding.bindingVersion]) }
  /** Only a binding actually issued by this owner follows a formal workspace relocation. */
  resolveBinding(binding: FileArtifactBinding): FileArtifactBinding {
    const current = this.issued.get(this.token(binding))
    if (!current) throw new Error('文件绑定已失效，请重新打开；当前修改已保留')
    return { ...current }
  }
  private async ordinary(filename: string): Promise<string> {
    const resolved = await fs.realpath(filename)
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || this.key(resolved) !== this.key(path.resolve(filename))) throw new Error('文件位置已改变，请重新打开')
    await this.host.assertFileAvailable(resolved)
    return resolved
  }
  async bind(filename: string): Promise<FileArtifactBinding> {
    return this.host.fileCoordinator.withFileAccess(async () => {
      const resolved = await this.ordinary(filename)
      const fileVersion = await readDocumentFileVersion(resolved, 'text')
      if (!fileVersion) throw new Error('文件已不存在')
      const previous = this.bindings.get(this.key(resolved))
      const binding = previous?.fileVersion === fileVersion ? previous : { path: resolved, fileVersion, bindingVersion: ++this.nextBindingVersion }
      if (previous && binding !== previous) for (const [token, current] of this.issued) if (current === previous) this.issued.delete(token)
      this.bindings.set(this.key(resolved), binding)
      this.issued.set(this.token(binding), binding)
      return { ...binding }
    })
  }
  private async assertBinding(binding: FileArtifactBinding): Promise<FileArtifactBinding> {
    const current = this.bindings.get(this.key(binding.path))
    if (!current || current.fileVersion !== binding.fileVersion || current.bindingVersion !== binding.bindingVersion) throw new Error('文件绑定已失效，请重新打开；当前修改已保留')
    await this.ordinary(current.path)
    if (await readDocumentFileVersion(current.path, 'text') !== current.fileVersion) throw new Error('磁盘文件已改变，请重新载入后修改；当前修改已保留')
    return current
  }
  private async readBound(binding: FileArtifactBinding, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted(); const current = await this.assertBinding(binding)
    const bytes = await fs.readFile(current.path)
    await this.assertBinding(binding); signal?.throwIfAborted()
    return Uint8Array.from(bytes)
  }
  async read(binding: FileArtifactBinding, signal?: AbortSignal): Promise<Uint8Array> {
    return this.host.fileCoordinator.withFileAccess(() => this.readBound(binding, signal))
  }
  /** Called by WorkspaceFiles' current-copy owner while its file-operation lock is held. */
  async captureCopyContent(source: string, kind: 'file' | 'directory', drafts: readonly MediaFileDraftInput[]) {
    const captured = []
    for (const draft of drafts) {
      const binding = this.resolveBinding(draft.binding)
      const relative = path.relative(source, binding.path)
      if (kind === 'file' ? this.key(path.resolve(source)) !== this.key(binding.path)
        : relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
      const content = await prepareMediaFileContent(await this.readBound(binding), draft.operations)
      captured.push({ sourcePath: binding.path, relativePath: kind === 'file' ? '' : relative, bytes: content.bytes })
    }
    return captured
  }
  private historyOwner(binding: FileArtifactBinding): FileArtifactHistory {
    if (path.extname(binding.path).toLowerCase() !== '.pptx') throw new Error('此共同编辑历史入口仅支持 PPTX 原件')
    if (!this.histories) throw new Error('文件历史存储未配置；原件未修改')
    return this.histories
  }
  async history(binding: FileArtifactBinding, signal?: AbortSignal): Promise<OfficeHistorySnapshot> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      const current = await this.assertBinding(binding), bytes = await this.readBound(current, signal)
      return this.historyOwner(current).snapshot(current.path, bytes)
    })
  }
  private notifyChange(before: FileArtifactBinding, binding: FileArtifactBinding): void {
    for (const listener of this.bindingListeners) {
      try { listener({ before: { ...before }, binding: { ...binding } }) }
      catch { /* A closed renderer cannot change the result of an accepted file write. */ }
    }
  }
  async replace(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal, beforeCommit?: () => void, metadata?: ArtifactHistoryMetadata): Promise<FileArtifactBinding> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      if (!metadata) return this.replaceBound(binding, bytes, signal, beforeCommit)
      const current = await this.assertBinding(binding), before = await this.readBound(current, signal)
      if (before.length === bytes.length && before.every((value, index) => value === bytes[index])) return { ...current }
      const history = this.historyOwner(current)
      const prepared = await history.prepareWrite(current.path, before, bytes, metadata)
      let saved: FileArtifactBinding
      try { saved = await this.replaceBound(current, bytes, signal, beforeCommit) }
      catch (error) {
        if (!(error instanceof AgentFileOutcomeUnknown)) await history.cancelPrepared(current.path, prepared)
        throw error
      }
      // Publication and history acknowledgement are distinct facts. Renderers must be able to
      // reopen the new binding even if the following history acknowledgement is interrupted.
      this.notifyChange(current, saved)
      try { await history.confirm(saved.path, bytes) }
      catch (cause) { throw new AgentFileOutcomeUnknown(`文件已写入，但共同编辑历史结算尚未确认；请重新读取原件，不要重发修改：${cause instanceof Error ? cause.message : String(cause)}`) }
      return saved
    })
  }
  async moveHistory(binding: FileArtifactBinding, action: 'undo' | 'redo', signal?: AbortSignal, beforeCommit?: () => void): Promise<FileArtifactBinding> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      const current = await this.assertBinding(binding), bytes = await this.readBound(current, signal), history = this.historyOwner(current)
      const candidate = await history.prepareMove(current.path, bytes, action)
      let saved: FileArtifactBinding
      try { saved = await this.replaceBound(current, candidate.bytes, signal, beforeCommit) }
      catch (error) {
        if (!(error instanceof AgentFileOutcomeUnknown)) await history.cancelPrepared(current.path, candidate.token)
        throw error
      }
      this.notifyChange(current, saved)
      try { await history.confirm(saved.path, candidate.bytes) }
      catch (cause) { throw new AgentFileOutcomeUnknown(`文件撤销/重做已写入，但历史结算尚未确认；请重新读取原件：${cause instanceof Error ? cause.message : String(cause)}`) }
      return saved
    })
  }
  /** The caller holds the existing file operation lock, including History preparation/confirmation. */
  private async replaceBound(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal, beforeCommit?: () => void): Promise<FileArtifactBinding> {
      signal?.throwIfAborted(); binding = await this.assertBinding(binding)
      const directory = await fs.realpath(path.dirname(binding.path))
      const temporary = path.join(directory, `.${path.basename(binding.path)}.${randomUUID()}.tmp`)
      const stat = await fs.lstat(binding.path)
      try {
        const handle = await fs.open(temporary, 'wx')
        try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
        await fs.chmod(temporary, stat.mode)
        await this.assertBinding(binding)
        if (this.key(await fs.realpath(path.dirname(binding.path))) !== this.key(directory)) throw new Error('文件夹位置已改变，当前修改已保留')
        signal?.throwIfAborted()
        beforeCommit?.()
        await fs.rename(temporary, binding.path)
        try {
          const fileVersion = await readDocumentFileVersion(binding.path, 'text')
          if (!fileVersion) throw new Error('保存后无法读取文件')
          await this.host.files.acknowledgeDocumentSave(binding.path, 'text', fileVersion)
          const saved = { path: binding.path, fileVersion, bindingVersion: ++this.nextBindingVersion }
          const previous = this.bindings.get(this.key(binding.path))
          for (const [token, current] of this.issued) if (current === previous) this.issued.delete(token)
          this.bindings.set(this.key(binding.path), saved)
          this.issued.set(this.token(saved), saved)
          return { ...saved }
        } catch (cause) {
          throw new AgentFileOutcomeUnknown(`文件已写入，但保存回执未确认；请重新读取原件后继续：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
}
