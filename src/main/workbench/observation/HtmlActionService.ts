import { randomUUID } from 'node:crypto'
import { htmlActionToolSchemas, type HtmlActionToolName } from '../../../core/tools/HtmlActionTools'
import type { ObservationImageResource, ObservationResult } from '../../../shared/workbench/toolPorts'
import type { HtmlPreviewAutomationContext } from '../htmlPreview/HtmlPreviewService'
import { ObservationImageStore } from './ObservationImageStore'
import type { HtmlActionCapture, HtmlActionDiagnostic, HtmlActionFramePort } from './HtmlActionDesktopPort'
import type { PublishedActionAutomationContext } from './HtmlActionDesktopPort'
import type { ViewObservationIdentity, ViewObservationSnapshot } from '../../../shared/workbench/viewObservation'
import { sameHtmlPreviewDocumentUrl, type HtmlPageElement, type HtmlPageState } from './HtmlActionPageScript'

/** Bootstrap query bytes belong to the host transport, not the observed content report. */
function reportUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'courseware-editor:' || url.hostname !== 'app'
      || !/^\/_observation\/[^/]+\/bootstrap\//.test(url.pathname) || !url.searchParams.has('html')) return value
    url.searchParams.delete('html')
    return url.href
  } catch { return value }
}

const reportErrors = (errors: HtmlActionDiagnostic[]) => errors.map(error => ({ ...error, source: reportUrl(error.source) }))

/** Facts about this invocation, kept independently from follow-up evidence. */
export interface ActionReceiptFacts {
  operationId?: string
  dispatch: 'not_dispatched' | 'dispatched'
  application: 'not_applied' | 'applied' | 'unknown'
  goal: 'achieved' | 'mismatch' | 'unverified'
  observation: 'not_requested' | 'complete' | 'failed'
}

export interface HtmlActionPreviewPort {
  automationContext(leaseId: string, loadId: string, revision: number): Promise<HtmlPreviewAutomationContext>
  automationContextForDocument(input: { documentId: string; epoch: string; revision: number; tabId?: string; runId?: string }): Promise<HtmlPreviewAutomationContext>
  releaseRun?(runId: string): void
}

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
  actionReceipt?: ActionReceiptFacts
  identity: HtmlActionIdentity
  source: 'live-html-preview' | 'isolated-html-preview'
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
  elementsPage?: { generation: number; query: string; offset: number; limit: number; total: number; nextCursor?: string }
  observationScope?: HtmlPageState['observationScope']
  image: ObservationImageResource
}
export type PublishedActionIdentity = ViewObservationIdentity & { projectId: string }
export interface PublishedActionTarget { identity: PublishedActionIdentity; snapshot: ViewObservationSnapshot; signal?: AbortSignal }
export interface PublishedActionPreviewPort {
  contextForTarget(input: PublishedActionTarget & { runId: string }): Promise<PublishedActionAutomationContext>
  currentContext(context: PublishedActionAutomationContext): Promise<PublishedActionAutomationContext>
  readState(context: PublishedActionAutomationContext): Promise<{ locationId: string; stateId: string | null; structure: string[]; diagnostics: string[] }>
  releaseContext?(context: PublishedActionAutomationContext): void
  releaseRun?(runId: string): void
}
export interface PublishedActionObservation extends Omit<HtmlActionObservation, 'identity' | 'source'> {
  identity: PublishedActionIdentity
  source: 'isolated-published'
  coverage: ObservationResult['coverage']
}
type PageActionObservation = HtmlActionObservation | PublishedActionObservation
export interface HtmlObservationInput {
  purpose?: 'required' | 'diagnostic'
  query?: string
  offset?: number
  limit?: number
  cursor?: string
  detail?: 'overview' | 'full'
}
interface ObservationCursor {
  generation: number
  query: string
  offset: number
  limit: number
  detail: 'overview' | 'full'
}

