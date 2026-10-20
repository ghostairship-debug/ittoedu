import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HostMediaInput } from '../../../core/tools/mediaResource'
import type { ModelConnectionSnapshot } from '../../../shared/workbench/modelProvider'
import { prepareMediaResource } from '../admittedMediaResource'
import { modelFetch } from '../providers/modelFetch'
import { waitForModelOperation } from '../providers/OpenAIChatProvider'
import { MediaSubmissionError, speechEngine, type GeneratedMediaResource, type MediaCapability, type MediaLocalSpeechCapability, type MediaConnectionCapability, type MediaGenerateInput,
  type MediaJobAdapter, type MediaJobStart, type SpeechFormat } from './MediaCapabilityService'
import type { LocalSpeechSynthesizer } from './WindowsSpeechSynthesizer'

export interface SpeechMediaJobAdapterOptions {
  directory: string
  /** Resolve the exact frozen revision. This is never selected from a text/OAuth role. */
  resolveConnection?(capability: MediaConnectionCapability, runId: string): Promise<Readonly<ModelConnectionSnapshot>>
  credentialResolver?(connection: Readonly<ModelConnectionSnapshot>): Promise<string>
  fetch?: typeof fetch
  local?: LocalSpeechSynthesizer
}

interface SpeechReceipt {
  runId: string
  route?: 'remote' | 'windows-local'
  connectionId?: string
  connectionRevision?: number
  model: string
  format: SpeechFormat
  resource: GeneratedMediaResource
  providerRequestId?: string
  voice?: string
  instructions?: string
  speed?: number
}

const mediaTypes = { mp3: 'audio/mpeg', wav: 'audio/wav' } as const
const validResourceId = (value: string) => /^speech_[0-9a-f-]{36}$/.test(value)

/** WAV headers expose duration without a second decoder or a network metadata request. */
function wavDuration(bytes: Uint8Array): number | undefined {
  const buffer = Buffer.from(bytes)
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return
  let byteRate = 0, dataBytes: number | undefined
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), start = offset + 8
    if (kind === 'fmt ' && size >= 16 && start + 16 <= buffer.length) byteRate = buffer.readUInt32LE(start + 8)
    if (kind === 'data') dataBytes = Math.min(size, buffer.length - start)
    offset = start + size + (size % 2)
  }
  if (byteRate > 0 && dataBytes !== undefined) return dataBytes / byteRate
}

function audioMatches(bytes: Uint8Array, format: SpeechFormat): boolean {
  const buffer = Buffer.from(bytes)
  return format === 'wav' ? buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE'
    : buffer.length >= 3 && (buffer.toString('ascii', 0, 3) === 'ID3' || buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)
}

/**
 * One speech resource owner for explicitly selected remote API and desktop
 * Windows synthesis. Neither route falls back to the other after a failure.
 */
export class SpeechMediaJobAdapter implements MediaJobAdapter {
  readonly kind = 'speech' as const
  constructor(private readonly options: SpeechMediaJobAdapterOptions) {}

  async discoverLocal(): Promise<{ capability?: MediaLocalSpeechCapability; reason?: string }> {
    if (!this.options.local) return { reason: '本机语音合成尚未接入' }
    try {
      const voices = await this.options.local.voices()
      if (!voices.length) return { reason: 'Windows 本机没有可用的已启用语音声库' }
      const preferred = voices.find(voice => /^en-US$/i.test(voice.culture)) ?? voices.find(voice => /^en(?:-|$)/i.test(voice.culture)) ?? voices[0]!
      return { capability: { kind: 'speech', route: 'windows-local', model: 'Windows.SystemSpeech', verified: true, billing: 'local',
        speech: { voices: voices.map(voice => voice.name), defaultVoice: preferred.name, formats: ['wav'], defaultFormat: 'wav', instructions: false,
          voiceCultures: Object.fromEntries(voices.map(voice => [voice.name, voice.culture])) } } }
    } catch (error) { return { reason: error instanceof Error ? error.message : 'Windows 本机语音声库无法读取' } }
  }

