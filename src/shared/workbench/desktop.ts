import { z } from 'zod'
import { courseProjectDocumentSchema } from '../courseProjectSchema'
import type { DocumentEvent, DocumentModel, DocumentOperation, DocumentOperationResult, DocumentSnapshot } from './document'

export interface DocumentFileObservation {
  bindingVersion: number
  version: string | null
  model: DocumentModel | null
}
export interface ReconcileDocumentFile {
  documentId: string
  epoch: string
  baseRevision: number
  bindingVersion: number
  version: string | null
  choice: 'disk' | 'local'
  source?: string
}

const id = z.string().min(1).max(512)
const bytes = z.custom<Uint8Array>(value => value instanceof Uint8Array)
const resources = z.object({ assets: z.record(z.string(), bytes), components: z.record(z.string(), z.record(z.string(), bytes)) }).strict()
const model = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), source: z.string(), resources }).strict(),
  z.object({ kind: z.literal('course-v9'), project: courseProjectDocumentSchema, resources }).strict(),
])
const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('markdown.splice'), from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string(), resources: resources.optional() }).strict(),
  z.object({ type: z.literal('markdown.replace'), source: z.string(), resources: resources.optional() }).strict(),
  z.object({ type: z.literal('course.replace'), project: courseProjectDocumentSchema, resources: resources.optional() }).strict(),
  z.object({ type: z.literal('course.object.patch'), locationId: id, itemId: id, patch: z.record(z.string(), z.unknown()) }).strict(),
])
const operation = z.object({
  documentId: id, epoch: id, operationId: id, baseRevision: z.number().int().nonnegative(),
  // Desktop UI cannot impersonate an agent, attach a run, or grant itself permissions.
  actor: z.literal('human'),
  historyGroup: id.optional(),
  mutation: z.discriminatedUnion('type', [z.object({ type: z.literal('command'), command }).strict(), z.object({ type: z.literal('undo'), expectedTopOperationId: id.optional() }).strict(), z.object({ type: z.literal('redo') }).strict()]),
}).strict()

export const saveDirectoryContextSchema = z.object({ workspaceId: z.string().min(1).max(256), directoryEntryId: z.string().min(1).max(256) }).strict()
export type SaveDirectoryContext = z.infer<typeof saveDirectoryContextSchema>

export const documentHostRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list') }).strict(),
  z.object({ type: z.literal('bootstrap-course') }).strict(),
  z.object({ type: z.literal('create'), model, suggestedName: id }).strict(),
  z.object({ type: z.literal('open'), path: z.string().min(1).max(32767) }).strict(),
  z.object({ type: z.literal('read'), documentId: id }).strict(),
  z.object({ type: z.literal('dispatch'), operation }).strict(),
  z.object({ type: z.literal('lookup'), documentId: id, operationId: id }).strict(),
  z.object({ type: z.literal('save'), documentId: id, path: z.string().min(1).max(32767).optional() }).strict(),
  z.object({ type: z.literal('save-dialog'), documentId: id, saveAs: z.boolean().optional(), suggestedDirectory: saveDirectoryContextSchema.optional() }).strict(),
  z.object({ type: z.literal('observe-file'), documentId: id }).strict(),
  z.object({ type: z.literal('reconcile-file'), documentId: id, epoch: id, baseRevision: z.number().int().nonnegative(), bindingVersion: z.number().int().positive(), version: z.string().nullable(), choice: z.enum(['disk', 'local']), source: z.string().optional() }).strict(),
  z.object({ type: z.literal('close'), documentId: id, discardDirty: z.boolean().optional(), expected: z.object({ epoch: id, revision: z.number().int().nonnegative() }).strict().optional() }).strict(),
  z.object({ type: z.literal('close-dialog'), documentId: id, suggestedDirectory: saveDirectoryContextSchema.optional() }).strict(),
  z.object({ type: z.literal('recoverable') }).strict(),
  z.object({ type: z.literal('restore'), documentId: id }).strict(),
  z.object({ type: z.literal('discard-recovery'), documentId: id }).strict(),
])
export type DocumentHostRequest = z.infer<typeof documentHostRequestSchema>

export interface DocumentHostAPI {
  list(): Promise<DocumentSnapshot[]>
  bootstrapCourse(): Promise<DocumentSnapshot>
  create(model: DocumentModel, suggestedName: string): Promise<DocumentSnapshot>
  open(path: string): Promise<DocumentSnapshot>
  read(documentId: string): Promise<DocumentSnapshot>
  dispatch(operation: DocumentOperation): Promise<DocumentOperationResult>
  lookup(documentId: string, operationId: string): Promise<DocumentOperationResult | null>
  save(documentId: string, path?: string): Promise<DocumentSnapshot>
  saveWithDialog(documentId: string, saveAs?: boolean, suggestedDirectory?: SaveDirectoryContext): Promise<DocumentSnapshot | null>
  observeFile(documentId: string): Promise<DocumentFileObservation>
  reconcileFile(input: ReconcileDocumentFile): Promise<DocumentSnapshot>
  close(documentId: string, discardDirty?: boolean): Promise<void>
  closeWithDialog(documentId: string, suggestedDirectory?: SaveDirectoryContext): Promise<boolean>
  recoverable(): Promise<DocumentSnapshot[]>
  restore(documentId: string): Promise<DocumentSnapshot>
  discardRecovery(documentId: string): Promise<void>
  subscribe(listener: (event: DocumentEvent) => void): () => void
}
