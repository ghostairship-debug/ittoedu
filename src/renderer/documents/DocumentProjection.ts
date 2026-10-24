import type { DocumentHostAPI } from '../../shared/workbench/desktop'
import type { DocumentCommand, DocumentDriver, DocumentHostEvent, DocumentModel, DocumentOperation, DocumentOperationResult, DocumentSnapshot } from '../../shared/workbench/document'
import { applyDocumentModelUpdate } from '../../core/documents/documentStateEffects'
import { MarkdownDriver } from '../../core/drivers/MarkdownDriver'
import { TextDriver } from '../../core/drivers/TextDriver'
import { retainDocumentResourceBytes } from '../../core/drivers/resources'
import { captureComponentOperation, componentValueAt, ComponentOperationConflict } from '../../core/drivers/courseV10Operations'
import { equalComponentValue } from '../../shared/componentValue'
import type { ComponentAppliedChanges, ComponentEdit, ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'
import type { JsonValue } from '../../shared/contracts/component-platform/project'

export interface DocumentProjectionError {
  kind: 'conflict' | 'disconnected' | 'rejected' | 'closed'
  code: string
  message: string
  operationId?: string
}
export interface DocumentProjectionState {
  committed: DocumentSnapshot | null
  /** Unconfirmed input only. Never a save source or a second history. */
  draft: DocumentModel | null
  /** A structurally invalid old draft is for recovery only; current runtimes use committed. */
  retainedDraftOnly: boolean
  pending: readonly { operationId: string; status: 'queued' | 'sending' | 'unknown' | 'rejected' | 'blocked' }[]
  error: DocumentProjectionError | null
  connected: boolean
  composing: { instanceId: string; path: string[] } | null
  /** Recoverable input, including text whose formal target was deleted. Never a current instance. */
  retainedComposition: { instanceId: string; path: string[]; value: JsonValue } | null
}
interface PendingOperation {
  operationId: string
  mutation: DocumentOperation['mutation']
  status: DocumentProjectionState['pending'][number]['status']
  operation?: DocumentOperation
  historyGroup?: string
  sourceChangeHints?: Array<{ from: number; to: number; inserted: number }>
  /** An exact own event can arrive before its dispatch receipt. Do not replay it in the view. */
  appliedRevision?: number
  /** Only a definite host refusal can be released by an input owner's explicit resolution. */
  refusal?: Exclude<DocumentOperationResult, { revision: number }>
  settle(result: DocumentOperationResult): void
  reject(error: Error): void
}

export class DocumentAckUnknownError extends Error {
  constructor(readonly operationId: string, cause: unknown) { super(cause instanceof Error ? cause.message : '文档操作回执未知') }
}

export class DocumentBlockedInputError extends Error {
  constructor(readonly operationId: string, message: string) { super(message) }
}

export class DocumentExactAckUnknownError extends DocumentAckUnknownError {
  constructor(operationId: string, cause: unknown) { super(operationId, cause instanceof Error ? cause : new Error('精确提交回执未知')) }
}

export type DocumentInputOperationResolution =
  | { status: 'pending' | 'missing' | 'unsubmitted' }
  | { status: 'settled'; result: DocumentOperationResult }

const successful = (result: DocumentOperationResult): result is Extract<DocumentOperationResult, { revision: number }> =>
  result.status === 'applied' || result.status === 'unchanged'

export interface DocumentProjectionChange {
  operationId: string
  revision: number
  appliedChanges: ComponentAppliedChanges
}

/** One view projection for one main-owned document. Disposing it never closes the document. */
export class DocumentProjection {
  private state: DocumentProjectionState = { committed: null, draft: null, retainedDraftOnly: false, pending: [], error: null, connected: false, composing: null, retainedComposition: null }
  private readonly listeners = new Set<() => void>()
  private readonly changeListeners = new Set<(change: DocumentProjectionChange) => void>()
  private readonly consumedChanges = new Set<string>()
  private mirroringOperationId?: string
  private composition?: { instanceId: string; path: string[]; value: JsonValue; initialValue: JsonValue; command: ComponentOperationBatch; active: boolean; conflict?: string }
  private projectionVersion = 0
  private queue: PendingOperation[] = []
  private closeSuspended = false
  private readonly ownOperations = new Set<string>()
  private stopSubscription?: () => void
  private worker?: Promise<void>
  private previewTail?: Promise<unknown>
  private precommitRelease?: () => void
  private precommitGate?: Promise<void>
  private expectedRevision = 0
  private expectedEpoch = ''
  private observedOwnRevision = 0
  private externalChanges = 0
  private disposed = false
  private attachment = 0
  private refresh?: Promise<void>
  private refreshRequested = false
  private connectionRecovery?: Promise<void>

  constructor(private readonly api: DocumentHostAPI, readonly documentId: string, private readonly driver?: DocumentDriver) {}

  static async attach(api: DocumentHostAPI, documentId: string, driver?: DocumentDriver, initialSnapshot?: DocumentSnapshot): Promise<DocumentProjection> {
    const projection = new DocumentProjection(api, documentId, driver)
    await projection.reattach(initialSnapshot)
    return projection
  }

  read = (): DocumentProjectionState => this.state
  getSnapshot = this.read
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Session patches once per exact operation ID. Synchronous editor feedback is an ACK echo. */
  subscribeChanges = (listener: (change: DocumentProjectionChange) => void): (() => void) => {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }
  private consumeChanges(operationId: string | undefined, revision: number, appliedChanges?: ComponentAppliedChanges): void {
    if (!operationId || !appliedChanges || this.consumedChanges.has(operationId)) return
    this.consumedChanges.add(operationId)
    const previous = this.mirroringOperationId
    this.mirroringOperationId = operationId
    try {
      for (const listener of this.changeListeners) {
        try { listener(structuredClone({ operationId, revision, appliedChanges })) } catch { /* View feedback never changes a durable ACK. */ }
      }
    } finally { this.mirroringOperationId = previous }
  }
  private update(patch: Partial<DocumentProjectionState> = {}): void {
    this.state = { ...this.state, ...patch, pending: this.queue.map(({ operationId, status }) => ({ operationId, status })) }
    for (const listener of this.listeners) { try { listener() } catch { /* A view cannot turn an ACK into a failed edit. */ } }
  }
  private problem(error: DocumentProjectionError): void {
    this.update({ error, ...(error.kind === 'disconnected' || error.kind === 'closed' ? { connected: false } : {}) })
  }
  private accept(snapshot: DocumentSnapshot, operationId?: string, attaching = false, appliedChanges?: ComponentAppliedChanges, owned = false): void {
    if (snapshot.documentId !== this.documentId) return
    const previous = this.state.committed
    if (previous && !attaching && snapshot.epoch !== previous.epoch) return
    if (previous?.epoch === snapshot.epoch && snapshot.revision < previous.revision) return
    if (previous?.epoch === snapshot.epoch && previous.sequence !== undefined && snapshot.sequence !== undefined && snapshot.sequence < previous.sequence) return
    if (previous && !this.ownOperations.has(operationId ?? '')
      && (snapshot.epoch !== previous.epoch || snapshot.revision > previous.revision)) this.externalChanges++
    if (previous?.epoch !== snapshot.epoch) this.observedOwnRevision = snapshot.revision
    if (this.ownOperations.has(operationId ?? '')) this.observedOwnRevision = Math.max(this.observedOwnRevision, snapshot.revision)
    const own = this.queue.find(entry => entry.operationId === operationId)
    if (own) own.appliedRevision = snapshot.revision
    // Content revisions do not cover save-prepared resource updates. An accepted
    // delta (or a newer complete head) must not be replaced with the old model.
    const sameContent = previous?.epoch === snapshot.epoch && previous.revision === snapshot.revision
      && previous.model.kind === snapshot.model.kind
    const sameHead = sameContent && previous.sequence !== undefined && previous.sequence === snapshot.sequence
    let model = snapshot.model
    let sameModel = sameContent && (model === previous.model || sameHead)
    if (sameContent && !sameModel) {
      const resources = retainDocumentResourceBytes(model.resources, previous.model.resources)
      const sameFiles = (left: Record<string, Uint8Array>, right: Record<string, Uint8Array>) =>
        Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, bytes]) => bytes === right[key])
      const sameResources = sameFiles(resources.assets, previous.model.resources.assets)
        && Object.keys(resources.components).length === Object.keys(previous.model.resources.components).length
        && Object.entries(resources.components).every(([key, files]) => sameFiles(files, previous.model.resources.components[key] ?? {}))
      sameModel = sameResources
      model = sameResources ? previous.model : { ...model, resources }
    }
    const { model: _model, ...metadata } = snapshot
    if (!sameModel) ++this.projectionVersion
    this.update({ committed: sameModel && previous ? { ...structuredClone(metadata), model: previous.model }
      : { ...(owned ? metadata : structuredClone(metadata)), model: owned || sameContent ? model : structuredClone(model) } })
    this.consumeChanges(operationId, snapshot.revision, appliedChanges)
    if (snapshot.model.kind === 'course-v10' && (!this.queue.length || snapshot.epoch === this.expectedEpoch)) {
      if (this.queue.length || this.composition) void this.scheduleComponentRebase()
      return
    }
    if (this.queue.length && !attaching && !this.ownOperations.has(operationId ?? '')
      && (snapshot.epoch !== this.expectedEpoch || snapshot.revision > Math.max(this.expectedRevision, this.observedOwnRevision))) {
      this.problem({ kind: 'conflict', code: 'external-change', message: '文档已在其他位置改变；未确认输入已保留，请比较后继续。' })
      this.blockUnsent()
    }
  }

  private componentDriver(): DocumentDriver {
    if (this.driver?.kind !== 'course-v10') throw new Error('V10 投影需要显式接入 CourseV10Driver')
    return this.driver
  }
  private scheduleComponentRebase(): Promise<void> {
    const work = () => this.rebuildComponentDraft()
    const tail = (this.previewTail ? this.previewTail.then(work) : work()).catch(error => {
      this.problem({ kind: 'rejected', code: 'projection-failed', message: error instanceof Error ? error.message : '无法更新组件投影；输入已保留。' })
    })
    this.previewTail = tail
    void tail.finally(() => { if (this.previewTail === tail) this.previewTail = undefined })
    return tail
  }
  private async rebuildComponentDraft(): Promise<void> {
    const snapshot = this.state.committed
    if (!snapshot || snapshot.model.kind !== 'course-v10' || this.disposed) return
    const version = this.projectionVersion
    const entries = [...this.queue]
    const composition = this.composition && structuredClone(this.composition)
    if (!entries.length && !composition) { this.update({ draft: null, retainedDraftOnly: false }); return }
    const driver = this.componentDriver()
    let draft: DocumentModel = snapshot.model
    const apply = (model: DocumentModel, command: DocumentCommand) => driver.applyValidated
      ? driver.applyValidated(model, command) : driver.apply(structuredClone(model), command)
    let retainedDraftOnly = false
    let conflict: { entry?: PendingOperation; error: Error } | undefined
    for (const entry of entries) {
      if (entry.appliedRevision !== undefined && entry.appliedRevision <= snapshot.revision) continue
      if (entry.mutation.type !== 'command' || entry.mutation.command.type !== 'component-platform.apply') continue
      try { draft = await apply(draft, entry.mutation.command) }
      catch (error) {
        if (!(error instanceof ComponentOperationConflict)) throw error
        conflict ??= { entry, error }
        // Recover only the view of retained input. The original expected values and operation
        // remain untouched; this temporary batch can never be submitted or saved.
        try {
          if (draft.kind !== 'course-v10') throw error
          draft = await apply(draft, captureComponentOperation(draft.project, entry.mutation.command.edits))
        } catch {
          // A deleted target or invalid relationship cannot be recreated by a projection.
          draft = this.state.draft ?? draft
          retainedDraftOnly = this.state.draft !== null
          break
        }
      }
    }
    if (composition && draft.kind === 'course-v10' && !equalComponentValue(composition.value, composition.initialValue)) {
      try {
        // Validate the original reads, even when IME has not emitted a final input event yet.
        draft = await apply(draft, composition.command)
      } catch (error) {
        conflict ??= { error: error instanceof Error ? error : new Error('正在输入的目标已不存在') }
        try {
          if (draft.kind !== 'course-v10') throw error
          draft = await apply(draft, captureComponentOperation(draft.project,
            [{ type: 'data.set', instanceId: composition.instanceId, path: composition.path, value: composition.value }]))
        } catch { /* Keep the latest formal project; a deleted target survives only as retained input. */ }
      }
      if (composition.conflict) conflict ??= { error: new Error(composition.conflict) }
    }
    if (version !== this.projectionVersion || this.disposed) return
    if (composition && conflict && this.composition) this.composition.conflict ??= conflict.error.message
    this.update({ draft, retainedDraftOnly, retainedComposition: composition && (!composition.active || conflict)
      ? { instanceId: composition.instanceId, path: [...composition.path], value: structuredClone(composition.value) } : null })
    if (conflict) {
      this.problem({ kind: 'conflict', code: 'component-field-conflict', operationId: conflict.entry?.operationId,
        message: `${conflict.error.message}；未确认输入已保留。` })
      this.blockUnsent()
    }
  }

  /** Native IME owns just this field until compositionend; other fields keep updating. */
  beginComposition(instanceId: string, path: string[]): void {
    if (this.closeSuspended) throw new Error('正在关闭文档，输入已保留')
    if (this.disposed || !this.state.committed) throw new Error('文档视图尚未连接')
    if (this.precommitGate) throw new Error('动态内容正在准备静态后备图，输入未提交')
    if (this.composition) throw new Error('已有尚未结束的文本输入')
    const model = this.state.draft ?? this.state.committed?.model
    if (model?.kind !== 'course-v10') throw new Error('文本输入目标不是 V10 组件')
    this.componentDriver()
    const field = componentValueAt(model.project, ['instances', instanceId, 'data', ...path])
    if (!field.exists) throw new Error('文本输入目标已不存在')
    this.composition = { instanceId, path: [...path], value: structuredClone(field.value!), initialValue: structuredClone(field.value!), active: true,
      command: captureComponentOperation(model.project, [{ type: 'data.set', instanceId, path, value: field.value! }]) }
    if (!this.queue.length) { this.expectedEpoch = this.state.committed!.epoch; this.expectedRevision = this.state.committed!.revision }
    ++this.projectionVersion
    this.update({ composing: { instanceId, path: [...path] }, retainedComposition: null, draft: structuredClone(model) })
  }
  /** IME updates a buffer through the same driver without producing operations or History. */
  updateComposition(value: JsonValue): Promise<void> {
    const composition = this.composition
    if (!composition?.active) return Promise.reject(new Error('没有正在进行的组合输入'))
    composition.value = structuredClone(value)
    composition.command.edits = [{ type: 'data.set', instanceId: composition.instanceId, path: [...composition.path], value: structuredClone(value) }]
    ++this.projectionVersion
    if (this.closeSuspended) return Promise.resolve()
    return this.scheduleComponentRebase()
  }
  async endComposition(value?: JsonValue): Promise<void> {
    const composition = this.composition
    if (!composition) return
    if (value !== undefined) {
      composition.value = structuredClone(value)
      composition.command.edits = [{ type: 'data.set', instanceId: composition.instanceId, path: [...composition.path], value: structuredClone(value) }]
    }
    composition.active = false
    ++this.projectionVersion
    this.update({ composing: null })
    if (this.closeSuspended) return
    if (equalComponentValue(composition.value, composition.initialValue)) {
      this.composition = undefined
      ++this.projectionVersion
      this.update({ retainedComposition: null, ...(!this.queue.length && this.state.error?.code === 'component-field-conflict' ? { error: null } : {}) })
      await this.scheduleComponentRebase()
      return
    }
    await this.scheduleComponentRebase()
    if (this.closeSuspended || this.composition !== composition || this.state.error) return
    const draft = this.state.draft ?? undefined
    this.composition = undefined
    ++this.projectionVersion
    this.update({ retainedComposition: null })
    if (!equalComponentValue(composition.value, composition.initialValue)) {
      await this.enqueue({ type: 'command', command: composition.command }, draft)
    } else await this.scheduleComponentRebase()
  }
  private refreshCommitted(): void {
    this.refreshRequested = true
    if (this.refresh) return
    const attachment = this.attachment
    const work = (async () => {
      do {
        this.refreshRequested = false
        const snapshot = await this.api.read(this.documentId)
        if (this.disposed || attachment !== this.attachment) return
        this.accept(snapshot, undefined, false, undefined, true)
      } while (this.refreshRequested)
    })().catch(error => {
      if (!this.disposed && attachment === this.attachment) this.problem({ kind: 'disconnected', code: 'document-refresh-failed',
        message: error instanceof Error ? error.message : '文档补全失败，输入已保留。' })
    })
    this.refresh = work
    void work.finally(() => { if (this.refresh === work) this.refresh = undefined })
  }

  private onEvent = (event: DocumentHostEvent): void => {
    if (this.disposed) return
    if (event.type === 'changed') this.accept(event.snapshot, event.operationId, false, event.appliedChanges, true)
    else if (event.type === 'state' || event.type === 'updated') {
      const head = event.head, current = this.state.committed
      if (head.documentId !== this.documentId || current && head.epoch !== current.epoch) return
      if (current?.sequence !== undefined && head.sequence < current.sequence) return
      const { kind: _kind, projectId: _projectId, ...facts } = head
      if (event.type === 'state') {
        if (!current || current.revision !== head.revision || current.sequence === undefined || head.sequence > current.sequence + 1) { this.refreshCommitted(); return }
        const own = this.queue.find(entry => entry.operationId === event.operationId)
        if (own) own.appliedRevision = head.revision
        this.update({ committed: { ...current, ...facts } })
      } else {
        if (!current || current.revision !== event.baseRevision || current.sequence !== event.baseSequence) {
          if (current && current.sequence !== undefined && head.sequence <= current.sequence) {
            const own = this.queue.find(entry => entry.operationId === event.operationId)
            if (own) own.appliedRevision = head.revision
            this.consumeChanges(event.operationId, head.revision, event.appliedChanges)
          } else this.refreshCommitted()
          return
        }
        try { this.accept({ ...facts, model: applyDocumentModelUpdate(current.model, event.model) }, event.operationId, false, event.appliedChanges, true) }
        catch { this.refreshCommitted() }
      }
    }
    else if (event.documentId === this.documentId && event.epoch === this.state.committed?.epoch) {
      if (this.closeSuspended) {
        for (const entry of this.queue) entry.reject(new Error('已放弃未保存输入并关闭文档'))
        this.queue = []
        this.composition = undefined
        this.update({ connected: false, draft: null, composing: null, retainedComposition: null, retainedDraftOnly: false, error: null })
        this.dispose()
      } else if (!this.canRelease()) {
        this.problem({ kind: 'closed', code: 'document-closed', message: '文档会话已关闭，未确认输入仍保留。' })
      } else {
        // Main emits closed before closeWithDialog returns. A drained view has no lost input.
        this.update({ connected: false })
        this.dispose()
      }
    }
  }

  /** An open caller may reuse its snapshot if it observed no same-document
   * event between requesting that snapshot and installing this subscription. */
  async reattach(initialSnapshot?: DocumentSnapshot): Promise<DocumentSnapshot> {
    this.disposed = false
    const attachment = ++this.attachment
    this.stopSubscription?.()
    let observedDuringSubscribe = false
    this.stopSubscription = this.api.subscribe(event => {
      if ((event.type === 'changed' ? event.snapshot.documentId : event.type === 'state' || event.type === 'updated' ? event.head.documentId : event.documentId) === this.documentId) observedDuringSubscribe = true
      this.onEvent(event)
    })
    try {
      const snapshot = initialSnapshot?.documentId === this.documentId && !observedDuringSubscribe
        ? initialSnapshot : await this.api.read(this.documentId)
      if (attachment !== this.attachment) throw new Error('文档连接已被替换')
      this.accept(snapshot, undefined, true)
      // An unknown receipt is queried with its original ID. No new identity or blind replay.
      for (const entry of [...this.queue]) {
        if (!entry.operation || (entry.status !== 'unknown' && entry.status !== 'sending')) break
        const receipt = await this.api.lookup(this.documentId, entry.operationId)
        if (receipt && successful(receipt)) this.acknowledge(entry, receipt)
        else if (receipt) { this.refuse(entry, receipt); break }
        // Missing is not proof that dispatch did not commit. Keep the original
        // unknown envelope; reconnect must never turn it into a replay.
      }
      const current = this.state.committed!
      if (this.queue.some(entry => entry.status === 'unknown' || entry.status === 'sending')) {
        this.update({ connected: true })
        return current
      }
      if (current.model.kind === 'course-v10' && current.epoch === this.expectedEpoch) {
        this.expectedRevision = current.revision
        const retainedRejection = this.queue.some(entry => entry.status === 'rejected') || this.state.error?.kind === 'rejected'
        if (!retainedRejection) for (const entry of this.queue) if (entry.status === 'blocked') entry.status = 'queued'
        this.update({ connected: true, ...(retainedRejection ? {} : { error: null }) })
        await this.scheduleComponentRebase()
        this.start()
      } else if (this.queue.length && (current.epoch !== this.expectedEpoch || current.revision !== this.expectedRevision)) {
        this.problem({ kind: 'conflict', code: 'external-change', message: '重连后文档基准已改变；未确认输入已保留，未覆盖新版本。' })
      } else if (!this.queue.some(entry => entry.status === 'rejected') && this.state.error?.kind !== 'rejected') {
        for (const entry of this.queue) if (entry.status === 'blocked') entry.status = 'queued'
        this.update({ connected: true, error: null, ...(this.queue.length ? {} : { draft: null }) })
        this.start()
      } else this.update({ connected: true })
      return current
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法连接文档服务'
      this.problem({ kind: 'disconnected', code: 'connection-lost', message })
      throw error
    }
  }

  editComponents(edits: ComponentEdit[], options: { historyGroup?: string } = {}): Promise<DocumentOperationResult> {
    const frozen = structuredClone(edits)
    return this.editPrepared(model => {
      if (model.kind !== 'course-v10') throw new Error('组件操作目标不是 V10 文档')
      return captureComponentOperation(model.project, frozen)
    }, options)
  }
  edit(command: DocumentCommand, options: { historyGroup?: string; sourceChangeHints?: Array<{ from: number; to: number; inserted: number }> } = {}): Promise<DocumentOperationResult> {
    const frozen = structuredClone(command)
    return this.editPrepared(() => frozen, { ...options, ...(options.sourceChangeHints ? { sourceChangeHints: structuredClone(options.sourceChangeHints) } : {}) })
  }
  private editPrepared(command: (model: DocumentModel) => DocumentCommand, options: { historyGroup?: string; sourceChangeHints?: Array<{ from: number; to: number; inserted: number }> }): Promise<DocumentOperationResult> {
    if (this.closeSuspended) return Promise.reject(new Error('正在关闭文档，输入已保留'))
    if (this.mirroringOperationId) {
      const operationId = this.mirroringOperationId
      return this.api.lookup(this.documentId, operationId).then(receipt => {
        if (!receipt) throw new Error('回显操作的正式回执暂不可读取')
        return receipt
      })
    }
    if (this.disposed || !this.state.committed) return Promise.reject(new Error('文档视图尚未连接'))
    if (this.precommitGate) return Promise.reject(new Error('动态内容正在准备静态后备图，输入未提交'))
    if (this.queue.some(entry => entry.mutation.type !== 'command')) return Promise.reject(new Error('请等待撤销或重做完成后继续输入'))
    const historyGroup = options.historyGroup
    if (historyGroup !== undefined && !historyGroup.trim()) return Promise.reject(new Error('历史分组不能为空'))
    return new Promise((resolve, reject) => {
      const prepare = () => {
        const baseline = this.state.committed!
        const base = this.state.draft ?? this.state.committed!.model
        const frozen = command(base)
        const externalChanges = this.externalChanges
        const driver = base.kind === 'course-v10' ? this.componentDriver() : this.driver
          ?? (base.kind === 'markdown' ? new MarkdownDriver() : base.kind === 'text' ? new TextDriver() : undefined)
        if (!driver) throw new Error('当前文档格式不受支持')
        const projected = driver.applyValidated && !this.state.retainedDraftOnly
          ? driver.applyValidated(base, frozen) : driver.apply(structuredClone(base), frozen)
        const enqueue = (draft: DocumentModel) => {
          const conflict = externalChanges !== this.externalChanges && base.kind !== 'course-v10'
          if (conflict) this.problem({ kind: 'conflict', code: 'external-change',
            message: '输入准备期间文档已改变；未确认输入已保留，未覆盖新版本。' })
          void this.enqueue({ type: 'command', command: frozen }, draft, historyGroup, conflict ? baseline : undefined, options.sourceChangeHints).then(resolve, reject)
          if (base.kind === 'course-v10' && externalChanges !== this.externalChanges) void this.scheduleComponentRebase()
        }
        return projected instanceof Promise ? projected.then(enqueue) : enqueue(projected)
      }
      // Projection sequencing is independent of network ACKs, so typing stays immediate.
      try {
        const preview = this.previewTail ? this.previewTail.then(prepare) : prepare()
        if (preview instanceof Promise) {
          const tail = preview.catch(reject)
          this.previewTail = tail
          void tail.finally(() => { if (this.previewTail === tail) this.previewTail = undefined })
        }
      } catch (error) { reject(error) }
    })
  }

  private enqueue(mutation: DocumentOperation['mutation'], draft?: DocumentModel, historyGroup?: string, baseline?: DocumentSnapshot,
    sourceChangeHints?: Array<{ from: number; to: number; inserted: number }>): Promise<DocumentOperationResult> {
    if (this.disposed) return Promise.reject(new Error('文档会话已关闭'))
    const snapshot = baseline ?? this.state.committed!
    if (!this.queue.length) { this.expectedRevision = snapshot.revision; this.expectedEpoch = snapshot.epoch }
    const operationId = crypto.randomUUID()
    this.ownOperations.add(operationId)
    const result = new Promise<DocumentOperationResult>((settle, reject) => {
      this.queue.push({ operationId, mutation, historyGroup, ...(sourceChangeHints ? { sourceChangeHints } : {}), status: this.state.error ? 'blocked' : 'queued', settle, reject })
    })
    ++this.projectionVersion
    this.update(draft ? { draft } : {})
    if (this.state.error) this.queue.at(-1)!.reject(new DocumentBlockedInputError(operationId, this.state.error.message))
    else this.start()
    return result
  }

  private start(): void {
    if (this.closeSuspended || this.disposed || this.worker || !this.state.connected || this.state.error || !this.queue.length) return
    const work = this.run()
    this.worker = work
    void work.finally(() => {
      if (this.worker === work) this.worker = undefined
      if (!this.state.error && this.queue.length) this.start()
    })
  }
  private async run(): Promise<void> {
    while (!this.closeSuspended && !this.disposed && this.queue.length && !this.state.error && this.state.connected) {
      if (this.state.committed?.model.kind === 'course-v10' && this.previewTail) await this.previewTail
      if (this.closeSuspended || this.disposed || !this.queue.length || this.state.error || !this.state.connected) return
      const entry = this.queue[0]!
      if (!entry.operation) {
        const mutation = structuredClone(entry.mutation)
        if (mutation.type === 'command' && mutation.command.type === 'course.replace') {
          // This is the acknowledged local chain, never an externally supplied new baseline.
          mutation.command.project.revision = this.expectedRevision
        }
        entry.operation = { documentId: this.documentId, epoch: this.expectedEpoch, operationId: entry.operationId,
          baseRevision: this.expectedRevision, actor: 'human', mutation, ...(entry.historyGroup ? { historyGroup: entry.historyGroup } : {}) }
      }
      entry.status = 'sending'
      this.update()
      try {
        const result = await this.api.dispatch(entry.operation, entry.sourceChangeHints ? { sourceChangeHints: entry.sourceChangeHints } : undefined)
        if (result.operationId !== entry.operationId || result.documentId !== this.documentId) throw new Error('文档操作回执身份不匹配')
        if (successful(result)) {
          entry.appliedRevision = result.revision
          if (!this.state.committed || this.state.committed.epoch !== this.expectedEpoch || this.state.committed.revision < result.revision) {
            const current = await this.api.read(this.documentId)
            this.accept(current, current.revision === result.revision ? entry.operationId : undefined)
          }
          this.acknowledge(entry, result)
        } else {
          this.refuse(entry, result)
          try { this.accept(await this.api.read(this.documentId)) }
          catch { this.problem({ kind: 'disconnected', code: 'snapshot-unavailable', message: '修改已拒绝，输入已保留；当前权威文档暂不可读取。' }) }
        }
      } catch (error) {
        if (!this.queue.includes(entry)) continue
        entry.status = 'unknown'
        const message = error instanceof Error ? error.message : '文档连接中断'
        this.problem({ kind: 'disconnected', code: 'ack-unknown', operationId: entry.operationId,
          message: `修改结果待核实，输入已保留。${message}` })
        entry.reject(new DocumentAckUnknownError(entry.operationId, new Error(this.state.error!.message)))
        this.blockDependents(entry)
      }
    }
  }
  private acknowledge(entry: PendingOperation, result: Extract<DocumentOperationResult, { revision: number }>): void {
    const index = this.queue.indexOf(entry)
    if (index < 0) return
    if (index !== 0) throw new Error('文档操作回执顺序不一致')
    this.expectedRevision = this.state.committed?.model.kind === 'course-v10'
      ? Math.max(result.revision, this.state.committed.revision) : result.revision
    this.queue.shift()
    ++this.projectionVersion
    entry.settle(result)
    this.consumeChanges(result.operationId, result.revision, result.appliedChanges)
    this.update(this.queue.length || this.composition ? {} : { draft: null, retainedDraftOnly: false, error: null })
    if (this.state.committed?.model.kind === 'course-v10' && (this.queue.length || this.composition)) void this.scheduleComponentRebase()
  }
  private refuse(entry: PendingOperation, result: Exclude<DocumentOperationResult, { revision: number }>): void {
    entry.refusal = result
    if (entry.mutation.type !== 'command' && this.queue[0] === entry && this.queue.every(pending => pending.mutation.type !== 'command')) {
      // A refused History command applied nothing and has no user draft to recover.
      // Its receipt remains available to the caller, while the next drain reads the
      // current authoritative head instead of being blocked by a dead queue item.
      const [, ...dependents] = this.queue.splice(0)
      for (const dependent of dependents) dependent.reject(new Error('前序撤销未应用，请重新读取后操作'))
      this.update({ draft: null, error: null })
      entry.settle(result)
      return
    }
    entry.status = 'rejected'
    this.problem({ kind: result.status === 'conflict' ? 'conflict' : 'rejected', operationId: entry.operationId, code: result.code, message: `${result.message}；未确认输入已保留。` })
    entry.settle(result)
    this.blockDependents(entry)
  }
  private blockDependents(first: PendingOperation): void {
    for (const entry of this.queue) if (entry !== first && entry.status === 'queued') {
      entry.status = 'blocked'
      entry.reject(entry.operation ? new DocumentAckUnknownError(entry.operationId, new Error('前序输入尚未确认，原操作仍待核实'))
        : new DocumentBlockedInputError(entry.operationId, '前序输入尚未确认，后续输入已保留且未发送'))
    }
    this.update()
  }
  private blockUnsent(): void {
    for (const entry of this.queue) if (entry.status === 'queued') {
      entry.status = 'blocked'
      entry.reject(entry.operation ? new DocumentAckUnknownError(entry.operationId, new Error('文档基准已改变，原操作仍待核实'))
        : new DocumentBlockedInputError(entry.operationId, '文档基准已改变，输入已保留且未发送'))
    }
    this.update()
  }

  precommitExternalChangeCount(): number { return this.externalChanges }

  /** Reserve this projection against ordinary full-document edits while a semantic candidate is prepared. */
  reservePrecommit(): () => void {
    if (this.closeSuspended) throw new Error('正在关闭文档，输入已保留')
    if (this.precommitGate) throw new Error('文档已有动态内容准备任务')
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    this.precommitGate = gate
    this.precommitRelease = release
    return () => { if (this.precommitGate === gate) { this.precommitGate = undefined; this.precommitRelease = undefined; release() } }
  }

  /** Fixed envelope: no normal queue rebase or new operation identity on an unknown ACK retry. */
  async editExact(snapshot: DocumentSnapshot, command: DocumentCommand, operationId: string = crypto.randomUUID()): Promise<DocumentOperationResult> {
    if (this.closeSuspended || !this.precommitGate || this.disposed || this.queue.length || this.composition || this.worker || this.previewTail)
      throw new Error('精确提交前文档仍有未确认输入')
    if (snapshot.documentId !== this.documentId) throw new Error('精确提交目标文档已改变')
    let result: DocumentOperationResult | null
    try { result = await this.api.lookup(this.documentId, operationId) }
    catch (error) { if (this.ownOperations.has(operationId)) throw new DocumentExactAckUnknownError(operationId, error); throw error }
    if (!result) {
      if (this.closeSuspended || this.disposed) throw new Error('正在关闭文档，输入已保留')
      if (!this.state.connected || this.state.committed?.epoch !== snapshot.epoch) throw new Error('精确提交文档会话已改变')
      if (this.state.committed.revision !== snapshot.revision) throw new Error('精确提交基准已变化')
      const operation: DocumentOperation = { documentId: this.documentId, epoch: snapshot.epoch, operationId,
        baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'command', command: structuredClone(command) } }
      this.ownOperations.add(operationId)
      try { result = await this.api.dispatch(operation) }
      catch (error) {
        try { result = await this.api.lookup(this.documentId, operationId) } catch { /* Preserve original identity for retry. */ }
        if (!result) throw new DocumentExactAckUnknownError(operationId, error)
      }
    }
    if (result.documentId !== this.documentId || result.operationId !== operationId) throw new Error('精确提交回执身份不匹配')
    if (successful(result)) {
      this.ownOperations.add(operationId)
      let current: DocumentSnapshot
      try { current = await this.api.read(this.documentId) }
      catch (error) { throw new DocumentExactAckUnknownError(operationId, error) }
      if (current.epoch !== this.state.committed?.epoch) await this.reattach()
      else this.accept(current, current.revision === result.revision ? operationId : undefined)
      this.expectedRevision = current.revision
      this.expectedEpoch = current.epoch
      this.consumeChanges(result.operationId, result.revision, result.appliedChanges)
    } else {
      try { this.accept(await this.api.read(this.documentId)) } catch { /* The rejection remains authoritative. */ }
    }
    return result
  }

  async undo(): Promise<DocumentOperationResult> { await this.drain(); return this.enqueue({ type: 'undo' }) }
  async undoLatestAgent(expectedTopOperationId?: string, assertCurrent?: () => void): Promise<DocumentOperationResult> {
    const snapshot = await this.drain()
    assertCurrent?.()
    if (snapshot.undoHead?.actor !== 'agent' || (expectedTopOperationId && snapshot.undoHead.operationId !== expectedTopOperationId)) {
      throw new Error('最近一次操作不是 AI 修改，请按正常撤销顺序处理')
    }
    return this.enqueue({ type: 'undo', expectedTopOperationId: snapshot.undoHead.operationId }, undefined, undefined, snapshot)
  }
  async redo(): Promise<DocumentOperationResult> { await this.drain(); return this.enqueue({ type: 'redo' }) }
  async drain(): Promise<DocumentSnapshot> {
    while (this.precommitGate) await this.precommitGate
    return this.drainForPrecommit()
  }
  /** Main reads its own fresh canonical snapshot after this input-only acknowledgement. */
  async flushInput(): Promise<void> {
    while (this.precommitGate) await this.precommitGate
    await this.flushInputForPrecommit()
  }
  private async flushInputForPrecommit(): Promise<void> {
    if (this.closeSuspended) throw new Error('正在关闭文档，输入已保留')
    if (this.state.error?.kind === 'disconnected' && !this.queue.length) await this.recoverConnectionIfIdle()
    if (this.previewTail) await this.previewTail
    if (this.composition && !this.composition.active && !this.state.error) await this.endComposition()
    while (this.worker) await this.worker
    if (this.state.error || this.queue.length || this.composition || !this.state.committed || !this.state.connected)
      throw new Error(this.state.error?.message ?? (this.composition ? '文本组合输入尚未确认' : '文档输入尚未确认'))
  }
  /** A failed read with no outstanding input is a connection problem, not an
   * operation to retry. Keep its existing subscription and only refresh facts. */
  async recoverConnectionIfIdle(): Promise<void> {
    if (this.connectionRecovery) return this.connectionRecovery
    const error = this.state.error
    if (this.disposed || this.closeSuspended || error?.kind !== 'disconnected' || this.queue.length
      || this.composition || this.state.retainedComposition || this.state.retainedDraftOnly) return
    const attachment = this.attachment, epoch = this.state.committed?.epoch
    const task = (async () => {
      const snapshot = await this.api.read(this.documentId)
      if (this.disposed || this.closeSuspended || attachment !== this.attachment) return
      if (snapshot.epoch !== epoch) throw new Error('原文档会话已改变，请重新打开文档')
      this.accept(snapshot, undefined, false, undefined, true)
      if (this.state.error === error && !this.queue.length && !this.composition)
        this.update({ connected: true, error: null })
    })()
    this.connectionRecovery = task
    try { await task } finally { if (this.connectionRecovery === task) this.connectionRecovery = undefined }
  }
  /** The precommit owner reads the same authority while its own gate is held. */
  async drainForPrecommit(): Promise<DocumentSnapshot> {
    for (;;) {
      await this.flushInputForPrecommit()
      try { this.accept(await this.api.read(this.documentId)) }
      catch (error) {
        this.problem({ kind: 'disconnected', code: 'snapshot-unavailable', message: '无法读取当前权威文档；未确认输入已保留。' })
        throw error
      }
      if (!this.queue.length && !this.previewTail) return structuredClone(this.state.committed!)
    }
  }
  /** Inspect only this input's original operation. Unlike reattach, this never
   * requeues or starts other input, and a missing unknown receipt stays unknown. */
  async queryInputResolution(operationId: string, options: { refresh?: boolean } = {}): Promise<DocumentInputOperationResolution> {
    if (this.previewTail) await this.previewTail
    while (this.worker) await this.worker
    const epoch = this.state.committed?.epoch, attachment = this.attachment
    if (this.disposed || !epoch || !this.ownOperations.has(operationId)) throw new Error('原输入操作已不可定位，请重新核实文档')
    const entry = this.queue.find(value => value.operationId === operationId)
    const unsubmitted = entry?.status === 'blocked' && !entry.operation
    if (entry && entry.status !== 'unknown' && entry.status !== 'rejected' && entry.status !== 'blocked') return { status: 'pending' }
    const assertCurrent = () => {
      if (this.disposed || attachment !== this.attachment || this.state.committed?.epoch !== epoch
        || entry && this.queue.find(value => value.operationId === operationId) !== entry)
        throw new Error('核实输入期间文档会话已改变，请重新核实')
    }
    const receipt = unsubmitted ? undefined : entry?.status === 'rejected' ? entry.refusal : await this.api.lookup(this.documentId, operationId)
    assertCurrent()
    if (!receipt && entry && !unsubmitted) return { status: 'pending' }
    if (receipt && (receipt.operationId !== operationId || receipt.documentId !== this.documentId)) throw new Error('文档操作回执身份不匹配')
    // Record the definite outcome even if refreshing the authoritative head fails.
    if (entry && receipt && !successful(receipt)) this.refuse(entry, receipt)
    // Ending a certified zero-write proposal does not depend on reading another
    // snapshot. A successful/unknown operation still follows the normal lookup
    // and authoritative-head confirmation before its ACK can be consumed.
    if (options.refresh === false && (unsubmitted || receipt && !successful(receipt)))
      return unsubmitted ? { status: 'unsubmitted' } : { status: 'settled', result: receipt! }
    const snapshot = await this.api.read(this.documentId)
    assertCurrent()
    if (snapshot.documentId !== this.documentId || snapshot.epoch !== epoch
      || receipt && successful(receipt) && snapshot.revision < receipt.revision)
      throw new Error('当前权威文档尚不能核实该输入，请保留草稿后重试')
    if (entry && receipt && successful(receipt)) entry.appliedRevision = receipt.revision
    this.accept(snapshot, receipt && successful(receipt) && snapshot.revision === receipt.revision ? operationId : undefined)
    if (entry && receipt && successful(receipt)) this.acknowledge(entry, receipt)
    // Foreign blocked proposals retain their queue identities and require their own resolution.
    const foreign = this.queue.find(value => value.operationId !== operationId)
    this.update({ connected: true, ...(foreign ? { error: { kind: 'conflict' as const, code: 'pending-input', operationId: foreign.operationId,
      message: '其他未确认输入仍保留，请处理后继续。' } } : receipt && successful(receipt) && this.state.error?.operationId === operationId ? { error: null } : {}) })
    if (this.previewTail) await this.previewTail
    return unsubmitted ? { status: 'unsubmitted' } : receipt ? { status: 'settled', result: receipt } : { status: 'missing' }
  }

  /** Explicit user resolution only; never called by an incoming event or reconnect. */
  async releaseRejectedOperation(operationId: string): Promise<void> {
    return this.releaseUnappliedInput(operationId, 'rejected')
  }
  /** A blocked envelope without operation was never sent to Main. */
  async releaseUnsubmittedOperation(operationId: string): Promise<void> {
    return this.releaseUnappliedInput(operationId, 'unsubmitted')
  }
  private async releaseUnappliedInput(operationId: string, outcome: 'rejected' | 'unsubmitted'): Promise<void> {
    if (this.previewTail) await this.previewTail
    while (this.worker) await this.worker
    const index = this.queue.findIndex(entry => entry.operationId === operationId)
    if (index < 0) return
    const entry = this.queue[index]!
    if (outcome === 'rejected' ? entry.status !== 'rejected' : entry.status !== 'blocked' || Boolean(entry.operation))
      throw new Error('请先核实待确认操作的结果')
    // The input owner retains raw source and will capture a new committed
    // baseline. Other input and unknown operations keep their existing owners.
    this.queue.splice(index, 1)
    ++this.projectionVersion
    this.update({ error: this.queue.length ? { kind: 'conflict', code: 'pending-input', operationId: this.queue[0]!.operationId,
      message: '其他未确认输入仍保留，请处理后继续。' } : !this.state.connected
      ? { kind: 'disconnected', code: 'snapshot-unavailable', message: '当前文档暂未连接，请重试读取；原输入仍保留。' } : null,
      ...(!this.queue.length && !this.composition ? { draft: null, retainedDraftOnly: false } : {}) })
    if (this.state.committed?.model.kind === 'course-v10') await this.scheduleComponentRebase()
  }

  /** Explicit user resolution only; never called by an incoming event or reconnect. */
  discardDraft(): void {
    if (this.queue.some(entry => entry.status === 'sending' || entry.status === 'unknown')) throw new Error('请先核实待确认操作的结果')
    for (const entry of this.queue) entry.reject(new Error('已明确放弃未确认输入'))
    this.queue = []
    this.composition = undefined
    ++this.projectionVersion
    this.update({ draft: null, retainedDraftOnly: false, error: null, composing: null, retainedComposition: null })
  }
  /** Input lifetime includes preparation outside the ordinary operation queue. */
  canRelease(): boolean {
    return !(this.queue.length || this.composition || this.state.draft || this.state.retainedComposition || this.previewTail || this.precommitGate || this.state.error?.kind === 'closed')
  }
  /** A discard decision stops new dispatches without requiring a failed draft to flush. */
  suspendForClose(): void { this.closeSuspended = true }
  resumeAfterCloseCancelled(): void {
    if (this.disposed) return
    this.closeSuspended = false
    if (this.composition && !this.composition.active) void this.endComposition().catch(error => {
      if (!this.disposed) this.problem({ kind: 'rejected', code: 'composition-unconfirmed', message: error instanceof Error ? error.message : String(error) })
    })
    this.start()
  }
  dispose(): void {
    this.disposed = true
    ++this.attachment
    this.stopSubscription?.()
    this.stopSubscription = undefined
    this.listeners.clear()
    this.changeListeners.clear()
    this.precommitRelease?.()
    this.precommitGate = undefined
    this.precommitRelease = undefined
  }
}
