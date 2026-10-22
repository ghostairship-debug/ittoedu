import type { DocumentSnapshot } from '../../../shared/workbench/document'
import {
  acceptHtmlPreviewPageMessage, htmlPreviewPageMessageSchema, HTML_PREVIEW_TARGET_MAX,
  type HtmlPreviewEditOutcome, type HtmlPreviewLease, type HtmlPreviewResolvedTarget, type HtmlPreviewRequest,
} from '../../../shared/workbench/htmlPreview'
import { htmlPreviewTargetReportSchema } from '../../../shared/workbench/htmlPreview'
import type { z } from 'zod'
import { readHtmlAuthoringRecords } from '../../../shared/html/htmlAuthoringRecords'
import type { HtmlSourceAnalysis } from './htmlSourceAnalysis'

export type HtmlTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>
export type HtmlSelectedTarget = { report: HtmlTargetReport; resolved: HtmlPreviewResolvedTarget }
type HtmlSourceChange = Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }>['change']
type HtmlEditIntent = Exclude<HtmlSourceChange, { kind: 'image' }>
  | (Omit<Extract<HtmlSourceChange, { kind: 'image' }>, 'bytes'> & { bytes: Uint8Array })
export interface HtmlPreviewControllerEvents {
  onTarget(target: HtmlSelectedTarget | null, issue?: string): void
  onReady(sectionCount: number, ambiguous: boolean): void
  onEditModeReady(enabled: boolean): void
  onPage(index: number, scroll: number): void
  onEditing(): void
  onApplied(revision: number, patch: Extract<HtmlPreviewEditOutcome, { status: 'applied' }>['patch'], beforeValue: string): void
  onEditSettled(): void
  onPatchMismatch(): void
  onSelection?(handle: string, selection: { anchor: number; focus: number; word?: boolean }): void
}

/** Renderer broker. The opaque page only reports observations; all writes go through Main. */
export class HtmlPreviewController {
  private revision: number
  private lastSeq = -1
  private active = true
  private visible = true
  private reloading = false
  private reloadFrameLoaded = false
  private selected: HtmlSelectedTarget | null = null
  private resolvingSelection: { handle: string; selection?: HtmlTargetReport['selection'] } | null = null
  private requestSerial = 0
  private modeRequest: { requestId: string; enabled: boolean } | null = null
  private editMode = false
  private readonly cardKeys = new Set<string>()
  private readonly cardTargets = new Map<string, HtmlTargetReport>()
  private modeSerial = 0
  private recordsSource: string | undefined
  private confirming = false
  private pendingConfirmation: { scanId: string; targets: HtmlTargetReport[] } | null = null
  constructor(
    private readonly iframe: HTMLIFrameElement,
    readonly lease: HtmlPreviewLease,
    private readonly events: HtmlPreviewControllerEvents,
  ) {
    this.revision = lease.revision
    window.addEventListener('message', this.onMessage)
  }

  updateCommitted(snapshot: DocumentSnapshot, analysis?: HtmlSourceAnalysis): void {
    if (snapshot.documentId !== this.lease.documentId || snapshot.epoch !== this.lease.epoch) return
    const changed = snapshot.revision > this.revision
    this.revision = Math.max(this.revision, snapshot.revision)
    if (snapshot.model.kind === 'text' && snapshot.model.source !== this.recordsSource) {
      const records = analysis?.source === snapshot.model.source ? analysis.authoring.authoringRecords : readHtmlAuthoringRecords(snapshot.model.source)
      this.recordsSource = snapshot.model.source
      this.iframe.contentWindow?.postMessage({ type: 'html-preview.authoring-records', loadId: this.lease.loadId, records }, '*')
    }
    if (changed && this.editMode) this.iframe.contentWindow?.postMessage({ type: 'html-preview.refresh-targets', loadId: this.lease.loadId }, '*')
    if (this.selected && (this.selected.resolved.status !== 'editable'
      || this.selected.resolved.locator.revision !== snapshot.revision)) this.select(null)
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (!this.active || event.source !== this.iframe.contentWindow) return
    if (this.reloading && !this.reloadFrameLoaded) return
    if (event.data?.event === 'html-preview.hello' && event.data?.protocol === 1) { this.init(); return }
    if (event.data?.event === 'html-preview.patch-result' && event.data?.protocol === 1
      && event.data.leaseId === this.lease.leaseId && event.data.loadId === this.lease.loadId
      && event.data.ok === false) { this.events.onPatchMismatch(); return }
    const parsed = htmlPreviewPageMessageSchema.safeParse(event.data)
    if (!parsed.success) return
    const message = parsed.data
    if (this.reloading && message.event !== 'ready') return
    if (!acceptHtmlPreviewPageMessage(message, { leaseId: this.lease.leaseId, loadId: this.lease.loadId, lastSeq: this.lastSeq }).accept) return
    if (message.event !== 'ready') this.lastSeq = message.seq
    if (message.event === 'ready') { this.lastSeq = -1; this.reloading = false; this.events.onReady(message.sectionCount, message.sectionsAmbiguous) }
    if (message.event === 'page') this.events.onPage(message.pageIndex, message.perPageScroll)
    if (message.event === 'card-targets') {
      this.cardTargets.clear()
      for (const target of message.targets) if (target.authoring) this.cardTargets.set(target.authoring.authorKey, target)
      window.dispatchEvent(new Event('guoling:text-card-anchor-changed'))
    }
    if (message.event === 'edit-mode-ready' && this.modeRequest?.requestId === message.requestId
      && this.modeRequest.enabled === message.enabled) {
      this.modeRequest = null
      this.events.onEditModeReady(message.enabled)
    }
    if (this.visible && message.event === 'targets') void this.resolve(message.targets)
    if (this.visible && this.editMode && message.event === 'selection') {
      const selection = { anchor: message.anchor, focus: message.focus, ...(message.word ? { word: true } : {}) }
      if (this.resolvingSelection?.handle === message.handle) this.resolvingSelection.selection = selection
      if (this.selected?.report.handle === message.handle) this.events.onSelection?.(message.handle, selection)
    }
    if (this.visible && this.editMode && message.event === 'edit-targets') this.queueConfirmation(message.scanId, message.targets)
  }

