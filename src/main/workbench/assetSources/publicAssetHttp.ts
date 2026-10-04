import { fetchPublicResource, PublicHttpError } from '../network/publicHttp'
import { AssetHttpError, type AssetHttpPort } from './assetSourceTypes'

const JSON_MAX_BYTES = 4 * 1024 * 1024

/** 图库要求可识别、带联系方式的客户端标识（Wikimedia User-Agent 政策）。 */
export function openLibraryUserAgent(version: string): string {
  return `GuolingWorkbench/${version} (courseware editor; contact@good-learning.cn)`
}

/** 经现有公网访问层（逐跳 DNS 固定与私网拦截）访问开放图库。 */
export function publicAssetHttp(userAgent: string, fetch: typeof fetchPublicResource = fetchPublicResource): AssetHttpPort {
  const request = async (url: string, options: Parameters<AssetHttpPort['getBytes']>[1]) => {
    try {
      return await fetch(url, { ...(options.signal ? { signal: options.signal } : {}),
        headers: { ...options.headers, 'User-Agent': userAgent }, maxBytes: options.maxBytes })
    } catch (cause) {
      if (cause instanceof PublicHttpError && cause.code === 'http-error') throw new AssetHttpError(cause.message, cause.status)
      throw cause
    }
  }
  return {
    async getJson(url, options = {}) {
      const response = await request(url, { ...options, maxBytes: JSON_MAX_BYTES })
      if (!/[/+]json$/.test(response.contentType)) throw new AssetHttpError(`图库返回了 ${response.contentType}，不是 JSON 结果`)
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)) as unknown }
      catch { throw new AssetHttpError('图库返回的 JSON 无法解析') }
    },
    async getBytes(url, options) {
      const response = await request(url, options)
      return { url: response.url, contentType: response.contentType, bytes: response.bytes }
    },
  }
}
