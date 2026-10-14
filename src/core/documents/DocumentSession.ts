import type {
  DocumentBinding, DocumentDriver, DocumentEvent, DocumentModel, DocumentOperation,
  DocumentOperationResult, DocumentPersistence, DocumentSnapshot, DurableDocumentState,
  DocumentSourceChange, DocumentVersionEvent, DocumentCommand,
} from '../../shared/workbench/document'
import { isSourceDocumentModel } from '../../shared/workbench/document'
import { documentDigest } from './documentDigest'
import { documentEqual } from './documentEqual'
import { documentSourceEdits } from '../../shared/document/sourceMerge'
import { DocumentSaveFailure, type DocumentSaveIdentity, type DocumentSaveProof } from '../../shared/workbench/documentSave'
import { retainDocumentResourceBytes } from '../drivers/resources'

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

function sourceChange(before: DocumentModel, after: DocumentModel, command?: Extract<DocumentCommand, { type: 'markdown.splice' }>): DocumentSourceChange | undefined {
  if (before.kind !== after.kind || !isSourceDocumentModel(before) || !isSourceDocumentModel(after)) return
  return { kind: 'edits', documentKind: before.kind,
    edits: (command ? [command] : documentSourceEdits(before.source, after.source)).map(edit => ({ from: edit.from, removed: before.source.slice(edit.from, edit.to), text: edit.text })),
    beforeResources: before.resources, afterResources: after.resources }
}

/** Models and receipts are immutable inside the Session; only the queue's next containers change. */
function nextState(state: DurableDocumentState): DurableDocumentState {
  return { ...state, past: [...state.past], future: [...state.future],
    operations: [...state.operations], stoppedRuns: [...state.stoppedRuns] }
}

function capturedResources(current: DocumentModel, original: DocumentModel, captured: DocumentModel) {
  const resources = { assets: { ...current.resources.assets }, components: { ...current.resources.components } }
  for (const [key, bytes] of Object.entries(captured.resources.assets))
    if (resources.assets[key] === original.resources.assets[key]) resources.assets[key] = bytes
  for (const [key, files] of Object.entries(captured.resources.components)) {
    const published = { ...resources.components[key] }
    for (const [filename, bytes] of Object.entries(files))
      if (published[filename] === original.resources.components[key]?.[filename]) published[filename] = bytes
    resources.components[key] = published
  }
  return resources
}


/** Host-only notification of one durable operation. Never exposed as an IPC write capability. */
export interface CommittedDocumentOperation {
  operation: DocumentOperation | (Omit<DocumentOperation, 'mutation'> & { mutation: { type: 'reconcile' } })
  result: Extract<DocumentOperationResult, { revision: number }>
  before: DocumentModel
  after: DocumentModel
}

