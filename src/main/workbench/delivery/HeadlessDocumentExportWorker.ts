import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipcTypes'
import { componentCompilationInputSchema } from '../../../shared/workbench/componentCompilation'
import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import type { InMemoryComponentCompilation } from '../../../core/components/compilation/InMemoryComponentCompilation'
import { DocumentExportPort } from './DocumentExportPort'

/** A build-only, one-request worker. Its narrow preload cannot open or mutate documents. */
export class HeadlessDocumentExportWorker {
  private readonly workers = new Set<BrowserWindow>()
  private disposed = false
  private readonly compileChannel = 'document-export:compile'
  private readonly compile = (event: Electron.IpcMainInvokeEvent, raw: unknown) => {
    const worker = [...this.workers].find(window => !window.isDestroyed() && window.webContents === event.sender)
    if (!worker || event.senderFrame !== event.sender.mainFrame || event.sender.getURL() !== this.entry)
      throw new Error('导出构建请求不属于当前隐藏 worker')
    return this.compilation.compile(componentCompilationInputSchema.parse(raw))
  }
  private readonly entry: string
  constructor(rendererEntryUrl: string, private readonly compilation: Pick<InMemoryComponentCompilation, 'compile'>) {
    this.entry = new URL('document-export.html', rendererEntryUrl).toString()
    ipcMain.handle(this.compileChannel, this.compile)
  }
  async build(request: ExportBuildRequest, signal?: AbortSignal): Promise<ExportBuildReply> {
    if (this.disposed || signal?.aborted) throw new Error('导出已取消')
    const worker = new BrowserWindow({ width: 1280, height: 720, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, '..', '..', '..', 'preload', 'documentExport.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } })
    this.workers.add(worker)
    const port = new DocumentExportPort(worker.webContents.id,
      input => worker.webContents.send(IPC_CHANNELS.documentExportBuildRequest, input),
      input => { if (!worker.isDestroyed()) worker.webContents.send('document-export:build-cancel', input) })
    const receive = (event: Electron.IpcMainEvent, reply: unknown) => { port.accept(reply, event.sender.id) }
    const progress = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame) return
      port.progress(value, event.sender.id)
    }
    const closed = () => port.dispose()
    const abort = () => { port.dispose(); if (!worker.isDestroyed()) worker.destroy() }
    ipcMain.on(IPC_CHANNELS.documentExportBuildReply, receive)
    ipcMain.on('document-export:build-progress', progress)
    worker.once('closed', closed)
    worker.webContents.once('render-process-gone', closed)
    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    worker.webContents.on('will-navigate', (event, url) => { if (url !== this.entry) event.preventDefault() })
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) abort()
      await worker.loadURL(this.entry)
      if (signal?.aborted || this.disposed) throw new Error('导出已取消')
      return await port.build(request, signal)
    } finally {
      signal?.removeEventListener('abort', abort)
      ipcMain.removeListener(IPC_CHANNELS.documentExportBuildReply, receive)
      ipcMain.removeListener('document-export:build-progress', progress)
      port.dispose()
      this.workers.delete(worker)
      if (!worker.isDestroyed()) worker.destroy()
    }
  }
  dispose(): void {
    this.disposed = true
    ipcMain.removeHandler(this.compileChannel)
    for (const worker of this.workers) if (!worker.isDestroyed()) worker.destroy()
    this.workers.clear()
  }
}
