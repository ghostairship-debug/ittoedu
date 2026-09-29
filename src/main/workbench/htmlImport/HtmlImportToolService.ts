import path from 'node:path'
import type { DocumentSession } from '../../../core/documents/DocumentSession'
import type { DocumentToolGateway } from '../../../core/tools/DocumentToolGateway'
import { documentDigest } from '../../../core/documents/documentDigest'
import type { DocumentOperationResult, DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlImportDestination, HtmlImportReceipt, HtmlImportServicePort } from '../../../shared/workbench/toolPorts'
import type { ToolResult } from '../../../shared/workbench/tools'
import { HtmlImportService } from './HtmlImportService'
import type { HtmlImportNetworkGrants } from './htmlImportNetworkGrants'
import { HtmlImportOperationStore, type HtmlImportOperationRecord } from './HtmlImportOperationStore'
import { splitHtmlSections } from './splitHtmlSections'

class HtmlImportOutcomeUnknownError extends Error {
  readonly code = 'tool-outcome-unknown'
  constructor(cause?: unknown) {
    super('HTML 导入提交结果尚未确定；原操作与子调用已保留，请查询原回执后继续', { cause })
  }
}

export interface HtmlImportToolServiceOptions {
  documents: { read(documentId: string): Promise<DocumentSnapshot>; get(documentId: string): DocumentSession }
  gateway: Pick<DocumentToolGateway, 'execute' | 'executeInternalBuild' | 'issueTarget' | 'lookup' | 'operationIdentity' | 'stop'>
  cancelJob(runId: string, jobId: string): Promise<void>
  networkGrants?: HtmlImportNetworkGrants
  operationStore: HtmlImportOperationStore
}

export class HtmlImportToolService implements HtmlImportServicePort {
  constructor(private readonly options: HtmlImportToolServiceOptions) {}

  private async recoverCommit(record: HtmlImportOperationRecord): Promise<HtmlImportReceipt | null> {
    const child = record.children.find(item => item.name === 'build.import')
    if (!child || !record.targetDocumentId) return null
    let observed: ToolResult | null = null
    try { observed = await this.options.gateway.lookup(record.runId, child.callId, { name: 'build.import', input: child.input }) }
    catch { /* The original run may have ended; the canonical session still has its durable operation receipt. */ }
    let result = observed?.kind === 'document-operation' ? observed.result : null
    if (!result) {
      try { result = this.options.documents.get(record.targetDocumentId).lookupOperation(this.options.gateway.operationIdentity(record.runId, child.callId)) }
      catch { /* A closed document leaves the outcome unknown until it is reopened. */ }
    }
    if (result?.status !== 'applied' && result?.status !== 'unchanged') return null
    const receipt: HtmlImportReceipt = { operationId: record.operationId, status: result.status,
      pages: record.pages ?? [], revision: result.revision, commit: result }
    await this.options.operationStore.patch(record.runId, record.operationId, { status: 'committed', receipt })
    return receipt
  }

  async lookup(input: { runId: string; operationId: string; requestDigest: string }): Promise<HtmlImportReceipt | null> {
    const record = await this.options.operationStore.lookup(input.runId, input.operationId)
    if (!record) return null
    if (record.requestDigest !== input.requestDigest) throw new Error('同一 HTML 导入操作编号不能改变请求参数')
    if (record.receipt) return record.status === 'cancelled' && !record.receipt.commit
      ? { ...record.receipt, status: 'cancelled' } : record.receipt
    try {
      const recovered = await this.recoverCommit(record)
      if (recovered) return recovered
    } catch (error) { throw new HtmlImportOutcomeUnknownError(error) }
    throw new HtmlImportOutcomeUnknownError()
  }

  async cancel(input: { runId: string; operationId: string }): Promise<void> {
    const record = await this.options.operationStore.lookup(input.runId, input.operationId)
    if (!record || record.status === 'committed' || record.status === 'committing') return
    await this.options.operationStore.patch(input.runId, input.operationId, { status: 'cancelled' })
    if (record.jobId) await this.options.cancelJob(input.runId, record.jobId)
  }

