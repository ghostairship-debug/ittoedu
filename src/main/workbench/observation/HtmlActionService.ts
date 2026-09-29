import { randomUUID } from 'node:crypto'
import type { ObservationImageResource } from '../../../shared/workbench/toolPorts'
import type { HtmlPreviewAutomationContext, HtmlPreviewService } from '../htmlPreview/HtmlPreviewService'
import { ObservationImageStore } from './ObservationImageStore'
import type { HtmlActionCapture, HtmlActionDiagnostic, HtmlActionFramePort } from './HtmlActionDesktopPort'
import { sameHtmlPreviewDocumentUrl, type HtmlPageElement, type HtmlPageState } from './HtmlActionPageScript'

export interface HtmlActionIdentity {
  runId: string
  documentId: string
  epoch: string
  revision: number
  bindingVersion: number
  leaseId: string
  loadId: string
  url: string
}

export interface HtmlActionObservation {
  identity: HtmlActionIdentity
  source: 'live-html-preview'
  generation: number
  currentUrl: string
  title: string
  readyState: string
  pageIndex: number
  pageCount: number
  structure: string[]
  diagnostics: string[]
  errors: HtmlActionDiagnostic[]
  elements: Array<Omit<HtmlPageElement, 'path' | 'fingerprint'> & { handle: string }>
  image: ObservationImageResource
}

interface ActionSession {
  identity: HtmlActionIdentity
  context: HtmlPreviewAutomationContext
  frameToken: string
  generation: number
  handles: Map<string, HtmlPageElement>
  errors: HtmlActionDiagnostic[]
  actionReceipts: Map<string, { digest: string; promise: Promise<HtmlActionObservation> }>
  unsubscribeErrors: () => void
  stopped: boolean
  busy: boolean
}

export class HtmlActionService {
  private readonly runs = new Map<string, ActionSession>()
  private readonly opening = new Set<string>()
  private readonly cancelledOpening = new Set<string>()
  private readonly stoppedRuns = new Set<string>()
  /** A host call ID remains spent across a source-revision restart, including unknown outcomes. */
  private readonly usedActionIds = new Map<string, Set<string>>()

  constructor(private readonly options: { preview: HtmlPreviewService; frames: HtmlActionFramePort;
    images: ObservationImageStore }) {}

  async beginRun(runId: string, input: { leaseId: string; loadId: string; revision: number }): Promise<HtmlActionIdentity> {
    if (!runId || !input.leaseId || !input.loadId || !Number.isSafeInteger(input.revision) || input.revision < 0)
      throw new Error('HTML 观察身份无效')
    return this.beginFromContext(runId, () => this.options.preview.automationContext(input.leaseId, input.loadId, input.revision))
  }

  async beginDocumentRun(runId: string, input: { documentId: string; epoch: string; revision: number;
    tabId?: string }): Promise<HtmlActionIdentity> {
    if (!runId || !input.documentId || !input.epoch || !Number.isSafeInteger(input.revision) || input.revision < 0)
      throw new Error('HTML 文档观察身份无效')
    return this.beginFromContext(runId, () => this.options.preview.automationContextForDocument(input))
  }

  /** Explicitly replace the observation epoch after a canonical source revision.
   * The document, epoch, binding and run stay fixed; Stop is irreversible. */
  async restartDocumentRun(runId: string, input: { documentId: string; epoch: string; revision: number;
    tabId?: string }): Promise<HtmlActionIdentity> {
    const old = this.require(runId)
    if (old.busy || this.opening.has(runId)) throw new Error('HTML 操作尚未完成，不能重开观察')
    if (input.documentId !== old.identity.documentId || input.epoch !== old.identity.epoch
      || !Number.isSafeInteger(input.revision) || input.revision < 0
      || input.revision === old.identity.revision) throw new Error('HTML 重开必须使用同一文档的新正式版本')
    this.opening.add(runId)
    try {
      const context = await this.options.preview.automationContextForDocument(input)
      const frameToken = await this.options.frames.frameToken(context)
      if (this.stoppedRuns.has(runId) || this.cancelledOpening.has(runId)
        || this.runs.get(runId) !== old || old.stopped) throw new Error('HTML 观察已停止')
      if (context.lease.documentId !== old.identity.documentId || context.lease.epoch !== old.identity.epoch
        || context.lease.bindingVersion !== old.identity.bindingVersion
        || context.bindingPath !== old.context.bindingPath) throw new Error('HTML 文档绑定已变化，不能沿用本任务观察会话')
      this.retire(old)
      return this.attach(runId, context, frameToken)
    } finally { this.opening.delete(runId); this.cancelledOpening.delete(runId) }
  }

