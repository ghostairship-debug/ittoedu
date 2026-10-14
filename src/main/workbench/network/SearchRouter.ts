import { randomUUID } from 'node:crypto'
import { modelCapabilityRecord } from '../../../shared/workbench/modelCapabilities'
import type { ExecutionSettingsView, ExecutionRoleSelection } from '../../../shared/workbench/executionSettings'
import type { ModelSelection } from '../../../shared/workbench/modelProvider'
import { defaultSearchSettings, supportsOpenAISearch, type SearchSettings } from '../../../shared/workbench/searchSettings'
import type { SearchProviderPage } from '../../../shared/workbench/webSearch'
import { nativeSearchSelection } from './DeepSeekSearchProvider'
import { WebSearchProviderError, searchFailure } from './SearchProviderError'
import type { SearchProviderPort } from './WebResearchService'
export interface FrozenSearchSelection { settings: SearchSettings; profileRevision: number; openai: ModelSelection | null; deepseek: ModelSelection | null; diagnostic?: string }
export function freezeSearchSelection(view: ExecutionSettingsView, mainSelection?: ModelSelection): FrozenSearchSelection {
  const settings = structuredClone(view.profile.search ?? defaultSearchSettings())
  const select = (role: ExecutionRoleSelection | null, accepts: (selection: ModelSelection) => boolean): ModelSelection | null => {
    if (!role) return null
    const entry = view.connections.find(item => item.connection.id === role.connectionId && item.hasCredential && !item.revoked)
    const selection = entry ? { connection: structuredClone(entry.connection), model: role.model,
      ...(role.parameters ? { parameters: structuredClone(role.parameters) } : {}), ...(role.capabilityModel ? { capabilityModel: role.capabilityModel } : {}) } : null
    return selection && accepts(selection) ? selection : null
  }
  const mainUsable = mainSelection && supportsOpenAISearch(mainSelection.connection) && view.connections.some(item =>
    item.hasCredential && !item.revoked && item.connection.id === mainSelection.connection.id && item.connection.revision === mainSelection.connection.revision)
  let openai = settings.openai ? select(settings.openai, selection => supportsOpenAISearch(selection.connection))
    : mainUsable ? structuredClone(mainSelection) : null
  const unsupported = openai && modelCapabilityRecord(view.capabilityRecords ?? [], openai)?.facts.webSearch?.status === 'unsupported'
  if (unsupported) openai = null
  const deepseek = settings.mode === 'deepseek' ? settings.deepseek ? select(settings.deepseek, selection => {
    try { return selection.connection.provider === 'deepseek' && selection.connection.auth.kind === 'api-key' && new URL(selection.connection.baseURL).origin === 'https://api.deepseek.com' } catch { return false }
  }) : nativeSearchSelection(view) : null
  return { settings, profileRevision: view.profile.revision, openai, deepseek,
    ...(unsupported ? { diagnostic: '此连接修订与模型已明确不支持原生搜索；复用实际能力事实，未重新请求' } : settings.openai && !openai ? { diagnostic: '已选 OpenAI 搜索连接未接通或不是官方 Responses；不会切换另一条付费连接' } : {}) }
}
type Input = Parameters<SearchProviderPort['search']>[0]
interface Cursor { runId: string; query: string; backend: SearchProviderPort; page: SearchProviderPage; remaining: SearchProviderPage['results']; upstream?: string; seen: readonly string[]; more?: Promise<SearchProviderPage> }
export class SearchRouter implements SearchProviderPort {
  private readonly runs = new Map<string, FrozenSearchSelection>()
  private readonly cursors = new Map<string, Cursor>()
  constructor(private readonly providers: { openai: SearchProviderPort; deepseek: SearchProviderPort; independent(selection: FrozenSearchSelection): SearchProviderPort }) {}
  beginRun(runId: string, selection: FrozenSearchSelection): void { this.runs.set(runId, structuredClone(selection)) }
  endRun(runId: string): void { this.runs.delete(runId); for (const [key, value] of this.cursors) if (value.runId === runId) this.cursors.delete(key) }
  selection(runId: string): FrozenSearchSelection | undefined { return this.runs.get(runId) }
  private page(input: Input, backend: SearchProviderPort, source: SearchProviderPage, previousSeen: readonly string[] = []): SearchProviderPage {
    const seen = new Set(previousSeen), unique = source.results.filter(hit => !seen.has(hit.url))
    const delivered = unique.slice(0, input.limit), remaining = unique.slice(input.limit)
    for (const hit of delivered) seen.add(hit.url)
    const nextCursor = remaining.length || source.nextCursor ? randomUUID() : undefined
    if (nextCursor) this.cursors.set(nextCursor, { runId: input.runId ?? '', query: input.query, backend, page: source, remaining, upstream: source.nextCursor, seen: [...seen] })
    const { nextCursor: _upstream, ...data } = source
    return { ...data, results: delivered, ...(nextCursor ? { nextCursor } : {}) }
  }
  async search(input: Input): Promise<SearchProviderPage> {
    input.signal.throwIfAborted()
    const run = this.runs.get(input.runId ?? '')
    if (!run) throw new WebSearchProviderError('rejected', '搜索运行快照已结束或未授权')
    if (input.cursor) {
      const cursor = this.cursors.get(input.cursor)
      if (!cursor || cursor.runId !== input.runId || cursor.query !== input.query) throw new WebSearchProviderError('rejected', '搜索续页句柄已失效或不属于本次查询；未重新发送搜索')
      if (cursor.remaining.length) return this.page(input, cursor.backend, { ...cursor.page, results: cursor.remaining, nextCursor: cursor.upstream }, cursor.seen)
      if (!cursor.upstream) return { ...cursor.page, results: [], nextCursor: undefined }
      try {
        cursor.more ??= cursor.backend.search({ ...input, cursor: cursor.upstream })
        const more = await cursor.more
        return this.page(input, cursor.backend, { ...more, attempts: [...cursor.page.attempts ?? [], ...more.attempts ?? []] }, cursor.seen)
      } catch (cause) { throw searchFailure(cause, cursor.page.attempts) }
    }
    if (run.settings.mode === 'off') throw new WebSearchProviderError('not-configured', '联网搜索已关闭；仍可使用 web.open 读取已知 URL')
    const independent = () => this.providers.independent(run)
    let backend: SearchProviderPort
    if (run.settings.mode === 'openai') backend = this.providers.openai
    else if (run.settings.mode === 'deepseek') backend = this.providers.deepseek
    else if (run.settings.mode === 'independent' || !run.openai) backend = independent()
    else backend = this.providers.openai
    try {
      const page = await backend.search(input)
      if (run.diagnostic && run.settings.mode === 'auto') page.diagnostics = [...page.diagnostics ?? [], run.diagnostic]
      return this.page(input, backend, page)
    } catch (cause) {
      if (run.settings.mode !== 'auto' || backend !== this.providers.openai || input.signal.aborted) throw cause
      const failed = searchFailure(cause)
      input.signal.throwIfAborted()
      backend = independent()
      try {
        const page = await backend.search(input)
        return this.page(input, backend, { ...page, attempts: [...failed.attempts, ...page.attempts ?? []], diagnostics: [...page.diagnostics ?? [], failed.message] })
      } catch (fallback) { throw searchFailure(fallback, failed.attempts) }
    }
  }
}
