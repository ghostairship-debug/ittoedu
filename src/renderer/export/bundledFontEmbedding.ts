/**
 * Embedding the bundled fonts a project actually uses into export products.
 *
 * Why the export path has to declare the faces itself: the Player is built as a
 * single IIFE and Vite's library mode inlines every asset it imports as base64,
 * so a font import inside the Player would land, base64-expanded, inside every
 * exported lesson whether or not that lesson uses the font. The Player therefore
 * only loads faces its host document declares (`ensureBundledFonts`), and the
 * host document is what this module writes.
 *
 * A bundled family is embedded on either of two triggers.
 *   - The project declares it in a font stack. The default project keeps the
 *     Microsoft YaHei chain, declares no bundled family, and therefore still
 *     produces byte-identical exports.
 *   - The project contains a formula node. `STIX Two Math` heads the formula
 *     renderer's chain (`MATH_FONT_FAMILY`) and that chain is a module constant,
 *     never a document property, so no declaration walk can ever find it. The
 *     node's presence is the declaration.
 *
 * This module is pure and import-safe in every host: it pulls in no font bytes,
 * no `node:` builtin and no bundler-specific module. The bytes arrive through
 * `registerBundledFontEmbedSource`, which keeps the filesystem out of the
 * renderer bundle (see `bundledFontEmbedSourceNode.ts` for the Node host and
 * `bundledFontEmbedSourceFetch.ts` for the sandboxed editor).
 */
import { bytesToDataUrl } from './base64'
import {
  BUNDLED_FONT_FAMILIES,
  BUNDLED_MATH_FONT_FAMILY,
} from '../../shared/fonts/bundledFontFamilies'
import { buildBundledFontFaceCss } from '../../shared/fonts/bundledFontFaceCss'
import type {
  BundledFontFaceDescriptor,
  BundledFontFamilyDescriptor,
  BundledFontManifest,
} from '../../shared/fonts/bundledFontManifest'

/** One `woff2` file with the bytes an export product has to carry. */
export interface EmbeddableBundledFontFace extends BundledFontFaceDescriptor {
  readonly bytes: Uint8Array
}

/** One bundled family, resolved down to bytes and its verbatim license text. */
export interface EmbeddableBundledFont
  extends Omit<BundledFontFamilyDescriptor, 'faces'> {
  /** Verbatim copy of `license.noticePath`; OFL 1.1 requires shipping it. */
  readonly licenseText: string
  readonly faces: readonly EmbeddableBundledFontFace[]
}

/** Resolves the requested bundled families down to bytes. */
export type BundledFontEmbedSource = (
  families: readonly string[],
) => readonly EmbeddableBundledFont[]

/**
 * Brings a byte source into a state where its synchronous resolution can answer.
 *
 * Every export builder is synchronous — the products are strings and byte maps
 * assembled in one pass — so a host whose bytes only arrive asynchronously has
 * nowhere to await inside the build. This is that await, hoisted out to the
 * export command (see `prepareBundledFontEmbedding`).
 */
export type BundledFontEmbedPreparer = () => Promise<void>

const BUNDLED_FAMILY_BY_LOWERCASE = new Map(
  BUNDLED_FONT_FAMILIES.map((family) => [family.toLowerCase(), family]),
)

/** Node discriminants that mean "a formula is rendered here". */
const FORMULA_DISCRIMINANT_KEYS = new Set(['type', 'nativeType'])

let embedSource: BundledFontEmbedSource | null = null
let embedPreparer: BundledFontEmbedPreparer | null = null

/**
 * Install the byte source used by every export from now on.
 *
 * Exports embed nothing until a host registers one. That default is deliberate:
 * the renderer runs sandboxed with no filesystem access, so a host that cannot
 * produce font bytes must still produce a valid — if machine-dependent —
 * lesson rather than fail the export.
 */
export function registerBundledFontEmbedSource(
  source: BundledFontEmbedSource | null,
): void {
  embedSource = source
}

/** Install the warm-up step `prepareBundledFontEmbedding` runs from now on. */
export function registerBundledFontEmbedPreparer(
  preparer: BundledFontEmbedPreparer | null,
): void {
  embedPreparer = preparer
}

