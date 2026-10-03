import { AssetHttpError, MIN_IMAGE_WIDTH, isRecord, positiveInteger, type AssetHttpPort, type ImageSearchInput, type ImageSearchPage, type OpenImageCandidate } from './assetSourceTypes'
import { cleanText, httpUrl, openverseLicense, openverseLicenseFilter } from './licensePolicy'

export const OPENVERSE_IMAGES_API = 'https://api.openverse.org/v1/images/'

const sourceNames: Record<string, string> = {
  flickr: 'Flickr', wikimedia: 'Wikimedia Commons', nasa: 'NASA', europeana: 'Europeana', met: 'The Met',
  geographorg: 'Geograph', rawpixel: 'rawpixel', stocksnap: 'StockSnap', clevelandmuseum: 'Cleveland Museum of Art',
}

/** Openverse 的 source 标识转为站点名称。 */
export function openverseSourceName(source: unknown): string {
  const key = typeof source === 'string' ? source.trim().toLowerCase() : ''
  if (!key) return 'Openverse'
  if (sourceNames[key]) return sourceNames[key]!
  if (key.startsWith('smithsonian')) return 'Smithsonian'
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

/** 托管在 upload.wikimedia.org 的 Commons 文件，由文件名得到文件页标题。 */
export function commonsTitleFromFileUrl(fileUrl: string): string | undefined {
  try {
    const url = new URL(fileUrl)
    if (url.hostname !== 'upload.wikimedia.org' || !url.pathname.startsWith('/wikipedia/commons/')) return undefined
    const name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '')
    return name ? `File:${name.replaceAll('_', ' ')}` : undefined
  } catch { return undefined }
}

function candidate(raw: unknown, input: ImageSearchInput): OpenImageCandidate | null {
  if (!isRecord(raw) || raw.mature === true) return null
  const id = cleanText(raw.id, 100)
  const fileUrl = httpUrl(raw.url)
  const license = openverseLicense(raw.license, raw.license_version, raw.license_url, input)
  const width = positiveInteger(raw.width), height = positiveInteger(raw.height)
  if (!id || !fileUrl || !license || (width !== undefined && width < MIN_IMAGE_WIDTH)) return null
  const author = cleanText(raw.creator, 120), commonsTitle = commonsTitleFromFileUrl(fileUrl)
  // Openverse 代理 Commons 文件的缩略图会失败（HTTP 424），这类文件改向 Commons 取预览。
  const previewUrl = commonsTitle ? undefined : httpUrl(raw.thumbnail)
  const tags = Array.isArray(raw.tags) ? raw.tags.flatMap(tag => isRecord(tag) ? cleanText(tag.name, 40) ?? [] : []).slice(0, 10) : []
  return { library: 'openverse', providerId: id, title: cleanText(raw.title, 200) ?? '未命名图片',
    ...(author ? { author } : {}), license, sourceName: openverseSourceName(raw.source ?? raw.provider),
    pageUrl: httpUrl(raw.foreign_landing_url) ?? `https://openverse.org/image/${encodeURIComponent(id)}`,
    fileUrl, ...(previewUrl ? { previewUrl } : {}), ...(commonsTitle ? { commonsTitle } : {}),
    ...(width ? { width } : {}), ...(height ? { height } : {}),
    ...(tags.length ? { description: `标签：${tags.join('、')}` } : {}) }
}

/** Openverse 图片检索：免费、无需账号；授权在请求参数和逐条结果上同时按策略限定。 */
export async function searchOpenverse(http: AssetHttpPort, input: ImageSearchInput): Promise<ImageSearchPage> {
  const url = new URL(OPENVERSE_IMAGES_API)
  url.searchParams.set('q', input.query)
  url.searchParams.set('license', openverseLicenseFilter(input))
  url.searchParams.set('page_size', String(input.limit))
  url.searchParams.set('page', String(input.page))
  let body: unknown
  try { body = await http.getJson(url.href, { signal: input.signal, headers: { Accept: 'application/json' } }) }
  catch (cause) {
    if (cause instanceof AssetHttpError && cause.status === 429)
      throw new AssetHttpError('Openverse 匿名访问次数已达上限，请稍后再试；Wikimedia Commons 不受影响', 429)
    throw cause
  }
  if (!isRecord(body) || !Array.isArray(body.results)) throw new AssetHttpError('Openverse 返回了无法识别的检索结果')
  const candidates = body.results.flatMap(raw => candidate(raw, input) ?? [])
  const pageCount = positiveInteger(body.page_count) ?? 0
  return { library: 'openverse', candidates, excluded: body.results.length - candidates.length, hasMore: pageCount > input.page }
}
