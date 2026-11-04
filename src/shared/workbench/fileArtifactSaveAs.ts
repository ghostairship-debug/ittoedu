import { z } from 'zod'
import { fileArtifactBindingSchema, mediaFileOperationSchema, type MediaFileSnapshot } from './mediaFiles'
import type { OfficeDocumentSnapshot } from './officeDocument'
import type { PptxPreviewSnapshot } from './officePreview'

const source = { binding: fileArtifactBindingSchema, openPaths: z.array(z.string()) }
export const fileArtifactSaveAsRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('office'), ...source }).strict(),
  z.object({ kind: z.literal('media'), ...source, operations: z.array(mediaFileOperationSchema) }).strict(),
])
export type FileArtifactSaveAsRequest = z.infer<typeof fileArtifactSaveAsRequestSchema>
export type FileArtifactSaveAsResult =
  | { kind: 'office'; snapshot: OfficeDocumentSnapshot | PptxPreviewSnapshot }
  | { kind: 'media'; snapshot: MediaFileSnapshot }
