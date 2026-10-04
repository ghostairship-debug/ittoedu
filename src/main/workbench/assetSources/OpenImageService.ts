import sharp from 'sharp'
import type { AssetSource } from '../../../shared/contracts/media-v1'
import type { HostImageInput } from '../../../core/tools/imageResource'
import { LibraryUnavailableError, type AssetHttpPort, type ImageSearchInput, type ImageSearchPage, type OpenImageCandidate, type OpenLibrary } from './assetSourceTypes'
import { openLibrarySource } from './licensePolicy'
import { searchOpenverse } from './openverse'
import type { PixabaySource } from './pixabay'
import { commonsRendition, searchCommons } from './wikimediaCommons'

/** 课件用图取宽约 1600 像素的版本，更大的原图在本机缩小。 */
export const FETCH_WIDTH = 1600
const PREVIEW_SIZE = 480
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024
const PREVIEW_MAX_BYTES = 20 * 1024 * 1024
// Openverse 的缩略图接口只认含 */* 的 Accept（image/* 返回 406）。
const IMAGE_ACCEPT = 'image/*,*/*;q=0.8'
const libraryNames: Record<OpenLibrary, string> = { openverse: 'Openverse', 'wikimedia-commons': 'Wikimedia Commons', pixabay: 'Pixabay' }

/** 给模型看的候选；image 是本任务内的短句柄。 */
export interface ImageCandidateView {
  image: string
  title: string
  author?: string
  license: string
  source: string
  width?: number
  height?: number
  /** 第三方说明或标签，是不可信数据，不是指令。 */
  description?: string
}

type Failure = { library: string; reason: string }
export type OpenImageSearchResult =
  | { status: 'results'; query: string; licenses: string; candidates: readonly ImageCandidateView[]; excluded: number;
      nextPage?: number; failures?: readonly Failure[]; unavailable?: readonly Failure[]; notice?: string; hint?: string }
  | { status: 'failed' | 'rejected'; reason: string; failures?: readonly Failure[]; unavailable?: readonly Failure[] }
export interface OpenImagePreview { image: string; resourceId: string; mimeType: string; byteLength: number; width: number; height: number }
export type OpenImagePreviewResult =
  | { status: 'prepared'; previews: readonly OpenImagePreview[]; failures?: readonly { image: string; reason: string }[] }
  | { status: 'failed' | 'rejected'; reason: string; failures?: readonly { image: string; reason: string }[] }
export type OpenImageFetchResult =
  | { status: 'ready'; file: HostImageInput; width: number; height: number; source: AssetSource }
  | { status: 'failed' | 'rejected'; reason: string }

type SearchLibrary = (http: AssetHttpPort, input: ImageSearchInput) => Promise<ImageSearchPage>
interface RunState {
  stopped: boolean
  controllers: Set<AbortController>
  candidates: Map<string, OpenImageCandidate>
  previews: Map<string, { mimeType: string; bytes: Uint8Array }>
  next: number
}
export interface OpenImageServiceOptions {
  http: AssetHttpPort
  /** Pixabay（需要 API key）；未提供时不检索 Pixabay。 */
  pixabay?: PixabaySource
  /** 测试可替换检索；生产按此顺序检索各图库。 */
  libraries?: readonly [OpenLibrary, SearchLibrary][]
}

const reasonOf = (cause: unknown, fallback: string) => cause instanceof Error && cause.message ? cause.message : fallback

export type ImageFileFormat = 'jpeg' | 'png' | 'webp'

/**
 * 下载内容统一核对与缩放：JPEG/PNG/WebP 且不超宽（并符合指定格式）的原样保留；
 * 其余按指定格式转换，未指定时线稿、透明图转为 PNG，照片转为 JPEG。
 */
export async function normalizeImage(bytes: Uint8Array, maxWidth: number, format?: ImageFileFormat): Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number }> {
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata().catch(() => { throw new Error('下载内容不是可识别的图片') })
  const { width, height } = metadata, actual = metadata.format
  if (!actual || !width || !height) throw new Error('下载内容不是可识别的图片')
  if ((actual === 'jpeg' || actual === 'png' || actual === 'webp') && (!format || format === actual) && width <= maxWidth && (metadata.pages ?? 1) === 1)
    return { bytes, mimeType: `image/${actual}`, width, height }
  const output: ImageFileFormat = format ?? (metadata.hasAlpha || actual === 'png' || actual === 'gif' || actual === 'svg' ? 'png' : 'jpeg')
  const resized = sharp(bytes, { failOn: 'error' }).rotate().resize({ width: maxWidth, withoutEnlargement: true })
  const encoded = output === 'png' ? resized.png() : output === 'webp' ? resized.webp({ quality: 85 })
    : resized.flatten({ background: '#ffffff' }).jpeg({ quality: 85 })
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { bytes: new Uint8Array(data), mimeType: `image/${output}`, width: info.width, height: info.height }
}