  private async beginFromContext(runId: string,
    locate: () => Promise<HtmlPreviewAutomationContext>): Promise<HtmlActionIdentity> {
    if (this.stoppedRuns.has(runId)) throw new Error('HTML 观察已停止')
    if (this.runs.has(runId) || this.opening.has(runId)) throw new Error('本次任务已有 HTML 观察会话')
    this.opening.add(runId)
    try {
      const context = await locate()
      const frameToken = await this.options.frames.frameToken(context)
      if (this.cancelledOpening.has(runId)) throw new Error('HTML 观察已停止')
      return this.attach(runId, context, frameToken)
    } finally { this.opening.delete(runId); this.cancelledOpening.delete(runId) }
  }

  private attach(runId: string, context: HtmlPreviewAutomationContext, frameToken: string): HtmlActionIdentity {
    const identity: HtmlActionIdentity = { runId, documentId: context.lease.documentId,
      epoch: context.lease.epoch, revision: context.lease.revision, bindingVersion: context.lease.bindingVersion,
      leaseId: context.lease.leaseId, loadId: context.lease.loadId, url: context.lease.url }
    const session: ActionSession = { identity, context, frameToken, generation: 0, handles: new Map(),
      errors: [], actionReceipts: new Map(), unsubscribeErrors: () => {}, stopped: false, busy: false }
    session.unsubscribeErrors = this.options.frames.onDiagnostic(context, frameToken, diagnostic => {
      if (!session.stopped) {
        session.errors.push(diagnostic)
        if (session.errors.length > 32) session.errors.shift()
      }
    })
    this.runs.set(runId, session)
    return identity
  }

  private retire(session: ActionSession): void {
    session.stopped = true
    session.handles.clear()
    session.unsubscribeErrors()
    this.options.images.clearRun(session.identity.runId)
    if (this.runs.get(session.identity.runId) === session) this.runs.delete(session.identity.runId)
  }

  private require(runId: string): ActionSession {
    const session = this.runs.get(runId)
    if (!session || session.stopped) throw new Error('HTML 观察会话已停止或不存在')
    return session
  }

  private async assertCurrent(session: ActionSession): Promise<void> {
    if (session.stopped || this.runs.get(session.identity.runId) !== session) throw new Error('HTML 观察已停止')
    const current = await this.options.preview.automationContext(session.identity.leaseId,
      session.identity.loadId, session.identity.revision)
    if (current.webContentsId !== session.context.webContentsId || current.bindingPath !== session.context.bindingPath
      || await this.options.frames.frameToken(current) !== session.frameToken)
      throw new Error('HTML 预览页面已切换，请重新开始观察')
    if (session.stopped || this.runs.get(session.identity.runId) !== session) throw new Error('HTML 观察已停止')
  }

  private async observeCurrent(session: ActionSession): Promise<HtmlActionObservation> {
    await this.assertCurrent(session)
    const state: HtmlPageState = await this.options.frames.observe(session.context, session.frameToken)
    const capture: HtmlActionCapture = await this.options.frames.capture(session.context, session.frameToken)
    await this.assertCurrent(session)
    if (!sameHtmlPreviewDocumentUrl(state.url, session.identity.url))
      throw new Error('HTML 页面来源已变化，请重新打开预览')
    const image = this.options.images.put(session.identity.runId, capture.png, capture.width, capture.height)
    session.generation += 1
    session.handles.clear()
    const elements = state.elements.slice(0, 120).map(element => {
      const handle = randomUUID()
      session.handles.set(handle, element)
      const { path: _path, fingerprint: _fingerprint, ...report } = element
      return { ...report, handle }
    })
    return { identity: session.identity, source: 'live-html-preview', generation: session.generation,
      currentUrl: state.url,
      title: state.title, readyState: state.readyState, pageIndex: state.pageIndex, pageCount: state.pageCount,
      structure: state.structure.slice(0, 32), diagnostics: state.diagnostics.slice(0, 32),
      errors: [...session.errors], elements, image }
  }

