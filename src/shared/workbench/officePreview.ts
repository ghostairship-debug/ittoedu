import { z } from 'zod'
import { fileArtifactBindingSchema, type FileArtifactBinding } from './mediaFiles'
import { officeEditContentSchema, type OfficeContentInspection, type OfficeHistorySnapshot } from './officeFiles'

/** Read projection of original OOXML; all object edits stay under the existing file owner. */
export interface PptxPreviewSnapshot {
  binding: FileArtifactBinding
  bytes: Uint8Array
  inspection?: Extract<OfficeContentInspection, { format: 'pptx' }>
  history?: OfficeHistorySnapshot
  editingError?: string
}
export const pptxPreviewRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pptx-preview.open'), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal('pptx-preview.reload'), binding: fileArtifactBindingSchema }).strict(),
  z.object({ type: z.literal('pptx-preview.edit'), binding: fileArtifactBindingSchema, content: officeEditContentSchema }).strict(),
  z.object({ type: z.literal('pptx-preview.commit'), binding: fileArtifactBindingSchema, bytes: z.instanceof(Uint8Array) }).strict(),
  z.object({ type: z.literal('pptx-preview.undo'), binding: fileArtifactBindingSchema }).strict(),
  z.object({ type: z.literal('pptx-preview.redo'), binding: fileArtifactBindingSchema }).strict(),
])
export type PptxPreviewRequest = z.infer<typeof pptxPreviewRequestSchema>

export interface DocxPreviewSnapshot {
  binding: FileArtifactBinding
  pdfBytes: Uint8Array
  sourceSha256: string
  pageCount: number
  pages: Array<{ width: number; height: number; rotation: number }>
  engine: { name: string; version: string }
  notices: string[]
}
export const docxPreviewRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('docx-preview.open'), path: z.string().min(1), requestId: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal('docx-preview.reload'), binding: fileArtifactBindingSchema, requestId: z.string().min(1).optional() }).strict(),
])
export type DocxPreviewRequest = z.infer<typeof docxPreviewRequestSchema>
export interface DocxPreviewProgress { requestId: string; message: string }
export const docxPreviewCancelSchema = z.object({ requestId: z.string().min(1) }).strict()
