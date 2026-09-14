import { randomUUID } from 'node:crypto'
import { BrowserWindow, session, type WebContents } from 'electron'
import { dynamicAdmissionRequestSchema, dynamicAdmissionResultSchema, type DynamicAdmissionResult } from '../shared/dynamicAdmissionContract'
import { installEditorProtocol } from './protocols'
import { configureRestrictedSession } from './security'
import { PreviewNetworkPolicy } from './previewNetworkPolicy'

const runs = new Map<string, { owner: WebContents; cancel(): void }>()

/** The deadline and termination live in Main, outside the candidate's JavaScript process. */
export async function operateDynamicAdmission(raw: unknown, owner: WebContents, rendererEntryUrl: string): Promise<DynamicAdmissionResult> {
  const request = dynamicAdmissionRequestSchema.parse(raw)
  if (request.operation === 'cancel') {
    const run = runs.get(request.id)
    if (run?.owner === owner) run.cancel()
    return { ok: false, message: '准入已取消' }
  }
  if (runs.has(request.id) || runs.size >= 2) throw new Error('动态准入正在运行，请稍后重试')
  const assets = new Map<string, { bytes: Uint8Array; mimeType: string }>()
  const assetResources: Record<string, { url: string; byteLength: number }> = {}
  const resourcePrefix = `/admission-assets/${request.id}/`
  for (const [id, value] of Object.entries(request.payload.assetFiles)) {
    const meta = request.payload.project.assets[id] ?? Object.values(request.payload.project.assets).find(meta => meta.id === id)
    if (!meta) continue
    const bytes = typeof value === 'string' ? new Uint8Array(Buffer.from(value, 'base64')) : value
    const resourcePath = `${resourcePrefix}${assets.size}`
    assets.set(resourcePath, { bytes, mimeType: meta.mimeType })
    assetResources[id] = { url: `courseware-editor://app${resourcePath}`, byteLength: bytes.byteLength }
  }
  // Bytes travel via structured clone, never JSON/base64, and are served lazily
  // by this run's isolated session. Callers cannot supply their own URL claims.
  const encoded = JSON.stringify({ ...request.payload, assetFiles: {}, assetResources })
  if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw new Error('动态候选准入载荷超过 64 MiB')
  const isolatedSession = session.fromPartition(`admission-${randomUUID()}`)
  installEditorProtocol(isolatedSession, url => {
    if (!url.pathname.startsWith('/admission-assets/')) return undefined
    const asset = assets.get(url.pathname)
    return asset ? new Response(asset.bytes.slice().buffer as ArrayBuffer, { headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-store',
      ...(/^https?:/.test(rendererEntryUrl) ? { 'Access-Control-Allow-Origin': new URL(rendererEntryUrl).origin } : {}) } }) : new Response('Not found', { status: 404 })
  })
  const network = new PreviewNetworkPolicy()
  const entryOrigin = new URL(rendererEntryUrl)
  network.replaceBaseOrigins(['http:', 'https:'].includes(entryOrigin.protocol) ? [entryOrigin.origin] : [])
  const networkOwner = { processId: 0, frameToken: request.id, documentToken: request.id }
  network.activateDocument(networkOwner)
  network.replacePreviewLease({ leaseId: request.id, connectOrigins: request.payload.project.network?.connectOrigins ?? [],
    remoteAssetUrls: Object.entries(request.payload.project.assets).flatMap(([id, asset]) => !request.payload.assetFiles[id] && asset.remote ? [asset.remote.url] : []) }, networkOwner)
  configureRestrictedSession(isolatedSession, url => network.allowsRequest(url))
  const worker = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, frame: false, show: false, skipTaskbar: true,
    webPreferences: { session: isolatedSession, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } })
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const entry = new URL('admission.html', rendererEntryUrl).toString()
  worker.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault() })
  let rejectStop!: (error: Error) => void
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject })
  const stop = (message: string) => {
    rejectStop(new Error(message))
    if (!worker.isDestroyed()) {
      worker.webContents.forcefullyCrashRenderer()
      worker.destroy()
    }
  }
  const ownerGone = () => stop('编辑器已关闭，准入取消')
  const workerGone = () => rejectStop(new Error('动态准入进程异常退出'))
  runs.set(request.id, { owner, cancel: () => stop('动态准入已取消') })
  owner.once('destroyed', ownerGone)
  worker.webContents.once('render-process-gone', workerGone)
  let timer = setTimeout(() => stop('动态候选启动或单目标准入超时'), 20_000)
  const absoluteTimer = setTimeout(() => stop('动态准入超过绝对任务上限'), 20 * 60_000)
  try {
    const result = await Promise.race([stopped, (async () => {
      await worker.loadURL(entry)
      const processId = worker.webContents.getOSProcessId()
      if (!processId || processId === owner.getOSProcessId()) throw new Error('候选准入未获得独立执行进程')
      // This fixed entrypoint is shipped by the product. No candidate-supplied completion callback or preload API exists.
      let completed = false
      const execute = worker.webContents.executeJavaScript(`window.__COURSEWARE_ADMISSION_RUN__(${encoded})`).finally(() => { completed = true })
      const captureFrames = async () => {
        let capturedBytes = 0
        let clicked = false
        let progress = 0
        while (!completed && !worker.isDestroyed()) {
          const pending = await worker.webContents.executeJavaScript('({frame:window.__COURSEWARE_ADMISSION_PENDING_FRAME__?.()??null,button:window.__COURSEWARE_ADMISSION_PENDING_BUTTON__?.()??null,progress:window.__COURSEWARE_ADMISSION_PROGRESS__?.()??0})') as { frame: { id: number } | null; button: { id: number; x: number; y: number } | null; progress: number }
          if (Number.isInteger(pending.progress) && pending.progress > progress && pending.progress <= request.payload.targets.length) {
            progress = pending.progress
            clearTimeout(timer)
            timer = setTimeout(() => stop('动态候选单目标准入超时'), 20_000)
          }
          if (completed || worker.isDestroyed()) break
          if (pending.button) {
            const { id, x, y } = pending.button, [width, height] = worker.getContentSize()
            if (!request.payload.buttonCheck || clicked || !Number.isSafeInteger(id) || id < 1
              || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) throw new Error('动态按钮输入超出单次候选检查范围')
            clicked = true
            const point = { x: Math.round(x), y: Math.round(y) }
            worker.webContents.sendInputEvent({ type: 'mouseMove', ...point })
            worker.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
            worker.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
            await worker.webContents.executeJavaScript(`window.__COURSEWARE_ADMISSION_ACCEPT_BUTTON__(${id})`)
            continue
          }
          const frame = pending.frame
          if (!frame) { await new Promise(resolve => setTimeout(resolve, 16)); continue }
          if (!Number.isSafeInteger(frame.id) || frame.id < 1) throw new Error('动态观察帧身份无效')
          const bitmap = await worker.webContents.capturePage(), dataUrl = bitmap.toDataURL()
          capturedBytes += dataUrl.length
          if (capturedBytes > 48_000_000) throw new Error('动态观察图像超过本轮资源上限')
          const size = bitmap.getSize(), payload = { dataUrl, capturedAt: Date.now(), width: size.width, height: size.height }
          await worker.webContents.executeJavaScript(`window.__COURSEWARE_ADMISSION_ACCEPT_FRAME__(${frame.id},${JSON.stringify(payload)})`)
        }
      }
      const [outcome] = await Promise.all([execute, captureFrames()])
      return dynamicAdmissionResultSchema.parse({ ...outcome, processId })
    })()])
    return result
  } catch (error) {
    return { ok: false, message: (error instanceof Error ? error.message : String(error)).slice(0, 4000) }
  } finally {
    clearTimeout(timer)
    clearTimeout(absoluteTimer)
    runs.delete(request.id)
    owner.removeListener('destroyed', ownerGone)
    if (!worker.isDestroyed()) worker.destroy()
    await isolatedSession.clearStorageData()
    assets.clear()
  }
}