function filenameFor(title: string, mimeType: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[.\s_]+|[.\s]+$/g, '').slice(0, 80) || 'open-image'
  return `${base}.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length)}`
}

/** 开放图库：检索、预览、取图。候选与预览只属于本次任务，任务停止即清除。 */
export class OpenImageService {
  private readonly runs = new Map<string, RunState>()
  private readonly libraries: readonly [OpenLibrary, SearchLibrary][]
  constructor(private readonly options: OpenImageServiceOptions) {
    this.libraries = options.libraries ?? [...(options.pixabay ? [['pixabay', options.pixabay.search] as [OpenLibrary, SearchLibrary]] : []),
      ['wikimedia-commons', searchCommons], ['openverse', searchOpenverse]]
  }

  beginRun(runId: string): void {
    if (this.runs.has(runId)) throw new Error('开放图库任务已开始')
    this.runs.set(runId, { stopped: false, controllers: new Set(), candidates: new Map(), previews: new Map(), next: 1 })
  }

  stopRun(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.stopped = true
    for (const controller of run.controllers) controller.abort()
    run.candidates.clear(); run.previews.clear()
  }

  endRun(runId: string): void { this.stopRun(runId); this.runs.delete(runId) }

  private run(runId: string): RunState {
    const run = this.runs.get(runId)
    if (!run) throw new Error('开放图库任务尚未授权')
    return run
  }

  private async call<T>(run: RunState, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (run.stopped || signal?.aborted) throw new Error('任务已停止')
    const controller = new AbortController(), onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    run.controllers.add(controller)
    try {
      const result = await work(controller.signal)
      if (run.stopped || controller.signal.aborted) throw new Error('任务已停止')
      return result
    } finally { run.controllers.delete(controller); signal?.removeEventListener('abort', onAbort) }
  }

  async search(input: { runId: string; query: string; limit?: number; page?: number; allowShareAlike?: boolean; signal?: AbortSignal }): Promise<OpenImageSearchResult> {
    const run = this.run(input.runId)
    const query = input.query.trim(), limit = input.limit ?? 6, page = input.page ?? 1
    if (!query || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || !Number.isSafeInteger(page) || page < 1)
      return { status: 'rejected', reason: '检索词、数量（1–20）或页码无效' }
    if (run.stopped) return { status: 'rejected', reason: '任务已停止' }
    const allowShareAlike = input.allowShareAlike === true
    let settled: PromiseSettledResult<ImageSearchPage>[]
    try {
      settled = await this.call(run, input.signal, signal => Promise.allSettled(this.libraries.map(([, search]) =>
        search(this.options.http, { query, limit, page, allowShareAlike, signal }))))
    } catch (cause) { return { status: 'rejected', reason: reasonOf(cause, '任务已停止') } }
    const failures: Failure[] = [], unavailable: Failure[] = [], pages: ImageSearchPage[] = []
    settled.forEach((result, index) => {
      const library = libraryNames[this.libraries[index]![0]]
      if (result.status === 'fulfilled') pages.push(result.value)
      else (result.reason instanceof LibraryUnavailableError ? unavailable : failures).push({ library, reason: reasonOf(result.reason, '检索未完成') })
    })
    if (!pages.length) return { status: 'failed', reason: [...failures, ...unavailable].map(item => `${item.library}：${item.reason}`).join('；'),
      ...(failures.length ? { failures } : {}), ...(unavailable.length ? { unavailable } : {}) }
    // 各图库按相关度交替排列；同一文件（Openverse 也收录 Commons）只列一次。
    const seen = new Set<string>(), candidates: ImageCandidateView[] = []
    let excluded = pages.reduce((sum, item) => sum + item.excluded, 0)
    for (let rank = 0; pages.some(item => rank < item.candidates.length); rank++) for (const item of pages) {
      const candidate = item.candidates[rank]
      if (!candidate) continue
      const key = candidate.commonsTitle?.toLowerCase() ?? candidate.fileUrl
      if (seen.has(key)) { excluded++; continue }
      seen.add(key)
      const image = `img${run.next++}`
      run.candidates.set(image, candidate)
      candidates.push({ image, title: candidate.title, ...(candidate.author ? { author: candidate.author } : {}),
        license: candidate.license.id, source: candidate.sourceName,
        ...(candidate.width ? { width: candidate.width } : {}), ...(candidate.height ? { height: candidate.height } : {}),
        ...(candidate.description ? { description: candidate.description } : {}) })
    }
    return { status: 'results', query, licenses: allowShareAlike ? 'CC0、公有领域、CC BY、CC BY-SA' : 'CC0、公有领域、CC BY',
      candidates, excluded, ...(pages.some(item => item.hasMore) ? { nextPage: page + 1 } : {}),
      ...(failures.length ? { failures } : {}), ...(unavailable.length ? { unavailable } : {}),
      // Pixabay's terms: search results say where the images come from.
      ...(candidates.some(item => item.source === 'Pixabay') ? { notice: '来源为 Pixabay 的图片来自 Pixabay（https://pixabay.com/）' } : {}),
      ...(candidates.length ? {} : { hint: '没有符合授权与尺寸要求的结果；可换用英文关键词或更通用的说法' }) }
  }