  async observe(runId: string): Promise<HtmlActionObservation> {
    const session = this.require(runId)
    if (session.busy) throw new Error('HTML 操作尚未完成')
    session.busy = true
    try { return await this.observeCurrent(session) } finally { session.busy = false }
  }

  async navigate(runId: string, index: number): Promise<HtmlActionObservation> {
    if (!Number.isSafeInteger(index) || index < 0 || index > 10_000) throw new Error('HTML 页码无效')
    const session = this.require(runId)
    if (session.busy) throw new Error('HTML 操作尚未完成')
    session.busy = true
    session.handles.clear()
    try {
      await this.assertCurrent(session)
      await this.options.frames.navigate(session.context, session.frameToken, index)
      return await this.observeCurrent(session)
    } finally { session.busy = false }
  }

  private action(runId: string, operationId: string, handle: string,
    input: { type: 'click' } | { type: 'input'; value: string }): Promise<HtmlActionObservation> {
    const session = this.require(runId)
    if (!operationId || operationId.length > 256) throw new Error('HTML 操作身份无效')
    const digest = JSON.stringify({ handle, input })
    const prior = session.actionReceipts.get(operationId)
    if (prior) {
      if (prior.digest !== digest) throw new Error('HTML 操作身份冲突')
      return prior.promise
    }
    const used = this.usedActionIds.get(runId) ?? new Set<string>()
    if (used.has(operationId)) throw new Error('HTML 操作身份已在旧观察会话使用，不能重发')
    if (session.busy) throw new Error('HTML 操作尚未完成')
    const target = session.handles.get(handle)
    if (!target) throw new Error('HTML 元素句柄已过期，请重新观察')
    if (input.type === 'input' && input.value.length > 8192) throw new Error('HTML 输入超出允许范围')
    used.add(operationId)
    this.usedActionIds.set(runId, used)
    session.busy = true
    session.handles.clear()
    const promise = (async () => {
      try {
        await this.assertCurrent(session)
        const result = await this.options.frames.act(session.context, session.frameToken,
          { ...input, path: target.path, fingerprint: target.fingerprint })
        await this.assertCurrent(session)
        if (!result.applied) throw new Error(result.reason === 'stale-element'
          ? 'HTML 元素已变化，请重新观察' : `HTML 操作未应用：${result.reason ?? '未知原因'}`)
        return await this.observeCurrent(session)
      } finally { session.busy = false }
    })()
    // Keep failed/unknown receipts: repeating an operation ID must not click twice.
    session.actionReceipts.set(operationId, { digest, promise })
    return promise
  }

  click(runId: string, input: { operationId: string; handle: string }): Promise<HtmlActionObservation> {
    return this.action(runId, input.operationId, input.handle, { type: 'click' })
  }

  input(runId: string, input: { operationId: string; handle: string; value: string }): Promise<HtmlActionObservation> {
    return this.action(runId, input.operationId, input.handle, { type: 'input', value: input.value })
  }

  async errors(runId: string): Promise<{ identity: HtmlActionIdentity; errors: HtmlActionDiagnostic[] }> {
    const session = this.require(runId)
    await this.assertCurrent(session)
    return { identity: session.identity, errors: [...session.errors] }
  }

  readResource(runId: string, resourceId: string): { mimeType: string; bytes: Uint8Array } {
    this.require(runId)
    return this.options.images.read(runId, resourceId)
  }

  stopRun(runId: string): void {
    this.stoppedRuns.add(runId)
    if (this.opening.has(runId)) this.cancelledOpening.add(runId)
    const session = this.runs.get(runId)
    if (!session) return
    this.retire(session)
  }
}
