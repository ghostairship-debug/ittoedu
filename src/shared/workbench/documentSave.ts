import type { DocumentBinding } from './document'

/** Main-issued correlation; neither model arguments nor renderer drafts supply it. */
export interface DocumentSaveIdentity { runId: string; operationId: string; requestDigest: string }
export type SavedDocumentBinding = Extract<DocumentBinding, { kind: 'file' }>

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
