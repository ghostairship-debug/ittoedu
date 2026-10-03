import { randomUUID } from 'node:crypto'
import type { ModelChatMessage, ModelProvider, ModelSelection } from '../../../shared/workbench/modelProvider'
import type { ObservationResult, ObservationServicePort, VisualAnalysisPort } from '../../../shared/workbench/toolPorts'
import { observationModelMessage } from './observationModelInput'

export interface VisualAnalysisServiceOptions {
  /** Frozen when Main accepts the run. This callback must never read mutable role settings. */
  frozenSelection(runId: string): ModelSelection | null | Promise<ModelSelection | null>
  provider: ModelProvider
  observation: Pick<ObservationServicePort, 'readResource'>
}

type AnalysisResult = Awaited<ReturnType<VisualAnalysisPort['analyze']>>
type Unavailable = Extract<AnalysisResult, { status: 'vision-unavailable' }>
type RequestEvents = Parameters<VisualAnalysisPort['analyze']>[0]['onRequestEvent']

export class VisualAnalysisService implements VisualAnalysisPort {
  private readonly attempts = new Map<string, Promise<AnalysisResult>>()
  private readonly unknownRuns = new Map<string, { status: 'vision-unavailable'; reason: string; outcome: 'unknown'; code: string }>()
  constructor(private readonly options: VisualAnalysisServiceOptions) {}

  analyze(input: { runId: string; observation: ObservationResult; question: string;
    signal?: AbortSignal; onRequestEvent?: RequestEvents }): Promise<AnalysisResult> {
    return this.once(input.runId, input.observation.image.resourceId, () => this.analyzeOnce(input))
  }

  /** A tool returned this image message to a text-only conversation model; the frozen vision role describes it once. */
  analyzeImage(input: { runId: string; sourceId: string; source: ModelChatMessage; question: string;
    signal?: AbortSignal; onRequestEvent?: RequestEvents }): Promise<AnalysisResult> {
    return this.once(input.runId, `message:${input.sourceId}`, async () => {
      const selection = await this.visionSelection(input.runId, input.signal)
      if ('status' in selection) return selection
      const question = input.question.trim().slice(0, 2000)
      return this.request(input, selection, [{ role: 'system',
        content: '只分析附带的真实图片（来自本任务工具读取的材料或存档）。不得调用工具，不得猜测看不到的内容。用简明中文回答观察结论。' },
      { role: 'user', content: input.source.content ?? '' }, { role: 'user', content: `问题：${question || '描述图片内容。'}` }])
    })
  }

  clearRun(runId: string): void {
    for (const key of this.attempts.keys()) if (key.startsWith(`${runId}\u0000`)) this.attempts.delete(key)
    this.unknownRuns.delete(runId)
  }

  private once(runId: string, key: string, analyze: () => Promise<AnalysisResult>): Promise<AnalysisResult> {
    const unknown = this.unknownRuns.get(runId)
    if (unknown) return Promise.resolve(unknown)
    const id = `${runId}\u0000${key}`
    const existing = this.attempts.get(id)
    if (existing) return existing
    const attempt = analyze()
    this.attempts.set(id, attempt)
    return attempt
  }

  private async visionSelection(runId: string, signal?: AbortSignal): Promise<ModelSelection | Unavailable> {
    const selection = await this.options.frozenSelection(runId)
    if (!selection) return { status: 'vision-unavailable', reason: '当前任务接受时没有配置可用的视觉模型' }
    if (selection.connection.capabilities.vision !== 'supported')
      return { status: 'vision-unavailable', reason: selection.connection.capabilities.vision === 'unknown'
        ? '当前任务冻结的视觉模型图片能力尚未验证' : '当前任务冻结的视觉模型连接不支持图片输入' }
    if (signal?.aborted) return { status: 'vision-unavailable', reason: '视觉分析已取消' }
    return selection
  }

