import type { OpenLicense } from './licensePolicy'

export type OpenLibrary = 'openverse' | 'wikimedia-commons' | 'pixabay'

/** 开放图库的一个检索结果，保留取图所需的地址，只在主进程内使用。 */
export interface OpenImageCandidate {
  library: OpenLibrary
  /** 图库内标识：Openverse 的 UUID，或 Commons 的页面编号。 */
  providerId: string
  title: string
  author?: string
  license: OpenLicense
  /** 原始站点名称，例如 “Flickr”“Wikimedia Commons”。 */
  sourceName: string
  /** 来源页。 */
  pageUrl: string
  /** 原图文件地址。 */
  fileUrl: string
  /** 图库提供的小预览地址。 */
  previewUrl?: string
  /** 托管在 Wikimedia Commons 上的文件页标题（File:…），取图时据此请求合适尺寸的版本。 */
  commonsTitle?: string
  width?: number
  height?: number
  /** 第三方提供的说明或标签，是不可信数据。 */
  description?: string
}

export interface ImageSearchInput {
  query: string
  /** 每个图库最多返回的候选数。 */
  limit: number
  /** 从 1 开始。 */
  page: number
  allowShareAlike: boolean
  signal?: AbortSignal
}

export interface ImageSearchPage {
  library: OpenLibrary
  candidates: readonly OpenImageCandidate[]
  /** 因授权、尺寸、成人内容或缺少地址而未列出的条数。 */
  excluded: number
  hasMore: boolean
}

export interface AssetHttpRequest {
  signal?: AbortSignal
  headers?: { Accept?: string; 'Accept-Language'?: string }
}

/** 网络访问端口：生产由现有公网访问层实现，测试替换为固定响应。 */
export interface AssetHttpPort {
  getJson(url: string, options?: AssetHttpRequest): Promise<unknown>
  getBytes(url: string, options: AssetHttpRequest & { maxBytes: number }): Promise<{ url: string; contentType: string; bytes: Uint8Array }>
}

/** 图库未启用（例如没有可用的 API key）；检索结果里说明原因，不算失败。 */
export class LibraryUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'LibraryUnavailableError' }
}

/** 图库请求失败；status 为 HTTP 状态码（已知时）。 */
export class AssetHttpError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'AssetHttpError' }
}

/** 宽度不足的图片放进课件会明显发虚，不列出。 */
export const MIN_IMAGE_WIDTH = 500

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export const positiveInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
