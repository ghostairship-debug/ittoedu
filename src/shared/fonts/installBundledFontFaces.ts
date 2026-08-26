/**
 * Register the bundled `@font-face` rules on a document.
 *
 * The rules are injected rather than imported as a stylesheet because their
 * URLs only exist after the build has emitted the assets, and because the same
 * manifest has to serve the export path later. Injection must happen before
 * `ensureBundledFonts()`: that helper walks `document.fonts`, which is only
 * populated once the rules are parsed.
 *
 * Pulls in the font assets through `bundledFontAssets` — renderer side only.
 */
import { BUNDLED_FONT_MANIFEST } from './bundledFontAssets'
import { buildBundledFontFaceCss } from './bundledFontFaceCss'

/** `id` of the injected style element, also its idempotence key. */
export const BUNDLED_FONT_STYLE_ELEMENT_ID = 'bundled-font-faces'

/** Inject the bundled `@font-face` rules once. Safe to call repeatedly. */
export function installBundledFontFaces(target: Document = document): void {
  if (target.getElementById(BUNDLED_FONT_STYLE_ELEMENT_ID)) return
  const style = target.createElement('style')
  style.id = BUNDLED_FONT_STYLE_ELEMENT_ID
  style.textContent = buildBundledFontFaceCss(BUNDLED_FONT_MANIFEST)
  target.head.append(style)
  // Faces declared in CSS only join `document.fonts` once style has been
  // resolved. `ensureBundledFonts()` runs on the very next statement and walks
  // that set, so force the resolution here instead of racing it.
  void target.defaultView?.getComputedStyle(target.documentElement).fontFamily
}
