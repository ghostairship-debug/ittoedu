import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipcTypes'
import { componentCompilationInputSchema } from '../../../shared/workbench/componentCompilation'
import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import type { InMemoryComponentCompilation } from '../../../core/components/compilation/InMemoryComponentCompilation'
import { DocumentExportPort } from './DocumentExportPort'
import { z } from 'zod'
import { publishedCourseV3Schema } from '../../../shared/contracts/component-platform/published'
import { ViewObservationDesktopService } from '../observation/ViewObservationDesktopService'

const captureSchema = z.object({ kind: z.literal('published'), published: publishedCourseV3Schema,
  surfaceId: z.string().min(1), stateId: z.string().min(1).nullable().optional(),
  instanceId: z.string().min(1).optional(), spatialFrameId: z.string().min(1).optional() }).strict()

/** A build-only, one-request worker. Its narrow preload cannot open or mutate documents. */
export class HeadlessDocumentExportWorker {
  private readonly workers = new Set<BrowserWindow>()
  private readonly active = new Map<BrowserWindow, { request: ExportBuildRequest; controller: AbortController }>()
  private readonly observations: ViewObservationDesktopService
  private disposed = false
  private readonly compileChannel = 'document-export:compile'
  private readonly captureChannel = 'document-export:capture-published'
  private readonly capture = async (event: Electron.IpcMainInvokeEvent, raw: unknown) => {
    const worker = [...this.workers].find(window => !window.isDestroyed() && window.webContents === event.sender)
    const active = worker && this.active.get(worker)
    if (!active || event.senderFrame !== event.sender.mainFrame || event.sender.getURL() !== this.entry)
      throw new Error('输出捕获不属于当前导出 worker')
    const input = raw as { requestId?: string; identity?: ExportBuildRequest['identity']; capture?: unknown } | null
    const expected = active.request.identity, actual = input?.identity
    if (!actual || input?.requestId !== active.request.requestId || actual.documentId !== expected.documentId
      || actual.epoch !== expected.epoch || actual.revision !== expected.revision || actual.projectId !== expected.projectId)
      throw new Error('输出捕获身份与当前导出请求不一致')
    active.controller.signal.throwIfAborted()
    const capture = captureSchema.parse(input.capture)
    if (capture.published.id !== expected.projectId) throw new Error('输出捕获工程与当前导出请求不一致')
    const result = await this.observations.capturePublished({ published: capture.published, locationId: capture.surfaceId,
      stateId: capture.stateId, instanceId: capture.instanceId, spatialFrameId: capture.spatialFrameId, signal: active.controller.signal })
    active.controller.signal.throwIfAborted()
    return { dataUrl: `data:image/png;base64,${Buffer.from(result.png).toString('base64')}`, width: result.width, height: result.height }
  }
  private readonly compile = (event: Electron.IpcMainInvokeEvent, raw: unknown) => {
    const worker = [...this.workers].find(window => !window.isDestroyed() && window.webContents === event.sender)
    if (!worker || event.senderFrame !== event.sender.mainFrame || event.sender.getURL() !== this.entry)
      throw new Error('导出构建请求不属于当前隐藏 worker')
    return this.compilation.compile(componentCompilationInputSchema.parse(raw))
  }
  private readonly entry: string
  constructor(rendererEntryUrl: string, private readonly compilation: Pick<InMemoryComponentCompilation, 'compile'>) {
    this.entry = new URL('document-export.html', rendererEntryUrl).toString()
    this.observations = new ViewObservationDesktopService({ rendererEntryUrl, compilation })
    ipcMain.handle(this.compileChannel, this.compile)
    ipcMain.handle(this.captureChannel, this.capture)
  }
  async build(request: ExportBuildRequest, signal?: AbortSignal): Promise<ExportBuildReply> {
    if (this.disposed || signal?.aborted) throw new Error('导出已取消')
    const worker = new BrowserWindow({ width: 1280, height: 720, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, '..', '..', '..', 'preload', 'documentExport.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } })
    this.workers.add(worker)
    const controller = new AbortController()
    this.active.set(worker, { request, controller })
    const port = new DocumentExportPort(worker.webContents.id,
      input => worker.webContents.send(IPC_CHANNELS.documentExportBuildRequest, input),
      input => { if (!worker.isDestroyed()) worker.webContents.send('document-export:build-cancel', input) })
    const receive = (event: Electron.IpcMainEvent, reply: unknown) => { port.accept(reply, event.sender.id) }
    const progress = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame) return
      port.progress(value, event.sender.id)
    }
    const closed = () => { controller.abort(); port.dispose() }
    const abort = () => { controller.abort(); port.dispose(); if (!worker.isDestroyed()) worker.destroy() }
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
      controller.abort(); this.active.delete(worker)
      this.workers.delete(worker)
      if (!worker.isDestroyed()) worker.destroy()
    }
  }
  dispose(): void {
    this.disposed = true
    ipcMain.removeHandler(this.compileChannel)
    ipcMain.removeHandler(this.captureChannel)
    for (const { controller } of this.active.values()) controller.abort()
    this.active.clear()
    for (const worker of this.workers) if (!worker.isDestroyed()) worker.destroy()
    this.workers.clear()
  }
}
