import type { DocumentFilePort, DocumentFileRef, DocumentFileVersion, OpenDocumentResult } from '../../shared/document/ports'
import type { DocumentFileObservation, DocumentHostAPI } from '../../shared/workbench/desktop'
import { isSourceDocumentModel, type DocumentSnapshot } from '../../shared/workbench/document'
import { TextDriver } from '../../core/drivers/TextDriver'
import { markdownRefPath, markdownSnapshotDocument } from '../../shared/workbench/markdownFileAdapter'
import { DocumentProjection } from '../documents/DocumentProjection'
import { documentSourceEdits, mergedDocumentSource, planDocumentSourceMerge, type DocumentConflictHunk, type DocumentSourceMerge, type SourceEdit } from './documentSourceMerge'
import { documentRelativePathSchema } from '../../shared/document/resources'
import { markdownResourceReferences } from '../../shared/document/markdownResourceReferences'
import { fileResourceMime } from '../../shared/document/fileResourceMime'

type PendingAttachment = { relativePath: string; bytes: Uint8Array }
type SourceCandidate = { revision: number; localSource: string; source?: string }
let sessionEpoch = Date.now()
export interface RecoverableDocumentFilePort extends DocumentFilePort {
  /** Required by the production editor. Missing host is an error, never a local writer fallback. */
  documents?: DocumentHostAPI
  readRecovery?(ref: DocumentFileRef): Promise<{ source: string; expectedVersion: DocumentFileVersion | null; baseSource?: string; attachments?: PendingAttachment[] } | null>
  preserveDraft?(ref: DocumentFileRef, source: string, expectedVersion: DocumentFileVersion | null, attachments?: PendingAttachment[]): Promise<void>
  readResource?(ref: DocumentFileRef, relativePath: string): Promise<{ bytes: Uint8Array; mime: string; filename: string }>
}
export interface DocumentFileSessionState {
  source: string; disk: OpenDocumentResult | null; dirty: boolean; saving: boolean; composing: boolean
  autoSave: boolean
  error: string | null; conflict: OpenDocumentResult | 'deleted' | null; recovery: boolean
  conflictHunks: DocumentConflictHunk[]
  conflictDrafts: Record<string, string>
}
export function mergeDocumentSources(base: string, local: string, remote: string): string | null {
  const plan = planDocumentSourceMerge(base, local, remote)
  return plan.conflicts.length ? null : mergedDocumentSource(plan)
}

/** Apply only teacher edits made while History was in flight to its confirmed result. */
function rebaseHistorySource(base: string, local: string, confirmed: string): string | null {
  const teacher = documentSourceEdits(base, local)
  const history = documentSourceEdits(base, confirmed)
  const conflicts = (a: SourceEdit, b: SourceEdit) => {
    if (a.from === a.to) return b.from === b.to ? a.from === b.from : a.from > b.from && a.from < b.to
    if (b.from === b.to) return b.from >= a.from && b.from <= a.to
    return a.from < b.to && b.from < a.to
  }
  if (teacher.some(edit => history.some(change => conflicts(edit, change)))) return null
  const mapped = teacher.map(edit => {
    const shift = history.filter(change => change.to <= edit.from).reduce((sum, change) => sum + change.text.length - (change.to - change.from), 0)
    return { from: edit.from + shift, to: edit.to + shift, text: edit.text }
  })
  let result = confirmed
  for (const edit of mapped.reverse()) result = result.slice(0, edit.from) + edit.text + result.slice(edit.to)
  return result
}

