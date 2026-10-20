/**
 * Optional media generation uses the existing connection and job owners.  This
 * service only freezes the task's capability/authority and routes a verified
 * provider; it never invents a job or promotes a temporary URL to an asset.
 */
import type { HostMediaInput } from '../../../core/tools/mediaResource'

export type GeneratedMediaKind = 'speech' | 'video' | 'music'
export type SpeechFormat = 'mp3' | 'wav'
export type SpeechEngine = 'local' | 'remote'
type CapabilityKey = GeneratedMediaKind | 'speech:local' | 'speech:remote'

export interface MediaConnectionCapability {
  route?: 'remote'
  kind: GeneratedMediaKind
  connectionId: string
  connectionRevision: number
  model: string
  /** Dispatchable configuration/capability declarations for this model; not proof of successful provider synthesis. */
  verified: boolean
  billing: 'metered' | 'token-plan' | 'subscription' | 'prepaid' | 'unknown'
  /** Explicit provider/model facts; text and OAuth capability never imply speech. */
  speech?: SpeechCapability
}

export interface SpeechCapability {
  voices: readonly string[]
  defaultVoice: string
  formats: readonly SpeechFormat[]
  defaultFormat: SpeechFormat
  voiceCultures?: Readonly<Record<string, string>>
  instructions?: boolean
  speed?: { min: number; max: number; default: number }
  maxInputCharacters?: number
}
/** A real desktop capability, not a fabricated Provider connection or account. */
export interface MediaLocalSpeechCapability {
  kind: 'speech'
  route: 'windows-local'
  model: 'Windows.SystemSpeech'
  verified: true
  billing: 'local'
  speech: SpeechCapability
}
export type MediaCapability = MediaConnectionCapability | MediaLocalSpeechCapability

export interface MediaGenerateInput {
  kind: GeneratedMediaKind
  prompt: string
  /** A deliberately small, provider-neutral input surface. */
  durationSeconds?: number
  language?: string
  referenceResources?: readonly string[]
  voice?: string
  format?: SpeechFormat
  engine?: SpeechEngine
  instructions?: string
  speed?: number
}

export interface GeneratedMediaResource {
  resourceId: string
  source: string
  mimeType: string
  filename: string
  byteLength: number
  durationSeconds?: number
}

export interface MediaJobStart {
  jobId: string
  status: 'submitted' | 'running' | 'ready' | 'unknown'
  providerRequestId?: string
  resources?: readonly GeneratedMediaResource[]
  engine?: SpeechEngine
  configuredModel?: string
  voice?: string
}

/** Implemented by an actually connected provider through the common job owner. */
export interface MediaJobAdapter {
  readonly kind: GeneratedMediaKind
  submit(input: MediaGenerateInput & { runId: string; capability: MediaCapability; signal: AbortSignal }): Promise<MediaJobStart>
  cancelRun(runId: string): Promise<void>
  readResource?(runId: string, resourceId: string): Promise<HostMediaInput>
}

export class MediaSubmissionError extends Error {
  constructor(readonly outcome: 'not-sent' | 'rejected' | 'unknown', message: string) { super(message) }
}

export type MediaStartResult =
  | { status: 'not-configured'; kind: GeneratedMediaKind; reason: string }
  | { status: 'rejected'; kind: GeneratedMediaKind; reason: string }
  | { status: 'started'; kind: GeneratedMediaKind; job: MediaJobStart }
  | { status: 'unknown'; kind: GeneratedMediaKind; reason: string }

interface RunState {
  stopped: boolean
  writable: boolean
  capabilities: ReadonlyMap<CapabilityKey, MediaCapability>
  unavailableReasons?: Partial<Record<CapabilityKey, string>>
  controllers: Set<AbortController>
}

