import type { ExecutionRunRecord } from './execution'
import type { ExecutionProjection } from './executionEvents'
import type { DelegationTarget } from './toolPorts'
import type { ComponentFrame } from '../contracts/component-platform'

/** Directed identities are resolved by the job owner, never supplied in message text. */
export interface NativeDelegationMessage {
  senderRunId: string
  text: string
  replyJob?: string
  senderRole?: string
}

/** A compact projection of existing jobs, not another collaboration registry. */
export interface NativeCollaborationPeer {
  job: string
  role?: string
  status: string
}
/** Narrow host lineage read; excludes model history and image payloads. */
export interface NativeRunIdentity {
  runId: string
  delegatedBy?: ExecutionRunRecord['delegatedBy']
  maxConcurrentNative?: number
}

/** A read projection of the existing job owner, without internal model accounting. */
export interface ExecutionDelegationChildView {
  parentRunId: string
  jobId: string
  childRunId?: string
  goal: string
  status: string
  terminal: boolean
  stopped: boolean
  target?: DelegationTarget
  frame?: ComponentFrame
  targetContext?: unknown
  role?: string
  reason?: string
  summary?: string
  artifacts: readonly { name: string; byteLength: number }[]
}
export interface ExecutionDelegationChildIdentity {
  workspaceId: string
  conversationId: string
  parentRunId: string
  jobId: string
}
export interface ExecutionDelegationChildDetail {
  view: ExecutionDelegationChildView
  run: ExecutionRunRecord | null
  projection: ExecutionProjection
}