  private async analyzeOnce(input: { runId: string; observation: ObservationResult; question: string;
    signal?: AbortSignal; onRequestEvent?: RequestEvents }): Promise<AnalysisResult> {
    const selection = await this.visionSelection(input.runId, input.signal)
    if ('status' in selection) return selection
    let resource: Awaited<ReturnType<ObservationServicePort['readResource']>>
    try { resource = await this.options.observation.readResource({ runId: input.runId, resourceId: input.observation.image.resourceId }) }
    catch { return { status: 'vision-unavailable', reason: '观察图片资源已过期或不属于本任务' } }
    const visual = observationModelMessage({ toolCallId: 'view.observe', target: input.observation.identity.locationId,
      observation: input.observation, bytes: resource.bytes, detail: 'high' })
    const question = input.question.trim().slice(0, 2000)
    return this.request(input, selection, [{ role: 'system',
      content: '只分析附带的真实页面截图。不得调用工具，不得猜测看不到的交互状态。用简明中文回答观察结论。' },
    visual, { role: 'user', content: `问题：${question || '描述当前页面画面。'}` }])
  }

  /** One no-tool request; an unknown outcome is remembered for the run and never resent. */
  private async request(input: { runId: string; signal?: AbortSignal; onRequestEvent?: RequestEvents },
    selection: ModelSelection, messages: ModelChatMessage[]): Promise<AnalysisResult> {
    const requestId = randomUUID()
    let sending = false, terminal = false
    try {
      await input.onRequestEvent?.({ type: 'sending', requestId })
      sending = true
      let conclusion: string | null = null, actualModel: string | undefined
      for await (const event of this.options.provider.stream({ requestId, selection, messages, tools: [] },
        { signal: input.signal })) {
        if (event.type === 'response.failed') {
          terminal = true
          await input.onRequestEvent?.({ type: 'failed', requestId, failure: event.failure })
          const unavailable = { status: 'vision-unavailable' as const,
            reason: `视觉分析未完成：${event.failure.code}`, outcome: event.failure.outcome, code: event.failure.code }
          if (event.failure.outcome === 'unknown') this.unknownRuns.set(input.runId, { ...unavailable, outcome: 'unknown' })
          return unavailable
        }
        if (event.type === 'response.started') await input.onRequestEvent?.({ type: 'started', requestId,
          responseId: event.responseId, actualModel: event.actualModel })
        if (event.type === 'response.completed') {
          terminal = true
          await input.onRequestEvent?.({ type: 'completed', requestId, responseId: event.responseId,
            actualModel: event.actualModel, usage: event.usage })
          if (event.toolCalls.length) return { status: 'vision-unavailable', reason: '视觉分析模型意外请求了工具，结果未采纳' }
          conclusion = typeof event.assistant.content === 'string' ? event.assistant.content.trim() : null
          actualModel = event.actualModel
        }
      }
      if (!terminal) {
        const failure = { outcome: 'unknown' as const, kind: 'protocol' as const, code: 'visual-response-incomplete',
          message: '视觉分析响应中断，结果未知；本任务不自动重发' }
        await input.onRequestEvent?.({ type: 'failed', requestId, failure })
        const unavailable = { status: 'vision-unavailable' as const, reason: failure.message,
          outcome: failure.outcome, code: failure.code }
        this.unknownRuns.set(input.runId, unavailable)
        return unavailable
      }
      if (!conclusion) return { status: 'vision-unavailable', reason: '视觉分析没有返回可确认的文字结论' }
      return { status: 'analyzed', conclusion,
        ...(actualModel ? { actualModel } : {}),
        selection: { model: selection.model, connection: selection.connection.id, billing: selection.connection.billing.kind } }
    } catch (error) {
      if (sending && !terminal) await input.onRequestEvent?.({ type: 'failed', requestId,
        failure: { outcome: 'unknown', kind: 'transport', code: 'visual-analysis-interrupted',
          message: '视觉分析请求中断，结果未知；本任务不自动重发' } }).catch(() => undefined)
      const unavailable = { status: 'vision-unavailable' as const,
        reason: `视觉分析失败：${error instanceof Error ? error.message : String(error)}`.slice(0, 400),
        outcome: 'unknown' as const, code: 'visual-analysis-interrupted' }
      this.unknownRuns.set(input.runId, unavailable)
      return unavailable
    }
  }
}
