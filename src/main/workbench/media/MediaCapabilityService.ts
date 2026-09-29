/**
 * Optional media generation uses the existing connection and job owners.  This
 * service only freezes the task's capability/authority and routes a verified
 * provider; it never invents a job or promotes a temporary URL to an asset.
 */
export type GeneratedMediaKind = 'speech' | 'video' | 'music'

export interface MediaConnectionCapability {
  kind: GeneratedMediaKind
  connectionId: string
  connectionRevision: number
  model: string
  /** A provider-specific capability confirmed for this connection and model. */
  verified: boolean
  billing: 'metered' | 'token-plan' | 'subscription' | 'prepaid' | 'unknown'
}

export interface MediaGenerateInput {
  kind: GeneratedMediaKind
  prompt: string
  /** A deliberately small, provider-neutral input surface. */
  durationSeconds?: number
  language?: string
  referenceResources?: readonly string[]
}

export interface MediaJobStart {
  jobId: string
  status: 'submitted' | 'running' | 'ready' | 'unknown'
  providerRequestId?: string
}

/** Implemented by an actually connected provider through the common job owner. */
export interface MediaJobAdapter {
  readonly kind: GeneratedMediaKind
  submit(input: MediaGenerateInput & { runId: string; connection: MediaConnectionCapability; signal: AbortSignal }): Promise<MediaJobStart>
  cancelRun(runId: string): Promise<void>
}

export type MediaStartResult =
  | { status: 'not-configured'; kind: GeneratedMediaKind; reason: string }
  | { status: 'rejected'; kind: GeneratedMediaKind; reason: string }
  | { status: 'started'; kind: GeneratedMediaKind; job: MediaJobStart }
  | { status: 'unknown'; kind: GeneratedMediaKind; reason: string }

interface RunState {
  stopped: boolean
  writable: boolean
  capabilities: ReadonlyMap<GeneratedMediaKind, MediaConnectionCapability>
  controllers: Set<AbortController>
}

const kinds = ['speech', 'video', 'music'] as const

function validInput(input: MediaGenerateInput): string | null {
  if (!kinds.includes(input.kind)) return '不支持的媒体类型'
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) return '媒体生成说明为空或过长'
  if (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 600))
    return '媒体时长不在支持范围内'
  if (input.language !== undefined && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.language)) return '语言标识无效'
  if (input.referenceResources !== undefined && (input.referenceResources.length > 5
    || input.referenceResources.some(value => typeof value !== 'string' || !value || value.length > 512))) return '参考素材句柄无效'
  return null
}

export class MediaCapabilityService {
  private readonly runs = new Map<string, RunState>()
  private readonly adapters: ReadonlyMap<GeneratedMediaKind, MediaJobAdapter>

  constructor(adapters: readonly MediaJobAdapter[] = []) {
    this.adapters = new Map(adapters.map(adapter => [adapter.kind, adapter]))
  }

  /** The caller has already resolved the real Connection and frozen run scope. */
  beginRun(runId: string, input: { writable: boolean; capabilities?: readonly MediaConnectionCapability[] }): void {
    if (this.runs.has(runId)) throw new Error('媒体任务已开始')
    const capabilities = new Map<GeneratedMediaKind, MediaConnectionCapability>()
    for (const capability of input.capabilities ?? []) {
      if (!kinds.includes(capability.kind) || capabilities.has(capability.kind)) throw new Error('媒体连接能力重复或无效')
      capabilities.set(capability.kind, structuredClone(capability))
    }
    this.runs.set(runId, { stopped: false, writable: input.writable, capabilities, controllers: new Set() })
  }

  discover(runId: string): readonly { kind: GeneratedMediaKind; status: 'available' | 'not-configured'; reason?: string }[] {
    const run = this.requireRun(runId)
    return kinds.map(kind => {
      const capability = run.capabilities.get(kind)
      return capability?.verified && this.adapters.has(kind)
        ? { kind, status: 'available' as const }
        : { kind, status: 'not-configured' as const, reason: '当前连接没有已验证可用的媒体生成通道' }
    })
  }

  async start(runId: string, input: MediaGenerateInput, options?: { signal?: AbortSignal }): Promise<MediaStartResult> {
    const run = this.requireRun(runId)
    const bad = validInput(input)
    if (bad) return { status: 'rejected', kind: input.kind, reason: bad }
    if (run.stopped || options?.signal?.aborted) return { status: 'rejected', kind: input.kind, reason: '任务已停止' }
    if (!run.writable) return { status: 'rejected', kind: input.kind, reason: '当前任务没有外部生成授权' }
    const capability = run.capabilities.get(input.kind), adapter = this.adapters.get(input.kind)
    if (!capability?.verified || !adapter) return { status: 'not-configured', kind: input.kind, reason: '当前连接没有已验证可用的媒体生成通道' }
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    run.controllers.add(controller)
    try {
      const job = await adapter.submit({ ...structuredClone(input), runId, connection: structuredClone(capability), signal: controller.signal })
      // A provider may finish after Stop. Preserve its job fact, but do not
      // make it an actionable result for the stopped task.
      if (run.stopped || controller.signal.aborted) return { status: 'unknown', kind: input.kind, reason: '任务停止后媒体请求结果待核对，不会自动应用' }
      if (!job.jobId || !['submitted', 'running', 'ready', 'unknown'].includes(job.status))
        return { status: 'unknown', kind: input.kind, reason: '媒体提供方回执无效，结果待核对' }
      return { status: 'started', kind: input.kind, job }
    } catch {
      return { status: 'unknown', kind: input.kind, reason: '媒体请求可能已发送，需按原请求身份核对；不会自动重试' }
    } finally {
      run.controllers.delete(controller)
      options?.signal?.removeEventListener('abort', onAbort)
    }
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run || run.stopped) return
    run.stopped = true
    for (const controller of run.controllers) controller.abort()
    await Promise.allSettled([...this.adapters.values()].map(adapter => adapter.cancelRun(runId)))
  }

  endRun(runId: string): void { this.runs.delete(runId) }

  private requireRun(runId: string): RunState {
    const run = this.runs.get(runId)
    if (!run) throw new Error('媒体任务尚未获得授权')
    return run
  }
}
