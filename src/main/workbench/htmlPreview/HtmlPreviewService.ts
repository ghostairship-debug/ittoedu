import { randomBytes, randomUUID } from 'node:crypto'
import { documentDigest } from '../../../core/documents/documentDigest'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type {
  HtmlPreviewEditOutcome, HtmlPreviewHost, HtmlPreviewLease, HtmlPreviewRequest,
  HtmlPreviewResolvedTarget,
} from '../../../shared/workbench/htmlPreview'
import { mainPreviewNetworkPolicy, type PreviewNetworkDocumentOwner, type PreviewNetworkPolicy } from '../../previewNetworkPolicy'
import { registerHtmlPreviewFrameEntry } from '../../security'
import { HTML_PREVIEW_AGENT_PATH, htmlPreviewFileUrl, isContainedPath, parseHtmlPreviewProtocolUrl } from './htmlPreviewProtocol'
import { htmlPreviewResponse } from './htmlPreviewResponse'
import {
  collectHtmlPreviewMediaUrls, htmlPreviewContentType, normalizeCssPreviewMediaReferences,
  normalizeHtmlPreviewMediaReferences, resolveHtmlPreviewResource,
} from './htmlPreviewResources'

type OpenRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.open' }>
type ReleaseRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.release' }>
type ResolveRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.resolve-target' }>
type EditRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }>

export interface HtmlPreviewMainFrame {
  webContentsId: number
  processId: number
  frameToken: string
}

export interface HtmlPreviewEditContext {
  lease: HtmlPreviewLease
  tabId: string
  rootRealPath: string
  entryRealPath: string
  bindingPath: string
  snapshot: DocumentSnapshot
}

/** Main-only identity for a live HTML action session. It never grants document writes. */
export interface HtmlPreviewAutomationContext {
  lease: HtmlPreviewLease
  tabId: string
  webContentsId: number
  bindingPath: string
  source?: 'isolated'
}

export class HtmlPreviewUnavailableError extends Error {
  constructor(readonly reason: 'missing' | 'ambiguous') {
    super(reason === 'ambiguous' ? '同一 HTML 文档有多个预览，请指定当前标签页' : '没有当前版本的 HTML 预览，请打开并观察该文档')
  }
}

/** B4 supplies the canonical locator/transaction implementation at composition time. */
export interface HtmlPreviewEditPort {
  resolveTarget(request: ResolveRequest, context: HtmlPreviewEditContext): Promise<{ revision: number; targets: HtmlPreviewResolvedTarget[] }>
  edit(request: EditRequest, context: HtmlPreviewEditContext): Promise<HtmlPreviewEditOutcome>
}

export interface HtmlPreviewServiceOptions {
  readDocument(documentId: string): Promise<DocumentSnapshot>
  networkOwner(): PreviewNetworkDocumentOwner | null
  currentMainFrame(): HtmlPreviewMainFrame | null
  networkPolicy?: PreviewNetworkPolicy
  registerFrameEntry?: typeof registerHtmlPreviewFrameEntry
  /** Exact application-bundled B4 agent file, never a renderer-controlled path. */
  agentBundlePath?: string
  editPort?: HtmlPreviewEditPort
}

interface ActiveLease {
  public: HtmlPreviewLease
  token: string
  tabId: string
  webContentsId: number
  owner: PreviewNetworkDocumentOwner
  rootRealPath: string
  entryRealPath: string
  bindingPath: string
  entryName: string
  mediaUrls: string[]
  mediaOrigins: string[]
  unregisterFrame: () => void
}

function sameOwner(a: PreviewNetworkDocumentOwner, b: PreviewNetworkDocumentOwner | null): boolean {
  return b !== null && a.processId === b.processId && a.frameToken === b.frameToken && a.documentToken === b.documentToken
}

function ownerMatchesFrame(owner: PreviewNetworkDocumentOwner | null, frame: HtmlPreviewMainFrame | null): owner is PreviewNetworkDocumentOwner {
  return owner !== null && frame !== null && Number.isSafeInteger(frame.webContentsId)
    && frame.processId === owner.processId && frame.frameToken === owner.frameToken
}

