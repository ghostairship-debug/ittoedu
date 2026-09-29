/** Frozen bytes are supplied by the authorized file/document owner before start. */
export interface ComputeJobInput {
  runId: string
  jobId: string
  language: 'python'
  code?: string
  program?: string
  argv?: readonly string[]
  inputs?: readonly { name: string; bytes: Uint8Array }[]
  outputNames?: readonly string[]
  timeoutMs?: number
}
export interface ComputeArtifact {
  name: string
  digest: string
  byteLength: number
  mimeType: string
}
export interface ComputeJobSnapshot {
  jobId: string
  runId: string
  requestDigest: string
  status: 'preparing' | 'running' | 'ready' | 'failed' | 'cancelled' | 'unknown' | 'unapplied'
  createdAt: string
  updatedAt: string
  stopped: boolean
  outputNames: readonly string[]
  artifacts: readonly ComputeArtifact[]
  exitCode?: number | null
  reason?: string
}
export interface ComputeJobLogs {
  entries: readonly { cursor: number; time: number; stream: 'stdout' | 'stderr' | 'system'; message: string }[]
  nextCursor: number
}