const kinds = ['speech', 'video', 'music'] as const
const speechEngines = ['local', 'remote'] as const
const capabilityKey = (kind: GeneratedMediaKind, engine?: SpeechEngine): CapabilityKey => kind === 'speech' ? `speech:${engine ?? 'local'}` : kind
export const speechEngine = (capability: MediaCapability): SpeechEngine => capability.route === 'windows-local' ? 'local' : 'remote'

function capabilityDiagnostic(capability: MediaCapability | undefined): string | undefined {
  if (!capability?.verified) return '当前连接没有已验证可用的媒体生成通道'
  if (capability.kind === 'speech') {
    const speech = capability.speech
    if (!speech?.defaultVoice?.trim() || !speech.voices.includes(speech.defaultVoice)
      || !speech.formats.includes(speech.defaultFormat) || speech.formats.some(format => !['mp3', 'wav'].includes(format)))
      return '语音连接缺少已验证的声音角色或格式配置'
  }
}

function validInput(input: MediaGenerateInput): string | null {
  if (!kinds.includes(input.kind)) return '不支持的媒体类型'
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) return '媒体生成说明为空或过长'
  if (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 600))
    return '媒体时长不在支持范围内'
  if (input.language !== undefined && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.language)) return '语言标识无效'
  if (input.referenceResources !== undefined && (input.referenceResources.length > 5
    || input.referenceResources.some(value => typeof value !== 'string' || !value || value.length > 512))) return '参考素材句柄无效'
  if (input.voice !== undefined && (typeof input.voice !== 'string' || !input.voice.trim() || input.voice.length > 200)) return '语音角色无效'
  if (input.format !== undefined && !['mp3', 'wav'].includes(input.format)) return '语音格式无效'
  if (input.engine !== undefined && !speechEngines.includes(input.engine)) return '语音引擎无效'
  if (input.instructions !== undefined && (typeof input.instructions !== 'string' || !input.instructions.trim() || input.instructions.length > 4096)) return '语音表演说明为空或超过 4096 字符'
  if (input.speed !== undefined && (!Number.isFinite(input.speed) || input.speed < 0.25 || input.speed > 4)) return '语音速度须在 0.25–4.0 之间'
  if (input.kind !== 'speech' && (input.voice !== undefined || input.format !== undefined || input.engine !== undefined || input.instructions !== undefined || input.speed !== undefined)) return '声音角色、引擎与语音参数仅适用于语音生成'
  return null
}

export class MediaCapabilityService {
  private readonly runs = new Map<string, RunState>()
  private readonly adapters: ReadonlyMap<GeneratedMediaKind, MediaJobAdapter>

  constructor(adapters: readonly MediaJobAdapter[] = []) {
    this.adapters = new Map(adapters.map(adapter => [adapter.kind, adapter]))
  }

  /** The caller has already resolved the real Connection and frozen run scope. */
  beginRun(runId: string, input: { writable: boolean; capabilities?: readonly MediaCapability[]; unavailableReasons?: Partial<Record<CapabilityKey, string>> }): void {
    if (this.runs.has(runId)) throw new Error('媒体任务已开始')
    const capabilities = new Map<CapabilityKey, MediaCapability>()
    for (const capability of input.capabilities ?? []) {
      const key = capabilityKey(capability.kind, speechEngine(capability))
      if (!kinds.includes(capability.kind) || capabilities.has(key)) throw new Error('媒体连接能力重复或无效')
      capabilities.set(key, structuredClone(capability))
    }
    this.runs.set(runId, { stopped: false, writable: input.writable, capabilities, unavailableReasons: structuredClone(input.unavailableReasons), controllers: new Set() })
  }

