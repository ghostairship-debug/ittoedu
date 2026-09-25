import { randomBytes, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { ModelAssistantMessage, ModelChatMessage, ModelEvent, ModelProvider, ModelSelection, ModelToolDefinition } from '../../../shared/workbench/modelProvider'
import type { ModelCapabilityFact, ModelCapabilityProbeOutcome, ModelCapabilityProbeResult, ProbedModelCapability } from '../../../shared/workbench/modelCapabilities'

interface VisionChallenge { dataUrl: string; expected: string }
export interface ModelCapabilityProbeOptions {
  provider: ModelProvider
  now?: () => number
  createId?: () => string
  createVisionChallenge?: () => Promise<VisionChallenge>
}

const samples = [
  { color: 'red', fill: '#dc2626' }, { color: 'green', fill: '#16a34a' }, { color: 'blue', fill: '#2563eb' },
  { color: 'yellow', fill: '#eab308' }, { color: 'purple', fill: '#9333ea' }, { color: 'orange', fill: '#ea580c' },
] as const
const shapes = ['circle', 'square', 'triangle'] as const

async function visionChallenge(): Promise<VisionChallenge> {
  const random = randomBytes(6), available = [...samples], chosen = shapes.map((_shape, index) => available.splice(random[index]! % available.length, 1)[0]!)
  const cells = chosen.map((color, index) => {
    const x = index * 120 + 60, shape = shapes[(index + random[index + 3]!) % shapes.length]!
    const body = shape === 'circle' ? `<circle cx="${x}" cy="60" r="34" fill="${color.fill}"/>`
      : shape === 'square' ? `<rect x="${x - 34}" y="26" width="68" height="68" rx="3" fill="${color.fill}"/>`
        : `<path d="M ${x} 21 L ${x + 40} 96 L ${x - 40} 96 Z" fill="${color.fill}"/>`
    return { body, answer: `${color.color}-${shape}` }
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120"><rect width="360" height="120" fill="white"/>${cells.map(cell => cell.body).join('')}</svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, expected: cells.map(cell => cell.answer).join('|') }
}

/** Accept only three complete, ordered color/shape pairs; punctuation cannot turn a partial answer into evidence. */
function visionAnswer(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const cells = value.trim().replace(/[`*_]/g, '').split(/\s*[|｜,，]\s*/)
  if (cells.length !== 3) return undefined
  const parsed = cells.map(cell => cell.trim().match(/^(red|green|blue|yellow|purple|orange)[\s-]+(circle|square|triangle)[。.!！]?$/i))
  return parsed.every(Boolean) ? parsed.map(match => `${match![1]!.toLowerCase()}-${match![2]!.toLowerCase()}`).join('|') : undefined
}

async function completed(provider: ModelProvider, selection: ModelSelection, requestId: string,
  messages: readonly ModelChatMessage[], tools?: readonly ModelToolDefinition[]): Promise<{ assistant?: ModelAssistantMessage; actualModel?: string; failure?: ModelCapabilityProbeOutcome }> {
  try {
    let completion: Extract<ModelEvent, { type: 'response.completed' }> | undefined
    for await (const event of provider.stream({ requestId, selection, messages, ...(tools ? { tools } : {}) })) {
      if (event.type === 'response.failed') return { failure: { capability: 'vision', status: 'unknown', code: event.failure.code, message: event.failure.message } }
      if (event.type === 'response.completed') completion = event
    }
    return completion ? { assistant: completion.assistant, actualModel: completion.actualModel } : {}
  } catch {
    return { failure: { capability: 'vision', status: 'unknown', code: 'probe-transport-failed', message: '能力验证请求未完整结束；能力仍为未知。' } }
  }
}

/** Explicit, billable one-request-per-check probes. No retry, provider fallback or document mutation. */
export class ModelCapabilityProbe {
  private readonly now: () => number
  private readonly createId: () => string
  private readonly createVisionChallenge: () => Promise<VisionChallenge>
  constructor(private readonly options: ModelCapabilityProbeOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    this.createVisionChallenge = options.createVisionChallenge ?? visionChallenge
  }

  async probe(selection: ModelSelection, rawChecks: readonly ProbedModelCapability[]): Promise<ModelCapabilityProbeResult> {
    const checks = [...rawChecks]
    if (!checks.length || checks.length > 2 || new Set(checks).size !== checks.length || checks.some(check => !['tools', 'vision'].includes(check))) throw new Error('invalid-capability-checks')
    const observedAt = this.now(), outcomes: ModelCapabilityProbeOutcome[] = [], facts: ModelCapabilityProbeResult['facts'] = {}
    for (const capability of checks) {
      const result = capability === 'vision' ? await this.vision(selection) : await this.tools(selection)
      outcomes.push(result.outcome)
      if (result.fact) facts[capability] = result.fact
    }
    return { observedAt, checks, requestCount: checks.length, outcomes, facts }
  }

  private async vision(selection: ModelSelection): Promise<{ outcome: ModelCapabilityProbeOutcome; fact?: ModelCapabilityFact }> {
    const challenge = await this.createVisionChallenge(), requestId = `capability-vision-${this.createId()}`
    const result = await completed(this.options.provider, selection, requestId, [{ role: 'user', content: [
      { type: 'text', text: '识别图片内从左到右的三格颜色与形状。只返回英文短码，以 | 分隔；颜色限 red/green/blue/yellow/purple/orange，形状限 circle/square/triangle。不要解释。' },
      { type: 'image_url', image_url: { url: challenge.dataUrl } },
    ] }])
    if (result.failure) return { outcome: { ...result.failure, capability: 'vision' } }
    const supported = visionAnswer(result.assistant?.content) === challenge.expected
    const outcome: ModelCapabilityProbeOutcome = { capability: 'vision', status: supported ? 'supported' : 'unknown',
      code: supported ? 'probe-vision-observed' : 'probe-answer-mismatch',
      // The provider reply is arbitrary text. A bounded preview can still echo
      // its Authorization header or unrelated customer content into settings.
      message: supported ? '模型正确识别了随机三格图片的颜色与形状顺序。'
        : '随机三格图片挑战未通过；视觉能力仍为未知。响应格式或答案与挑战不匹配。',
      ...(result.actualModel ? { actualModel: result.actualModel } : {}) }
    return { outcome, ...(supported ? { fact: { status: 'supported', observedAt: this.now(), source: 'probe', ...(result.actualModel ? { actualModel: result.actualModel } : {}) } } : {}) }
  }

  private async tools(selection: ModelSelection): Promise<{ outcome: ModelCapabilityProbeOutcome; fact?: ModelCapabilityFact }> {
    const token = this.createId(), requestId = `capability-tools-${this.createId()}`
    const result = await completed(this.options.provider, selection, requestId, [{ role: 'user', content: `只调用 capability_probe 工具，并原样传入 token：${token}` }], [{
      name: 'capability_probe', description: '验证模型是否会发出指定工具调用', inputSchema: { type: 'object', properties: { token: { type: 'string', const: token } }, required: ['token'], additionalProperties: false },
    }])
    if (result.failure) return { outcome: { ...result.failure, capability: 'tools' } }
    let supported = false
    const call = result.assistant?.tool_calls?.find(value => value.function.name === 'capability_probe')
    try { supported = Boolean(call && JSON.parse(call.function.arguments).token === token) } catch { supported = false }
    const outcome: ModelCapabilityProbeOutcome = { capability: 'tools', status: supported ? 'supported' : 'unknown',
      code: supported ? 'probe-tool-observed' : 'probe-tool-missing',
      message: supported ? '模型返回了参数完整的指定工具调用。' : '模型未返回参数完整的指定工具调用；工具能力仍为未知。',
      ...(result.actualModel ? { actualModel: result.actualModel } : {}) }
    return { outcome, ...(supported ? { fact: { status: 'supported', observedAt: this.now(), source: 'probe', ...(result.actualModel ? { actualModel: result.actualModel } : {}) } } : {}) }
  }
}
