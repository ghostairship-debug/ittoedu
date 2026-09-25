import type { DocumentModel, DocumentOperationResult, DocumentEvent } from '../../../shared/workbench/document'
import type { BeginEditSession, EditEvent, EditSessionSnapshot, EditTarget } from '../../../shared/workbench/editSession'
import type { ToolTarget } from '../../../shared/workbench/tools'
import { DocumentRegistry } from '../../../core/documents/DocumentRegistry'
import type { DocumentToolGateway } from '../../../core/tools/DocumentToolGateway'
import { documentDigest } from '../../../core/documents/documentDigest'
import { mapMarkdownRange, readTarget, targetFootprint } from '../../../core/tools/ToolTargets'
import { locateCourseLayer } from '../../../core/drivers/course/layerProperties'
import { isRichTextFlowBlock, resolveFlowBlock } from '../../../core/tools/flowDocumentModel'

type EditGateway = Pick<DocumentToolGateway, 'resolveEditTarget' | 'operationIdentity'>
interface Entry {
  request: BeginEditSession
  snapshot: EditSessionSnapshot
  model: DocumentModel
  footprint: string
  operationId: string
  fragments: Map<number, string>
  stop(): void
  changes: number
  validation?: Promise<void>
  result?: DocumentOperationResult
}
export class EditSessionError extends Error {
  constructor(readonly editId: string, readonly code: string, message: string) {
    super(message); this.name = 'EditSessionError'
  }
}

function editable(model: DocumentModel, target: ToolTarget): EditTarget {
  readTarget(model, target)
  if (target.kind === 'markdown-range') return target
  if (model.kind !== 'course-v9') throw new Error('正文目标不属于课程文档')
  if (target.kind === 'course-object') {
    const item = locateCourseLayer(model.project, target.itemId)?.item
    if (!item || item.kind !== 'native' || item.content.nativeType !== 'text' || item.locked) throw new Error('当前对象不是可编辑的 Native 文字')
    return target
  }
  if (target.kind === 'flow-range') return target
  if (target.kind === 'flow-block') {
    const { block } = resolveFlowBlock(model.project, target)
    if (isRichTextFlowBlock(block) || block.type === 'callout' || block.type === 'code') return target
  }
  throw new Error('此目标不支持正文生成预览')
}

/** Volatile projection owner. Only the Gateway/DocumentSession can commit canonical content. */
export class EditSessionService {
  private entries = new Map<string, Entry>()
  private documents = new Map<string, string>()
  private beginnings = new Map<string, { request: BeginEditSession; promise: Promise<EditSessionSnapshot> }>()
  private cancelled = new Map<string, string>()
  private listeners = new Set<(event: EditEvent) => void>()

  constructor(private readonly registry: DocumentRegistry, private readonly gateway: EditGateway) {}

