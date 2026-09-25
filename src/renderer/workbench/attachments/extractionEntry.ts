import { extractAttachmentMaterial } from './materialExtractionWorker'
import type { AttachmentExtractionInput, AttachmentExtractionResult } from '../../../shared/workbench/attachments'

declare global {
  interface Window {
    attachmentExtraction: { run(extract: (input: AttachmentExtractionInput) => Promise<AttachmentExtractionResult>): void }
  }
}
window.attachmentExtraction.run(extractAttachmentMaterial)
