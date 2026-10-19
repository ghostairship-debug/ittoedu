import { z } from 'zod'
import { ownRecordSchema } from '../ownRecordSchema'
import { flowDocumentRecoverySchema } from '../flowDocumentRecovery'
import { componentOperationBatchSchema, courseProjectV10Schema, jsonValueSchema } from '../contracts/component-platform/schema'
import type { DocumentEvent, DocumentModel, DocumentOperation, DocumentOperationResult, DocumentSnapshot } from './document'

export interface DocumentFileObservation {
  bindingVersion: number
  version: string | null
  model: DocumentModel | null
  baseSource?: string
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
/** Auxiliary input recovery only. These records never apply a command or enter History. */
export const advancedDraftRecoverySchema = z.object({ kind: z.enum(['source', 'json', 'surface-content']), projectId: id,
  documentId: id, epoch: id, key: z.string().min(1), payload: jsonValueSchema }).strict()
export type AdvancedDraftRecovery = z.infer<typeof advancedDraftRecoverySchema>
export const propertyDraftRecoverySchema = z.object({ bindingKey: z.string().min(1), label: z.string(),
  kind: z.enum(['text', 'number', 'range', 'chart', 'structured']), raw: z.string(), baseline: z.string().optional(), composing: z.boolean() }).strict()
export type PropertyDraftRecovery = z.infer<typeof propertyDraftRecoverySchema>
export const sourceConflictRecoverySchema = z.object({ documentId: id, epoch: id, source: z.string(), diskVersion: z.string().nullable(),
  conflictBaseline: z.string().optional(), hunks: z.array(z.object({ id: z.string(), text: z.string() }).strict()) }).strict()
export type SourceConflictRecovery = z.infer<typeof sourceConflictRecoverySchema>
const authoringRecoveryValueSchema = z.union([advancedDraftRecoverySchema, propertyDraftRecoverySchema, sourceConflictRecoverySchema, flowDocumentRecoverySchema])
export const authoringRecoveryClaimSchema = z.object({ id: id, digest: id }).strict()
export type AuthoringRecoveryClaim = z.infer<typeof authoringRecoveryClaimSchema>
export const authoringRecoveryRecordSchema = authoringRecoveryClaimSchema.extend({ ownerDocumentId: id,
  kind: z.enum(['advanced', 'properties', 'sourceConflict', 'flow']), value: authoringRecoveryValueSchema }).strict()
export type AuthoringRecoveryRecord = z.infer<typeof authoringRecoveryRecordSchema>
export const authoringDraftRecoverySchema = z.object({ advanced: z.array(advancedDraftRecoverySchema), properties: z.array(propertyDraftRecoverySchema),
  sourceConflict: sourceConflictRecoverySchema.optional(), sourceConflicts: z.array(sourceConflictRecoverySchema).optional(),
  flow: z.array(flowDocumentRecoverySchema).optional(), recoveryRecords: z.array(authoringRecoveryRecordSchema).optional(),
}).strict()
export type AuthoringDraftRecovery = z.infer<typeof authoringDraftRecoverySchema>
export const authoringDraftWriteSchema = authoringDraftRecoverySchema.omit({ recoveryRecords: true }).partial().extend({
  flowSurfaceId: id.optional(), retainedRecords: z.array(authoringRecoveryClaimSchema).optional(),
})
export type AuthoringDraftWrite = z.infer<typeof authoringDraftWriteSchema>
const bytes = z.custom<Uint8Array>(value => value instanceof Uint8Array)
const resources = z.object({ assets: ownRecordSchema(z.string(), bytes), components: ownRecordSchema(z.string(), ownRecordSchema(z.string(), bytes)) }).strict()
const model = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), source: z.string(), resources }).strict(),
  z.object({ kind: z.literal('text'), source: z.string(), resources }).strict(),
  z.object({ kind: z.literal('course-v10'), project: courseProjectV10Schema, resources }).strict(),
])
const command = z.union([
  componentOperationBatchSchema,
  z.discriminatedUnion('type', [
  z.object({ type: z.literal('markdown.splice'), from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string(), resources: resources.optional() }).strict(),
  z.object({ type: z.literal('markdown.replace'), source: z.string(), resources: resources.optional() }).strict(),
  ]),
])
const operation = z.object({
  documentId: id, epoch: id, operationId: id, baseRevision: z.number().int().nonnegative(),
  // Desktop UI cannot impersonate an agent, attach a run, or grant itself permissions.
  actor: z.literal('human'),
  historyGroup: id.optional(),
  mutation: z.discriminatedUnion('type', [z.object({ type: z.literal('command'), command, amendHistory: z.object({ expectedTopOperationId: id }).strict().optional() }).strict(), z.object({ type: z.literal('undo'), expectedTopOperationId: id.optional() }).strict(), z.object({ type: z.literal('redo') }).strict()]),
}).strict()

