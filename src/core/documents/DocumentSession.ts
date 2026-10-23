import type {
  DocumentBinding, DocumentDriver, DocumentEvent, DocumentModel, DocumentOperation,
  DocumentDispatchOptions, DocumentOperationResult, DocumentPersistence, DocumentSnapshot, DurableDocumentState,
  DocumentSourceChange, DocumentVersionEvent, DocumentAcceptedChange, DocumentSnapshotHead,
} from '../../shared/workbench/document'
import { isSourceDocumentModel } from '../../shared/workbench/document'
import { documentDigest, documentOperationDigest } from './documentDigest'
import { documentEqual } from './documentEqual'
import { applyDocumentAcceptedChange, applyDocumentHistoryEntry, compactDocumentRecovery, createDocumentAcceptedChange, createDocumentModelUpdate, createDocumentStateTransition, documentAcceptedSourceRanges, documentHistorySourceRanges, documentRecoveryModels } from './documentStateEffects'
import { sourceEditsFromChanges, type SourceEdit, type SourceRangeChange } from '../../shared/document/sourceMerge'
import { DocumentSaveFailure, type DocumentSaveIdentity, type DocumentSaveProof } from '../../shared/workbench/documentSave'
import { retainDocumentResourceBytes } from '../drivers/resources'
import { normalizeCourseDocumentModel, normalizeCourseDocumentRecovery } from '../drivers/workProjectRecovery'
import { createWorkProjectMigrationMap, type WorkProjectMigrationMap } from '../../shared/contracts/component-platform/workProjectMigration'
import { checkComponentExpectations, ComponentOperationConflict } from '../drivers/courseV10Operations'

export interface CreateDocumentSession {
  documentId: string
  epoch: string
  model: DocumentModel
  binding: DocumentBinding
  saved?: boolean
  courseProjectMigrationIds?: WorkProjectMigrationMap
}

/** Observes actual captured save revisions; never changes the save acknowledgement. */
export type DocumentSaveProgress =
  | { status: 'saving'; revision: number; binding: DocumentBinding }
  | { status: 'saved'; savedRevision: number; currentRevision: number; binding: DocumentBinding; warnings: string[] }
  | { status: 'failed'; revision: number; binding: DocumentBinding; error: unknown }
export type DocumentSaveObserver = (progress: DocumentSaveProgress) => void

export interface DocumentFileLease {
  read(): DocumentSnapshot
  rebind(binding: DocumentBinding): Promise<DocumentSnapshot>
  acknowledgeSave(proof: DocumentSaveProof): Promise<DocumentSnapshot>
}

function operationDigest(operation: DocumentOperation): string {
  if (!operation.requestDigest) return documentOperationDigest(operation)
  return documentDigest({ documentId: operation.documentId, operationId: operation.operationId,
    actor: operation.actor, runId: operation.runId, requestDigest: operation.requestDigest })
}

