import { contextBridge, ipcRenderer } from 'electron'
import type { AttachmentExtractionInput, AttachmentExtractionResult } from '../shared/workbench/attachments'

// A sandbox preload exposes exactly one extraction job, never a generic IPC primitive.
let started = false
contextBridge.exposeInMainWorld('attachmentExtraction', {
  run(extract: (input: AttachmentExtractionInput, options?: { onProgress?: (page: number, total: number) => void }) => Promise<AttachmentExtractionResult>) {
    if (started) throw new Error('Extraction worker already started')
    started = true
    ipcRenderer.once('attachment-extraction:input', async (_event, input: AttachmentExtractionInput) => {
      try { ipcRenderer.send('attachment-extraction:result', { ok: true, result: await extract(input, { onProgress: (page, total) => ipcRenderer.send('attachment-extraction:progress', { page, total }) }) }) }
      catch (error) { ipcRenderer.send('attachment-extraction:result', { ok: false, error: error instanceof Error ? error.message : String(error) }) }
    })
    ipcRenderer.send('attachment-extraction:ready')
  },
})