function notFound(method: string): Response { return htmlPreviewResponse('Not found', { status: 404, method }) }

function injectEarlyPreviewAgent(source: string, script: string): string {
  // Run before authored scripts so the agent can distinguish static DOM nodes
  // from nodes later created or replaced by page code. Doctype must stay first.
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0
  for (const token of scanHtmlSource(source).tokens) {
    if (token.span.end <= offset) continue
    if (token.kind === 'text' && /^\s*$/.test(source.slice(token.span.start, token.span.end))) {
      offset = token.span.end
      continue
    }
    if (token.kind === 'comment') { offset = token.span.end; continue }
    if (token.kind === 'doctype') offset = token.span.end
    break
  }
  return `${source.slice(0, offset)}${script}${source.slice(offset)}`
}

export class HtmlPreviewService implements HtmlPreviewHost {
  private readonly leases = new Map<string, ActiveLease>()
  private readonly byToken = new Map<string, ActiveLease>()
  private readonly policy: PreviewNetworkPolicy
  private readonly registerFrame: typeof registerHtmlPreviewFrameEntry
  private editPort: HtmlPreviewEditPort | null
  private readonly editReceipts = new Map<string, { digest: string; leaseId: string; promise: Promise<HtmlPreviewEditOutcome> }>()
  private disposed = false

  constructor(private readonly options: HtmlPreviewServiceOptions) {
    this.policy = options.networkPolicy ?? mainPreviewNetworkPolicy
    this.registerFrame = options.registerFrameEntry ?? registerHtmlPreviewFrameEntry
    this.editPort = options.editPort ?? null
  }

  setEditPort(port: HtmlPreviewEditPort | null): void { this.editPort = port }

  private currentOwner(): { owner: PreviewNetworkDocumentOwner; frame: HtmlPreviewMainFrame } | null {
    const owner = this.options.networkOwner()
    const frame = this.options.currentMainFrame()
    return ownerMatchesFrame(owner, frame) ? { owner, frame: frame! } : null
  }

  private async snapshotFor(lease: ActiveLease): Promise<DocumentSnapshot | null> {
    const current = this.currentOwner()
    if (!current || current.frame.webContentsId !== lease.webContentsId || !sameOwner(lease.owner, current.owner)) return null
    let snapshot: DocumentSnapshot
    try { snapshot = await this.options.readDocument(lease.public.documentId) } catch { return null }
    if (snapshot.epoch !== lease.public.epoch || snapshot.model.kind !== 'text' || snapshot.binding.kind !== 'file'
      || snapshot.binding.bindingVersion !== lease.public.bindingVersion || !/\.html?$/i.test(snapshot.binding.path)) return null
    try {
      const root = await fs.realpath(path.dirname(snapshot.binding.path))
      const entry = await fs.realpath(snapshot.binding.path)
      if (root !== lease.rootRealPath || entry !== lease.entryRealPath) return null
      if (!(await fs.stat(entry)).isFile()) return null
    } catch { return null }
    if (!this.leases.has(lease.public.leaseId) || !sameOwner(lease.owner, this.options.networkOwner())) return null
    return snapshot
  }

  private removeLease(lease: ActiveLease): void {
    if (this.leases.get(lease.public.leaseId) !== lease) return
    this.leases.delete(lease.public.leaseId)
    this.byToken.delete(lease.token)
    for (const [operationId, receipt] of this.editReceipts) {
      if (receipt.leaseId === lease.public.leaseId) this.editReceipts.delete(operationId)
    }
    try { lease.unregisterFrame() }
    finally {
      try { this.policy.releasePreviewLease(lease.public.leaseId, lease.owner) } catch { /* A new top document already cleared its leases. */ }
    }
  }

