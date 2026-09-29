import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
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
const MAX_TEXT_BYTES = 16 * 1024 * 1024

/** Ordinary UTF-8 source operations. Open documents always go through their existing session and Gateway. */
export class AgentFileText {
  private readonly pages = new Map<string, Page>()
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
    const [actual, stat] = await Promise.all([fs.realpath(filename), fs.lstat(filename)])
    if (!samePath(actual, filename) || !stat.isFile() || stat.isSymbolicLink())
      throw new Error('文件位置或类型已改变，请重新定位并读取')
    const bytes = await fs.readFile(filename)
    if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error('普通源文件超过 16 MiB；请按范围使用材料或受控计算工具')
    const model = textDriver.load(bytes)
    if (model.kind !== 'text') throw new Error('文件不是普通文本')
    const version = hash(bytes)
    if (hash(await fs.readFile(filename)) !== version) throw new Error('读取期间文件已改变，请重新读取')
    return { source: model.source, version, dirty: false }
  }

  async read(context: AgentFileContext, filename: string, limit = 8_000, cursor?: string, operationId: string = randomUUID()): Promise<AgentFileOutcome> {
    const current = await this.source(filename)
    let offset = 0
    if (cursor) {
      const page = this.pages.get(cursor)
      if (!page || page.runId !== context.runId || !samePath(page.filename, filename) || page.version !== current.version || Date.now() - page.time > 900_000)
        throw new Error('文件分页已失效或版本已改变，请从首页重新读取')
      offset = page.offset
    }
    let end = Math.min(offset + limit, current.source.length)
    if (end < current.source.length && /[\uD800-\uDBFF]/u.test(current.source[end - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(current.source[end] ?? '')) end--
    if (end === offset && offset < current.source.length) end = Math.min(offset + 2, current.source.length)
    if (current.snapshot) {
      try {
        await this.host.tools.attachRunDocument(context.runId, current.snapshot.documentId,
          context.permission !== 'read-only' && (context.permission === 'full' || isInsideRoot(context.workspaceRoot, filename)))
        const target = await this.host.tools.issueTarget(context.runId, current.snapshot.documentId,
          { kind: 'markdown-range', from: offset, to: end }, { readOnly: true })
        const receipt = await this.host.tools.execute(context.runId, `${operationId}:source-observation:${randomUUID()}`,
          { name: 'read', input: { target, limit: Math.max(1, Math.ceil((end - offset) / 100)) } })
        if (receipt.kind !== 'read' || (receipt.data as { text?: unknown }).text !== current.source.slice(offset, end))
          throw new Error('正式文档观察与文件读取不一致，请重新读取')
        if ((await this.source(filename)).version !== current.version) throw new Error('读取期间文档已改变，请重新读取')
      } catch (error) {
        // Direct service fixtures can read without an Engine run. A stopped or stale real run is never ignored.
        if (!(error instanceof Error && 'code' in error && error.code === 'unknown-run')) throw error
      }
    }
    const truncated = end < current.source.length
    const data = { path: filename, text: current.source.slice(offset, end), offset, total: current.source.length,
      version: current.version, dirty: current.dirty, truncated } as Record<string, unknown>
    if (truncated) {
      const nextCursor = randomUUID()
      while (this.pages.size >= 128) this.pages.delete(this.pages.keys().next().value!)
      this.pages.set(nextCursor, { runId: context.runId, filename, version: current.version, offset: end, time: Date.now() })
      data.nextCursor = nextCursor
    }
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
    if (!expectedVersion) throw new Error('覆盖文件必须提供读取时取得的版本')
    return this.replaceExisting(context, filename, content, expectedVersion, operationId)
  }

  async patch(context: AgentFileContext, filename: string, expectedVersion: string, oldText: string, newText: string,
    range: { from: number; to: number } | undefined, operationId: string): Promise<AgentFileOutcome> {
    if (context.permission === 'read-only') throw new Error('只读任务不能修改文件')
    return this.host.fileCoordinator.withFileOperation(async () => {
      const current = await this.source(filename)
      if (current.version !== expectedVersion) throw new Error('文件版本已改变，请重新读取后修改')
      let from: number, to: number
      if (range) {
        ({ from, to } = range)
        if (to < from || current.source.slice(from, to) !== oldText) throw new Error('补丁范围或原文已改变，请重新读取')
      } else {
        from = current.source.indexOf(oldText)
        if (from < 0) throw new Error('补丁原文不存在，请重新读取')
        if (current.source.indexOf(oldText, from + 1) >= 0) throw new Error('补丁原文匹配多处，请提供精确 range')
        to = from + oldText.length
      }
      const next = current.source.slice(0, from) + newText + current.source.slice(to)
      this.assertText(filename, next)
      return this.commit(context, filename, current, next, operationId, { from, to, newText })
    })
  }

  private async replaceExisting(context: AgentFileContext, filename: string, content: string, expectedVersion: string,
    operationId: string): Promise<AgentFileOutcome> {
    return this.host.fileCoordinator.withFileOperation(async () => {
      const current = await this.source(filename)
      if (current.version !== expectedVersion) throw new Error('文件版本已改变，请重新读取后覆盖')
      return this.commit(context, filename, current, content, operationId)
    })
  }

  private async commit(context: AgentFileContext, filename: string, current: Source, next: string, operationId: string,
    edit?: { from: number; to: number; newText: string }): Promise<AgentFileOutcome> {
    if (current.snapshot) {
      const snapshot = current.snapshot
      if (context.permission !== 'full' && !isInsideRoot(context.workspaceRoot, filename))
        throw new Error('已打开的工作空间外文档需取得正式文档写授权，单次文件批准不会扩大后续文档权限')
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
    textDriver.validate({ kind: 'text', source: content, resources: { assets: {}, components: {} } })
  }
}
