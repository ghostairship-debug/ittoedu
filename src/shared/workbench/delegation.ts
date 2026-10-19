import type { ExecutionRunRecord } from './execution'
import type { ExecutionProjection } from './executionEvents'
import type { DelegationTarget } from './toolPorts'
import type { ComponentFrame } from '../contracts/component-platform'

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
