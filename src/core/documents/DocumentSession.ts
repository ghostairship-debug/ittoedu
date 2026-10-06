import type {
  DocumentBinding, DocumentDriver, DocumentEvent, DocumentModel, DocumentOperation,
  DocumentOperationResult, DocumentPersistence, DocumentSnapshot, DurableDocumentState,
  DocumentSourceChange,
} from '../../shared/workbench/document'
import { isSourceDocumentModel } from '../../shared/workbench/document'
import { documentDigest } from './documentDigest'
import { DocumentSaveFailure, type DocumentSaveIdentity, type DocumentSaveProof } from '../../shared/workbench/documentSave'

export interface CreateDocumentSession {
  documentId: string
  epoch: string
  model: DocumentModel
  binding: DocumentBinding
  saved?: boolean
}

/** Observes actual captured save revisions; never changes the save acknowledgement. */
export type DocumentSaveProgress =
  | { status: 'saving'; revision: number; binding: DocumentBinding }
  | { status: 'saved'; savedRevision: number; currentRevision: number; binding: DocumentBinding }
  | { status: 'failed'; revision: number; binding: DocumentBinding; error: unknown }
export type DocumentSaveObserver = (progress: DocumentSaveProgress) => void

export interface DocumentFileLease {
  read(): DocumentSnapshot
  rebind(binding: DocumentBinding): Promise<DocumentSnapshot>
  acknowledgeSave(proof: DocumentSaveProof): Promise<DocumentSnapshot>
}

function operationDigest(operation: DocumentOperation): string {
  if (!operation.requestDigest) return documentDigest(operation)
  return documentDigest({ documentId: operation.documentId, operationId: operation.operationId,
    actor: operation.actor, runId: operation.runId, requestDigest: operation.requestDigest })
}

function sourceChange(before: DocumentModel, after: DocumentModel): DocumentSourceChange | undefined {
  if (before.kind !== after.kind || !isSourceDocumentModel(before) || !isSourceDocumentModel(after)) return
  return before.source === after.source ? { kind: 'unchanged' } : { kind: 'changed', before: before.source, after: after.source }
}


/** Host-only notification of one durable operation. Never exposed as an IPC write capability. */
export interface CommittedDocumentOperation {
  operation: DocumentOperation
  result: Extract<DocumentOperationResult, { revision: number }>
  before: DocumentModel
  after: DocumentModel
}

/** The only formal content/history writer for one document. No view state lives here. */
export class DocumentSession {
  private tail: Promise<unknown> = Promise.resolve()
  private saveTail: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(event: DocumentEvent) => void>()
  private readonly commitListeners = new Set<(commit: CommittedDocumentOperation) => void>()
  private saving = false
  private saveError: string | null = null
  private recovered = false
  private closed = false

  private constructor(
    private state: DurableDocumentState,
    private readonly driver: DocumentDriver,
    private readonly persistence: DocumentPersistence,
  ) {}

  static async create(input: CreateDocumentSession, driver: DocumentDriver, persistence: DocumentPersistence): Promise<DocumentSession> {
    if (!input.documentId || !input.epoch || input.model.kind !== driver.kind) throw new Error('无效文档身份或 Driver')
    driver.validate(input.model)
    const revision = input.model.kind === 'course-v9' || input.model.kind === 'course-v10' ? input.model.project.revision : 0
    const state: DurableDocumentState = {
      schemaVersion: 1, documentId: input.documentId, epoch: input.epoch, sequence: 0,
      revision, savedRevision: input.saved ? revision : null,
      binding: structuredClone(input.binding), model: structuredClone(input.model),
      past: [], future: [], operations: [], stoppedRuns: [],
    }
    await persistence.append(structuredClone(state))
    return new DocumentSession(state, driver, persistence)
  }

  static async restore(input: DurableDocumentState, epoch: string, driver: DocumentDriver, persistence: DocumentPersistence): Promise<DocumentSession> {
    if (!epoch || input.schemaVersion !== 1 || input.model.kind !== driver.kind) throw new Error('无法恢复文档版本或 Driver')
    driver.validate(input.model)
    for (const entry of [...input.past, ...input.future]) { driver.validate(entry.before); driver.validate(entry.after) }
    const state = structuredClone(input)
    state.epoch = epoch
    state.sequence += 1
    await persistence.append(structuredClone(state))
    const session = new DocumentSession(state, driver, persistence)
    session.recovered = state.savedRevision !== state.revision
    return session
  }

