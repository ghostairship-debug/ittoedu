import type { SearchAttempt, SearchProviderPage, WebSearchHit } from '../../../shared/workbench/webSearch'
import type { SearchProviderPort } from './WebResearchService'
import { WebSearchProviderError } from './SearchProviderError'
/** Explicitly configured service may be local/LAN. It does not loosen web.open's public URL boundary. */
export class SearxngSearchProvider implements SearchProviderPort {
  constructor(private readonly options: { url: string; fetch?: typeof fetch }) {}
  async search(input: Parameters<SearchProviderPort['search']>[0]): Promise<SearchProviderPage> {
    input.signal.throwIfAborted()
    if (!this.options.url) throw new WebSearchProviderError('not-configured', '请为 SearXNG 保存一个已启用 JSON 的实例地址；也可选择免 Key Exa MCP')
    const url = new URL(this.options.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new WebSearchProviderError('rejected', 'SearXNG 实例地址无效')
    const pageNumber = input.cursor ? Number(input.cursor) : 1
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new WebSearchProviderError('rejected', 'SearXNG 上游页码无效')
    url.pathname = url.pathname.replace(/\/search\/?$/, '').replace(/\/$/, '') + '/search'
    url.search = new URLSearchParams({ q: input.query, format: 'json', pageno: String(pageNumber) }).toString()
    const attempt: SearchAttempt = { provider: 'searxng', outcome: 'not-sent' }
    try {
      attempt.outcome = 'unknown'
      const response = await (this.options.fetch ?? fetch)(url, { redirect: 'error', signal: input.signal, headers: { accept: 'application/json' } })
      const requestId = response.headers.get('x-request-id'); if (requestId) attempt.providerRequestId = requestId
      if (!response.ok) { attempt.outcome = 'rejected'; throw new Error(`SearXNG 返回 HTTP ${response.status}${response.status === 403 ? '；实例可能未启用 JSON' : response.status === 429 ? '；服务限流' : ''}`) }
      const payload = await response.json() as { results?: unknown[]; unresponsive_engines?: unknown[] }
      if (!Array.isArray(payload.results)) throw new Error('SearXNG 未返回 JSON results 列表')
      const results: WebSearchHit[] = [], seen = new Set<string>()
      for (const raw of payload.results) {
        const item = raw as { url?: unknown; title?: unknown; content?: unknown; publishedDate?: unknown }
        if (typeof item.url !== 'string') continue
        let parsed: URL; try { parsed = new URL(item.url) } catch { continue }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || seen.has(parsed.href)) continue
        seen.add(parsed.href); results.push({ url: parsed.href, title: typeof item.title === 'string' && item.title.trim() ? item.title : parsed.hostname,
          snippet: typeof item.content === 'string' ? item.content : '', ...(typeof item.publishedDate === 'string' ? { publishedAt: item.publishedDate } : {}) })
      }
      attempt.outcome = 'completed'
      return { provider: 'searxng', results, attempts: [attempt], ...(results.length ? { nextCursor: String(pageNumber + 1) } : {}),
        ...(payload.unresponsive_engines?.length ? { diagnostics: ['SearXNG 部分引擎未响应：' + JSON.stringify(payload.unresponsive_engines)] } : {}) }
    } catch (cause) {
      attempt.error = { code: input.signal.aborted ? 'search-aborted' : 'searxng-error', message: cause instanceof Error ? cause.message : 'SearXNG 搜索结果未知' }
      throw new WebSearchProviderError('failed', attempt.error.message, [attempt])
    }
  }
}
