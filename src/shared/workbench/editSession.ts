import type { DocumentOperationResult } from './document'
import type { ToolTarget } from './tools'

/** Host-resolved addresses only. Provider arguments carry opaque target handles. */
export type EditTarget = Extract<ToolTarget, { kind: 'markdown-range' | 'course-object' | 'flow-block' | 'flow-range' }>
export interface BeginEditSession {
  runId: string
  editId: string
  targetHandle: string
  /** Defaults to editId when the Engine uses its tool call identity for the edit group. */
  toolCallId?: string
}
export interface EditSessionSnapshot {
  editId: string
  runId: string
  documentId: string
  epoch: string
  baseRevision: number
  revision: number
  targetHandle: string
  target: EditTarget
  value: string
  /** -1 before the first generated snapshot. Content snapshots use non-negative private sequence IDs. */
  sequence: number
  status: 'active' | 'finished' | 'aborted'
  reason?: string
}
export type EditEvent =
  | { type: 'edit.changed'; snapshot: EditSessionSnapshot }
  | { type: 'edit.aborted'; snapshot: EditSessionSnapshot; reason: string }
  | { type: 'edit.finished'; snapshot: EditSessionSnapshot; result: DocumentOperationResult }
