/**
 * The editor's own byte source for font embedding.
 *
 * EDITOR RENDERER ONLY. Registering this source is what makes the properties
 * panel's promise — "内置字体：导出时嵌入，换机器排版不变" — true inside the app.
 * Without it the editor's export button produced the same machine-dependent
 * lesson as before, because the byte source registration point had no registrant
 * in the app (the Node one is a build/test host).
 *
 * Why `fetch` and not `node:fs`: the renderer runs sandboxed
 * (`nodeIntegration: false`) and a static `node:fs` import anywhere in its graph
 * fails the browser build outright. The editor's assets are reachable over its
 * own `courseware-editor://` scheme, registered `standard`/`secure` with
 * `supportFetchAPI: true` (`src/main/protocols.ts`) and allowed by the shell's
 * `connect-src 'self'`, so the renderer can read back the very `woff2` files the
 * build emitted for it.
 *
 * Why the manifest is an argument and not an import: the face URLs only exist in
 * `virtual:bundled-fonts`, which only the renderer build can resolve. Taking it
 * as an argument keeps this module loadable in Vitest and keeps the whole export
 * directory free of the bundler coupling its boundary test forbids.
 *
 * Why the bytes are pulled lazily: the full face set is ~4.7 MB of
 * `ArrayBuffer`, and a session that never exports must not pay for it.
 * Installation touches the network zero times; the first
 * `prepareBundledFontEmbedding()` is what fetches, and it caches for the
 * session. Export commands await it before producing self-contained files.
 * The Slide authoring host now lives in the editor document and therefore uses
 * the same already-installed font faces without a second embedding path.
 *
 * A build that still never prepares resolves to no fonts and stays exactly as
 * small as it is today.
 */
import notoSansScLicense from '../../../vendor/fonts/noto-sans-sc/LICENSE?raw'
import stixTwoMathLicense from '../../../vendor/fonts/stix-two-math/LICENSE?raw'
import type {
  BundledFontFace,
  BundledFontFamily,
  BundledFontManifest,
} from '../../shared/fonts/bundledFontManifest'
import { unicodeRangeIntersects, type BundledFontCharacterUse } from './bundledFontSelection'
import {
  registerBundledFontEmbedPreparer,
  registerBundledFontEmbedSource,
  type EmbeddableBundledFont,
} from './bundledFontEmbedding'

/**
 * Verbatim OFL copies, keyed by the `noticePath` their family declares.
 *
 * Inlined rather than fetched: 8 KB of text is nothing next to the fonts, and
 * OFL 1.1 §2 only lets us ship the bytes together with these notices — a notice
 * that could fail to load separately would be a licensing hazard, not a
 * degraded feature. The keys are the descriptors' own paths, so a family added
 * without its license copy fails loudly instead of shipping unattributed bytes.
 */
const VENDORED_LICENSE_TEXTS: Readonly<Record<string, string>> = {
  'vendor/fonts/noto-sans-sc/LICENSE': notoSansScLicense,
  'vendor/fonts/stix-two-math/LICENSE': stixTwoMathLicense,
}

/** Everything the fetch source needs; only `manifest` has no sane default. */
export interface FetchBundledFontEmbedSourceOptions {
  /** Build-time manifest with every face URL resolved. */
  readonly manifest: BundledFontManifest
  /** Injected by tests. Production passes nothing and gets the global `fetch`. */
  readonly fetchResource?: (url: string) => Promise<Response>
  /** Injected by tests. Production passes nothing and gets the vendored copies. */
  readonly licenseTexts?: Readonly<Record<string, string>>
}

async function fetchBytes(
  fetchResource: (url: string) => Promise<Response>,
  url: string,
): Promise<Uint8Array> {
  const response = await fetchResource(url)
  if (!response.ok) {
    throw new Error(`内置字体读取失败（HTTP ${response.status}）：${url}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 4 || bytes[0] !== 0x77 || bytes[1] !== 0x4f || bytes[2] !== 0x46 || bytes[3] !== 0x32) {
    throw new Error(`内置字体地址没有返回可用 WOFF2 字节：${url}`)
  }
  return bytes
}

/**
 * Install the editor's byte source and its lazy warm-up.
 *
 * Idempotent in effect: calling it again replaces the registration with a fresh
 * cache, which is what a test wants and what production never does.
 */
export function installFetchBundledFontEmbedSource(
  options: FetchBundledFontEmbedSourceOptions,
): void {
  const { manifest } = options
  const licenseTexts = options.licenseTexts ?? VENDORED_LICENSE_TEXTS
  const fetchResource = options.fetchResource
    ?? ((url: string) => globalThis.fetch(url))
  const loaded = new Map<string, Uint8Array>()
  const pending = new Map<string, Promise<Uint8Array>>()
  const selectedFaces = (family: BundledFontFamily, use?: BundledFontCharacterUse) => use
    ? family.faces.filter(face => unicodeRangeIntersects(face.unicodeRange, use)) : family.faces

  const loadFace = (face: BundledFontFace): Promise<Uint8Array> => {
    const bytes = loaded.get(face.url)
    if (bytes) return Promise.resolve(bytes)
    const current = pending.get(face.url)
    if (current) return current
    const operation = fetchBytes(fetchResource, face.url).then(bytes => {
      loaded.set(face.url, bytes)
      return bytes
    }).finally(() => { pending.delete(face.url) })
    pending.set(face.url, operation)
    return operation
  }

  /**
   * All faces required by this payload for one family, or none of them.
   *
   * A partially embedded family is the worst outcome available: the export
   * looks self-contained but silently falls back for whichever code points its
   * missing slices covered. Failing the family as a whole keeps the failure
   * mode the one we already document — a machine-dependent lesson.
   */
  async function loadFamily(family: BundledFontFamily, use?: BundledFontCharacterUse): Promise<void> {
    const licenseText = licenseTexts[family.license.noticePath]
    if (licenseText === undefined) {
      throw new Error(`内置字体缺少许可正文：${family.license.noticePath}`)
    }
    await Promise.all(selectedFaces(family, use).map(loadFace))
  }

  registerBundledFontEmbedPreparer(async request => {
    const families = request ? manifest.families.filter(family => request.families.includes(family.family)) : manifest.families
    const results = await Promise.allSettled(families.map(family => loadFamily(family, request?.characterUse)))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        // Never throw: an export must not fail over typography.
        console.warn(
          `内置字体字节读取失败，导出不会嵌入 ${families[index]?.family ?? '未知字体'}`,
          result.reason,
        )
      }
    })
  })

  registerBundledFontEmbedSource((families, use) => families
    .map((name): EmbeddableBundledFont | undefined => {
      const family = manifest.families.find(value => value.family === name)
      if (!family) return undefined
      const licenseText = licenseTexts[family.license.noticePath]
      const required = selectedFaces(family, use)
      // A previous smaller payload must not make a later one appear covered.
      if (licenseText === undefined || required.some(face => !loaded.has(face.url))) return undefined
      const { faces: _descriptors, ...rest } = family
      return { ...rest, licenseText, faces: required.map(({ url, ...face }) => ({ ...face, bytes: loaded.get(url)! })) }
    })
    .filter((font): font is EmbeddableBundledFont => font !== undefined))
}
