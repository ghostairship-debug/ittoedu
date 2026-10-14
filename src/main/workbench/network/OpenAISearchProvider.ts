import { randomUUID } from 'node:crypto'
import type { ModelJsonObject, ModelProvider, ModelSelection } from '../../../shared/workbench/modelProvider'
import { supportsOpenAISearch } from '../../../shared/workbench/searchSettings'
import type { SearchAttempt, SearchProviderPage, WebSearchHit } from '../../../shared/workbench/webSearch'
import type { SearchProviderPort } from './WebResearchService'
import { WebSearchProviderError } from './SearchProviderError'
const object = (value: unknown): value is ModelJsonObject => !!value && typeof value === 'object' && !Array.isArray(value)
export class OpenAISearchProvider implements SearchProviderPort {
  constructor(private readonly options: { selection(runId: string): ModelSelection | null; provider: ModelProvider; observeCapability?(selection: ModelSelection, status: 'supported' | 'unsupported', actualModel?: string): Promise<void> }) {}
  async search(input: Parameters<SearchProviderPort['search']>[0]): Promise<SearchProviderPage> {
    input.signal.throwIfAborted()
    const selected = this.options.selection(input.runId ?? '')
    if (!selected || !supportsOpenAISearch(selected.connection)) throw new WebSearchProviderError('not-configured', '所选 OpenAI 搜索连接未接通或不是已授权的官方 Responses 连接')
    if (input.cursor) throw new WebSearchProviderError('rejected', 'OpenAI 搜索没有上游分页能力，请使用本次结果续页句柄')
    const attempt: SearchAttempt = { provider: 'openai-native', connectionId: selected.connection.id, requestedModel: selected.model, outcome: 'not-sent' }
    let completed: Extract<import('../../../shared/workbench/modelProvider').ModelEvent, { type: 'response.completed' }> | undefined
    try {
      for await (const event of this.options.provider.stream({ requestId: randomUUID(), selection: structuredClone(selected), nativeSearch: { contextSize: 'low' },
        messages: [{ role: 'system', content: 'Search the web for the user query. Return a concise factual summary with URL citations. Do not perform any other action.' },
          { role: 'user', content: input.query }] }, { signal: input.signal })) {
        if (event.type === 'response.started') { attempt.outcome = 'unknown'; attempt.providerRequestId = event.providerRequestId ?? event.responseId; if (event.actualModel) attempt.model = event.actualModel }
        if (event.type === 'usage.reported') attempt.usage = event.usage
        if (event.type === 'response.failed') {
          attempt.outcome = event.failure.outcome
          if (event.failure.providerRequestId) attempt.providerRequestId = event.failure.providerRequestId
          if (event.failure.kind === 'protocol' && event.failure.code === 'native-web-search-unsupported') await this.options.observeCapability?.(selected, 'unsupported', attempt.model).catch(() => undefined)
          attempt.error = { code: event.failure.code, message: event.failure.message, ...(event.failure.httpStatus ? { httpStatus: event.failure.httpStatus } : {}) }
          throw new WebSearchProviderError(event.failure.outcome === 'not-sent' ? 'not-configured' : 'failed', event.failure.message, [attempt])
        }
        if (event.type === 'response.completed') {
          completed = event; attempt.outcome = 'completed'; attempt.providerRequestId ??= event.responseId
          if (event.actualModel) attempt.model = event.actualModel
          if (event.usage) attempt.usage = event.usage
        }
      }
      input.signal.throwIfAborted()
      if (!completed) throw new Error('OpenAI 搜索未返回完成事件')
      const output = completed.assistant.nativeResponses?.output ?? (Array.isArray(completed.nativeResponse.output) ? completed.nativeResponse.output.filter(object) : [])
      const calls = output.filter(item => item.type === 'web_search_call' && item.status === 'completed')
      if (!calls.length) throw new Error('OpenAI 未实际完成原生 web_search；普通文字或 URL 不算搜索结果')
      await this.options.observeCapability?.(selected, 'supported', attempt.model).catch(() => undefined)
      const results: WebSearchHit[] = [], citations: { url: string; title: string }[] = [], seen = new Set<string>()
      const add = (value: unknown, cited = false) => {
        if (!object(value) || typeof value.url !== 'string') return
        let url: URL
        try { url = new URL(value.url) } catch { return }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
        const title = typeof value.title === 'string' && value.title.trim() ? value.title : url.hostname
        if (cited && !citations.some(cite => cite.url === url.href)) citations.push({ url: url.href, title })
        if (seen.has(url.href)) return
        seen.add(url.href); results.push({ title, url: url.href, snippet: '' })
      }
      for (const item of output) if (item.type === 'message' && Array.isArray(item.content)) for (const part of item.content)
        if (object(part) && Array.isArray(part.annotations)) for (const annotation of part.annotations)
          if (object(annotation) && annotation.type === 'url_citation') add(annotation, true)
      for (const call of calls) if (object(call.action) && call.action.type === 'open_page' && typeof call.action.url === 'string') add({ url: call.action.url })
      for (const call of calls) if (object(call.action) && Array.isArray(call.action.sources)) for (const source of call.action.sources) add(source)
      return { provider: 'openai-native', results, attempts: [attempt], providerRequestId: attempt.providerRequestId,
        ...(typeof completed.assistant.content === 'string' ? { summary: completed.assistant.content } : {}), citations,
        ...(attempt.model ? { execution: { connectionId: selected.connection.id, model: attempt.model, billingKind: selected.connection.billing.kind,
          ...(attempt.usage?.inputTokens !== undefined ? { inputTokens: attempt.usage.inputTokens } : {}),
          ...(attempt.usage?.outputTokens !== undefined ? { outputTokens: attempt.usage.outputTokens } : {}) } } : {}) }
    } catch (cause) {
      if (cause instanceof WebSearchProviderError) throw cause
      attempt.error = { code: input.signal.aborted ? 'search-aborted' : 'native-search-incomplete', message: cause instanceof Error ? cause.message : '搜索结果未知' }
      throw new WebSearchProviderError('failed', attempt.error.message, [attempt])
    }
  }
}
