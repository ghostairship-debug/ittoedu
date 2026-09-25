import { BrowserWindow, session } from 'electron'
import { AttachmentError } from './AttachmentService'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AttachmentExtractor, AttachmentExtractionInput, AttachmentExtractionResult } from '../../../shared/workbench/attachments'

export interface SandboxedAttachmentExtractionOptions {
  preloadPath: string
  /** Development: exact local Vite extraction entry. Production: rendererFile. */
  rendererURL?: string
  rendererFile?: string
  timeoutMs?: number
}

export function createSandboxedAttachmentExtractor(options: SandboxedAttachmentExtractionOptions): AttachmentExtractor {
  if (!!options.rendererURL === !!options.rendererFile) throw new Error('Specify exactly one extraction entry')
  const entry = new URL(options.rendererURL ?? pathToFileURL(path.resolve(options.rendererFile!)).href)
  if (entry.pathname.split('/').pop() !== 'attachment-extraction.html' || entry.search || entry.hash) throw new Error('Invalid extraction entry')
  if (options.rendererURL && (entry.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(entry.hostname))) throw new Error('Development extraction entry must be loopback HTTP')
  const timeoutMs = options.timeoutMs ?? 60_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid extraction timeout')
  return { async extract(input: AttachmentExtractionInput, callOptions = {}): Promise<AttachmentExtractionResult> {
    const frozen = structuredClone(input)
    const cancelled = () => callOptions.signal?.reason instanceof AttachmentError && callOptions.signal.reason.code === 'operation-cancelled'
      ? callOptions.signal.reason
      : new AttachmentError('operation-cancelled', '附件提取已取消', { cause: callOptions.signal?.reason })
    if (callOptions.signal?.aborted) throw cancelled()
    const isolatedSession = session.fromPartition(`attachment-extraction-${randomUUID()}`, { cache: false })
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.on('will-download', event => event.preventDefault())
    const rendererRoot = options.rendererFile ? path.dirname(path.resolve(options.rendererFile)) : undefined
    isolatedSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false
      try {
        const url = new URL(details.url)
        if (url.protocol === 'blob:' || url.protocol === 'data:') allowed = true
        else if (rendererRoot && url.protocol === 'file:') {
          const filename = path.resolve(fileURLToPath(url)), relative = path.relative(rendererRoot, filename)
          allowed = !relative.startsWith('..') && !path.isAbsolute(relative) && (filename === path.resolve(options.rendererFile!) || relative.startsWith(`assets${path.sep}`))
        } else if (!rendererRoot && url.origin === entry.origin && url.protocol === 'http:') allowed = true
      } catch { /* Unknown URLs are blocked. */ }
      callback({ cancel: !allowed })
    })
    const window = new BrowserWindow({ show: false, width: 32, height: 32, webPreferences: {
      preload: path.resolve(options.preloadPath), sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, devTools: false, backgroundThrottling: false, session: isolatedSession,
    } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-frame-navigate', event => event.preventDefault())
    return new Promise((resolve, reject) => {
      let settled = false, sent = false
      const finish = (error?: Error, result?: AttachmentExtractionResult) => {
        if (settled) return
        settled = true; clearTimeout(timer); callOptions.signal?.removeEventListener('abort', onAbort)
        if (!window.isDestroyed()) window.destroy()
        isolatedSession.webRequest.onBeforeRequest(null)
        if (error) reject(error); else resolve(result!)
      }
      const onAbort = () => finish(cancelled())
      const timer = setTimeout(() => finish(new AttachmentError('extraction-timeout', '附件提取超时，工作窗口已关闭')), timeoutMs)
      callOptions.signal?.addEventListener('abort', onAbort, { once: true })
      window.on('closed', () => finish(new AttachmentError('extraction-exited', '附件提取工作窗口已关闭')))
      window.webContents.on('render-process-gone', () => finish(new AttachmentError('extraction-exited', '附件提取进程已退出')))
      window.webContents.ipc.on('attachment-extraction:ready', event => {
        if (event.senderFrame !== window.webContents.mainFrame || sent || settled) return
        sent = true; window.webContents.send('attachment-extraction:input', frozen)
      })
      window.webContents.ipc.on('attachment-extraction:result', (event, payload: { ok?: boolean; error?: string; result?: AttachmentExtractionResult }) => {
        if (event.senderFrame !== window.webContents.mainFrame || !sent || settled) return
        if (payload?.ok === true && payload.result) finish(undefined, payload.result)
        else finish(new AttachmentError('extraction-failed', '附件提取未完成', { cause: payload?.error }))
      })
      if (callOptions.signal?.aborted) { onAbort(); return }
      void window.loadURL(entry.href).catch(error => { console.error('附件提取窗口载入失败', error); finish(new AttachmentError('extraction-start-failed', '附件提取窗口载入失败', { cause: error })) })
    })
  } }
}