/** The only formal content/history writer for one document. No view state lives here. */
export class DocumentSession {
  private tail: Promise<unknown> = Promise.resolve()
  private saveTail: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(event: DocumentEvent) => void>()
  private versionListeners = new Set<(event: DocumentVersionEvent) => void>()
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
    if (input.saved) state.savedModel = state.model
    await persistence.append(structuredClone(state))
    return new DocumentSession(state, driver, persistence)
  }

  static async restore(input: DurableDocumentState, epoch: string, driver: DocumentDriver, persistence: DocumentPersistence): Promise<DocumentSession> {
    if (!epoch || input.schemaVersion !== 1 || input.model.kind !== driver.kind) throw new Error('无法恢复文档版本或 Driver')
    const models = new Set([input.model, ...(input.savedModel ? [input.savedModel] : []), ...[...input.past, ...input.future].flatMap(entry => [entry.before, entry.after])])
    for (const model of models) driver.validate(model)
    const state = structuredClone(input)
    state.epoch = epoch
    state.sequence += 1
    await persistence.append(structuredClone(state))
    const session = new DocumentSession(state, driver, persistence)
    session.recovered = state.savedRevision !== state.revision
    return session
  }

  get documentId(): string { return this.state.documentId }

  private modelAtRevision(revision: number): DocumentModel | undefined {
    if (revision === this.state.revision) return this.state.model
    const pairs = this.operationPairs()
    const receipt = this.state.operations.find(item => 'revision' in item.result && item.result.revision === revision && pairs.has(item.operationId))
    if (receipt) return pairs.get(receipt.operationId)?.after
    for (const entry of [...this.state.past, ...this.state.future]) {
      if (entry.revision === revision) return entry.after
      if (entry.beforeRevision === revision) return entry.before
    }
  }

  readSavedModel(): DocumentModel | undefined {
    const model = this.state.savedModel ?? (this.state.savedRevision !== null ? this.modelAtRevision(this.state.savedRevision) : undefined)
    return model ? structuredClone(model) : undefined
  }

  readSavedSource(): string | undefined {
    const model = this.state.savedModel ?? (this.state.savedRevision !== null ? this.modelAtRevision(this.state.savedRevision) : undefined)
    return model && isSourceDocumentModel(model) ? model.source : undefined
  }

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

  subscribeVersion(listener: (event: DocumentVersionEvent) => void): () => void {
    if (this.closed) throw new Error('文档已关闭')
    this.versionListeners.add(listener)
    return () => { this.versionListeners.delete(listener) }
  }

  private notify(operationId?: string, appliedChanges?: Extract<DocumentOperationResult, { revision: number }>['appliedChanges']): void {
    for (const listener of this.versionListeners) {
      try { listener({ type: 'changed', documentId: this.documentId, epoch: this.state.epoch, revision: this.state.revision }) } catch { /* Durable success cannot become a replay. */ }
    }
    for (const listener of this.listeners) {
      // A disconnected/throwing view cannot turn a durable success into a retry.
      try { listener({ type: 'changed', snapshot: this.read(), ...(operationId ? { operationId } : {}), ...(appliedChanges ? { appliedChanges } : {}) }) } catch { /* view owns its failure */ }
    }
  }

  private notifyCommit(commit: CommittedDocumentOperation): void {
    if (!this.commitListeners.size) return
    const detached = structuredClone(commit)
    for (const listener of this.commitListeners) {
      try { listener(detached) } catch { /* Durable success cannot become a replay. */ }
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
      const stopIdentity = operation.runLeaseId ?? operation.runId
      if (stopIdentity && this.state.stoppedRuns.includes(stopIdentity)) return this.reject(id, 'cancelled', 'run-stopped', '任务已停止，未写入后续操作')
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
      const next = nextState(this.state)
      let candidate: DocumentModel
      let changed: boolean
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
          if (this.driver.applyValidated) candidate = await this.driver.applyValidated(next.model, operation.mutation.command)
          else {
            candidate = structuredClone(await this.driver.apply(structuredClone(next.model), operation.mutation.command))
            this.driver.validate(candidate)
          }
          candidate = { ...candidate, resources: retainDocumentResourceBytes(candidate.resources, next.model.resources) }
        }
        changed = !documentEqual(candidate, this.state.model)
        if (operation.mutation.type === 'command' && changed) {
          const previous = next.past.at(-1)
          if (amendment || (operation.historyGroup && previous?.historyGroup === operation.historyGroup
            && previous.actor === operation.actor && previous.runId === operation.runId
            && previous.operationId === next.operations.at(-1)?.operationId)) {
            // A strict amendment was checked in this serial turn; retain its original before/group.
            // Replace the entry too: a failed append must leave the acknowledged head intact.
            next.past[next.past.length - 1] = { ...previous!, after: candidate,
              operationId: id, revision: this.state.revision + 1 }
          } else next.past.push({ operationId: id, actor: operation.actor, beforeRevision: this.state.revision, revision: this.state.revision + 1,
            ...(operation.runId ? { runId: operation.runId } : {}),
            ...(operation.historyGroup ? { historyGroup: operation.historyGroup } : {}),
            before: next.model, after: candidate })
          next.future = []
        }
        if (changed) {
          next.revision += 1
          next.model = this.driver.withRevision(candidate, next.revision)
        }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'component-field-conflict') return this.reject(id, 'conflict', error.code, error.message)
        return this.reject(id, 'failed', 'invalid-operation', error instanceof Error ? error.message : '文档操作无效')
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
      const source = changed ? sourceChange(this.state.model, next.model, sourceCommand ?? undefined) : undefined
      next.operations.push({ operationId: id, digest, result, actor: operation.actor, ...(operation.runId ? { runId: operation.runId } : {}),
        ...(changed && source?.kind !== 'edits' ? { before: this.state.model, after: next.model } : {}),
        ...(textChanges ? { textChanges: structuredClone(textChanges) } : {}), ...(source ? { sourceChange: source } : {}) })
      try { await this.persistence.append(structuredClone(next)) }
      catch (error) { return this.reject(id, 'failed', 'recovery-write-failed', error instanceof Error ? error.message : '恢复稿写入失败，修改未提交') }
      const before = this.state.model
      this.state = next
      if (changed) this.notifyCommit({ operation, result, before, after: next.model })
      this.notify(id, result.appliedChanges)
      return structuredClone(result)
    })
  }

  /** Read the existing canonical receipt/history chain; no second undo log or model-derived identity. */
  committedChangesSince(revision: number) {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.state.revision) throw new Error('原文档版本不可定位')
    const pairs = this.operationPairs()
    let next = revision
    const changes = this.state.operations.flatMap(receipt => {
      const result = receipt.result
      if (result.status !== 'applied' || result.revision <= revision) return []
      if (result.beforeRevision !== next) throw new Error('原修改到当前版本之间存在无法定位的历史，请重新选择')
      next = result.revision
      const pair = pairs.get(receipt.operationId)
      const materializedSource: Exclude<DocumentSourceChange, { kind: 'edits' }> | undefined = receipt.sourceChange?.kind === 'edits'
        ? pair && isSourceDocumentModel(pair.before) && isSourceDocumentModel(pair.after)
          ? pair.before.source === pair.after.source ? { kind: 'unchanged' } : { kind: 'changed', before: pair.before.source, after: pair.after.source }
          : undefined
        : receipt.sourceChange
      return [{ ...receipt, ...pair, sourceChange: materializedSource, result }]
    })
    if (next !== this.state.revision) throw new Error('原修改的历史已改变，请重新选择')
    return structuredClone(changes)
  }

  /** Rebuild source pairs only when a continuation needs them; receipts retain the exact small edits. */
  private operationPairs(): Map<string, { before: DocumentModel; after: DocumentModel }> {
    const pairs = new Map<string, { before: DocumentModel; after: DocumentModel }>()
    const history = new Map([...this.state.past, ...this.state.future].map(entry => [entry.operationId, entry]))
    let current = this.state.model
    for (const receipt of [...this.state.operations].reverse()) {
      if (receipt.result.status !== 'applied') continue
      let pair: { before: DocumentModel; after: DocumentModel } | undefined
      const source = receipt.sourceChange
      if (source?.kind === 'edits') {
        if (!isSourceDocumentModel(current) || current.kind !== source.documentKind) throw new Error('源文回执类型与当前文档不一致')
        let prior = current.source, offset = 0
        const edits = source.edits.map(edit => { const at = edit.from + offset; offset += edit.text.length - edit.removed.length; return { ...edit, at } })
        for (const edit of edits.reverse()) {
          if (prior.slice(edit.at, edit.at + edit.text.length) !== edit.text) throw new Error('源文回执无法还原当前版本')
          prior = prior.slice(0, edit.at) + edit.removed + prior.slice(edit.at + edit.text.length)
        }
        pair = { before: { kind: source.documentKind, source: prior, resources: source.beforeResources },
          after: { kind: source.documentKind, source: current.source, resources: source.afterResources } }
      } else if (receipt.before && receipt.after) pair = { before: receipt.before, after: receipt.after }
      else {
        const entry = history.get(receipt.operationId)
        if (entry && (entry.beforeRevision === receipt.result.beforeRevision || entry.beforeRevision === undefined && !entry.historyGroup))
          pair = { before: entry.before, after: entry.after }
        else if (source?.kind === 'changed' && isSourceDocumentModel(current)) pair = {
          before: { ...current, source: source.before }, after: { ...current, source: source.after },
        }
      }
      if (pair) { pairs.set(receipt.operationId, pair); current = pair.before }
    }
    return pairs
  }

  stopRun(runId: string): Promise<DocumentSnapshot> {
    return this.serial(async () => {
      if (!runId) throw new Error('停止任务缺少编号')
      if (!this.state.stoppedRuns.includes(runId)) {
        const next = nextState(this.state)
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
    load: (current: DocumentSnapshot) => Promise<{ model: DocumentModel; version: string | null; matchesDisk: boolean; diskModel?: DocumentModel }>): Promise<DocumentSnapshot> {
    const operation = this.saveTail.then(() => this.serial(async () => {
      if (this.closed || this.state.epoch !== input.epoch || this.state.revision !== input.baseRevision) throw new Error('文档已改变，请重新比较当前稿')
      if (this.state.binding.kind !== 'file' || this.state.binding.bindingVersion !== input.bindingVersion) throw new Error('文件位置已改变，请重新读取')
      const loaded = await load(this.read())
      this.driver.validate(loaded.model)
      const next = nextState(this.state)
      const candidate = { ...structuredClone(loaded.model), resources: retainDocumentResourceBytes(loaded.model.resources, next.model.resources) }
      const before = this.state.model
      let commit: CommittedDocumentOperation | undefined
      if (documentDigest(candidate) !== documentDigest(next.model)) {
        const operationId = `disk:${next.documentId}:${next.sequence + 1}`
        const beforeRevision = next.revision
        const diskRevision = candidate.kind === 'course-v9' || candidate.kind === 'course-v10' ? candidate.project.revision : 0
        next.revision = Math.max(beforeRevision + 1, diskRevision)
        next.model = this.driver.withRevision(candidate, next.revision)
        next.past.push({ operationId, actor: 'external', beforeRevision, revision: next.revision,
          before: this.state.model, after: next.model })
        next.future = []
        const source = sourceChange(this.state.model, next.model)
        next.operations.push({ operationId, actor: 'external',
          ...(source?.kind !== 'edits' ? { before: this.state.model, after: next.model } : {}),
          digest: documentDigest({ operationId, beforeRevision, revision: next.revision, bindingVersion: input.bindingVersion, version: loaded.version }),
          result: { status: 'applied', documentId: next.documentId, operationId, beforeRevision, revision: next.revision, persistence: 'recoverable' },
          ...(source ? { sourceChange: source } : {}) })
        commit = { operation: { documentId: next.documentId, epoch: next.epoch, operationId, baseRevision: beforeRevision,
          actor: 'external', mutation: { type: 'reconcile' } },
          result: { status: 'applied', documentId: next.documentId, operationId, beforeRevision, revision: next.revision, persistence: 'recoverable' }, before, after: next.model }
      }
      next.binding = { ...this.state.binding, version: loaded.version }
      if (loaded.diskModel || loaded.matchesDisk) next.savedModel = structuredClone(loaded.diskModel ?? loaded.model)
      // Rebased course revisions are recoverable drafts until those exact bytes are saved.
      next.savedRevision = loaded.matchesDisk && documentDigest(next.model) === documentDigest(loaded.model) ? next.revision : null
      next.sequence += 1
      await this.persistence.append(structuredClone(next))
      this.state = next
      if (commit) this.notifyCommit(commit)
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
            const next = nextState(this.state)
            next.binding = structuredClone(proof.binding); next.savedRevision = proof.savedRevision
            const original = this.modelAtRevision(proof.savedRevision)
            const savedModel = proof.savedModel ?? (this.persistence.prepareSaveModel ? undefined : original)
            if (!savedModel) throw new Error('保存查证缺少实际保存模型，已保留当前稿')
            next.savedModel = structuredClone(savedModel)
            next.model = { ...next.model, resources: next.revision === proof.savedRevision ? next.savedModel.resources
              : original ? capturedResources(next.model, original, next.savedModel) : next.model.resources }
            next.sequence++
            await this.persistence.append(structuredClone(next))
            this.state = next; this.saveError = null
            if (next.savedRevision === next.revision) this.recovered = false
            this.notify(); return this.read()
          },
          rebind: async binding => {
            assertActive()
            const next = nextState(this.state)
            next.binding = structuredClone(binding)
            if (binding.kind === 'untitled') { next.savedRevision = null; delete next.savedModel }
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
      let sourceBinding: DocumentBinding
      let originalModel: DocumentModel
      const captured = await this.serial(async () => {
        if (this.closed) throw new Error('文档已关闭')
        sourceBinding = structuredClone(this.state.binding)
        originalModel = this.state.model
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
        if (this.persistence.prepareSaveModel) captured.model = await this.persistence.prepareSaveModel({ model: captured.model, sourceBinding: sourceBinding!, targetBinding: captured.binding })
        const bytes = await this.driver.serialize(captured.model)
        persistenceCalled = true
        const savedBinding = await this.persistence.save({ documentId: captured.documentId, revision: captured.revision, model: captured.model, binding: captured.binding, bytes, ...(saveIdentity ? { saveIdentity } : {}) })
        return await this.serial(async () => {
          const next = nextState(this.state)
          next.binding = structuredClone(savedBinding)
          next.savedRevision = captured.revision
          next.savedModel = captured.model
          if (this.persistence.prepareSaveModel) {
            // Only the Session publishes these captured dependencies. A later edit owns its changed resources.
            if (next.revision === captured.revision) next.model = { ...next.model, resources: captured.model.resources }
            else next.model = { ...next.model, resources: capturedResources(next.model, originalModel!, captured.model) }
          }
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
      for (const listener of this.versionListeners) {
        try { listener({ type: 'closed', documentId: this.documentId }) } catch { /* detached observer */ }
      }
      this.versionListeners.clear()
      this.commitListeners.clear()
    })
  }
}
