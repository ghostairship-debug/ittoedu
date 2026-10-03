import type { ModelConnectionSnapshot } from '../../../shared/workbench/modelProvider'
import type { ExecutionSettingsView } from '../../../shared/workbench/executionSettings'
import type { SearchProviderPage, SearchProviderPort, WebSearchHit } from './WebResearchService'

/** Wire mapping follows DeepSeek's MIT-licensed official web-search provider (commit 639ed015).
 * Reuses only the documented native Messages search protocol, not the DSH runtime.
 * https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84/packages/web/web-search-deepseek */
export interface NativeSearchSelection { connection: ModelConnectionSnapshot; model: string }
export class WebSearchProviderError extends Error {
  constructor(readonly status: 'not-configured' | 'rejected' | 'failed', message: string) { super(message) }
}
export function nativeSearchSelection(settings: ExecutionSettingsView): NativeSearchSelection | null {
  const usable = settings.connections.filter(item => !item.revoked && item.hasCredential && item.connection.provider === 'deepseek'
    && item.connection.auth.kind === 'api-key' && new URL(item.connection.baseURL).origin === 'https://api.deepseek.com')
  const selected = Object.values(settings.profile.roles).find(role => role && usable.some(item => item.connection.id === role.connectionId))
  const entry = usable.find(item => item.connection.id === selected?.connectionId) ?? usable[0]
  if (!entry) return null
  const model = selected?.connectionId === entry.connection.id ? selected.model : 'deepseek-flash'
  return { connection: structuredClone(entry.connection), model }
}

export interface DeepSeekSearchOptions {
  selection(runId: string): NativeSearchSelection | null | Promise<NativeSearchSelection | null>
  credential(connection: Readonly<ModelConnectionSnapshot>): Promise<string>
  fetch?: typeof fetch
}
export class DeepSeekSearchProvider implements SearchProviderPort {
  constructor(private readonly options: DeepSeekSearchOptions) {}
  async search(input: Parameters<SearchProviderPort['search']>[0]): Promise<SearchProviderPage> {
    if (input.cursor) throw new WebSearchProviderError('rejected', '此原生搜索接口不提供分页游标，请调整检索词后搜索')
    input.signal.throwIfAborted()
    const selected = await this.options.selection(input.runId ?? '')
    if (!selected) throw new WebSearchProviderError('not-configured', '联网搜索需要已保存且可用的 DeepSeek 官方 API 连接；请在模型设置添加现有连接。兼容中转的凭据不会转发到官方。')
    if (selected.connection.provider !== 'deepseek' || new URL(selected.connection.baseURL).origin !== 'https://api.deepseek.com'
      || selected.connection.auth.kind !== 'api-key') throw new WebSearchProviderError('rejected', '搜索连接不是已授权的 DeepSeek 官方 API')
    const credential = await this.options.credential(selected.connection)
    input.signal.throwIfAborted()
    const response = await (this.options.fetch ?? fetch)('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([input.signal, AbortSignal.timeout(90_000)]),
      headers: { 'content-type': 'application/json', 'accept': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': credential, authorization: 'Bearer ' + credential },
      body: JSON.stringify({ model: selected.model, max_tokens: 2048,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Perform a web search for this query and return relevant sources (up to ' + input.limit + '): ' + input.query }] }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }),
    })
    if (!response.ok) throw new WebSearchProviderError('failed', 'DeepSeek 原生搜索返回 HTTP ' + response.status
      + (response.status === 401 || response.status === 403 ? '，请检查该官方连接权限' : response.status === 429 ? '，请稍后再试或检查额度' : '，未得到可核查来源'))
    const text = await response.text()
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new WebSearchProviderError('failed', '搜索响应过大，未将其作为普通检索结果')
    const payload = JSON.parse(text) as { id?: string; model?: string; content?: { type?: string; content?: unknown; citations?: { url?: string; cited_text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    const blocks = Array.isArray(payload.content) ? payload.content : []
    const resultBlocks = blocks.filter(block => block.type === 'web_search_tool_result')
    if (!resultBlocks.length) throw new WebSearchProviderError('failed', '该模型或接口没有返回原生搜索结果；普通文字中的 URL 不算搜索成功')
    const snippets = new Map<string, string>()
    for (const block of blocks) if (block.type === 'text') for (const cite of block.citations ?? [])
      if (typeof cite.url === 'string' && typeof cite.cited_text === 'string' && !snippets.has(cite.url)) snippets.set(cite.url, cite.cited_text.slice(0, 20_000))
    const seen = new Set<string>(), results: WebSearchHit[] = []
    for (const block of resultBlocks) {
      if (!Array.isArray(block.content)) throw new WebSearchProviderError('failed', '原生搜索工具返回错误而非来源列表')
      for (const value of block.content) {
        const item = value as { type?: string; url?: string; title?: string; page_age?: string }
        if (item.type !== 'web_search_result' || typeof item.url !== 'string' || seen.has(item.url)) continue
        let url: URL
        try { url = new URL(item.url) } catch { continue }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue
        seen.add(item.url)
        results.push({ url: item.url, title: typeof item.title === 'string' && item.title.trim() ? item.title : url.hostname,
          snippet: snippets.get(item.url) ?? '', ...(typeof item.page_age === 'string' ? { publishedAt: item.page_age } : {}) })
      }
    }
    return { provider: 'deepseek-official', results: results.slice(0, input.limit), providerRequestId: payload.id,
      execution: { connectionId: selected.connection.id, model: payload.model ?? selected.model, billingKind: selected.connection.billing.kind,
        ...(typeof payload.usage?.input_tokens === 'number' ? { inputTokens: payload.usage.input_tokens } : {}),
        ...(typeof payload.usage?.output_tokens === 'number' ? { outputTokens: payload.usage.output_tokens } : {}) } }
  }
}