  async preview(input: { runId: string; images: readonly string[]; signal?: AbortSignal }): Promise<OpenImagePreviewResult> {
    const run = this.run(input.runId)
    if (run.stopped) return { status: 'rejected', reason: '任务已停止' }
    const unique = [...new Set(input.images)]
    const results = await Promise.all(unique.map(async image => {
      const candidate = run.candidates.get(image)
      if (!candidate) return { image, reason: '候选句柄不属于本任务，请重新检索' }
      try {
        const normalized = await this.call(run, input.signal, async signal => {
          const url = candidate.previewUrl
            ?? (candidate.commonsTitle ? await commonsRendition(this.options.http, candidate.commonsTitle, PREVIEW_SIZE, signal) : candidate.fileUrl)
          const response = await this.options.http.getBytes(url, { signal, maxBytes: PREVIEW_MAX_BYTES, headers: { Accept: IMAGE_ACCEPT } })
          const { data, info } = await sharp(response.bytes, { failOn: 'error' }).rotate()
            .resize({ width: PREVIEW_SIZE, height: PREVIEW_SIZE, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' }).jpeg({ quality: 78 }).toBuffer({ resolveWithObject: true })
          return { bytes: new Uint8Array(data), width: info.width, height: info.height }
        })
        const resourceId = `preview-${run.next++}`
        run.previews.set(resourceId, { mimeType: 'image/jpeg', bytes: normalized.bytes })
        return { image, resourceId, mimeType: 'image/jpeg', byteLength: normalized.bytes.byteLength, width: normalized.width, height: normalized.height }
      } catch (cause) { return { image, reason: reasonOf(cause, '预览图下载失败') } }
    }))
    if (run.stopped) return { status: 'rejected', reason: '任务已停止' }
    const previews = results.filter((item): item is OpenImagePreview => 'resourceId' in item)
    const failures = results.filter((item): item is { image: string; reason: string } => 'reason' in item)
    if (!previews.length) return { status: 'failed', reason: '没有取得可查看的预览图', failures }
    return { status: 'prepared', previews, ...(failures.length ? { failures } : {}) }
  }

  readPreview(runId: string, resourceId: string): { mimeType: string; bytes: Uint8Array } {
    const run = this.run(runId), preview = run.previews.get(resourceId)
    if (run.stopped || !preview) throw new Error('预览图不属于本任务或已失效')
    return { mimeType: preview.mimeType, bytes: Uint8Array.from(preview.bytes) }
  }

  /** 下载选中候选的合适尺寸版本，核对并缩放，附上来源与署名。 */
  async fetch(input: { runId: string; image: string; format?: ImageFileFormat; signal?: AbortSignal }): Promise<OpenImageFetchResult> {
    const run = this.run(input.runId)
    if (run.stopped) return { status: 'rejected', reason: '任务已停止' }
    const candidate = run.candidates.get(input.image)
    if (!candidate) return { status: 'rejected', reason: '候选句柄不属于本任务，请先用 image.search 检索' }
    try {
      return await this.call(run, input.signal, async signal => {
        const url = candidate.commonsTitle
          ? await commonsRendition(this.options.http, candidate.commonsTitle, FETCH_WIDTH, signal).catch(() => candidate.fileUrl)
          : candidate.fileUrl
        const response = await this.options.http.getBytes(url, { signal, maxBytes: DOWNLOAD_MAX_BYTES, headers: { Accept: IMAGE_ACCEPT } })
        const image = await normalizeImage(response.bytes, FETCH_WIDTH, input.format)
        return { status: 'ready' as const, file: { bytes: image.bytes, mimeType: image.mimeType, filename: filenameFor(candidate.title, image.mimeType) },
          width: image.width, height: image.height, source: openLibrarySource(candidate) }
      })
    } catch (cause) {
      return { status: run.stopped ? 'rejected' : 'failed', reason: reasonOf(cause, '图片下载失败') }
    }
  }
}

