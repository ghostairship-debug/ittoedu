import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { create as createFont } from 'fontkit'
import { describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_FONT_FAMILIES,
  BUNDLED_MATH_FONT_FAMILY,
  BUNDLED_TEXT_FONT_FAMILY,
} from '../../src/shared/fonts/bundledFontFamilies'
import { buildBundledFontFaceCss } from '../../src/shared/fonts/bundledFontFaceCss'
import {
  assembleBundledFontManifest,
  countBundledFontFaces,
  type BundledFontFamilyDescriptor,
  type BundledFontManifest,
} from '../../src/shared/fonts/bundledFontManifest'
import {
  bundledFontFaceSpecifiers,
  resolveBundledFontDescriptors,
} from '../../src/shared/fonts/bundledFontSources'
import type { LoadableFontFace } from '../../src/shared/fonts/ensureBundledFonts'

const repoRoot = resolve(__dirname, '..', '..')
const nodeModules = join(repoRoot, 'node_modules')

function descriptors(): BundledFontFamilyDescriptor[] {
  return resolveBundledFontDescriptors(nodeModules)
}

/** Build the manifest the way the Vite plugin does, with predictable URLs. */
function manifest(): BundledFontManifest {
  const resolved = descriptors()
  const urls = bundledFontFaceSpecifiers(resolved).map(
    (_specifier, index) => `./assets/font-${index}.woff2`,
  )
  return assembleBundledFontManifest(resolved, urls)
}

function familyOf(source: BundledFontManifest, family: string): BundledFontManifest['families'][number] {
  const found = source.families.find((candidate) => candidate.family === family)
  expect(found, family).toBeDefined()
  return found!
}

/** All `@font-face` blocks in the generated stylesheet, split apart. */
function faceBlocks(css: string): string[] {
  return [...css.matchAll(/@font-face \{[^}]*\}/g)].map((match) => match[0])
}

describe('bundled font manifest', () => {
  it('resolves both families from the installed packages', () => {
    const resolved = manifest()
    expect(resolved.families.map((family) => family.family)).toEqual([
      BUNDLED_TEXT_FONT_FAMILY,
      BUNDLED_MATH_FONT_FAMILY,
    ])
    expect(familyOf(resolved, BUNDLED_TEXT_FONT_FAMILY).faces).toHaveLength(101)
    expect(familyOf(resolved, BUNDLED_MATH_FONT_FAMILY).faces).toHaveLength(1)
    expect(countBundledFontFaces(resolved)).toBe(102)
  })

  it('credits whoever the shipped bytes credit, and ships the OFL terms untouched', () => {
    for (const family of manifest().families) {
      expect(family.license.type).toBe('OFL-1.1')

      // The holder is read out of a face we actually deliver, never out of the
      // distributor's notice. Fontsource credits `Google Inc.` for Noto Sans
      // SC, which descends from Source Han Sans and is Adobe's with `Source`
      // reserved; comparing our copy against theirs only ever proved that two
      // copies of the same mistake match. One face per family is enough —
      // `resolveBundledFontDescriptors` already fails if the file set drifts
      // from the single pinned package the slices come from.
      const face = family.faces[0]!
      const shipped = createFont(
        readFileSync(join(nodeModules, family.license.packageName, 'files', face.file)),
      )
      expect(family.license.attribution, family.family).toBe(shipped.copyright)

      const notice = readFileSync(join(repoRoot, family.license.noticePath), 'utf8')
      const [heading, ...body] = notice.split(/\r?\n/)
      expect(heading, `${family.family} 的许可正文首行`).toBe(shipped.copyright)
      expect(notice).toContain('SIL Open Font License, Version 1.1')

      // OFL 1.1 §2 lets us restate the copyright line correctly; it does not
      // let us reword the terms. Everything below the heading stays byte-equal
      // to the upstream package.
      const upstream = readFileSync(
        join(nodeModules, family.license.packageName, 'LICENSE'),
        'utf8',
      )
      expect(body.join('\n'), `${family.family} 的 OFL 正文`)
        .toBe(upstream.split(/\r?\n/).slice(1).join('\n'))
    }
  })

  it('fails loudly when the generated URL count drifts from the descriptors', () => {
    const resolved = descriptors()
    expect(() => assembleBundledFontManifest(resolved, ['./only-one.woff2'])).toThrow(
      /缺少构建产物 URL|数量与清单不一致/,
    )
  })
})

