import type { DocumentBinding, DocumentModel } from './document'

/** Main-issued correlation; neither model arguments nor renderer drafts supply it. */
export interface DocumentSaveIdentity { runId: string; operationId: string; requestDigest: string }
export type SavedDocumentBinding = Extract<DocumentBinding, { kind: 'file' }>

/** One captured source revision and the exact local files its publication carries.
 * Diagnostics keep unresolved original references visible without pretending that
 * preserving source text is a complete offline publication. */
export interface DocumentSourcePublication {
  format: 'markdown' | 'html'
  references: string[]
  files: Array<{ path: string; version: string }>
  componentDirectories: string[]
  diagnostics: Array<{ level: 'info' | 'warning' | 'error'; code: string; message: string; reference?: string }>
}

/** Transient preparation, never a second persisted document or a content writer. */
export interface PreparedDocumentSave {
  model: DocumentModel
  sourcePublication?: DocumentSourcePublication
}

/** Main-observed saved identity; locating a document never grants additional targets. */
export interface SavedCourseIdentity {
  kind: 'course-v10'
  path: string
  projectId: string
  epoch: string
  savedRevision: number
  fileVersion: string | null
}

/** A persistence fact independent of execution journals or timeline presentation. */
export type DocumentSaveFact = { saveId: string; documentId: string; epoch: string; documentName: string; time: number } & (
  | { status: 'saving'; revision: number }
  | { status: 'saved'; savedRevision: number; currentRevision: number; savedBinding?: SavedCourseIdentity; warnings?: string[] }
  | { status: 'failed'; revision: number; error: string }
)

/** The persistence owner, not its caller's attempted flag, knows whether publication began. */
export class DocumentSaveFailure extends Error {
  readonly code?: string
  constructor(readonly publication: 'not-published' | 'unknown', cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'DocumentSaveFailure'
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
    if (typeof code === 'string') this.code = code
  }
}
export interface DocumentSaveProof {
  identity: DocumentSaveIdentity
  documentId: string
  epoch: string
  savedRevision: number
  sourceBinding: DocumentBinding
  binding: SavedDocumentBinding
  savedModel?: DocumentModel
  warnings?: string[]
}
