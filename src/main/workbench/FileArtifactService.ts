import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileArtifactBinding, MediaArtifactBindingChanged, MediaFileDraftInput } from '../../shared/workbench/mediaFiles'
import type { DocumentHostService } from './DocumentHostService'
import { readDocumentFileVersion } from './documentJournal'
import { AgentFileOutcomeUnknown } from '../../core/tools/AgentFileTools'
import { relocatedDocumentPath } from './DocumentFileCoordinator'
import { prepareMediaFileContent, MediaFilesService } from './mediaFiles/MediaFilesService'
import { FileArtifactHistory, type ArtifactHistoryMetadata, type ArtifactHistorySnapshot, type OfficeDraftRecovery } from './FileArtifactHistory'
import { findOfficeDraft, officeDrafts, relocateOfficeDraft } from './office/OfficeDrafts'
import { publishNewFile } from './publishNewFile'
import { DocumentSaveFailure } from '../../shared/workbench/documentSave'

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
    host.fileCoordinator.subscribeRelocationChecks?.(async action => {
      const source = action.sources[0], target = action.target?.resolvedPath
      if (!source || !target || this.key(path.resolve(source.resolvedPath)) === this.key(path.resolve(target))) return
      if (source.kind === 'directory' || ['.pptx', '.docx', '.xlsx'].includes(path.extname(target).toLowerCase()))
        await this.histories?.assertNoOfficeDraftAt(target, source.kind === 'directory')
    })
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
        const draft = relocateOfficeDraft(this, before, binding)
        this.notifyChange(draft?.before ?? before, draft?.binding ?? binding)
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
    return this.host.fileCoordinator.withFileAccess(() => this.bindCurrent(filename))
  }
  private async bindCurrent(filename: string): Promise<FileArtifactBinding> {
    const resolved = await this.ordinary(filename)
    const fileVersion = await readDocumentFileVersion(resolved, 'text')
    if (!fileVersion) throw new Error('文件已不存在')
    const previous = this.bindings.get(this.key(resolved))
    const binding = previous?.fileVersion === fileVersion ? previous : { path: resolved, fileVersion, bindingVersion: ++this.nextBindingVersion }
    if (previous && binding !== previous) for (const [token, current] of this.issued) if (current === previous) this.issued.delete(token)
    this.bindings.set(this.key(resolved), binding)
    this.issued.set(this.token(binding), binding)
    return { ...binding }
  }
  /** Publish an explicit native-dialog copy, leaving the source binding alone. */
  async saveCopy(source: FileArtifactBinding, target: string, bytes: Uint8Array, overwrite?: FileArtifactBinding): Promise<FileArtifactBinding> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      await this.assertBinding(source)
      if (this.key(source.path) === this.key(target) || findOfficeDraft(this, target)) throw new Error('请选择不同的、未打开的目标文件。')
      await this.host.assertFileAvailable(target)
      const directory = path.dirname(target)
      if (this.key(await fs.realpath(directory)) !== this.key(directory)) throw new Error('目标文件夹位置已改变，请重新选择。')
      if (overwrite) {
        if (this.key(overwrite.path) !== this.key(target)) throw new Error('实际目标与覆盖确认不一致。')
        return this.replaceBound(overwrite, bytes)
      }
      const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`)
      let preserveCandidate = false
      try {
        const handle = await fs.open(temporary, 'wx')
        try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
        if (this.key(await fs.realpath(directory)) !== this.key(directory)) throw new Error('目标文件夹位置已改变，请重新选择。')
        await publishNewFile(temporary, target)
        try { return await this.bindCurrent(target) }
        catch (cause) { throw new AgentFileOutcomeUnknown(`另存文件已写入，但重新读取未完成：${cause instanceof Error ? cause.message : String(cause)}`) }
      } catch (cause) {
        if (cause instanceof DocumentSaveFailure && cause.publication === 'unknown') {
          preserveCandidate = true
          throw new AgentFileOutcomeUnknown(`另存结果待确认，请检查目标文件后继续：${target}`)
        }
        throw cause
      } finally {
        if (!preserveCandidate) await fs.unlink(temporary).catch(() => {})
      }
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
    if (!['.pptx', '.docx', '.xlsx'].includes(path.extname(binding.path).toLowerCase())) throw new Error('此共同编辑历史入口支持 PPTX、DOCX、XLSX 原件')
    if (!this.histories) throw new Error('文件历史存储未配置；原件未修改')
    return this.histories
  }
  async history(binding: FileArtifactBinding, signal?: AbortSignal, offset = 0): Promise<ArtifactHistorySnapshot> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      const current = await this.assertBinding(binding), bytes = await this.readBound(current, signal)
      return this.historyOwner(current).snapshot(current.path, bytes, offset)
    })
  }
  async readHistoryAtOffset(binding: FileArtifactBinding, offset: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      const bytes = await this.readBound(binding, signal)
      return this.historyOwner(binding).readAtOffset(binding.path, bytes, offset)
    })
  }
  private notifyChange(before: FileArtifactBinding, binding: FileArtifactBinding, officeDraftSave = false): void {
    for (const listener of this.bindingListeners) {
      try { listener({ before: { ...before }, binding: { ...binding }, ...(officeDraftSave ? { officeDraftSave } : {}) }) }
      catch { /* A closed renderer cannot change the result of an accepted file write. */ }
    }
  }
  notifyOfficeDraft(before: FileArtifactBinding, binding: FileArtifactBinding): void {
    this.notifyChange(before, binding)
  }
  nextOfficeDraftVersion(): number { return ++this.nextBindingVersion }
  async preserveOfficeDrafts(): Promise<void> {
    for (const draft of officeDrafts(this).values()) {
      if (!draft.dirty || !draft.original || !draft.bytes) continue
      const binding = draft.binding
      const previousRecovery = draft.recoveryBinding
      await this.historyOwner(draft.base).persistOfficeDraft(draft.base.path, {
        baseVersion: draft.baseVersion, original: draft.original, bytes: draft.bytes,
        offset: draft.offset, branchOffset: draft.branchOffset, past: draft.past, future: draft.future,
      })
      draft.recoveryBinding = draft.base
      draft.recoveryVersion = binding.fileVersion
      if (previousRecovery && this.key(previousRecovery.path) !== this.key(draft.base.path)) await this.removeOfficeDraft(previousRecovery)
      if (draft.binding !== binding) throw new Error('保留期间 Office 草稿有新修改，请重试关闭。')
    }
  }
  async readOfficeDraft(binding: FileArtifactBinding): Promise<OfficeDraftRecovery | undefined> {
    return this.historyOwner(binding).readOfficeDraft(binding.path)
  }
  async removeOfficeDraft(binding: FileArtifactBinding): Promise<void> {
    await this.historyOwner(binding).removeOfficeDraft(binding.path)
  }
  async releaseOfficeDrafts(discard: boolean, preserved: boolean): Promise<void> {
    const drafts = officeDrafts(this)
    for (const draft of drafts.values()) {
      if (draft.recoveryBinding && (discard || !draft.dirty)) await this.removeOfficeDraft(draft.recoveryBinding)
    }
    if ([...drafts.values()].some(draft => draft.saving || !discard && draft.dirty
      && (!preserved || draft.recoveryVersion !== draft.binding.fileVersion)))
      throw new Error('关闭期间仍有 Office 修改未确认，请重试关闭。')
    drafts.clear()
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
      this.notifyChange(current, saved, Boolean(metadata.sequence))
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
