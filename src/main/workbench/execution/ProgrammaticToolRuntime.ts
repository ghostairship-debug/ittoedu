import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { ToolResult } from '../../../shared/workbench/tools'
import { PROGRAMMATIC_BOOTSTRAP_HTML } from '../../../shared/workbench/programmaticRuntimeSource'

export interface ProgrammaticRuntimeDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
export interface ProgrammaticRuntimeInput {
  code: string
  definitions: readonly ProgrammaticRuntimeDefinition[]
  signal?: AbortSignal
  call(name: string, input: unknown): Promise<ToolResult>
}
export type ProgrammaticRuntimeResult =
  | { status: 'completed'; value: unknown }
  | { status: 'failed' | 'cancelled'; error: string }
export interface ProgrammaticRuntime { execute(input: ProgrammaticRuntimeInput): Promise<ProgrammaticRuntimeResult> }
export interface ChromiumProgrammaticRuntimeOptions { preloadPath?: string }

const errorMessage = (error: unknown): string => {
  try { return error instanceof Error ? String(error.message) : String(error) }
  catch { return 'Programmatic execution failed' }
}

/** Disposable Chromium isolation; no VM context or application renderer is reused. */
export class ChromiumProgrammaticRuntime implements ProgrammaticRuntime {
  private readonly preloadPath: string
  constructor(options: ChromiumProgrammaticRuntimeOptions = {}) {
    this.preloadPath = options.preloadPath ?? path.join(__dirname, '../../../preload/programmatic.js')
  }

  async execute(input: ProgrammaticRuntimeInput): Promise<ProgrammaticRuntimeResult> {
    if (input.signal?.aborted) return { status: 'cancelled', error: 'Programmatic execution cancelled' }
    const isolated = session.fromPartition(`programmatic-${randomUUID()}`, { cache: false })
    const entry = `https://guoling-programmatic.invalid/${randomUUID()}/index.html`
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', event => event.preventDefault())
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== entry }))
    isolated.protocol.handle('https', request => request.url === entry
      ? new Response(PROGRAMMATIC_BOOTSTRAP_HTML, { headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      } })
      : Response.error())

    let window: BrowserWindow
    try {
      window = new BrowserWindow({ width: 32, height: 32, show: false, skipTaskbar: true,
        webPreferences: { preload: this.preloadPath, session: isolated, sandbox: true, contextIsolation: true,
          nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
          webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false,
          backgroundThrottling: false } })
    } catch (error) {
      isolated.webRequest.onBeforeRequest(null)
      isolated.protocol.unhandle('https')
      void isolated.clearStorageData().catch(() => undefined)
      return { status: 'failed', error: errorMessage(error) }
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-frame-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())

    return await new Promise<ProgrammaticRuntimeResult>(resolve => {
      let settled = false, sent = false
      const calls = new Set<number>()
      const finish = (result: ProgrammaticRuntimeResult) => {
        if (settled) return
        settled = true
        input.signal?.removeEventListener('abort', cancel)
        if (!window.isDestroyed()) window.destroy()
        isolated.webRequest.onBeforeRequest(null)
        isolated.protocol.unhandle('https')
        void isolated.clearStorageData().catch(() => undefined)
        resolve(result)
      }
      const fail = (error: unknown) => finish({ status: 'failed', error: errorMessage(error) })
      const cancel = () => finish({ status: 'cancelled', error: 'Programmatic execution cancelled' })
      window.once('closed', () => fail('Programmatic runtime window exited'))
      window.webContents.once('render-process-gone', () => fail('Programmatic runtime process exited'))
      window.webContents.once('preload-error', (_event, _file, error) => fail(error))
      window.webContents.ipc.on('programmatic:ready', event => {
        if (settled || sent || event.senderFrame !== window.webContents.mainFrame) return
        sent = true
        window.webContents.send('programmatic:input', { code: input.code, definitions: input.definitions })
      })
      window.webContents.ipc.on('programmatic:call', (event, request: { callId?: unknown; name?: unknown; inputJSON?: unknown }) => {
        if (settled || !sent || event.senderFrame !== window.webContents.mainFrame) return
        if (!request || !Number.isSafeInteger(request.callId) || (request.callId as number) <= 0
          || typeof request.name !== 'string' || !request.name || typeof request.inputJSON !== 'string') {
          fail('Invalid programmatic tool request'); return
        }
        const callId = request.callId as number
        if (calls.has(callId)) { fail('Duplicate programmatic tool request'); return }
        calls.add(callId)
        void (async () => {
          let reply: { callId: number; ok: boolean; resultJSON?: string; error?: string }
          try {
            const result = await input.call(request.name as string, JSON.parse(request.inputJSON as string))
            const resultJSON = JSON.stringify(result)
            if (resultJSON === undefined) throw new Error('Tool result is not JSON serializable')
            reply = { callId, ok: true, resultJSON }
          } catch (error) { reply = { callId, ok: false, error: errorMessage(error) } }
          if (!settled && !window.isDestroyed()) window.webContents.send('programmatic:tool-result', reply)
        })()
      })
      window.webContents.ipc.on('programmatic:result', (event, reply: { status?: unknown; valueJSON?: unknown; error?: unknown }) => {
        if (settled || !sent || event.senderFrame !== window.webContents.mainFrame) return
        if (reply?.status === 'completed' && typeof reply.valueJSON === 'string') {
          try { finish({ status: 'completed', value: JSON.parse(reply.valueJSON) }) }
          catch { fail('Programmatic result is not JSON serializable') }
        } else if (reply?.status === 'failed' && typeof reply.error === 'string') fail(reply.error)
        else fail('Invalid programmatic runtime result')
      })
      input.signal?.addEventListener('abort', cancel, { once: true })
      if (input.signal?.aborted) { cancel(); return }
      void window.loadURL(entry).catch(fail)
    })
  }
}
