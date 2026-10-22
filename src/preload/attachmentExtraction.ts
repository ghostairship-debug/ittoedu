import { contextBridge, ipcRenderer } from 'electron'
import type { AttachmentExtractionJobInput, AttachmentExtractionJobResult, AttachmentExtractionJobOptions } from '../shared/workbench/attachments'

// A sandbox preload exposes exactly one extraction job, never a generic IPC primitive.
let started = false
contextBridge.exposeInMainWorld('attachmentExtraction', {
  run(extract: (input: AttachmentExtractionJobInput, options?: AttachmentExtractionJobOptions) => Promise<AttachmentExtractionJobResult>) {
    if (started) throw new Error('Extraction worker already started')
    started = true
    ipcRenderer.once('attachment-extraction:input', async (_event, input: AttachmentExtractionJobInput) => {
      try { ipcRenderer.send('attachment-extraction:result', { ok: true, result: await extract(input, { onProgress: (page, total) => ipcRenderer.send('attachment-extraction:progress', { page, total }),
        onPage: page => new Promise<void>(resolve => {
          // At most one page is in flight; Main acknowledges only after its owner saved it.
          ipcRenderer.once('attachment-extraction:page-saved', () => resolve())
          ipcRenderer.send('attachment-extraction:page', page)
        }) }) }) }
      catch (error) { ipcRenderer.send('attachment-extraction:result', { ok: false, error: error instanceof Error ? error.message : String(error) }) }
    })
    ipcRenderer.send('attachment-extraction:ready')
  },
})
