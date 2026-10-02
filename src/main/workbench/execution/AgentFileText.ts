import { matchTextPatch } from './textPatchMatch'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readUtf8File } from '../readUtf8File'
import type { DocumentHostService } from '../DocumentHostService'
import type { AgentFileContext, AgentFileOutcome } from '../../../core/tools/AgentFileTools'
import { TextDriver } from '../../../core/drivers/TextDriver'
import { isSourceDocumentModel, type DocumentSnapshot } from '../../../shared/workbench/document'
import { sourceFileKind } from '../../../shared/workbench/sourceFileKind'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'

type Page = { runId: string; filename: string; version: string; offset: number; time: number }
type Source = { source: string; version: string; dirty: boolean; snapshot?: DocumentSnapshot }
const hash = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const textDriver = new TextDriver()
const MAX_TEXT_BYTES = 256 * 1024 * 1024

/** Ordinary UTF-8 source operations. Open document writes use their existing canonical session. */
export class AgentFileText {
  private readonly pages = new Map<string, Page>()
  releaseRun(runId: string): void { for (const [id, value] of this.pages) if (value.runId === runId) this.pages.delete(id) }
  constructor(private readonly host: DocumentHostService) {}

  private live(filename: string): DocumentSnapshot | undefined {
    return this.host.registry.list().find(snapshot => snapshot.binding.kind === 'file' && samePath(snapshot.binding.path, filename))
  }

  private async source(filename: string): Promise<Source> {
    if (sourceFileKind(filename) === 'course-v9') throw new Error('H5 演示须通过正式文档工具读取，不能按普通 UTF-8 源文处理')
    const snapshot = this.live(filename)
    if (snapshot) {
      if (!isSourceDocumentModel(snapshot.model)) throw new Error('当前文档不是普通源文件')
      return { source: snapshot.model.source, version: `document:${snapshot.documentId}:${snapshot.epoch}:${snapshot.revision}`,
        dirty: snapshot.dirty, snapshot }
    }
    const current = await readUtf8File(filename, { maxCollectedBytes: MAX_TEXT_BYTES })
    return { source: current.text, version: current.version, dirty: false }
  }

