import type { DocumentFilePort, DocumentFileRef, DocumentFileVersion, OpenDocumentResult } from '../../shared/document/ports'
import type { DocumentFileObservation, DocumentHostAPI } from '../../shared/workbench/desktop'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import { markdownRefPath, markdownSnapshotDocument } from '../../shared/workbench/markdownFileAdapter'
import { DocumentProjection } from '../documents/DocumentProjection'
import { documentSourceEdits, mergedDocumentSource, planDocumentSourceMerge, type DocumentConflictHunk, type DocumentSourceMerge, type SourceEdit } from './documentSourceMerge'
import { documentRelativePathSchema } from '../../shared/document/resources'

type PendingAttachment = { relativePath: string; bytes: Uint8Array }
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
  error: string | null; conflict: OpenDocumentResult | 'deleted' | null; recovery: boolean
  conflictHunks: DocumentConflictHunk[]
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
  private state: DocumentFileSessionState = { source: '', disk: null, dirty: false, saving: false, composing: false, error: null, conflict: null, recovery: false, conflictHunks: [] }
  private projection?: DocumentProjection
  private stopProjection?: () => void
  private timer?: ReturnType<typeof setTimeout>
  private watchTimer?: ReturnType<typeof setTimeout>
  private watchTask?: Promise<void>
  private watchGeneration = 0
  private pending?: Promise<boolean>
  private savingAs?: Promise<boolean>
  private historyTask?: Promise<void>
  private retainedSubmission?: Promise<void>
  private deferredHistoryInput = false
  private historyConflict = false
  private removedByHistory = new Set<string>()
  private disposed = false
  private initialized = false
  private compositionWaiters: (() => void)[] = []
  private listeners = new Set<() => void>()
  private pendingAttachments = new Map<string, Uint8Array>()
  private conflictPlan: DocumentSourceMerge | null = null
  private observation?: DocumentFileObservation
  private diskSource = ''
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
    if (this.disposed || !current || current.model.kind !== 'markdown') return
    if (current.binding.kind === 'file'
      && markdownRefPath(this.currentRef).replace(/\\/g, '/').toLowerCase() !== current.binding.path.replace(/\\/g, '/').toLowerCase()) {
      this.currentRef = { kind: 'file', path: current.binding.path }
    }
    const shown = view.draft ?? current.model
    if (shown.kind !== 'markdown') return
    const keepInput = this.state.composing || Boolean(this.conflictPlan) || this.deferredHistoryInput
    this.update({ ...(!keepInput ? { source: shown.source } : {}), disk: markdownSnapshotDocument(this.ref, current),
      dirty: current.dirty || Boolean(view.pending.length) || this.pendingAttachments.size > 0 || (keepInput && this.state.source !== current.model.source),
      saving: current.saving || Boolean(this.savingAs) || Boolean(this.pending), ...(view.error ? { error: view.error.message } : {}) })
  }
  async open() {
    const documents = this.documents
    const filename = markdownRefPath(this.ref).replace(/\\/g, '/')
    // Path equality here only finds recovery candidates; the host canonicalizes writer identity.
    const matches = (snapshot: DocumentSnapshot) => snapshot.binding.kind === 'file' && snapshot.binding.path.replace(/\\/g, '/') === filename
    const existing = this.existingDocumentId ? await documents.read(this.existingDocumentId) : (await documents.list()).find(matches)
    const recovery = existing ? undefined : (await documents.recoverable()).find(matches)
    const snapshot = existing ?? (recovery ? await documents.restore(recovery.documentId) : await documents.open(filename))
    const projection = await DocumentProjection.attach(documents, snapshot.documentId)
    if (this.disposed) { projection.dispose(); return }
    this.projection = projection
    this.stopProjection = projection.subscribe(this.project)
    this.project()
    this.initialized = true
    this.update({ recovery: Boolean(recovery) })
    if (snapshot.binding.kind === 'untitled') return
    const observation = await documents.observeFile(snapshot.documentId)
    this.diskSource = snapshot.binding.kind === 'file' && observation.version === snapshot.binding.version && observation.model?.kind === 'markdown' ? observation.model.source : ''
    await this.observe(observation)
    this.poll()
  }
  private poll() {
    if (this.disposed || this.savingAs || this.watchTimer || this.watchTask || !this.projection || this.committedDocument?.binding.kind !== 'file') return
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
    const projection = this.projection
    if (!projection) return Promise.reject(new Error('文档尚未连接'))
    const missing = [...this.removedByHistory].find(path => source.includes(path) && !this.pendingAttachments.has(path))
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
    if (!this.initialized || this.disposed || this.state.conflictHunks.length || source === this.state.source) return
    
    if (historyGroup) {
      if (this.group?.label !== historyGroup || Date.now() - this.lastEdit > 800) this.group = { label: historyGroup, id: crypto.randomUUID() }
    } else this.group = undefined
    this.lastEdit = Date.now()
    this.update({ source, dirty: true, error: null })
    if (this.historyTask) this.deferredHistoryInput = true
    else if (!this.state.composing) this.submitVisible(source, this.group?.id)
    this.schedule()
  }
  prepareAttachments(attachments: PendingAttachment[]) {
    if (this.disposed) throw new Error('文档已关闭')
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
    if (!bytes) throw new Error('当前文档未包含该素材')
    const filename = relativePath.split('/').pop()!, extension = filename.split('.').pop()?.toLowerCase() ?? ''
    const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', woff2: 'font/woff2' }
    return { bytes: new Uint8Array(bytes), filename, mime: types[extension] ?? 'application/octet-stream' }
  }
  setComposing(composing: boolean) {
    this.update({ composing })
    if (composing) clearTimeout(this.timer)
    else {
      if (this.historyTask) this.deferredHistoryInput = true
      else this.submitVisible(this.state.source, this.group?.id)
      for (const resolve of this.compositionWaiters.splice(0)) resolve()
      this.schedule()
    }
  }
  private schedule() {
    clearTimeout(this.timer)
    if (!this.savingAs && this.committedDocument?.binding.kind === 'file' && this.state.dirty && !this.state.composing && !this.state.conflict && !this.state.recovery) this.timer = setTimeout(() => { void this.flush() }, 800)
  }
  /** Confirm pending human input without forcing a file save before an AI task. */
  async drain(skipHistoryTask = false): Promise<boolean> {
    if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
    if (this.disposed || !this.projection) return false
    try {
      if (this.historyTask && !skipHistoryTask) await this.historyTask
      for (;;) {
        if (this.retainedSubmission) await this.retainedSubmission
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
      return !this.state.conflict && !this.state.recovery
    } catch (error) { this.fail(error); return false }
  }
  flush(): Promise<boolean> {
    if (this.savingAs) return this.savingAs
    if (this.pending) return this.pending.then(saved => saved && this.state.dirty ? this.flush() : saved && !this.state.error)
    clearTimeout(this.timer)
    const operation = Promise.resolve().then(async () => {
      if (!await this.drain()) return false
      if (!this.state.dirty) return true
      this.update({ saving: true, error: null })
      try {
        const untitled = this.committedDocument?.binding.kind === 'untitled'
        if (untitled) { if (!await this.documents.saveWithDialog(this.projection!.documentId)) return false }
        else await this.documents.save(this.projection!.documentId)
        if (untitled) this.poll()
        this.project()
        const disk = await this.documents.observeFile(this.projection!.documentId)
        if (disk.model?.kind === 'markdown') this.diskSource = disk.model.source
        this.observation = disk
        this.schedule()
        return true
      } catch (error) {
        this.fail(error)
        try { await this.observe(await this.documents.observeFile(this.projection!.documentId)) } catch { /* Original save error remains visible. */ }
        return false
      }
    }).finally(() => {
      if (this.pending === operation) this.pending = undefined
      if (!this.disposed) this.project()
    })
    this.pending = operation
    return operation
  }
  /** Save the confirmed visible draft at a user-chosen location, even when the
   * old disk binding is unavailable. The host alone changes binding identity. */
  saveAs(): Promise<boolean> {
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
      const saved = await this.documents.saveWithDialog(this.projection!.documentId, true)
      if (!saved) return false
      this.conflictPlan = null
      this.observation = undefined
      this.update({ conflict: null, conflictHunks: [], recovery: false, error: null })
      await this.projection!.drain()
      this.project()
      const disk = await this.documents.observeFile(this.projection!.documentId)
      if (disk.model?.kind === 'markdown') this.diskSource = disk.model.source
      this.observation = disk
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
      let baseSource = startingModel?.kind === 'markdown' ? startingModel.source : this.state.source
      const result = await projection[action]()
      if ('message' in result) throw new Error(result.message)
      if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
      if (this.disposed) return
      while (this.deferredHistoryInput) {
        const current = projection.read().committed?.model
        if (current?.kind !== 'markdown') throw new Error('文档格式已改变，在途输入已保留')
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
  private async observe(observation: DocumentFileObservation, generation = this.watchGeneration) {
    if (this.disposed || this.savingAs || generation !== this.watchGeneration || !this.projection) return
    const current = this.projection.read().committed!
    if (current.binding.kind !== 'file' || observation.bindingVersion !== current.binding.bindingVersion) return
    if (observation.version === current.binding.version) { this.observation = observation; return }
    if (this.observation?.version === observation.version && this.state.conflict) return
    this.observation = observation
    
    if (!observation.model) { this.conflictPlan = null; this.update({ conflict: 'deleted', dirty: true, conflictHunks: [] }); return }
    if (observation.model.kind !== 'markdown') throw new Error('磁盘文件格式已改变')
    await this.projection.drain()
    if (this.disposed || this.savingAs || generation !== this.watchGeneration) return
    const live = this.projection.read().committed!
    if (live.binding.kind !== 'file' || live.binding.bindingVersion !== observation.bindingVersion) return
    if (!live.dirty && !this.state.composing) { await this.reconcile('disk', undefined, observation, generation); return }
    const disk: OpenDocumentResult = { ref: this.ref, source: observation.model.source, version: { contentVersion: observation.version!, attachments: [] }, diagnostics: [] }
    const plan = planDocumentSourceMerge(this.diskSource, this.state.source, disk.source)
    this.conflictPlan = plan
    this.update({ conflict: disk, conflictHunks: plan.conflicts, source: mergedDocumentSource(plan), dirty: true })
    if (!plan.conflicts.length && !this.state.composing) { await this.reconcile('local', mergedDocumentSource(plan), observation, generation); this.schedule() }
  }
  private async reconcile(choice: 'disk' | 'local', source?: string, observation = this.observation, generation?: number) {
    if (!this.projection || !observation) throw new Error('请先重新读取磁盘版本')
    const current = await this.projection.drain()
    if (this.disposed || this.savingAs || (generation !== undefined && generation !== this.watchGeneration)) return
    if (current.binding.kind !== 'file' || current.binding.bindingVersion !== observation.bindingVersion) throw new Error('文件位置已改变，请重新读取')
    await this.documents.reconcileFile({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      bindingVersion: observation.bindingVersion, version: observation.version, choice, ...(source === undefined ? {} : { source }) })
    this.conflictPlan = null
    this.diskSource = observation.model?.kind === 'markdown' ? observation.model.source : ''
    this.update({ conflict: null, conflictHunks: [], recovery: false, error: null })
    await this.projection.drain()
    this.project()
  }
  async resolveConflict(choice: 'disk' | 'local' | 'recovery') {
    if (this.state.conflictHunks.length) return
    try { await this.reconcile(choice === 'disk' ? 'disk' : 'local', choice === 'disk' ? undefined : this.state.source); if (choice !== 'disk') await this.flush() }
    catch (error) { this.fail(error) }
  }
  async resolveConflictHunk(id: string, choice: 'local' | 'remote', customText?: string) {
    const plan = this.conflictPlan, hunk = plan?.conflicts.find(item => item.id === id)
    if (!plan || !hunk || hunk.resolution !== null) return
    hunk.resolution = customText ?? hunk[choice]
    const source = mergedDocumentSource(plan), remaining = plan.conflicts.filter(item => item.resolution === null)
    this.update({ source, conflictHunks: remaining })
    if (!remaining.length) { try { await this.reconcile('local', source); await this.flush() } catch (error) { this.fail(error) } }
  }
  async preserveDraft(): Promise<boolean> {
    if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
    try {
      if (!this.projection) return false
      const visible = this.projection.read().draft ?? this.projection.read().committed!.model
      if (visible.kind === 'markdown' && (visible.source !== this.state.source || this.pendingAttachments.size)) await this.submit(this.state.source)
      await this.projection.drain()
      return true
    } catch (error) { this.fail(error); return false }
  }
  async preserveAndClose(): Promise<boolean> { if (!await this.preserveDraft()) return false; this.dispose(); return true }
  async close(): Promise<boolean> { clearTimeout(this.timer); if (!await this.drain()) return false; try { if (!await this.documents.closeWithDialog(this.projection!.documentId)) return false; this.dispose(); return true } catch (error) { this.fail(error); return false } }
  dispose() { if (this.disposed) return; this.disposed = true; ++this.watchGeneration; clearTimeout(this.timer); clearTimeout(this.watchTimer); this.stopProjection?.(); this.projection?.dispose(); for (const resolve of this.compositionWaiters.splice(0)) resolve(); this.listeners.clear() }
}
