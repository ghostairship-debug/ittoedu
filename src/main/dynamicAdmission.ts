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
  const encoded = JSON.stringify(request.payload)
  if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw new Error('动态候选准入载荷超过 64 MiB')
  const isolatedSession = session.fromPartition(`admission-${randomUUID()}`)
  installEditorProtocol(isolatedSession)
  const network = new PreviewNetworkPolicy()
  const entryOrigin = new URL(rendererEntryUrl)
  network.replaceBaseOrigins(['http:', 'https:'].includes(entryOrigin.protocol) ? [entryOrigin.origin] : [])
  const networkOwner = { processId: 0, frameToken: request.id, documentToken: request.id }
  network.activateDocument(networkOwner)
  network.replacePreviewLease({ leaseId: request.id, connectOrigins: request.payload.project.network?.connectOrigins ?? [],
    remoteAssetUrls: Object.entries(request.payload.project.assets).flatMap(([id, asset]) => !request.payload.assetFiles[id] && asset.remote ? [asset.remote.url] : []) }, networkOwner)
  configureRestrictedSession(isolatedSession, url => network.allowsRequest(url))
  const worker = new BrowserWindow({ width: 1280, height: 720, show: false, skipTaskbar: true,
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
  const timer = setTimeout(() => stop('动态候选独立进程准入超时'), 20_000)
  try {
    const result = await Promise.race([stopped, (async () => {
      await worker.loadURL(entry)
      const processId = worker.webContents.getOSProcessId()
      if (!processId || processId === owner.getOSProcessId()) throw new Error('候选准入未获得独立执行进程')
      // This fixed entrypoint is shipped by the product. No candidate-supplied completion callback or preload API exists.
      const outcome = await worker.webContents.executeJavaScript(`window.__COURSEWARE_ADMISSION_RUN__(${encoded})`)
      return dynamicAdmissionResultSchema.parse({ ...outcome, processId })
    })()])
    return result
  } catch (error) {
    return { ok: false, message: (error instanceof Error ? error.message : String(error)).slice(0, 4000) }
  } finally {
    clearTimeout(timer)
    runs.delete(request.id)
    owner.removeListener('destroyed', ownerGone)
    if (!worker.isDestroyed()) worker.destroy()
    await isolatedSession.clearStorageData()
  }
}
