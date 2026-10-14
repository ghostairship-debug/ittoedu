import { randomUUID } from 'node:crypto'
import { McpClientService, type McpClientOptions, type McpCallResult } from '../externalTools/McpClientService'
import type { SearchAttempt, SearchProviderPage, WebSearchHit } from '../../../shared/workbench/webSearch'
import type { SearchProviderPort } from './WebResearchService'
import { WebSearchProviderError } from './SearchProviderError'
export const EXA_SEARCH_ENDPOINT = 'https://mcp.exa.ai/mcp'
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/** Only the documented result records count as sources; arbitrary URLs in prose do not. */
export function parseExaResults(reply: Extract<McpCallResult, { status: 'returned' }>): WebSearchHit[] {
  const results: WebSearchHit[] = [], seen = new Set<string>()
  const add = (item: Record<string, unknown>) => {
    if (typeof item.url !== 'string') return
    let url: URL; try { url = new URL(item.url) } catch { return }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) return
    seen.add(url.href); results.push({ url: url.href, title: typeof item.title === 'string' && item.title.trim() ? item.title : url.hostname,
      snippet: typeof item.snippet === 'string' ? item.snippet : typeof item.text === 'string' ? item.text : '',
      ...(typeof item.publishedDate === 'string' && !Number.isNaN(Date.parse(item.publishedDate)) ? { publishedAt: item.publishedDate } : {}) })
  }
  if (object(reply.structuredContent) && Array.isArray(reply.structuredContent.results)) for (const item of reply.structuredContent.results) if (object(item)) add(item)
  for (const block of reply.content) if (block.type === 'text') {
    try { const json = JSON.parse(block.text); if (object(json) && Array.isArray(json.results)) { for (const item of json.results) if (object(item)) add(item); continue } } catch { /* Exa also returns labelled text records. */ }
    const records = block.text.split(/(?:^|\n)Title: /).slice(1)
    for (const record of records) {
      const title = record.split('\n', 1)[0].trim(), url = /^URL: (.+)$/m.exec(record)?.[1].trim()
      if (!url) continue
      const snippet = /^(?:Highlights|Text|Content):[ \t]*(?:\n)?([\s\S]*)/m.exec(record)?.[1].replace(/\n---\s*$/, '').trim() ?? ''
      const publishedDate = /^(?:Published|Published Date): (.+)$/m.exec(record)?.[1].trim()
      add({ title, url, snippet, publishedDate })
    }
  }
  return results
}
export class McpSearchProvider implements SearchProviderPort {
  constructor(private readonly options: { connect?: McpClientOptions['connect'] } = {}) {}
  async search(input: Parameters<SearchProviderPort['search']>[0]): Promise<SearchProviderPage> {
    input.signal.throwIfAborted()
    if (input.cursor) throw new WebSearchProviderError('rejected', 'Exa MCP 没有上游分页；只能消费本次已返回的余项')
    const runId = randomUUID(), attempt: SearchAttempt = { provider: 'exa-mcp', outcome: 'not-sent' }
    const client = new McpClientService({ connection: { namespace: 'exa', transport: { kind: 'streamable-http', endpoint: EXA_SEARCH_ENDPOINT },
      tools: [{ name: 'web_search_exa', effect: 'read' }] }, ...(this.options.connect ? { connect: this.options.connect } : {}) })
    client.beginRun(runId, { allowedTools: ['web_search_exa'], writeAllowed: false })
    const stop = () => { void client.stopRun(runId) }
    input.signal.addEventListener('abort', stop, { once: true })
    try {
      const discovery = await client.discover(runId, input.signal)
      if (discovery.status !== 'available') throw new Error(discovery.reason)
      const tool = discovery.tools.find(tool => tool.remoteName === 'web_search_exa')
      if (!tool) throw new Error('Exa 未公开 web_search_exa 工具')
      const properties = object(tool.inputSchema.properties) ? tool.inputSchema.properties : {}
      const args: Record<string, unknown> = { query: input.query }
      if ('numResults' in properties) args.numResults = input.limit
      if ('objective' in properties) args.objective = 'Find relevant web sources for this query: ' + input.query
      input.signal.throwIfAborted(); attempt.outcome = 'unknown'
      const reply = await client.invoke({ runId, operationId: randomUUID(), name: tool.name, arguments: args, signal: input.signal })
      input.signal.throwIfAborted()
      if (reply.status !== 'returned') { attempt.outcome = reply.status === 'rejected' ? 'rejected' : 'unknown'; throw new Error(reply.reason) }
      const results = parseExaResults(reply)
      const content = reply.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (!results.length && content.trim() && !/no results|no relevant|0 results|no matches/i.test(content)) throw new Error('Exa 返回内容未包含可解析的来源记录')
      attempt.outcome = 'completed'
      return { provider: 'exa-mcp', results, attempts: [attempt], ...(reply.truncated ? { diagnostics: ['Exa 返回部分内容；不代表全部来源覆盖'] } : {}) }
    } catch (cause) {
      attempt.error = { code: input.signal.aborted ? 'search-aborted' : 'exa-mcp-error', message: cause instanceof Error ? cause.message : 'Exa 搜索未完成' }
      throw new WebSearchProviderError('failed', attempt.error.message, [attempt])
    } finally { input.signal.removeEventListener('abort', stop); await client.endRun(runId) }
  }
}
