import type { DocumentSnapshot } from '../../../shared/workbench/document'
import {
  acceptHtmlPreviewPageMessage, htmlPreviewPageMessageSchema,
  type HtmlPreviewEditOutcome, type HtmlPreviewLease, type HtmlPreviewResolvedTarget, type HtmlPreviewRequest,
} from '../../../shared/workbench/htmlPreview'
import { htmlPreviewTargetReportSchema } from '../../../shared/workbench/htmlPreview'
import type { z } from 'zod'
import { readHtmlAuthoringRecords } from '../../../shared/html/htmlAuthoringRecords'

export type HtmlTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>
export type HtmlSelectedTarget = { report: HtmlTargetReport; resolved: HtmlPreviewResolvedTarget }
export interface HtmlPreviewControllerEvents {
  onTarget(target: HtmlSelectedTarget | null, issue?: string): void
  onReady(sectionCount: number, ambiguous: boolean): void
  onEditModeReady(enabled: boolean): void
  onPage(index: number, scroll: number): void
  onEditing(): void
  onApplied(revision: number, patch: Extract<HtmlPreviewEditOutcome, { status: 'applied' }>['patch'], beforeValue: string): void
  onEditSettled(): void
  onPatchMismatch(): void
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
  private requestSerial = 0
  private modeRequest: { requestId: string; enabled: boolean } | null = null
  private editMode = false
  private modeSerial = 0
  constructor(
    private readonly iframe: HTMLIFrameElement,
    readonly lease: HtmlPreviewLease,
    private readonly events: HtmlPreviewControllerEvents,
  ) {
    this.revision = lease.revision
    window.addEventListener('message', this.onMessage)
  }

  updateCommitted(snapshot: DocumentSnapshot): void {
    if (snapshot.documentId !== this.lease.documentId || snapshot.epoch !== this.lease.epoch) return
    const changed = snapshot.revision > this.revision
    this.revision = Math.max(this.revision, snapshot.revision)
    if (snapshot.model.kind === 'text') this.iframe.contentWindow?.postMessage({ type: 'html-preview.authoring-records',
      loadId: this.lease.loadId, records: readHtmlAuthoringRecords(snapshot.model.source) }, '*')
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
    if (message.event === 'edit-mode-ready' && this.modeRequest?.requestId === message.requestId
      && this.modeRequest.enabled === message.enabled) {
      this.modeRequest = null
      this.events.onEditModeReady(message.enabled)
    }
    if (this.visible && message.event === 'targets') void this.resolve(message.targets)
    if (this.visible && this.editMode && message.event === 'edit-targets') void this.confirmTargets(message.scanId, message.targets)
  }

  init(): void {
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.init', leaseId: this.lease.leaseId, loadId: this.lease.loadId }, '*')
  }

  beginReload(): void {
    this.reloading = true
    this.reloadFrameLoaded = false
    this.lastSeq = -1
    this.requestSerial += 1
    this.modeRequest = null
    this.modeSerial++
    this.select(null)
  }

  frameLoaded(): void {
    this.reloadFrameLoaded = true
    this.init()
  }

  setVisibility(visible: boolean): void {
    this.visible = visible
    if (!visible) this.requestSerial++
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
    this.select(null)
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.edit-mode', loadId: this.lease.loadId, requestId, enabled }, '*')
  }

  patch(patch: { handle: string; kind: 'text' | 'image'; value: string; expected: string }): void {
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.patch', loadId: this.lease.loadId, ...patch }, '*')
  }

  private select(value: HtmlSelectedTarget | null, issue?: string): void {
    this.selected = value
    this.iframe.contentWindow?.postMessage({ type: 'html-preview.selection', loadId: this.lease.loadId,
      handle: value?.report.handle ?? null, editable: value?.resolved.status === 'editable' }, '*')
    this.events.onTarget(value, issue)
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
    try {
      const response = await window.desktopAPI.workspaceFiles!({ type: 'html-preview.resolve-target',
        leaseId: this.lease.leaseId, loadId: this.lease.loadId, revision: this.revision, targets: [report] })
      if (!this.active || serial !== this.requestSerial || response.revision !== this.revision) return
      const resolved = response.targets[0]
      if (!resolved) { this.select(null); return }
      if (resolved.status !== 'editable') {
        this.select({ report, resolved }, '不能直接修改这个位置；可以让 AI 修改本页 HTML 源码。')
        return
      }
      this.select({ report, resolved })
    } catch { if (this.active && serial === this.requestSerial) this.select(null, '源码已变化，请重新选择。') }
  }

  async editText(value: string): Promise<HtmlPreviewEditOutcome> { return this.edit({ kind: 'text', value }) }
  async editStyle(patch: Record<string, string | null>): Promise<HtmlPreviewEditOutcome> { return this.edit({ kind: 'style', patch }) }
  async editGeometry(geometry: NonNullable<NonNullable<HtmlTargetReport['authoring']>['record']['overrides']['geometry']>): Promise<HtmlPreviewEditOutcome> {
    return this.edit({ kind: 'geometry', geometry })
  }
  async editImage(image: { name: string; mimeType: string; bytes: Uint8Array }): Promise<HtmlPreviewEditOutcome> {
    return this.edit({ kind: 'image', ...image, bytes: Uint8Array.from(image.bytes) })
  }

  private async edit(change: Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }>['change']): Promise<HtmlPreviewEditOutcome> {
    const target = this.selected
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
          if (result.patch.authoringRecords) this.iframe.contentWindow?.postMessage({ type: 'html-preview.authoring-records',
            loadId: this.lease.loadId, records: result.patch.authoringRecords }, '*')
          this.patch({ ...result.patch, expected: target.report.rawText })
          this.events.onApplied(result.revision, result.patch, target.report.rawText)
        }
        this.select(null)
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
  }
}
