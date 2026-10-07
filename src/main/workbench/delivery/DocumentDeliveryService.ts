import { DocumentSaveFailure, type DocumentSaveIdentity } from '../../../shared/workbench/documentSave'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { documentDigest } from '../../../core/documents/documentDigest'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { exportSuggestedName, validateExportBuildFiles, validateExportBuildIdentity, validateExportDestination } from '../../../shared/workbench/documentDelivery'
import type { DocumentDeliveryServicePort, ExportBuildReply, ExportBuildRequest, ExportFormat, ExportReceipt, SaveReceipt } from '../../../shared/workbench/toolPorts'
import { DocumentDeliveryOperationStore, type DeliveryOperationRecord } from './DocumentDeliveryOperationStore'

export interface DocumentDeliveryServiceOptions {
  documents: {
    read(documentId: string): Promise<DocumentSnapshot>
    prepareDrafts?(documentId: string, epoch: string): Promise<void>
    saveWithFact(documentId: string, filename?: string, identity?: DocumentSaveIdentity): Promise<{ snapshot: DocumentSnapshot; savedRevision: number }>
    lookupSave?(documentId: string, identity: DocumentSaveIdentity): Promise<SaveReceipt | null>
    withFileLease<T>(documentId: string, work: (read: () => DocumentSnapshot) => Promise<T>): Promise<T>
  }
  operations: DocumentDeliveryOperationStore
  /** Main enforces the frozen access profile here, including ask approval. */
  authorize(input: { runId: string; documentId: string; operation: 'save' | 'export' }): Promise<void>
  /** Main applies workspace/conversation-home naming and path authorization. */
  resolveSaveDestination(input: { runId: string; snapshot: DocumentSnapshot; requested?: string }): Promise<string | undefined>
  /** null leaves a generated artifact in the receipt without claiming disk delivery. */
  resolveExportDestination(input: { runId: string; snapshot: DocumentSnapshot; requested?: string; format: ExportFormat; suggestedName: string }): Promise<string | null>
  build: { build(request: ExportBuildRequest, signal?: AbortSignal): Promise<ExportBuildReply> }
  writer: {
    /** Must reject an existing destination and atomically publish complete bytes. */
    writeNew(filename: string, bytes: Uint8Array, signal?: AbortSignal, prepared?: (identity: string | null) => Promise<void>): Promise<{ fileVersion: string }>
    inspect(filename: string): Promise<{ fileVersion: string; sha256: string; publicationIdentity?: string | null } | null>
    replaceExisting?(filename: string, bytes: Uint8Array, expectedVersion: string, signal?: AbortSignal, prepared?: (identity: string | null) => Promise<void>): Promise<{ fileVersion: string }>
  }
  withFileOperation?<T>(work: () => Promise<T>): Promise<T>
  assertExportTarget?(filename: string): Promise<void>
  signalForRun?(runId: string): AbortSignal | undefined
  renderPdf?(html: string, signal?: AbortSignal): Promise<Uint8Array>
  taskRunIds?(runId: string): Promise<readonly string[]>
}

export class DocumentDeliveryOutcomeUnknown extends Error {
  readonly code = 'tool-outcome-unknown'
  constructor(cause?: unknown) { super('保存或导出落盘结果尚未确定；请查询原操作，不要重做覆盖', { cause }) }
}

function failedSave(input: { documentId: string; epoch: string; revision: number }, reason: string, dirty: boolean): SaveReceipt {
  return { status: 'rejected', documentId: input.documentId, epoch: input.epoch, currentRevision: input.revision, dirty, warnings: [], reason }
}

function failedExport(input: { documentId: string; epoch: string; revision: number; format: ExportFormat }, reason: string, status: 'rejected' | 'failed' = 'rejected'): ExportReceipt {
  return { status, documentId: input.documentId, epoch: input.epoch, format: input.format, currentRevision: input.revision, warnings: [], reason }
}

export class DocumentDeliveryService implements DocumentDeliveryServicePort {
  constructor(private readonly options: DocumentDeliveryServiceOptions) {}

  private async started(record: DeliveryOperationRecord): Promise<void> {
    const result = await this.options.operations.start(record)
    if (!result.created) throw new DocumentDeliveryOutcomeUnknown()
  }

