import { componentContainers } from '../../../shared/contracts/component-platform/project'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { installEditorProtocol } from '../../protocols'
import { configureRestrictedSession } from '../../security'
import { PreviewNetworkPolicy } from '../../previewNetworkPolicy'
import type { ViewObservationCapture, ViewObservationIdentity, ViewObservationSnapshot } from '../../../shared/workbench/viewObservation'
import { buildPublishedCourseV3 } from '../../../core/publish/componentPlatform'
import { InMemoryComponentCompilation } from '../../../core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../contentApply/compilation/esbuildComponentCompiler'
import { htmlPreviewResponse } from '../htmlPreview/htmlPreviewResponse'
import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'
import { waitForCaptureFramePaint } from './captureFramePaint'
import { observationSnapshotMatches } from '../../../shared/workbench/viewObservation'
import { observationDocumentIdentityMatches, type ViewObservationDocumentIdentity } from './observationSourceIdentity'
import type { PublishedActionPreviewPort, PublishedActionTarget } from './HtmlActionService'
import type { PublishedActionAutomationContext } from './HtmlActionDesktopPort'
type ObservationWorkerResult = Awaited<ReturnType<PublishedActionPreviewPort['readState']>> & { rect?: { x: number; y: number; width: number; height: number } }

export interface ViewObservationDesktopOptions {
  rendererEntryUrl: string
  /** The app supplies its DocumentHost owner; standalone capture compiles lazily when needed. */
  compilation?: Pick<InMemoryComponentCompilation, 'compile'>
  /** Interactive contexts recheck their canonical document before any input. */
  snapshot?(documentId: string): Promise<import('../../../shared/workbench/document').DocumentSnapshot>
  currentIdentity?(documentId: string): Promise<ViewObservationDocumentIdentity>
  /** Main supplies a trusted mounted-host capture that returns null unless its identity matches. */
  liveCapture?(input: { identity: ViewObservationIdentity; signal?: AbortSignal }): Promise<ViewObservationCapture | null>
}

interface PublishedCaptureTarget {
  locationId: string; stateId?: string | null; instanceId?: string; spatialFrameId?: string; staticExport?: true; signal?: AbortSignal; interactive?: true
}
type PublishedCapture = Omit<ViewObservationCapture, 'identity'>

/** A no-preload, isolated Published playback host. It never navigates the user's editor. */
interface PreparedObservationHost {
  token: string
  worker: BrowserWindow
  initial: ObservationWorkerResult
  capture(): Promise<PublishedCapture>
  read(): Promise<ObservationWorkerResult>
  select(locationId: string, stateId: string | null): Promise<ObservationWorkerResult>
  reset(input: PublishedCaptureTarget, publication: { payload: PublishedCourseV3; diagnostics: string[] }): Promise<void>
  close(): Promise<void>
}

export interface PublishedObservationCaptureJob {
  capture(input: Omit<PublishedCaptureTarget, 'signal' | 'interactive'> & { published: PublishedCourseV3 }): Promise<PublishedCapture>
  close(): Promise<void>
}

export class ViewObservationDesktopService implements PublishedActionPreviewPort {
  private readonly owned = new Map<string, { context: PublishedActionAutomationContext; host: PreparedObservationHost }>()
  private readonly stopped = new Set<string>()
  private readonly compilation: Pick<InMemoryComponentCompilation, 'compile'>
  constructor(private readonly options: ViewObservationDesktopOptions) {
    let standalone: InMemoryComponentCompilation | undefined
    this.compilation = options.compilation ?? { compile: input =>
      (standalone ??= new InMemoryComponentCompilation(createEsbuildComponentCompiler())).compile(input) }
  }

  captureLive = async (input: { identity: ViewObservationIdentity; signal?: AbortSignal }): Promise<ViewObservationCapture | null> =>
    this.options.liveCapture ? this.options.liveCapture(input) : null

  captureIsolated = async (input: { identity: ViewObservationIdentity; snapshot: ViewObservationSnapshot;
    signal?: AbortSignal }): Promise<ViewObservationCapture> => {
    const { project, resources } = input.snapshot.model
    const capture = await this.capturePrepared({ ...input.identity, signal: input.signal }, async resource => {
      const publication = await buildPublishedCourseV3({ project, assetBytes: resources.assets, componentFiles: resources.components }, { compilation: this.compilation,
        assetUrl: (asset, content) => resource(content, asset.mimeType ?? 'application/octet-stream').url })
      return { payload: publication.payload, diagnostics: publication.diagnostics.map(diagnostic => diagnostic.message) }
    })
    return { ...capture, identity: input.identity }
  }

