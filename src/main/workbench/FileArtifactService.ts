import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileArtifactBinding, MediaArtifactBindingChanged, MediaFileDraftInput } from '../../shared/workbench/mediaFiles'
import type { DocumentHostService } from './DocumentHostService'
import { readDocumentFileVersion } from './documentJournal'
import { AgentFileOutcomeUnknown } from '../../core/tools/AgentFileTools'
import { relocatedDocumentPath } from './DocumentFileCoordinator'
import { prepareMediaFileContent } from './mediaFiles/MediaFilesService'

/** Binary formats share the existing physical file owner, without a second document writer. */
export class FileArtifactService {
  private bindings = new Map<string, FileArtifactBinding>()
  private issued = new Map<string, FileArtifactBinding>()
  private nextBindingVersion = 0
  private bindingListeners = new Set<(event: MediaArtifactBindingChanged) => void>()
  constructor(private readonly host: DocumentHostService) {
    host.fileCoordinator.subscribeRelocations(async action => {
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
  async replace(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal, beforeCommit?: () => void): Promise<FileArtifactBinding> {
    return this.host.fileCoordinator.withFileOperation(async () => {
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
    })
  }
}
