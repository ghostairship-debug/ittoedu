import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileArtifactBinding } from '../../shared/workbench/mediaFiles'
import type { DocumentHostService } from './DocumentHostService'
import { readDocumentFileVersion } from './documentJournal'
import { AgentFileOutcomeUnknown } from '../../core/tools/AgentFileTools'

/** Binary formats share the existing physical file owner, without a second document writer. */
export class FileArtifactService {
  private bindings = new Map<string, FileArtifactBinding>()
  constructor(private readonly host: DocumentHostService) {}
  private key(filename: string): string { return process.platform === 'win32' ? filename.toLowerCase() : filename }
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
      const binding = previous?.fileVersion === fileVersion ? previous : { path: resolved, fileVersion, bindingVersion: (previous?.bindingVersion ?? 0) + 1 }
      this.bindings.set(this.key(resolved), binding)
      return { ...binding }
    })
  }
  private async assertBinding(binding: FileArtifactBinding): Promise<void> {
    const known = this.bindings.get(this.key(binding.path))
    if (!known || known.bindingVersion !== binding.bindingVersion || known.fileVersion !== binding.fileVersion) throw new Error('文件绑定已失效，请重新打开；当前修改已保留')
    await this.ordinary(binding.path)
    if (await readDocumentFileVersion(binding.path, 'text') !== binding.fileVersion) throw new Error('磁盘文件已改变，请重新载入后修改；当前修改已保留')
  }
  async read(binding: FileArtifactBinding, signal?: AbortSignal): Promise<Uint8Array> {
    return this.host.fileCoordinator.withFileAccess(async () => {
      signal?.throwIfAborted(); await this.assertBinding(binding)
      const bytes = await fs.readFile(binding.path)
      await this.assertBinding(binding); signal?.throwIfAborted()
      return Uint8Array.from(bytes)
    })
  }
  async replace(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal, beforeCommit?: () => void): Promise<FileArtifactBinding> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      signal?.throwIfAborted(); await this.assertBinding(binding)
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
          const saved = { path: binding.path, fileVersion, bindingVersion: binding.bindingVersion + 1 }
          this.bindings.set(this.key(binding.path), saved)
          return { ...saved }
        } catch (cause) {
          throw new AgentFileOutcomeUnknown(`文件已写入，但保存回执未确认；请重新读取原件后继续：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
    })
  }
}
