/** The existing compute owner supplies frozen input; a backend only executes it. */
export interface ComputeBackendRequest {
  directory: string
  program: string
  argv: readonly string[]
  executionId: string
  code?: string
  inputs?: readonly { name: string; bytes: Uint8Array }[]
}
export interface ComputeProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  cancelled: boolean
  outputs?: readonly { name: string; bytes: Uint8Array }[]
  outputDiagnostics?: readonly { name: string; code: string; message: string }[]
}
export interface ComputeProcess {
  done: Promise<ComputeProcessResult>
  cancel(): Promise<boolean>
}
export interface ComputeBackend {
  readonly kind: 'pyodide' | 'podman'
  availability(): Promise<{ available: boolean; reason?: string }>
  start(request: ComputeBackendRequest): Promise<ComputeProcess>
  inspectExecution?(executionId: string): Promise<'running' | 'exited' | 'missing' | 'unknown'>
  stopExecution?(executionId: string): Promise<boolean>
}

/** Bytes cross this port; host paths and host APIs never enter the content worker. */
export interface ComputeWorkerInput {
  executionId: string
  code: string
  inputs: readonly { name: string; bytes: Uint8Array }[]
  runtimeBaseURL: string
}
export interface ComputeWorkerReply extends ComputeProcessResult { executionId: string }
