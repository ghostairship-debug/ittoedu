import { app, BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { configureRestrictedSession, hardenWebContents } from '../../../security'
import { assembleMeasuredHtml, sourceProgramAssembly, type HtmlAssembly, type HtmlAssemblyDiagnostic, type HtmlDesignCapture } from '../../../../core/contentApply/assembly/htmlAssembly'
import { captureHtmlDesignViewport } from './browserCapture'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from './prepareMeasurementDocument'
import { cssUsesViewport } from '../../../../components/web/measuredFragmentBox'

export interface HtmlDesignMeasurementRequest {
  html: string
  viewport: { width: number; height: number }
  /** Software operation context may preserve an explicit whole-page redo. */
  framing?: 'viewport' | 'content'
  themeCss?: string
  /** Prepared cw-resource references/keys -> browser URLs (normally data URLs), supplied by the resource owner. */
  resourceUrls?: Readonly<Record<string, string>>
  diagnostics?: readonly HtmlAssemblyDiagnostic[]
  allowedNetworkOrigins?: readonly string[]
  signal?: AbortSignal
}

export interface HtmlDesignMeasurementOptions {
  /** Liveness bounds; resource failures become diagnostics and do not reject usable content. */
  resourceWaitMs?: number
  timeoutMs?: number
}

/** A disposable content browser at the requested design size. It has no workbench preload or login session. */
export async function measureHtmlAtDesignViewport(request: HtmlDesignMeasurementRequest, options: HtmlDesignMeasurementOptions = {}): Promise<HtmlAssembly> {
  const { width, height } = request.viewport
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('Design viewport must have positive integer CSS-pixel dimensions')
  request.signal?.throwIfAborted()
  const source: HtmlAssembly['source'] = { html: request.html, ...(request.themeCss !== undefined ? { themeCss: request.themeCss } : {}) }
  const prepared = prepareMeasurementDocument(request)
  const framing = request.framing ?? (prepared.documentKind === 'document' ? 'viewport' : 'content')
  if (prepared.documentProgramReason && framing === 'viewport') return sourceProgramAssembly(request.viewport, source, prepared.documentProgramReason, request.diagnostics)
  const resourceWaitMs = options.resourceWaitMs ?? 10_000, timeoutMs = options.timeoutMs ?? 30_000
  if (![resourceWaitMs, timeoutMs].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Measurement liveness intervals must be positive')
  await app.whenReady()
  request.signal?.throwIfAborted()
  const isolated = session.fromPartition(`html-design-measurement-${randomUUID()}`, { cache: false })
  configureRestrictedSession(isolated, new Set(request.allowedNetworkOrigins ?? []))
  const diagnostics: HtmlAssemblyDiagnostic[] = (request.diagnostics ?? []).map(item => ({ ...item }))
  isolated.webRequest.onErrorOccurred(details => { diagnostics.push({ level: 'warning', code: 'html-resource-load', message: `局部资源加载失败：${details.error}`, reference: details.url }) })
  // CSP blocks author scripts; Electron must still evaluate the host measurement function.
  const worker = new BrowserWindow({ show: false, skipTaskbar: true, frame: false, useContentSize: true, width, height,
    webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true, backgroundThrottling: false } })
  worker.webContents.setZoomFactor(1)
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(prepared.html)
  hardenWebContents(worker.webContents, value => value === url)
  let timer!: ReturnType<typeof setTimeout>
  let cancel!: () => void
  let gone!: () => void
  const stopped = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(request.signal?.reason instanceof Error ? request.signal.reason : new Error('HTML design measurement cancelled'))
    gone = () => reject(new Error('HTML design measurement process exited'))
    timer = setTimeout(() => reject(new Error('HTML design measurement did not respond')), timeoutMs)
    request.signal?.addEventListener('abort', cancel, { once: true })
    worker.once('closed', gone)
    worker.webContents.once('render-process-gone', gone)
  })
  try {
    const capture = await Promise.race([stopped, (async () => {
      await worker.loadURL(url)
      request.signal?.throwIfAborted()
      // The loaded renderer has a view. Emulating before the first load can dereference
      // a missing native view; logical CSS sizing must still be independent of window/DPI rounding.
      worker.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height },
        viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height }, scale: 1 })
      return await worker.webContents.executeJavaScript(`(${captureHtmlDesignViewport.toString()})(${JSON.stringify(resourceWaitMs)},(${cssUsesViewport.toString()}))`) as HtmlDesignCapture
    })()])
    if (capture.viewport.width !== width || capture.viewport.height !== height) capture.diagnostics.push({
      level: 'warning', code: 'html-design-viewport',
      message: `测量视口实际为 ${capture.viewport.width}×${capture.viewport.height}，请求为 ${width}×${height}；已保留实测几何与原始源码。`,
    })
    // Do not persist temporary browser URLs in an assembly style or resource diagnostic.
    const references = Object.entries(request.resourceUrls ?? {}).map(([key, value]) => [value, key.startsWith('cw-resource:') ? key : /^[a-zA-Z0-9_.-]+$/.test(key) ? `cw-resource:${key}` : key] as const)
      .sort(([left], [right]) => right.length - left.length)
    const restoreReference = (value: string): string => references.reduce((text, [url, reference]) => text.split(url).join(reference), value)
    const restoreStyles = (style: Record<string, string>) => Object.entries(style).forEach(([name, value]) => { style[name] = restoreReference(value) })
    for (const element of capture.elements) {
      const original = prepared.originalElements.get(element.sourcePath.join('/'))
      if (original) { element.attributes = original.attributes; element.sourceHtml = original.sourceHtml }
      restoreStyles(element.style)
      Object.values(element.pseudoElements).forEach(restoreStyles)
    }
    restoreStyles(capture.pageStyle)
    if (capture.supportCss) capture.supportCss = restoreReference(capture.supportCss)
    for (const scope of capture.sourceScopes ?? []) {
      scope.html = retainedMeasurementScopeHtml(source, capture.elements[scope.index]!.sourcePath)
    }
    capture.diagnostics.unshift(...diagnostics)
    capture.diagnostics.forEach(item => { if (item.reference) item.reference = restoreReference(item.reference) })
    return prepared.documentProgramReason
      ? sourceProgramAssembly(capture.viewport, source, prepared.documentProgramReason, capture.diagnostics, capture)
      : assembleMeasuredHtml(capture, source, framing)
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', cancel)
    worker.removeListener('closed', gone)
    worker.webContents.removeListener('render-process-gone', gone)
    isolated.webRequest.onErrorOccurred(null)
    if (!worker.isDestroyed()) worker.destroy()
  }
}