  async read(context: AgentFileContext, filename: string, limit = 8_000, cursor?: string, _operationId: string = randomUUID()): Promise<AgentFileOutcome> {
    if (sourceFileKind(filename) === 'course-v9') throw new Error('H5 演示须通过正式文档工具读取')
    const opened = this.live(filename)
    if (!opened) {
      const position = cursor ? this.pages.get(cursor) : undefined
      if (cursor && (!position || position.runId !== context.runId || !samePath(position.filename, filename))) throw new Error('文件分页不属于本次读取')
      const offset = position?.offset ?? 0
      const current = await readUtf8File(filename, { from: offset, limit: limit + 1 })
      if (position && position.version !== current.version) throw new Error('文件版本已改变，请从当前版本重新读取')
      if (this.live(filename)) throw new Error('文件已在工作台打开，请重新读取当前文档')
      let length = Math.min(limit, current.text.length)
      if (/[\uD800-\uDBFF]/u.test(current.text[length - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(current.text[length] ?? '')) length--
      if (!length && current.text.length) length = Math.min(2, current.text.length)
      const end = offset + length, truncated = end < current.total
      const nextCursor = truncated ? randomUUID() : undefined
      if (nextCursor) this.pages.set(nextCursor, { runId: context.runId, filename, version: current.version, offset: end, time: Date.now() })
      return { data: { path: filename, text: current.text.slice(0, length), offset, total: current.total,
        version: current.version, dirty: false, truncated, ...(nextCursor ? { nextCursor } : {}) } }
    }
    const snapshot = await this.host.registry.get(opened.documentId).drain()
    if (!isSourceDocumentModel(snapshot.model)) throw new Error('当前文档不是普通源文件')
    const current = { source: snapshot.model.source, version: `document:${snapshot.documentId}:${snapshot.epoch}:${snapshot.revision}`, dirty: snapshot.dirty }
    let offset = 0
    if (cursor) {
      const page = this.pages.get(cursor)
      if (!page || page.runId !== context.runId || !samePath(page.filename, filename) || page.version !== current.version)
        throw new Error('文件分页已失效或版本已改变，请从首页重新读取')
      offset = page.offset
    }
    let end = Math.min(offset + limit, current.source.length)
    if (end < current.source.length && /[\uD800-\uDBFF]/u.test(current.source[end - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(current.source[end] ?? '')) end--
    if (end === offset && offset < current.source.length) end = Math.min(offset + 2, current.source.length)
    const truncated = end < current.source.length
    const data = { path: filename, text: current.source.slice(offset, end), offset, total: current.source.length,
      version: current.version, dirty: current.dirty, truncated } as Record<string, unknown>
    if (truncated) {
      const nextCursor = randomUUID()
      this.pages.set(nextCursor, { runId: context.runId, filename, version: current.version, offset: end, time: Date.now() })
      data.nextCursor = nextCursor
    }
    context.assertActive?.()
    return { data }
  }

  async searchable(filename: string): Promise<Source> { return this.source(filename) }

  async write(context: AgentFileContext, filename: string, content: string, mode: 'create' | 'replace', expectedVersion: string | undefined,
    operationId: string): Promise<AgentFileOutcome> {
    if (context.permission === 'read-only') throw new Error('只读任务不能写入文件')
    this.assertText(filename, content)
    if (mode === 'create') {
      const root = await this.host.files.registerRoot(path.dirname(filename))
      context.assertActive?.()
      const receipt = await this.host.files.createFile({ operationId, workspaceId: root.workspaceId,
        targetDirectoryId: root.rootEntryId, name: path.basename(filename), format: 'file', bytes: Buffer.from(content, 'utf8') })
      const created = receipt.items.find(item => item.status === 'success')
      return { data: { path: filename, operation: receipt, saved: !!created,
        ...(created ? { afterVersion: hash(Buffer.from(content, 'utf8')) } : {}) } }
    }
    if (expectedVersion) return this.replaceExisting(context, filename, content, expectedVersion, operationId)
    return this.host.fileCoordinator.withFileOperation(async () => {
      await this.host.assertFileAvailable(filename)
      const current = await this.source(filename)
      return this.commit(context, filename, current, content, operationId)
    })
  }

  async patch(context: AgentFileContext, filename: string, expectedVersion: string | undefined, oldText: string, newText: string,
    range: { from: number; to: number } | undefined, operationId: string): Promise<AgentFileOutcome> {
    if (context.permission === 'read-only') throw new Error('只读任务不能修改文件')
    return this.host.fileCoordinator.withFileOperation(async () => {
      await this.host.assertFileAvailable(filename)
      const current = await this.source(filename)
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error('文件版本已改变，请重新读取后修改')
      const match = matchTextPatch(current.source, oldText, newText, range)
      const { from, to, text } = match
      const next = current.source.slice(0, from) + text + current.source.slice(to)
      this.assertText(filename, next)
      return this.commit(context, filename, current, next, operationId, { from, to, newText: text })
    })
  }

  private async replaceExisting(context: AgentFileContext, filename: string, content: string, expectedVersion: string,
    operationId: string): Promise<AgentFileOutcome> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      await this.host.assertFileAvailable(filename)
      const current = await this.source(filename)
      if (current.version !== expectedVersion) throw new Error('文件版本已改变，请重新读取后覆盖')
      return this.commit(context, filename, current, content, operationId)
    })
  }

  private async commit(context: AgentFileContext, filename: string, current: Source, next: string, operationId: string,
    edit?: { from: number; to: number; newText: string }): Promise<AgentFileOutcome> {
    if (current.snapshot) {
      const snapshot = current.snapshot
      if (context.permission !== 'full' && !isInsideRoot(context.workspaceRoot, filename)) {
        if (!(context.approvedOutsidePaths ?? []).some(approved => samePath(approved, filename))) throw new Error('工作空间外文档的本次修改需要明确批准')
        context.assertActive?.()
        const result = await this.host.registry.get(snapshot.documentId).execute({ documentId: snapshot.documentId, epoch: snapshot.epoch,
          operationId, baseRevision: snapshot.revision, actor: 'agent', runId: context.runId,
          mutation: { type: 'command', command: { type: 'markdown.replace', source: next } },
          ...(edit ? { textChanges: { source: [{ from: edit.from, to: edit.to, inserted: edit.newText.length }], flow: [] } } : {}) })
        if (result.status !== 'applied' && result.status !== 'unchanged') throw new Error(result.status === 'conflict'
          ? '文档在批准后又被修改，请重新读取' : 'message' in result ? result.message : '正式文档修改未完成')
        return { data: { path: filename, operationId, status: result.status, documentResult: result,
          beforeVersion: current.version, afterVersion: `document:${snapshot.documentId}:${snapshot.epoch}:${result.revision}`, saved: false, dirty: true } }
      }
      await this.host.tools.attachRunDocument(context.runId, snapshot.documentId, true)
      const target = await this.host.tools.issueTarget(context.runId, snapshot.documentId,
        { kind: 'markdown-range', from: edit?.from ?? 0, to: edit?.to ?? current.source.length })
      context.assertActive?.()
      const receipt = await this.host.tools.execute(context.runId, operationId,
        { name: 'text.replace', input: { target, content: edit?.newText ?? next } })
      if (receipt.kind === 'error') throw new Error(receipt.message)
      if (receipt.kind !== 'document-operation') throw new Error('正式文档事务未返回修改回执')
      const result = receipt.result
      return { data: { path: filename, operationId, status: result.status, documentResult: result,
        beforeVersion: current.version, ...(result.status === 'applied' || result.status === 'unchanged'
          ? { afterVersion: `document:${snapshot.documentId}:${snapshot.epoch}:${result.revision}` } : {}),
        saved: false, dirty: true } }
    }
    if (current.source === next) return { data: { path: filename, operationId, status: 'unchanged', beforeVersion: current.version,
      afterVersion: current.version, saved: true, dirty: false } }
    const bytes = Buffer.from(next, 'utf8'), temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`)
    const originalStat = await fs.lstat(filename)
    if (!originalStat.isFile() || originalStat.isSymbolicLink()) throw new Error('目标不是普通文件')
    if (!samePath(await fs.realpath(path.dirname(filename)), path.dirname(filename)))
      throw new Error('文件夹位置已改变，请重新读取')
    const handle = await fs.open(temporary, 'wx')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally { await handle.close() }
    try {
      await fs.chmod(temporary, originalStat.mode)
      if ((await this.source(filename)).version !== current.version || this.live(filename))
        throw new Error('提交前文件或打开状态已改变，请重新读取')
      if (!samePath(await fs.realpath(path.dirname(filename)), path.dirname(filename)))
        throw new Error('提交前文件夹位置已改变，请重新读取')
      context.assertActive?.()
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
    return { data: { path: filename, operationId, status: 'written', beforeVersion: current.version,
      afterVersion: hash(bytes), saved: true, dirty: false } }
  }

  private assertText(filename: string, content: string): void {
    if (sourceFileKind(filename) === 'course-v9') throw new Error('不能把普通源文写入 H5 演示归档')
    if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new Error('完整源文编辑超过 256 MiB；原件保留，可按范围读取或使用受控计算处理')
    textDriver.validate({ kind: 'text', source: content, resources: { assets: {}, components: {} } })
  }
}