  async open(request: OpenRequest): Promise<HtmlPreviewLease> {
    if (this.disposed) throw new Error('HTML preview service is disposed')
    const current = this.currentOwner()
    if (!current) throw new Error('HTML preview main document is not active')
    const snapshot = await this.options.readDocument(request.documentId)
    if (snapshot.documentId !== request.documentId || snapshot.epoch !== request.epoch
      || snapshot.model.kind !== 'text' || snapshot.binding.kind !== 'file'
      || snapshot.binding.bindingVersion !== request.expectedBindingVersion
      || !/\.html?$/i.test(snapshot.binding.path)) throw new Error('HTML preview document binding changed')
    const rootRealPath = await fs.realpath(path.dirname(snapshot.binding.path))
    const entryRealPath = await fs.realpath(snapshot.binding.path)
    const stat = await fs.stat(entryRealPath)
    if (!stat.isFile() || !isContainedPath(rootRealPath, entryRealPath)) throw new Error('HTML preview entry is outside its folder')
    const entryName = path.basename(snapshot.binding.path)
    const mediaUrls = await collectHtmlPreviewMediaUrls(snapshot.model.source, rootRealPath)
    const ownerNow = this.currentOwner()
    const snapshotNow = await this.options.readDocument(request.documentId)
    if (!ownerNow || !sameOwner(current.owner, ownerNow.owner) || current.frame.webContentsId !== ownerNow.frame.webContentsId
      || snapshotNow.epoch !== snapshot.epoch || snapshotNow.revision !== snapshot.revision
      || snapshotNow.binding.kind !== 'file' || snapshotNow.binding.bindingVersion !== snapshot.binding.bindingVersion
      || snapshotNow.binding.path !== snapshot.binding.path) throw new Error('HTML preview changed while opening')
    const token = randomBytes(32).toString('hex')
    const lease: HtmlPreviewLease = {
      leaseId: randomUUID(), documentId: snapshot.documentId, epoch: snapshot.epoch,
      revision: snapshot.revision, bindingVersion: snapshot.binding.bindingVersion,
      loadId: randomUUID(), url: htmlPreviewFileUrl(token, entryName),
    }
    this.policy.replacePreviewLease({ leaseId: lease.leaseId, connectOrigins: [], remoteAssetUrls: mediaUrls }, current.owner)
    let unregisterFrame: () => void
    try { unregisterFrame = this.registerFrame(lease.url, current.frame.webContentsId) }
    catch (error) {
      this.policy.releasePreviewLease(lease.leaseId, current.owner)
      throw error
    }
    const afterRegistration = this.currentOwner()
    if (!afterRegistration || !sameOwner(current.owner, afterRegistration.owner)
      || current.frame.webContentsId !== afterRegistration.frame.webContentsId) {
      unregisterFrame()
      try { this.policy.releasePreviewLease(lease.leaseId, current.owner) } catch { /* Navigation cleared the owner. */ }
      throw new Error('HTML preview main document changed while opening')
    }
    const active: ActiveLease = { public: lease, token, tabId: request.tabId, webContentsId: current.frame.webContentsId,
      owner: current.owner, rootRealPath, entryRealPath, bindingPath: snapshot.binding.path, entryName,
      mediaUrls, mediaOrigins: [...new Set(mediaUrls.map(value => new URL(value).origin))], unregisterFrame }
    for (const old of this.leases.values()) {
      if (old.tabId === request.tabId && old.webContentsId === current.frame.webContentsId) this.removeLease(old)
    }
    this.leases.set(lease.leaseId, active)
    this.byToken.set(token, active)
    return lease
  }

  async release(request: ReleaseRequest): Promise<{ released: boolean }> {
    const lease = this.leases.get(request.leaseId)
    if (!lease || lease.tabId !== request.tabId) return { released: false }
    this.removeLease(lease)
    return { released: true }
  }

  releaseDocument(documentId: string): void {
    for (const lease of this.leases.values()) if (lease.public.documentId === documentId) this.removeLease(lease)
  }

