import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { installEditorProtocol } from '../../protocols'
import { configureRestrictedSession } from '../../security'
import { PreviewNetworkPolicy } from '../../previewNetworkPolicy'
import type { ViewObservationCapture, ViewObservationIdentity, ViewObservationSnapshot } from '../../../shared/workbench/viewObservation'

export interface ViewObservationDesktopOptions {
  rendererEntryUrl: string
  /** Main supplies a trusted mounted-host capture that returns null unless its identity matches. */
  liveCapture?(input: { identity: ViewObservationIdentity; signal?: AbortSignal }): Promise<ViewObservationCapture | null>
}

const bytes = (value: Uint8Array) => Buffer.from(value).toString('base64')

/** A no-preload, isolated Published playback host. It never navigates the user's editor. */
export class ViewObservationDesktopService {
  constructor(private readonly options: ViewObservationDesktopOptions) {}

  captureLive = async (input: { identity: ViewObservationIdentity; signal?: AbortSignal }): Promise<ViewObservationCapture | null> =>
    this.options.liveCapture ? this.options.liveCapture(input) : null

  captureIsolated = async (input: { identity: ViewObservationIdentity; snapshot: ViewObservationSnapshot;
    signal?: AbortSignal }): Promise<ViewObservationCapture> => {
    if (input.signal?.aborted) throw new Error('观察已取消')
    const { project, resources } = input.snapshot.model
    const token = randomUUID()
    const binarySources = new Map<string, { bytes: Uint8Array; mime: string }>()
    const resource = (content: Uint8Array, mime: string) => {
      const pathname = `/_observation/${token}/${binarySources.size}`
      binarySources.set(pathname, { bytes: content, mime })
      return { url: `courseware-editor://app${pathname}`, byteLength: content.byteLength }
    }
    const assetResources: Record<string, { url: string; byteLength: number }> = {}
    for (const [id, asset] of Object.entries(project.assets)) {
      const content = resources.assets[id] ?? resources.assets[asset.id]
      if (content) assetResources[id] = resource(content, asset.mimeType)
      else if (asset.remote) assetResources[id] = { url: asset.remote.url, byteLength: asset.byteLength }
    }
    const componentResources = Object.fromEntries(Object.entries(resources.components).map(([key, files]) => [key,
      Object.fromEntries(Object.entries(files).map(([name, content]) => [name, resource(content, 'application/octet-stream')]))]))
    const payload = { project, locationId: input.identity.locationId, assets: {}, assetResources, components: {}, componentResources }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw new Error('观察结构快照超过 64 MiB 上限；资源字节不计入结构载荷')

    const isolatedSession = session.fromPartition(`observation-${randomUUID()}`)
    installEditorProtocol(isolatedSession, url => {
      const entry = url.hostname === 'app' ? binarySources.get(url.pathname) : undefined
      return entry ? new Response(Uint8Array.from(entry.bytes), { headers: { 'Content-Type': entry.mime, 'Cache-Control': 'no-store' } }) : undefined
    })
    const network = new PreviewNetworkPolicy()
    const base = new URL(this.options.rendererEntryUrl)
    network.replaceBaseOrigins(['http:', 'https:'].includes(base.protocol) ? [base.origin] : [])
    const owner = { processId: 0, frameToken: token, documentToken: token }
    network.activateDocument(owner)
    network.replacePreviewLease({ leaseId: token, connectOrigins: project.network?.connectOrigins ?? [],
      remoteAssetUrls: Object.values(project.assets).flatMap(asset => asset.remote ? [asset.remote.url] : []) }, owner)
    configureRestrictedSession(isolatedSession, url => network.allowsRequest(url))
    const worker = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, frame: false, show: false,
      skipTaskbar: true, webPreferences: { session: isolatedSession, contextIsolation: true, sandbox: true,
        nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: true } })
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
    input.signal?.addEventListener('abort', onAbort, { once: true })
    worker.webContents.once('render-process-gone', onGone)
    const timeout = setTimeout(() => stop('观察宿主准备或截图超时'), 20_000)
    try {
      const result = await Promise.race([stopped, (async () => {
        await worker.loadURL(entry)
        const outcome = await worker.webContents.executeJavaScript(`window.__COURSEWARE_OBSERVATION_RUN__(${JSON.stringify(encoded)})`) as {
          locationId: string; structure: string[]; diagnostics: string[] }
        if (input.signal?.aborted) throw new Error('观察已取消')
        if (outcome.locationId !== input.identity.locationId) throw new Error('观察宿主加载了错误页面')
        const bitmap = await worker.webContents.capturePage()
        const size = bitmap.getSize()
        if (size.width < 1 || size.height < 1 || bitmap.isEmpty()) throw new Error('观察宿主未生成真实画面')
        return { identity: input.identity, png: new Uint8Array(bitmap.toPNG()), width: size.width, height: size.height,
          structure: outcome.structure, diagnostics: outcome.diagnostics } satisfies ViewObservationCapture
      })()])
      return result
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', onAbort)
      if (!worker.isDestroyed()) worker.destroy()
      binarySources.clear()
      isolatedSession.protocol.unhandle('courseware-editor')
      await isolatedSession.clearStorageData()
    }
  }
}