describe('bundled @font-face generation', () => {
  it('leaves the math face unrestricted so math symbols never fall back', () => {
    const css = buildBundledFontFaceCss(manifest())
    const mathBlocks = faceBlocks(css).filter((block) =>
      block.includes(`font-family: '${BUNDLED_MATH_FONT_FAMILY}'`),
    )
    expect(mathBlocks).toHaveLength(1)
    // The upstream stylesheet restricts this face to U+0000-00FF, which would
    // send ∑ ∫ √ ≤ α π ∞ back to the fallback serif. Our rule must carry no
    // range at all.
    expect(mathBlocks[0]).not.toContain('unicode-range')
    expect(mathBlocks[0]).toContain('font-weight: 400;')
  })

  it('declares the whole variable weight axis for the text family', () => {
    const css = buildBundledFontFaceCss(manifest())
    const textBlocks = faceBlocks(css).filter((block) =>
      block.includes(`font-family: '${BUNDLED_TEXT_FONT_FAMILY}'`),
    )
    expect(textBlocks).toHaveLength(101)
    for (const block of textBlocks) {
      // The binary reports `Noto Sans SC Thin` internally, so the axis has to
      // be declared here or the browser will not instantiate 400/700.
      expect(block).toContain('font-weight: 100 900;')
      // Slice ranges stay: they are the intended lazy-loading mechanism.
      expect(block).toMatch(/unicode-range: U\+/)
    }
  })

  it('uses a format string every engine understands', () => {
    const css = buildBundledFontFaceCss(manifest())
    expect(css).not.toContain('woff2-variations')
    expect(faceBlocks(css)).toHaveLength(102)
    for (const block of faceBlocks(css)) {
      expect(block).toContain("format('woff2')")
      expect(block).toContain('font-display: swap;')
    }
  })
})

describe('bundled math font coverage gate', () => {
  // Regression lock for the decision that made STIX Two Math acceptable: the
  // file is named `latin` but carries the full math repertoire. A font upgrade
  // that silently drops these code points must fail here rather than in a
  // classroom.
  const MATH_CODE_POINTS: readonly [string, number][] = [
    ['∑ U+2211', 0x2211],
    ['∫ U+222b', 0x222b],
    ['√ U+221a', 0x221a],
    ['≤ U+2264', 0x2264],
    ['α U+03b1', 0x03b1],
    ['π U+03c0', 0x03c0],
    ['∞ U+221e', 0x221e],
    ['± U+00b1', 0x00b1],
  ]

  it('has glyphs for every math code point the decision gate checked', () => {
    const mathFamily = familyOf(manifest(), BUNDLED_MATH_FONT_FAMILY)
    const face = mathFamily.faces[0]!
    // `create` rather than `openSync`: the browser build of fontkit, which both
    // TypeScript's bundler resolution and Vitest can pick, only exports `create`.
    const font = createFont(
      readFileSync(join(nodeModules, mathFamily.license.packageName, 'files', face.file)),
    )

    const missing = MATH_CODE_POINTS.filter(([, codePoint]) => !font.hasGlyphForCodePoint(codePoint))
      .map(([label]) => label)
    expect(missing).toEqual([])
    expect(font.numGlyphs).toBeGreaterThan(4000)
  })
})