  /** Document events may arrive for ordinary edits too; only a binding change revokes access. */
  releaseChangedBinding(snapshot: DocumentSnapshot): void {
    for (const lease of this.leases.values()) {
      if (lease.public.documentId !== snapshot.documentId) continue
      if (snapshot.epoch !== lease.public.epoch || snapshot.model.kind !== 'text'
        || snapshot.binding.kind !== 'file' || snapshot.binding.bindingVersion !== lease.public.bindingVersion
        || snapshot.binding.path !== lease.bindingPath) this.removeLease(lease)
    }
  }

  releaseTab(tabId: string): void {
    for (const lease of this.leases.values()) if (lease.tabId === tabId) this.removeLease(lease)
  }

  releaseAll(): void { for (const lease of this.leases.values()) this.removeLease(lease) }
  dispose(): void { this.releaseAll(); this.disposed = true }

  private async context(leaseId: string, loadId: string): Promise<HtmlPreviewEditContext | null> {
    const lease = this.leases.get(leaseId)
    if (!lease || lease.public.loadId !== loadId) return null
    const snapshot = await this.snapshotFor(lease)
    if (!snapshot) { this.removeLease(lease); return null }
    return { lease: lease.public, tabId: lease.tabId, rootRealPath: lease.rootRealPath,
      entryRealPath: lease.entryRealPath, bindingPath: lease.bindingPath, snapshot }
  }

  /** An action session must start from the exact source revision that created its frame.
   * A later source edit requires a fresh preview lease, even if the renderer kept a
   * patched frame mounted. This avoids claiming that arbitrary JS state survived. */
  async automationContext(leaseId: string, loadId: string, revision: number): Promise<HtmlPreviewAutomationContext> {
    const lease = this.leases.get(leaseId)
    if (!lease || lease.public.loadId !== loadId) throw new Error('HTML 预览会话已失效，请重新打开预览')
    const snapshot = await this.snapshotFor(lease)
    if (!snapshot) { this.removeLease(lease); throw new Error('HTML 预览来源已失效，请重新打开预览') }
    if (lease.public.revision !== revision || snapshot.revision !== revision)
      throw new Error('HTML 源码版本已变化，请重新打开预览并观察')
    return { lease: lease.public, tabId: lease.tabId, webContentsId: lease.webContentsId,
      bindingPath: lease.bindingPath }
  }

  /** Select only an unambiguous, already mounted preview for a frozen document. */
  async automationContextForDocument(input: { documentId: string; epoch: string; revision: number;
    tabId?: string }): Promise<HtmlPreviewAutomationContext> {
    const matches = [...this.leases.values()].filter(lease => lease.public.documentId === input.documentId
      && lease.public.epoch === input.epoch && lease.public.revision === input.revision
      && (input.tabId === undefined || lease.tabId === input.tabId))
    if (matches.length !== 1) throw new HtmlPreviewUnavailableError(matches.length ? 'ambiguous' : 'missing')
    return this.automationContext(matches[0]!.public.leaseId, matches[0]!.public.loadId, input.revision)
  }

  async resolveTarget(request: ResolveRequest): Promise<{ revision: number; targets: HtmlPreviewResolvedTarget[] }> {
    const context = await this.context(request.leaseId, request.loadId)
    if (!context || request.revision !== context.snapshot.revision) throw new Error('HTML preview source changed')
    if (!this.editPort) throw new Error('HTML preview editor is not connected')
    return this.editPort.resolveTarget(request, context)
  }

  async edit(request: EditRequest): Promise<HtmlPreviewEditOutcome> {
    const digest = documentDigest(request)
    const previous = this.editReceipts.get(request.operationId)
    if (previous) return previous.digest === digest ? previous.promise : { status: 'rejected', reason: 'conflict' }
    const promise = (async (): Promise<HtmlPreviewEditOutcome> => {
      const context = await this.context(request.leaseId, request.loadId)
      if (!context || context.lease.documentId !== request.documentId || context.lease.epoch !== request.epoch) return { status: 'rejected', reason: 'lease-released' }
      if (context.lease.bindingVersion !== request.bindingVersion) return { status: 'rejected', reason: 'stale-binding' }
      if (context.snapshot.revision !== request.baseRevision) return { status: 'rejected', reason: 'stale-revision' }
      if (!this.editPort) return { status: 'rejected', reason: 'not-editable' }
      return this.editPort.edit(request, context)
    })()
    this.editReceipts.set(request.operationId, { digest, leaseId: request.leaseId, promise })
    try {
      const outcome = await promise
      if (outcome.status !== 'applied' && outcome.status !== 'unchanged') this.editReceipts.delete(request.operationId)
      return outcome
    } catch (error) {
      this.editReceipts.delete(request.operationId)
      throw error
    }
  }

