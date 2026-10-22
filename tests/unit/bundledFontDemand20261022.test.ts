import { afterEach, expect, it, vi } from 'vitest'
import type { BundledFontManifest } from '../../src/shared/fonts/bundledFontManifest'
import { installFetchBundledFontEmbedSource } from '../../src/renderer/export/bundledFontEmbedSourceFetch'
import { prepareBundledFontEmbedding, registerBundledFontEmbedPreparer, registerBundledFontEmbedSource,
  resolveEmbeddedBundledFonts, unavailableEmbeddedBundledFontFamilies } from '../../src/renderer/export/bundledFontEmbedding'

const textFamily = 'Noto Sans SC', mathFamily = 'STIX Two Math'
const license = { type: 'OFL-1.1', attribution: 'Fixture', noticePath: 'fixture-license', packageName: 'fixture-font', packageVersion: '1' }
const manifest: BundledFontManifest = { families: [
  { family: textFamily, style: 'normal', weight: '100 900', display: 'swap', license, faces: [
    { file: 'latin.woff2', specifier: 'latin', url: './latin.woff2', unicodeRange: 'U+0000-007F' },
    { file: 'middle.woff2', specifier: 'middle', url: './middle.woff2', unicodeRange: 'U+4E2D' },
    { file: 'other.woff2', specifier: 'other', url: './other.woff2', unicodeRange: 'U+9FFF' },
  ] },
  { family: mathFamily, style: 'normal', weight: '400', display: 'swap', license, faces: [
    { file: 'math.woff2', specifier: 'math', url: './math.woff2' },
  ] },
] }
const latin = { fontFamily: textFamily, text: 'ABC' }
const chinese = { fontFamily: textFamily, text: 'ABC中' }
const response = (): Response => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.of(0x77, 0x4f, 0x46, 0x32, 1).buffer }) as Response
const install = (fetchResource: (url: string) => Promise<Response>) => installFetchBundledFontEmbedSource({ manifest, fetchResource,
  licenseTexts: { [license.noticePath]: 'SIL OPEN FONT LICENSE fixture' } })

afterEach(() => {
  registerBundledFontEmbedSource(null)
  registerBundledFontEmbedPreparer(null)
  vi.restoreAllMocks()
})

it('reads only the families and unicode faces used by the captured payload', async () => {
  const fetchResource = vi.fn(async (_url: string) => response())
  install(fetchResource)
  await prepareBundledFontEmbedding({ fontFamily: 'system-ui', text: 'ABC' })
  expect(fetchResource).not.toHaveBeenCalled()
  await prepareBundledFontEmbedding(latin)
  expect(fetchResource.mock.calls.map(call => call[0])).toEqual(['./latin.woff2'])
  const fonts = resolveEmbeddedBundledFonts(latin)
  expect(fonts.map(font => ({ family: font.family, files: font.faces.map(face => face.file) })))
    .toEqual([{ family: textFamily, files: ['latin.woff2'] }])
  expect(fonts[0]?.licenseText).toContain('SIL OPEN FONT LICENSE')
  expect(unavailableEmbeddedBundledFontFamilies(latin, fonts)).toEqual([])
})

it('shares in-flight face reads and prepares a later character without refetching the first subset', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const fetchResource = vi.fn(async (_url: string) => { await pending; return response() })
  install(fetchResource)
  const first = prepareBundledFontEmbedding(latin), second = prepareBundledFontEmbedding(latin)
  expect(fetchResource).toHaveBeenCalledTimes(1)
  release()
  await Promise.all([first, second])
  expect(resolveEmbeddedBundledFonts(chinese)).toEqual([])
  await prepareBundledFontEmbedding(chinese)
  expect(fetchResource.mock.calls.map(call => call[0])).toEqual(['./latin.woff2', './middle.woff2'])
  expect(resolveEmbeddedBundledFonts(chinese)[0]?.faces.map(face => face.file)).toEqual(['latin.woff2', 'middle.woff2'])
})

it('keeps successful slices but diagnoses a partial requested family until the failed slice is retried', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  let fail = true
  const fetchResource = vi.fn(async (url: string) => {
    if (url === './middle.woff2' && fail) throw new Error('fixture unavailable')
    return response()
  })
  install(fetchResource)
  await prepareBundledFontEmbedding(chinese)
  expect(resolveEmbeddedBundledFonts(chinese)).toEqual([])
  expect(unavailableEmbeddedBundledFontFamilies(chinese, resolveEmbeddedBundledFonts(chinese))).toEqual([textFamily])
  expect(resolveEmbeddedBundledFonts(latin)).toHaveLength(1)
  fail = false
  await prepareBundledFontEmbedding(chinese)
  expect(fetchResource.mock.calls.map(call => call[0])).toEqual(['./latin.woff2', './middle.woff2', './middle.woff2'])
  expect(unavailableEmbeddedBundledFontFamilies(chinese, resolveEmbeddedBundledFonts(chinese))).toEqual([])
})

it('retains all declared slices for dynamic characters and requires the license for that family', async () => {
  const fetchResource = vi.fn(async (_url: string) => response())
  install(fetchResource)
  const dynamic = { fontFamily: textFamily, html: '<input type="text">' }
  await prepareBundledFontEmbedding(dynamic)
  expect(fetchResource.mock.calls.map(call => call[0])).toEqual(['./latin.woff2', './middle.woff2', './other.woff2'])
  expect(resolveEmbeddedBundledFonts(dynamic)[0]?.faces).toHaveLength(3)
  installFetchBundledFontEmbedSource({ manifest, fetchResource, licenseTexts: {} })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await prepareBundledFontEmbedding(latin)
  expect(resolveEmbeddedBundledFonts(latin)).toEqual([])
  expect(unavailableEmbeddedBundledFontFamilies(latin, [])).toEqual([textFamily])
})