export const saveDirectoryContextSchema = z.object({ workspaceId: z.string().min(1).max(256), directoryEntryId: z.string().min(1).max(256) }).strict()
export type SaveDirectoryContext = z.infer<typeof saveDirectoryContextSchema>

export const documentHostRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list') }).strict(),
  z.object({ type: z.literal('bootstrap-course') }).strict(),
  z.object({ type: z.literal('create'), model, suggestedName: id }).strict(),
  z.object({ type: z.literal('open'), path: z.string().min(1).max(32767) }).strict(),
  z.object({ type: z.literal('read'), documentId: id }).strict(),
  z.object({ type: z.literal('reveal'), documentId: id }).strict(),
  z.object({ type: z.literal('rename'), documentId: id, epoch: id, name: z.string().trim().min(1).max(200).refine(value => !/[\\/:*?"<>|]/.test(value) && value !== '.' && value !== '..') }).strict(),
  z.object({ type: z.literal('read-authoring-drafts'), documentId: id }).strict(),
  z.object({ type: z.literal('write-authoring-drafts'), documentId: id, epoch: id.optional(), drafts: authoringDraftWriteSchema }).strict(),
  z.object({ type: z.literal('claim-authoring-drafts'), documentId: id, epoch: id, records: z.array(authoringRecoveryClaimSchema) }).strict(),
  z.object({ type: z.literal('clear-authoring-drafts'), documentId: id }).strict(),
  z.object({ type: z.literal('dispatch'), operation }).strict(),
  z.object({ type: z.literal('lookup'), documentId: id, operationId: id }).strict(),
  z.object({ type: z.literal('save'), documentId: id, path: z.string().min(1).max(32767).optional() }).strict(),
  z.object({ type: z.literal('save-dialog'), documentId: id, saveAs: z.boolean().optional(), suggestedDirectory: saveDirectoryContextSchema.optional() }).strict(),
  z.object({ type: z.literal('observe-file'), documentId: id }).strict(),
  z.object({ type: z.literal('reconcile-file'), documentId: id, epoch: id, baseRevision: z.number().int().nonnegative(), bindingVersion: z.number().int().positive(), version: z.string().nullable(), choice: z.enum(['disk', 'local']), source: z.string().optional() }).strict(),
  z.object({ type: z.literal('close'), documentId: id, discardDirty: z.boolean().optional(), expected: z.object({ epoch: id, revision: z.number().int().nonnegative() }).strict().optional() }).strict(),
  z.object({ type: z.literal('close-dialog'), documentId: id, suggestedDirectory: saveDirectoryContextSchema.optional(), discardOnly: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('recoverable') }).strict(),
  z.object({ type: z.literal('restore'), documentId: id, mode: z.enum(['original', 'unbound', 'saved']).optional() }).strict(),
  z.object({ type: z.literal('discard-recovery'), documentId: id }).strict(),
])
export type DocumentHostRequest = z.infer<typeof documentHostRequestSchema>

export interface DocumentHostAPI {
  list(): Promise<DocumentSnapshot[]>
  bootstrapCourse(): Promise<DocumentSnapshot>
  create(model: DocumentModel, suggestedName: string): Promise<DocumentSnapshot>
  open(path: string): Promise<DocumentSnapshot>
  read(documentId: string): Promise<DocumentSnapshot>
  rename?(documentId: string, epoch: string, name: string): Promise<DocumentSnapshot>
  reveal?(documentId: string): Promise<void>
  readAuthoringDrafts(documentId: string): Promise<AuthoringDraftRecovery | null>
  writeAuthoringDrafts(documentId: string, drafts: AuthoringDraftWrite, epoch?: string): Promise<void>
  claimAuthoringDrafts?(documentId: string, epoch: string, records: AuthoringRecoveryClaim[]): Promise<void>
  clearAuthoringDrafts(documentId: string): Promise<void>
  dispatch(operation: DocumentOperation): Promise<DocumentOperationResult>
  lookup(documentId: string, operationId: string): Promise<DocumentOperationResult | null>
  save(documentId: string, path?: string): Promise<DocumentSnapshot>
  saveWithDialog(documentId: string, saveAs?: boolean, suggestedDirectory?: SaveDirectoryContext): Promise<DocumentSnapshot | null>
  observeFile(documentId: string): Promise<DocumentFileObservation>
  reconcileFile(input: ReconcileDocumentFile): Promise<DocumentSnapshot>
  close(documentId: string, discardDirty?: boolean): Promise<void>
  closeWithDialog(documentId: string, suggestedDirectory?: SaveDirectoryContext, discardOnly?: boolean): Promise<boolean>
  recoverable(): Promise<DocumentSnapshot[]>
  restore(documentId: string, mode?: 'original' | 'unbound' | 'saved'): Promise<DocumentSnapshot>
  discardRecovery(documentId: string): Promise<void>
  subscribe(listener: (event: DocumentEvent) => void): () => void
}
