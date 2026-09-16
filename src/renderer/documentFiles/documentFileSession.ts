import type { DocumentAiEditRecord, DocumentEditRange, DocumentFilePort, DocumentFileRef, DocumentFileVersion, OpenDocumentResult } from '../../shared/document/ports'
import { mergedDocumentSource, planDocumentSourceMerge, type DocumentConflictHunk, type DocumentSourceMerge } from './documentSourceMerge'
import { documentRelativePathSchema } from '../../shared/document/resources'
type PendingAttachment = { relativePath: string; bytes: Uint8Array }

export interface RecoverableDocumentFilePort extends DocumentFilePort {
  readAiRecords?(ref: DocumentFileRef): Promise<DocumentAiEditRecord[]>
  clearAiRecords?(ref: DocumentFileRef, ids: string[]): Promise<void>
  readRecovery?(ref: DocumentFileRef): Promise<{ source: string; expectedVersion: DocumentFileVersion | null; baseSource?: string; attachments?: PendingAttachment[] } | null>
  preserveDraft?(ref: DocumentFileRef, source: string, expectedVersion: DocumentFileVersion | null, attachments?: PendingAttachment[]): Promise<void>
  invalidateAiEdits?(ref: DocumentFileRef): Promise<void>
  readResource?(ref: DocumentFileRef, relativePath: string): Promise<{ bytes: Uint8Array; mime: string; filename: string }>
}
export interface DocumentFileSessionState {
  source: string; disk: OpenDocumentResult | null; dirty: boolean; saving: boolean; composing: boolean
  error: string | null; conflict: OpenDocumentResult | 'deleted' | null; recovery: boolean
  aiRecords: DocumentAiEditRecord[]; aiMessage: string | null
  aiSuggestions: { id: string; edit: DocumentEditRange; baseSource: string }[]
  conflictHunks: DocumentConflictHunk[]
}
/** Nonoverlapping edits on both sides merge; overlapping alternatives stay explicit. */
export function mergeDocumentSources(base: string, local: string, remote: string): string | null {
  const plan = planDocumentSourceMerge(base, local, remote)
  return plan.conflicts.length ? null : mergedDocumentSource(plan)
}

