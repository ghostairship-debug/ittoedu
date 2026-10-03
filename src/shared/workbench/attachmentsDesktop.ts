import { z } from 'zod'
import type { AttachmentReader, AttachmentSnapshot } from './attachments'

const id = z.uuid()
export const attachmentsDesktopRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select') }).strict(),
  z.object({ type: z.literal('clipboard-files'), gestureId: id }).strict(),
  z.object({ type: z.literal('workspace-files'), workspaceId: z.string().min(1), entryIds: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ type: z.literal('receive-granted'), authorizationId: id, requestId: id }).strict(),
  z.object({ type: z.literal('release'), authorizationIds: z.array(id) }).strict(),
  z.object({ type: z.literal('receive'), requestId: id.optional(), name: z.string().min(1), bytes: z.instanceof(Uint8Array), source: z.enum(['paste', 'drop', 'file']), mediaType: z.string().optional() }).strict(),
  z.object({ type: z.literal('snapshot'), attachmentId: id }).strict(),
  z.object({ type: z.literal('representation'), attachmentId: id, representationId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('extract'), attachmentId: id, requestId: id, images: z.enum(['auto', 'all']).optional(), pages: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict().refine(range => range.to >= range.from).optional() }).strict(),
  z.object({ type: z.literal('cancel'), requestId: id }).strict(),
])
export interface AttachmentIntakeFile { authorizationId?: string; name: string; error?: string; workspace?: { workspaceId: string; entryId: string } }
export interface AttachmentReadProgress { requestId: string; loaded: number; total: number; unit?: 'bytes' | 'pages' }
export interface AttachmentsDesktopAPI extends AttachmentReader {
  select(): Promise<AttachmentIntakeFile[]>
  clipboardFiles(input: { gestureId: string }): Promise<AttachmentIntakeFile[]>
  workspaceFiles(input: { workspaceId: string; entryIds: string[] }): Promise<AttachmentIntakeFile[]>
  receiveGranted(input: { authorizationId: string; requestId: string }): Promise<AttachmentSnapshot>
  subscribeProgress?(listener: (progress: AttachmentReadProgress) => void): () => void
  release(authorizationIds: string[]): Promise<void>
  receive(input: { requestId?: string; name: string; bytes: Uint8Array; source: 'paste' | 'drop' | 'file'; mediaType?: string }): Promise<AttachmentSnapshot>
  snapshot(attachmentId: string): Promise<AttachmentSnapshot>
  extract(input: { attachmentId: string; requestId: string; images?: 'auto' | 'all'; pages?: { from: number; to: number } }): Promise<AttachmentSnapshot>
  cancel(requestId: string): Promise<void>
}
