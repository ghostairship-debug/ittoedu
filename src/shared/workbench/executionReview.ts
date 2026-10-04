import type { ExecutionRunRecord } from './execution'

/** Values the desktop execution API returns for change review and user checkpoints. */
export type ChangeReviewAvailability = 'ready' | 'conflict' | 'no-before-snapshot' | 'unverified' | 'external' | 'unsupported'
export interface ChangeReviewEntry {
  entryId: string
  runId: string
  callId: string
  name: string
  path: string | null
  documentId?: string
  status: 'applied' | 'unchanged' | 'partial' | 'reported' | 'failed' | 'unknown'
  source: 'host-document' | 'host-file' | 'external'
  beforeVersion?: string
  afterVersion?: string
  availability: ChangeReviewAvailability
  reason?: string
  /** Human-readable bounded preview; complete before bytes remain only in the local review store. */
  preview?: { before: string; after: string; truncated: boolean }
}
export interface ChangeReviewPage {
  total: number
  entries: ChangeReviewEntry[]
  nextOffset?: number
  files: Array<{ path: string; entryIds: string[] }>
}
export type ChangeRollbackResult = { entryId: string; status: 'reverted' | 'conflict' | 'unavailable' | 'unknown'; message: string; documentId?: string; saved?: boolean }

export interface ContentVersionAtCheckpoint {
  documentId: string
  revision: number | null
}

export interface UserCheckpointIndex {
  conversationId: string
  conversationRevision: number
  runId: string
  runVersion: number
  runStatus: ExecutionRunRecord['status']
  recordedAt: number
  /** Observed by the current document owner, not inferred from old writable targets. */
  contentVersions: ContentVersionAtCheckpoint[]
}

export interface ForkDraft {
  title: string
  inputDraft: string
  /** Model-maintained plan is display-only until the user explicitly edits it into the new draft. */
  advisoryRemaining: string[]
  source: UserCheckpointIndex
  /** The caller must create a fresh conversation and use the normal send path. */
  requiresFreshAuthorization: true
  replaysPreviousCalls: false
}
