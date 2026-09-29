import { BrowserWindow, session as sessions } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { HTML_PREVIEW_SCHEME } from '../../protocols'
import { PreviewNetworkPolicy } from '../../previewNetworkPolicy'
import { configureRestrictedSession, hardenWebContents, isAllowedHtmlPreviewFrameUrl, isAllowedHtmlPreviewChildFrameUrl } from '../../security'
import { HtmlPreviewService, HtmlPreviewUnavailableError, type HtmlPreviewAutomationContext } from '../htmlPreview/HtmlPreviewService'
import type { HtmlActionPreviewPort } from './HtmlActionService'

interface OwnedPreview {
  documentId: string
  key: string
  context: Promise<HtmlPreviewAutomationContext>
  preview: HtmlPreviewService
  window: BrowserWindow
  leaseId?: string
  releaseProtocol(): void
  closed: boolean
}
type DocumentRequest = Parameters<HtmlActionPreviewPort['automationContextForDocument']>[0]

/** Reuses live previews when available; otherwise owns one sandboxed, non-persistent preview per task.
 * It reads the canonical source, never saves it or changes the user's active tab. */
export class TaskHtmlPreview implements HtmlActionPreviewPort {
  private readonly owned = new Map<string, OwnedPreview>()
  private readonly byLease = new Map<string, OwnedPreview>()
  private readonly stopped = new Set<string>()
  private disposed = false
  constructor(private readonly options: { live: HtmlPreviewService;
    readDocument(documentId: string): Promise<DocumentSnapshot>; agentBundlePath: string }) {}

  async automationContext(leaseId: string, loadId: string, revision: number): Promise<HtmlPreviewAutomationContext> {
    const owner = this.byLease.get(leaseId)
    if (!owner) return this.options.live.automationContext(leaseId, loadId, revision)
    if (owner.closed) throw new Error('HTML 任务预览已关闭')
    return { ...await owner.preview.automationContext(leaseId, loadId, revision), source: 'isolated' }
  }

  async automationContextForDocument(input: DocumentRequest): Promise<HtmlPreviewAutomationContext> {
    if (this.disposed || input.runId && this.stopped.has(input.runId)) throw new Error('HTML 观察已停止')
    const key = JSON.stringify([input.documentId, input.epoch, input.revision])
    const existing = input.runId ? this.owned.get(input.runId) : undefined
    // Preserve this task's interaction state even if a live tab opens in the meantime.
    if (existing?.key === key && !existing.closed) return existing.context
    try {
      const context = await this.options.live.automationContextForDocument(input)
      if (this.disposed || input.runId && this.stopped.has(input.runId)) throw new Error('HTML 观察已停止')
      if (existing) this.close(existing)
      return context
    } catch (error) {
      if (!(error instanceof HtmlPreviewUnavailableError) || error.reason !== 'missing' || input.tabId || !input.runId) throw error
    }
    if (this.disposed || this.stopped.has(input.runId)) throw new Error('HTML 观察已停止')
    if (existing) this.close(existing)
    const partition = sessions.fromPartition(`html-task-${randomUUID()}`, { cache: false })
    const policy = new PreviewNetworkPolicy()
    configureRestrictedSession(partition, url => policy.allowsRequest(url))
    const window = new BrowserWindow({ show: false, skipTaskbar: true, width: 1280, height: 720,
      useContentSize: true, webPreferences: { session: partition, sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false } })
    const shell = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;overflow:hidden"></body></html>')
    hardenWebContents(window.webContents, url => url === shell,
      (url, frame) => isAllowedHtmlPreviewFrameUrl(url, window.webContents.id)
        || isAllowedHtmlPreviewChildFrameUrl(url, window.webContents.id, frame))
    const preview = new HtmlPreviewService({ readDocument: this.options.readDocument,
      networkOwner: () => policy.currentDocumentOwner(), networkPolicy: policy,
      currentMainFrame: () => {
        if (window.isDestroyed() || window.webContents.mainFrame.detached) return null
        const frame = window.webContents.mainFrame
        return { webContentsId: window.webContents.id, processId: frame.processId, frameToken: frame.frameToken }
      }, agentBundlePath: this.options.agentBundlePath })
    partition.protocol.handle(HTML_PREVIEW_SCHEME, preview.handleProtocolRequest)
    const owner: OwnedPreview = { documentId: input.documentId, key, preview, window, closed: false,
      releaseProtocol: () => partition.protocol.unhandle(HTML_PREVIEW_SCHEME),
      context: Promise.resolve(null as never) }
    this.owned.set(input.runId, owner)
    owner.context = (async () => {
      try {
        await window.loadURL(shell)
        if (owner.closed) throw new Error('HTML 观察已停止')
        const frame = window.webContents.mainFrame
        policy.activateDocument({ processId: frame.processId, frameToken: frame.frameToken, documentToken: randomUUID() })
        const snapshot = await this.options.readDocument(input.documentId)
        if (snapshot.epoch !== input.epoch || snapshot.revision !== input.revision || snapshot.binding.kind !== 'file')
          throw new Error('HTML 观察来源已变化，请重新读取')
        const lease = await preview.open({ type: 'html-preview.open', documentId: input.documentId, epoch: input.epoch,
          expectedBindingVersion: snapshot.binding.bindingVersion, tabId: `task-html:${input.runId}` })
        if (owner.closed) throw new Error('HTML 观察已停止')
        owner.leaseId = lease.leaseId; this.byLease.set(lease.leaseId, owner)
        await window.webContents.mainFrame.executeJavaScript(`new Promise((resolve,reject)=>{
          const frame=document.createElement('iframe');frame.title='Task HTML preview';
          frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.referrerPolicy='no-referrer';
          frame.style.cssText='display:block;border:0;width:100vw;height:100vh';
          const timer=setTimeout(()=>{frame.remove();reject(new Error('HTML 任务预览加载超时'))},15000);
          frame.onload=()=>{clearTimeout(timer);resolve(true)};frame.onerror=()=>{clearTimeout(timer);reject(new Error('HTML 任务预览加载失败'))};
          frame.src=${JSON.stringify(lease.url)};document.body.append(frame);
        })`)
        if (owner.closed || this.stopped.has(input.runId!)) throw new Error('HTML 观察已停止')
        return { ...await preview.automationContext(lease.leaseId, lease.loadId, input.revision), source: 'isolated' as const }
      } catch (error) { this.close(owner); throw error }
    })()
    return owner.context
  }

  private close(owner: OwnedPreview): void {
    if (owner.closed) return
    owner.closed = true
    if (owner.leaseId) this.byLease.delete(owner.leaseId)
    for (const [runId, current] of this.owned) if (current === owner) this.owned.delete(runId)
    owner.preview.dispose()
    owner.releaseProtocol()
    if (!owner.window.isDestroyed()) owner.window.destroy()
  }
  releaseRun(runId: string): void { this.stopped.add(runId); const owner = this.owned.get(runId); if (owner) this.close(owner) }
  releaseDocument(documentId: string): void { for (const owner of this.owned.values()) if (owner.documentId === documentId) this.close(owner) }
  dispose(): void { this.disposed = true; for (const owner of this.owned.values()) this.close(owner) }
}
