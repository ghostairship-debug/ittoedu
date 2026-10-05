import type { DocumentBinding } from './document'

/** Main-issued correlation; neither model arguments nor renderer drafts supply it. */
export interface DocumentSaveIdentity { runId: string; operationId: string; requestDigest: string }
export type SavedDocumentBinding = Extract<DocumentBinding, { kind: 'file' }>

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
  | { status: 'saved'; savedRevision: number; currentRevision: number; savedBinding?: SavedCourseIdentity }
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
}