  /** Install this bound handler through setHtmlPreviewProtocolHandler in Main. */
  readonly handleProtocolRequest = async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return htmlPreviewResponse('Method not allowed', { status: 405, method })
    const target = parseHtmlPreviewProtocolUrl(request.url)
    if (!target) return notFound(method)
    const lease = this.byToken.get(target.token)
    if (!lease) return notFound(method)
    const snapshot = await this.snapshotFor(lease)
    if (!snapshot) { this.removeLease(lease); return notFound(method) }
    if (target.kind === 'agent') {
      if (!this.options.agentBundlePath) return notFound(method)
      try {
        const bytes = await fs.readFile(this.options.agentBundlePath)
        if (!(await this.snapshotFor(lease))) return notFound(method)
        return htmlPreviewResponse(new Uint8Array(bytes), { contentType: 'text/javascript; charset=utf-8', method, mediaOrigins: lease.mediaOrigins })
      } catch { return notFound(method) }
    }
    const isEntry = target.relativePath === lease.entryName
    if (isEntry && target.hasQuery) return notFound(method)
    if (isEntry) {
      const source = snapshot.model.kind === 'text' ? snapshot.model.source : ''
      // The entry always comes from the canonical source. Its media grants must
      // follow that same revision when an edit adds or removes a remote asset.
      const mediaUrls = await collectHtmlPreviewMediaUrls(source, lease.rootRealPath)
      const current = await this.snapshotFor(lease)
      if (!current || current.revision !== snapshot.revision || current.model.kind !== 'text'
        || current.model.source !== source) return notFound(method)
      try {
        this.policy.replacePreviewLease({ leaseId: lease.public.leaseId, connectOrigins: [], remoteAssetUrls: mediaUrls }, lease.owner)
      } catch { return notFound(method) }
      lease.mediaUrls = mediaUrls
      lease.mediaOrigins = [...new Set(mediaUrls.map(value => new URL(value).origin))]
      const script = this.options.agentBundlePath
        ? `<script src="/${lease.token}/_agent/${HTML_PREVIEW_AGENT_PATH}"></script>` : ''
      const normalized = normalizeHtmlPreviewMediaReferences(source, lease.mediaUrls)
      const body = script ? injectEarlyPreviewAgent(normalized, script) : normalized
      if (!(await this.snapshotFor(lease))) return notFound(method)
      return htmlPreviewResponse(body, { contentType: 'text/html; charset=utf-8', method, mediaOrigins: lease.mediaOrigins })
    }
    const filename = await resolveHtmlPreviewResource(lease.rootRealPath, target.relativePath)
    const contentType = filename && htmlPreviewContentType(filename)
    if (!filename || !contentType) return notFound(method)
    try {
      let bytes: Uint8Array | null = method === 'HEAD' ? null : new Uint8Array(await fs.readFile(filename))
      if (bytes && contentType.startsWith('text/css')) {
        try {
          const original = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          const normalized = normalizeCssPreviewMediaReferences(original, lease.mediaUrls)
          if (normalized !== original) bytes = new TextEncoder().encode(normalized)
        } catch { /* Keep unsupported CSS bytes intact; they do not gain remote access. */ }
      }
      if (!(await this.snapshotFor(lease))) return notFound(method)
      const targetNow = await resolveHtmlPreviewResource(lease.rootRealPath, target.relativePath)
      if (targetNow !== filename) return notFound(method)
      return htmlPreviewResponse(bytes, { contentType, method, mediaOrigins: lease.mediaOrigins })
    } catch { return notFound(method) }
  }
}
