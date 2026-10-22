import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { validateCourseProjectV10Archive } from '../../../core/drivers/codecs/courseProjectV10Archive'
import type { PptxImportBuildInput, PptxImportBuildResult, PptxImportConversionInput, PptxImportConversionReply, PreparedPptxCourse, PptxImportDraft } from '../../../shared/workbench/pptxImport'
export type { PptxImportConversionInput, PptxImportConversionReply, PreparedPptxCourse } from '../../../shared/workbench/pptxImport'

/** Converts authorized, frozen bytes only. File/Session owners create, open and save the result. */
export class PptxCourseImportProducer {
  private readonly workers = new Set<BrowserWindow>()
  private disposed = false
  private readonly entry: string
  constructor(rendererEntryUrl: string) { this.entry = new URL('pptx-import.html', rendererEntryUrl).toString() }

  async prepare(input: { bytes: Uint8Array; filename: string }, signal?: AbortSignal): Promise<PreparedPptxCourse> {
    const result = await this.convert({ ...input, mode: 'course', requestId: randomUUID() }, signal)
    if (result.mode !== 'course') throw new Error('PPTX 转换没有产生工程')
    return result.course
  }
  async parse(input: { bytes: Uint8Array; filename: string; canvas: { width: number; height: number } }, signal?: AbortSignal): Promise<PptxImportDraft> {
    const result = await this.convert({ ...input, mode: 'draft', requestId: randomUUID() }, signal)
    if (result.mode !== 'draft') throw new Error('PPTX 转换没有产生页面草稿')
    return result.draft
  }
  private async convert(input: PptxImportBuildInput, signal?: AbortSignal): Promise<PptxImportBuildResult> {
    if (this.disposed || signal?.aborted) throw new Error('PPTX 导入已取消')
    const request: PptxImportConversionInput = { ...input, ...(input.mode === 'draft' ? { canvas: { ...input.canvas } } : {}),
      filename: path.basename(input.filename), bytes: Uint8Array.from(input.bytes) }
    const worker = new BrowserWindow({ width: 32, height: 32, show: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, '..', '..', '..', 'preload', 'pptxImport.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } })
    this.workers.add(worker)
    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    worker.webContents.on('will-navigate', (event, url) => { if (url !== this.entry) event.preventDefault() })
    return new Promise<PptxImportBuildResult>((resolve, reject) => {
      let settled = false, sent = false
      const finish = (error?: unknown, result?: PptxImportBuildResult) => {
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
          if (reply.mode !== request.mode) throw new Error('PPTX 转换结果模式与请求不一致')
          if (reply.mode === 'course') {
            const { model } = reply.course
            if (model.kind !== 'course-v10') throw new Error('PPTX 转换没有产生工程')
            // Preserve the original archive boundary's schema and resource
            // closure checks without manufacturing and then reopening a ZIP.
            validateCourseProjectV10Archive({ project: model.project, resources: model.resources })
            finish(undefined, { mode: 'course', course: reply.course })
          } else {
            if (!Array.isArray(reply.draft.slides) || !Array.isArray(reply.draft.assets) || !Array.isArray(reply.draft.notes)
              || !Array.isArray(reply.draft.issues) || reply.draft.assets.some(asset => !(asset.bytes instanceof Uint8Array))) throw new Error('PPTX 页面草稿未返回完整结果')
            finish(undefined, { mode: 'draft', draft: reply.draft })
          }
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
