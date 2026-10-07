import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractHtml } from './extractHtml'
import { fetchPublicResource, parsePublicUrl, PublicHttpError, type PublicHttpResponse } from './publicHttp'
import type { AttachmentService } from '../attachments/AttachmentService'
import type { AttachmentSnapshot } from '../../../shared/workbench/attachments'

export interface WebSearchHit {
  title: string
  url: string
  /** Provider snippet only. It is never labelled as opened page content. */
  snippet: string
  publishedAt?: string
}

export interface SearchProviderPage {
  provider: string
  results: readonly WebSearchHit[]
  nextCursor?: string
  providerRequestId?: string
  /** Provider-reported charge only; absent remains unknown. */
  charge?: { amount: number; currency: string }
  /** Provider execution view: which authorized connection/model actually ran, with provider-reported usage. */
  execution?: { connectionId: string; model: string; billingKind?: string; inputTokens?: number; outputTokens?: number }
}

/** Credentials and billing live in the existing Connection owner, not tool output. */
export interface SearchProviderPort {
  search(input: { runId?: string; query: string; limit: number; cursor?: string; signal: AbortSignal }): Promise<SearchProviderPage>
}

export type WebSearchResult =
  | { status: 'results'; query: string; searchedAt: string; provider: string; results: readonly WebSearchHit[]; nextCursor?: string;
      providerRequestId?: string; charge?: SearchProviderPage['charge']; execution?: SearchProviderPage['execution'] }
  | { status: 'not-configured' | 'rejected' | 'failed'; reason: string }

export interface WebSource {
  sourceId: string
  url: string
  title: string
  fetchedAt: string
  publishedAt?: string
  contentType: string
  /** Hash of the extracted source text, not of a model summary. */
  version: string
  bodyComplete: true
}

export type WebOpenResult =
  | { status: 'opened'; source: WebSource; text: string; offset: number; nextOffset?: number; truncated: boolean }
  | WebMaterialResult
  | { status: 'access-required' | 'needs-material-reader' | 'failed' | 'rejected'; reason: string; url?: string }

export interface WebMaterialResult {
  status: 'material'
  source: Omit<WebSource, 'bodyComplete'>
  attachmentIds: string[]
  material: { attachmentId: string; originalAttachmentId: string; derivedFrom?: string; originalDigest: string;
    coverage?: AttachmentSnapshot['coverage']; gaps: AttachmentSnapshot['gaps']; extractionError?: string }
  observation: 'index-only'
  next: 'material.list / material.read / material.find / material.extract'
}
interface StoredSource { source: WebSource; filename: string }
interface RunState { stopped: boolean; controllers: Set<AbortController>; sources: Map<string, StoredSource>;
  materials: Map<string, WebMaterialResult>; directory?: Promise<string> }

export interface WebResearchOptions {
  searchProvider?: SearchProviderPort
  /** Test seam; the production default always uses pinned-DNS public HTTP. */
  fetch?: typeof fetchPublicResource
  now?: () => Date
  temporaryRoot?: string
  /** The same immutable material owner used by local attachments and shared tools. */
  materials?: AttachmentService
}

export class WebResearchService {
  private readonly runs = new Map<string, RunState>()
  private readonly fetch: typeof fetchPublicResource
  private readonly now: () => Date
  constructor(private readonly options: WebResearchOptions = {}) {
    this.fetch = options.fetch ?? fetchPublicResource
    this.now = options.now ?? (() => new Date())
  }

