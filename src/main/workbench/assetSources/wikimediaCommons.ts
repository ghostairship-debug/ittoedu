import { AssetHttpError, MIN_IMAGE_WIDTH, isRecord, positiveInteger, type AssetHttpPort, type ImageSearchInput, type ImageSearchPage, type OpenImageCandidate } from './assetSourceTypes'
import { cleanText, commonsLicense, htmlText, httpUrl } from './licensePolicy'

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
/** 预览请求的宽度；Commons 会就近换成标准尺寸。 */
const PREVIEW_WIDTH = 400
const metadataFields = 'License|LicenseShortName|LicenseUrl|Artist|ImageDescription|ObjectName'

async function query(http: AssetHttpPort, params: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = new URL(COMMONS_API)
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', ...params })) url.searchParams.set(key, value)
  const body = await http.getJson(url.href, { signal, headers: { Accept: 'application/json' } })
  if (!isRecord(body)) throw new AssetHttpError('Wikimedia Commons 返回了无法识别的结果')
  if (isRecord(body.error)) throw new AssetHttpError(`Wikimedia Commons 拒绝了请求：${cleanText(body.error.info, 200) ?? '未知原因'}`)
  return body
}

const pagesOf = (body: Record<string, unknown>): unknown[] =>
  isRecord(body.query) && Array.isArray(body.query.pages) ? body.query.pages : []

/** Commons 文件地址带统计参数；去掉后用于记录与去重。 */
function plainUrl(value: unknown): string | undefined {
  const href = httpUrl(value)
  if (!href) return undefined
  const url = new URL(href)
  url.search = ''
  return url.href
}

const metaValue = (meta: Record<string, unknown>, key: string): unknown => {
  const entry = meta[key]
  return isRecord(entry) ? entry.value : undefined
}

function candidate(page: unknown, input: ImageSearchInput): OpenImageCandidate | null {
  if (!isRecord(page) || typeof page.title !== 'string') return null
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined
  if (!isRecord(info)) return null
  const meta = isRecord(info.extmetadata) ? info.extmetadata : {}
  const license = commonsLicense({ key: metaValue(meta, 'License'), shortName: metaValue(meta, 'LicenseShortName'),
    url: metaValue(meta, 'LicenseUrl') }, input)
  const fileUrl = plainUrl(info.url)
  const width = positiveInteger(info.width), height = positiveInteger(info.height)
  // 矢量图在任意尺寸下都清晰，不按像素宽度排除。
  const vector = info.mime === 'image/svg+xml'
  if (!license || !fileUrl || (!vector && width !== undefined && width < MIN_IMAGE_WIDTH)) return null
  const name = page.title.replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '')
  const author = htmlText(metaValue(meta, 'Artist'), 120), description = htmlText(metaValue(meta, 'ImageDescription'), 300)
  const previewUrl = httpUrl(info.thumburl)
  return { library: 'wikimedia-commons', providerId: String(page.pageid ?? page.title),
    title: htmlText(metaValue(meta, 'ObjectName'), 200) ?? cleanText(name, 200) ?? '未命名图片',
    ...(author ? { author } : {}), license, sourceName: 'Wikimedia Commons',
    pageUrl: plainUrl(info.descriptionurl) ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`,
    fileUrl, ...(previewUrl ? { previewUrl } : {}), commonsTitle: page.title,
    ...(width ? { width } : {}), ...(height ? { height } : {}), ...(description ? { description } : {}) }
}

/** Wikimedia Commons 文件检索（MediaWiki API）：只查图片与矢量图，按检索相关度排序。 */
export async function searchCommons(http: AssetHttpPort, input: ImageSearchInput): Promise<ImageSearchPage> {
  const body = await query(http, { generator: 'search', gsrsearch: `${input.query} filetype:bitmap|drawing`, gsrnamespace: '6',
    gsrlimit: String(input.limit), gsroffset: String((input.page - 1) * input.limit), prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(PREVIEW_WIDTH), iiextmetadatafilter: metadataFields,
    iiextmetadatalanguage: 'zh' }, input.signal)
  const pages = pagesOf(body)
  const rank = (page: unknown) => isRecord(page) && typeof page.index === 'number' ? page.index : Number.MAX_SAFE_INTEGER
  const candidates = [...pages].sort((left, right) => rank(left) - rank(right)).flatMap(page => candidate(page, input) ?? [])
  return { library: 'wikimedia-commons', candidates, excluded: pages.length - candidates.length, hasMore: isRecord(body.continue) }
}

/** 取 Commons 文件约 width 宽的版本：原图更小时就是原图，矢量图为 PNG 渲染。 */
export async function commonsRendition(http: AssetHttpPort, title: string, width: number, signal?: AbortSignal): Promise<string> {
  const body = await query(http, { titles: title, prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: String(width) }, signal)
  const page = pagesOf(body)[0]
  const info = isRecord(page) && Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined
  const url = isRecord(info) ? httpUrl(info.thumburl) ?? httpUrl(info.url) : undefined
  if (!url) throw new AssetHttpError('Wikimedia Commons 上已找不到该文件')
  return url
}