  get documentId(): string { return this.state.documentId }

  read(): DocumentSnapshot {
    return structuredClone({
      documentId: this.state.documentId, epoch: this.state.epoch, revision: this.state.revision,
      binding: this.state.binding, model: this.state.model,
      dirty: this.state.savedRevision !== this.state.revision, saving: this.saving,
      saveError: this.saveError, recovered: this.recovered,
      recoverable: true, undoDepth: this.state.past.length, redoDepth: this.state.future.length,
      ...(this.state.past.at(-1) ? { undoHead: { operationId: this.state.past.at(-1)!.operationId, actor: this.state.past.at(-1)!.actor } } : {}),
    })
  }

  subscribe(listener: (event: DocumentEvent) => void): () => void {
    if (this.closed) throw new Error('文档已关闭')
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  subscribeCommits(listener: (commit: CommittedDocumentOperation) => void): () => void {
    if (this.closed) throw new Error('文档已关闭')
    this.commitListeners.add(listener)
    return () => { this.commitListeners.delete(listener) }
  }

  private notify(operationId?: string, appliedChanges?: Extract<DocumentOperationResult, { revision: number }>['appliedChanges']): void {
    for (const listener of this.listeners) {
      // A disconnected/throwing view cannot turn a durable success into a retry.
      try { listener({ type: 'changed', snapshot: this.read(), ...(operationId ? { operationId } : {}), ...(appliedChanges ? { appliedChanges } : {}) }) } catch { /* view owns its failure */ }
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work)
    this.tail = next.catch(() => undefined)
    return next
  }

  async drain(): Promise<DocumentSnapshot> { await this.tail; return this.read() }

  /** Includes host path/ownership failures which occur before a save is captured. */
  reportSaveFailure(error: unknown): void {
    this.saveError = error instanceof Error ? error.message : String(error)
    this.notify()
  }

  lookupOperation(operationId: string, digest?: string): DocumentOperationResult | null {
    const known = this.state.operations.find(value => value.operationId === operationId)
    if (!known) return null
    if (digest !== undefined && known.digest !== digest) return this.reject(operationId, 'conflict', 'operation-payload-mismatch', '同一操作编号不能提交不同内容')
    return structuredClone(known.result)
  }

  lookupRequest(input: Pick<DocumentOperation, 'documentId' | 'operationId' | 'actor' | 'runId'> & { requestDigest: string }): DocumentOperationResult | null {
    if (input.documentId !== this.documentId) return this.reject(input.operationId, 'denied', 'wrong-document', '操作不属于此文档')
    const digest = documentDigest({ documentId: input.documentId, operationId: input.operationId,
      actor: input.actor, runId: input.runId, requestDigest: input.requestDigest })
    return this.lookupOperation(input.operationId, digest)
  }

  private reject(operationId: string, status: 'conflict' | 'denied' | 'cancelled' | 'failed', code: string, message: string): DocumentOperationResult {
    return { status, documentId: this.state.documentId, operationId, code, message, applied: false }
  }

  execute(request: DocumentOperation): Promise<DocumentOperationResult> {
    const operation = structuredClone(request)
    const digest = operationDigest(operation)
    return this.serial(async () => {
      const id = operation.operationId
      const amendment = operation.mutation.type === 'command' ? operation.mutation.amendHistory : undefined
      if (operation.documentId !== this.state.documentId) return this.reject(id, amendment ? 'conflict' : 'denied', 'wrong-document', '操作不属于此文档')
      const replay = this.lookupOperation(id, digest)
      if (replay) return replay
      if (!id) return this.reject(id, 'denied', 'missing-operation-id', '操作缺少编号')
      if (this.closed || operation.epoch !== this.state.epoch) return this.reject(id, 'conflict', 'stale-epoch', '文档会话已改变，请重新读取')
      if (operation.runId && this.state.stoppedRuns.includes(operation.runId)) return this.reject(id, 'cancelled', 'run-stopped', '任务已停止，未写入后续操作')
      if (operation.baseRevision !== this.state.revision) return this.reject(id, 'conflict', 'stale-revision', '文档已改变，未覆盖当前内容')
      if (amendment) {
        const head = this.state.past.at(-1)
        if (!amendment.expectedTopOperationId || !head || head.operationId !== amendment.expectedTopOperationId) {
          return this.reject(id, 'conflict', 'history-head-changed', '原修改已不在历史顶部，未追加静态结果')
        }
        if (head.actor !== operation.actor || head.runId !== operation.runId) {
          return this.reject(id, 'conflict', 'history-owner-changed', '原修改的作者或任务不匹配，未追加静态结果')
        }
        if (this.state.future.length) return this.reject(id, 'conflict', 'history-redo-present', '存在待重做操作，未追加静态结果')
      }
      const next = structuredClone(this.state)
      let candidate: DocumentModel
      try {
        if (operation.mutation.type === 'undo') {
          if (operation.mutation.expectedTopOperationId) {
            const head = next.past.at(-1)
            if (!head || head.actor !== 'agent' || head.operationId !== operation.mutation.expectedTopOperationId) {
              return this.reject(id, 'conflict', 'history-head-changed', '最近一次操作已改变，请按正常撤销顺序处理')
            }
          }
          const entry = next.past.pop()
          if (entry) { next.future.push(entry); candidate = entry.before } else candidate = next.model
        } else if (operation.mutation.type === 'redo') {
          const entry = next.future.pop()
          if (entry) { next.past.push(entry); candidate = entry.after } else candidate = next.model
        } else {
          candidate = await this.driver.apply(structuredClone(next.model), operation.mutation.command)
          this.driver.validate(candidate)
          if (documentDigest(candidate) !== documentDigest(next.model)) {
            const previous = next.past.at(-1)
            if (amendment || (operation.historyGroup && previous?.historyGroup === operation.historyGroup
              && previous.actor === operation.actor && previous.runId === operation.runId
              && previous.operationId === next.operations.at(-1)?.operationId)) {
              // A strict amendment was checked in this serial turn; retain its original before/group.
              previous!.after = structuredClone(candidate)
              previous!.operationId = id
              previous!.revision = this.state.revision + 1
            } else next.past.push({ operationId: id, actor: operation.actor, beforeRevision: this.state.revision, revision: this.state.revision + 1,
              ...(operation.runId ? { runId: operation.runId } : {}),
              ...(operation.historyGroup ? { historyGroup: operation.historyGroup } : {}),
              before: next.model, after: structuredClone(candidate) })
            next.future = []
          }
        }
        this.driver.validate(candidate)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'component-field-conflict') return this.reject(id, 'conflict', error.code, error.message)
        return this.reject(id, 'failed', 'invalid-operation', error instanceof Error ? error.message : '文档操作无效')
      }
      const changed = documentDigest(candidate) !== documentDigest(this.state.model)
      if (changed) {
        next.revision += 1
        next.model = this.driver.withRevision(candidate, next.revision)
        this.driver.validate(next.model)
      }
      const result: DocumentOperationResult = {
        status: changed ? 'applied' : 'unchanged', documentId: this.state.documentId,
        operationId: id, beforeRevision: this.state.revision, revision: next.revision, persistence: 'recoverable',
        ...(this.driver.describeChanges ? { appliedChanges: this.driver.describeChanges(this.state.model, next.model) } : {}),
      }
      next.sequence += 1
      const sourceCommand = operation.mutation.type === 'command' && operation.mutation.command.type === 'markdown.splice'
        ? operation.mutation.command : null
      const textChanges = operation.textChanges ?? (sourceCommand ? { source: [{ from: sourceCommand.from, to: sourceCommand.to, inserted: sourceCommand.text.length }], flow: [] } : undefined)
      const source = changed ? sourceChange(this.state.model, next.model) : undefined
      next.operations.push({ operationId: id, digest, result, actor: operation.actor, ...(operation.runId ? { runId: operation.runId } : {}),
        ...(textChanges ? { textChanges: structuredClone(textChanges) } : {}), ...(source ? { sourceChange: source } : {}) })
      try { await this.persistence.append(structuredClone(next)) }
      catch (error) { return this.reject(id, 'failed', 'recovery-write-failed', error instanceof Error ? error.message : '恢复稿写入失败，修改未提交') }
      const before = this.state.model
      this.state = next
      if (changed && this.commitListeners.size) {
        // One detached, read-only host event, not a full clone per open card.
        const commit = structuredClone({ operation, result, before, after: next.model })
        for (const listener of this.commitListeners) {
          try { listener(commit) } catch { /* Observer failures never turn a durable success into a replay. */ }
        }
      }
      this.notify(id, result.appliedChanges)
      return structuredClone(result)
    })
  }