/** View adapter only: canonical source, resources, receipt and History live in main. */
export class DocumentFileSession {
  readonly epoch = ++sessionEpoch
  private state: DocumentFileSessionState = { source: '', disk: null, dirty: false, saving: false, composing: false, autoSave: false, error: null, conflict: null, recovery: false, conflictHunks: [], conflictDrafts: {} }
  private projection?: DocumentProjection
  private stopProjection?: () => void
  private timer?: ReturnType<typeof setTimeout>
  private watchTimer?: ReturnType<typeof setTimeout>
  private watchTask?: Promise<void>
  private watchGeneration = 0
  private pending?: Promise<boolean>
  private savingAs?: Promise<boolean>
  private historyTask?: Promise<void>
  private compositionResume?: Promise<void>
  private retainedSubmission?: Promise<void>
  private deferredHistoryInput = false
  private historyConflict = false
  private removedByHistory = new Set<string>()
  private disposed = false
  private closeSuspended = false
  private initialized = false
  private compositionWaiters: (() => void)[] = []
  private listeners = new Set<() => void>()
  private pendingAttachments = new Map<string, Uint8Array>()
  private conflictPlan: DocumentSourceMerge | null = null
  private observation?: DocumentFileObservation
  private diskSource: string | undefined
  private localSource = ''
  private conflictCandidate: SourceCandidate | null = null
  private conflictDraftTail: Promise<void> = Promise.resolve()
  private deferredObservation?: DocumentFileObservation
  private saveCapture?: { documentId: string; epoch: string; revision: number; source: string }
  private hostSaving = false
  private lastEdit = 0
  private group?: { label: string; id: string }
  constructor(private currentRef: DocumentFileRef, private readonly port: RecoverableDocumentFilePort, private readonly existingDocumentId?: string) {}
  /** A task already holding a ref stays frozen; new tasks follow the host's current binding. */
  get ref(): DocumentFileRef { return this.currentRef }
  get documentId(): string | undefined { return this.projection?.documentId }
  get committedDocument(): DocumentSnapshot | undefined { return this.projection?.read().committed ?? undefined }
  private get documents(): DocumentHostAPI { if (!this.port.documents) throw new Error('主进程文档服务尚未连接'); return this.port.documents }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<DocumentFileSessionState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  private fail(error: unknown) { if (!this.disposed) this.update({ error: error instanceof Error ? error.message : String(error) }) }
  private project = () => {
    const view = this.projection?.read(), current = view?.committed
    if (this.disposed || !current || !isSourceDocumentModel(current.model)) return
    if (current.binding.kind === 'file'
      && markdownRefPath(this.currentRef).replace(/\\/g, '/').toLowerCase() !== current.binding.path.replace(/\\/g, '/').toLowerCase()) {
      this.currentRef = { kind: 'file', path: current.binding.path }
    }
    const shown = view.draft ?? current.model
    if (!isSourceDocumentModel(shown)) return
    // Main publishes saving=true in the same serialized step that freezes the save model.
    const finishedHostSave = this.hostSaving && !current.saving
    if (current.saving && !this.hostSaving) {
      this.saveCapture = { documentId: current.documentId, epoch: current.epoch, revision: current.revision, source: current.model.source }
      ++this.watchGeneration; clearTimeout(this.watchTimer); this.watchTimer = undefined
    }
    this.hostSaving = current.saving
    const keepInput = this.closeSuspended || this.state.composing || Boolean(this.conflictPlan) || this.deferredHistoryInput
    if (!keepInput) this.localSource = shown.source
    const disk = current.model.kind === 'markdown' ? markdownSnapshotDocument(this.ref, current)
      : { ref: this.ref, source: current.model.source, version: { contentVersion: String(current.revision), attachments: [] }, diagnostics: [] }
    this.update({ ...(!keepInput ? { source: shown.source } : {}), disk,
      dirty: current.dirty || Boolean(view.pending.length) || this.pendingAttachments.size > 0 || (keepInput && this.state.source !== current.model.source),
      saving: current.saving || Boolean(this.savingAs) || Boolean(this.pending), ...(view.error ? { error: view.error.message } : {}) })
    if (finishedHostSave) {
      if (!current.saveError) this.receiveSavedSource(current)
      this.poll()
    }
  }
  async open() {
    const documents = this.documents
    const filename = markdownRefPath(this.ref).replace(/\\/g, '/')
    // Path equality here only finds recovery candidates; the host canonicalizes writer identity.
    const matches = (snapshot: DocumentSnapshot) => snapshot.binding.kind === 'file' && snapshot.binding.path.replace(/\\/g, '/') === filename
    const existing = this.existingDocumentId ? await documents.read(this.existingDocumentId) : (await documents.list()).find(matches)
    const recovery = existing ? undefined : (await documents.recoverable()).find(matches)
    const snapshot = existing ?? (recovery ? await documents.restore(recovery.documentId) : await documents.open(filename))
    const projection = await DocumentProjection.attach(documents, snapshot.documentId, snapshot.model.kind === 'text' ? new TextDriver() : undefined)
    if (this.disposed) { projection.dispose(); return }
    this.projection = projection
    this.stopProjection = projection.subscribe(this.project)
    this.project()
    this.initialized = true
    this.update({ recovery: Boolean(recovery) })
    const auxiliary = await documents.readAuthoringDrafts(snapshot.documentId)
    if (auxiliary?.sourceConflict) this.update({ conflictDrafts: Object.fromEntries(auxiliary.sourceConflict.hunks.map(hunk => [hunk.id, hunk.text])), recovery: true })
    if (snapshot.binding.kind === 'untitled') return
    const observation = await documents.observeFile(snapshot.documentId)
    this.diskSource = observation.baseSource ?? (snapshot.binding.kind === 'file' && observation.version === snapshot.binding.version && observation.model && isSourceDocumentModel(observation.model) ? observation.model.source : undefined)
    await this.observe(observation)
    this.poll()
  }
  private poll() {
    if (this.disposed || this.closeSuspended || this.savingAs || this.pending || this.hostSaving || this.watchTimer || this.watchTask || !this.projection || this.committedDocument?.binding.kind !== 'file') return
    const generation = this.watchGeneration
    this.watchTimer = setTimeout(async () => {
      this.watchTimer = undefined
      if (generation !== this.watchGeneration || this.disposed || this.savingAs || !this.projection) return
      const task = (async () => {
        try { await this.observe(await this.documents.observeFile(this.projection!.documentId), generation) }
        catch (error) { if (generation === this.watchGeneration && !this.savingAs) this.fail(error) }
      })()
      this.watchTask = task
      void task.finally(() => {
        if (this.watchTask === task) this.watchTask = undefined
        if (generation === this.watchGeneration) this.poll()
      })
    }, 1000)
  }
  private submit(source: string, historyGroup?: string): Promise<unknown> {
    if (this.disposed || this.closeSuspended) return Promise.reject(new Error('文档输入已停止'))
    const projection = this.projection
    if (!projection) return Promise.reject(new Error('文档尚未连接'))
    const references = this.removedByHistory.size ? markdownResourceReferences(source) : []
    const missing = [...this.removedByHistory].find(path => references.includes(path) && !this.pendingAttachments.has(path))
    if (missing) return Promise.reject(new Error(`撤销已移除素材 ${missing}，请移除对应引用或重新添加素材后继续`))
    const view = projection.read(), model = view.draft ?? view.committed!.model
    const resources = structuredClone(model.resources)
    const attachments = [...this.pendingAttachments]
    for (const [relative, bytes] of attachments) resources.assets[relative] = new Uint8Array(bytes)
    const result = projection.edit({ type: 'markdown.replace', source, resources }, { historyGroup })
    return result.then(receipt => {
      if ('message' in receipt) throw new Error(receipt.message)
      for (const [relative, bytes] of attachments) if (this.pendingAttachments.get(relative) === bytes) this.pendingAttachments.delete(relative)
      if (this.removedByHistory.size) this.removedByHistory.clear()
      this.historyConflict = false
      this.project()
      return receipt
    })
  }
  private submitVisible(source: string, historyGroup?: string): void {
    if (this.disposed || this.closeSuspended) return
    const request = this.submit(source, historyGroup)
    if (this.deferredHistoryInput) {
      const retained = request.then(() => {
        if (this.state.source === source) { this.deferredHistoryInput = false; this.project() }
      })
      const tracked = retained.finally(() => { if (this.retainedSubmission === tracked) this.retainedSubmission = undefined })
      this.retainedSubmission = tracked
      void this.retainedSubmission.catch(error => this.fail(error))
    } else void request.catch(error => this.fail(error))
  }
  edit(source: string, historyGroup?: string) {
    if (!this.initialized || this.disposed || this.closeSuspended || this.state.conflictHunks.length || source === this.state.source) return

    if (historyGroup) {
      if (this.group?.label !== historyGroup || Date.now() - this.lastEdit > 800) this.group = { label: historyGroup, id: crypto.randomUUID() }
    } else this.group = undefined
    this.lastEdit = Date.now()
    this.localSource = source
    this.update({ source, dirty: true, error: null })
    if (this.historyTask) this.deferredHistoryInput = true
    else if (!this.state.composing) this.submitVisible(source, this.group?.id)
    this.schedule()
  }
  prepareAttachments(attachments: PendingAttachment[]) {
    if (this.disposed || this.closeSuspended) throw new Error('文档输入已停止')
    const model = this.projection?.read().draft ?? this.projection?.read().committed?.model
    for (const attachment of attachments) {
      documentRelativePathSchema.parse(attachment.relativePath)
      const existing = model?.resources.assets[attachment.relativePath]
      if (existing && (existing.length !== attachment.bytes.length || existing.some((value, index) => value !== attachment.bytes[index]))) throw new Error('附件路径已被其他内容使用')
      this.pendingAttachments.set(attachment.relativePath, new Uint8Array(attachment.bytes))
    }
    if (this.historyTask) this.deferredHistoryInput = true
    this.update({ dirty: true })
  }
  async readResource(relativePath: string) {
    documentRelativePathSchema.parse(relativePath)
    const model = this.projection?.read().draft ?? this.projection?.read().committed?.model
    let bytes = this.pendingAttachments.get(relativePath) ?? model?.resources.assets[relativePath]
    if (!bytes && model) for (const [directory, files] of Object.entries(model.resources.components)) if (relativePath.startsWith(`${directory}/`)) bytes = files[relativePath.slice(directory.length + 1)]
    if (!bytes && this.port.readResource) {
      try { return await this.port.readResource(this.ref, relativePath) }
      catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error }
    }
    if (!bytes) throw new Error('当前文档未包含该素材')
    const filename = relativePath.split('/').pop()!
    return { bytes: new Uint8Array(bytes), filename, mime: fileResourceMime(filename) }
  }
  setComposing(composing: boolean) {
    if (this.disposed) return
    if (this.closeSuspended && composing) return
    this.update({ composing })
    if (composing) clearTimeout(this.timer)
    else {
      if (!this.closeSuspended) {
        if (this.historyTask) this.deferredHistoryInput = true
        else this.submitVisible(this.localSource, this.group?.id)
      }
      for (const resolve of this.compositionWaiters.splice(0)) resolve()
      if (this.observation && !this.closeSuspended) {
        const observation = this.observation
        const resume = this.projection!.drain().then(() => this.observe(observation)).catch(error => this.fail(error))
        this.compositionResume = resume
        void resume.finally(() => { if (this.compositionResume === resume) this.compositionResume = undefined })
      }
      this.schedule()
    }
  }
  private schedule() {
    clearTimeout(this.timer)
    if (this.disposed || this.closeSuspended || !this.state.autoSave) return
    if (!this.savingAs && this.committedDocument?.binding.kind === 'file' && this.state.dirty && !this.state.composing && !this.state.conflict && !this.state.recovery) this.timer = setTimeout(() => { if (this.state.autoSave && !this.closeSuspended && this.committedDocument?.binding.kind === 'file') void this.flush() }, 800)
  }
  setAutoSave(autoSave: boolean) {
    if (this.disposed || this.closeSuspended) return
    this.update({ autoSave })
    this.schedule()
  }
  /** Stop new renderer input before Main confirms discard; do not submit or save the draft. */
  suspendForClose() {
    if (this.disposed || this.closeSuspended) return
    this.closeSuspended = true
    this.projection?.suspendForClose()
    ++this.watchGeneration
    clearTimeout(this.timer); clearTimeout(this.watchTimer)
    this.watchTimer = undefined
    for (const resolve of this.compositionWaiters.splice(0)) resolve()
  }
  resumeAfterCloseCancelled() {
    if (this.disposed || !this.closeSuspended) return
    this.closeSuspended = false
    this.projection?.resumeAfterCloseCancelled()
    if (!this.state.composing && !this.state.conflictHunks.length) {
      if (this.historyTask) this.deferredHistoryInput = true
      else this.submitVisible(this.state.source, this.group?.id)
    }
    this.poll(); this.schedule()
  }
  /** Confirm pending human input without forcing a file save before an AI task. */
  async drain(skipHistoryTask = false): Promise<boolean> {
    if (this.disposed || this.closeSuspended) return false
    if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
    if (this.disposed || this.closeSuspended || !this.projection) return false
    try {
      if (this.historyTask && !skipHistoryTask) await this.historyTask
      if (this.compositionResume) await this.compositionResume
      for (;;) {
        if (this.retainedSubmission) await this.retainedSubmission
        if (this.disposed || this.closeSuspended) return false
        if (this.deferredHistoryInput) {
          if (!skipHistoryTask || this.historyConflict) throw new Error('撤销未确认，在途输入已保留，请确认后继续')
          const source = this.state.source
          this.deferredHistoryInput = false
          try { await this.submit(source, this.group?.id) }
          catch (error) { this.deferredHistoryInput = true; throw error }
        } else if (this.pendingAttachments.size) await this.submit(this.state.source, this.group?.id)
        await this.projection.drain()
        if (!skipHistoryTask || !this.deferredHistoryInput) break
      }
      this.project()
      return !this.disposed && !this.closeSuspended && !this.state.conflict && !this.state.recovery
    } catch (error) { this.fail(error); return false }
  }
  flush(): Promise<boolean> {
    if (this.disposed || this.closeSuspended) return Promise.resolve(false)
    if (this.savingAs) return this.savingAs
    if (this.pending) return this.pending.then(saved => saved && this.state.dirty ? this.flush() : saved && !this.state.error)
    clearTimeout(this.timer)
    clearTimeout(this.watchTimer); this.watchTimer = undefined
    ++this.watchGeneration
    const priorWatch = this.watchTask
    const operation = Promise.resolve().then(async () => {
      if (priorWatch) await priorWatch
      if (!await this.drain()) return false
      if (!this.state.dirty) return true
      this.update({ saving: true, error: null })
      try {
        this.saveCapture = undefined
        const untitled = this.committedDocument?.binding.kind === 'untitled'
        const saved = untitled ? await this.documents.saveWithDialog(this.projection!.documentId) : await this.documents.save(this.projection!.documentId)
        if (!saved) return false
        this.receiveSavedSource(saved)
        if (untitled) this.poll()
        this.project()
        const disk = await this.documents.observeFile(this.projection!.documentId)
        await this.observe(disk)
        this.schedule()
        return true
      } catch (error) {
        this.fail(error)
        try { await this.observe(await this.documents.observeFile(this.projection!.documentId)) } catch { /* Original save error remains visible. */ }
        return false
      }
    }).finally(() => {
      if (this.pending === operation) this.pending = undefined
      if (!this.disposed) { this.project(); this.poll() }
    })
    this.pending = operation
    return operation
  }
  /** Save the confirmed visible draft at a user-chosen location, even when the
   * old disk binding is unavailable. The host alone changes binding identity. */
  saveAs(): Promise<boolean> {
    if (this.disposed || this.closeSuspended) return Promise.resolve(false)
    if (this.savingAs) return this.savingAs
    if (this.state.conflictHunks.length) {
      this.fail(new Error('请先完成每处冲突选择，再另存当前稿。'))
      return Promise.resolve(false)
    }
    clearTimeout(this.timer); clearTimeout(this.watchTimer)
    this.watchTimer = undefined
    ++this.watchGeneration
    const priorWatch = this.watchTask
    const operation = Promise.resolve().then(async () => {
      if (priorWatch) await priorWatch
      if (this.pending) await this.pending
      if (this.disposed || !await this.preserveDraft()) return false
      this.saveCapture = undefined
      const saved = await this.documents.saveWithDialog(this.projection!.documentId, true)
      if (!saved) return false
      this.receiveSavedSource(saved)
      this.conflictPlan = null
      this.conflictCandidate = null
      this.observation = undefined
      this.update({ conflict: null, conflictHunks: [], recovery: false, error: null })
      await this.projection!.drain()
      this.project()
      const disk = await this.documents.observeFile(this.projection!.documentId)
      if (saved.binding.kind === 'file' && disk.version === saved.binding.version) {
        if (disk.model && isSourceDocumentModel(disk.model)) this.diskSource = disk.model.source
        this.observation = disk
      }
      return true
    }).catch(error => { this.fail(error); return false }).finally(() => {
      this.savingAs = undefined
      if (!this.disposed) { this.update({ saving: false }); this.poll(); this.schedule() }
    })
    this.savingAs = operation
    this.update({ saving: true })
    return operation
  }
  private async navigateHistory(action: 'undo' | 'undoLatestAgent' | 'redo') {
    if (this.disposed || this.closeSuspended) return
    if (this.historyTask) return this.historyTask
    const task = this.performHistory(action)
    this.historyTask = task
    try { await task }
    finally { if (this.historyTask === task) this.historyTask = undefined }
  }
  private async performHistory(action: 'undo' | 'undoLatestAgent' | 'redo') {
    try {
      if (!await this.drain(true)) return
      const projection = this.projection!
      const startingModel = projection.read().committed?.model
      let baseSource = startingModel && isSourceDocumentModel(startingModel) ? startingModel.source : this.state.source
      const result = await projection[action]()
      if ('message' in result) throw new Error(result.message)
      if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
      if (this.disposed || this.closeSuspended) return
      while (this.deferredHistoryInput) {
        const current = projection.read().committed?.model
        if (!current || !isSourceDocumentModel(current)) throw new Error('文档格式已改变，在途输入已保留')
        const source = rebaseHistorySource(baseSource, this.state.source, current.source)
        if (source === null) {
          this.historyConflict = true
          if (startingModel?.kind === 'markdown') this.removedByHistory = new Set(Object.keys(startingModel.resources.assets).filter(path => !current.resources.assets[path]))
          throw new Error('撤销与在途输入发生重叠；草稿已保留，请检查后继续编辑')
        }
        this.update({ source })
        this.deferredHistoryInput = false
        try { await this.submit(source, this.group?.id); baseSource = source }
        catch (error) { this.deferredHistoryInput = true; throw error }
      }
      this.project(); this.schedule()
    } catch (error) { this.fail(error) }
  }
  undo() { return this.navigateHistory('undo') }
  undoLatestAgent() { return this.navigateHistory('undoLatestAgent') }
  redo() { return this.navigateHistory('redo') }
  private receiveSavedSource(saved: DocumentSnapshot) {
    if (!isSourceDocumentModel(saved.model)) return
    const capture = this.saveCapture
    if (!saved.dirty) this.diskSource = saved.model.source
    else if (capture?.documentId === saved.documentId && capture.epoch === saved.epoch) this.diskSource = capture.source
    this.observation = undefined
  }
  private showMerge(local: SourceCandidate, observation: DocumentFileObservation) {
    if (!observation.model || !isSourceDocumentModel(observation.model)) throw new Error('磁盘文件格式已改变')
    const disk: OpenDocumentResult = { ref: this.ref, source: observation.model.source, version: { contentVersion: observation.version!, attachments: [] }, diagnostics: [] }
    const plan = planDocumentSourceMerge(this.diskSource!, local.localSource, disk.source)
    this.conflictPlan = plan
    this.conflictCandidate = local
    this.update({ conflict: disk, conflictHunks: plan.conflicts, source: mergedDocumentSource(plan), dirty: true })
    return plan
  }
  private async observe(observation: DocumentFileObservation, generation = this.watchGeneration) {
    if (this.disposed || this.closeSuspended || this.savingAs || generation !== this.watchGeneration || !this.projection) return
    const current = this.projection.read().committed!
    // A disk publication preceding its own ACK is still owned by this save.
    if (current.saving) return
    if (current.binding.kind !== 'file' || observation.bindingVersion !== current.binding.bindingVersion) return
    if (observation.version === current.binding.version) {
      if (observation.model && isSourceDocumentModel(observation.model)) this.diskSource = observation.model.source
      this.observation = observation; return
    }
    if (this.conflictPlan && Object.keys(this.state.conflictDrafts).length) { this.deferredObservation = observation; return }
    if (this.observation?.version === observation.version && this.state.conflict) return
    this.observation = observation

    if (!observation.model) { this.conflictPlan = null; this.update({ conflict: 'deleted', dirty: true, conflictHunks: [] }); return }
    if (!isSourceDocumentModel(observation.model) || observation.model.kind !== current.model.kind) throw new Error('磁盘文件格式已改变')
    if (this.state.composing) return // Reconcile the final IME source, never a partial buffer.
    const live = await this.projection.drain()
    if (this.disposed || this.closeSuspended || this.savingAs || generation !== this.watchGeneration) return
    if (live.binding.kind !== 'file' || live.binding.bindingVersion !== observation.bindingVersion) return
    if (!isSourceDocumentModel(live.model)) throw new Error('文档格式已改变')
    const candidate = { revision: live.revision, localSource: this.state.composing ? this.localSource : live.model.source }
    if (!live.dirty && !this.state.composing) { await this.reconcile('disk', candidate, observation, generation); return }
    if (this.diskSource === undefined) {
      this.conflictCandidate = candidate
      this.update({ conflict: { ref: this.ref, source: observation.model.source, version: { contentVersion: observation.version!, attachments: [] }, diagnostics: [] },
        conflictHunks: [], error: '无法取得原保存基线；当前稿和磁盘稿均已保留，请比较完整正文后选择。', dirty: true })
      return
    }
    const plan = this.showMerge(candidate, observation)
    if (!plan.conflicts.length && !this.state.composing) { await this.reconcile('local', { ...candidate, source: mergedDocumentSource(plan) }, observation, generation); this.schedule() }
  }
  private async reconcile(choice: 'disk' | 'local', candidate: SourceCandidate, observation = this.observation, generation?: number): Promise<boolean> {
    if (!this.projection || !observation) throw new Error('请先重新读取磁盘版本')
    const current = await this.projection.drain()
    if (this.disposed || this.closeSuspended || this.savingAs || (generation !== undefined && generation !== this.watchGeneration)) return false
    if (current.binding.kind !== 'file' || current.binding.bindingVersion !== observation.bindingVersion) throw new Error('文件位置已改变，请重新读取')
    if (!isSourceDocumentModel(current.model)) throw new Error('文档格式已改变')
    let source = candidate.source
    if (current.revision !== candidate.revision) {
      const selected = choice === 'disk' && observation.model && isSourceDocumentModel(observation.model) ? observation.model.source : source
      const rebased = selected === undefined ? null : rebaseHistorySource(candidate.localSource, current.model.source, selected)
      if (rebased === null) {
        const plan = this.showMerge({ revision: current.revision, localSource: current.model.source }, observation)
        if (plan.conflicts.length) return false
        source = mergedDocumentSource(plan)
      } else source = rebased
      choice = 'local'
    }
    await this.documents.reconcileFile({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      bindingVersion: observation.bindingVersion, version: observation.version, choice, ...(source === undefined ? {} : { source }) })
    this.conflictPlan = null
    this.conflictCandidate = null
    this.diskSource = observation.model && isSourceDocumentModel(observation.model) ? observation.model.source : ''
    this.update({ conflict: null, conflictHunks: [], recovery: false, error: null })
    await this.projection.drain()
    this.project()
    return true
  }
  async resolveConflict(choice: 'disk' | 'local' | 'recovery') {
    if (this.state.conflictHunks.length) return
    const current = this.projection?.read().committed
    if (!current || !isSourceDocumentModel(current.model)) return
    const candidate = this.conflictCandidate ?? { revision: current.revision, localSource: current.model.source }
    try { if (await this.reconcile(choice === 'disk' ? 'disk' : 'local', { ...candidate, ...(choice === 'disk' ? {} : { source: this.state.source }) }) && choice !== 'disk') await this.flush() }
    catch (error) { this.fail(error) }
  }
  async resolveConflictHunk(id: string, choice: 'local' | 'remote', customText?: string) {
    const plan = this.conflictPlan, hunk = plan?.conflicts.find(item => item.id === id)
    if (!plan || !hunk || hunk.resolution !== null) return
    hunk.resolution = customText ?? hunk[choice]
    const conflictDrafts = { ...this.state.conflictDrafts }; delete conflictDrafts[id]
    const source = mergedDocumentSource(plan), remaining = plan.conflicts.filter(item => item.resolution === null)
    this.update({ source, conflictHunks: remaining, conflictDrafts })
    try {
      await this.submit(source)
      const confirmed = await this.projection!.drain()
      this.conflictCandidate = { revision: confirmed.revision, localSource: source }
      await this.persistConflictDrafts()
    } catch (error) { this.fail(error); return }
    if (!remaining.length && this.deferredObservation) {
      const observation = this.deferredObservation; this.deferredObservation = undefined
      this.conflictPlan = null; this.conflictCandidate = null
      this.update({ conflict: null, conflictHunks: [] })
      await this.observe(observation)
      return
    }
    if (!remaining.length && this.conflictCandidate) { try { if (await this.reconcile('local', { ...this.conflictCandidate, source })) await this.flush() } catch (error) { this.fail(error) } }
  }
  setConflictDraft(id: string, text: string): void {
    this.update({ conflictDrafts: { ...this.state.conflictDrafts, [id]: text }, dirty: true })
    void this.persistConflictDrafts().catch(error => this.fail(error))
  }
  removeConflictDraft(id: string): void {
    const conflictDrafts = { ...this.state.conflictDrafts }; delete conflictDrafts[id]
    this.update({ conflictDrafts })
    void this.persistConflictDrafts().catch(error => this.fail(error))
  }
  private persistConflictDrafts(): Promise<void> {
    const current = this.committedDocument
    if (!current) return Promise.resolve()
    const drafts = Object.entries(this.state.conflictDrafts).map(([id, text]) => ({ id, text }))
    const input = { advanced: [], properties: [], ...(drafts.length ? { sourceConflict: {
      documentId: current.documentId, epoch: current.epoch, source: this.state.source, diskVersion: this.observation?.version ?? null, hunks: drafts,
    } } : {}) }
    const write = this.conflictDraftTail.then(() => this.documents.writeAuthoringDrafts(current.documentId, input))
    this.conflictDraftTail = write.catch(() => undefined)
    return write
  }
  async preserveDraft(): Promise<boolean> {
    if (this.disposed || this.closeSuspended) return false
    if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
    try {
      if (this.disposed || this.closeSuspended || !this.projection) return false
      await this.conflictDraftTail
      const visible = this.projection.read().draft ?? this.projection.read().committed!.model
      if (isSourceDocumentModel(visible) && (visible.source !== this.state.source || (visible.kind === 'markdown' && this.pendingAttachments.size))) await this.submit(this.state.source)
      await this.projection.drain()
      return true
    } catch (error) { this.fail(error); return false }
  }
  /** Explicit escape from a failed local draft; Main still confirms, stops writers and checks final CAS. */
  async discardAndClose(): Promise<boolean> {
    if (!this.projection || this.disposed) return false
    this.suspendForClose()
    try {
      if (!await this.documents.closeWithDialog(this.projection.documentId, undefined, true)) { this.resumeAfterCloseCancelled(); return false }
      this.dispose()
      return true
    } catch (error) { this.resumeAfterCloseCancelled(); this.fail(error); return false }
  }
  async preserveAndClose(): Promise<boolean> { if (!await this.preserveDraft()) return false; this.dispose(); return true }
  async close(): Promise<boolean> { clearTimeout(this.timer); if (!await this.drain()) return false; try { if (!await this.documents.closeWithDialog(this.projection!.documentId)) return false; this.dispose(); return true } catch (error) { this.fail(error); return false } }
  dispose() { if (this.disposed) return; this.disposed = true; ++this.watchGeneration; clearTimeout(this.timer); clearTimeout(this.watchTimer); this.stopProjection?.(); this.projection?.dispose(); for (const resolve of this.compositionWaiters.splice(0)) resolve(); this.listeners.clear() }
}
