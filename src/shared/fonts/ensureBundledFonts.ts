/**
 * Precision measurements prepare their current CSS font specs and characters.
 * This avoids freezing fallback metrics while loading only the unicode slices
 * needed in the actual Document. Explicit all-face callers retain the original
 * ensureBundledFonts API; editor startup uses declarations alone.
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

const bundledFontLoads = new WeakMap<LoadableFontFaceSet, Promise<void>>()

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
 * later call for that same FontFaceSet awaits its promise.
 * The returned promise always resolves — font failures are reported, not
 * thrown, because no caller may refuse to boot over typography.
 *
 * Explicit all-face consumers retain this API. New precision consumers use
 * prepareTextFonts with their current spec/text instead.
 */
export function ensureBundledFonts(fontSet?: LoadableFontFaceSet | null): Promise<void> {
  const target = fontSet === undefined ? documentFontFaceSet() : fontSet
  if (!target) return Promise.resolve()
  let pending = bundledFontLoads.get(target)
  if (!pending) { pending = loadBundledFontFaces(target); bundledFontLoads.set(target, pending) }
  return pending
}

export interface TextFontRequest { readonly font: string; readonly text: string }
export interface TextFontFaceSet {
  load(font: string, text?: string): Promise<unknown>
  check?(font: string, text?: string): boolean
}

/** Prepare only the faces needed by this text in its actual measuring realm.
 * The browser owns face caching; a later character or style is checked again. */
export function prepareTextFonts(requests: readonly TextFontRequest[], fonts: TextFontFaceSet | null | undefined): Promise<void> | undefined {
  if (!fonts?.load) return undefined
  const grouped = new Map<string, string>()
  for (const { font, text } of requests) if (text) grouped.set(font, (grouped.get(font) ?? '') + text)
  const pending: Promise<unknown>[] = []
  for (const [font, text] of grouped) {
    if (fonts.check?.(font, text)) continue
    pending.push(fonts.load(font, text))
  }
  return pending.length ? Promise.all(pending).then(() => {}) : undefined
}

/** Read the rendered run styles, including formula glyphs and inherited fonts. */
export function elementTextFontRequests(element: HTMLElement): TextFontRequest[] {
  const dom = element.ownerDocument, view = dom.defaultView
  if (!view) return []
  const requests: TextFontRequest[] = [], walker = dom.createTreeWalker(element, 4 /* SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent, parent = node.parentElement
    if (!text || !parent) continue
    const style = view.getComputedStyle(parent)
    const font = style.font || `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize || '16px'} ${style.fontFamily || 'sans-serif'}`
    requests.push({ font, text })
  }
  return requests
}