  /** Frozen export payloads use the same isolated host as view.observe. */
  capturePublished = (input: PublishedCaptureTarget & { published: PublishedCourseV3 }): Promise<PublishedCapture> =>
    this.capturePrepared(input, async () => ({ payload: input.published, diagnostics: [] }))

  /** One export owns one hidden window. Each image still starts a new Player. */
  createPublishedCaptureJob(signal?: AbortSignal): PublishedObservationCaptureJob {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const owner: { host?: PreparedObservationHost } = {}
    const takeHost = (): PreparedObservationHost | undefined => {
      const current = owner.host; owner.host = undefined
      return current
    }
    let closed = false, closing: Promise<void> | undefined
    let queue = Promise.resolve()
    return {
      capture: input => {
        const work = queue.then(async () => {
          if (closed || controller.signal.aborted) throw new Error('输出捕获已结束')
          const { published, ...target } = input
          const publication = { payload: published, diagnostics: [] }
          try {
            let current = owner.host
            if (current) await current.reset({ ...target, signal: controller.signal }, publication)
            else { current = await this.openPrepared({ ...target, signal: controller.signal }, async () => publication); owner.host = current }
            if (closed || controller.signal.aborted) throw new Error('输出捕获已结束')
            return await current.capture()
          } catch (error) {
            const failed = takeHost()
            await failed?.close()
            throw error
          }
        })
        queue = work.then(() => {}, () => {})
        return work
      },
      close: () => {
        if (closing) return closing
        closed = true; controller.abort(); signal?.removeEventListener('abort', abort)
        closing = (async () => {
          const current = takeHost()
          await current?.close()
          await queue
          const late = takeHost()
          await late?.close()
        })()
        return closing
      },
    }
  }

  async contextForTarget(input: PublishedActionTarget & { runId: string }): Promise<PublishedActionAutomationContext> {
    if (this.stopped.has(input.runId) || input.signal?.aborted) throw new Error('课件观察已停止')
    if (!this.options.snapshot && !this.options.currentIdentity) throw new Error('课件观察缺少当前文档读取端口')
    if (!observationSnapshotMatches(input.snapshot, input.identity, input.identity.projectId)) throw new Error('课件观察来源与正式文档不符')
    await this.assertCurrentSource(input.identity)
    const previous = this.owned.get(input.runId)
    const sameSource = previous && previous.context.identity.documentId === input.identity.documentId
      && previous.context.identity.epoch === input.identity.epoch && previous.context.identity.revision === input.identity.revision
      && previous.context.identity.projectId === input.identity.projectId && !previous.host.worker.isDestroyed()
    let host: PreparedObservationHost
    if (sameSource) host = previous.host
    else {
      if (previous) { this.owned.delete(input.runId); await previous.host.close() }
      const { project, resources } = input.snapshot.model
      host = await this.openPrepared({ ...input.identity, interactive: true, signal: input.signal }, async resource => {
        const publication = await buildPublishedCourseV3({ project, assetBytes: resources.assets, componentFiles: resources.components }, {
          compilation: this.compilation, assetUrl: (asset, content) => resource(content, asset.mimeType ?? 'application/octet-stream').url })
        return { payload: publication.payload, diagnostics: publication.diagnostics.map(item => item.message) }
      })
    }
    try {
      if (this.stopped.has(input.runId) || input.signal?.aborted) throw new Error('课件观察已停止')
      const current = await host.read()
      if (current.locationId !== input.identity.locationId || current.stateId !== (input.identity.stateId ?? null)) {
        const size = componentContainers(input.snapshot.model.project).find(surface => surface.id === input.identity.locationId)?.designSize ?? { width: 1280, height: 720 }
        host.worker.setContentSize(Math.ceil(size.width), Math.ceil(size.height))
        await host.select(input.identity.locationId, input.identity.stateId ?? null)
      }
      const frame = host.worker.webContents.mainFrame
      const context: PublishedActionAutomationContext = { kind: 'published', runId: input.runId,
        identity: { ...input.identity, viewGeneration: host.token }, webContentsId: host.worker.webContents.id,
        frameProcessId: frame.processId, frameToken: frame.frameToken, url: frame.url }
      this.owned.set(input.runId, { context, host })
      await this.currentContext(context)
      return context
    } catch (error) { this.owned.delete(input.runId); await host.close(); throw error }
  }