export class DocumentFileSession {
  private state: DocumentFileSessionState = { source: '', disk: null, dirty: false, saving: false, composing: false, error: null, conflict: null, recovery: false, aiRecords: [], aiMessage: null, conflictHunks: [], aiSuggestions: [] }
  private aiTaskStops = new Set<() => Promise<void>>()
  private aiBaselines = new Map<number, string>()
  registerAiTaskStop(stop: () => Promise<void>) { this.aiTaskStops.add(stop); return () => { this.aiTaskStops.delete(stop) } }
  private conflictPlan: DocumentSourceMerge | null = null
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopWatch: (() => void) | undefined
  private pending: Promise<boolean> | undefined
  private compositionWaiters: (() => void)[] = []
  private disposed = false
  private initialized = false
  private undoStack: string[] = []
  private redoStack: string[] = []
  private historyGroup: string | undefined
  private lastEdit = 0
  private pendingAttachments = new Map<string, Uint8Array>()
  private attachmentSnapshot() { return [...this.pendingAttachments].map(([relativePath, bytes]) => ({ relativePath, bytes })) }
  constructor(readonly ref: DocumentFileRef, private port: RecoverableDocumentFilePort) {}
  getSnapshot = () => this.state
  setAiMessage(message: string) { if (!this.disposed) this.update({ aiMessage: message }) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<DocumentFileSessionState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  async open() {
    const disk = await this.port.openDocument(this.ref)
    const recovery = await this.port.readRecovery?.(this.ref)
    const aiRecords = await this.port.readAiRecords?.(this.ref) ?? []
    if (this.disposed) return
    this.update({ aiRecords })
    const hasRecovery = recovery && (recovery.source !== disk.source || Boolean(recovery.attachments?.length))
    if (hasRecovery) for (const attachment of recovery.attachments ?? []) this.pendingAttachments.set(attachment.relativePath, attachment.bytes)
    this.update({ disk, source: hasRecovery ? recovery.source : disk.source, dirty: Boolean(hasRecovery), recovery: Boolean(hasRecovery), conflict: hasRecovery && JSON.stringify(recovery.expectedVersion) !== JSON.stringify(disk.version) ? disk : null })
    if (hasRecovery && this.state.conflict && recovery.baseSource !== undefined) {
      const plan = planDocumentSourceMerge(recovery.baseSource, recovery.source, disk.source)
      this.conflictPlan = plan.conflicts.length ? plan : null
      this.update({ source: mergedDocumentSource(plan), conflictHunks: plan.conflicts, conflict: plan.conflicts.length ? disk : null })
    }
    this.initialized = true
    this.stopWatch = this.port.watchDocument(this.ref, event => this.observe(event.type === 'deleted' ? null : event.disk))
  }
  edit(source: string, historyGroup?: string) {
    if (!this.initialized || this.disposed || this.state.conflictHunks.length) return
    if (source === this.state.source) return
    if (!historyGroup || historyGroup !== this.historyGroup || Date.now() - this.lastEdit > 800) this.undoStack.push(this.state.source)
    this.historyGroup = historyGroup
    this.lastEdit = Date.now()
    this.redoStack = []
    this.update({ source, dirty: source !== this.state.disk?.source || this.pendingAttachments.size > 0, error: null })
    if (this.port.preserveDraft) void this.port.preserveDraft(this.ref, source, this.state.disk?.version ?? null, this.attachmentSnapshot()).catch(error => { if (!this.disposed) this.update({ error: `恢复稿保存失败：${(error as Error).message}` }) })
    this.schedule()
  }
  prepareAttachments(attachments: PendingAttachment[]) {
    if (this.disposed) throw new Error('文档已经关闭')
    for (const attachment of attachments) { documentRelativePathSchema.parse(attachment.relativePath); this.pendingAttachments.set(attachment.relativePath, new Uint8Array(attachment.bytes)) }
    this.update({ dirty: true })
  }
  async readResource(relativePath: string) {
    const bytes = this.pendingAttachments.get(relativePath)
    if (bytes) {
      const filename = relativePath.split('/').pop() ?? relativePath
      const extension = filename.split('.').pop()?.toLowerCase() ?? ''
      const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', woff2: 'font/woff2' }
      return { bytes: new Uint8Array(bytes), filename, mime: types[extension] ?? 'application/octet-stream' }
    }
    if (!this.port.readResource) throw new Error('文件素材读取尚未连接')
    return this.port.readResource(this.ref, relativePath)
  }
  setComposing(composing: boolean) {
    this.update({ composing })
    if (composing) clearTimeout(this.timer)
    else { for (const resolve of this.compositionWaiters.splice(0)) resolve(); this.schedule() }
  }
  private schedule() {
    clearTimeout(this.timer)
    if (this.state.dirty && !this.state.composing && !this.state.conflict && !this.state.recovery) this.timer = setTimeout(() => { void this.flush() }, 800)
  }
  private observe(disk: OpenDocumentResult | null) {
    if (this.disposed) return
    if (!disk) { this.conflictPlan = null; this.update({ conflict: 'deleted', dirty: true, conflictHunks: [] }); return }
    if (JSON.stringify(disk.version) === JSON.stringify(this.state.disk?.version)) return
    if (!this.state.dirty || disk.source === this.state.source) {
      this.conflictPlan = null; this.update({ disk, source: disk.source, dirty: this.pendingAttachments.size > 0, conflict: null, conflictHunks: [] }); return
    }
    const plan = planDocumentSourceMerge(this.state.disk?.source ?? '', this.state.source, disk.source)
    const merged = mergedDocumentSource(plan)
    if (plan.conflicts.length) { this.conflictPlan = plan; this.update({ conflict: disk, conflictHunks: plan.conflicts, source: merged, dirty: true }) }
    else { this.conflictPlan = null; this.update({ disk, source: merged, dirty: merged !== disk.source, conflict: null, conflictHunks: [] }); this.schedule() }
  }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer)
    if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
    if (this.disposed || this.state.conflict || this.state.recovery) return false
    if (this.pending) { await this.pending; return this.state.dirty ? this.flush() : !this.state.error }
    if (!this.state.dirty) return true
    const source = this.state.source, disk = this.state.disk, attachments = this.attachmentSnapshot()
    this.update({ saving: true, error: null })
    this.pending = (async () => {
      try {
        const result = await this.port.saveDocument({ ref: this.ref, source, expectedVersion: disk?.version ?? null, operationId: crypto.randomUUID(), attachments })
        if (this.disposed) return false
        if (result.status === 'saved') {
          for (const attachment of attachments) if (this.pendingAttachments.get(attachment.relativePath) === attachment.bytes) this.pendingAttachments.delete(attachment.relativePath)
          this.update({ disk: { ref: this.ref, source, version: result.version, diagnostics: [] }, dirty: this.state.source !== source || this.pendingAttachments.size > 0, saving: false })
          this.schedule(); return true
        }
        if (result.status === 'conflict') { this.update({ saving: false }); this.observe(result.disk) }
        else this.update({ error: result.message, saving: false })
        return false
      } catch (error) { this.update({ error: (error as Error).message, saving: false }); return false }
      finally { this.pending = undefined }
    })()
    const saved = await this.pending
    return saved && this.state.dirty ? this.flush() : saved
  }
  undo() {
    const source = this.undoStack.pop()
    if (source === undefined) return
    this.redoStack.push(this.state.source); this.historyGroup = undefined
    this.update({ source, dirty: source !== this.state.disk?.source }); this.schedule()
  }
  redo() {
    const source = this.redoStack.pop()
    if (source === undefined) return
    this.undoStack.push(this.state.source); this.historyGroup = undefined
    this.update({ source, dirty: source !== this.state.disk?.source }); this.schedule()
  }
  async resolveConflict(choice: 'disk' | 'local' | 'recovery') {
    if (this.state.conflictHunks.length) return
    const disk = this.state.conflict
    if (choice === 'disk' && disk && disk !== 'deleted') {
      try { await this.port.preserveDraft?.(this.ref, disk.source, disk.version) }
      catch (error) { this.update({ error: `恢复状态保存失败：${(error as Error).message}` }); return }
      this.update({ disk, source: disk.source, dirty: false, conflict: null, recovery: false })
    }
    else {
      try { await this.port.preserveDraft?.(this.ref, this.state.source, disk === 'deleted' ? null : disk?.version ?? this.state.disk?.version ?? null, this.attachmentSnapshot()) }
      catch (error) { this.update({ error: `恢复状态保存失败：${(error as Error).message}` }); return }
      this.update({ disk: disk === 'deleted' ? null : disk ?? this.state.disk, dirty: true, conflict: null, recovery: false })
      await this.flush()
    }
  }
  async resolveConflictHunk(id: string, choice: 'local' | 'remote', customText?: string) {
    const plan = this.conflictPlan, disk = this.state.conflict
    if (!plan || !disk || disk === 'deleted') return
    const hunk = plan.conflicts.find(item => item.id === id)
    if (!hunk || hunk.resolution !== null) return
    hunk.resolution = customText ?? hunk[choice]
    const source = mergedDocumentSource(plan)
    const unresolved = plan.conflicts.filter(item => item.resolution === null)
    this.update({ source, conflictHunks: unresolved })
    try { await this.port.preserveDraft?.(this.ref, source, this.state.disk?.version ?? null, this.attachmentSnapshot()) }
    catch (error) { this.update({ error: `恢复稿保存失败：${(error as Error).message}` }) }
    if (!unresolved.length) {
      this.conflictPlan = null
      this.update({ disk, conflict: null, recovery: false, dirty: source !== disk.source })
      await this.flush()
    }
  }
  async preserveDraft(): Promise<boolean> {
    if (this.state.composing) await new Promise<void>(resolve => this.compositionWaiters.push(resolve))
    if (!this.state.dirty && !this.state.conflict && !this.state.recovery && !this.pendingAttachments.size) return true
    if (!this.port.preserveDraft) { this.update({ error: '当前连接不支持保留恢复稿' }); return false }
    try { await this.port.preserveDraft(this.ref, this.state.source, this.state.disk?.version ?? null, this.attachmentSnapshot()); return true }
    catch (error) { this.update({ error: `恢复稿保存失败：${(error as Error).message}` }); return false }
  }
  async preserveAndClose(): Promise<boolean> { await this.stopAiEdits(); if (!(await this.preserveDraft())) return false; this.dispose(false); return true }
  async close(): Promise<boolean> { await this.stopAiEdits(); if (!(await this.flush())) return false; this.dispose(false); return true }
  async prepareAiEdit(ranges: DocumentEditRange[], epoch: number) {
    if (this.disposed) return { status: 'failed' as const, message: '文档已关闭' }
    if (!(await this.flush())) return { status: 'failed' as const, message: '请先处理当前稿保存或冲突' }
    const result = await this.port.prepareAiEdit(this.ref, ranges, epoch)
    if (this.disposed) { await this.invalidatePreparedAiEdits(); return { status: 'failed' as const, message: '文档已关闭' } }
    if (result.status === 'ready') this.aiBaselines.set(epoch, result.document.source)
    return result
  }
  async applyAiEdit(request: { baseVersion: DocumentFileVersion; epoch: number; operationId: string; edits: DocumentEditRange[] }) {
    if (this.disposed) return { status: 'failed' as const, message: '文档已关闭，旧修改不会应用' }
    if (!(await this.flush())) return { status: 'failed' as const, message: '请先处理当前稿保存或冲突' }
    const result = await this.port.applyAiEdit({ ...request, ref: this.ref })
    if ('conflicts' in result && result.conflicts.length) this.update({ aiSuggestions: [...this.state.aiSuggestions, ...result.conflicts.map((edit, index) => ({ id: `${request.operationId}:${index}`, edit, baseSource: this.aiBaselines.get(request.epoch) ?? this.state.source }))] })
    if (result.status === 'applied' || result.status === 'partial') {
      this.update({ aiRecords: [...this.state.aiRecords.filter(record => record.id !== result.record.id), result.record], aiMessage: result.status === 'partial' ? `已应用可合并修改，${result.conflicts.length} 处冲突保留建议` : 'AI 修改已保存' })
      this.observe(await this.port.openDocument(this.ref))
    } else this.update({ aiMessage: result.status === 'failed' ? result.message : `${result.conflicts.length} 处修改与当前稿冲突，未覆盖` })
    return result
  }
  async revertAiEdit(record: DocumentAiEditRecord) {
    if (!(await this.flush()) || !this.state.disk) return
    const result = await this.port.revertAiEdit(record, this.state.disk.version)
    this.update({ aiMessage: `已撤回 ${result.reverted.length} 处，未撤回 ${result.unreverted.length} 处` })
    if (result.save.status === 'saved') this.observe(await this.port.openDocument(this.ref))
    else this.update({ error: result.save.status === 'failed' ? result.save.message : '撤回前磁盘稿发生变化' })
  }
  async clearAiMarkers() { try { await this.port.clearAiRecords?.(this.ref, this.state.aiRecords.map(record => record.id)); this.update({ aiRecords: [], aiMessage: null }) } catch (error) { this.update({ aiMessage: (error as Error).message }) } }
  dismissAiSuggestion(id: string) { this.update({ aiSuggestions: this.state.aiSuggestions.filter(item => item.id !== id) }) }
  async applyAiSuggestion(id: string, expectedCurrent: string, merged: string) {
    if (!this.state.aiSuggestions.some(item => item.id === id)) return false
    if (this.state.source !== expectedCurrent) { this.update({ aiMessage: '当前范围已改变，请重新查看后合并' }); return false }
    this.edit(merged, `ai-suggestion-${id}`)
    if (!await this.flush()) return false
    this.dismissAiSuggestion(id); return true
  }
  async stopAiEdits() {
    await this.port.invalidateAiEdits?.(this.ref)
    await Promise.all([...this.aiTaskStops].map(stop => stop()))
    if (!this.disposed && this.state.disk) {
      try { this.observe(await this.port.openDocument(this.ref)) } catch { /* Save/close retains the existing draft and reports any write failure. */ }
    }
  }
  async invalidatePreparedAiEdits() { await this.port.invalidateAiEdits?.(this.ref) }
  dispose(invalidate = true) { if (this.disposed) return; this.disposed = true; clearTimeout(this.timer); this.stopWatch?.(); if (invalidate) void this.stopAiEdits().catch(() => {}); for (const resolve of this.compositionWaiters.splice(0)) resolve(); this.listeners.clear() }
}
