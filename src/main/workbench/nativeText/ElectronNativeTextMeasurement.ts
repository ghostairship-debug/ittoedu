import { app, BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { textNodeSchema } from '../../../shared/contracts/native-v1/schema'
import type { AsyncNativeTextMeasurePort, NativeTextMeasurementResult } from '../../../core/tools/prepareNativeTextFrame'

export interface ElectronNativeTextMeasurementOptions {
  rendererURL?: string
  rendererFile?: string
  timeoutMs?: number
}

/** App-owned Canvas/font context. It never reads the foreground editor or its
 * selection, and exposes no desktop preload, Provider credential or file API. */
export function createElectronNativeTextMeasurement(options: ElectronNativeTextMeasurementOptions): { measure: AsyncNativeTextMeasurePort; dispose(): void } {
  if (!!options.rendererURL === !!options.rendererFile) throw new Error('Specify exactly one native text measurement entry')
  const entry = new URL(options.rendererURL ?? pathToFileURL(path.resolve(options.rendererFile!)).href)
  if (entry.pathname.split('/').pop() !== 'native-text-measurement.html' || entry.search || entry.hash) throw new Error('Invalid native text measurement entry')
  if (options.rendererURL && (entry.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(entry.hostname))) throw new Error('Native text measurement development entry must be loopback HTTP')
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid measurement timeout')
  let window: BrowserWindow | null = null, loading: Promise<void> | undefined, disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  const rendererRoot = options.rendererFile ? path.dirname(path.resolve(options.rendererFile)) : undefined
  const destroy = () => { const current = window; window = null; loading = undefined; if (current && !current.isDestroyed()) current.destroy() }
  const create = () => {
    const isolated = session.fromPartition(`native-text-measurement-${randomUUID()}`, { cache: false })
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', event => event.preventDefault())
    isolated.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false
      try {
        const url = new URL(details.url)
        if (rendererRoot && url.protocol === 'file:') {
          const file = path.resolve(fileURLToPath(url)), relative = path.relative(rendererRoot, file)
          allowed = !relative.startsWith('..') && !path.isAbsolute(relative) && (file === path.resolve(options.rendererFile!) || relative.startsWith(`assets${path.sep}`))
        } else if (!rendererRoot && url.protocol === 'http:' && url.origin === entry.origin) allowed = true
      } catch { /* No external font/network route. */ }
      callback({ cancel: !allowed })
    })
    const current = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false,
      backgroundThrottling: false, session: isolated,
    } })
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    current.webContents.on('will-navigate', event => event.preventDefault())
    current.webContents.on('will-frame-navigate', event => event.preventDefault())
    current.once('closed', () => { isolated.webRequest.onBeforeRequest(null); if (window === current) { window = null; loading = undefined } })
    window = current; loading = current.loadURL(entry.href)
    return current
  }
  const measure: AsyncNativeTextMeasurePort = (request, callOptions = {}) => {
    // Freeze before queueing: another document's job cannot alter this request.
    const spec = structuredClone(request)
    spec.node = textNodeSchema.parse(spec.node)
    if (spec.width !== spec.node.width || !Number.isFinite(spec.width) || spec.width <= 0 || !['width', 'height'].includes(spec.axis)) return Promise.reject(new Error('Invalid native text measurement spec'))
    const task = queue.then(async () => {
      if (disposed) throw new Error('文字测量宿主已关闭')
      callOptions.signal?.throwIfAborted()
      await app.whenReady()
      if (disposed) throw new Error('文字测量宿主已关闭')
      const current = window && !window.isDestroyed() ? window : create()
      return new Promise<NativeTextMeasurementResult>((resolve, reject) => {
        let finished = false
        const finish = (error?: Error, result?: NativeTextMeasurementResult) => {
          if (finished) return
          finished = true; clearTimeout(timer); callOptions.signal?.removeEventListener('abort', aborted)
          current.removeListener('closed', gone); current.webContents.removeListener('render-process-gone', gone)
          if (error) { destroy(); reject(error) } else resolve(result!)
        }
        const gone = () => finish(new Error('文字测量进程已退出，未应用修改'))
        const aborted = () => finish(callOptions.signal?.reason instanceof Error ? callOptions.signal.reason : new Error('文字测量已取消'))
        const timer = setTimeout(() => finish(new Error('文字测量超时，未应用修改')), timeoutMs)
        current.once('closed', gone); current.webContents.once('render-process-gone', gone)
        callOptions.signal?.addEventListener('abort', aborted, { once: true })
        if (callOptions.signal?.aborted) { aborted(); return }
        void (async () => {
          await loading
          if (finished) return
          // The function belongs to the packaged isolated page. JSON is data;
          // no user-authored function or arbitrary evaluate API crosses the port.
          const result = await current.webContents.executeJavaScript(`globalThis.__GUOLING_NATIVE_TEXT_MEASURE__(${JSON.stringify(spec)})`) as NativeTextMeasurementResult
          if (result?.measurementMode !== 'browser-canvas' || ![result.requiredWidth, result.requiredHeight].every(value => Number.isFinite(value) && value >= 0)) throw new Error('测量宿主没有返回真实有效的 Canvas 尺寸')
          finish(undefined, result)
        })().catch(error => finish(error instanceof Error ? error : new Error(String(error))))
      })
    })
    queue = task.catch(() => undefined)
    return task
  }
  return { measure, dispose() { disposed = true; destroy() } }
}
