import { DocumentSaveFailure, type DocumentSaveIdentity } from '../../../shared/workbench/documentSave'
import { createHash, randomUUID } from 'node:crypto'
import { documentDigest } from '../../../core/documents/documentDigest'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { exportSuggestedName, validateExportBuildReply, validateExportDestination } from '../../../shared/workbench/documentDelivery'
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
    let writing = false
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
      const reply = await this.options.build.build(request, signal)
      signal?.throwIfAborted()
      const bytes = validateExportBuildReply(request, reply)
      const current = await this.options.documents.read(input.documentId)
      if (current.epoch !== snapshot.epoch || documentDigest(current.binding) !== documentDigest(snapshot.binding))
        throw new Error('文档身份或文件绑定在导出期间已变化')
      const generated: ExportReceipt = { status: 'generated', documentId: snapshot.documentId, epoch: snapshot.epoch, format: input.format,
        exportedRevision: snapshot.revision, currentRevision: current.revision, warnings: reply.warnings }
      await this.options.operations.patch(input.runId, input.operationId, { status: 'generated', receipt: generated })
      const filename = await this.options.resolveExportDestination({ runId: input.runId, snapshot, requested: input.destination,
        format: input.format, suggestedName: exportSuggestedName(snapshot, input.format) })
      if (!filename) return generated
      validateExportDestination(filename, input.format)
      signal?.throwIfAborted()
      const write = () => this.options.documents.withFileLease(input.documentId, async read => {
        const final = read()
        if (final.epoch !== snapshot.epoch || documentDigest(final.binding) !== documentDigest(snapshot.binding))
          throw new Error('导出写盘前文档身份或文件绑定已变化')
        signal?.throwIfAborted()
        await this.options.assertExportTarget?.(filename)
        const existing = await this.options.writer.inspect(filename)
        if (existing && (!this.options.writer.replaceExisting || !await this.options.operations.ownsExportVersion({
          runId: input.runId, documentId: input.documentId, epoch: input.epoch, path: filename, format: input.format, fileVersion: existing.fileVersion,
          taskRunIds: await this.options.taskRunIds?.(input.runId),
        }))) throw new Error('导出目标已有其他内容或已被修改，请选择新文件名；原文件未变更')
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const prepared = async (publicationIdentity: string | null) => {
          await this.options.operations.patch(input.runId, input.operationId,
            { status: 'writing', path: filename, contentSha256: sha256, publicationIdentity, receipt: generated })
        }
        signal?.throwIfAborted()
        await prepared(null) // Older/custom writers without a candidate proof must remain queryable as unknown.
        // Only the byte writer can report a definite pre-publication rejection.
        writing = true
        const result = existing
          ? await this.options.writer.replaceExisting!(filename, bytes, existing.fileVersion, signal, prepared)
          : await this.options.writer.writeNew(filename, bytes, signal, prepared)
        return { ...generated, status: 'written' as const, path: filename, fileVersion: result.fileVersion, currentRevision: read().revision }
      })
      const receipt = this.options.withFileOperation ? await this.options.withFileOperation(write) : await write()
      try { await this.options.operations.patch(input.runId, input.operationId, { status: 'completed', receipt, fileVersion: receipt.fileVersion }) }
      catch (error) { throw new DocumentDeliveryOutcomeUnknown(error) }
      return receipt
    } catch (error) {
      if (error instanceof DocumentDeliveryOutcomeUnknown || writing && !(error instanceof DocumentSaveFailure && error.publication === 'not-published'))
        throw error instanceof DocumentDeliveryOutcomeUnknown ? error : new DocumentDeliveryOutcomeUnknown(error)
      const receipt = failedExport(input, error instanceof Error ? error.message : String(error))
      await this.options.operations.patch(input.runId, input.operationId, { status: 'failed', receipt })
      return receipt
    }
  }
}
