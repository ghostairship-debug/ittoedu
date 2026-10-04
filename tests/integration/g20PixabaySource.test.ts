// @vitest-environment node
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { OpenImageService } from '../../src/main/workbench/assetSources/OpenImageService'
import { AssetHttpError, LibraryUnavailableError, type AssetHttpPort } from '../../src/main/workbench/assetSources/assetSourceTypes'
import { PIXABAY_CACHE_MS, PixabaySource, searchPixabay } from '../../src/main/workbench/assetSources/pixabay'
import { assetSourceSchema } from '../../src/shared/contracts/media-v1'

/** Shape of a Pixabay API hit (pixabay.com/api/docs), trimmed. */
const hit = (overrides: Record<string, unknown> = {}) => ({ id: 195893, pageURL: 'https://pixabay.com/en/blossom-bloom-flower-195893/', type: 'photo',
  tags: 'blossom, bloom, flower', previewURL: 'https://cdn.pixabay.com/photo/2013/10/15/09/12/flower-195893_150.jpg',
  webformatURL: 'https://pixabay.com/get/35bbf209e13e39d2_640.jpg', webformatWidth: 640, webformatHeight: 360,
  largeImageURL: 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg', imageWidth: 4000, imageHeight: 2250, user: 'Josch13', user_id: 48777, ...overrides })
const port = (body: unknown) => {
  const getJson = vi.fn(async (_url: string, _options?: unknown) => body)
  return { http: { getJson, getBytes: async () => { throw new Error('unused') } } satisfies AssetHttpPort, getJson }
}

describe('Pixabay', () => {
  it('searches with the key, safe search and the query language, and keeps the 1280 px file and its page', async () => {
    const { http, getJson } = port({ total: 4692, totalHits: 500, hits: [hit(), hit({ id: 2, imageWidth: 300 }), hit({ id: 3, pageURL: 'javascript:x' })] })
    const page = await searchPixabay(http, 'secret-key', { query: '枫叶 秋天', limit: 2, page: 1, allowShareAlike: false })
    const request = new URL(getJson.mock.calls[0]![0])
    expect(request.origin + request.pathname).toBe('https://pixabay.com/api/')
    expect(Object.fromEntries(request.searchParams)).toEqual({ key: 'secret-key', q: '枫叶 秋天', lang: 'zh', image_type: 'all', safesearch: 'true', per_page: '3', page: '1' })
    expect(page).toMatchObject({ library: 'pixabay', excluded: 1, hasMore: true })
    expect(page.candidates).toEqual([{ library: 'pixabay', providerId: '195893', title: 'blossom, bloom, flower', author: 'Josch13',
      license: { code: 'pixabay', id: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/', attributionRequired: true },
      sourceName: 'Pixabay', pageUrl: 'https://pixabay.com/en/blossom-bloom-flower-195893/', fileUrl: 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg',
      previewUrl: 'https://pixabay.com/get/35bbf209e13e39d2_640.jpg', width: 4000, height: 2250, description: '标签：blossom, bloom, flower' }])
    await searchPixabay(http, 'k', { query: 'x'.repeat(150) + ' maple', limit: 10, page: 2, allowShareAlike: false })
    expect(Object.fromEntries(new URL(getJson.mock.calls[1]![0]).searchParams)).toMatchObject({ q: 'x'.repeat(100), lang: 'en', per_page: '10', page: '2' })
  })

  it('explains rate limiting and a rejected key', async () => {
    const failing = (status: number): AssetHttpPort => ({ getJson: async () => { throw new AssetHttpError(`网页返回 HTTP ${status}`, status) }, getBytes: async () => { throw new Error('unused') } })
    await expect(searchPixabay(failing(429), 'k', { query: 'q', limit: 5, page: 1, allowShareAlike: false })).rejects.toThrow('每分钟最多 100 次')
    await expect(searchPixabay(failing(400), 'k', { query: 'q', limit: 5, page: 1, allowShareAlike: false })).rejects.toThrow('API key 可能无效')
    await expect(searchPixabay(port({ error: 'x' }).http, 'k', { query: 'q', limit: 5, page: 1, allowShareAlike: false })).rejects.toThrow('无法识别')
  })

  it('needs a key, answers identical requests from a 24-hour cache, and keeps the 100-per-minute limit locally', async () => {
    let now = 1_000_000, key: string | undefined
    const source = new PixabaySource({ key: async () => key, now: () => now })
    const { http, getJson } = port({ totalHits: 1, hits: [hit()] })
    const input = { query: 'flower', limit: 5, page: 1, allowShareAlike: false }
    await expect(source.search(http, input)).rejects.toBeInstanceOf(LibraryUnavailableError)
    key = 'bundled'
    const first = await source.search(http, input)
    expect(await source.search(http, input)).toBe(first)
    expect(getJson).toHaveBeenCalledTimes(1)
    key = 'users-own'
    await source.search(http, input)
    expect(getJson).toHaveBeenCalledTimes(2)
    now += PIXABAY_CACHE_MS
    await source.search(http, input)
    expect(getJson).toHaveBeenCalledTimes(3)
    // The one request at this moment plus 99 different ones fill the minute.
    for (let index = 0; index < 99; index++) await source.search(http, { ...input, page: index + 2 })
    await expect(source.search(http, { ...input, query: 'one more' })).rejects.toThrow('每分钟 100 次的访问上限')
    now += 60_000
    await source.search(http, { ...input, query: 'one more' })
    expect(getJson).toHaveBeenCalledTimes(103)
  })

  it('joins image.search ahead of the other libraries, says where its results come from, and credits its license', async () => {
    const jpeg = new Uint8Array(await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#88aa22' } }).jpeg().toBuffer())
    const http: AssetHttpPort = { getJson: async () => ({ totalHits: 1, hits: [hit()] }), getBytes: async url => ({ url, contentType: 'image/jpeg', bytes: jpeg }) }
    const commons = async () => ({ library: 'wikimedia-commons' as const, candidates: [], excluded: 0, hasMore: false })
    let key: string | undefined
    const service = new OpenImageService({ http, libraries: [['pixabay', new PixabaySource({ key: async () => key }).search], ['wikimedia-commons', commons]] })
    service.beginRun('run')
    expect(await service.search({ runId: 'run', query: 'flower' })).toMatchObject({ status: 'results', candidates: [],
      unavailable: [{ library: 'Pixabay', reason: expect.stringContaining('未配置 Pixabay API key') }] })
    key = 'bundled'
    const found = await service.search({ runId: 'run', query: 'flower' })
    expect(found).toMatchObject({ status: 'results', candidates: [{ image: 'img1', source: 'Pixabay', license: 'Pixabay Content License', author: 'Josch13' }],
      notice: expect.stringContaining('Pixabay') })
    expect(found).not.toHaveProperty('unavailable')
    const fetched = await service.fetch({ runId: 'run', image: 'img1' })
    expect(fetched).toMatchObject({ status: 'ready', width: 1280, file: { mimeType: 'image/jpeg' }, source: { kind: 'open-library', title: 'blossom, bloom, flower',
      author: 'Josch13', url: 'https://pixabay.com/en/blossom-bloom-flower-195893/', license: { id: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/' },
      attribution: '“blossom, bloom, flower”，作者：Josch13，来源：Pixabay（https://pixabay.com/en/blossom-bloom-flower-195893/），授权：Pixabay Content License（https://pixabay.com/service/license-summary/）' } })
    if (fetched.status === 'ready') expect(assetSourceSchema.parse(fetched.source)).toEqual(fetched.source)
  })
})
