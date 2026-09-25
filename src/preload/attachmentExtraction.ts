import { contextBridge, ipcRenderer } from 'electron'
import type { AttachmentExtractionInput, AttachmentExtractionResult } from '../shared/workbench/attachments'

// A sandbox preload exposes exactly one extraction job, never a generic IPC primitive.
let started = false
contextBridge.exposeInMainWorld('attachmentExtraction', {
  run(extract: (input: AttachmentExtractionInput) => Promise<AttachmentExtractionResult>) {
    if (started) throw new Error('Extraction worker already started')
    started = true
    ipcRenderer.once('attachment-extraction:input', async (_event, input: AttachmentExtractionInput) => {
      try { ipcRenderer.send('attachment-extraction:result', { ok: true, result: await extract(input) }) }
      catch (error) { ipcRenderer.send('attachment-extraction:result', { ok: false, error: error instanceof Error ? error.message : String(error) }) }
    })
    ipcRenderer.send('attachment-extraction:ready')
  },
})
