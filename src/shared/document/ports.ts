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
/** Source offsets are UTF-16 indices; logical text offsets remain code points. */
export interface DocumentSourceRange { from: number; to: number; before: string }
/** One observation from the editor, without file ownership or persistence. */
export interface DocumentContextSelection {
  mode: 'layout' | 'source'
  revision: string
  source: string
  selection: DocumentSelection | null
  ranges: DocumentSourceRange[] | null
  label: string
  message?: string
}
/** A file target frozen for an asynchronous request; never persisted in a project. */
export interface ContextualEditTarget extends DocumentContextSelection {
  ref: DocumentFileRef
  baseVersion: DocumentFileVersion
  epoch: number
  scope: 'selection' | 'document'
}
export interface DocumentDiagnostic { message: string; offset: number; endOffset: number; line: number; column: number; path?: PropertyKey[] }
/** F04：课例内文档（lesson）或工作空间真实文件（file，当前为根目录/项目内 MD）。 */
export type DocumentFileRef =
  | { kind: 'lesson'; lessonId: string; lessonDirectory: string; relativePath: string }
  | { kind: 'file'; path: string }
export function documentRefKey(ref: DocumentFileRef): string {
  // 课例 ref 保持 F04 前的键格式，教师未保存恢复稿不因引用显示改变而失联。
  return ref.kind === 'lesson' ? JSON.stringify([ref.lessonId, ref.relativePath]) : JSON.stringify(['file', ref.path.replace(/\\/g, '/').toLowerCase()])
}
export function documentRefLabel(ref: DocumentFileRef): string {
  return ref.kind === 'lesson' ? ref.relativePath : (ref.path.replace(/\\/g, '/').split('/').pop() ?? ref.path)
}
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
export interface DocumentFilePort {
  openDocument(ref: DocumentFileRef): Promise<OpenDocumentResult>
  saveDocument(request: DocumentSaveRequest): Promise<DocumentSaveResult>
  watchDocument(ref: DocumentFileRef, listener: (event: { type: 'changed'; disk: OpenDocumentResult } | { type: 'deleted' }) => void): () => void
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
