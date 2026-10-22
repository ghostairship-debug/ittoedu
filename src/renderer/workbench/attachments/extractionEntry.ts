import { runAttachmentExtractionJob } from './materialExtractionWorker'
import type { AttachmentExtractionJobInput, AttachmentExtractionJobResult, AttachmentExtractionJobOptions } from '../../../shared/workbench/attachments'

declare global {
  interface Window {
    attachmentExtraction: { run(extract: (input: AttachmentExtractionJobInput, options?: AttachmentExtractionJobOptions) => Promise<AttachmentExtractionJobResult>): void }
  }
}
window.attachmentExtraction.run(runAttachmentExtractionJob)