  async currentContext(context: PublishedActionAutomationContext): Promise<PublishedActionAutomationContext> {
    const owned = this.owned.get(context.runId)
    if (this.stopped.has(context.runId) || !owned || owned.host.worker.isDestroyed()
      || owned.context.webContentsId !== context.webContentsId || owned.host.token !== context.identity.viewGeneration)
      throw new Error('课件观察载体已停止或切换，请重新观察')
    const frame = owned.host.worker.webContents.mainFrame
    if (frame.detached || frame.isDestroyed() || frame.processId !== context.frameProcessId || frame.frameToken !== context.frameToken)
      throw new Error('课件观察页面已重新载入，请重新观察')
    await this.assertCurrentSource(context.identity)
    return context
  }

  private async assertCurrentSource(identity: PublishedActionAutomationContext['identity']): Promise<void> {
    const current = this.options.currentIdentity
      ? observationDocumentIdentityMatches(await this.options.currentIdentity(identity.documentId), identity)
      : this.options.snapshot && observationSnapshotMatches(await this.options.snapshot(identity.documentId), identity, identity.projectId)
    if (!current) throw new Error('课件来源版本已改变，请重新观察')
  }

  async readState(context: PublishedActionAutomationContext): Promise<ObservationWorkerResult> {
    await this.currentContext(context)
    const result = await this.owned.get(context.runId)!.host.read()
    await this.currentContext(context)
    return result
  }

  releaseRun(runId: string): void {
    this.stopped.add(runId)
    const owned = this.owned.get(runId)
    this.owned.delete(runId)
    if (owned) void owned.host.close()
  }

  releaseContext(context: PublishedActionAutomationContext): void {
    const owned = this.owned.get(context.runId)
    if (owned?.context.webContentsId !== context.webContentsId) return
    this.owned.delete(context.runId)
    void owned.host.close()
  }

  releaseDocument(documentId: string): void {
    for (const [runId, owned] of this.owned) if (owned.context.identity.documentId === documentId) {
      this.owned.delete(runId)
      void owned.host.close()
    }
  }

  dispose(): void { for (const runId of this.owned.keys()) this.releaseRun(runId) }

  private capturePrepared = async (input: PublishedCaptureTarget,
    prepare: (resource: (content: Uint8Array, mime: string) => { url: string; byteLength: number }) =>
      Promise<{ payload: PublishedCourseV3; diagnostics: string[] }>): Promise<PublishedCapture> => {
    const host = await this.openPrepared(input, prepare)
    try { return await host.capture() } finally { await host.close() }
  }

