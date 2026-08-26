/**
 * `@font-face` generation for the bundled families.
 *
 * We write these rules ourselves instead of importing the upstream Fontsource
 * `index.css` files for two reasons:
 *
 * 1. The math stylesheet restricts its face to a Latin `unicode-range`, which
 *    would silently push every math symbol back to the fallback serif even
 *    though the shipped file has glyphs for them.
 * 2. The upstream text stylesheet declares the family as
 *    `Noto Sans SC Variable`, while the binary itself reports
 *    `Noto Sans SC Thin`. Neither is a name a document would ask for, so the
 *    family name has to be ours.
 *
 * Pure and bundler-free so the output can be asserted in unit tests.
 */
import type { BundledFontManifest } from './bundledFontManifest'

/** `format('woff2')` covers variable woff2 in every current engine. The legacy
 * `format('woff2-variations')` string that Fontsource emits is not recognised
 * everywhere, and an unrecognised format makes the whole `src` entry be
 * skipped — which is exactly the portability failure we are removing. */
const FONT_FORMAT = "format('woff2')"

function faceBlock(
  family: BundledFontManifest['families'][number],
  face: BundledFontManifest['families'][number]['faces'][number],
): string {
  const declarations = [
    `  font-family: '${family.family}';`,
    `  font-style: ${family.style};`,
    `  font-display: ${family.display};`,
    `  font-weight: ${family.weight};`,
    `  src: url(${face.url}) ${FONT_FORMAT};`,
  ]
  if (face.unicodeRange) {
    declarations.push(`  unicode-range: ${face.unicodeRange};`)
  }
  return `/* ${family.family} · ${face.file} */\n@font-face {\n${declarations.join('\n')}\n}`
}

/** Render the complete `@font-face` stylesheet for a resolved manifest. */
export function buildBundledFontFaceCss(manifest: BundledFontManifest): string {
  const blocks = manifest.families.flatMap((family) =>
    family.faces.map((face) => faceBlock(family, face)),
  )
  if (blocks.length === 0) {
    throw new Error('内置字体清单为空，无法生成 @font-face')
  }
  return `${blocks.join('\n\n')}\n`
}
