import { contextBridge, ipcRenderer } from 'electron'
import type { PptxImportConversionInput, PptxImportConversionReply } from '../main/workbench/pptxImport/PptxCourseImportProducer'

// One conversion job; no workbench file, document or generic IPC access.
let started = false
contextBridge.exposeInMainWorld('pptxImportWorkerAPI', {
  run(convert: (input: PptxImportConversionInput) => Promise<PptxImportConversionReply>): void {
    if (started) throw new Error('PPTX 转换 worker 已启动')
    started = true
    ipcRenderer.once('pptx-import:input', async (_event, input: PptxImportConversionInput) => {
      try { ipcRenderer.send('pptx-import:result', await convert(input)) }
      catch (error) { ipcRenderer.send('pptx-import:result', { requestId: input.requestId, status: 'failed', reason: error instanceof Error ? error.message : String(error) }) }
    })
    ipcRenderer.send('pptx-import:ready')
  },
})
