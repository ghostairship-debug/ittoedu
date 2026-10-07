import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, net, session } from 'electron'
import type { ComputeBackend, ComputeBackendRequest, ComputeProcess, ComputeProcessResult, ComputeWorkerInput, ComputeWorkerReply } from './ComputeBackend'

export interface PyodideComputeBackendOptions {
  preloadPath: string
  rendererFile?: string
  rendererURL?: string
  runtimeDirectory: string
}

/** A disposable Chromium worker executes bytes. ComputeJobService alone owns disk outputs. */
export class PyodideComputeBackend implements ComputeBackend {
  readonly kind = 'pyodide' as const
  private readonly workers = new Map<string, { cancel(): Promise<boolean> }>()
  private disposed = false
  private readonly entry: URL
  constructor(private readonly options: PyodideComputeBackendOptions) {
    if (!options.rendererURL && !options.rendererFile) throw new Error('本地计算入口缺失')
    // A web origin prevents Worker fetch from inheriting Chromium's file-origin
    // access. This origin is supplied only by this private session's local handler.
    this.entry = options.rendererURL ? new URL(options.rendererURL) : new URL('https://guoling-compute.invalid/compute.html')
    if (options.rendererURL && (this.entry.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(this.entry.hostname)))
      throw new Error('开发计算入口必须为本机 HTTP')
  }
  async availability(): Promise<{ available: boolean; reason?: string }> {
    if (this.disposed) return { available: false, reason: '本地计算服务已关闭' }
    try {
      const root = path.resolve(this.options.runtimeDirectory)
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')) as {
        schemaVersion: number; pyodide: { entry: string }; packages: string[]; font: { file: string }
      }
      const local = (name: string) => {
        const file = path.resolve(root, name)
        if (!name || path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file))) throw new Error('计算资源路径无效')
        return file
      }
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) throw new Error('计算资源清单无效')
      const pyodide = path.dirname(local(manifest.pyodide.entry))
      const lock = JSON.parse(await fs.readFile(path.join(pyodide, 'pyodide-lock.json'), 'utf8')) as {
        packages: Record<string, { file_name: string; depends: string[] }>
      }
      const required = new Set<string>()
      const include = (name: string) => {
        if (required.has(name)) return
        const pkg = lock.packages[name]
        if (!pkg) throw new Error(`缺少计算库 ${name}`)
        required.add(name); (pkg.depends ?? []).forEach(include)
      }
      manifest.packages.forEach(include)
      await Promise.all([this.options.preloadPath, ...(this.options.rendererFile ? [this.options.rendererFile] : []),
        local(manifest.pyodide.entry), local(manifest.font.file), path.join(pyodide, 'pyodide.asm.mjs'),
        path.join(pyodide, 'pyodide.asm.wasm'), path.join(pyodide, 'python_stdlib.zip'),
        ...[...required].map(name => local(path.relative(root, path.join(pyodide, lock.packages[name].file_name))))]
        .map(async file => { if (!(await fs.stat(file)).isFile()) throw new Error('计算资源不是文件') }))
      return { available: true }
    } catch (error) { return { available: false, reason: `内置 Python 计算资源不完整：${error instanceof Error ? error.message : String(error)}` } }
  }
  async start(request: ComputeBackendRequest): Promise<ComputeProcess> {
    if (this.disposed) throw new Error('本地计算服务已关闭')
    if (request.code === undefined || !['python', 'python3'].includes(request.program)
      || request.argv.length !== 1 || request.argv[0] !== '/job/input/__main__.py')
      throw new Error('内置计算只接受 Python 源码；不支持宿主程序、命令行或本地原生扩展')
    if (this.workers.has(request.executionId)) throw new Error('计算作业已在运行')
    const isolated = session.fromPartition(`compute-${randomUUID()}`, { cache: false })
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', event => event.preventDefault())
    const rendererRoot = this.options.rendererFile ? path.dirname(path.resolve(this.options.rendererFile)) : undefined
    const runtimeRoot = path.resolve(this.options.runtimeDirectory)
    const within = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) }
    const localResource = (url: URL): string | undefined => {
      if (!rendererRoot || url.origin !== this.entry.origin) return undefined
      if (url.href === this.entry.href) return path.resolve(this.options.rendererFile!)
      const pathname = decodeURIComponent(url.pathname)
      if (pathname.startsWith('/vendor/compute-runtime/')) {
        const file = path.resolve(runtimeRoot, pathname.slice('/vendor/compute-runtime/'.length))
        if (within(runtimeRoot, file)) return file
      } else if (pathname.startsWith('/assets/')) {
        const root = path.join(rendererRoot, 'assets'), file = path.resolve(root, pathname.slice('/assets/'.length))
        if (within(root, file)) return file
      }
      return undefined
    }
    const allowedURL = (source: string) => {
      let allowed = false
      try {
        const url = new URL(source)
        if (url.href === this.entry.href) allowed = true
        else if (rendererRoot) allowed = !!localResource(url)
        else if (url.protocol === 'http:' && url.origin === this.entry.origin) {
          allowed = url.pathname.startsWith('/vendor/compute-runtime/') || url.pathname.startsWith('/src/renderer/compute/')
            || url.pathname === '/@vite/client' || url.pathname.startsWith('/node_modules/.vite/')
            || url.pathname.startsWith('/node_modules/vite/dist/client/')
        }
      } catch { /* Malformed and all other URLs remain blocked. */ }
      return allowed
    }
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedURL(details.url) }))
    let realResources: Promise<string[]> | undefined
    if (rendererRoot) isolated.protocol.handle('https', async request => {
      try {
        const file = localResource(new URL(request.url))
        if (!file) return Response.error()
        realResources ??= Promise.all([this.options.rendererFile!, runtimeRoot, path.join(rendererRoot, 'assets')].map(root => fs.realpath(root)))
        const [[entry, ...roots], actual] = await Promise.all([realResources, fs.realpath(file)])
        if (actual !== entry && !roots.some(root => within(root, actual))) return Response.error()
        // Only the mapped application resource is read by Main; no host path or
        // generic file reader is exposed to the Python worker.
        return await net.fetch(pathToFileURL(actual).href, { bypassCustomProtocolHandlers: true })
      } catch { return Response.error() }
    })
    const window = new BrowserWindow({ width: 32, height: 32, show: false, skipTaskbar: true,
      webPreferences: { preload: this.options.preloadPath, session: isolated, sandbox: true, contextIsolation: true,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false, backgroundThrottling: false } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.on('will-frame-navigate', event => event.preventDefault())
    const input: ComputeWorkerInput = { executionId: request.executionId, code: request.code,
      inputs: (request.inputs ?? []).map(file => ({ name: file.name, bytes: Uint8Array.from(file.bytes) })),
      runtimeBaseURL: new URL('vendor/compute-runtime/', this.entry).href }
    let resolveDone!: (result: ComputeProcessResult) => void
    const done = new Promise<ComputeProcessResult>(resolve => { resolveDone = resolve })
    let settled = false, sent = false
    const finish = (result: ComputeProcessResult) => {
      if (settled) return
      settled = true; this.workers.delete(request.executionId)
      if (!window.isDestroyed()) window.destroy()
      isolated.webRequest.onBeforeRequest(null)
      if (rendererRoot) isolated.protocol.unhandle('https')
      void isolated.clearStorageData().catch(() => undefined)
      resolveDone(result)
    }
    const failure = (message: string) => finish({ exitCode: null, stdout: '', stderr: message, truncated: false, cancelled: false })
    const process: ComputeProcess = { done, cancel: async () => {
      if (!settled) finish({ exitCode: null, stdout: '', stderr: '', truncated: false, cancelled: true })
      return true
    } }
    this.workers.set(request.executionId, process)
    window.once('closed', () => failure('本地计算窗口已退出，结果未知'))
    window.webContents.once('render-process-gone', () => failure('本地计算进程已退出，结果未知'))
    window.webContents.ipc.on('compute:ready', event => {
      if (settled || sent || event.senderFrame !== window.webContents.mainFrame) return
      sent = true; window.webContents.send('compute:input', input)
    })
    window.webContents.ipc.on('compute:result', (event, reply: ComputeWorkerReply) => {
      if (settled || !sent || event.senderFrame !== window.webContents.mainFrame || reply?.executionId !== request.executionId) return
      finish(reply)
    })
    // Return the cancellation handle before initialization; Stop also terminates package loading.
    void window.loadURL(this.entry.href).catch(error => failure(error instanceof Error ? error.message : String(error)))
    return process
  }
  async inspectExecution(executionId: string): Promise<'running' | 'missing'> { return this.workers.has(executionId) ? 'running' : 'missing' }
  async stopExecution(executionId: string): Promise<boolean> { return await this.workers.get(executionId)?.cancel() ?? true }
  dispose(): void { this.disposed = true; for (const worker of this.workers.values()) void worker.cancel(); this.workers.clear() }
}