interface SessionState {
  runId: string
  frameToken: string
  generation: number
  handles: Map<string, HtmlPageElement>
  lastObservation?: HtmlActionObservation
  observationPageSize: number
  cursors: Map<string, ObservationCursor>
  errors: HtmlActionDiagnostic[]
  actionReceipts: Map<string, { digest: string; promise: Promise<PageActionObservation> }>
  unsubscribeErrors: () => void
  stopped: boolean
  busy: boolean
}
type ActionSession = SessionState & (
  | { kind: 'html'; identity: HtmlActionIdentity; context: HtmlPreviewAutomationContext }
  | { kind: 'published'; identity: PublishedActionIdentity; context: PublishedActionAutomationContext })

export class HtmlActionService {
  private readonly runs = new Map<string, ActionSession>()
  private readonly opening = new Set<string>()
  private readonly runLifetimes = new Map<string, AbortController>()
  private readonly stoppedRuns = new Set<string>()
  private disposed = false
  /** A host call ID remains spent across a source-revision restart, including unknown outcomes. */
  private readonly usedActionIds = new Map<string, Set<string>>()

  constructor(private readonly options: { preview: HtmlActionPreviewPort; frames: HtmlActionFramePort;
    images: ObservationImageStore; published?: PublishedActionPreviewPort }) {}

  /** The browser transport may never acknowledge a destroyed or hung frame. Stop
   * ends our wait, while frame validity checks prevent late input dispatch. An
   * issued action still keeps its unknown receipt; cancellation never retries it. */
  private waitForRun<T>(runId: string, operation: (signal: AbortSignal) => Promise<T>, releaseLate?: (value: T) => void): Promise<T> {
    if (this.disposed || this.stoppedRuns.has(runId)) return Promise.reject(new Error('页面观察已停止'))
    let lifetime = this.runLifetimes.get(runId)
    if (!lifetime) { lifetime = new AbortController(); this.runLifetimes.set(runId, lifetime) }
    const { signal } = lifetime
    return new Promise<T>((resolve, reject) => {
      const stop = () => reject(new Error('页面观察已停止'))
      signal.addEventListener('abort', stop, { once: true })
      const complete = () => signal.removeEventListener('abort', stop)
      try {
        operation(signal).then(value => {
          complete()
          if (signal.aborted) { releaseLate?.(value); return }
          resolve(value)
        }, error => { complete(); reject(error) }).catch(reject)
      } catch (error) { complete(); reject(error) }
    })
  }

  /** Both Engine and Gateway bind the document and action ID before calling
   * this same service. Only observe can refresh a changed canonical revision. */
  async executeDocumentAction(runId: string,
    document: { documentId: string; epoch: string; revision: number; tabId?: string },
    action: { name: HtmlActionToolName; input: unknown; operationId?: string },
  ): Promise<HtmlActionObservation | { identity: HtmlActionIdentity; errors: HtmlActionDiagnostic[] }> {
    const input = htmlActionToolSchemas[action.name].parse(action.input) as HtmlObservationInput & { index?: number; handle?: string; value?: string }
    const current = this.runs.get(runId)
    if (action.name === 'html.observe' && input.cursor) {
      const query = current?.cursors.get(input.cursor)?.query ?? input.query ?? ''
      if (current?.kind !== 'html' || current.identity.documentId !== document.documentId
        || current.identity.epoch !== document.epoch || current.identity.revision !== document.revision)
        throw this.cursorExpired(query)
      return this.observe(runId, input)
    }
    if (current?.kind === 'published') {
      if (action.name !== 'html.observe') throw new Error('当前观察是课件页面，请使用对应的课件页面动作')
      if (current.busy) throw new Error('页面操作尚未完成')
      this.retire(current)
    }
    const session = this.runs.get(runId)
    const changedDocument = session && (session.identity.documentId !== document.documentId || session.identity.epoch !== document.epoch)
    if (changedDocument && action.name !== 'html.observe')
      throw new Error('HTML 任务目标已变化，不能沿用其他文档的观察会话')
    if (action.name === 'html.observe') {
      if (!session) await this.beginDocumentRun(runId, document)
      else if (changedDocument || session.identity.revision !== document.revision) await this.restartDocumentRun(runId, document)
      return this.observe(runId, input)
    }
    if (!session || session.identity.revision !== document.revision)
      throw new Error('请先观察当前 HTML 源码版本，再执行页面动作')
    if (action.name === 'html.navigate') return this.navigate(runId, input.index!, action.operationId)
    if (action.name === 'html.errors') return this.errors(runId)
    if (!action.operationId) throw new Error('HTML 操作缺少宿主执行身份')
    return action.name === 'html.click'
      ? this.click(runId, { operationId: action.operationId, handle: input.handle! })
      : this.input(runId, { operationId: action.operationId, handle: input.handle!, value: input.value! })
  }

