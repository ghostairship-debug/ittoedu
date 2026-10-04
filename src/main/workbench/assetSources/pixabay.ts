import { createHash } from 'node:crypto'
import { AssetHttpError, LibraryUnavailableError, MIN_IMAGE_WIDTH, isRecord, positiveInteger, type AssetHttpPort, type ImageSearchInput, type ImageSearchPage, type OpenImageCandidate } from './assetSourceTypes'
import { cleanText, httpUrl, pixabayLicense } from './licensePolicy'

export const PIXABAY_API = 'https://pixabay.com/api/'
/** Pixabay terms: search requests are cached for 24 hours; by default at most 100 requests per 60 seconds. */
export const PIXABAY_CACHE_MS = 24 * 60 * 60_000
export const PIXABAY_RATE = { requests: 100, windowMs: 60_000 }

const hasCjk = (text: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(text)

function candidate(raw: unknown): OpenImageCandidate | null {
  if (!isRecord(raw)) return null
  const id = positiveInteger(raw.id)
  // largeImageURL (up to 1280 px) is available without full API access; full HD and originals are not used.
  const fileUrl = httpUrl(raw.largeImageURL) ?? httpUrl(raw.webformatURL)
  const pageUrl = httpUrl(raw.pageURL)
  const width = positiveInteger(raw.imageWidth), height = positiveInteger(raw.imageHeight)
  if (!id || !fileUrl || !pageUrl || (width !== undefined && width < MIN_IMAGE_WIDTH)) return null
  const tags = cleanText(raw.tags, 200), author = cleanText(raw.user, 120), previewUrl = httpUrl(raw.webformatURL)
  return { library: 'pixabay', providerId: String(id), title: tags ?? 'Pixabay 图片', ...(author ? { author } : {}), license: pixabayLicense,
    sourceName: 'Pixabay', pageUrl, fileUrl, ...(previewUrl ? { previewUrl } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}),
    ...(tags ? { description: `标签：${tags}` } : {}) }
}

/** Pixabay image search; the caller supplies the key and caches each request for 24 hours. */
export async function searchPixabay(http: AssetHttpPort, key: string, input: ImageSearchInput): Promise<ImageSearchPage> {
  const url = new URL(PIXABAY_API)
  url.searchParams.set('key', key)
  url.searchParams.set('q', input.query.slice(0, 100))
  url.searchParams.set('lang', hasCjk(input.query) ? 'zh' : 'en')
  url.searchParams.set('image_type', 'all')
  url.searchParams.set('safesearch', 'true')
  // Pixabay pages hold at least 3 results.
  url.searchParams.set('per_page', String(Math.max(3, input.limit)))
  url.searchParams.set('page', String(input.page))
  let body: unknown
  try { body = await http.getJson(url.href, { signal: input.signal, headers: { Accept: 'application/json' } }) }
  catch (cause) {
    if (cause instanceof AssetHttpError && cause.status === 429)
      throw new AssetHttpError('Pixabay 访问过于频繁（每分钟最多 100 次），请稍后再试', 429)
    if (cause instanceof AssetHttpError && (cause.status === 400 || cause.status === 401 || cause.status === 403))
      throw new AssetHttpError('Pixabay 拒绝了请求，API key 可能无效；请在设置中检查 Pixabay API key', cause.status)
    throw cause
  }
  if (!isRecord(body) || !Array.isArray(body.hits)) throw new AssetHttpError('Pixabay 返回了无法识别的检索结果')
  const hits = body.hits.slice(0, input.limit)
  const candidates = hits.flatMap(raw => candidate(raw) ?? [])
  const total = positiveInteger(body.totalHits) ?? 0
  return { library: 'pixabay', candidates, excluded: hits.length - candidates.length, hasMore: total > input.page * Math.max(3, input.limit) }
}

/**
 * Pixabay as an image.search source: the key is looked up per search (the user's own, else the bundled one);
 * identical requests are answered from a 24-hour cache, and the 100-per-minute limit is kept locally too.
 */
export class PixabaySource {
  private readonly cache = new Map<string, { at: number; page: ImageSearchPage }>()
  private readonly recent: number[] = []
  private readonly now: () => number
  constructor(private readonly options: { key: () => Promise<string | undefined>; now?: () => number }) {
    this.now = options.now ?? Date.now
  }

  readonly search = async (http: AssetHttpPort, input: ImageSearchInput): Promise<ImageSearchPage> => {
    const key = await this.options.key()
    if (!key) throw new LibraryUnavailableError('未配置 Pixabay API key，本次未检索 Pixabay')
    const now = this.now()
    for (const [entry, value] of this.cache) if (now - value.at >= PIXABAY_CACHE_MS) this.cache.delete(entry)
    const cacheKey = JSON.stringify([createHash('sha256').update(key).digest('hex').slice(0, 16), input.query, input.limit, input.page])
    const cached = this.cache.get(cacheKey)
    if (cached) return cached.page
    while (this.recent.length && now - this.recent[0]! >= PIXABAY_RATE.windowMs) this.recent.shift()
    if (this.recent.length >= PIXABAY_RATE.requests) throw new AssetHttpError('已达到 Pixabay 每分钟 100 次的访问上限，请约 1 分钟后再试', 429)
    this.recent.push(now)
    const page = await searchPixabay(http, key, input)
    this.cache.set(cacheKey, { at: now, page })
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!)
    return page
  }
}
