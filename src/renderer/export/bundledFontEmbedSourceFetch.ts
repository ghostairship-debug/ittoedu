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
  BundledFontFamily,
  BundledFontManifest,
} from '../../shared/fonts/bundledFontManifest'
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
  return new Uint8Array(await response.arrayBuffer())
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
  const loaded = new Map<string, EmbeddableBundledFont>()
  let pending: Promise<void> | null = null

  /**
   * All faces of one family or none of them.
   *
   * A partially embedded family is the worst outcome available: the export
   * looks self-contained but silently falls back for whichever code points its
   * missing slices covered. Failing the family as a whole keeps the failure
   * mode the one we already document — a machine-dependent lesson.
   */
  async function loadFamily(family: BundledFontFamily): Promise<void> {
    if (loaded.has(family.family)) return
    const licenseText = licenseTexts[family.license.noticePath]
    if (licenseText === undefined) {
      throw new Error(`内置字体缺少许可正文：${family.license.noticePath}`)
    }
    const faces = await Promise.all(family.faces.map(async (face) => {
      const { url, ...descriptor } = face
      return { ...descriptor, bytes: await fetchBytes(fetchResource, url) }
    }))
    const { faces: _descriptors, ...rest } = family
    loaded.set(family.family, { ...rest, licenseText, faces })
  }

  async function loadAllFamilies(): Promise<void> {
    const results = await Promise.allSettled(manifest.families.map(loadFamily))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        // Never throw: an export must not fail over typography.
        console.warn(
          `内置字体字节读取失败，导出不会嵌入 ${manifest.families[index]?.family ?? '未知字体'}`,
          result.reason,
        )
      }
    })
  }

  registerBundledFontEmbedPreparer(() => {
    // One in-flight load per session, shared by concurrent exports. A load that
    // left a family behind is not memoized, so the next export retries it
    // instead of inheriting a transient failure for the rest of the session.
    pending ??= loadAllFamilies().finally(() => {
      if (loaded.size !== manifest.families.length) pending = null
    })
    return pending
  })

  registerBundledFontEmbedSource((families) => families
    .map((family) => loaded.get(family))
    .filter((font): font is EmbeddableBundledFont => font !== undefined))
}
