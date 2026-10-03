// @vitest-environment node
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { OpenImageService, normalizeImage } from '../../src/main/workbench/assetSources/OpenImageService'
import { AssetHttpError, type AssetHttpPort, type ImageSearchInput, type ImageSearchPage, type OpenImageCandidate } from '../../src/main/workbench/assetSources/assetSourceTypes'
import { openverseLicense } from '../../src/main/workbench/assetSources/licensePolicy'

const by = openverseLicense('by', '3.0', 'https://creativecommons.org/licenses/by/3.0/', { allowShareAlike: false })!
const cc0 = openverseLicense('cc0', '1.0', undefined, { allowShareAlike: false })!
const commonsDiagram: OpenImageCandidate = { library: 'wikimedia-commons', providerId: '3262268', title: 'AxialTiltObliquity', author: 'Dna-webmaster',
  license: by, sourceName: 'Wikimedia Commons', pageUrl: 'https://commons.wikimedia.org/wiki/File:AxialTiltObliquity.png',
  fileUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/61/AxialTiltObliquity.png', commonsTitle: 'File:AxialTiltObliquity.png',
  previewUrl: 'https://upload.wikimedia.org/thumb/axial-500.png', width: 2400, height: 1200, description: 'Axial tilt and the ecliptic' }
const flickrPhoto: OpenImageCandidate = { library: 'openverse', providerId: 'flickr-1', title: 'Winter: solstice / dusk', author: 'Terry Kearney',
  license: cc0, sourceName: 'Flickr', pageUrl: 'https://www.flickr.com/photos/24490288@N04/8517008600',
  fileUrl: 'https://live.staticflickr.com/8388/8517008600_b.jpg', previewUrl: 'https://api.openverse.org/v1/images/flickr-1/thumb/', width: 1024, height: 683 }
const duplicateOfCommons: OpenImageCandidate = { ...commonsDiagram, library: 'openverse', providerId: 'd61764db', sourceName: 'Wikimedia Commons',
  pageUrl: 'https://commons.wikimedia.org/w/index.php?curid=3262268' }

const page = (library: ImageSearchPage['library'], candidates: OpenImageCandidate[], hasMore = false): ImageSearchPage =>
  ({ library, candidates, excluded: 1, hasMore })
const raster = (width: number, height: number, format: 'png' | 'jpeg' | 'gif', alpha = false) =>
  sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 40, b: 40, alpha: 0.5 } : { r: 30, g: 90, b: 200 } } })
    .toFormat(format).toBuffer().then(buffer => new Uint8Array(buffer))

function service(files: Record<string, Uint8Array | Error>, libraries?: ConstructorParameters<typeof OpenImageService>[0]['libraries']) {
  const getBytes = vi.fn(async (url: string, _options: { maxBytes: number; signal?: AbortSignal }) => {
    const file = files[url]
    if (!file) throw new AssetHttpError(`网页返回 HTTP 404`, 404)
    if (file instanceof Error) throw file
    return { url, contentType: 'image/png', bytes: file }
  })
  const getJson = vi.fn(async (url: string) => {
    const title = new URL(url).searchParams.get('titles')
    return { query: { pages: [{ title, imageinfo: [{ thumburl: `https://upload.wikimedia.org/thumb/rendition-${new URL(url).searchParams.get('iiurlwidth')}.png` }] }] } }
  })
  const http: AssetHttpPort = { getJson, getBytes }
  const searches = { commons: vi.fn(async (_http: AssetHttpPort, _input: ImageSearchInput) => page('wikimedia-commons', [commonsDiagram], true)),
    openverse: vi.fn(async (_http: AssetHttpPort, _input: ImageSearchInput) => page('openverse', [duplicateOfCommons, flickrPhoto])) }
  const open = new OpenImageService({ http, libraries: libraries ?? [['wikimedia-commons', searches.commons], ['openverse', searches.openverse]] })
  return { open, getBytes, getJson, searches }
}