/**
 * Warm the registered byte source, so the next synchronous export can embed.
 *
 * Export commands await this before they build. Hosts whose source is already
 * synchronous register no preparer and get an immediately resolved promise, so
 * the call is free for them.
 *
 * Never rejects. A host that cannot read its font bytes must still produce a
 * valid — if machine-dependent — lesson rather than fail the export, which is
 * the same policy as having no source registered at all. The preparer is
 * expected to report its own failures; this only guards against one escaping.
 */
export async function prepareBundledFontEmbedding(): Promise<void> {
  if (embedPreparer === null) return
  try {
    await embedPreparer()
  } catch (error) {
    console.warn('内置字体字节准备失败，导出将不嵌入内置字体', error)
  }
}

/**
 * Split a CSS `font-family` value into its declared names.
 *
 * Quoted names keep their inner commas and spaces; unquoted identifiers are
 * trimmed. Escapes are not unfolded — no bundled family name needs one.
 */
export function parseCssFontStack(value: string): string[] {
  const names: string[] = []
  let current = ''
  let quote: string | null = null
  for (const character of value) {
    if (quote !== null) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === ',') {
      names.push(current)
      current = ''
      continue
    }
    current += character
  }
  names.push(current)
  return names.map((name) => name.trim()).filter((name) => name.length > 0)
}

/**
 * Every bundled family the payload needs, in manifest order.
 *
 * The walk keys on the `fontFamily` property name rather than on a list of
 * document paths, so it covers a text node's `style.fontFamily`, a run-level
 * override, a presentation-state override, a flow block run, a design token and
 * any component prop that names a font — without having to be taught each new
 * surface. Only object graphs are traversed, so the base64 asset payloads cost
 * nothing.
 *
 * The math family cannot be found that way and needs the second rule. A formula
 * carries no font of its own — `FormulaNode.style` is `fontSize/color/align` —
 * because the renderer's chain is one module constant shared by the editor, the
 * Player, the PPTX rasterizer and the PDF. So the node itself is the trigger:
 * `type: 'formula'` for a V8 lesson node, `nativeType: 'formula'` for a V9
 * layer item, both of which survive into the published payloads.
 */
export function collectBundledFontFamiliesInUse(value: unknown): string[] {
  const found = new Set<string>()
  const visited = new WeakSet<object>()
  const pending: unknown[] = [value]

  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current !== 'object' || current === null) continue
    if (visited.has(current)) continue
    visited.add(current)

    if (Array.isArray(current)) {
      for (const item of current) {
        if (typeof item === 'object' && item !== null) pending.push(item)
      }
      continue
    }

    for (const [key, entry] of Object.entries(current)) {
      if (key === 'fontFamily' && typeof entry === 'string') {
        for (const name of parseCssFontStack(entry)) {
          const bundled = BUNDLED_FAMILY_BY_LOWERCASE.get(name.toLowerCase())
          if (bundled) found.add(bundled)
        }
        continue
      }
      if (entry === 'formula' && FORMULA_DISCRIMINANT_KEYS.has(key)) {
        found.add(BUNDLED_MATH_FONT_FAMILY)
        continue
      }
      if (typeof entry === 'object' && entry !== null) pending.push(entry)
    }
  }

  return BUNDLED_FONT_FAMILIES.filter((family) => found.has(family))
}

/**
 * Resolve the bundled fonts a payload has to carry.
 *
 * Returns an empty list when the payload declares no bundled family or when no
 * host registered a byte source; both cases must leave the export product
 * exactly as it was before fonts existed.
 */
export function resolveEmbeddedBundledFonts(
  payload: unknown,
): readonly EmbeddableBundledFont[] {
  const families = collectBundledFontFamiliesInUse(payload)
  if (families.length === 0 || embedSource === null) return []
  return embedSource(families)
}

function manifestWith(
  fonts: readonly EmbeddableBundledFont[],
  urlOf: (font: EmbeddableBundledFont, face: EmbeddableBundledFontFace) => string,
): BundledFontManifest {
  return {
    families: fonts.map((font) => ({
      ...font,
      faces: font.faces.map((face) => ({ ...face, url: urlOf(font, face) })),
    })),
  }
}

/**
 * `@font-face` rules whose sources are `data:` URIs, for a single-file export.
 *
 * The rules themselves come from the same generator the editor uses, so the
 * exported document cannot drift from the authoring environment in family name,
 * weight axis or `unicode-range`.
 */
