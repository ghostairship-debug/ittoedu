import type { DocumentSlot } from '../document/ports'
import type { DocumentSaveIdentity } from './documentSave'
import type { CourseProjectDocument } from '../courseProjectTypes'
import type { CompositionContentEdit } from '../composition/edit'
import type { CourseProjectV10 } from '../contracts/component-platform/project'
import type { ComponentAppliedChanges, ComponentOperationBatch } from '../contracts/component-platform/operations'

/** Document identity is independent of the file's project ID and its path. */
export type DocumentId = string
export type DocumentKind = 'markdown' | 'text' | 'course-v9' | 'course-v10'
export type DocumentBinding =
  | { kind: 'untitled'; suggestedName: string }
  | { kind: 'file'; path: string; version: string | null; bindingVersion: number }

export interface DocumentResources {
  assets: Record<string, Uint8Array>
  components: Record<string, Record<string, Uint8Array>>
}

export type DocumentModel =
  | { kind: 'markdown'; source: string; resources: DocumentResources }
  | { kind: 'text'; source: string; resources: DocumentResources }
  | { kind: 'course-v9'; project: CourseProjectDocument; resources: DocumentResources }
  | { kind: 'course-v10'; project: CourseProjectV10; resources: DocumentResources }

/** Markdown 与纯文本共用的源文判断。附件、解析、渲染和排版仍只认 markdown。 */
export function isSourceDocumentModel(model: DocumentModel): model is Extract<DocumentModel, { kind: 'markdown' | 'text' }> {
  return model.kind === 'markdown' || model.kind === 'text'
}

/** markdown.splice / markdown.replace 是 Markdown 与纯文本共用的源文命令。 */
export type DocumentCommand =
  | ComponentOperationBatch
  | { type: 'markdown.splice'; from: number; to: number; text: string; resources?: DocumentResources }
  | { type: 'markdown.replace'; source: string; resources?: DocumentResources }
  | { type: 'course.replace'; project: CourseProjectDocument; resources?: DocumentResources }
  | { type: 'course.object.patch'; locationId: string; itemId: string; patch: Record<string, unknown> }
  | { type: 'composition.edit'; layerItemId: string; edit: CompositionContentEdit }

export interface DocumentTextChanges {
  source: Array<{ from: number; to: number; inserted: number }>
  flow: Array<{ surfaceId: string; parentId: string | null; blockId: string; slot: DocumentSlot; from: number; to: number; inserted: number }>
}

/** Actual source facts for range continuation; resources and Undo remain in the document History. */
export type DocumentSourceChange =
  | { kind: 'unchanged' }
  | { kind: 'changed'; before: string; after: string }

/** Host-owned envelope. Providers receive domain arguments, never this authority. */
export interface DocumentOperation {
  documentId: DocumentId
  epoch: string
  operationId: string
  baseRevision: number
  actor: 'human' | 'agent' | 'external'
  runId?: string
  /** Host-owned document authorization lease; logical runId continues to own receipts and history. */
  runLeaseId?: string
  historyGroup?: string
  /** Trusted gateway's digest of the original tool call, before planning/rebasing. Never accepted by UI IPC. */
  requestDigest?: string
  /** Exact splices computed by the host planner; excluded from UI and model input schemas. */
  textChanges?: DocumentTextChanges
  mutation: { type: 'command'; command: DocumentCommand;
    /** Strictly amend this history head; stale ownership never creates a new Undo entry. */
    amendHistory?: { expectedTopOperationId: string }
  } | { type: 'undo'; expectedTopOperationId?: string } | { type: 'redo' }
}

export type DocumentOperationResult =
  | { status: 'applied' | 'unchanged'; documentId: DocumentId; operationId: string; beforeRevision: number; revision: number; persistence: 'recoverable'; appliedChanges?: ComponentAppliedChanges }
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
  beforeRevision?: number
  revision?: number
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
  operations: { operationId: string; digest: string; result: DocumentOperationResult; actor?: DocumentOperation['actor']; runId?: string;
    textChanges?: DocumentTextChanges; sourceChange?: DocumentSourceChange }[]
  stoppedRuns: string[]
}

export type DocumentEvent =
  | { type: 'changed'; snapshot: DocumentSnapshot; operationId?: string; appliedChanges?: ComponentAppliedChanges }
  | { type: 'closed'; documentId: DocumentId; epoch: string }

export interface DocumentDriver {
  readonly kind: DocumentKind
  validate(model: DocumentModel): void
  apply(model: DocumentModel, command: DocumentCommand): DocumentModel | Promise<DocumentModel>
  /** Session-only: input is an owned, validated snapshot. Do not mutate it; validate the candidate once.
   * Unchanged resource bytes may be shared because public snapshots remain detached. */
  applyValidated?(model: DocumentModel, command: DocumentCommand): DocumentModel | Promise<DocumentModel>
  /** Adjust only the revision of a validated model; retain the driver's revision constraints. */
  withRevision(model: DocumentModel, revision: number): DocumentModel
  load(bytes: Uint8Array): DocumentModel | Promise<DocumentModel>
  serialize(model: DocumentModel): Uint8Array | Promise<Uint8Array>
  describeChanges?(before: DocumentModel, after: DocumentModel): ComponentAppliedChanges
}

/** No filesystem, Electron, DOM or renderer dependency is permitted in the core. */
export interface DocumentPersistence {
  append(state: DurableDocumentState): Promise<void>
  save(input: { documentId: DocumentId; revision: number; model: DocumentModel; binding: DocumentBinding; bytes: Uint8Array; saveIdentity?: DocumentSaveIdentity }): Promise<Extract<DocumentBinding, { kind: 'file' }>>
}
