/**
 * Load every bundled face before anything measures text.
 *
 * Why this has to happen before the first frame: slide text is laid out
 * synchronously by `renderTextNodeCanvas`, and the Player bakes that
 * measurement into a GPU texture (`scene.textures.addCanvas`) which is only
 * repainted on an explicit update. Canvas 2D silently falls back to another
 * font while a webfont is still loading, so line breaks, auto-height and
 * auto-shrink would all be computed against the fallback metrics and then
 * frozen. That is worse than a visible reflow: the drift becomes permanent, and
 * DOM surfaces on the same page — which do reflow when the font arrives — end
 * up disagreeing with the canvas about metrics.
 *
 * Why `FontFace.load()` and not `document.fonts.load(spec, text)`: the latter
 * only loads faces whose `unicode-range` intersects the text it is given, and
 * we have no way to collect the text of a whole project up front. `load()` on
 * each face ignores `unicode-range` and pulls the full set from local disk.
 *
 * This module imports only the family constants, never the font assets, so the
 * Player runtime can depend on it without inlining any font bytes.
 */
import { BUNDLED_FONT_FAMILIES } from './bundledFontFamilies'

/** Structural view of a single `FontFace`. */
export interface LoadableFontFace {
  readonly family: string
  load(): Promise<unknown>
}

/** Structural view of `document.fonts`. */
export interface LoadableFontFaceSet {
  forEach(callback: (face: LoadableFontFace) => void): void
}

const BUNDLED_FAMILY_NAMES = new Set(BUNDLED_FONT_FAMILIES)

let bundledFontLoad: Promise<void> | null = null

/**
 * `FontFace.family` keeps whatever quoting the `@font-face` rule used, so
 * `'Noto Sans SC'` and `Noto Sans SC` both have to match.
 */
function normalizeFamily(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed)
  return (quoted?.[2] ?? trimmed).trim()
}

function documentFontFaceSet(): LoadableFontFaceSet | null {
  if (typeof document === 'undefined') return null
  const candidate = (document as Document & { fonts?: LoadableFontFaceSet }).fonts
  return candidate && typeof candidate.forEach === 'function' ? candidate : null
}

async function loadBundledFontFaces(fontSet: LoadableFontFaceSet | null): Promise<void> {
  if (!fontSet) return
  const targets: LoadableFontFace[] = []
  fontSet.forEach((face) => {
    if (BUNDLED_FAMILY_NAMES.has(normalizeFamily(face.family))) {
      targets.push(face)
    }
  })
  if (targets.length === 0) return

  // `async` wrapper so a synchronous throw from `load()` becomes a rejection
  // instead of escaping the batch.
  const results = await Promise.allSettled(targets.map(async (face) => face.load()))
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failures.length > 0) {
    // Never block boot on a font. A missing face degrades typography; a thrown
    // error here would leave the editor or the lesson with no UI at all.
    console.warn(
      `内置字体有 ${failures.length}/${targets.length} 个切片加载失败，排版可能回退到系统字体`,
      failures[0]?.reason,
    )
  }
}

/**
 * Load every bundled face registered on the document.
 *
 * Idempotent and concurrency-safe: the first call starts the work and every
 * later call awaits the same promise, so the faces are never requested twice.
 * The returned promise always resolves — font failures are reported, not
 * thrown, because no caller may refuse to boot over typography.
 *
 * `fontSet` exists for tests; production callers pass nothing and get
 * `document.fonts`. It is only consulted on the call that starts the load.
 */
export function ensureBundledFonts(fontSet?: LoadableFontFaceSet | null): Promise<void> {
  bundledFontLoad ??= loadBundledFontFaces(fontSet ?? documentFontFaceSet())
  return bundledFontLoad
}
