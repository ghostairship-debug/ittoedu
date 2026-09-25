import type { CourseProjectDocument } from '../courseProjectTypes'

/** Document identity is independent of the file's project ID and its path. */
export type DocumentId = string
export type DocumentKind = 'markdown' | 'course-v9'
export type DocumentBinding =
  | { kind: 'untitled'; suggestedName: string }
  | { kind: 'file'; path: string; version: string | null; bindingVersion: number }

export interface DocumentResources {
  assets: Record<string, Uint8Array>
  components: Record<string, Record<string, Uint8Array>>
}

export type DocumentModel =
  | { kind: 'markdown'; source: string; resources: DocumentResources }
  | { kind: 'course-v9'; project: CourseProjectDocument; resources: DocumentResources }

export type DocumentCommand =
  | { type: 'markdown.splice'; from: number; to: number; text: string; resources?: DocumentResources }
  | { type: 'markdown.replace'; source: string; resources?: DocumentResources }
  | { type: 'course.replace'; project: CourseProjectDocument; resources?: DocumentResources }
  | { type: 'course.object.patch'; locationId: string; itemId: string; patch: Record<string, unknown> }

/** Host-owned envelope. Providers receive domain arguments, never this authority. */
export interface DocumentOperation {
  documentId: DocumentId
  epoch: string
  operationId: string
  baseRevision: number
  actor: 'human' | 'agent' | 'external'
  runId?: string
  historyGroup?: string
  /** Trusted gateway's digest of the original tool call, before planning/rebasing. Never accepted by UI IPC. */
  requestDigest?: string
  mutation: { type: 'command'; command: DocumentCommand } | { type: 'undo'; expectedTopOperationId?: string } | { type: 'redo' }
}

export type DocumentOperationResult =
  | { status: 'applied' | 'unchanged'; documentId: DocumentId; operationId: string; beforeRevision: number; revision: number; persistence: 'recoverable' }
  | { status: 'conflict' | 'denied' | 'cancelled' | 'failed'; documentId: DocumentId; operationId: string; code: string; message: string; applied: false }

export interface DocumentSnapshot {
  documentId: DocumentId
  epoch: string
  revision: number
  binding: DocumentBinding
  model: DocumentModel
  dirty: boolean
  saving: boolean
  /** Transient facts from this session, not journal availability. */
  saveError?: string | null
  recovered?: boolean
  recoverable: boolean
  undoDepth: number
  redoDepth: number
  /** Read-only identity of the next item ordinary Undo would remove. */
  undoHead?: { operationId: string; actor?: DocumentOperation['actor'] }
}

export interface DocumentHistoryEntry {
  operationId: string
  actor?: DocumentOperation['actor']
  runId?: string
  historyGroup?: string
  before: DocumentModel
  after: DocumentModel
}

/** Complete recovery state; binary resources and history share the commit boundary. */
export interface DurableDocumentState {
  schemaVersion: 1
  documentId: DocumentId
  epoch: string
  sequence: number
  revision: number
  savedRevision: number | null
  binding: DocumentBinding
  model: DocumentModel
  past: DocumentHistoryEntry[]
  future: DocumentHistoryEntry[]
  operations: { operationId: string; digest: string; result: DocumentOperationResult }[]
  stoppedRuns: string[]
}

export type DocumentEvent =
  | { type: 'changed'; snapshot: DocumentSnapshot; operationId?: string }
  | { type: 'closed'; documentId: DocumentId; epoch: string }

export interface DocumentDriver {
  readonly kind: DocumentKind
  validate(model: DocumentModel): void
  apply(model: DocumentModel, command: DocumentCommand): DocumentModel | Promise<DocumentModel>
  withRevision(model: DocumentModel, revision: number): DocumentModel
  load(bytes: Uint8Array): DocumentModel | Promise<DocumentModel>
  serialize(model: DocumentModel): Uint8Array | Promise<Uint8Array>
}

/** No filesystem, Electron, DOM or renderer dependency is permitted in the core. */
export interface DocumentPersistence {
  append(state: DurableDocumentState): Promise<void>
  save(input: { documentId: DocumentId; revision: number; model: DocumentModel; binding: DocumentBinding; bytes: Uint8Array }): Promise<Extract<DocumentBinding, { kind: 'file' }>>
}