  async lookup(input: { runId: string; operationId: string; requestDigest: string }): Promise<SaveReceipt | ExportReceipt | null> {
    const record = await this.options.operations.lookup(input.runId, input.operationId)
    if (!record) return null
    if (record.requestDigest !== input.requestDigest) throw new Error('同一保存/导出操作编号不能改变请求')
    if (record.kind === 'export' && record.status === 'writing' && (record.receipt as ExportReceipt | undefined)?.files?.length) {
      const prior = record.receipt as ExportReceipt
      const files = await Promise.all(prior.files!.map(async (file, index) => {
        if (file.path) return file
        const child = await this.options.operations.lookup(input.runId, `${input.operationId}/file/${index}`)
        if (!child) return file // This destination was never attempted; query does not write it.
        if (child.status === 'started' || child.status === 'generated' && !child.receipt) return file
        const receipt = await this.lookup({ ...input, operationId: `${input.operationId}/file/${index}` }) as ExportReceipt | null
        return receipt?.status === 'written' ? { ...file, path: receipt.path, fileVersion: receipt.fileVersion ?? undefined } : file
      }))
      const complete = files.every(file => !!file.path)
      const receipt: ExportReceipt = { ...prior, status: complete ? 'written' : 'generated', files,
        warnings: complete ? prior.warnings : [...prior.warnings, '导出在部分文件写盘后中断；回执列出已写文件，其余文件未重放，请按需要另行导出。'] }
      await this.options.operations.patch(input.runId, input.operationId, { status: complete ? 'completed' : 'generated', receipt })
      return receipt
    }
    if (record.kind === 'save' && record.status !== 'completed' && record.status !== 'failed'
      && record.documentId && this.options.documents.lookupSave) {
      const receipt = await this.options.documents.lookupSave(record.documentId, { runId: input.runId, operationId: input.operationId, requestDigest: input.requestDigest })
      if (receipt) {
        await this.options.operations.patch(input.runId, input.operationId, { status: 'completed', receipt, path: receipt.path, fileVersion: receipt.fileVersion })
        return receipt
      }
    }
    if (record.kind === 'export' && record.status === 'writing' && record.path && record.contentSha256 && record.receipt) {
      const observed = await this.options.writer.inspect(record.path)
      if (!observed || !record.publicationIdentity || observed.publicationIdentity !== record.publicationIdentity
        || observed.sha256 !== record.contentSha256) throw new DocumentDeliveryOutcomeUnknown()
      const receipt: ExportReceipt = { ...(record.receipt as ExportReceipt), status: 'written', path: record.path, fileVersion: observed.fileVersion }
      await this.options.operations.patch(input.runId, input.operationId, { status: 'completed', receipt, fileVersion: observed.fileVersion })
      return receipt
    }
    if (record.status === 'completed' || record.status === 'failed' || record.status === 'generated') return record.receipt ?? null
    throw new DocumentDeliveryOutcomeUnknown()
  }

  async save(input: { runId: string; operationId: string; requestDigest: string; documentId: string; epoch: string; baseRevision: number; destination?: string }): Promise<SaveReceipt> {
    const known = await this.options.operations.lookup(input.runId, input.operationId)
    if (known) return (await this.lookup(input)) as SaveReceipt
    await this.started({ runId: input.runId, operationId: input.operationId, requestDigest: input.requestDigest, kind: 'save', status: 'started' })
    await this.options.operations.patch(input.runId, input.operationId, { documentId: input.documentId })
    let before: DocumentSnapshot | undefined
    try {
      before = await this.options.documents.read(input.documentId)
      if (before.epoch !== input.epoch || before.revision !== input.baseRevision)
        throw new Error('文档版本已变化，请重新读取后再保存')
      this.options.signalForRun?.(input.runId)?.throwIfAborted()
      await this.options.authorize({ runId: input.runId, documentId: input.documentId, operation: 'save' })
      const filename = await this.options.resolveSaveDestination({ runId: input.runId, snapshot: before, requested: input.destination })
      if (!filename && before.binding.kind !== 'file') throw new Error('未命名文档尚无可保存位置')
      this.options.signalForRun?.(input.runId)?.throwIfAborted()
      const justBefore = await this.options.documents.read(input.documentId)
      if (justBefore.epoch !== before.epoch || justBefore.revision !== before.revision
        || documentDigest(justBefore.binding) !== documentDigest(before.binding)) throw new Error('保存准备期间文档或文件绑定已变化')
      const { snapshot, savedRevision } = await this.options.documents.saveWithFact(input.documentId, filename,
        { runId: input.runId, operationId: input.operationId, requestDigest: input.requestDigest }).catch(error => {
          throw error instanceof DocumentSaveFailure ? error : new DocumentDeliveryOutcomeUnknown(error)
        })
      if (snapshot.binding.kind !== 'file') throw new DocumentDeliveryOutcomeUnknown()
      const receipt: SaveReceipt = { status: 'saved', path: snapshot.binding.path, documentId: snapshot.documentId, epoch: snapshot.epoch,
        savedRevision, currentRevision: snapshot.revision, fileVersion: snapshot.binding.version, dirty: snapshot.dirty,
        warnings: snapshot.dirty ? ['保存期间又有新修改；当前文档仍未全部保存'] : [] }
      try { await this.options.operations.patch(input.runId, input.operationId, { status: 'completed', receipt, path: receipt.path, fileVersion: receipt.fileVersion }) }
      catch (error) { throw new DocumentDeliveryOutcomeUnknown(error) }
      return receipt
    } catch (error) {
      if (error instanceof DocumentDeliveryOutcomeUnknown || error instanceof DocumentSaveFailure && error.publication === 'unknown')
        throw error instanceof DocumentDeliveryOutcomeUnknown ? error : new DocumentDeliveryOutcomeUnknown(error)
      const receipt = failedSave({ documentId: input.documentId, epoch: input.epoch, revision: input.baseRevision },
        error instanceof Error ? error.message : String(error), before?.dirty ?? true)
      await this.options.operations.patch(input.runId, input.operationId, { status: 'failed', receipt })
      return receipt
    }
  }