  async import(input: {
    runId: string; operationId: string; requestDigest: string
    sourceDocumentId: string; sourceEpoch: string; sourceRevision: number; sourceBindingVersion: number | null
    targetDocumentId: string; targetEpoch: string; targetRevision: number
    mode: 'auto' | 'sections' | 'whole'; destinations: readonly HtmlImportDestination[]; signal?: AbortSignal
  }): Promise<HtmlImportReceipt> {
    const known = await this.options.operationStore.lookup(input.runId, input.operationId)
    if (known) return (await this.lookup(input))!
    const reservation = await this.options.operationStore.start(input)
    if (!reservation.created) return (await this.lookup(input))!
    let commitBoundary = false
    try {
      input.signal?.throwIfAborted()
      const source = await this.options.documents.read(input.sourceDocumentId)
      if (source.model.kind !== 'text' || source.epoch !== input.sourceEpoch || source.revision !== input.sourceRevision
        || (source.binding.kind === 'file' ? source.binding.bindingVersion : null) !== input.sourceBindingVersion
        || source.binding.kind === 'file' && !/\.html?$/i.test(source.binding.path)) throw new Error('来源 HTML 文档已改变或不是 HTML 文本')
      const sourceHtml = source.model.source
      const sourcePath = source.binding.kind === 'file' ? source.binding.path : 'untitled.html'
      const rootDir = source.binding.kind === 'file' ? path.dirname(sourcePath) : undefined
      const sourceBinding = documentDigest(source.binding)
      const target = await this.options.documents.read(input.targetDocumentId)
      if (target.model.kind !== 'course-v9' || target.epoch !== input.targetEpoch || target.revision !== input.targetRevision)
        throw new Error('目标 Course V9 文档已改变；未建立导入候选')
      const split = splitHtmlSections(sourceHtml, input.mode)
      await this.options.operationStore.patch(input.runId, input.operationId, { status: 'preparing', targetDocumentId: target.documentId })
      const targetHandle = await this.options.gateway.issueTarget(input.runId, input.targetDocumentId, { kind: 'document' })
      const targetAfterHandle = await this.options.documents.read(input.targetDocumentId)
      if (targetAfterHandle.epoch !== target.epoch || targetAfterHandle.revision !== target.revision)
        throw new Error('目标文档在签发句柄期间改变；未建立导入候选')
      const session = this.options.documents.get(input.targetDocumentId)
      const service = new HtmlImportService({ session, gateway: this.options.gateway,
        networkGrants: this.options.networkGrants, cancelJob: this.options.cancelJob,
        onJobCreated: async (runId, jobId) => {
          const record = await this.options.operationStore.patch(runId, input.operationId, { jobId })
          if (record.status === 'cancelled') { await this.options.cancelJob(runId, jobId); throw new Error('HTML 导入已取消') }
        },
        beforeCall: async (runId, callId, name, childInput) => {
          const record = await this.options.operationStore.lookup(runId, input.operationId)
          if (record?.status === 'cancelled') throw new Error('HTML 导入已取消')
          await this.options.operationStore.child(runId, input.operationId, { callId, name, input: childInput })
        } })
      const ticket = await service.prepare({ operationId: input.operationId, runId: input.runId, targetHandle,
        sourcePath, rootDir, sourceHtml, sections: split.sections, destinations: input.destinations,
        mode: split.mode, commitCallId: `html:${input.operationId}:commit` })
      const during = await this.options.operationStore.lookup(input.runId, input.operationId)
      if (during?.status === 'cancelled') { await this.options.cancelJob(input.runId, ticket.jobId); throw new Error('HTML 导入已取消') }
      await this.options.operationStore.patch(input.runId, input.operationId, { status: 'checking', jobId: ticket.jobId, pages: ticket.pages })
      input.signal?.throwIfAborted()
      await service.admit(ticket)
      await this.options.operationStore.patch(input.runId, input.operationId, { status: 'ready' })
      input.signal?.throwIfAborted()
      const result = await this.options.documents.get(input.sourceDocumentId).withFileLease(async lease => {
        const currentSource = lease.read()
        if (currentSource.epoch !== source.epoch || currentSource.revision !== source.revision
          || documentDigest(currentSource.binding) !== sourceBinding || currentSource.model.kind !== 'text'
          || documentDigest(currentSource.model.source) !== documentDigest(sourceHtml))
          throw new Error('来源 HTML 在导入期间改变；未写入正式文档')
        const targetNow = await this.options.documents.read(input.targetDocumentId)
        if (targetNow.epoch !== target.epoch || targetNow.revision !== target.revision)
          throw new Error('目标 Course V9 文档在导入期间改变；未写入正式文档')
        await this.options.operationStore.patch(input.runId, input.operationId, { status: 'committing' })
        commitBoundary = true
        return service.commit(ticket)
      })
      if (result.status !== 'applied' && result.status !== 'unchanged')
        throw new Error('message' in result ? result.message : 'HTML 导入未提交')
      const receipt: HtmlImportReceipt = { operationId: input.operationId, status: result.status,
        pages: ticket.pages ?? [], revision: result.revision,
        commit: result as Extract<DocumentOperationResult, { status: 'applied' | 'unchanged' }> }
      await this.options.operationStore.patch(input.runId, input.operationId, { status: 'committed', receipt })
      return receipt
    } catch (error) {
      let record: HtmlImportOperationRecord | null
      try { record = await this.options.operationStore.lookup(input.runId, input.operationId) }
      catch (lookupError) {
        if (commitBoundary) throw new HtmlImportOutcomeUnknownError(lookupError)
        throw lookupError
      }
      if (record) {
        try {
          const recovered = await this.recoverCommit(record)
          if (recovered) return recovered
        } catch (recoveryError) {
          if (record.children.some(item => item.name === 'build.import')) throw new HtmlImportOutcomeUnknownError(recoveryError)
          throw recoveryError
        }
        if (record.children.some(item => item.name === 'build.import')) throw new HtmlImportOutcomeUnknownError(error)
        const reason = error instanceof Error ? error.message : String(error)
        // A signal can stop preparation before cancel() records its state.
        // Committed or ambiguous child writes have already been reconciled above.
        const status = record.status === 'cancelled' || input.signal?.aborted ? 'cancelled' : 'failed'
        const receipt: HtmlImportReceipt = { operationId: input.operationId, status,
          pages: record.pages ?? [], reason }
        await this.options.operationStore.patch(input.runId, input.operationId, { status, receipt, reason })
        return receipt
      }
      throw error
    }
  }
}