  subscribe(listener: (event: EditEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  list(documentId: string): EditSessionSnapshot[] {
    const editId = this.documents.get(documentId), entry = editId ? this.entries.get(editId) : undefined
    return entry?.snapshot.status === 'active' ? [structuredClone(entry.snapshot)] : []
  }
  private emit(event: EditEvent): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)) } catch { /* A failed consumer cannot alter the editing lifecycle. */ }
    }
  }
  private active(entry: Entry): boolean { return entry.snapshot.status === 'active' }
  private release(entry: Entry): void {
    entry.stop()
    if (this.documents.get(entry.snapshot.documentId) === entry.snapshot.editId) this.documents.delete(entry.snapshot.documentId)
  }
  private sameRequest(left: BeginEditSession, right: BeginEditSession): boolean {
    return left.runId === right.runId && left.targetHandle === right.targetHandle
      && (left.toolCallId ?? left.editId) === (right.toolCallId ?? right.editId)
  }

  begin(input: BeginEditSession): Promise<EditSessionSnapshot> {
    const request = structuredClone(input)
    if (!request.editId || !request.runId || !request.targetHandle) return Promise.reject(new EditSessionError(request.editId, 'invalid-edit', '编辑组缺少宿主身份或授权目标'))
    const existing = this.entries.get(request.editId)
    if (existing) return this.active(existing) && this.sameRequest(existing.request, request)
      ? Promise.resolve(structuredClone(existing.snapshot))
      : Promise.reject(new EditSessionError(request.editId, 'edit-id-used', '编辑组编号已使用，不能重启或更换目标'))
    if (this.cancelled.has(request.editId)) return Promise.reject(new EditSessionError(request.editId, 'edit-aborted', this.cancelled.get(request.editId)!))
    const pending = this.beginnings.get(request.editId)
    if (pending) return this.sameRequest(pending.request, request) ? pending.promise
      : Promise.reject(new EditSessionError(request.editId, 'edit-id-used', '等待授权的编辑组不能更换目标'))
    const promise = this.start(request).finally(() => { this.beginnings.delete(request.editId) })
    this.beginnings.set(request.editId, { request, promise })
    return promise
  }

  private async start(request: BeginEditSession): Promise<EditSessionSnapshot> {
    const resolved = await this.gateway.resolveEditTarget(request.runId, request.targetHandle)
    if (this.cancelled.has(request.editId)) throw new EditSessionError(request.editId, 'edit-aborted', this.cancelled.get(request.editId)!)
    const target = editable(resolved.model, resolved.target)
    if (this.documents.has(resolved.documentId)) throw new EditSessionError(request.editId, 'document-busy', '该文档已有正在生成的正文，请等待或停止当前编辑')
    const session = this.registry.get(resolved.documentId)
    const entry: Entry = {
      request, snapshot: { editId: request.editId, runId: request.runId, documentId: resolved.documentId,
        epoch: resolved.epoch, baseRevision: resolved.revision, revision: resolved.revision, targetHandle: request.targetHandle,
        target, value: '', sequence: -1, status: 'active' },
      model: resolved.model, footprint: targetFootprint(resolved.model, target),
      operationId: this.gateway.operationIdentity(request.runId, request.toolCallId ?? request.editId),
      fragments: new Map(), stop: () => undefined, changes: 0,
    }
    this.entries.set(request.editId, entry); this.documents.set(resolved.documentId, request.editId)
    entry.stop = session.subscribe(event => this.changed(entry, event))
    // Close the resolve/subscribe race with the actual current session, without consulting focus.
    this.changed(entry, { type: 'changed', snapshot: session.read() })
    await entry.validation
    if (!this.active(entry)) throw new EditSessionError(request.editId, 'edit-aborted', entry.snapshot.reason ?? '编辑目标已失效')
    this.emit({ type: 'edit.changed', snapshot: entry.snapshot })
    return structuredClone(entry.snapshot)
  }

  private changed(entry: Entry, event: DocumentEvent): void {
    if (!this.active(entry)) return
    if (event.type === 'closed') { this.abort(entry.snapshot.editId, '文档已关闭'); return }
    if (event.snapshot.epoch !== entry.snapshot.epoch) { this.abort(entry.snapshot.editId, '文档会话已改变'); return }
    if (event.operationId === entry.operationId) {
      const result = this.registry.get(entry.snapshot.documentId).lookupOperation(entry.operationId)
      if (result) this.finish(entry.snapshot.editId, result)
      else this.abort(entry.snapshot.editId, '正式编辑的确认记录不存在')
      return
    }
    try {
      let target = entry.snapshot.target
      if (target.kind === 'markdown-range') {
        if (entry.model.kind !== 'markdown' || event.snapshot.model.kind !== 'markdown') throw new Error('正文格式已改变')
        target = mapMarkdownRange(entry.model.source, event.snapshot.model.source, target)
      }
      if (targetFootprint(event.snapshot.model, target) !== entry.footprint) throw new Error('生成目标与新的文档修改重叠或已失效')
      const changed = event.snapshot.revision !== entry.snapshot.revision || documentDigest(target) !== documentDigest(entry.snapshot.target)
      entry.model = event.snapshot.model; entry.snapshot.target = target; entry.snapshot.revision = event.snapshot.revision
      entry.changes += 1
      if (changed) this.emit({ type: 'edit.changed', snapshot: entry.snapshot })
      this.validate(entry)
    } catch (error) { this.abort(entry.snapshot.editId, error instanceof Error ? error.message : '生成目标已失效') }
  }

  private validate(entry: Entry): void {
    if (entry.validation || !this.active(entry)) return
    entry.validation = (async () => {
      for (;;) {
        const changes = entry.changes
        const resolved = await this.gateway.resolveEditTarget(entry.snapshot.runId, entry.snapshot.targetHandle)
        if (!this.active(entry)) return
        if (resolved.documentId !== entry.snapshot.documentId || resolved.epoch !== entry.snapshot.epoch) throw new Error('编辑目标的文档身份已改变')
        if (changes === entry.changes) {
          const target = editable(resolved.model, resolved.target)
          if (resolved.revision !== entry.snapshot.revision || documentDigest(target) !== documentDigest(entry.snapshot.target)) {
            entry.model = resolved.model; entry.snapshot.target = target; entry.snapshot.revision = resolved.revision
            this.emit({ type: 'edit.changed', snapshot: entry.snapshot })
          }
          return
        }
      }
    })().catch(error => { this.abort(entry.snapshot.editId, error instanceof Error ? error.message : '编辑授权或目标已失效') })
      .finally(() => { entry.validation = undefined })
  }

  /** Every call is a cumulative replacement snapshot, not text to append. */
  async snapshot(editId: string, seq: number, content: string): Promise<EditSessionSnapshot | null> {
    const entry = this.entries.get(editId)
    if (!entry || !this.active(entry)) return null
    // Run stop is a main authorization barrier and need not change the document revision.
    this.validate(entry)
    await entry.validation
    if (!this.active(entry)) return null
    if (!Number.isSafeInteger(seq) || seq < 0 || typeof content !== 'string') {
      this.abort(editId, '正文快照格式或序号无效')
      throw new EditSessionError(editId, 'invalid-snapshot', '正文快照格式或序号无效')
    }
    const previous = entry.fragments.get(seq)
    if (previous !== undefined) {
      if (previous !== content) {
        this.abort(editId, '同一正文快照序号包含不同内容')
        throw new EditSessionError(editId, 'sequence-conflict', '同一正文快照序号包含不同内容')
      }
      return structuredClone(entry.snapshot)
    }
    entry.fragments.set(seq, content)
    if (seq <= entry.snapshot.sequence) return structuredClone(entry.snapshot)
    entry.snapshot.sequence = seq; entry.snapshot.value = content
    this.emit({ type: 'edit.changed', snapshot: entry.snapshot })
    return structuredClone(entry.snapshot)
  }

  abort(editId: string, reason: string): void {
    const entry = this.entries.get(editId)
    if (!entry) { this.cancelled.set(editId, reason); return }
    if (!this.active(entry)) return
    entry.snapshot.status = 'aborted'; entry.snapshot.reason = reason
    this.release(entry)
    this.emit({ type: 'edit.aborted', snapshot: entry.snapshot, reason })
  }

  /** Receipt verification and preview removal only: no execute(), save() or second History entry. */
  finish(editId: string, operationResult: DocumentOperationResult): void {
    const entry = this.entries.get(editId)
    if (!entry || entry.snapshot.status === 'aborted') return
    if (entry.snapshot.status === 'finished') {
      if (documentDigest(operationResult) !== documentDigest(entry.result)) throw new EditSessionError(editId, 'receipt-conflict', '编辑组收到不同的正式提交回执')
      return
    }
    const session = this.registry.get(entry.snapshot.documentId)
    const actual = session.lookupOperation(entry.operationId)
    if (operationResult.documentId !== entry.snapshot.documentId || operationResult.operationId !== entry.operationId
      || !actual || documentDigest(actual) !== documentDigest(operationResult) || session.read().epoch !== entry.snapshot.epoch) {
      this.abort(editId, '正式编辑回执不属于当前编辑组或尚未确认')
      return
    }
    if (operationResult.status !== 'applied' && operationResult.status !== 'unchanged') {
      this.abort(editId, 'message' in operationResult ? operationResult.message : '正式编辑未完成'); return
    }
    entry.result = structuredClone(operationResult)
    entry.snapshot.status = 'finished'; entry.snapshot.revision = operationResult.revision
    this.release(entry)
    this.emit({ type: 'edit.finished', snapshot: entry.snapshot, result: operationResult })
  }
}
