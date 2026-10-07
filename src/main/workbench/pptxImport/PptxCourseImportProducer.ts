import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { CourseV10Driver } from '../../../core/drivers/CourseV10Driver'
import type { DocumentModel } from '../../../shared/workbench/document'
import type { PptxImportIssue } from '../../../renderer/project/pptxPackage'

export interface PptxImportConversionInput { requestId: string; bytes: Uint8Array; filename: string }
export type PptxImportConversionReply =
  | { requestId: string; status: 'converted'; archiveBytes: Uint8Array; suggestedName: string; issues: PptxImportIssue[] }
  | { requestId: string; status: 'failed'; reason: string }
export interface PreparedPptxCourse {
  model: Extract<DocumentModel, { kind: 'course-v10' }>
  archiveBytes: Uint8Array
  suggestedName: string
  issues: readonly PptxImportIssue[]
}

/** Converts authorized, frozen bytes only. File/Session owners create, open and save the result. */
export class PptxCourseImportProducer {
  private readonly workers = new Set<BrowserWindow>()
  private disposed = false
  private readonly entry: string
  constructor(rendererEntryUrl: string) { this.entry = new URL('pptx-import.html', rendererEntryUrl).toString() }

  async prepare(input: { bytes: Uint8Array; filename: string }, signal?: AbortSignal): Promise<PreparedPptxCourse> {
    if (this.disposed || signal?.aborted) throw new Error('PPTX 导入已取消')
    const request: PptxImportConversionInput = { requestId: randomUUID(), filename: path.basename(input.filename), bytes: Uint8Array.from(input.bytes) }
    const worker = new BrowserWindow({ width: 32, height: 32, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, '..', '..', '..', 'preload', 'pptxImport.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } })
    this.workers.add(worker)
    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    worker.webContents.on('will-navigate', (event, url) => { if (url !== this.entry) event.preventDefault() })
    return new Promise<PreparedPptxCourse>((resolve, reject) => {
      let settled = false, sent = false
      const finish = (error?: unknown, result?: PreparedPptxCourse) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        this.workers.delete(worker)
        if (!worker.isDestroyed()) worker.destroy()
        if (error) reject(error); else resolve(result!)
      }
      const abort = () => finish(new Error('PPTX 导入已取消；尚未创建或修改工程'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.once('closed', () => finish(new Error('PPTX 转换窗口已关闭；尚未创建或修改工程')))
      worker.webContents.once('render-process-gone', () => finish(new Error('PPTX 转换进程已退出；尚未创建或修改工程')))
      worker.webContents.ipc.on('pptx-import:ready', event => {
        if (event.senderFrame !== worker.webContents.mainFrame || sent || settled) return
        sent = true
        worker.webContents.send('pptx-import:input', request)
      })
      worker.webContents.ipc.on('pptx-import:result', (event, reply: PptxImportConversionReply) => {
        if (event.senderFrame !== worker.webContents.mainFrame || !sent || settled || reply?.requestId !== request.requestId) return
        if (reply.status !== 'converted') { finish(new Error(reply.reason || 'PPTX 转换失败；源文件未改变')); return }
        try {
          signal?.throwIfAborted()
          // The canonical driver consumes the real archive and its sidecars before a writer receives it.
          const model = new CourseV10Driver().load(reply.archiveBytes)
          if (model.kind !== 'course-v10') throw new Error('PPTX 转换没有产生 V10 工程')
          finish(undefined, { model, archiveBytes: reply.archiveBytes, suggestedName: reply.suggestedName, issues: reply.issues })
        } catch (error) { finish(error) }
      })
      if (signal?.aborted || this.disposed) { abort(); return }
      void worker.loadURL(this.entry).catch(error => finish(error))
    })
  }

  dispose(): void {
    this.disposed = true
    for (const worker of this.workers) if (!worker.isDestroyed()) worker.destroy()
    this.workers.clear()
  }
}