/** Models and receipts are immutable inside the Session; only the queue's next containers change. */
function nextState(state: DurableDocumentState): DurableDocumentState {
  return { ...state, schemaVersion: 3, disposition: 'active', past: [...state.past], future: [...state.future],
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
  private readonly operationReceipts: Map<string, DurableDocumentState['operations'][number]>
  /** The accepted command chain may cross its own no-op input receipts, but
   * never History navigation or a different input owner. */
  private historyGroupHead?: string

  private constructor(
    private state: DurableDocumentState,
    private readonly driver: DocumentDriver,
    private readonly persistence: DocumentPersistence,
  ) {
    this.operationReceipts = new Map(state.operations.map(receipt => [receipt.operationId, receipt]))
    const head = state.past.at(-1)?.operationId
    if (head && state.operations.at(-1)?.operationId === head) this.historyGroupHead = head
  }

  private accept(next: DurableDocumentState): void {
    for (let index = this.state.operations.length; index < next.operations.length; index++) {
      const receipt = next.operations[index]!
      this.operationReceipts.set(receipt.operationId, receipt)
    }
    this.state = next
  }

  static async create(input: CreateDocumentSession, driver: DocumentDriver, persistence: DocumentPersistence): Promise<DocumentSession> {
    if (!input.documentId || !input.epoch || input.model.kind !== driver.kind) throw new Error('无效文档身份或 Driver')
    const courseProjectMigrationIds = input.courseProjectMigrationIds ?? (input.model.kind === 'course-v10' && input.model.project.schemaVersion !== 11
      ? createWorkProjectMigrationMap([input.model.project]) : undefined)
    const model = normalizeCourseDocumentModel(input.model, courseProjectMigrationIds)
    driver.validate(model)
    const revision = model.kind === 'course-v9' || model.kind === 'course-v10' ? model.project.revision : 0
    const state: DurableDocumentState = {
      schemaVersion: 3, disposition: 'active', documentId: input.documentId, epoch: input.epoch, sequence: 0,
      revision, savedRevision: input.saved ? revision : null,
      binding: structuredClone(input.binding), model: structuredClone(model),
      ...(courseProjectMigrationIds ? { courseProjectMigrationIds: structuredClone(courseProjectMigrationIds) } : {}),
      past: [], future: [], operations: [], stoppedRuns: [],
    }
    if (input.saved) state.savedModel = state.model
    await persistence.append(state)
    return new DocumentSession(state, driver, persistence)
  }

  static async restore(input: DurableDocumentState, epoch: string, driver: DocumentDriver, persistence: DocumentPersistence): Promise<DocumentSession> {
    if (!epoch || ![1, 2, 3].includes(input.schemaVersion) || input.model.kind !== driver.kind
      || input.schemaVersion === 1 && input.disposition !== undefined
      || input.schemaVersion >= 2 && input.disposition !== 'active') throw new Error('无法恢复文档版本、终态或 Driver')
    const normalized = normalizeCourseDocumentRecovery(input, model => driver.validate(model))
    for (const model of documentRecoveryModels(normalized)) driver.validate(model)
    const state = structuredClone(compactDocumentRecovery(normalized, driver))
    if ((normalized.recoveryDiagnostics?.length ?? 0) > (input.recoveryDiagnostics?.length ?? 0)) {
      if (!persistence.preserveRecovery) throw new Error('历史需要隔离，但持久化服务不能保全原恢复记录；原输入未改动')
      const retained = await persistence.preserveRecovery(input)
      state.recoveryDiagnostics = [...normalized.recoveryDiagnostics!, `原恢复记录已保留：${retained}`]
    }
    state.schemaVersion = 3
    state.disposition = 'active'
    state.epoch = epoch
    state.sequence += 1
    await persistence.append(state)
    const session = new DocumentSession(state, driver, persistence)
    session.recovered = state.savedRevision !== state.revision
    return session
  }

  get documentId(): string { return this.state.documentId }

  /** File-owner read context only; deliberately absent from public snapshots and operation receipts. */
  readCourseProjectMigrationIds(): WorkProjectMigrationMap | undefined {
    return this.state.courseProjectMigrationIds ? structuredClone(this.state.courseProjectMigrationIds) : undefined
  }

  private modelAtRevision(revision: number): DocumentModel | undefined {
    if (revision === this.state.revision) return this.state.model
    const pairs = this.operationPairs(revision - 1)
    const receipt = this.state.operations.find(item => 'revision' in item.result && item.result.revision === revision && pairs.has(item.operationId))
    if (receipt) return pairs.get(receipt.operationId)?.after
    for (const [operationId, pair] of pairs) {
      const operation = this.operationReceipts.get(operationId)
      if (operation && 'beforeRevision' in operation.result && operation.result.beforeRevision === revision) return pair.before
    }
    for (const entry of [...this.state.past, ...this.state.future]) {
      if (entry.revision === revision && entry.after) return entry.after
      if (entry.beforeRevision === revision && entry.before) return entry.before
    }
  }

  readSavedModel(): DocumentModel | undefined {
    const model = this.state.savedModel ?? (this.state.savedRevision !== null ? this.modelAtRevision(this.state.savedRevision) : undefined)
    return model ? structuredClone(model) : undefined
  }

  /** A frozen export can read a retained revision without changing the active document or History. */
  readRevision(revision: number): DocumentSnapshot | undefined {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.state.revision) return
    const model = this.modelAtRevision(revision)
    if (!model) return
    const revisionModel: DocumentModel = model.kind === 'course-v9' ? { ...model, project: { ...model.project, revision } }
      : model.kind === 'course-v10' ? { ...model, project: { ...model.project, revision } } : model
    return structuredClone({ ...this.readIdentity(), revision,
      model: revisionModel,
      dirty: this.state.savedRevision !== revision, saving: false, recoverable: true,
      undoDepth: this.state.past.length, redoDepth: this.state.future.length })
  }

  readSavedSource(): string | undefined {
    const model = this.state.savedModel ?? (this.state.savedRevision !== null ? this.modelAtRevision(this.state.savedRevision) : undefined)
    return model && isSourceDocumentModel(model) ? model.source : undefined
  }

  read(): DocumentSnapshot {
    return structuredClone({
      documentId: this.state.documentId, epoch: this.state.epoch, revision: this.state.revision, sequence: this.state.sequence,
      binding: this.state.binding, model: this.state.model,
      dirty: this.state.savedRevision !== this.state.revision, saving: this.saving,
      saveError: this.saveError, recovered: this.recovered,
      ...(this.state.recoveryDiagnostics ? { recoveryDiagnostics: this.state.recoveryDiagnostics } : {}),
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

  private readHead(): DocumentSnapshotHead {
    return { documentId: this.documentId, epoch: this.state.epoch, revision: this.state.revision, sequence: this.state.sequence,
      binding: structuredClone(this.state.binding), kind: this.state.model.kind,
      ...(this.state.model.kind === 'course-v10' || this.state.model.kind === 'course-v9' ? { projectId: this.state.model.project.id } : {}),
      dirty: this.state.savedRevision !== this.state.revision, saving: this.saving, saveError: this.saveError, recovered: this.recovered,
      ...(this.state.recoveryDiagnostics ? { recoveryDiagnostics: [...this.state.recoveryDiagnostics] } : {}),
      recoverable: true, undoDepth: this.state.past.length, redoDepth: this.state.future.length,
      ...(this.state.past.at(-1) ? { undoHead: { operationId: this.state.past.at(-1)!.operationId, actor: this.state.past.at(-1)!.actor } } : {}) }
  }

  private notifyVersion(): void {
    for (const listener of this.versionListeners) {
      try { listener({ type: 'changed', documentId: this.documentId, epoch: this.state.epoch, revision: this.state.revision }) } catch { /* Durable success cannot become a replay. */ }
    }
  }

  private notifyState(operationId?: string): void {
    this.notifyVersion()
    const head = this.readHead()
    for (const listener of this.listeners) {
      try { listener({ type: 'state', head, ...(operationId ? { operationId } : {}) }) } catch { /* View owns its failure. */ }
    }
  }

  private notify(operationId?: string, appliedChanges?: Extract<DocumentOperationResult, { revision: number }>['appliedChanges'], effect?: DocumentAcceptedChange, baseRevision?: number): void {
    this.notifyVersion()
    const head = this.readHead(), model = this.state.model
    const { kind: _kind, projectId: _projectId, ...facts } = head
    const update = effect && createDocumentModelUpdate(effect)
    for (const listener of this.listeners) {
      // A disconnected/throwing view cannot turn a durable success into a retry.
      let snapshot: DocumentSnapshot | undefined
      try { listener({ type: 'changed', head, get snapshot() { return snapshot ??= structuredClone({ ...facts, model }) },
        ...(update ? { update: { baseRevision: baseRevision ?? (effect?.kind === 'course-v10' ? effect.beforeRevision : head.revision - 1), baseSequence: head.sequence - 1, model: update } } : {}),
        ...(operationId ? { operationId } : {}), ...(appliedChanges ? { appliedChanges } : {}) }) } catch { /* view owns its failure */ }
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

  /** Identity-only reads never clone the document or its resources. */
  readIdentity() {
    return { documentId: this.state.documentId, epoch: this.state.epoch, revision: this.state.revision,
      binding: structuredClone(this.state.binding), kind: this.state.model.kind }
  }

  /** Internal view validation waits for the canonical operation, then reads the same light facts. */
  async drainIdentity() { await this.tail; return this.readIdentity() }

  private persist(next: DurableDocumentState, effect?: DocumentAcceptedChange): Promise<void> {
    if (!this.persistence.appendTransition || next.epoch !== this.state.epoch) return this.persistence.append(next)
    const modelChange = effect ?? (next.model === this.state.model ? undefined
      : createDocumentAcceptedChange(this.state.model, next.model, this.driver.describeChanges?.(this.state.model, next.model)))
    return this.persistence.appendTransition(createDocumentStateTransition(this.state, next, modelChange), next)
  }

  /** Includes host path/ownership failures which occur before a save is captured. */
  reportSaveFailure(error: unknown): void {
    this.saveError = error instanceof Error ? error.message : String(error)
    this.notifyState()
  }

  lookupOperation(operationId: string, digest?: string): DocumentOperationResult | null {
    const known = this.operationReceipts.get(operationId)
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

  execute(request: DocumentOperation, options?: DocumentDispatchOptions & { rebaseComponentExpectations?: boolean }): Promise<DocumentOperationResult> {
    const operation = structuredClone(request)
    const digest = operationDigest(operation)
    const sourceChangeHints = options?.sourceChangeHints && structuredClone(options.sourceChangeHints)
    return this.serial(async () => {
      const id = operation.operationId
      const amendment = operation.mutation.type === 'command' ? operation.mutation.amendHistory : undefined
      if (operation.documentId !== this.state.documentId) return this.reject(id, amendment ? 'conflict' : 'denied', 'wrong-document', '操作不属于此文档')
      const known = this.operationReceipts.get(id)
      let replayDigest = digest
      if (known && !operation.requestDigest && !known.digest.startsWith('op-v2:')) {
        // Legacy direct Session requests and legacy Host-rebased requests used these two exact forms.
        const original = documentDigest(operation)
        replayDigest = original
        if (known.digest !== original && operation.mutation.type === 'command' && operation.mutation.command.type === 'component-platform.apply') {
          replayDigest = documentDigest({ documentId: operation.documentId, operationId: id,
            actor: operation.actor, runId: operation.runId, requestDigest: original })
        }
      }
      const replay = this.lookupOperation(id, replayDigest)
      if (replay) return replay
      if (!id) return this.reject(id, 'denied', 'missing-operation-id', '操作缺少编号')
      if (this.closed || operation.epoch !== this.state.epoch) return this.reject(id, 'conflict', 'stale-epoch', '文档会话已改变，请重新读取')
      const stopIdentity = operation.runLeaseId ?? operation.runId
      if (stopIdentity && this.state.stoppedRuns.includes(stopIdentity)) return this.reject(id, 'cancelled', 'run-stopped', '任务已停止，未写入后续操作')
      if (options?.rebaseComponentExpectations && operation.mutation.type === 'command' && operation.mutation.command.type === 'component-platform.apply'
        && this.state.model.kind === 'course-v10' && operation.baseRevision <= this.state.revision) {
        try { checkComponentExpectations(this.state.model.project, operation.mutation.command) }
        catch (error) {
          if (!(error instanceof ComponentOperationConflict)) throw error
          return this.reject(id, 'conflict', error.code, error.message)
        }
        operation.baseRevision = this.state.revision
      }
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
      let effect: DocumentAcceptedChange | undefined
      let historySourceChanges: SourceRangeChange[] | undefined
      let hintedSourceChanges: SourceRangeChange[] | undefined
      let appliedChanges: Extract<DocumentOperationResult, { revision: number }>['appliedChanges']
      try {
        if (operation.mutation.type === 'undo') {
          if (operation.mutation.expectedTopOperationId) {
            const head = next.past.at(-1)
            if (!head || head.actor !== 'agent' || head.operationId !== operation.mutation.expectedTopOperationId) {
              return this.reject(id, 'conflict', 'history-head-changed', '最近一次操作已改变，请按正常撤销顺序处理')
            }
          }
          const entry = next.past.pop()
          if (entry) { next.future.push(entry); candidate = applyDocumentHistoryEntry(next.model, entry, 'inverse'); historySourceChanges = documentHistorySourceRanges(entry, 'inverse') } else candidate = next.model
        } else if (operation.mutation.type === 'redo') {
          const entry = next.future.pop()
          if (entry) { next.past.push(entry); candidate = applyDocumentHistoryEntry(next.model, entry, 'forward'); historySourceChanges = documentHistorySourceRanges(entry, 'forward') } else candidate = next.model
        } else {
          if (this.driver.applyValidatedWithChanges) {
            const applied = await this.driver.applyValidatedWithChanges(next.model, operation.mutation.command)
            candidate = applied.model; appliedChanges = applied.appliedChanges
          } else if (this.driver.applyValidated) candidate = await this.driver.applyValidated(next.model, operation.mutation.command)
          else {
            candidate = structuredClone(await this.driver.apply(structuredClone(next.model), operation.mutation.command))
            this.driver.validate(candidate)
          }
          candidate = { ...candidate, resources: retainDocumentResourceBytes(candidate.resources, next.model.resources) }
        }
        changed = !documentEqual(candidate, this.state.model)
        if (changed) {
          candidate = this.driver.withRevision(candidate, this.state.revision + 1)
          appliedChanges ??= this.driver.describeChanges?.(this.state.model, candidate)
          const command = operation.mutation.type === 'command' && operation.mutation.command.type === 'markdown.splice' ? operation.mutation.command : undefined
          let hintedEdits: SourceEdit[] | undefined
          if (sourceChangeHints && !operation.textChanges && operation.mutation.type === 'command' && operation.mutation.command.type === 'markdown.replace'
            && isSourceDocumentModel(this.state.model) && isSourceDocumentModel(candidate))
            hintedEdits = sourceEditsFromChanges(this.state.model.source, candidate.source, sourceChangeHints)
          effect = createDocumentAcceptedChange(this.state.model, candidate, appliedChanges, hintedEdits ?? command, historySourceChanges ?? operation.textChanges?.source)
          if (hintedEdits !== undefined) hintedSourceChanges = documentAcceptedSourceRanges(effect, 'forward')
        }
        if (operation.mutation.type === 'command' && changed) {
          const previous = next.past.at(-1)
          if (amendment || (operation.historyGroup && previous?.historyGroup === operation.historyGroup
            && previous.actor === operation.actor && previous.runId === operation.runId
            && previous.operationId === this.historyGroupHead)) {
            // A strict amendment was checked in this serial turn; retain its original before/group.
            // Replace the entry too: a failed append must leave the acknowledged head intact.
            next.past[next.past.length - 1] = { ...previous!, effects: [...previous!.effects!, effect!],
              operationId: id, revision: this.state.revision + 1 }
          } else next.past.push({ operationId: id, actor: operation.actor, beforeRevision: this.state.revision, revision: this.state.revision + 1,
            ...(operation.runId ? { runId: operation.runId } : {}),
            ...(operation.historyGroup ? { historyGroup: operation.historyGroup } : {}),
            effects: [effect!] })
          next.future = []
        }
        if (changed) {
          next.revision += 1
          next.model = candidate
        }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'component-field-conflict') return this.reject(id, 'conflict', error.code, error.message)
        return this.reject(id, 'failed', 'invalid-operation', error instanceof Error ? error.message : '文档操作无效')
      }
      const result: DocumentOperationResult = {
        status: changed ? 'applied' : 'unchanged', documentId: this.state.documentId,
        operationId: id, beforeRevision: this.state.revision, revision: next.revision, persistence: 'recoverable',
        ...(appliedChanges ? { appliedChanges } : {}),
      }
      next.sequence += 1
      const sourceCommand = operation.mutation.type === 'command' && operation.mutation.command.type === 'markdown.splice'
        ? operation.mutation.command : null
      const textChanges = operation.textChanges ?? (historySourceChanges ? { source: historySourceChanges, flow: [] }
        : hintedSourceChanges ? { source: hintedSourceChanges, flow: [] }
        : sourceCommand ? { source: [{ from: sourceCommand.from, to: sourceCommand.to, inserted: sourceCommand.text.length }], flow: [] } : undefined)
      next.operations.push({ operationId: id, digest, result, actor: operation.actor, ...(operation.runId ? { runId: operation.runId } : {}),
        ...(effect ? { effect } : {}), ...(textChanges ? { textChanges: structuredClone(textChanges) } : {}) })
      try { await this.persist(next, effect) }
      catch (error) { return this.reject(id, 'failed', 'recovery-write-failed', error instanceof Error ? error.message : '恢复稿写入失败，修改未提交') }
      const before = this.state.model
      this.accept(next)
      if (operation.mutation.type !== 'command') this.historyGroupHead = undefined
      else if (changed) this.historyGroupHead = id
      else {
        const head = next.past.at(-1)
        if (!operation.historyGroup || head?.historyGroup !== operation.historyGroup
          || head.actor !== operation.actor || head.runId !== operation.runId) this.historyGroupHead = undefined
      }
      if (changed) this.notifyCommit({ operation, result, before, after: next.model })
      if (changed) this.notify(id, result.appliedChanges, effect, result.beforeRevision)
      else this.notifyState(id)
      return structuredClone(result)
    })
  }

  /** Read the existing canonical receipt/history chain; no second undo log or model-derived identity. */
  committedChangesSince(revision: number) {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.state.revision) throw new Error('原文档版本不可定位')
    const pairs = this.operationPairs(revision)
    let next = revision
    let from = 0, to = this.state.operations.length
    while (from < to) {
      const middle = (from + to) >>> 1, result = this.state.operations[middle]!.result
      if (!('revision' in result) || result.revision <= revision) from = middle + 1
      else to = middle
    }
    const changes = this.state.operations.slice(from).flatMap(receipt => {
      const result = receipt.result
      if (result.status !== 'applied' || result.revision <= revision) return []
      if (receipt.historyUnavailable) throw new Error('原修改经过已隔离的历史，无法接续；原恢复记录与操作回执仍保留')
      if (result.beforeRevision !== next) throw new Error('原修改到当前版本之间存在无法定位的历史，请重新选择')
      next = result.revision
      const pair = pairs.get(receipt.operationId)
      const materializedSource: Exclude<DocumentSourceChange, { kind: 'edits' }> | undefined = receipt.sourceChange?.kind === 'edits' || receipt.effect?.kind === 'source'
        ? pair && isSourceDocumentModel(pair.before) && isSourceDocumentModel(pair.after)
          ? pair.before.source === pair.after.source ? { kind: 'unchanged' } : { kind: 'changed', before: pair.before.source, after: pair.after.source }
          : undefined
        : receipt.sourceChange
      const { effect: _effect, ...metadata } = receipt
      return [{ ...metadata, ...pair, sourceChange: materializedSource, result }]
    })
    if (next !== this.state.revision) throw new Error('原修改的历史已改变，请重新选择')
    return structuredClone(changes)
  }

  /** Rebuild source pairs only when a continuation needs them; receipts retain the exact small edits. */
  private operationPairs(sinceRevision = -1): Map<string, { before: DocumentModel; after: DocumentModel }> {
    const pairs = new Map<string, { before: DocumentModel; after: DocumentModel }>()
    const history = new Map([...this.state.past, ...this.state.future].map(entry => [entry.operationId, entry]))
    let current = this.state.model
    for (let index = this.state.operations.length - 1; index >= 0; index--) {
      const receipt = this.state.operations[index]!
      if (receipt.historyUnavailable) break
      if (receipt.result.status !== 'applied') continue
      if (receipt.result.revision <= sinceRevision) break
      let pair: { before: DocumentModel; after: DocumentModel } | undefined
      const source = receipt.sourceChange
      if (receipt.effect) {
        const before = applyDocumentAcceptedChange(current, receipt.effect, 'inverse')
        pair = { before, after: applyDocumentAcceptedChange(before, receipt.effect, 'forward') }
      } else if (source?.kind === 'edits') {
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
        if (entry?.before && entry.after && (entry.beforeRevision === receipt.result.beforeRevision || entry.beforeRevision === undefined && !entry.historyGroup))
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
      if (this.closed) return this.read()
      if (!runId) throw new Error('停止任务缺少编号')
      if (!this.state.stoppedRuns.includes(runId)) {
        const next = nextState(this.state)
        next.stoppedRuns.push(runId)
        next.sequence += 1
        await this.persist(next)
        this.accept(next)
      }
      return this.read()
    })
  }

  /** Main-only disk reconciliation. Binding and content share the durable boundary. */
  reconcileFile(input: { epoch: string; baseRevision: number; bindingVersion: number },
    load: (current: DocumentSnapshot) => Promise<{ model: DocumentModel; version: string | null; matchesDisk: boolean; diskModel?: DocumentModel; courseProjectMigrationIds?: WorkProjectMigrationMap }>): Promise<DocumentSnapshot> {
    const operation = this.saveTail.then(() => this.serial(async () => {
      if (this.closed || this.state.epoch !== input.epoch || this.state.revision !== input.baseRevision) throw new Error('文档已改变，请重新比较当前稿')
      if (this.state.binding.kind !== 'file' || this.state.binding.bindingVersion !== input.bindingVersion) throw new Error('文件位置已改变，请重新读取')
      const loaded = await load(this.read())
      this.driver.validate(loaded.model)
      const next = nextState(this.state)
      if (loaded.courseProjectMigrationIds) next.courseProjectMigrationIds = structuredClone(loaded.courseProjectMigrationIds)
      const candidate = { ...structuredClone(loaded.model), resources: retainDocumentResourceBytes(loaded.model.resources, next.model.resources) }
      const before = this.state.model
      let commit: CommittedDocumentOperation | undefined
      let accepted: DocumentAcceptedChange | undefined
      if (documentDigest(candidate) !== documentDigest(next.model)) {
        const operationId = `disk:${next.documentId}:${next.sequence + 1}`
        const beforeRevision = next.revision
        const diskRevision = candidate.kind === 'course-v9' || candidate.kind === 'course-v10' ? candidate.project.revision : 0
        next.revision = Math.max(beforeRevision + 1, diskRevision)
        next.model = this.driver.withRevision(candidate, next.revision)
        accepted = createDocumentAcceptedChange(this.state.model, next.model, this.driver.describeChanges?.(this.state.model, next.model))
        next.past.push({ operationId, actor: 'external', beforeRevision, revision: next.revision, effects: [accepted] })
        next.future = []
        next.operations.push({ operationId, actor: 'external',
          effect: accepted,
          digest: documentDigest({ operationId, beforeRevision, revision: next.revision, bindingVersion: input.bindingVersion, version: loaded.version }),
          result: { status: 'applied', documentId: next.documentId, operationId, beforeRevision, revision: next.revision, persistence: 'recoverable' } })
        commit = { operation: { documentId: next.documentId, epoch: next.epoch, operationId, baseRevision: beforeRevision,
          actor: 'external', mutation: { type: 'reconcile' } },
          result: { status: 'applied', documentId: next.documentId, operationId, beforeRevision, revision: next.revision, persistence: 'recoverable' }, before, after: next.model }
      }
      next.binding = { ...this.state.binding, version: loaded.version }
      if (loaded.diskModel || loaded.matchesDisk) next.savedModel = structuredClone(loaded.diskModel ?? loaded.model)
      // Rebased course revisions are recoverable drafts until those exact bytes are saved.
      next.savedRevision = loaded.matchesDisk && documentDigest(next.model) === documentDigest(loaded.model) ? next.revision : null
      next.sequence += 1
      await this.persist(next)
      this.accept(next)
      if (commit) this.notifyCommit(commit)
      if (accepted) this.notify(undefined, accepted.kind === 'course-v10' ? accepted.forward : undefined, accepted, input.baseRevision)
      else this.notifyState()
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
            const savedModel = proof.savedModel ?? (this.persistence.prepareSave ? undefined : original)
            if (!savedModel) throw new Error('保存查证缺少实际保存模型，已保留当前稿')
            next.savedModel = structuredClone(savedModel)
            next.model = { ...next.model, resources: next.revision === proof.savedRevision ? next.savedModel.resources
              : original ? capturedResources(next.model, original, next.savedModel) : next.model.resources }
            next.sequence++
            await this.persist(next)
            const beforeModel = this.state.model
            this.accept(next); this.saveError = null
            if (next.savedRevision === next.revision) this.recovered = false
            if (!documentEqual(beforeModel, next.model)) {
              const effect = createDocumentAcceptedChange(beforeModel, next.model, this.driver.describeChanges?.(beforeModel, next.model))
              this.notify(undefined, effect.kind === 'course-v10' ? effect.forward : undefined, effect, next.revision)
            } else this.notifyState()
            return this.read()
          },
          rebind: async binding => {
            assertActive()
            const next = nextState(this.state)
            next.binding = structuredClone(binding)
            if (binding.kind === 'untitled') { next.savedRevision = null; delete next.savedModel }
            next.sequence += 1
            await this.persist(next)
            this.accept(next)
            this.notifyState()
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
        this.notifyState()
        observe({ status: 'saving', revision: snapshot.revision, binding: structuredClone(snapshot.binding) })
        return snapshot
      })
      let persistenceCalled = false
      try {
        const prepared = this.persistence.prepareSave
          ? await this.persistence.prepareSave({ model: captured.model, sourceBinding: sourceBinding!, targetBinding: captured.binding })
          : { model: captured.model }
        captured.model = prepared.model
        const bytes = await this.driver.serialize(captured.model)
        persistenceCalled = true
        const savedBinding = await (this.persistence.savePrepared ?? this.persistence.save).call(this.persistence, { documentId: captured.documentId, revision: captured.revision, model: captured.model, binding: captured.binding, bytes,
          ...(prepared.sourcePublication ? { sourcePublication: prepared.sourcePublication } : {}), ...(saveIdentity ? { saveIdentity } : {}) })
        return await this.serial(async () => {
          const next = nextState(this.state)
          next.binding = structuredClone(savedBinding)
          next.savedRevision = captured.revision
          next.savedModel = captured.model
          if (this.persistence.prepareSave) {
            // Only the Session publishes these captured dependencies. A later edit owns its changed resources.
            if (next.revision === captured.revision) next.model = { ...next.model, resources: captured.model.resources }
            else next.model = { ...next.model, resources: capturedResources(next.model, originalModel!, captured.model) }
          }
          next.sequence += 1
          await this.persist(next)
          const beforeModel = this.state.model
          this.accept(next)
          this.saving = false
          this.saveError = null
          if (next.savedRevision === next.revision) this.recovered = false
          if (!documentEqual(beforeModel, next.model)) {
            const effect = createDocumentAcceptedChange(beforeModel, next.model, this.driver.describeChanges?.(beforeModel, next.model))
            this.notify(undefined, effect.kind === 'course-v10' ? effect.forward : undefined, effect, next.revision)
          } else this.notifyState()
          observe({ status: 'saved', savedRevision: captured.revision, currentRevision: this.state.revision, binding: structuredClone(savedBinding),
            warnings: prepared.sourcePublication?.diagnostics.map(diagnostic => diagnostic.message) ?? [] })
          return this.read()
        })
      } catch (error) {
        error = error instanceof DocumentSaveFailure ? error : new DocumentSaveFailure(persistenceCalled ? 'unknown' : 'not-published', error)
        this.reportSaveFailure(error)
        observe({ status: 'failed', revision: captured.revision, binding: structuredClone(captured.binding), error })
        throw error
      } finally {
        if (this.saving) { this.saving = false; this.notifyState() }
      }
    })
    this.saveTail = save.catch(() => undefined)
    return save
  }

  async close(options: { discardDirty?: boolean; expected?: { epoch: string; revision: number } } = {}): Promise<void> {
    await this.saveTail
    await this.serial(async () => {
      if (this.closed) return
      if (options.expected && (this.state.epoch !== options.expected.epoch || this.state.revision !== options.expected.revision)) throw new Error('确认关闭期间文档又有更改，请检查当前内容后重试')
      if (!options.discardDirty && this.state.savedRevision !== this.state.revision) throw new Error('文档有未保存更改，请保存或明确放弃')
      const disposition = options.discardDirty ? 'discarded' : 'closed'
      const terminal: DurableDocumentState = { ...this.state, schemaVersion: 3, disposition, sequence: this.state.sequence + 1 }
      if (this.persistence.finalize) await this.persistence.finalize(this.state, disposition)
      else await this.persist(terminal)
      this.state = terminal
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