  private openPrepared = async (input: PublishedCaptureTarget,
    prepare: (resource: (content: Uint8Array, mime: string) => { url: string; byteLength: number }) =>
      Promise<{ payload: PublishedCourseV3; diagnostics: string[] }>): Promise<PreparedObservationHost> => {
    if (input.signal?.aborted) throw new Error('观察已取消')
    const token = randomUUID()
    const binarySources = new Map<string, { bytes: Uint8Array; mime: string }>()
    const resource = (content: Uint8Array, mime: string) => {
      const pathname = `/_observation/${token}/${binarySources.size}`
      binarySources.set(pathname, { bytes: content, mime })
      return { url: `courseware-editor://app${pathname}`, byteLength: content.byteLength }
    }
    const publication = await prepare(resource)
    let project = publication.payload, target = input
    const bootstrapPath = `/_observation/${token}/bootstrap/`
    const payloadPath = `/_observation/${token}/payload/${randomUUID()}`
    const payloadUrl = `courseware-editor://app${payloadPath}`
    const workerInput = (diagnostics: string[]) => ({ published: project, locationId: target.locationId, stateId: target.stateId ?? null,
      bootstrapBaseUrl: `courseware-editor://app${bootstrapPath}`, diagnostics,
      instanceId: target.instanceId, spatialFrameId: target.spatialFrameId, staticExport: target.staticExport, interactive: target.interactive })
    let payload = workerInput(publication.diagnostics)
    const isolatedSession = session.fromPartition(`observation-${randomUUID()}`)
    const entry = new URL('observation.html', this.options.rendererEntryUrl).toString()
    const entryUrl = new URL(entry), entryOrigin = entryUrl.origin === 'null' ? `${entryUrl.protocol}//${entryUrl.host}` : entryUrl.origin
    let closed = false
    installEditorProtocol(isolatedSession, async (url, request) => {
      if (url.hostname === 'app' && url.pathname === payloadPath) {
        const headers = { 'Access-Control-Allow-Origin': entryOrigin, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Vary': 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }
        const reply = (status: number, body?: string) => new Response(body ?? null, { status, headers })
        if (closed) return reply(410, 'Observation closed')
        if (url.search) return reply(400, 'Invalid observation payload')
        const origin = request.headers.get('Origin')
        if (origin && origin !== entryOrigin) return reply(403, 'Invalid observation origin')
        const method = request.method.toUpperCase()
        if (method === 'OPTIONS') return reply(204)
        if (method !== 'GET' && method !== 'HEAD') return reply(405, 'Method not allowed')
        return reply(200, method === 'HEAD' ? undefined : JSON.stringify(payload))
      }
      if (url.hostname === 'app' && url.pathname.startsWith(bootstrapPath)) {
        const headers = { 'Access-Control-Allow-Origin': entryOrigin, 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Vary': 'Origin' }
        const reply = (status: number, message?: string) => new Response(message ?? null, { status, headers })
        if (closed) return reply(410, 'Observation closed')
        if (url.search) return reply(400, 'Bootstrap content belongs in the request body')
        const method = request.method.toUpperCase()
        if (method === 'POST' || method === 'DELETE' || method === 'OPTIONS') {
          const origin = request.headers.get('Origin')
          if (origin && origin !== entryOrigin) return reply(403, 'Invalid observation origin')
          if (method === 'OPTIONS') return reply(204)
          if (method === 'DELETE') { binarySources.delete(url.pathname); return reply(204) }
          const html = await request.text()
          if (closed) return reply(410, 'Observation closed')
          binarySources.set(url.pathname, { bytes: new TextEncoder().encode(html), mime: 'text/html; charset=utf-8' })
          return reply(204)
        }
        if (method !== 'GET' && method !== 'HEAD') return reply(405, 'Method not allowed')
        const source = binarySources.get(url.pathname)
        return source ? htmlPreviewResponse(source.bytes, { contentType: source.mime, method,
          connectOrigins: project.logic?.network?.connectOrigins ?? [] }) : reply(404, 'Missing bootstrap')
      }
      const entry = url.hostname === 'app' ? binarySources.get(url.pathname) : undefined
      if (!entry) return undefined
      const body = entry.bytes.buffer instanceof ArrayBuffer
        ? new Uint8Array(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength) : Uint8Array.from(entry.bytes)
      return new Response(body, { headers: { 'Content-Type': entry.mime, 'Cache-Control': 'no-store' } })
    })
    const network = new PreviewNetworkPolicy(), base = new URL(this.options.rendererEntryUrl)
    network.replaceBaseOrigins(['http:', 'https:'].includes(base.protocol) ? [base.origin] : [])
    const owner = { processId: 0, frameToken: token, documentToken: token }
    network.activateDocument(owner)
    network.replacePreviewLease({ leaseId: token, connectOrigins: project.logic?.network?.connectOrigins ?? [], remoteAssetUrls: [] }, owner)
    configureRestrictedSession(isolatedSession, url => network.allowsRequest(url))
    const size = componentContainers(project).find(surface => surface.id === input.locationId)?.designSize ?? { width: 1280, height: 720 }
    const worker = new BrowserWindow({ width: size.width, height: size.height, useContentSize: true, frame: false, show: false,
      ...(input.interactive !== true ? { transparent: true, backgroundColor: '#00000000' } : {}),
      skipTaskbar: true, webPreferences: { session: isolatedSession, contextIsolation: true, sandbox: true,
        // Trusted OOPIF input uses the ordinary hidden-window path, as TaskHtmlPreview does.
        nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: input.interactive !== true } })
    const contents = worker.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault() })
    let rejectStop!: (error: Error) => void
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject })
    void stopped.catch(() => undefined)
    let closing: Promise<void> | undefined
    const close = (reason = new Error('观察宿主已关闭')): Promise<void> => {
      if (closing) return closing
      closed = true
      rejectStop(reason)
      input.signal?.removeEventListener('abort', onAbort)
      worker.removeListener('closed', onClosed)
      contents.removeListener('render-process-gone', onGone)
      if (!worker.isDestroyed()) worker.destroy()
      binarySources.clear()
      isolatedSession.protocol.unhandle('courseware-editor')
      closing = isolatedSession.clearStorageData()
      return closing
    }
    const fail = (message: string) => { void close(new Error(message)) }
    const onAbort = () => fail('观察已取消')
    const onGone = () => fail('观察宿主异常退出')
    const onClosed = () => fail('观察宿主已关闭')
    input.signal?.addEventListener('abort', onAbort, { once: true })
    contents.once('render-process-gone', onGone); worker.once('closed', onClosed)
    if (input.signal?.aborted) onAbort()
    const withFaultWait = async <T>(work: () => Promise<T>, message: string): Promise<T> => {
      if (closed || input.signal?.aborted) throw new Error('观察宿主已关闭')
      const faultWait = setTimeout(() => fail(message), 20_000)
      try { return await Promise.race([stopped, work()]) }
      finally { clearTimeout(faultWait) }
    }
    try {
      const run = async () => {
        const outcome = await contents.executeJavaScript(`window.__COURSEWARE_OBSERVATION_RUN__(${JSON.stringify(payloadUrl)})`) as ObservationWorkerResult
        if (input.signal?.aborted || closed) throw new Error('观察已取消')
        if (outcome.locationId !== target.locationId || !target.interactive && (outcome.stateId ?? null) !== (target.stateId ?? null))
          throw new Error('观察宿主加载了错误页面或状态')
        await waitForCaptureFramePaint(contents.mainFrame, token)
        return outcome
      }
      let initial = await withFaultWait(async () => {
        await worker.loadURL(entry)
        return run()
      }, '观察宿主准备或截图无响应')
      const read = () => withFaultWait(() => contents.executeJavaScript('window.__COURSEWARE_OBSERVATION_READ__()') as Promise<ObservationWorkerResult>, '观察宿主读取无响应')
      return { token, worker, get initial() { return initial }, close, read,
        reset: (next, publication) => withFaultWait(async () => {
          target = next; project = publication.payload; binarySources.clear()
          payload = workerInput(publication.diagnostics)
          network.replacePreviewLease({ leaseId: token, connectOrigins: project.logic?.network?.connectOrigins ?? [], remoteAssetUrls: [] }, owner)
          const size = componentContainers(project).find(surface => surface.id === target.locationId)?.designSize ?? { width: 1280, height: 720 }
          worker.setContentSize(Math.ceil(size.width), Math.ceil(size.height))
          initial = await run()
        }, '观察宿主准备或截图无响应'),
        select: (locationId, stateId) => withFaultWait(() => contents.executeJavaScript(`window.__COURSEWARE_OBSERVATION_SELECT__(${JSON.stringify(locationId)},${JSON.stringify(stateId)})`) as Promise<ObservationWorkerResult>, '观察宿主切换无响应'),
        capture: () => withFaultWait(async () => {
          const current = target.interactive ? await read() : initial, rect = current.rect
          if (rect && !target.interactive) {
            // capturePage clips to the hidden window's viewport. A local Flow
            // picture can be taller than its author viewport: expand only this
            // owned window, leaving the renderer's explicitly sized root and
            // the captured instance's local viewport unchanged.
            const [width, height] = worker.getContentSize()
            const captureWidth = Math.max(width, Math.ceil(rect.x + rect.width))
            const captureHeight = Math.max(height, Math.ceil(rect.y + rect.height))
            if (captureWidth !== width || captureHeight !== height) worker.setContentSize(captureWidth, captureHeight)
          }
          await waitForCaptureFramePaint(contents.mainFrame, randomUUID())
          const bitmap = await contents.capturePage(rect ? { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) } : undefined)
          const size = bitmap.getSize()
          if (size.width < 1 || size.height < 1 || bitmap.isEmpty()) throw new Error('观察宿主未生成真实画面')
          return { png: new Uint8Array(bitmap.toPNG()), width: size.width, height: size.height, structure: current.structure, diagnostics: current.diagnostics }
        }, '观察宿主准备或截图无响应') }
    } catch (error) { await close(); throw error }
  }
}