describe('ensureBundledFonts', () => {
  interface FakeFace extends LoadableFontFace {
    readonly calls: () => number
  }

  function fakeFace(family: string, resolveLoad = true): FakeFace {
    let calls = 0
    return {
      family,
      calls: () => calls,
      load: () => {
        calls += 1
        return resolveLoad ? Promise.resolve({}) : Promise.reject(new Error('offline'))
      },
    }
  }

  function fakeFontSet(faces: readonly LoadableFontFace[]) {
    return {
      forEach(callback: (face: LoadableFontFace) => void): void {
        faces.forEach((face) => callback(face))
      },
    }
  }

  async function freshModule() {
    vi.resetModules()
    return import('../../src/shared/fonts/ensureBundledFonts')
  }

  it('loads bundled faces and ignores everything else', async () => {
    const { ensureBundledFonts } = await freshModule()
    const bundled = fakeFace(BUNDLED_TEXT_FONT_FAMILY)
    const quoted = fakeFace(`'${BUNDLED_MATH_FONT_FAMILY}'`)
    const foreign = fakeFace('Microsoft YaHei')

    await ensureBundledFonts(fakeFontSet([bundled, quoted, foreign]))

    expect(bundled.calls()).toBe(1)
    // `FontFace.family` keeps the quoting of the rule it came from.
    expect(quoted.calls()).toBe(1)
    expect(foreign.calls()).toBe(0)
  })

  it('is idempotent across repeated awaits', async () => {
    const { ensureBundledFonts } = await freshModule()
    const face = fakeFace(BUNDLED_TEXT_FONT_FAMILY)
    const fontSet = fakeFontSet([face])

    await ensureBundledFonts(fontSet)
    await ensureBundledFonts(fontSet)
    await ensureBundledFonts(fontSet)

    expect(face.calls()).toBe(1)
  })

  it('triggers a single load for concurrent callers and shares the promise', async () => {
    const { ensureBundledFonts } = await freshModule()
    let release: (() => void) | undefined
    let calls = 0
    const gated: LoadableFontFace = {
      family: BUNDLED_TEXT_FONT_FAMILY,
      load: () => {
        calls += 1
        return new Promise<void>((resolveLoad) => {
          release = resolveLoad
        })
      },
    }
    const fontSet = fakeFontSet([gated])

    const first = ensureBundledFonts(fontSet)
    const second = ensureBundledFonts(fontSet)
    const third = ensureBundledFonts(fontSet)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(calls).toBe(1)

    release?.()
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(calls).toBe(1)
  })

  it('resolves without a font set, so a host without document.fonts still boots', async () => {
    const { ensureBundledFonts } = await freshModule()
    await expect(ensureBundledFonts(null)).resolves.toBeUndefined()
  })

  it('never rejects when a face fails to load', async () => {
    const { ensureBundledFonts } = await freshModule()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = fakeFace(BUNDLED_MATH_FONT_FAMILY, false)

    await expect(ensureBundledFonts(fakeFontSet([broken]))).resolves.toBeUndefined()

    expect(broken.calls()).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('bundled font asset boundary', () => {
  // The Player bundle is read back as a single string and embedded into every
  // exported lesson, and Vite's library mode inlines assets as base64 because
  // it has no external asset URLs. Importing the asset manifest from the Player
  // would therefore add ~5.7 MB to each exported file.
  function sourceFiles(directory: string): string[] {
    const result: string[] = []
    const visit = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const next = join(path, entry.name)
        if (entry.isDirectory()) visit(next)
        else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) result.push(next)
      }
    }
    visit(join(repoRoot, directory))
    return result
  }

  const assetOnlyModules = [
    'bundledFontAssets',
    'installBundledFontFaces',
    // Reads node_modules through node:fs; build-time only.
    'bundledFontSources',
  ]

  it('keeps the Player free of font assets and of the build-time resolver', () => {
    const violations = sourceFiles('src/player').flatMap((path) => {
      const text = readFileSync(path, 'utf8')
      return assetOnlyModules
        .filter((module) => text.includes(`fonts/${module}`))
        .map((module) => `${relative(repoRoot, path).replaceAll('\\', '/')} -> ${module}`)
    })
    expect(violations).toEqual([])
  })

  it('keeps the loader itself free of font assets', () => {
    const text = readFileSync(
      join(repoRoot, 'src/shared/fonts/ensureBundledFonts.ts'),
      'utf8',
    )
    expect(text).not.toContain('bundledFontAssets')
    expect(text).not.toContain('virtual:bundled-fonts')
    expect(text).not.toContain('node:fs')
    expect(BUNDLED_FONT_FAMILIES).toEqual([BUNDLED_TEXT_FONT_FAMILY, BUNDLED_MATH_FONT_FAMILY])
  })

  it('awaits the bundled faces before either entry point renders', () => {
    const player = readFileSync(join(repoRoot, 'src/player/index.ts'), 'utf8')
    expect(player).toContain('await ensureBundledFonts()')
    // The exported bootstrap must stay synchronous; the wait lives in the
    // DOMContentLoaded path around it.
    expect(player).toContain('export function bootstrapPlayer(): PublishedCourseSession | null')
    expect(player).toContain('bootstrapPlayerAfterFonts')

    const renderer = readFileSync(join(repoRoot, 'src/renderer/main.tsx'), 'utf8')
    const installIndex = renderer.indexOf('installBundledFontFaces()')
    const awaitIndex = renderer.indexOf('await ensureBundledFonts()')
    const renderIndex = renderer.indexOf('createRoot(root).render(')
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(awaitIndex).toBeGreaterThan(installIndex)
    expect(renderIndex).toBeGreaterThan(awaitIndex)
  })
})