  async beginRun(runId: string, input: { leaseId: string; loadId: string; revision: number }): Promise<HtmlActionIdentity> {
    if (!runId || !input.leaseId || !input.loadId || !Number.isSafeInteger(input.revision) || input.revision < 0)
      throw new Error('HTML 观察身份无效')
    return this.beginFromContext(runId, () => this.options.preview.automationContext(input.leaseId, input.loadId, input.revision))
  }

  async beginDocumentRun(runId: string, input: { documentId: string; epoch: string; revision: number;
    tabId?: string }): Promise<HtmlActionIdentity> {
    if (!runId || !input.documentId || !input.epoch || !Number.isSafeInteger(input.revision) || input.revision < 0)
      throw new Error('HTML 文档观察身份无效')
    return this.beginFromContext(runId, () => this.options.preview.automationContextForDocument({ ...input, runId }))
  }

  /** Explicit observation captures the current authorized document or revision.
   * Old handles retire; action identities remain spent and Stop stays irreversible. */
  async restartDocumentRun(runId: string, input: { documentId: string; epoch: string; revision: number;
    tabId?: string }): Promise<HtmlActionIdentity> {
    const old = this.requireHtml(runId)
    if (old.busy || this.opening.has(runId)) throw new Error('HTML 操作尚未完成，不能重开观察')
    const sameDocument = input.documentId === old.identity.documentId && input.epoch === old.identity.epoch
    if (!input.documentId || !input.epoch || !Number.isSafeInteger(input.revision) || input.revision < 0
      || sameDocument && input.revision === old.identity.revision) throw new Error('HTML 重开需要当前文档的新观察')
    this.opening.add(runId)
    try {
      const context = await this.waitForRun(runId, () => this.options.preview.automationContextForDocument({ ...input, runId }),
        () => this.options.preview.releaseRun?.(runId))
      const frameToken = await this.waitForRun(runId, () => this.options.frames.frameToken(context))
      if (this.stoppedRuns.has(runId)
        || this.runs.get(runId) !== old || old.stopped) throw new Error('HTML 观察已停止')
      if (context.lease.documentId !== input.documentId || context.lease.epoch !== input.epoch
        || context.lease.revision !== input.revision
        || sameDocument && (context.lease.bindingVersion !== old.identity.bindingVersion
          || context.bindingPath !== old.context.bindingPath)) throw new Error('HTML 文档绑定与本次观察不一致')
      const previous = { generation: old.generation, cursors: new Map(old.cursors) }
      this.retire(old, sameDocument)
      return this.attach(runId, context, frameToken, previous)
    } finally { this.opening.delete(runId) }
  }

  private async beginFromContext(runId: string,
    locate: () => Promise<HtmlPreviewAutomationContext>): Promise<HtmlActionIdentity> {
    if (this.disposed || this.stoppedRuns.has(runId)) throw new Error('HTML 观察已停止')
    if (this.runs.has(runId) || this.opening.has(runId)) throw new Error('本次任务已有 HTML 观察会话')
    this.opening.add(runId)
    try {
      const context = await this.waitForRun(runId, locate, () => this.options.preview.releaseRun?.(runId))
      const frameToken = await this.waitForRun(runId, () => this.options.frames.frameToken(context))
      if (this.stoppedRuns.has(runId)) throw new Error('HTML 观察已停止')
      return this.attach(runId, context, frameToken)
    } finally { this.opening.delete(runId) }
  }

