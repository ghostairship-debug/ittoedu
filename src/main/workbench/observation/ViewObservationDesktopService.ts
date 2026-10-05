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

export interface ViewObservationDesktopOptions {
  rendererEntryUrl: string
  /** Main supplies a trusted mounted-host capture that returns null unless its identity matches. */
  liveCapture?(input: { identity: ViewObservationIdentity; signal?: AbortSignal }): Promise<ViewObservationCapture | null>
}

interface PublishedCaptureTarget {
  locationId: string; stateId?: string | null; instanceId?: string; spatialFrameId?: string; signal?: AbortSignal
}
type PublishedCapture = Omit<ViewObservationCapture, 'identity'>

/** A no-preload, isolated Published playback host. It never navigates the user's editor. */
export class ViewObservationDesktopService {
  private readonly compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  constructor(private readonly options: ViewObservationDesktopOptions) {}

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

  private capturePrepared = async (input: PublishedCaptureTarget,
    prepare: (resource: (content: Uint8Array, mime: string) => { url: string; byteLength: number }) =>
      Promise<{ payload: PublishedCourseV3; diagnostics: string[] }>): Promise<PublishedCapture> => {
    if (input.signal?.aborted) throw new Error('观察已取消')
    const token = randomUUID()
    const binarySources = new Map<string, { bytes: Uint8Array; mime: string }>()
    const resource = (content: Uint8Array, mime: string) => {
      const pathname = `/_observation/${token}/${binarySources.size}`
      binarySources.set(pathname, { bytes: content, mime })
      return { url: `courseware-editor://app${pathname}`, byteLength: content.byteLength }
    }
    const publication = await prepare(resource), project = publication.payload
    const bootstrapPath = `/_observation/${token}/bootstrap/`
    const payload = { published: publication.payload, locationId: input.locationId, stateId: input.stateId ?? null,
      bootstrapBaseUrl: `courseware-editor://app${bootstrapPath}`,
      diagnostics: publication.diagnostics, instanceId: input.instanceId, spatialFrameId: input.spatialFrameId }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

    const isolatedSession = session.fromPartition(`observation-${randomUUID()}`)
    installEditorProtocol(isolatedSession, url => {
      if (url.hostname === 'app' && url.pathname.startsWith(bootstrapPath)) {
        const html = url.searchParams.get('html')
        return html === null ? new Response('Missing bootstrap', { status: 404 })
          : htmlPreviewResponse(html, { contentType: 'text/html; charset=utf-8', connectOrigins: project.logic?.network?.connectOrigins ?? [] })
      }
      const entry = url.hostname === 'app' ? binarySources.get(url.pathname) : undefined
      return entry ? new Response(Uint8Array.from(entry.bytes), { headers: { 'Content-Type': entry.mime, 'Cache-Control': 'no-store' } }) : undefined
    })
    const network = new PreviewNetworkPolicy()
    const base = new URL(this.options.rendererEntryUrl)
    network.replaceBaseOrigins(['http:', 'https:'].includes(base.protocol) ? [base.origin] : [])
    const owner = { processId: 0, frameToken: token, documentToken: token }
    network.activateDocument(owner)
    network.replacePreviewLease({ leaseId: token, connectOrigins: project.logic?.network?.connectOrigins ?? [], remoteAssetUrls: [] }, owner)
    configureRestrictedSession(isolatedSession, url => network.allowsRequest(url))
    const size = project.surfaces.find(surface => surface.id === input.locationId)?.designSize ?? { width: 1280, height: 720 }
    const worker = new BrowserWindow({ width: size.width, height: size.height, useContentSize: true, frame: false, show: false,
      skipTaskbar: true, webPreferences: { session: isolatedSession, contextIsolation: true, sandbox: true,
        nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: true } })
    const workerContents = worker.webContents
    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const entry = new URL('observation.html', this.options.rendererEntryUrl).toString()
    worker.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault() })
    let rejectStop!: (error: Error) => void
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject })
    const stop = (message: string) => {
      rejectStop(new Error(message))
      if (!worker.isDestroyed()) worker.destroy()
    }
    const onAbort = () => stop('观察已取消')
    const onGone = () => rejectStop(new Error('观察宿主异常退出'))
    const onClosed = () => rejectStop(new Error('观察宿主已关闭'))
    input.signal?.addEventListener('abort', onAbort, { once: true })
    worker.webContents.once('render-process-gone', onGone)
    worker.once('closed', onClosed)
    if (input.signal?.aborted) onAbort()
    const faultWait = setTimeout(() => stop('观察宿主准备或截图无响应'), 20_000)
    try {
      const result = await Promise.race([stopped, (async () => {
        await worker.loadURL(entry)
        const outcome = await worker.webContents.executeJavaScript(`window.__COURSEWARE_OBSERVATION_RUN__(${JSON.stringify(encoded)})`) as {
          locationId: string; stateId: string | null; structure: string[]; diagnostics: string[]; rect?: { x: number; y: number; width: number; height: number } }
        if (input.signal?.aborted) throw new Error('观察已取消')
        if (outcome.locationId !== input.locationId || (outcome.stateId ?? null) !== (input.stateId ?? null)) throw new Error('观察宿主加载了错误页面或状态')
        const rect = outcome.rect
        const bitmap = await worker.webContents.capturePage(rect ? { x: Math.floor(rect.x), y: Math.floor(rect.y),
          width: Math.ceil(rect.width), height: Math.ceil(rect.height) } : undefined)
        const size = bitmap.getSize()
        if (size.width < 1 || size.height < 1 || bitmap.isEmpty()) throw new Error('观察宿主未生成真实画面')
        return { png: new Uint8Array(bitmap.toPNG()), width: size.width, height: size.height,
          structure: outcome.structure, diagnostics: outcome.diagnostics } satisfies PublishedCapture
      })()])
      return result
    } finally {
      clearTimeout(faultWait)
      input.signal?.removeEventListener('abort', onAbort)
      worker.removeListener('closed', onClosed)
      workerContents.removeListener('render-process-gone', onGone)
      if (!worker.isDestroyed()) worker.destroy()
      binarySources.clear()
      isolatedSession.protocol.unhandle('courseware-editor')
      await isolatedSession.clearStorageData()
    }
  }
}