export function bundledFontDataUrlCss(
  fonts: readonly EmbeddableBundledFont[],
): string {
  if (fonts.length === 0) return ''
  return buildBundledFontFaceCss(
    manifestWith(fonts, (_font, face) => bytesToDataUrl(face.bytes, 'font/woff2')),
  )
}

/**
 * Append generated font rules to a stylesheet.
 *
 * The empty case has to leave the stylesheet untouched down to the byte: a
 * project that declares no bundled family must export exactly what it exported
 * before this feature existed.
 */
export function withBundledFontCss(stylesheet: string, fontCss: string): string {
  return fontCss === '' ? stylesheet : `${stylesheet}\n\n${fontCss}`
}

/**
 * `@font-face` rules pointing at sibling files, for an extracted package.
 *
 * `urlPrefix` is resolved against the stylesheet, not against the package root,
 * because that is what a relative `url()` means; the caller pairs it with the
 * archive directory it passes to `bundledFontPackageFiles`.
 */
export function bundledFontRelativeUrlCss(
  fonts: readonly EmbeddableBundledFont[],
  urlPrefix: string,
): string {
  if (fonts.length === 0) return ''
  return buildBundledFontFaceCss(
    manifestWith(fonts, (_font, face) => `${urlPrefix}/${face.file}`),
  )
}

/** The `woff2` files an extracted package has to contain, keyed by archive path. */
export function bundledFontPackageFiles(
  fonts: readonly EmbeddableBundledFont[],
  directory: string,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  for (const font of fonts) {
    for (const face of font.faces) {
      files[`${directory}/${face.file}`] = face.bytes
    }
  }
  return files
}

function embeddedByteLength(font: EmbeddableBundledFont): number {
  return font.faces.reduce((total, face) => total + face.bytes.byteLength, 0)
}

const NOTICE_HEADLINE =
  '本导出物内嵌了下列开源字体，其版权与许可声明逐字附于其后。'
const NOTICE_HEADLINE_EN =
  'This export embeds the open licensed fonts below. Their verbatim copyright and license notices follow.'

function noticeSections(
  fonts: readonly EmbeddableBundledFont[],
  heading: (font: EmbeddableBundledFont) => string,
  bullet: (label: string, value: string) => string,
  location: string,
): string[] {
  return fonts.map((font) => [
    heading(font),
    '',
    bullet('Package', `${font.license.packageName} ${font.license.packageVersion}`),
    bullet('License', font.license.type),
    bullet('Copyright', font.license.attribution),
    bullet(
      'Embedded',
      `${font.faces.length} woff2 (${embeddedByteLength(font)} bytes) ${location}`,
    ),
    '',
    font.licenseText.trimEnd(),
  ].join('\n'))
}

/**
 * The notice block for a single-file export.
 *
 * A comment is the only carrier a one-file product has, and `view source` makes
 * it reachable without extra tooling. `-->` inside the license text would end
 * the comment early; the vendored OFL copies contain none, and the replacement
 * keeps that from becoming a silent truncation if an upstream text ever does.
 */
export function bundledFontNoticeHtmlComment(
  fonts: readonly EmbeddableBundledFont[],
): string {
  if (fonts.length === 0) return ''
  const body = [
    NOTICE_HEADLINE,
    NOTICE_HEADLINE_EN,
    '',
    ...noticeSections(
      fonts,
      (font) => `== ${font.family} ==`,
      (label, value) => `${label}: ${value}`,
      'inline as data: URIs',
    ),
  ].join('\n')
  return `\n<!--\n${body.replaceAll('-->', '--&gt;')}\n-->`
}

/**
 * `THIRD_PARTY_NOTICES.md` for an extracted package.
 *
 * Same shape as the tracked `THIRD_PARTY_NOTICES_V9.md` benchmark notice, so a
 * reader who has seen one recognises the other.
 */
export function bundledFontNoticeMarkdown(
  fonts: readonly EmbeddableBundledFont[],
  directory: string,
): string {
  if (fonts.length === 0) return ''
  const body = [
    '# Third-party font notices',
    '',
    NOTICE_HEADLINE,
    NOTICE_HEADLINE_EN,
    '',
    ...noticeSections(
      fonts,
      (font) => `## ${font.family}`,
      (label, value) => `- ${label}: ${value}`,
      `in \`${directory}/\``,
    ),
  ].join('\n')
  return `${body}\n`
}
