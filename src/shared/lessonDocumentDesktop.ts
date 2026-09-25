import { z } from 'zod'
import type { DocumentFilePort, DocumentFileRef, DocumentFileVersion, DocumentSaveRequest } from './document/ports'
import { lessonRelativePathSchema } from './lessonWorkspace'

const lessonRef = z.object({ kind: z.literal('lesson'), lessonId: z.uuid(), lessonDirectory: z.string().min(1).max(32767), relativePath: lessonRelativePathSchema }).strict()
const fileRef = z.object({ kind: z.literal('file'), path: z.string().min(1).max(32767) }).strict()
const ref = z.discriminatedUnion('kind', [lessonRef, fileRef])
const version = z.object({ contentVersion: z.string().min(1), attachments: z.array(z.object({ relativePath: lessonRelativePathSchema, contentVersion: z.string().min(1) }).strict()) }).strict()
const source = z.string().max(16 * 1024 * 1024)
const attachments = z.array(z.object({ relativePath: lessonRelativePathSchema, bytes: z.custom<Uint8Array>(value => value instanceof Uint8Array && value.byteLength <= 128 * 1024 * 1024) }).strict()).max(1000)
const operationId = z.string().min(1).max(240)
export const lessonDocumentRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('open'), ref }).strict(),
  z.object({ operation: z.literal('read-resource'), ref, relativePath: lessonRelativePathSchema }).strict(),
  z.object({ operation: z.literal('save'), request: z.object({ ref, expectedVersion: version.nullable(), source, operationId, attachments: z.array(z.object({ relativePath: lessonRelativePathSchema, bytes: z.custom<Uint8Array>(value => value instanceof Uint8Array && value.byteLength <= 128 * 1024 * 1024) }).strict()).max(1000) }).strict() }).strict(),
  z.object({ operation: z.literal('recovery'), ref }).strict(),
  z.object({ operation: z.literal('preserve'), ref, source, expectedVersion: version.nullable(), attachments: attachments.optional() }).strict(),
])
export interface LessonDocumentDesktopAPI extends Omit<DocumentFilePort, 'watchDocument'> {
  readRecovery(ref: DocumentFileRef): Promise<{ source: string; expectedVersion: DocumentFileVersion | null; baseSource?: string; attachments?: DocumentSaveRequest['attachments'] } | null>
  readResource(ref: DocumentFileRef, relativePath: string): Promise<{ bytes: Uint8Array; mime: string; filename: string }>
  preserveDraft(ref: DocumentFileRef, source: string, expectedVersion: DocumentFileVersion | null, attachments?: DocumentSaveRequest['attachments']): Promise<void>
}
