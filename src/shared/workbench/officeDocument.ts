import { z } from 'zod'
import { fileArtifactBindingSchema, type FileArtifactBinding } from './mediaFiles'
import { officeEditContentSchema, type OfficeContentInspection, type OfficeHistorySnapshot, type OfficeDiagnostic } from './officeFiles'

/** A lightweight editable original-file snapshot, not a converted document model. */
export interface OfficeDocumentSnapshot {
  binding: FileArtifactBinding
  bytes: Uint8Array
  inspection: OfficeContentInspection
  history: OfficeHistorySnapshot
  draftDirty?: boolean
  diagnostics?: OfficeDiagnostic[]
}
export const officeDocumentRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('office-document.open'), path: z.string().min(1), draft: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('office-document.edit'), binding: fileArtifactBindingSchema, content: officeEditContentSchema }).strict(),
  z.object({ type: z.literal('office-document.undo'), binding: fileArtifactBindingSchema }).strict(),
  z.object({ type: z.literal('office-document.redo'), binding: fileArtifactBindingSchema }).strict(),
  z.object({ type: z.literal('office-document.save'), binding: fileArtifactBindingSchema }).strict(),
  z.object({ type: z.literal('office-document.close'), path: z.string().min(1), discard: z.boolean() }).strict(),
])
export type OfficeDocumentRequest = z.infer<typeof officeDocumentRequestSchema>