  private attach(runId: string, context: HtmlPreviewAutomationContext, frameToken: string,
    previous?: Pick<SessionState, 'generation' | 'cursors'>): HtmlActionIdentity {
    const identity: HtmlActionIdentity = { runId, documentId: context.lease.documentId,
      epoch: context.lease.epoch, revision: context.lease.revision, bindingVersion: context.lease.bindingVersion,
      leaseId: context.lease.leaseId, loadId: context.lease.loadId, url: context.lease.url }
    const session: ActionSession = { kind: 'html', runId, identity, context, frameToken, generation: previous?.generation ?? 0, handles: new Map(),
      cursors: previous?.cursors ?? new Map(), observationPageSize: 120,
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

  private retire(session: ActionSession, retainImages = false): void {
    session.stopped = true
    session.handles.clear()
    session.lastObservation = undefined
    session.cursors.clear()
    session.unsubscribeErrors()
    if (session.kind === 'published') this.options.published?.releaseContext?.(session.context)
    // A newer revision retires action authority, not the task's captured source.
    // Historical pixels remain readable until target ownership changes or Stop.
    if (!retainImages) void this.options.images.clearRun(session.runId).catch(() => undefined)
    if (this.runs.get(session.runId) === session) this.runs.delete(session.runId)
  }

  private require(runId: string): ActionSession {
    const session = this.runs.get(runId)
    if (this.disposed || !session || session.stopped) throw new Error('HTML 观察会话已停止或不存在')
    return session
  }
  private requireHtml(runId: string): Extract<ActionSession, { kind: 'html' }> {
    const session = this.require(runId)
    if (session.kind !== 'html') throw new Error('当前任务没有HTML文档观察会话')
    return session
  }
  private requirePublished(runId: string): Extract<ActionSession, { kind: 'published' }> {
    const session = this.require(runId)
    if (session.kind !== 'published') throw new Error('请先观察当前课件页面，再执行页面动作')
    return session
  }

  private async assertCurrent(session: ActionSession): Promise<void> {
    if (session.stopped || this.runs.get(session.runId) !== session) throw new Error('HTML 观察已停止')
    if (session.kind === 'published') {
      const current = await this.waitForRun(session.runId, () => this.options.published!.currentContext(session.context))
      if (current.webContentsId !== session.context.webContentsId || current.frameProcessId !== session.context.frameProcessId
        || await this.waitForRun(session.runId, () => this.options.frames.frameToken(current)) !== session.frameToken) throw new Error('课件观察载体已切换，请重新观察')
      if (session.stopped || this.runs.get(session.context.runId) !== session) throw new Error('课件观察已停止')
      return
    }
    const current = await this.waitForRun(session.runId, () => this.options.preview.automationContext(session.identity.leaseId,
      session.identity.loadId, session.identity.revision))
    if (current.webContentsId !== session.context.webContentsId || current.bindingPath !== session.context.bindingPath
      || await this.waitForRun(session.runId, () => this.options.frames.frameToken(current)) !== session.frameToken)
      throw new Error('HTML 预览页面已切换，请重新开始观察')
    if (session.stopped || this.runs.get(session.runId) !== session) throw new Error('HTML 观察已停止')
  }

  private cursorExpired(query: string, cause?: unknown): Error {
    const refresh = { tool: 'html.observe', input: { query } }
    return Object.assign(new Error(`HTML 观察游标已失效；请直接执行 html.observe ${JSON.stringify(refresh.input)} 重新捕获当前版本。${cause instanceof Error ? ` 原因：${cause.message}` : ''}`),
      { code: 'html-observation-cursor-expired', refresh })
  }

  private observationPage(session: Extract<ActionSession, { kind: 'html' }>, snapshot: HtmlActionObservation,
    input: Omit<HtmlObservationInput, 'cursor'> = {}): HtmlActionObservation {
    const query = input.query?.trim() ?? '', search = query.toLocaleLowerCase()
    const detail = input.detail ?? 'overview'
    const elements = search ? snapshot.elements.filter(element => [element.tag, element.role, element.label, element.text, element.value ?? '']
      .some(value => value.toLocaleLowerCase().includes(search))) : snapshot.elements
    const offset = input.offset ?? 0, limit = input.limit ?? (detail === 'full' ? Math.max(1, elements.length) : session.observationPageSize)
    const page = elements.slice(offset, offset + limit)
    let nextCursor: string | undefined
    if (offset + page.length < elements.length) {
      nextCursor = randomUUID()
      session.cursors.set(nextCursor, { generation: snapshot.generation, query, offset: offset + page.length, limit, detail })
    }
    const result = { ...snapshot, elements: page,
      structure: search ? snapshot.structure.filter(segment => segment.toLocaleLowerCase().includes(search)) : snapshot.structure,
      elementsPage: { generation: snapshot.generation, query, offset, limit, total: elements.length, ...(nextCursor ? { nextCursor } : {}) },
      // RunStore keeps the complete captured facts; the model projection owns
      // its ordinary window. The snapshot itself never points back to a page.
      fullObservation: snapshot }
    return result
  }

  /** Capture every candidate once; the HTML response window is applied only
   * after all handles exist. Published consumers receive the complete result. */
  private observeCurrent(session: Extract<ActionSession, { kind: 'html' }>, input?: HtmlObservationInput): Promise<HtmlActionObservation>
  private observeCurrent(session: Extract<ActionSession, { kind: 'published' }>): Promise<PublishedActionObservation>
  private observeCurrent(session: ActionSession): Promise<PageActionObservation>
  private async observeCurrent(session: ActionSession, input?: HtmlObservationInput): Promise<PageActionObservation> {
    session.lastObservation = undefined
    await this.assertCurrent(session)
    const combined = this.options.frames.observeAndCapture
      ? await this.waitForRun(session.runId, signal => this.options.frames.observeAndCapture!(session.context, session.frameToken, signal)) : undefined
    const state: HtmlPageState = combined?.state ?? await this.waitForRun(session.runId, () => this.options.frames.observe(session.context, session.frameToken))
    const capture: HtmlActionCapture = combined?.capture ?? await this.waitForRun(session.runId, () => this.options.frames.capture(session.context, session.frameToken))
    await this.assertCurrent(session)
    if (!sameHtmlPreviewDocumentUrl(state.url, session.kind === 'html' ? session.identity.url : session.context.url))
      throw new Error('HTML 页面来源已变化，请重新打开预览')
    const image = await this.options.images.put(session.kind === 'html' ? session.runId : session.context.runId, capture.png, capture.width, capture.height)
    await this.assertCurrent(session)
    session.generation += 1
    session.handles.clear()
    const frameElements = new Map<string, HtmlPageElement[]>()
    for (const element of state.elements) {
      const frame = `${element.frameProcessId ?? ''}:${element.frameToken ?? ''}`
      const entries = frameElements.get(frame) ?? []
      entries.push(element); frameElements.set(frame, entries)
    }
    // Keep the former first 120 candidates of every visible frame reachable in
    // the first overview, then continue through the remaining frame blocks.
    const ordered: HtmlPageElement[] = []
    for (let offset = 0; ordered.length < state.elements.length; offset += 120)
      for (const entries of frameElements.values()) ordered.push(...entries.slice(offset, offset + 120))
    session.observationPageSize = 120 * Math.max(1, frameElements.size,
      state.observationScope?.frames.filter(frame => frame.status === 'observed').length ?? 0)
    const elements = ordered.map(element => {
      const handle = randomUUID()
      session.handles.set(handle, element)
      const { path: _path, fingerprint: _fingerprint, frameToken: _frameToken, frameProcessId: _frameProcessId, ...report } = element
      return { ...report, handle }
    })
    const common = { generation: session.generation,
      currentUrl: reportUrl(state.url),
      title: state.title, readyState: state.readyState, pageIndex: state.pageIndex, pageCount: state.pageCount,
      structure: state.structure, diagnostics: state.diagnostics,
      errors: reportErrors(session.errors), elements, image, observationScope: state.observationScope && { ...state.observationScope,
        frames: state.observationScope.frames.map(frame => ({ ...frame, url: reportUrl(frame.url) })),
        truncatedStructureSegments: 0, truncatedDiagnostics: 0 } }
    if (session.kind === 'html') {
      const snapshot: HtmlActionObservation = { ...common, identity: { ...session.identity, url: reportUrl(session.identity.url) },
        source: session.context.source === 'isolated' ? 'isolated-html-preview' : 'live-html-preview' }
      session.lastObservation = snapshot
      return this.observationPage(session, snapshot, input)
    }
    const runtime = await this.waitForRun(session.runId, () => this.options.published!.readState(session.context))
    await this.assertCurrent(session)
    session.identity = { ...session.identity, locationId: runtime.locationId, stateId: runtime.stateId }
    return { ...common, source: 'isolated-published', identity: session.identity,
      structure: [...new Set([...runtime.structure, ...common.structure])],
      diagnostics: [...new Set([...runtime.diagnostics, ...common.diagnostics])], coverage: { width: capture.width, height: capture.height,
        ...((state.observationScope?.viewport ?? state.viewport) ? { viewport: state.observationScope?.viewport ?? state.viewport } : {}) } }
  }

  async observe(runId: string, value: HtmlObservationInput = {}): Promise<HtmlActionObservation> {
    const input = htmlActionToolSchemas['html.observe'].parse(value)
    const session = this.requireHtml(runId)
    if (session.busy) throw new Error('HTML 操作尚未完成')
    session.busy = true
    try {
      if (!input.cursor) return await this.observeCurrent(session, input)
      const cursor = session.cursors.get(input.cursor), query = cursor?.query ?? input.query ?? ''
      try { await this.assertCurrent(session) } catch (cause) { throw this.cursorExpired(query, cause) }
      if (!cursor || !session.lastObservation || cursor.generation !== session.generation
        || cursor.generation !== session.lastObservation.generation) throw this.cursorExpired(query)
      if (input.query !== undefined && input.query.trim().toLocaleLowerCase() !== cursor.query.toLocaleLowerCase()
        || input.offset !== undefined && input.offset !== cursor.offset || input.limit !== undefined && input.limit !== cursor.limit
        || input.detail !== undefined && input.detail !== cursor.detail) throw this.cursorExpired(query)
      return this.observationPage(session, session.lastObservation, cursor)
    } finally { session.busy = false }
  }

  async navigate(runId: string, index: number, operationId?: string): Promise<HtmlActionObservation> {
    if (!Number.isSafeInteger(index) || index < 0 || index > 10_000) throw new Error('HTML 页码无效')
    const session = this.requireHtml(runId)
    const digest = JSON.stringify({ type: 'navigate', index })
    if (operationId) {
      if (operationId.length > 256) throw new Error('HTML 操作身份无效')
      const prior = session.actionReceipts.get(operationId)
      if (prior) {
        if (prior.digest !== digest) throw new Error('HTML 操作身份冲突')
        return prior.promise as Promise<HtmlActionObservation>
      }
      const used = this.usedActionIds.get(runId) ?? new Set<string>()
      if (used.has(operationId)) throw new Error('HTML 操作身份已在旧观察会话使用，不能重发')
    }
    if (session.busy) throw new Error('HTML 操作尚未完成')
    if (operationId) {
      const used = this.usedActionIds.get(runId) ?? new Set<string>()
      used.add(operationId)
      this.usedActionIds.set(runId, used)
    }
    session.busy = true
    session.handles.clear()
    session.lastObservation = undefined
    const facts: ActionReceiptFacts = { ...(operationId ? { operationId } : {}), dispatch: 'not_dispatched',
      application: 'not_applied', goal: 'unverified', observation: 'not_requested' }
    const promise = (async () => {
      try {
        await this.assertCurrent(session)
        facts.dispatch = 'dispatched'; facts.application = 'unknown'
        await this.waitForRun(runId, () => this.options.frames.navigate(session.context, session.frameToken, index))
        facts.application = 'applied'
        facts.observation = 'failed'
        const observation = await this.observeCurrent(session)
        facts.observation = 'complete'
        // The existing navigation owner clamps the requested index to its pages.
        facts.goal = observation.pageIndex === Math.min(index, Math.max(0, observation.pageCount - 1)) ? 'achieved' : 'mismatch'
        return { ...observation, actionReceipt: { ...facts } }
      } catch (cause) { throw this.actionFailure(session, facts, cause) }
      finally { session.busy = false }
    })()
    if (operationId) session.actionReceipts.set(operationId, { digest, promise })
    return promise
  }

  private actionFailure(session: ActionSession, facts: ActionReceiptFacts, cause: unknown): Error {
    const family = session.kind === 'html' ? 'html' : 'view'
    const detail = cause instanceof Error ? ` 原因：${cause.message}` : ''
    const error = facts.application === 'unknown'
      ? Object.assign(new Error(`页面动作结果未知；动作已经发出，请先用 ${family}.observe 查证当前页面，不要重新提交点击或输入。${detail}`),
        { code: `${family}-action-outcome-unknown` })
      : facts.application === 'applied' && facts.observation === 'failed'
        ? Object.assign(new Error(`页面动作已确认应用，但后续观察失败；请用 ${family}.observe 继续查证，不要重复提交该动作。${detail}`),
          { code: `${family}-action-observation-failed` })
        : cause instanceof Error ? cause : new Error(String(cause))
    return Object.assign(error, { actionReceipt: { ...facts } })
  }

  private action(runId: string, operationId: string, handle: string,
    input: { type: 'click' } | { type: 'input'; value: string }): Promise<PageActionObservation> {
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
    session.lastObservation = undefined
    const promise = (async () => {
      const facts: ActionReceiptFacts = { operationId, dispatch: 'not_dispatched', application: 'not_applied',
        goal: 'unverified', observation: 'not_requested' }
      try {
        await this.assertCurrent(session)
        facts.dispatch = 'dispatched'; facts.application = 'unknown'
        const result = await this.waitForRun(runId, () => this.options.frames.act(session.context, session.frameToken,
          { ...input, path: target.path, fingerprint: target.fingerprint, ...(target.frameToken ? { frameToken: target.frameToken, frameProcessId: target.frameProcessId } : {}) },
          () => !session.stopped && this.runs.get(runId) === session))
        facts.application = result.applied ? 'applied' : 'not_applied'
        if (!result.applied) throw new Error(result.reason === 'stale-element'
          ? 'HTML 元素已变化，请重新观察' : `HTML 操作未应用：${result.reason ?? '未知原因'}`)
        if (result.inputOutcome?.status === 'value-mismatch') {
          // The frame returned a terminal result with a measured value. This is
          // a failed input goal, not a lost action receipt. Keep the receipt so
          // the same operation cannot send its trusted events a second time.
          facts.goal = 'mismatch'
          throw Object.assign(new Error(`输入动作已完成，但控件未保留请求值（请求：${result.inputOutcome.requestedValue.slice(0, 180)}；当前值：${result.inputOutcome.actualValue.slice(0, 180)}）。请用 ${session.kind === 'html' ? 'html.observe' : 'view.observe'} 重新观察后决定下一步。`),
            { code: `${session.kind === 'html' ? 'html' : 'view'}-input-value-mismatch` })
        }
        // The trusted input port measures retention before returning its ACK.
        if (input.type === 'input') facts.goal = 'achieved'
        facts.observation = 'failed'
        await this.assertCurrent(session)
        const observation = await this.observeCurrent(session)
        facts.observation = 'complete'
        return { ...observation, actionReceipt: { ...facts } }
      } catch (cause) {
        throw this.actionFailure(session, facts, cause)
      } finally { session.busy = false }
    })()
    // Keep failed/unknown receipts: repeating an operation ID must not click twice.
    session.actionReceipts.set(operationId, { digest, promise })
    return promise
  }

  click(runId: string, input: { operationId: string; handle: string }): Promise<HtmlActionObservation> {
    this.requireHtml(runId)
    return this.action(runId, input.operationId, input.handle, { type: 'click' }) as Promise<HtmlActionObservation>
  }

  input(runId: string, input: { operationId: string; handle: string; value: string }): Promise<HtmlActionObservation> {
    this.requireHtml(runId)
    return this.action(runId, input.operationId, input.handle, { type: 'input', value: input.value }) as Promise<HtmlActionObservation>
  }

  async errors(runId: string): Promise<{ identity: HtmlActionIdentity; errors: HtmlActionDiagnostic[] }> {
    const session = this.requireHtml(runId)
    await this.assertCurrent(session)
    return { identity: { ...session.identity, url: reportUrl(session.identity.url) }, errors: reportErrors(session.errors) }
  }

  async readResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    this.require(runId)
    return this.options.images.read(runId, resourceId)
  }

  publishedIdentity(runId: string): PublishedActionIdentity { return { ...this.requirePublished(runId).identity } }

  /** The Published adapter supplies only a trusted frame; handles, receipts and input share the HTML action owner. */
  async observePublished(runId: string, input: PublishedActionTarget): Promise<PublishedActionObservation> {
    if (this.disposed || this.stoppedRuns.has(runId) || input.signal?.aborted) throw new Error('课件观察已停止')
    if (!this.options.published) throw new Error('当前宿主没有可操作的课件观察载体')
    const previous = this.runs.get(runId)
    if (this.opening.has(runId) || previous?.busy) throw new Error('页面操作尚未完成')
    this.opening.add(runId)
    try {
      const context = await this.waitForRun(runId, signal => this.options.published!.contextForTarget({ ...input, runId,
        // The existing carrier must receive Stop even before it is registered.
        signal: input.signal ? AbortSignal.any([signal, input.signal]) : signal }),
        late => this.options.published!.releaseContext?.(late))
      const frameToken = await this.waitForRun(runId, () => this.options.frames.frameToken(context))
      if (this.stoppedRuns.has(runId) || input.signal?.aborted) throw new Error('课件观察已停止')
      let session: Extract<ActionSession, { kind: 'published' }>
      if (previous?.kind === 'published' && previous.context.webContentsId === context.webContentsId
        && previous.frameToken === frameToken) {
        previous.context = context
        previous.identity = context.identity
        session = previous
      } else {
        if (previous) this.retire(previous, previous.identity.documentId === context.identity.documentId
          && previous.identity.epoch === context.identity.epoch)
        session = { kind: 'published', runId, identity: context.identity, context, frameToken, generation: 0,
          handles: new Map(), cursors: new Map(), observationPageSize: 120,
          errors: [], actionReceipts: new Map(), unsubscribeErrors: () => {}, stopped: false, busy: false }
        session.unsubscribeErrors = this.options.frames.onDiagnostic(context, frameToken, diagnostic => {
          if (!session.stopped) { session.errors.push(diagnostic); if (session.errors.length > 32) session.errors.shift() }
        })
        this.runs.set(runId, session)
      }
      session.busy = true
      try { return await this.observeCurrent(session) } finally { session.busy = false }
    } finally { this.opening.delete(runId) }
  }

  clickPublished(runId: string, input: { operationId: string; handle: string }): Promise<PublishedActionObservation> {
    this.requirePublished(runId)
    return this.action(runId, input.operationId, input.handle, { type: 'click' }) as Promise<PublishedActionObservation>
  }

  inputPublished(runId: string, input: { operationId: string; handle: string; value: string }): Promise<PublishedActionObservation> {
    this.requirePublished(runId)
    return this.action(runId, input.operationId, input.handle, { type: 'input', value: input.value }) as Promise<PublishedActionObservation>
  }

  stopRun(runId: string): void {
    this.stoppedRuns.add(runId)
    this.runLifetimes.get(runId)?.abort()
    this.runLifetimes.delete(runId)
    const session = this.runs.get(runId)
    if (session) this.retire(session)
    this.options.preview.releaseRun?.(runId)
    this.options.published?.releaseRun?.(runId)
  }

  dispose(): void {
    this.disposed = true
    for (const runId of new Set([...this.runs.keys(), ...this.opening])) this.stopRun(runId)
  }
}