describe('open image service', () => {
  it('searches both libraries, removes the same Commons file found through Openverse, and issues run-scoped handles', async () => {
    const { open, searches } = service({})
    open.beginRun('run')
    const result = await open.search({ runId: 'run', query: '  earth axial tilt ', limit: 4 })
    expect(searches.commons.mock.calls[0]![1]).toMatchObject({ query: 'earth axial tilt', limit: 4, page: 1, allowShareAlike: false })
    expect(result).toEqual({ status: 'results', query: 'earth axial tilt', licenses: 'CC0、公有领域、CC BY', excluded: 3, nextPage: 2, candidates: [
      { image: 'img1', title: 'AxialTiltObliquity', author: 'Dna-webmaster', license: 'CC BY 3.0', source: 'Wikimedia Commons', width: 2400, height: 1200,
        description: 'Axial tilt and the ecliptic' },
      { image: 'img2', title: 'Winter: solstice / dusk', author: 'Terry Kearney', license: 'CC0 1.0', source: 'Flickr', width: 1024, height: 683 },
    ] })
    await open.search({ runId: 'run', query: 'x', allowShareAlike: true, page: 3 })
    expect(searches.openverse.mock.calls[1]![1]).toMatchObject({ allowShareAlike: true, page: 3, limit: 6 })
    expect(await open.search({ runId: 'run', query: ' ', limit: 4 })).toMatchObject({ status: 'rejected' })
    await expect(open.search({ runId: 'other', query: 'x' })).rejects.toThrow('尚未授权')
  })

  it('keeps results from one library when the other fails, and fails only when both do', async () => {
    const failing = vi.fn(async () => { throw new AssetHttpError('Openverse 匿名访问次数已达上限，请稍后再试；Wikimedia Commons 不受影响', 429) })
    const { open } = service({}, [['wikimedia-commons', async () => page('wikimedia-commons', [commonsDiagram])], ['openverse', failing]])
    open.beginRun('run')
    expect(await open.search({ runId: 'run', query: 'tilt' })).toMatchObject({ status: 'results', candidates: [{ image: 'img1' }],
      failures: [{ library: 'Openverse', reason: expect.stringContaining('上限') }] })
    const none = service({}, [['wikimedia-commons', failing], ['openverse', failing]]).open
    none.beginRun('run')
    expect(await none.search({ runId: 'run', query: 'tilt' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('Wikimedia Commons：') })
    const empty = service({}, [['openverse', async () => page('openverse', [])]]).open
    empty.beginRun('run')
    expect(await empty.search({ runId: 'run', query: 'tilt' })).toMatchObject({ status: 'results', candidates: [], hint: expect.stringContaining('英文') })
  })

  it('prepares small JPEG previews that only this run can read', async () => {
    const { open, getBytes } = service({ 'https://upload.wikimedia.org/thumb/axial-500.png': await raster(1000, 500, 'png', true),
      'https://api.openverse.org/v1/images/flickr-1/thumb/': await raster(600, 400, 'jpeg') })
    open.beginRun('run')
    await open.search({ runId: 'run', query: 'tilt' })
    const result = await open.preview({ runId: 'run', images: ['img1', 'img2', 'img9'] })
    expect(result).toMatchObject({ status: 'prepared', previews: [
      { image: 'img1', mimeType: 'image/jpeg', width: 480, height: 240 }, { image: 'img2', mimeType: 'image/jpeg', width: 480, height: 320 },
    ], failures: [{ image: 'img9', reason: expect.stringContaining('重新检索') }] })
    expect(getBytes.mock.calls[0]![1]).toMatchObject({ headers: { Accept: expect.stringContaining('image/') } })
    if (result.status !== 'prepared') throw new Error('expected previews')
    const bytes = open.readPreview('run', result.previews[0]!.resourceId).bytes
    expect((await sharp(bytes).metadata()).format).toBe('jpeg')
    open.beginRun('other')
    expect(() => open.readPreview('other', result.previews[0]!.resourceId)).toThrow('不属于本任务')
    open.stopRun('run')
    expect(() => open.readPreview('run', result.previews[0]!.resourceId)).toThrow('已失效')
  })

  it('downloads about 1600 px through the Commons rendition, shrinks larger files, and attaches source and attribution', async () => {
    const { open, getJson, getBytes } = service({ 'https://upload.wikimedia.org/thumb/rendition-1600.png': await raster(1920, 960, 'jpeg'),
      'https://live.staticflickr.com/8388/8517008600_b.jpg': await raster(1024, 683, 'png') })
    open.beginRun('run')
    await open.search({ runId: 'run', query: 'tilt' })
    const diagram = await open.fetch({ runId: 'run', image: 'img1' })
    expect(new URL(getJson.mock.calls[0]![0]).searchParams.get('titles')).toBe('File:AxialTiltObliquity.png')
    expect(getBytes.mock.calls[0]![1]).toMatchObject({ maxBytes: 100 * 1024 * 1024 })
    expect(diagram).toMatchObject({ status: 'ready', width: 1600, height: 800, file: { mimeType: 'image/jpeg', filename: 'AxialTiltObliquity.jpg' },
      source: { kind: 'open-library', title: 'AxialTiltObliquity', author: 'Dna-webmaster', url: 'https://commons.wikimedia.org/wiki/File:AxialTiltObliquity.png',
        license: { id: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/' },
        attribution: expect.stringContaining('授权：CC BY 3.0') } })
    const photo = await open.fetch({ runId: 'run', image: 'img2' })
    expect(photo).toMatchObject({ status: 'ready', width: 1024, height: 683, file: { mimeType: 'image/png', filename: 'Winter_ solstice _ dusk.png' },
      source: { license: { id: 'CC0 1.0' } } })
    if (photo.status !== 'ready') throw new Error('expected photo')
    expect(photo.source).not.toHaveProperty('attribution')
    expect(await open.fetch({ runId: 'run', image: 'img7' })).toMatchObject({ status: 'rejected', reason: expect.stringContaining('image.search') })
  })

  it('reports unreadable downloads and stops in-flight work with the task', async () => {
    const { open } = service({ 'https://upload.wikimedia.org/thumb/rendition-1600.png': new TextEncoder().encode('<html>not an image</html>') })
    open.beginRun('run')
    await open.search({ runId: 'run', query: 'tilt' })
    expect(await open.fetch({ runId: 'run', image: 'img1' })).toEqual({ status: 'failed', reason: '下载内容不是可识别的图片' })
    let release!: () => void
    const blocked: AssetHttpPort = { getJson: async () => ({}), getBytes: (_url, options) => new Promise((_resolve, reject) => {
      release = () => reject(new Error('aborted'))
      options.signal?.addEventListener('abort', () => release(), { once: true })
    }) }
    const slow = new OpenImageService({ http: blocked, libraries: [['openverse', async () => page('openverse', [flickrPhoto])]] })
    slow.beginRun('run')
    await slow.search({ runId: 'run', query: 'x' })
    const pending = slow.fetch({ runId: 'run', image: 'img1' })
    await new Promise(resolve => setTimeout(resolve, 0))
    slow.stopRun('run')
    expect(await pending).toMatchObject({ status: 'rejected' })
    expect(await slow.search({ runId: 'run', query: 'x' })).toMatchObject({ status: 'rejected', reason: '任务已停止' })
  })

  it('keeps already suitable files byte-for-byte and converts animation or oversize images', async () => {
    const png = await raster(800, 600, 'png')
    expect((await normalizeImage(png, 1600)).bytes).toBe(png)
    // GIF keeps its possible transparency as PNG; only the first frame is used in a slide image.
    expect(await normalizeImage(await raster(800, 600, 'gif'), 1600)).toMatchObject({ mimeType: 'image/png', width: 800 })
    expect(await normalizeImage(await raster(2000, 1000, 'jpeg'), 1600)).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 800 })
    expect(await normalizeImage(await raster(3200, 1600, 'png', true), 1600)).toMatchObject({ mimeType: 'image/png', width: 1600, height: 800 })
  })
})
