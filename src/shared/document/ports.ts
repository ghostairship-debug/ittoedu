import type { DocumentBlock, DocumentContent } from './content'
import type { DocumentResources } from './resources'

/** Offsets count Unicode code points; an outer math atom has length one. */
export type DocumentSlot =
  | { kind: 'field'; field: 'content' | 'citation' | 'caption' | 'title' | 'body' }
  | { kind: 'item'; itemId: string }
  | { kind: 'header'; columnId: string }
  | { kind: 'cell'; rowId: string; columnId: string }
export interface DocumentPoint { blockId: string; slot: DocumentSlot; offset: number; affinity: 'before' | 'after' }
export type DocumentSelection = { revision: string } & (
  | { kind: 'text'; anchor: DocumentPoint; head: DocumentPoint }
  | { kind: 'object'; blockId: string }
  | { kind: 'cells'; tableId: string; anchor: { rowId: string; columnId: string }; head: { rowId: string; columnId: string } }
)
export interface DocumentDiagnostic { message: string; offset: number; endOffset: number; line: number; column: number; path?: PropertyKey[] }
export interface DocumentFileRef { lessonId: string; lessonDirectory: string; relativePath: string }
export interface DocumentFileVersion { contentVersion: string; attachments: { relativePath: string; contentVersion: string }[] }
export interface OpenDocumentResult { ref: DocumentFileRef; source: string; version: DocumentFileVersion; diagnostics: DocumentDiagnostic[] }
export type DocumentSaveResult =
  | { status: 'saved'; operationId: string; version: DocumentFileVersion }
  | { status: 'conflict'; operationId: string; disk: OpenDocumentResult }
  | { status: 'failed'; operationId: string; message: string; recovery: 'saved' | 'failed' }
export interface DocumentSaveRequest {
  ref: DocumentFileRef; expectedVersion: DocumentFileVersion | null; source: string; operationId: string
  attachments: { relativePath: string; bytes: Uint8Array }[]
}
export interface DocumentEditRange { from: number; to: number; before: string; after: string }
export interface DocumentAiEditRecord { id: string; ref: DocumentFileRef; baseVersion: DocumentFileVersion; savedVersion: DocumentFileVersion; applied: DocumentEditRange[] }
export type DocumentAiApplyResult =
  | { status: 'applied' | 'partial'; record: DocumentAiEditRecord; conflicts: DocumentEditRange[] }
  | { status: 'conflict'; conflicts: DocumentEditRange[] }
  | { status: 'failed'; message: string }
export interface DocumentFilePort {
  openDocument(ref: DocumentFileRef): Promise<OpenDocumentResult>
  saveDocument(request: DocumentSaveRequest): Promise<DocumentSaveResult>
  watchDocument(ref: DocumentFileRef, listener: (event: { type: 'changed'; disk: OpenDocumentResult } | { type: 'deleted' }) => void): () => void
  prepareAiEdit(ref: DocumentFileRef, range: DocumentEditRange[], epoch: number): Promise<{ status: 'ready'; document: OpenDocumentResult; epoch: number; ranges: DocumentEditRange[] } | { status: 'failed'; message: string }>
  applyAiEdit(request: { ref: DocumentFileRef; baseVersion: DocumentFileVersion; epoch: number; operationId: string; edits: DocumentEditRange[] }): Promise<DocumentAiApplyResult>
  revertAiEdit(record: DocumentAiEditRecord, currentVersion: DocumentFileVersion): Promise<{ reverted: DocumentEditRange[]; unreverted: DocumentEditRange[]; save: DocumentSaveResult }>
}
/** Owner implements resource preparation + canonical commit as one History entry.
 * These are ports, not an alternate project store or command implementation.
 */
export interface DocumentFlowTarget { projectId: string; surfaceId: string; revision: string; epoch: number }
export interface DocumentFlowPort {
  read(target: DocumentFlowTarget): { content: DocumentContent; resources: DocumentResources }
  commit(request: { target: DocumentFlowTarget; blocks: DocumentBlock[]; resources: DocumentResources; operationId: string; historyGroup: string }): Promise<
    | { status: 'committed' | 'unchanged'; revision: string }
    | { status: 'rejected'; diagnostics: DocumentDiagnostic[] }
  >
}