  discover(runId: string): readonly { kind: GeneratedMediaKind; status: 'available' | 'not-configured'; reason?: string;
    engine?: SpeechEngine; model?: string; route?: 'remote' | 'windows-local'; billing?: MediaCapability['billing']; speech?: SpeechCapability;
    availabilityBasis?: 'installed-voices' | 'configuration' }[] {
    const run = this.requireRun(runId)
    const entries = [{ kind: 'speech' as const, engine: 'local' as const }, { kind: 'speech' as const, engine: 'remote' as const },
      { kind: 'video' as const, engine: undefined }, { kind: 'music' as const, engine: undefined }]
    return entries.map(({ kind, engine }) => {
      const key = capabilityKey(kind, engine), capability = run.capabilities.get(key)
      const reason = (!capability ? run.unavailableReasons?.[key] ?? (engine !== 'remote' ? run.unavailableReasons?.[kind] : undefined) : undefined) ?? capabilityDiagnostic(capability)
        ?? (!this.adapters.has(kind) ? '当前连接没有已验证可用的媒体生成通道' : undefined)
      return !reason && capability
        ? { kind, ...(engine ? { engine } : {}), status: 'available' as const, model: capability.model, route: capability.route ?? 'remote', billing: capability.billing,
          ...(kind === 'speech' ? { availabilityBasis: engine === 'local' ? 'installed-voices' as const : 'configuration' as const } : {}),
          ...(capability.speech ? { speech: structuredClone(capability.speech) } : {}) }
        : { kind, ...(engine ? { engine } : {}), status: 'not-configured' as const, reason }
    })
  }

  async start(runId: string, input: MediaGenerateInput, options?: { signal?: AbortSignal }): Promise<MediaStartResult> {
    const run = this.requireRun(runId)
    const bad = validInput(input)
    if (bad) return { status: 'rejected', kind: input.kind, reason: bad }
    if (run.stopped || options?.signal?.aborted) return { status: 'rejected', kind: input.kind, reason: '任务已停止' }
    if (!run.writable) return { status: 'rejected', kind: input.kind, reason: '当前任务没有媒体生成授权' }
    const key = capabilityKey(input.kind, input.engine), capability = run.capabilities.get(key), adapter = this.adapters.get(input.kind)
    const diagnostic = (!capability ? run.unavailableReasons?.[key] ?? (input.engine !== 'remote' ? run.unavailableReasons?.[input.kind] : undefined) : undefined) ?? capabilityDiagnostic(capability)
    if (diagnostic || !capability || !adapter) return { status: 'not-configured', kind: input.kind, reason: diagnostic ?? '当前连接没有已验证可用的媒体生成通道' }
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    run.controllers.add(controller)
    try {
      const job = await adapter.submit({ ...structuredClone(input), runId, capability: structuredClone(capability), signal: controller.signal })
      // A provider may finish after Stop. Preserve its job fact, but do not
      // make it an actionable result for the stopped task.
      if (run.stopped || controller.signal.aborted) return { status: 'unknown', kind: input.kind, reason: '任务停止后媒体请求结果待核对，不会自动应用' }
      if (!job.jobId || !['submitted', 'running', 'ready', 'unknown'].includes(job.status))
        return { status: 'unknown', kind: input.kind, reason: '媒体提供方回执无效，结果待核对' }
      return { status: 'started', kind: input.kind, job }
    } catch (error) {
      if (error instanceof MediaSubmissionError)
        return { status: error.outcome === 'unknown' ? 'unknown' : 'rejected', kind: input.kind, reason: error.message }
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

  /** Resolve only this run's durable result; insertion/save retain their existing owners. */
  async readResource(runId: string, resourceId: string): Promise<HostMediaInput> {
    const run = this.requireRun(runId)
    if (run.stopped) throw new Error('任务已停止')
    const kind = resourceId.startsWith('speech_') ? 'speech' : undefined
    const adapter = kind ? this.adapters.get(kind) : undefined
    if (!adapter?.readResource) throw new Error('媒体资源不存在或类型不受支持')
    const resource = await adapter.readResource(runId, resourceId)
    if (run.stopped) throw new Error('任务已停止')
    return resource
  }

  private requireRun(runId: string): RunState {
    const run = this.runs.get(runId)
    if (!run) throw new Error('媒体任务尚未获得授权')
    return run
  }
}
