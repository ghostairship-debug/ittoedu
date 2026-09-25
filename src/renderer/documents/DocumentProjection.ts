import type { DocumentHostAPI } from '../../shared/workbench/desktop'
import type { DocumentCommand, DocumentDriver, DocumentEvent, DocumentModel, DocumentOperation, DocumentOperationResult, DocumentSnapshot } from '../../shared/workbench/document'
import { MarkdownDriver } from '../../core/drivers/MarkdownDriver'
import { CourseV9Driver } from '../../core/drivers/CourseV9Driver'

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
  pending: readonly { operationId: string; status: 'queued' | 'sending' | 'unknown' | 'rejected' | 'blocked' }[]
  error: DocumentProjectionError | null
  connected: boolean
}
interface PendingOperation {
  operationId: string
  mutation: DocumentOperation['mutation']
  status: DocumentProjectionState['pending'][number]['status']
  operation?: DocumentOperation
  historyGroup?: string
  settle(result: DocumentOperationResult): void
  reject(error: Error): void
}

const successful = (result: DocumentOperationResult): result is Extract<DocumentOperationResult, { revision: number }> =>
  result.status === 'applied' || result.status === 'unchanged'

/** One view projection for one main-owned document. Disposing it never closes the document. */
export class DocumentProjection {
  private state: DocumentProjectionState = { committed: null, draft: null, pending: [], error: null, connected: false }
  private readonly listeners = new Set<() => void>()
  private queue: PendingOperation[] = []
  private readonly ownOperations = new Set<string>()
  private stopSubscription?: () => void
  private worker?: Promise<void>
  private previewTail?: Promise<unknown>
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
  private update(patch: Partial<DocumentProjectionState> = {}): void {
    this.state = { ...this.state, ...patch, pending: this.queue.map(({ operationId, status }) => ({ operationId, status })) }
    for (const listener of this.listeners) { try { listener() } catch { /* A view cannot turn an ACK into a failed edit. */ } }
  }
  private problem(error: DocumentProjectionError): void {
    this.update({ error, ...(error.kind === 'disconnected' || error.kind === 'closed' ? { connected: false } : {}) })
  }
  private accept(snapshot: DocumentSnapshot, operationId?: string, attaching = false): void {
    if (snapshot.documentId !== this.documentId) return
    const previous = this.state.committed
    if (previous && !attaching && snapshot.epoch !== previous.epoch) return
    if (previous?.epoch === snapshot.epoch && snapshot.revision < previous.revision) return
    if (previous && !this.ownOperations.has(operationId ?? '')
      && (snapshot.epoch !== previous.epoch || snapshot.revision > previous.revision)) this.externalChanges++
    if (previous?.epoch !== snapshot.epoch) this.observedOwnRevision = snapshot.revision
    if (this.ownOperations.has(operationId ?? '')) this.observedOwnRevision = Math.max(this.observedOwnRevision, snapshot.revision)
    this.update({ committed: structuredClone(snapshot) })
    if (this.queue.length && !attaching && !this.ownOperations.has(operationId ?? '')
      && (snapshot.epoch !== this.expectedEpoch || snapshot.revision > Math.max(this.expectedRevision, this.observedOwnRevision))) {
      this.problem({ kind: 'conflict', code: 'external-change', message: '文档已在其他位置改变；未确认输入已保留，请比较后继续。' })
      this.blockUnsent()
    }
  }
  private onEvent = (event: DocumentEvent): void => {
    if (this.disposed) return
    if (event.type === 'changed') this.accept(event.snapshot, event.operationId)
    else if (event.documentId === this.documentId && event.epoch === this.state.committed?.epoch) {
      this.problem({ kind: 'closed', code: 'document-closed', message: '文档会话已关闭，未确认输入仍保留。' })
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
      if (this.queue.length && (current.epoch !== this.expectedEpoch || current.revision !== this.expectedRevision)) {
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

  edit(command: DocumentCommand, options: { historyGroup?: string } = {}): Promise<DocumentOperationResult> {
    if (this.disposed || !this.state.committed) return Promise.reject(new Error('文档视图尚未连接'))
    if (this.queue.some(entry => entry.mutation.type !== 'command')) return Promise.reject(new Error('请等待撤销或重做完成后继续输入'))
    const frozen = structuredClone(command)
    const historyGroup = options.historyGroup
    if (historyGroup !== undefined && !historyGroup.trim()) return Promise.reject(new Error('历史分组不能为空'))
    return new Promise((resolve, reject) => {
      const prepare = () => {
        const baseline = this.state.committed!
        const base = this.state.draft ?? this.state.committed!.model
        const externalChanges = this.externalChanges
        const driver = this.driver ?? (base.kind === 'markdown' ? new MarkdownDriver() : new CourseV9Driver())
        const projected = driver.apply(structuredClone(base), frozen)
        const enqueue = (draft: DocumentModel) => {
          const conflict = externalChanges !== this.externalChanges
          if (conflict) this.problem({ kind: 'conflict', code: 'external-change',
            message: '输入准备期间文档已改变；未确认输入已保留，未覆盖新版本。' })
          void this.enqueue({ type: 'command', command: frozen }, draft, historyGroup, conflict ? baseline : undefined).then(resolve, reject)
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
          if (!this.state.committed || this.state.committed.epoch !== this.expectedEpoch || this.state.committed.revision < result.revision) {
            this.accept(await this.api.read(this.documentId), entry.operationId)
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
    this.expectedRevision = result.revision
    this.queue.shift()
    entry.settle(result)
    this.update(this.queue.length ? {} : { draft: null, error: null })
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

  async undo(): Promise<DocumentOperationResult> { await this.drain(); return this.enqueue({ type: 'undo' }) }
  async undoLatestAgent(expectedTopOperationId?: string): Promise<DocumentOperationResult> {
    const snapshot = await this.drain()
    if (snapshot.undoHead?.actor !== 'agent' || (expectedTopOperationId && snapshot.undoHead.operationId !== expectedTopOperationId)) {
      throw new Error('最近一次操作不是 AI 修改，请按正常撤销顺序处理')
    }
    return this.enqueue({ type: 'undo', expectedTopOperationId: snapshot.undoHead.operationId }, undefined, undefined, snapshot)
  }
  async redo(): Promise<DocumentOperationResult> { await this.drain(); return this.enqueue({ type: 'redo' }) }
  async drain(): Promise<DocumentSnapshot> {
    for (;;) {
      if (this.previewTail) await this.previewTail
      while (this.worker) await this.worker
      if (this.state.error || this.queue.length || !this.state.committed || !this.state.connected) throw new Error(this.state.error?.message ?? '文档输入尚未确认')
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
    this.update({ draft: null, error: null })
  }
  dispose(): void {
    this.disposed = true
    ++this.attachment
    this.stopSubscription?.()
    this.stopSubscription = undefined
    this.listeners.clear()
  }
}
