// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { AssetHttpError, type AssetHttpPort } from '../../src/main/workbench/assetSources/assetSourceTypes'
import { commonsLicense, htmlText, openLibrarySource, openverseLicense } from '../../src/main/workbench/assetSources/licensePolicy'
import { searchOpenverse } from '../../src/main/workbench/assetSources/openverse'

const unused = async (): Promise<never> => { throw new Error('unexpected download') }
const jsonPort = (body: unknown) => {
  const getJson = vi.fn(async (_url: string, _options?: unknown) => body)
  return { port: { getJson, getBytes: unused } satisfies AssetHttpPort, getJson }
}

/** Shape copied from a real Openverse response (2026-10-04), trimmed. */
const openverseItem = (overrides: Record<string, unknown>) => ({
  id: 'd61764db-e30e-497c-acd0-40e2c4f202f7', title: 'AxialTiltObliquity',
  foreign_landing_url: 'https://commons.wikimedia.org/w/index.php?curid=3262268',
  url: 'https://upload.wikimedia.org/wikipedia/commons/6/61/AxialTiltObliquity.png',
  creator: 'Dna-webmaster', license: 'by', license_version: '3.0', license_url: 'https://creativecommons.org/licenses/by/3.0/',
  provider: 'wikimedia', source: 'wikimedia', filetype: 'png', tags: [], mature: false, height: 590, width: 760,
  thumbnail: 'https://api.openverse.org/v1/images/d61764db-e30e-497c-acd0-40e2c4f202f7/thumb/', ...overrides,
})