  private async persist(input: { runId: string; capability: MediaCapability; voice: string; format: SpeechFormat;
    bytes: Uint8Array; signal: AbortSignal; providerRequestId?: string; instructions?: string; speed?: number }): Promise<MediaJobStart> {
    input.signal.throwIfAborted()
    if (!audioMatches(input.bytes, input.format)) throw new MediaSubmissionError('unknown', '语音通道未返回所选格式的完整音频；不会把响应当作可用录音或自动重试')
    const resourceId = `speech_${randomUUID()}`, filename = `speech.${input.format}`
    const admitted = await prepareMediaResource({ bytes: input.bytes, filename, mimeType: mediaTypes[input.format] }, () => resourceId)
    const durationSeconds = input.format === 'wav' ? wavDuration(admitted.bytes) : undefined
    const resource: GeneratedMediaResource = { resourceId, source: `media:${resourceId}`, filename,
      mimeType: admitted.meta.mimeType, byteLength: admitted.bytes.byteLength, ...(durationSeconds !== undefined ? { durationSeconds } : {}) }
    const receipt: SpeechReceipt = { runId: input.runId, route: input.capability.route ?? 'remote', model: input.capability.model,
      ...(input.capability.route !== 'windows-local' ? { connectionId: input.capability.connectionId, connectionRevision: input.capability.connectionRevision } : {}),
      voice: input.voice, format: input.format, resource, ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}), ...(input.speed !== undefined ? { speed: input.speed } : {}) }
    input.signal.throwIfAborted()
    await fs.mkdir(this.options.directory, { recursive: true })
    await fs.writeFile(path.join(this.options.directory, `${resourceId}.${input.format}`), admitted.bytes, { flag: 'wx' })
    await fs.writeFile(path.join(this.options.directory, `${resourceId}.json`), JSON.stringify(receipt), { flag: 'wx' })
    return { jobId: resourceId, status: 'ready', engine: speechEngine(input.capability), configuredModel: input.capability.model,
      voice: input.voice, resources: [resource], ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}) }
  }

  async submit(input: MediaGenerateInput & { runId: string; capability: MediaCapability; signal: AbortSignal }): Promise<MediaJobStart> {
    let attempted = false
    let response: Response | undefined
    try {
      const capability = input.capability, speech = capability.speech
      if (input.kind !== 'speech' || !capability.verified || !speech)
        throw new MediaSubmissionError('not-sent', '当前连接没有已验证的语音模型、声音角色与格式')
      if (input.instructions !== undefined && (capability.route === 'windows-local' || speech.instructions !== true))
        throw new MediaSubmissionError('not-sent', '当前语音引擎不支持表演 instructions；如需情绪、语调或风格，请明确选择已声明支持该能力的语音通道')
      if (input.speed !== undefined && (capability.route === 'windows-local' || !speech.speed))
        throw new MediaSubmissionError('not-sent', '当前语音引擎不支持 speed 语速参数；请使用默认速度或明确选择已声明支持该参数的语音通道')
      if (speech.maxInputCharacters !== undefined && input.prompt.length > speech.maxInputCharacters)
        throw new MediaSubmissionError('not-sent', `当前语音模型台词最多 ${speech.maxInputCharacters} 字符，请分段生成录音`)
      if (input.speed !== undefined && speech.speed && (input.speed < speech.speed.min || input.speed > speech.speed.max))
        throw new MediaSubmissionError('not-sent', `当前语音模型 speed 语速范围为 ${speech.speed.min}–${speech.speed.max}`)
      let voice = input.voice ?? speech.defaultVoice
      const format = input.format ?? speech.defaultFormat
      if (capability.route === 'windows-local' && !input.voice && input.language) {
        const language = input.language.toLowerCase()
        const matches = (culture: string) => culture.toLowerCase() === language || culture.toLowerCase().startsWith(`${language}-`)
        voice = speech.voices.find(name => matches(speech.voiceCultures?.[name] ?? '')) ?? ''
        if (!voice) throw new MediaSubmissionError('not-sent', `Windows 本机没有支持 ${input.language} 的可用声音角色`)
      }
      if (!speech.voices.includes(voice) || !speech.formats.includes(format) || !['mp3', 'wav'].includes(format))
        throw new MediaSubmissionError('not-sent', '当前语音模型不支持所选声音角色或音频格式')
      if (input.durationSeconds !== undefined || input.referenceResources?.length)
        throw new MediaSubmissionError('not-sent', '当前语音通道按台词生成录音，不支持指定时长或参考音频；请调整台词或选用已配置支持该能力的通道')
      if (capability.route === 'windows-local') {
        if (!this.options.local) throw new MediaSubmissionError('not-sent', 'Windows 本机语音合成尚未接入')
        let bytes: Uint8Array
        try { bytes = await this.options.local.synthesize({ text: input.prompt, voice }, input.signal) }
        catch (error) { throw new MediaSubmissionError('rejected', error instanceof Error ? error.message : 'Windows 本机语音合成失败') }
        return this.persist({ runId: input.runId, capability, voice, format, bytes, signal: input.signal })
      }
      if (!this.options.resolveConnection || !this.options.credentialResolver) throw new MediaSubmissionError('not-sent', '远程语音 API 连接尚未配置')
      const connection = await waitForModelOperation(() => this.options.resolveConnection!(capability, input.runId), input.signal)
      if (connection.id !== capability.connectionId || connection.revision !== capability.connectionRevision || connection.auth.kind !== 'api-key'
        || connection.protocol === 'chatgpt-responses')
        throw new MediaSubmissionError('not-sent', '语音连接与本次冻结配置不一致，或所选登录不支持独立语音 API')
      const endpoint = new URL(`${connection.baseURL.replace(/\/+$/, '')}/audio/speech`)
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
        throw new MediaSubmissionError('not-sent', '语音接口地址无效')
      const credential = await waitForModelOperation(() => this.options.credentialResolver!(connection), input.signal)
      if (!credential || /[\r\n]/.test(credential)) throw new MediaSubmissionError('not-sent', '语音连接凭据不可用')
      input.signal.throwIfAborted()
      attempted = true
      response = await modelFetch(this.options.fetch)(endpoint.href, {
        method: 'POST', redirect: 'error', signal: input.signal,
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: mediaTypes[format] },
        body: JSON.stringify({ model: capability.model, input: input.prompt, voice, response_format: format,
          ...(input.instructions !== undefined ? { instructions: input.instructions } : {}), ...(input.speed !== undefined ? { speed: input.speed } : {}) }),
      })
      if (!response.ok) throw new MediaSubmissionError(response.status >= 400 && response.status < 500 && response.status !== 408 ? 'rejected' : 'unknown',
        `语音请求返回 HTTP ${response.status}；未自动重试或切换收费路径。`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      input.signal.throwIfAborted()
      const rawRequestId = response.headers.get('x-request-id')
      const providerRequestId = rawRequestId && !rawRequestId.includes(credential) && /^[A-Za-z0-9_.:-]{1,200}$/.test(rawRequestId) ? rawRequestId : undefined
      return this.persist({ runId: input.runId, capability, voice, format, bytes, signal: input.signal, providerRequestId,
        instructions: input.instructions, speed: input.speed })
    } catch (error) {
      if (error instanceof MediaSubmissionError) throw error
      throw new MediaSubmissionError(attempted ? 'unknown' : 'not-sent', attempted
        ? '语音请求未取得可用的完整结果，状态未知；未自动重试。'
        : '语音请求未发送，请检查冻结连接、参数与凭据。')
    } finally {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }

  /** The owning service aborts every active submit signal before calling this hook. */
  async cancelRun(_runId: string): Promise<void> {}

  async readResource(runId: string, resourceId: string): Promise<HostMediaInput> {
    if (!validResourceId(resourceId)) throw new Error('语音资源句柄无效')
    const receipt = JSON.parse(await fs.readFile(path.join(this.options.directory, `${resourceId}.json`), 'utf8')) as SpeechReceipt
    if (receipt.runId !== runId || receipt.resource.resourceId !== resourceId || !['mp3', 'wav'].includes(receipt.format))
      throw new Error('语音资源不属于当前任务')
    const bytes = new Uint8Array(await fs.readFile(path.join(this.options.directory, `${resourceId}.${receipt.format}`)))
    return { bytes, filename: receipt.resource.filename, mimeType: mediaTypes[receipt.format] }
  }
}
