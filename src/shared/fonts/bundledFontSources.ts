/**
 * Build-time resolution of the bundled font descriptors.
 *
 * BUILD-TIME ONLY. This module reads `node_modules` through `node:fs`; it must
 * never be imported from renderer or Player runtime code. It is consumed by the
 * Vite plugin that generates the `virtual:bundled-fonts` module and by the unit
 * tests that lock the generated CSS down.
 *
 * The slice list is read from the upstream `unicode.json` rather than being
 * copied into this repository, so a font upgrade cannot silently leave the
 * declared slices behind the shipped files.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUNDLED_MATH_FONT_FAMILY,
  BUNDLED_MATH_FONT_WEIGHT,
  BUNDLED_TEXT_FONT_FAMILY,
  BUNDLED_TEXT_FONT_WEIGHT_RANGE,
} from './bundledFontFamilies'
import type {
  BundledFontFaceDescriptor,
  BundledFontFamilyDescriptor,
} from './bundledFontManifest'

const TEXT_FONT_PACKAGE = '@fontsource-variable/noto-sans-sc'
const MATH_FONT_PACKAGE = '@fontsource/stix-two-math'
const MATH_FONT_FILE = 'stix-two-math-latin-400-normal.woff2'

/**
 * `swap` over `block`: both callers await the faces before their first paint,
 * so the swap period is never entered in practice. Should a load fail anyway,
 * `swap` still paints readable fallback text instead of hiding it for 3s.
 */
const FONT_DISPLAY = 'swap'

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function packageVersion(packageDirectory: string): string {
  const manifest = readJson(join(packageDirectory, 'package.json'))
  const version = (manifest as { version?: unknown }).version
  if (typeof version !== 'string' || !version) {
    throw new Error(`内置字体包缺少 version：${packageDirectory}`)
  }
  return version
}

function woff2FileNames(filesDirectory: string): string[] {
  return readdirSync(filesDirectory).filter((name) => name.endsWith('.woff2'))
}

/**
 * Upstream keys are either a numeric slice (`[42]`) or a named subset
 * (`latin-ext`); both map onto `noto-sans-sc-<id>-wght-normal.woff2`.
 */
function textFaceFileName(unicodeKey: string): string {
  const id = unicodeKey.replace(/^\[/, '').replace(/\]$/, '')
  return `noto-sans-sc-${id}-wght-normal.woff2`
}

function resolveTextFamily(nodeModulesDirectory: string): BundledFontFamilyDescriptor {
  const packageDirectory = join(nodeModulesDirectory, TEXT_FONT_PACKAGE)
  const filesDirectory = join(packageDirectory, 'files')
  const ranges = readJson(join(packageDirectory, 'unicode.json')) as Record<string, unknown>
  const available = new Set(woff2FileNames(filesDirectory))

  const faces: BundledFontFaceDescriptor[] = Object.entries(ranges).map(([key, range]) => {
    const file = textFaceFileName(key)
    if (!available.has(file)) {
      throw new Error(`内置字体切片缺少文件：${TEXT_FONT_PACKAGE}/files/${file}`)
    }
    if (typeof range !== 'string' || !range) {
      throw new Error(`内置字体切片缺少 unicode-range：${file}`)
    }
    return {
      file,
      specifier: `${TEXT_FONT_PACKAGE}/files/${file}`,
      // Kept per slice: these ranges are how the browser fetches only the
      // slices a lesson actually needs. Unlike the math family, dropping them
      // would force all 4.3 MB through one face for every code point.
      unicodeRange: range,
    }
  })

  if (faces.length !== available.size) {
    throw new Error(
      `内置字体切片数量与文件数量不一致：unicode.json ${faces.length} 个，files/ ${available.size} 个`,
    )
  }

  return {
    family: BUNDLED_TEXT_FONT_FAMILY,
    style: 'normal',
    weight: BUNDLED_TEXT_FONT_WEIGHT_RANGE,
    display: FONT_DISPLAY,
    license: {
      type: 'OFL-1.1',
      // Verbatim `nameID 0` of the shipped slices, not the distributor. Noto
      // Sans SC descends from Source Han Sans, so the copyright is Adobe's and
      // OFL 1.1 §3 reserves `Source` — the upstream Fontsource `LICENSE` drops
      // both and names Google instead. `bundledFonts.test.ts` reads the name
      // table out of a real `.woff2` to keep this honest.
      attribution: "(c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.",
      noticePath: 'vendor/fonts/noto-sans-sc/LICENSE',
      packageName: TEXT_FONT_PACKAGE,
      packageVersion: packageVersion(packageDirectory),
    },
    faces: faces.sort((left, right) => left.file.localeCompare(right.file, 'en')),
  }
}

function resolveMathFamily(nodeModulesDirectory: string): BundledFontFamilyDescriptor {
  const packageDirectory = join(nodeModulesDirectory, MATH_FONT_PACKAGE)
  const available = new Set(woff2FileNames(join(packageDirectory, 'files')))
  if (!available.has(MATH_FONT_FILE)) {
    throw new Error(`内置数学字体缺少文件：${MATH_FONT_PACKAGE}/files/${MATH_FONT_FILE}`)
  }

  return {
    family: BUNDLED_MATH_FONT_FAMILY,
    style: 'normal',
    weight: BUNDLED_MATH_FONT_WEIGHT,
    display: FONT_DISPLAY,
    license: {
      type: 'OFL-1.1',
      attribution:
        'Copyright 2001-2021 The STIX Fonts Project Authors (https://github.com/stipub/stixfonts)',
      noticePath: 'vendor/fonts/stix-two-math/LICENSE',
      packageName: MATH_FONT_PACKAGE,
      packageVersion: packageVersion(packageDirectory),
    },
    faces: [
      {
        file: MATH_FONT_FILE,
        specifier: `${MATH_FONT_PACKAGE}/files/${MATH_FONT_FILE}`,
        // No `unicodeRange` on purpose. The upstream stylesheet restricts this
        // face to U+0000-00FF and a handful of extras, which would send every
        // math symbol (∑ ∫ √ ≤ α π ∞) back to the fallback serif even though
        // the file carries glyphs for all of them. The file is untouched, so
        // the OFL terms are unaffected; only our own descriptor differs.
      },
    ],
  }
}

/** Resolve every bundled family from an installed `node_modules` directory. */
export function resolveBundledFontDescriptors(
  nodeModulesDirectory: string,
): BundledFontFamilyDescriptor[] {
  return [resolveTextFamily(nodeModulesDirectory), resolveMathFamily(nodeModulesDirectory)]
}

/** Every face specifier, flattened in the manifest's declaration order. */
export function bundledFontFaceSpecifiers(
  descriptors: readonly BundledFontFamilyDescriptor[],
): string[] {
  return descriptors.flatMap((descriptor) => descriptor.faces.map((face) => face.specifier))
}
