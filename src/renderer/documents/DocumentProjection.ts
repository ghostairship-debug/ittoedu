import type { DocumentHostAPI } from '../../shared/workbench/desktop'
import type { DocumentCommand, DocumentDriver, DocumentEvent, DocumentModel, DocumentOperation, DocumentOperationResult, DocumentSnapshot } from '../../shared/workbench/document'
import { MarkdownDriver } from '../../core/drivers/MarkdownDriver'
import { TextDriver } from '../../core/drivers/TextDriver'
import { captureComponentOperation, componentValueAt, ComponentOperationConflict, equalComponentValue } from '../../core/drivers/courseV10Operations'
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
  /** An exact own event can arrive before its dispatch receipt. Do not replay it in the view. */
  appliedRevision?: number
  settle(result: DocumentOperationResult): void
  reject(error: Error): void
}

export class DocumentExactAckUnknownError extends Error {
  constructor(readonly operationId: string, cause: unknown) { super(cause instanceof Error ? cause.message : '精确提交回执未知') }
}

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

  constructor(private readonly api: DocumentHostAPI, readonly documentId: string, private readonly driver?: DocumentDriver) {}

  static async attach(api: DocumentHostAPI, documentId: string, driver?: DocumentDriver): Promise<DocumentProjection> {
    const projection = new DocumentProjection(api, documentId, driver)
    await projection.reattach()
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
  private accept(snapshot: DocumentSnapshot, operationId?: string, attaching = false, appliedChanges?: ComponentAppliedChanges): void {
    if (snapshot.documentId !== this.documentId) return
    const previous = this.state.committed
    if (previous && !attaching && snapshot.epoch !== previous.epoch) return
    if (previous?.epoch === snapshot.epoch && snapshot.revision < previous.revision) return
    if (previous && !this.ownOperations.has(operationId ?? '')
      && (snapshot.epoch !== previous.epoch || snapshot.revision > previous.revision)) this.externalChanges++
    if (previous?.epoch !== snapshot.epoch) this.observedOwnRevision = snapshot.revision
    if (this.ownOperations.has(operationId ?? '')) this.observedOwnRevision = Math.max(this.observedOwnRevision, snapshot.revision)
    const own = this.queue.find(entry => entry.operationId === operationId)
    if (own) own.appliedRevision = snapshot.revision
    ++this.projectionVersion
    this.update({ committed: structuredClone(snapshot) })
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
    let draft: DocumentModel = structuredClone(snapshot.model)
    let retainedDraftOnly = false
    let conflict: { entry?: PendingOperation; error: Error } | undefined
    for (const entry of entries) {
      if (entry.appliedRevision !== undefined && entry.appliedRevision <= snapshot.revision) continue
      if (entry.mutation.type !== 'command' || entry.mutation.command.type !== 'component-platform.apply') continue
      try { draft = await driver.apply(draft, entry.mutation.command) }
      catch (error) {
        if (!(error instanceof ComponentOperationConflict)) throw error
        conflict ??= { entry, error }
        // Recover only the view of retained input. The original expected values and operation
        // remain untouched; this temporary batch can never be submitted or saved.
        try {
          if (draft.kind !== 'course-v10') throw error
          draft = await driver.apply(draft, captureComponentOperation(draft.project, entry.mutation.command.edits))
        } catch {
          // A deleted target or invalid relationship cannot be recreated by a projection.
          draft = this.state.draft ?? draft
          retainedDraftOnly = this.state.draft !== null
          break
        }
      }
    }
    if (composition && draft.kind === 'course-v10') {
      try {
        // Validate the original reads, even when IME has not emitted a final input event yet.
        draft = await driver.apply(draft, composition.command)
      } catch (error) {
        conflict ??= { error: error instanceof Error ? error : new Error('正在输入的目标已不存在') }
        try {
          if (draft.kind !== 'course-v10') throw error
          draft = await driver.apply(draft, captureComponentOperation(draft.project,
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
    return this.scheduleComponentRebase()
  }
  async endComposition(value?: JsonValue): Promise<void> {
    const composition = this.composition
    if (!composition?.active) return
    if (value !== undefined) await this.updateComposition(value)
    composition.active = false
    ++this.projectionVersion
    this.update({ composing: null })
    await this.scheduleComponentRebase()
    if (this.composition !== composition || this.state.error) return
    const draft = this.state.draft ?? undefined
    this.composition = undefined
    ++this.projectionVersion
    this.update({ retainedComposition: null })
    if (!equalComponentValue(composition.value, composition.initialValue)) {
      await this.enqueue({ type: 'command', command: composition.command }, draft)
    } else await this.scheduleComponentRebase()
  }
  private onEvent = (event: DocumentEvent): void => {
    if (this.disposed) return
    if (event.type === 'changed') this.accept(event.snapshot, event.operationId, false, event.appliedChanges)
    else if (event.documentId === this.documentId && event.epoch === this.state.committed?.epoch) {
      if (this.queue.length || this.composition || this.state.draft || this.state.retainedComposition || this.previewTail || this.precommitGate) {
        this.problem({ kind: 'closed', code: 'document-closed', message: '文档会话已关闭，未确认输入仍保留。' })
      } else {
        // Main emits closed before closeWithDialog returns. A drained view has no lost input.
        this.update({ connected: false })
        this.dispose()
      }
    }
  }

  async reattach(): Promise<DocumentSnapshot> {
    this.disposed = false
    const attachment = ++this.attachment
    this.stopSubscription?.()
    this.stopSubscription = this.api.subscribe(this.onEvent)
    try {
      const snapshot = await this.api.read(this.documentId)
      if (attachment !== this.attachment) throw new Error('文档连接已被替换')
      this.accept(snapshot, undefined, true)
      // An unknown receipt is queried with its original ID. No new identity or blind replay.
      for (const entry of [...this.queue]) {
        if (!entry.operation || (entry.status !== 'unknown' && entry.status !== 'sending')) break
        const receipt = await this.api.lookup(this.documentId, entry.operationId)
        if (receipt && successful(receipt)) this.acknowledge(entry, receipt)
        else if (receipt) { this.refuse(entry, receipt); break }
        else if (entry.status === 'unknown') entry.status = 'queued'
      }
      const current = this.state.committed!
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
  edit(command: DocumentCommand, options: { historyGroup?: string } = {}): Promise<DocumentOperationResult> {
    const frozen = structuredClone(command)
    return this.editPrepared(() => frozen, options)
  }
  private editPrepared(command: (model: DocumentModel) => DocumentCommand, options: { historyGroup?: string }): Promise<DocumentOperationResult> {
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
        const projected = driver.apply(structuredClone(base), frozen)
        const enqueue = (draft: DocumentModel) => {
          const conflict = externalChanges !== this.externalChanges && base.kind !== 'course-v10'
          if (conflict) this.problem({ kind: 'conflict', code: 'external-change',
            message: '输入准备期间文档已改变；未确认输入已保留，未覆盖新版本。' })
          void this.enqueue({ type: 'command', command: frozen }, draft, historyGroup, conflict ? baseline : undefined).then(resolve, reject)
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

  private enqueue(mutation: DocumentOperation['mutation'], draft?: DocumentModel, historyGroup?: string, baseline?: DocumentSnapshot): Promise<DocumentOperationResult> {
    const snapshot = baseline ?? this.state.committed!
    if (!this.queue.length) { this.expectedRevision = snapshot.revision; this.expectedEpoch = snapshot.epoch }
    const operationId = crypto.randomUUID()
    this.ownOperations.add(operationId)
    const result = new Promise<DocumentOperationResult>((settle, reject) => {
      this.queue.push({ operationId, mutation, historyGroup, status: this.state.error ? 'blocked' : 'queued', settle, reject })
    })
    ++this.projectionVersion
    this.update(draft ? { draft } : {})
    if (this.state.error) this.queue.at(-1)!.reject(new Error(this.state.error.message))
    else this.start()
    return result
  }

  private start(): void {
    if (this.worker || !this.state.connected || this.state.error || !this.queue.length) return
    const work = this.run()
    this.worker = work
    void work.finally(() => {
      if (this.worker === work) this.worker = undefined
      if (!this.state.error && this.queue.length) this.start()
    })
  }
  private async run(): Promise<void> {
    while (this.queue.length && !this.state.error && this.state.connected) {
      if (this.state.committed?.model.kind === 'course-v10' && this.previewTail) await this.previewTail
      if (!this.queue.length || this.state.error || !this.state.connected) return
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
        const result = await this.api.dispatch(entry.operation)
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
        entry.reject(new Error(this.state.error!.message))
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
      entry.reject(new Error('前序输入尚未确认，后续输入已保留且未发送'))
    }
    this.update()
  }
  private blockUnsent(): void {
    for (const entry of this.queue) if (entry.status === 'queued') {
      entry.status = 'blocked'
      entry.reject(new Error('文档基准已改变，输入已保留且未发送'))
    }
    this.update()
  }

  precommitExternalChangeCount(): number { return this.externalChanges }

  /** Reserve this projection against ordinary full-document edits while a semantic candidate is prepared. */
  reservePrecommit(): () => void {
    if (this.precommitGate) throw new Error('文档已有动态内容准备任务')
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    this.precommitGate = gate
    this.precommitRelease = release
    return () => { if (this.precommitGate === gate) { this.precommitGate = undefined; this.precommitRelease = undefined; release() } }
  }

  /** Fixed envelope: no normal queue rebase or new operation identity on an unknown ACK retry. */
  async editExact(snapshot: DocumentSnapshot, command: DocumentCommand, operationId: string = crypto.randomUUID()): Promise<DocumentOperationResult> {
    if (!this.precommitGate || this.disposed || this.queue.length || this.composition || this.worker || this.previewTail)
      throw new Error('精确提交前文档仍有未确认输入')
    if (snapshot.documentId !== this.documentId) throw new Error('精确提交目标文档已改变')
    let result: DocumentOperationResult | null
    try { result = await this.api.lookup(this.documentId, operationId) }
    catch (error) { if (this.ownOperations.has(operationId)) throw new DocumentExactAckUnknownError(operationId, error); throw error }
    if (!result) {
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
  /** The precommit owner reads the same authority while its own gate is held. */
  async drainForPrecommit(): Promise<DocumentSnapshot> {
    for (;;) {
      if (this.previewTail) await this.previewTail
      while (this.worker) await this.worker
      if (this.state.error || this.queue.length || this.composition || !this.state.committed || !this.state.connected)
        throw new Error(this.state.error?.message ?? (this.composition ? '文本组合输入尚未确认' : '文档输入尚未确认'))
      try { this.accept(await this.api.read(this.documentId)) }
      catch (error) {
        this.problem({ kind: 'disconnected', code: 'snapshot-unavailable', message: '无法读取当前权威文档；未确认输入已保留。' })
        throw error
      }
      if (!this.queue.length && !this.previewTail) return structuredClone(this.state.committed!)
    }
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