  init(): void {
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.init', leaseId: this.lease.leaseId, loadId: this.lease.loadId }, '*')
  }
  cardRect(authorKey: string): DOMRect | null {
    if (!this.cardKeys.has(authorKey)) {
      this.cardKeys.add(authorKey)
      this.iframe.contentWindow?.postMessage({ type: 'html-preview.card-targets', loadId: this.lease.loadId, authorKeys: [...this.cardKeys] }, '*')
    }
    const target = this.cardTargets.get(authorKey)
    if (!target || !this.visible) return null
    const owner = this.iframe.getBoundingClientRect(), sx = this.iframe.clientWidth ? owner.width / this.iframe.clientWidth : 1, sy = this.iframe.clientHeight ? owner.height / this.iframe.clientHeight : 1
    return new DOMRect(owner.left + target.rect.x * sx, owner.top + target.rect.y * sy, target.rect.width * sx, target.rect.height * sy)
  }
  selectAuthor(authorKey: string): boolean {
    if (!this.cardTargets.has(authorKey) || !this.visible || !this.editMode) return false
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.select-author', loadId: this.lease.loadId, authorKey }, '*')
    return true
  }
  clearSelection(): void { this.select(null) }
  selectSource(domPath: HtmlTargetReport['domPath'], kind: HtmlTargetReport['kind'] | null, expectedText?: string): void {
    if (!this.active || !this.visible) return
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.select-source', loadId: this.lease.loadId, domPath, kind,
      ...(expectedText === undefined ? {} : { expectedText }) }, '*')
  }

  beginReload(): void {
    this.reloading = true
    this.reloadFrameLoaded = false
    this.lastSeq = -1
    this.requestSerial += 1
    this.modeRequest = null
    this.modeSerial++
    this.pendingConfirmation = null
    this.recordsSource = undefined
    this.select(null)
  }

  frameLoaded(): void {
    this.reloadFrameLoaded = true
    this.init()
  }

  setVisibility(visible: boolean): void {
    this.visible = visible
    if (!visible) { this.requestSerial++; this.pendingConfirmation = null }
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.visibility', loadId: this.lease.loadId, active: visible }, '*')
  }

  navigate(index: number): void {
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.navigate', loadId: this.lease.loadId, index }, '*')
  }

  restore(index: number, scroll: number): void {
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.restore', loadId: this.lease.loadId, index, scroll }, '*')
  }

  setEditMode(enabled: boolean): void {
    const requestId = crypto.randomUUID()
    this.modeRequest = { requestId, enabled }
    this.editMode = enabled
    this.modeSerial++
    this.requestSerial++
    this.pendingConfirmation = null
    this.select(null)
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.edit-mode', loadId: this.lease.loadId, requestId, enabled }, '*')
  }

  patch(patch: { handle: string; kind: 'text' | 'image'; value: string; expected: string }): void {
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.patch', loadId: this.lease.loadId, ...patch }, '*')
  }

  private select(value: HtmlSelectedTarget | null, issue?: string): void {
    this.selected = value
    if (!value) this.resolvingSelection = null
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.selection', loadId: this.lease.loadId,
      handle: value?.report.handle ?? null, editable: value?.resolved.status === 'editable' }, '*')
    this.events.onTarget(value, issue)
  }

  /** Discovery is replaceable observation. Retain all chunks of the latest scan,
   * but never queue work for scans superseded before their first IPC. */
  private queueConfirmation(scanId: string, targets: HtmlTargetReport[]): void {
    if (this.pendingConfirmation?.scanId === scanId) this.pendingConfirmation.targets.push(...targets)
    else this.pendingConfirmation = { scanId, targets: [...targets] }
    if (!this.confirming) void this.drainConfirmations()
  }

  private async drainConfirmations(): Promise<void> {
    this.confirming = true
    try {
      while (this.active && this.visible && this.editMode && this.pendingConfirmation) {
        const pending = this.pendingConfirmation
        const targets = pending.targets.splice(0, HTML_PREVIEW_TARGET_MAX)
        if (!pending.targets.length) this.pendingConfirmation = null
        await this.confirmTargets(pending.scanId, targets)
      }
    } finally { this.confirming = false }
  }

  private async confirmTargets(scanId: string, targets: HtmlTargetReport[]): Promise<void> {
    const revision = this.revision, modeSerial = this.modeSerial
    try {
      const response = await window.desktopAPI.workspaceFiles!({ type: 'html-preview.resolve-target',
        leaseId: this.lease.leaseId, loadId: this.lease.loadId, revision, targets })
      if (!this.active || !this.visible || !this.editMode || modeSerial !== this.modeSerial
        || revision !== this.revision || response.revision !== revision) return
      this.iframe.contentWindow?.postMessage({ type: 'html-preview.confirm-targets', loadId: this.lease.loadId, scanId,
        handles: response.targets.filter(target => target.status === 'editable').map(target => target.handle) }, '*')
    } catch { /* Discovery cannot block the existing click-to-resolve editor. */ }
  }

  private async resolve(targets: HtmlTargetReport[]): Promise<void> {
    const serial = ++this.requestSerial
    if (targets.length !== 1) { this.select(null); return }
    const report = targets[0]!
    const selection = this.resolvingSelection = { handle: report.handle, selection: report.selection }
    try {
      const response = await window.desktopAPI.workspaceFiles!({ type: 'html-preview.resolve-target',
        leaseId: this.lease.leaseId, loadId: this.lease.loadId, revision: this.revision, targets: [report] })
      if (!this.active || serial !== this.requestSerial || response.revision !== this.revision) return
      if (selection.selection) report.selection = selection.selection
      this.resolvingSelection = null
      const resolved = response.targets[0]
      if (!resolved) { this.select(null); return }
      if (resolved.status !== 'editable') {
        this.select({ report, resolved }, '不能直接修改这个位置；可以让 AI 修改本页 HTML 源码。')
        return
      }
      this.select({ report, resolved })
    } catch { if (this.active && serial === this.requestSerial) this.select(null, '源码已变化，请重新选择。') }
  }

  async editText(value: string, target?: HtmlSelectedTarget): Promise<HtmlPreviewEditOutcome> { return this.edit({ kind: 'text', value }, target) }
  async editStyle(patch: Record<string, string | null>): Promise<HtmlPreviewEditOutcome> { return this.edit({ kind: 'style', patch }) }
  async editGeometry(geometry: NonNullable<NonNullable<HtmlTargetReport['authoring']>['record']['overrides']['geometry']>): Promise<HtmlPreviewEditOutcome> {
    return this.edit({ kind: 'geometry', geometry })
  }
  previewGeometry(authorKey: string, geometry: NonNullable<NonNullable<HtmlTargetReport['authoring']>['record']['overrides']['geometry']> | null): void {
    if (!this.active) return
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.authoring-preview', loadId: this.lease.loadId, authorKey, geometry }, '*')
  }
  async editImage(image: { name: string; mimeType: string; bytes: Uint8Array }): Promise<HtmlPreviewEditOutcome> {
    return this.edit({ kind: 'image', ...image })
  }

  private async edit(change: HtmlEditIntent, captured?: HtmlSelectedTarget): Promise<HtmlPreviewEditOutcome> {
    const target = captured ?? this.selected
    if (!target || !this.active || target.resolved.status !== 'editable'
      || target.resolved.locator.revision !== this.revision) return { status: 'rejected', reason: 'stale-revision' }
    const request: Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }> = { type: 'html-preview.edit',
      operationId: crypto.randomUUID(), documentId: this.lease.documentId, epoch: this.lease.epoch,
      baseRevision: this.revision, bindingVersion: this.lease.bindingVersion,
      leaseId: this.lease.leaseId, loadId: this.lease.loadId, target: target.report.handle,
      change: change.kind === 'image' ? { ...change, bytes: Uint8Array.from(change.bytes) } : change }
    this.events.onEditing()
    try {
      const result = await window.desktopAPI.workspaceFiles!(request) as HtmlPreviewEditOutcome
      if (result.status === 'applied' && this.active) {
        const superseded = this.revision > result.revision
        this.revision = Math.max(this.revision, result.revision)
        if (!superseded) {
          this.patch({ ...result.patch, expected: target.report.rawText })
          if (result.patch.authoringRecords) this.iframe.contentWindow?.postMessage({ type: 'html-preview.authoring-records',
            loadId: this.lease.loadId, records: result.patch.authoringRecords }, '*')
          this.events.onApplied(result.revision, result.patch, target.report.rawText)
          if (change.kind === 'style' && !result.patch.authoringRecords) this.events.onPatchMismatch()
        }
        if (this.selected === target) this.select(null)
      }
      return result
    } finally {
      this.events.onEditSettled()
    }
  }

  dispose(): void {
    this.active = false
    this.requestSerial += 1
    window.removeEventListener('message', this.onMessage)
    this.selected = null
    this.pendingConfirmation = null
    this.recordsSource = undefined
  }
}