  async export(input: { runId: string; operationId: string; requestDigest: string; documentId: string; epoch: string; revision: number; format: ExportFormat; destination?: string }): Promise<ExportReceipt> {
    const known = await this.options.operations.lookup(input.runId, input.operationId)
    if (known) return (await this.lookup(input)) as ExportReceipt
    await this.started({ runId: input.runId, operationId: input.operationId, requestDigest: input.requestDigest, kind: 'export', status: 'started' })
    let writing = false, generated: ExportReceipt | undefined
    try {
      const signal = this.options.signalForRun?.(input.runId)
      signal?.throwIfAborted()
      await this.options.authorize({ runId: input.runId, documentId: input.documentId, operation: 'export' })
      await this.options.documents.prepareDrafts?.(input.documentId, input.epoch)
      signal?.throwIfAborted()
      const snapshot = await this.options.documents.read(input.documentId)
      if (snapshot.epoch !== input.epoch || snapshot.model.kind !== 'course-v10')
        throw new Error('此工具只导出当前正式 V10 文档；目标文档已关闭或重开时请重新选择')
      const request: ExportBuildRequest = { requestId: randomUUID(),
        identity: { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, projectId: snapshot.model.project.id },
        format: input.format, snapshot: structuredClone(snapshot) }
      let reply = await this.options.build.build(request, signal)
      signal?.throwIfAborted()
      validateExportBuildIdentity(request, reply)
      if (input.format === 'pdf' && reply.printHtml !== undefined) {
        if (!this.options.renderPdf) throw new Error('PDF 打印服务尚未连接；尚未写盘，当前工程保留')
        const bytes = await this.options.renderPdf(reply.printHtml, signal)
        signal?.throwIfAborted()
        reply = { ...reply, files: [{ relativePath: 'course.pdf', mimeType: 'application/pdf', bytes }] }
      }
      const files = validateExportBuildFiles(request, reply)
      const current = await this.options.documents.read(input.documentId)
      if (current.epoch !== snapshot.epoch || documentDigest(current.binding) !== documentDigest(snapshot.binding))
        throw new Error('文档身份或文件绑定在导出期间已变化')
      generated = { status: 'generated', documentId: snapshot.documentId, epoch: snapshot.epoch, format: input.format,
        exportedRevision: snapshot.revision, currentRevision: current.revision, warnings: reply.warnings,
        ...(files.length > 1 ? { files: files.map(file => ({ suggestedName: file.relativePath, byteLength: file.bytes.byteLength })) } : {}) }
      await this.options.operations.patch(input.runId, input.operationId, { status: 'generated', receipt: generated })
      const destinations: string[] = []
      for (const [index, file] of files.entries()) {
        let suggestedName = files.length > 1 ? file.relativePath : exportSuggestedName(snapshot, input.format)
        let requested = index === 0 || !input.destination ? input.destination : path.join(path.dirname(input.destination), suggestedName)
        if (index > 0 && requested) {
          const stem = path.basename(suggestedName, '.docx')
          let suffix = 2
          while (destinations.some(value => path.resolve(value).toLowerCase() === path.resolve(requested!).toLowerCase())) {
            suggestedName = `${stem} (${suffix++}).docx`
            requested = path.join(path.dirname(input.destination!), suggestedName)
          }
        }
        const filename = await this.options.resolveExportDestination({ runId: input.runId, snapshot, requested,
          format: input.format, suggestedName })
        if (!filename) return generated
        validateExportDestination(filename, input.format)
        if (destinations.some(value => path.resolve(value).toLowerCase() === path.resolve(filename).toLowerCase())) throw new Error('多个讲义的导出目标重名，请选择不同目标；尚未写盘')
        destinations.push(filename)
      }
      signal?.throwIfAborted()
      const write = () => this.options.documents.withFileLease(input.documentId, async read => {
        const final = read()
        if (final.epoch !== snapshot.epoch || documentDigest(final.binding) !== documentDigest(snapshot.binding))
          throw new Error('导出写盘前文档身份或文件绑定已变化')
        for (const [index, file] of files.entries()) {
          const filename = destinations[index]!, bytes = file.bytes
          signal?.throwIfAborted()
          await this.options.assertExportTarget?.(filename)
          const existing = await this.options.writer.inspect(filename)
          if (existing && (!this.options.writer.replaceExisting || !await this.options.operations.ownsExportVersion({
            runId: input.runId, documentId: input.documentId, epoch: input.epoch, path: filename, format: input.format, fileVersion: existing.fileVersion,
            taskRunIds: await this.options.taskRunIds?.(input.runId),
          }))) throw new Error('导出目标已有其他内容或已被修改，请选择新文件名；原文件未变更')
          const operationId = files.length > 1 ? `${input.operationId}/file/${index}` : input.operationId
          const childReceipt: ExportReceipt = { ...generated!, files: undefined }
          if (files.length > 1) {
            await this.started({ runId: input.runId, operationId, requestDigest: input.requestDigest, kind: 'export', status: 'generated' })
            await this.options.operations.patch(input.runId, input.operationId, { status: 'writing', receipt: generated })
          }
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          const prepared = async (publicationIdentity: string | null) => {
            await this.options.operations.patch(input.runId, operationId,
              { status: 'writing', path: filename, contentSha256: sha256, publicationIdentity, receipt: childReceipt })
          }
          signal?.throwIfAborted()
          await prepared(null) // Without publication proof, a lost acknowledgement remains queryable as unknown.
          writing = true
          const result = existing
            ? await this.options.writer.replaceExisting!(filename, bytes, existing.fileVersion, signal, prepared)
            : await this.options.writer.writeNew(filename, bytes, signal, prepared)
          writing = false
          const written: ExportReceipt = { ...childReceipt, status: 'written', path: filename, fileVersion: result.fileVersion, currentRevision: read().revision }
          if (files.length === 1) return written
          try { await this.options.operations.patch(input.runId, operationId, { status: 'completed', receipt: written, fileVersion: result.fileVersion }) }
          catch (error) { throw new DocumentDeliveryOutcomeUnknown(error) }
          generated = { ...generated!, files: generated!.files!.map((value, at) => at === index ? { ...value, path: filename, fileVersion: result.fileVersion } : value) }
          try { await this.options.operations.patch(input.runId, input.operationId, { status: 'writing', receipt: generated }) }
          catch (error) { throw new DocumentDeliveryOutcomeUnknown(error) }
        }
        return { ...generated!, status: 'written' as const, currentRevision: read().revision }
      })
      const receipt = this.options.withFileOperation ? await this.options.withFileOperation(write) : await write()
      try { await this.options.operations.patch(input.runId, input.operationId, { status: 'completed', receipt, fileVersion: receipt.fileVersion }) }
      catch (error) { throw new DocumentDeliveryOutcomeUnknown(error) }
      return receipt
    } catch (error) {
      if (error instanceof DocumentDeliveryOutcomeUnknown || writing && !(error instanceof DocumentSaveFailure && error.publication === 'not-published'))
        throw error instanceof DocumentDeliveryOutcomeUnknown ? error : new DocumentDeliveryOutcomeUnknown(error)
      const partial = generated?.files?.filter(file => file.path).map(file => file.path)
      const reason = (error instanceof Error ? error.message : String(error)) + (partial?.length ? `；已写出的文件保留：${partial.join('、')}，其余未写盘` : '')
      const receipt = { ...failedExport(input, reason), ...(generated?.files ? { files: generated.files } : {}) }
      await this.options.operations.patch(input.runId, input.operationId, { status: 'failed', receipt })
      return receipt
    }
  }
}