  /** Read the existing canonical receipt/history chain; no second undo log or model-derived identity. */
  committedChangesSince(revision: number) {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.state.revision) throw new Error('原文档版本不可定位')
    const entries = new Map([...this.state.past, ...this.state.future].map(entry => [entry.operationId, entry]))
    let next = revision
    const changes = this.state.operations.flatMap(receipt => {
      const result = receipt.result
      if (result.status !== 'applied' || result.revision <= revision) return []
      if (result.beforeRevision !== next) throw new Error('原修改到当前版本之间存在无法定位的历史，请重新选择')
      next = result.revision
      const entry = entries.get(receipt.operationId)
      const pair = entry && (entry.beforeRevision === result.beforeRevision || entry.beforeRevision === undefined && !entry.historyGroup)
        ? { before: entry.before, after: entry.after } : {}
      return [{ ...receipt, ...pair, result }]
    })
    if (next !== this.state.revision) throw new Error('原修改的历史已改变，请重新选择')
    return structuredClone(changes)
  }

  stopRun(runId: string): Promise<DocumentSnapshot> {
    return this.serial(async () => {
      if (!runId) throw new Error('停止任务缺少编号')
      if (!this.state.stoppedRuns.includes(runId)) {
        const next = structuredClone(this.state)
        next.stoppedRuns.push(runId)
        next.sequence += 1
        await this.persistence.append(structuredClone(next))
        this.state = next
      }
      return this.read()
    })
  }

  /** Main-only disk reconciliation. Binding and content share the durable boundary. */
  reconcileFile(input: { epoch: string; baseRevision: number; bindingVersion: number },
    load: (current: DocumentSnapshot) => Promise<{ model: DocumentModel; version: string | null; matchesDisk: boolean }>): Promise<DocumentSnapshot> {
    const operation = this.saveTail.then(() => this.serial(async () => {
      if (this.closed || this.state.epoch !== input.epoch || this.state.revision !== input.baseRevision) throw new Error('文档已改变，请重新比较当前稿')
      if (this.state.binding.kind !== 'file' || this.state.binding.bindingVersion !== input.bindingVersion) throw new Error('文件位置已改变，请重新读取')
      const loaded = await load(this.read())
      this.driver.validate(loaded.model)
      const next = structuredClone(this.state)
      if (documentDigest(loaded.model) !== documentDigest(next.model)) {
        const operationId = `disk:${next.documentId}:${next.sequence + 1}`
        const beforeRevision = next.revision
        next.past.push({ operationId, actor: 'external', beforeRevision, revision: beforeRevision + 1,
          before: next.model, after: structuredClone(loaded.model) })
        next.future = []
        next.revision += 1
        next.model = this.driver.withRevision(loaded.model, next.revision)
        const source = sourceChange(this.state.model, next.model)
        next.operations.push({ operationId, actor: 'external',
          digest: documentDigest({ operationId, beforeRevision, revision: next.revision, bindingVersion: input.bindingVersion, version: loaded.version }),
          result: { status: 'applied', documentId: next.documentId, operationId, beforeRevision, revision: next.revision, persistence: 'recoverable' },
          ...(source ? { sourceChange: source } : {}) })
      }
      next.binding = { ...this.state.binding, version: loaded.version }
      next.savedRevision = loaded.matchesDisk ? next.revision : null
      next.sequence += 1
      await this.persistence.append(structuredClone(next))
      this.state = next
      this.notify()
      return this.read()
    }))
    this.saveTail = operation.catch(() => undefined)
    return operation
  }

  /** FileService holds this barrier across physical movement and binding publication. */
  withFileLease<T>(work: (lease: DocumentFileLease) => Promise<T>): Promise<T> {
    const operation = this.saveTail.then(() => this.serial(async () => {
      if (this.closed) throw new Error('文档已关闭')
      let active = true
      const assertActive = () => { if (!active) throw new Error('文件操作租约已结束') }
      try {
        return await work({
          read: () => { assertActive(); return this.read() },
          acknowledgeSave: async proof => {
            assertActive()
            if (proof.documentId !== this.state.documentId || proof.savedRevision > this.state.revision)
              throw new Error('保存查证对应的版本不属于当前文档')
            if (this.state.savedRevision !== null && this.state.savedRevision > proof.savedRevision) return this.read()
            const binding = this.state.binding
            if (documentDigest(binding) !== documentDigest(proof.sourceBinding)
              && documentDigest(binding) !== documentDigest(proof.binding)) throw new Error('保存后文件绑定已改变，未回退当前绑定')
            const next = structuredClone(this.state)
            next.binding = structuredClone(proof.binding); next.savedRevision = proof.savedRevision; next.sequence++
            await this.persistence.append(structuredClone(next))
            this.state = next; this.saveError = null
            if (next.savedRevision === next.revision) this.recovered = false
            this.notify(); return this.read()
          },
          rebind: async binding => {
            assertActive()
            const next = structuredClone(this.state)
            next.binding = structuredClone(binding)
            if (binding.kind === 'untitled') next.savedRevision = null
            next.sequence += 1
            await this.persistence.append(structuredClone(next))
            this.state = next
            this.notify()
            return this.read()
          },
        })
      } finally { active = false }
    }))
    this.saveTail = operation.catch(() => undefined)
    return operation
  }

  /** Captures r in the queue; disk I/O does not block edits of r+1. */
  save(binding?: DocumentBinding, observer?: DocumentSaveObserver, saveIdentity?: DocumentSaveIdentity): Promise<DocumentSnapshot> {
    const observe = (progress: DocumentSaveProgress) => { try { observer?.(progress) } catch { /* Observation cannot change document persistence. */ } }
    const target = binding ? structuredClone(binding) : undefined
    const save = this.saveTail.then(async () => {
      const captured = await this.serial(async () => {
        if (this.closed) throw new Error('文档已关闭')
        const snapshot = this.read()
        if (target) snapshot.binding = target
        if (snapshot.binding.kind !== 'file') throw new Error('未保存文档需要选择保存路径')
        this.saving = true
        this.saveError = null
        this.notify()
        observe({ status: 'saving', revision: snapshot.revision, binding: structuredClone(snapshot.binding) })
        return snapshot
      })
      let persistenceCalled = false
      try {
        const bytes = await this.driver.serialize(captured.model)
        persistenceCalled = true
        const savedBinding = await this.persistence.save({ documentId: captured.documentId, revision: captured.revision, model: captured.model, binding: captured.binding, bytes, ...(saveIdentity ? { saveIdentity } : {}) })
        return await this.serial(async () => {
          const next = structuredClone(this.state)
          next.binding = savedBinding
          next.savedRevision = captured.revision
          next.sequence += 1
          await this.persistence.append(structuredClone(next))
          this.state = next
          this.saving = false
          this.saveError = null
          if (next.savedRevision === next.revision) this.recovered = false
          this.notify()
          observe({ status: 'saved', savedRevision: captured.revision, currentRevision: this.state.revision, binding: structuredClone(savedBinding) })
          return this.read()
        })
      } catch (error) {
        error = error instanceof DocumentSaveFailure ? error : new DocumentSaveFailure(persistenceCalled ? 'unknown' : 'not-published', error)
        this.reportSaveFailure(error)
        observe({ status: 'failed', revision: captured.revision, binding: structuredClone(captured.binding), error })
        throw error
      } finally {
        if (this.saving) { this.saving = false; this.notify() }
      }
    })
    this.saveTail = save.catch(() => undefined)
    return save
  }

  async close(options: { discardDirty?: boolean; expected?: { epoch: string; revision: number } } = {}): Promise<void> {
    await this.saveTail
    await this.serial(async () => {
      if (options.expected && (this.state.epoch !== options.expected.epoch || this.state.revision !== options.expected.revision)) throw new Error('确认关闭期间文档又有更改，请检查当前内容后重试')
      if (!options.discardDirty && this.state.savedRevision !== this.state.revision) throw new Error('文档有未保存更改，请保存或明确放弃')
      this.closed = true
      for (const listener of this.listeners) {
        try { listener({ type: 'closed', documentId: this.state.documentId, epoch: this.state.epoch }) } catch { /* detached view */ }
      }
      this.listeners.clear()
      this.commitListeners.clear()
    })
  }
}