describe('license policy and attribution', () => {
  const strict = { allowShareAlike: false }, shareAlike = { allowShareAlike: true }
  it('accepts CC0, public domain and CC BY by default, CC BY-SA only with consent, and never NC/ND/unknown', () => {
    expect(openverseLicense('cc0', '1.0', undefined, strict)).toMatchObject({ id: 'CC0 1.0', attributionRequired: false })
    expect(openverseLicense('pdm', '1.0', undefined, strict)).toMatchObject({ id: '公有领域', attributionRequired: false })
    expect(openverseLicense('by', '4.0', 'https://creativecommons.org/licenses/by/4.0/', strict))
      .toEqual({ code: 'by', id: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true })
    expect(openverseLicense('by-sa', '2.0', undefined, strict)).toBeNull()
    expect(openverseLicense('by-sa', '2.0', undefined, shareAlike)).toMatchObject({ id: 'CC BY-SA 2.0', url: 'https://creativecommons.org/licenses/by-sa/2.0/' })
    for (const code of ['by-nc', 'by-nd', 'by-nc-sa', 'by-nc-nd', 'sampling+', '', undefined])
      expect(openverseLicense(code, '4.0', undefined, shareAlike)).toBeNull()
    // A license link outside creativecommons.org is never repeated in the attribution.
    expect(openverseLicense('by', '3.0', 'https://evil.example/by', strict)?.url).toBe('https://creativecommons.org/licenses/by/3.0/')

    expect(commonsLicense({ key: 'cc-by-3.0', shortName: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0' }, strict))
      .toMatchObject({ code: 'by', id: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0' })
    expect(commonsLicense({ key: 'cc0', shortName: 'CC0', url: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en' }, strict))
      .toMatchObject({ code: 'cc0', attributionRequired: false })
    expect(commonsLicense({ key: 'pd-old-100', shortName: 'Public domain' }, strict)).toMatchObject({ code: 'pd', id: '公有领域' })
    expect(commonsLicense({ key: 'cc-by-sa-4.0', shortName: 'CC BY-SA 4.0' }, strict)).toBeNull()
    expect(commonsLicense({ key: 'cc-by-sa-4.0', shortName: 'CC BY-SA 4.0' }, shareAlike)).toMatchObject({ id: 'CC BY-SA 4.0' })
    for (const value of [{ key: 'cc-by-nc-sa-2.0' }, { key: 'cc-by-nd-4.0' }, { shortName: 'CC BY-NC 4.0' }, { key: 'gfdl', shortName: 'GFDL' },
      { shortName: 'Attribution' }, { key: 'fair use' }, {}]) expect(commonsLicense(value, shareAlike)).toBeNull()
  })

  it('generates title, author, source and license attribution only where the license requires it', () => {
    const by = openverseLicense('by', '3.0', 'https://creativecommons.org/licenses/by/3.0/', { allowShareAlike: false })!
    expect(openLibrarySource({ title: 'AxialTiltObliquity', author: 'Dna-webmaster', sourceName: 'Wikimedia Commons',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:AxialTiltObliquity.png', license: by })).toEqual({
      kind: 'open-library', title: 'AxialTiltObliquity', author: 'Dna-webmaster', url: 'https://commons.wikimedia.org/wiki/File:AxialTiltObliquity.png',
      license: { id: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/' },
      attribution: '“AxialTiltObliquity”，作者：Dna-webmaster，来源：Wikimedia Commons（https://commons.wikimedia.org/wiki/File:AxialTiltObliquity.png），授权：CC BY 3.0（https://creativecommons.org/licenses/by/3.0/）',
    })
    const cc0 = openverseLicense('cc0', '1.0', undefined, { allowShareAlike: false })!
    const source = openLibrarySource({ title: 'Winter solstice', sourceName: 'Flickr', pageUrl: 'https://www.flickr.com/photos/1/2', license: cc0 })
    expect(source).toEqual({ kind: 'open-library', title: 'Winter solstice', url: 'https://www.flickr.com/photos/1/2',
      license: { id: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } })
    expect(htmlText('<a href="//commons.wikimedia.org/wiki/User:A" title="x">Hawes&amp;thoughts</a>‮<script>alert(1)</script>', 80)).toBe('Hawes&thoughts')
  })
})

describe('Openverse search', () => {
  it('requests only allowed licenses and keeps title, author, license, source page, size and preview', async () => {
    const { port, getJson } = jsonPort({ result_count: 3, page_count: 2, page: 1, results: [
      openverseItem({}),
      openverseItem({ id: 'flickr-1', title: 'Winter solstice', url: 'https://live.staticflickr.com/8388/8517008600_8c6ce51d82_b.jpg',
        foreign_landing_url: 'https://www.flickr.com/photos/24490288@N04/8517008600', creator: 'Terry Kearney', license: 'cc0', license_version: '1.0',
        source: 'flickr', provider: 'flickr', width: 1024, height: 683, tags: [{ name: 'solstice' }, { name: 'dusk' }] }),
    ] })
    const page = await searchOpenverse(port, { query: 'earth axial tilt', limit: 6, page: 1, allowShareAlike: false })
    const [url, options] = getJson.mock.calls[0]!
    const request = new URL(url)
    expect(request.origin + request.pathname).toBe('https://api.openverse.org/v1/images/')
    expect(Object.fromEntries(request.searchParams)).toEqual({ q: 'earth axial tilt', license: 'cc0,pdm,by', page_size: '6', page: '1' })
    expect(options).toMatchObject({ headers: { Accept: 'application/json' } })
    expect(page).toMatchObject({ library: 'openverse', excluded: 0, hasMore: true })
    expect(page.candidates[0]).toMatchObject({ library: 'openverse', providerId: 'd61764db-e30e-497c-acd0-40e2c4f202f7', title: 'AxialTiltObliquity',
      author: 'Dna-webmaster', sourceName: 'Wikimedia Commons', license: { id: 'CC BY 3.0' }, width: 760, height: 590,
      pageUrl: 'https://commons.wikimedia.org/w/index.php?curid=3262268', commonsTitle: 'File:AxialTiltObliquity.png',
      previewUrl: 'https://api.openverse.org/v1/images/d61764db-e30e-497c-acd0-40e2c4f202f7/thumb/' })
    expect(page.candidates[1]).toMatchObject({ sourceName: 'Flickr', license: { id: 'CC0 1.0', attributionRequired: false }, description: '标签：solstice、dusk' })
    expect(page.candidates[1]).not.toHaveProperty('commonsTitle')

    await searchOpenverse(port, { query: 'x', limit: 3, page: 2, allowShareAlike: true })
    expect(new URL(getJson.mock.calls[1]![0]).searchParams.get('license')).toBe('cc0,pdm,by,by-sa')
  })

  it('drops non-commercial, no-derivative, share-alike without consent, mature, tiny and unusable results', async () => {
    const { port } = jsonPort({ page_count: 1, results: [
      openverseItem({ id: 'nc', license: 'by-nc' }), openverseItem({ id: 'nd', license: 'by-nd' }), openverseItem({ id: 'sa', license: 'by-sa' }),
      openverseItem({ id: 'mature', mature: true }), openverseItem({ id: 'tiny', width: 320 }), openverseItem({ id: 'nofile', url: 'javascript:alert(1)' }),
      openverseItem({ id: 'ok', title: '‮Title\u0000  with   spaces', foreign_landing_url: null }), 'not an object',
    ] })
    const page = await searchOpenverse(port, { query: 'q', limit: 20, page: 1, allowShareAlike: false })
    expect(page.candidates.map(item => item.providerId)).toEqual(['ok'])
    expect(page.candidates[0]).toMatchObject({ title: 'Title with spaces', pageUrl: 'https://openverse.org/image/ok' })
    expect(page).toMatchObject({ excluded: 7, hasMore: false })
  })

  it('reports anonymous rate limiting and malformed responses as readable failures', async () => {
    const limited: AssetHttpPort = { getJson: async () => { throw new AssetHttpError('HTTP 429', 429) }, getBytes: unused }
    await expect(searchOpenverse(limited, { query: 'q', limit: 5, page: 1, allowShareAlike: false }))
      .rejects.toThrow('Openverse 匿名访问次数已达上限')
    await expect(searchOpenverse(jsonPort({ detail: 'oops' }).port, { query: 'q', limit: 5, page: 1, allowShareAlike: false }))
      .rejects.toThrow('无法识别')
  })
})