  beginRun(runId: string): void {
    if (this.runs.has(runId)) throw new Error('联网研究任务已开始')
    this.runs.set(runId, { stopped: false, controllers: new Set(), sources: new Map(), materials: new Map() })
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run || run.stopped) return
    run.stopped = true
    for (const controller of run.controllers) controller.abort()
    run.sources.clear()
    run.materials.clear()
    const directory = await run.directory?.catch(() => null)
    if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })
  }

  endRun(runId: string): void { void this.stopRun(runId).catch(() => undefined); this.runs.delete(runId) }

  private requireRun(runId: string): RunState {
    const run = this.runs.get(runId)
    if (!run) throw new Error('联网研究任务尚未授权')
    return run
  }

  private async call<T>(run: RunState, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (run.stopped || signal?.aborted) throw new PublicHttpError('cancelled', '任务已停止')
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    run.controllers.add(controller)
    try {
      const result = await work(controller.signal)
      if (run.stopped || controller.signal.aborted) throw new PublicHttpError('cancelled', '任务已停止')
      return result
    } finally { run.controllers.delete(controller); signal?.removeEventListener('abort', onAbort) }
  }

  async search(input: { runId: string; query: string; limit?: number; cursor?: string; signal?: AbortSignal }): Promise<WebSearchResult> {
    const run = this.requireRun(input.runId)
    if (!input.query?.trim())
      return { status: 'rejected', reason: '检索词或分页游标无效' }
    const limit = input.limit ?? 5
    if (!Number.isSafeInteger(limit) || limit < 1) return { status: 'rejected', reason: '单页结果数量须为正整数' }
    if (run.stopped) return { status: 'rejected', reason: '任务已停止' }
    const provider = this.options.searchProvider
    if (!provider) return { status: 'not-configured', reason: '未配置已授权且可用的联网搜索连接' }
    try {
      const page = await this.call(run, input.signal, signal => provider.search({ runId: input.runId, query: input.query.trim(), limit,
        ...(input.cursor ? { cursor: input.cursor } : {}), signal }))
      const results = page.results.slice(0, limit).flatMap(result => {
        try {
          const url = parsePublicUrl(result.url).href
          if (!result.title?.trim()) return []
          const snippet = result.snippet ?? ''
          return [{ title: result.title, url, snippet,
            ...(result.publishedAt && !Number.isNaN(Date.parse(result.publishedAt)) ? { publishedAt: result.publishedAt } : {}) }]
        } catch { return [] }
      })
      return { status: 'results', query: input.query.trim(), searchedAt: this.now().toISOString(), provider: page.provider,
        results, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        ...(page.providerRequestId ? { providerRequestId: page.providerRequestId } : {}),
        ...(page.execution ? { execution: page.execution } : {}),
        ...(page.charge ? { charge: page.charge } : {}) }
    } catch (cause) {
      const known = cause instanceof Error && 'status' in cause ? (cause as { status?: string }).status : undefined
      const status: 'not-configured' | 'rejected' | 'failed' = known === 'not-configured' || known === 'rejected' ? known : 'failed'
      return { status, reason: cause instanceof Error ? cause.message : '联网搜索未完成；不会自动重发' }
    }
  }

  async open(input: { runId: string; url?: string; sourceId?: string; version?: string; offset?: number; limit?: number;
    signal?: AbortSignal }): Promise<WebOpenResult> {
    const run = this.requireRun(input.runId)
    const offset = input.offset ?? 0, limit = input.limit ?? 7000
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
      return { status: 'rejected', reason: '正文读取范围无效' }
    if (run.stopped || input.signal?.aborted) return { status: 'rejected', reason: '任务已停止' }
    const materialSources = run.materials
    const priorMaterial = input.sourceId ? materialSources.get(input.sourceId) : undefined
    if (priorMaterial) {
      if (input.version && input.version !== priorMaterial.source.version) return { status: 'rejected', reason: '材料来源版本已改变' }
      return structuredClone(priorMaterial)
    }
    let stored = input.sourceId ? run.sources.get(input.sourceId) : undefined
    if (input.sourceId && !stored && !input.url) return { status: 'rejected', reason: '原网页正文缓存已失效，请使用来源 URL 与版本重新读取' }
    if (stored && input.version && stored.source.version !== input.version) return { status: 'rejected', reason: '正文来源版本已改变' }
    if (!stored) {
      if (!input.url) return { status: 'rejected', reason: '需要网页 URL 或本任务来源句柄' }
      try {
        const requestedUrl = parsePublicUrl(input.url).href
        const response: PublicHttpResponse = await this.call(run, input.signal, signal => this.fetch(requestedUrl, { signal }))
        const url = response.url
        if (response.contentType === 'application/pdf' || response.contentType === 'application/octet-stream'
          || response.contentType === 'application/zip' || response.contentType.startsWith('application/vnd.openxmlformats-officedocument.')) {
          if (!this.options.materials) return { status: 'needs-material-reader', reason: '此 URL 返回文件；材料读取服务未接通', url }
          const version = createHash('sha256').update(response.bytes).digest('hex')
          if (input.version && version !== input.version) return { status: 'rejected', reason: '材料原件与此前引用版本不一致', url }
          const captured = await this.call(run, input.signal, signal => this.options.materials!.receivePublicFile({
            url, bytes: response.bytes, contentType: response.contentType }, { signal }))
          const material = captured.material
          const result: WebMaterialResult = { status: 'material', source: { sourceId: randomUUID(), url,
            title: captured.original.name, fetchedAt: this.now().toISOString(), contentType: response.contentType, version },
            attachmentIds: [...new Set([captured.original.id, material.id])],
            material: { attachmentId: material.id, originalAttachmentId: captured.original.id,
              ...(material.derivedFrom ? { derivedFrom: material.derivedFrom } : {}), originalDigest: material.digest,
              ...(material.coverage ? { coverage: material.coverage } : {}), gaps: material.gaps,
              ...(captured.extractionError ? { extractionError: captured.extractionError } : {}) },
            observation: 'index-only', next: 'material.list / material.read / material.find / material.extract' }
          materialSources.set(result.source.sourceId, result)
          return structuredClone(result)
        }
        if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(response.contentType))
          return { status: 'failed', reason: `不支持将 ${response.contentType} 当作网页正文`, url }
        let raw: string
        try { raw = new TextDecoder(response.charset || 'utf-8', { fatal: true }).decode(response.bytes) }
        catch { return { status: 'failed', reason: '网页字符集无法可靠解码', url } }
        const extracted = response.contentType === 'text/plain'
          ? { title: new URL(url).hostname, text: raw.trim(), accessRequired: false as const }
          : extractHtml(raw, url)
        if (extracted.accessRequired) return { status: 'access-required', reason: '该页面需要登录或访问授权，未取得正文', url }
        if (!extracted.text.trim()) return { status: 'failed', reason: '网页未返回可读取正文', url }
        const version = createHash('sha256').update(extracted.text).digest('hex')
        if (input.version && version !== input.version) return { status: 'rejected', reason: '网页正文与此前引用版本不一致', url }
        const source: WebSource = { sourceId: randomUUID(), url, title: extracted.title || new URL(url).hostname,
          fetchedAt: this.now().toISOString(), contentType: response.contentType, version, bodyComplete: true,
          ...('publishedAt' in extracted && extracted.publishedAt ? { publishedAt: extracted.publishedAt } : {}) }
        // Immutable text is task-backed on disk; opening source 41 is not a quota event.
        if (run.stopped || input.signal?.aborted) return { status: 'rejected', reason: '任务已停止' }
        run.directory ??= fs.mkdtemp(path.join(this.options.temporaryRoot ?? os.tmpdir(), 'guoling-web-sources-'))
        const directory = await run.directory
        if (run.stopped || input.signal?.aborted) return { status: 'rejected', reason: '任务已停止' }
        const filename = path.join(directory, source.sourceId)
        await fs.writeFile(filename, extracted.text, { encoding: 'utf8', flag: 'wx' })
        if (run.stopped || input.signal?.aborted) {
          await fs.rm(filename, { force: true })
          return { status: 'rejected', reason: '任务已停止' }
        }
        stored = { source, filename }
        run.sources.set(source.sourceId, stored)
      } catch (cause) {
        if (run.stopped || input.signal?.aborted || cause instanceof PublicHttpError && cause.code === 'cancelled')
          return { status: 'rejected', reason: '任务已停止' }
        return { status: 'failed', reason: cause instanceof Error ? cause.message : '网页读取未完成' }
      }
    }
    let body: string
    try { body = await fs.readFile(stored.filename, 'utf8') }
    catch { return { status: 'failed', reason: '网页来源缓存无法读取，请使用原 URL 与版本重新读取' } }
    if (run.stopped || input.signal?.aborted) return { status: 'rejected', reason: '任务已停止' }
    const text = body.slice(offset, offset + limit), nextOffset = offset + text.length
    return { status: 'opened', source: stored.source, text, offset, truncated: nextOffset < body.length,
      ...(nextOffset < body.length ? { nextOffset } : {}) }
  }
}
