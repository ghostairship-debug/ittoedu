import { z } from 'zod'
import { fileArtifactBindingSchema, type FileArtifactBinding } from './mediaFiles'

/** A read-only snapshot. Original OOXML stays under the existing file owner. */
export interface PptxPreviewSnapshot { binding: FileArtifactBinding; bytes: Uint8Array }
export const pptxPreviewRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pptx-preview.open'), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal('pptx-preview.reload'), binding: fileArtifactBindingSchema }).strict(),
])
export type PptxPreviewRequest = z.infer<typeof pptxPreviewRequestSchema>
