import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { strFromU8 } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  NativeLayerItem,
} from '@/shared/courseProjectTypes'
import {
  BUNDLED_MATH_FONT_FAMILY,
  BUNDLED_TEXT_FONT_FAMILY,
} from '@/shared/fonts/bundledFontFamilies'
import {
  assembleBundledFontManifest,
  type BundledFontManifest,
} from '@/shared/fonts/bundledFontManifest'
import {
  bundledFontFaceSpecifiers,
  resolveBundledFontDescriptors,
} from '@/shared/fonts/bundledFontSources'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type { CoursePublishSources } from '@/renderer/export/course/buildPublishedCourse'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageFiles,
} from '@/renderer/export/course/buildCoursePackages'
import {
  collectBundledFontFamiliesInUse,
  parseCssFontStack,
  prepareBundledFontEmbedding,
  registerBundledFontEmbedPreparer,
  registerBundledFontEmbedSource,
} from '@/renderer/export/bundledFontEmbedding'
import { resolveEmbeddableBundledFonts } from '@/renderer/export/bundledFontEmbedSourceNode'
import { installFetchBundledFontEmbedSource } from '@/renderer/export/bundledFontEmbedSourceFetch'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createFormulaNode } from '@/renderer/project/nativeNodeFactories'
import { nativeRenderInputFromV9Item } from '@/player/surfaces/slide/publishedNativeRendering'
import { buildPublishedCourseTryRunPayload } from '@/renderer/ui/coursePlayerTryRun'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const NOW = '2026-08-26T00:00:00.000Z'
const PLAYER_BUNDLE = 'window.__PLAYER_PLACEHOLDER__=true;'
const NOTO_STACK = `"${BUNDLED_TEXT_FONT_FAMILY}", "Microsoft YaHei", sans-serif`
const SINGLE_HTML_WARNING_BYTES = 50 * 1024 * 1024
const repoRoot = resolve(__dirname, '..', '..')

/** Importing the Node byte source registers it; restore it after opt-out tests. */
afterEach(() => {
  registerBundledFontEmbedSource(resolveEmbeddableBundledFonts)
  registerBundledFontEmbedPreparer(null)
})

function stableIds(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `id-${counter}`
  }
}

function courseTextItem(
  fontFamily: string,
  runs: Array<{ start: number; end: number; style: { fontFamily: string } }> = [],
): NativeLayerItem {
  return {
    layerItemId: 'item-text',
    label: '标题',
    frame: { mode: 'absolute', x: 40, y: 40, width: 320, height: 90 },
    order: 100,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: {
        text: '标题文字',
        runs,
        style: {
          fontFamily,
          fontSize: 32,
          color: '#172033',
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
          align: 'left',
          verticalAlign: 'top',
          writingMode: 'horizontal',
          lineSpacing: 1.3,
          letterSpacing: 0,
          padding: 4,
          overflow: 'fixed',
          backgroundColor: '#ffffff',
          backgroundOpacity: 0,
          cornerRadius: 0,
        },
      },
    },
  }
}

function courseProject(options: {
  nodeFontFamily?: string
  runFontFamily?: string
  tokenFontFamily?: string
  formula?: boolean
} = {}): CourseProjectDocument {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
    idFactory: stableIds(),
  })
  if (options.tokenFontFamily !== undefined) {
    project.designTokens.fonts[0]!.fontFamily = options.tokenFontFamily
  }
  if (
    options.nodeFontFamily !== undefined
    || options.runFontFamily !== undefined
    || options.formula === true
  ) {
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    if (options.nodeFontFamily !== undefined || options.runFontFamily !== undefined) {
      slide.scenes[0]!.layerItems.push(courseTextItem(
        options.nodeFontFamily ?? '"Microsoft YaHei", sans-serif',
        options.runFontFamily === undefined
          ? []
          : [{ start: 0, end: 2, style: { fontFamily: options.runFontFamily } }],
      ))
    }
    if (options.formula === true) {
      slide.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(
        createFormulaNode({ x: 20, y: 20, idFactory: stableIds() }),
        200,
      ))
    }
  }
  courseProjectDocumentSchema.parse(project)
  return project
}

function courseSources(project: CourseProjectDocument): CoursePublishSources {
  return { project, assetFiles: {}, components: {} }
}

function faceBlocks(css: string): string[] {
  return [...css.matchAll(/@font-face \{[^}]*\}/g)].map((match) => match[0])
}

function woff2Paths(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).filter((path) => path.endsWith('.woff2')).sort()
}

describe('bundled font declaration scanning', () => {
  it('splits a CSS font stack without losing quoted names', () => {
    expect(parseCssFontStack(NOTO_STACK)).toEqual([
      BUNDLED_TEXT_FONT_FAMILY,
      'Microsoft YaHei',
      'sans-serif',
    ])
    expect(parseCssFontStack("  'Noto Sans SC' ,Arial ")).toEqual([
      BUNDLED_TEXT_FONT_FAMILY,
      'Arial',
    ])
    expect(parseCssFontStack('')).toEqual([])
  })

  it('finds a bundled family wherever a document declares one', () => {
    // Node style, run-level override, presentation override, flow block run and
    // design token: one property name covers every declaration surface.
    expect(collectBundledFontFamiliesInUse({
      scenes: [{ nodes: [{ style: { fontFamily: NOTO_STACK } }] }],
    })).toEqual([BUNDLED_TEXT_FONT_FAMILY])
    expect(collectBundledFontFamiliesInUse({
      runs: [{ style: { fontFamily: `'${BUNDLED_TEXT_FONT_FAMILY}'` } }],
    })).toEqual([BUNDLED_TEXT_FONT_FAMILY])
    expect(collectBundledFontFamiliesInUse({
      presentation: { states: [{ nodeOverrides: { a: { style: { fontFamily: NOTO_STACK } } } }] },
    })).toEqual([BUNDLED_TEXT_FONT_FAMILY])
    expect(collectBundledFontFamiliesInUse({
      designTokens: { fonts: [{ id: 'body', label: '正文', fontFamily: NOTO_STACK }] },
    })).toEqual([BUNDLED_TEXT_FONT_FAMILY])
    // CSS family names match case-insensitively.
    expect(collectBundledFontFamiliesInUse({ style: { fontFamily: 'noto sans sc' } }))
      .toEqual([BUNDLED_TEXT_FONT_FAMILY])
  })

  it('ignores font stacks that name no bundled family', () => {
    expect(collectBundledFontFamiliesInUse(courseProject())).toEqual([])
    expect(collectBundledFontFamiliesInUse({
      style: { fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif' },
    })).toEqual([])
    // A family name that merely contains a bundled one is a different family.
    expect(collectBundledFontFamiliesInUse({
      style: { fontFamily: '"Noto Sans SC Display"' },
    })).toEqual([])
  })

  it('claims the math family from a formula node', () => {
    // The formula chain is a module constant, never a document property, so the
    // node's presence has to stand in for a declaration.
    expect(collectBundledFontFamiliesInUse(courseProject({ formula: true })))
      .toEqual([BUNDLED_MATH_FONT_FAMILY])
    // Both families when the same project also declares the text one.
    expect(collectBundledFontFamiliesInUse(
      courseProject({ formula: true, nodeFontFamily: NOTO_STACK }),
    )).toEqual([BUNDLED_TEXT_FONT_FAMILY, BUNDLED_MATH_FONT_FAMILY])
  })

  it('reads `formula` only from the two node discriminants', () => {
    // Otherwise any authored string could quietly add 403 KB to an export.
    expect(collectBundledFontFamiliesInUse({ type: 'formula' }))
      .toEqual([BUNDLED_MATH_FONT_FAMILY])
    expect(collectBundledFontFamiliesInUse({ nativeType: 'formula' }))
      .toEqual([BUNDLED_MATH_FONT_FAMILY])
    expect(collectBundledFontFamiliesInUse({
      kind: 'formula',
      label: 'formula',
      text: 'formula',
    })).toEqual([])
  })

  it('claims the same bundled families from V9 NativeRenderInput and try-run Published', () => {
    const fixture = listCourseProjectV9Fixtures().find((entry) => entry.id === 'slide-native')
    if (!fixture) throw new Error('missing slide-native fixture')
    const project = structuredClone(fixture.data.project)
    const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
    const title = surface?.type === 'slide'
      ? surface.scenes[0]?.layerItems.find((item) => item.layerItemId === 'slide-title')
      : undefined
    if (!title || title.kind !== 'native' || title.content.nativeType !== 'text') {
      throw new Error('expected slide-title text')
    }
    title.content.data.style.fontFamily = NOTO_STACK
    const input = nativeRenderInputFromV9Item(title)
    const published = buildPublishedCourseTryRunPayload({
      project,
      assetFiles: fixture.data.assetFiles,
      components: {},
    })
    expect(collectBundledFontFamiliesInUse(input)).toEqual([BUNDLED_TEXT_FONT_FAMILY])
    expect(collectBundledFontFamiliesInUse(published)).toEqual([
      BUNDLED_TEXT_FONT_FAMILY,
      BUNDLED_MATH_FONT_FAMILY,
    ])
    expect(input.type).toBe('text')
    if (input.type === 'text') {
      expect(input.style.fontFamily).toBe(NOTO_STACK)
    }
  })
})

describe('font-free exports stay byte-identical', () => {
  it('produces the same bytes with and without a registered byte source', () => {
    const course = courseSources(courseProject())

    const withSource = {
      courseHtml: buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE),
      courseFiles: buildPublishedCourseWebPackageFiles(course, PLAYER_BUNDLE),
    }
    registerBundledFontEmbedSource(null)
    const withoutSource = {
      courseHtml: buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE),
      courseFiles: buildPublishedCourseWebPackageFiles(course, PLAYER_BUNDLE),
    }

    expect(withSource.courseHtml).toBe(withoutSource.courseHtml)
    expect(withSource.courseFiles).toEqual(withoutSource.courseFiles)
    expect(Object.keys(withSource.courseFiles)).toEqual(
      Object.keys(withoutSource.courseFiles),
    )
  })

  it('adds neither a face, a file nor a notice to a default project', () => {
    const course = courseSources(courseProject())
    const artifacts = [
      buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE),
      buildPublishedCourseStandaloneHtml(course, {
        playerBundle: PLAYER_BUNDLE,
        singleHtmlMode: 'online-lightweight',
      }),
    ]
    for (const html of artifacts) {
      expect(html).not.toContain('@font-face')
      expect(html).not.toContain('data:font/woff2')
      expect(html).not.toContain('SIL Open Font License')
    }
    const files = buildPublishedCourseWebPackageFiles(course, PLAYER_BUNDLE)
    expect(woff2Paths(files)).toEqual([])
    expect(Object.keys(files)).not.toContain('THIRD_PARTY_NOTICES.md')
    expect(strFromU8(files['player/player.css']!)).not.toContain('@font-face')
  })
})

describe('offline single HTML embeds the declared family', () => {
  it('carries every declared face as a data: URI plus its OFL notice', () => {
    const course = courseSources(courseProject({ nodeFontFamily: NOTO_STACK }))
    const html = buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE)
    const blocks = faceBlocks(html)

    expect(blocks).toHaveLength(101)
    for (const block of blocks) {
      expect(block).toContain(`font-family: '${BUNDLED_TEXT_FONT_FAMILY}'`)
      expect(block).toContain('src: url(data:font/woff2;base64,')
      expect(block).toContain("format('woff2')")
      expect(block).toContain('font-weight: 100 900;')
      expect(block).toMatch(/unicode-range: U\+/)
    }
    // Offline portability: no face may point at a network location.
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i)
    expect(html).not.toMatch(/@font-face[^}]*https?:\/\//)
    expect(html).toContain('font-src data:')
    // OFL 1.1 §2: the notices travel with the bytes.
    const notice = readFileSync(join(repoRoot, 'vendor/fonts/noto-sans-sc/LICENSE'), 'utf8')
    expect(html).toContain(notice.trimEnd())
    expect(html).toContain('@fontsource-variable/noto-sans-sc')
    expect(new TextEncoder().encode(html).byteLength)
      .toBeLessThan(SINGLE_HTML_WARNING_BYTES)
  })

  it('embeds the same family for a V9 text run-level override', () => {
    const html = buildPublishedCourseStandaloneHtml(
      courseSources(courseProject({ runFontFamily: NOTO_STACK })),
      PLAYER_BUNDLE,
    )

    expect(faceBlocks(html)).toHaveLength(101)
    expect(html).toContain('data:font/woff2;base64,')
    expect(html).toContain('SIL Open Font License, Version 1.1')
    expect(html).toContain('font-src data:')
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i)
  })

  it('embeds only the declared family, never the whole manifest', () => {
    const noto = courseSources(courseProject({ tokenFontFamily: NOTO_STACK }))
    const notoHtml = buildPublishedCourseStandaloneHtml(noto, PLAYER_BUNDLE)
    expect(notoHtml).toContain(`font-family: '${BUNDLED_TEXT_FONT_FAMILY}'`)
    expect(notoHtml).not.toContain(BUNDLED_MATH_FONT_FAMILY)
    expect(notoHtml).not.toContain('stix-two-math')

    // Nothing about the rule is family-specific: declaring the math family
    // embeds it, and only it.
    const math = courseSources(courseProject({
      tokenFontFamily: `"${BUNDLED_MATH_FONT_FAMILY}", serif`,
    }))
    const mathHtml = buildPublishedCourseStandaloneHtml(math, PLAYER_BUNDLE)
    const mathBlocks = faceBlocks(mathHtml)
    expect(mathBlocks).toHaveLength(1)
    expect(mathBlocks[0]).toContain(`font-family: '${BUNDLED_MATH_FONT_FAMILY}'`)
    expect(mathBlocks[0]).not.toContain('unicode-range')
    expect(mathHtml).not.toContain(`font-family: '${BUNDLED_TEXT_FONT_FAMILY}'`)
  })
})

describe('web package links the declared family as sibling files', () => {
  it('writes player/fonts, a relative stylesheet and THIRD_PARTY_NOTICES.md', () => {
    const course = courseSources(courseProject({ nodeFontFamily: NOTO_STACK }))
    const files = buildPublishedCourseWebPackageFiles(course, PLAYER_BUNDLE)
    const css = strFromU8(files['player/player.css']!)
    const fontPaths = woff2Paths(files)

    expect(fontPaths).toHaveLength(101)
    for (const path of fontPaths) {
      expect(path).toMatch(/^player\/fonts\/[A-Za-z0-9._-]+\.woff2$/)
      expect(files[path]!.byteLength).toBeGreaterThan(0)
    }
    // The stylesheet lives at player/player.css, so ./fonts/ is the sibling
    // directory the faces were written to.
    expect(faceBlocks(css)).toHaveLength(101)
    for (const block of faceBlocks(css)) {
      expect(block).toMatch(/src: url\(\.\/fonts\/[A-Za-z0-9._-]+\.woff2\)/)
    }
    expect(css).not.toContain('data:font/woff2')
    expect(css).not.toMatch(/https?:\/\//)
    for (const path of fontPaths) {
      expect(css).toContain(`./${path.slice('player/'.length)}`)
    }
    expect(strFromU8(files['index.html']!)).toContain("font-src 'self' data:")

    const notices = strFromU8(files['THIRD_PARTY_NOTICES.md']!)
    const notice = readFileSync(join(repoRoot, 'vendor/fonts/noto-sans-sc/LICENSE'), 'utf8')
    expect(notices).toContain(`## ${BUNDLED_TEXT_FONT_FAMILY}`)
    expect(notices).toContain('- License: OFL-1.1')
    // Derived from the notice, not spelled out again: `bundledFonts.test.ts` is
    // what holds that heading to the copyright inside the shipped `.woff2`, so
    // naming the holder here too would only add a second place to forget it.
    expect(notices).toContain(`- Copyright: ${notice.split(/\r?\n/)[0]}`)
    expect(notices).toContain('`player/fonts/`')
    expect(notices).toContain(notice.trimEnd())
  })
})

describe('a formula carries the math face and nothing more', () => {
  const stixNotice = () => readFileSync(
    join(repoRoot, 'vendor/fonts/stix-two-math/LICENSE'),
    'utf8',
  ).trimEnd()

  it('adds exactly one face to a single HTML, plus its OFL notice', () => {
    const html = buildPublishedCourseStandaloneHtml(
      courseSources(courseProject({ formula: true })),
      PLAYER_BUNDLE,
    )
    const blocks = faceBlocks(html)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain(`font-family: '${BUNDLED_MATH_FONT_FAMILY}'`)
    expect(blocks[0]).toContain('src: url(data:font/woff2;base64,')
    expect(blocks[0]).toContain('font-weight: 400;')
    expect(blocks[0]).not.toContain('unicode-range')
    expect(html).not.toContain(`font-family: '${BUNDLED_TEXT_FONT_FAMILY}'`)
    expect(html).not.toContain('noto-sans-sc')
    expect(html).toContain('@fontsource/stix-two-math')
    expect(html).toContain(stixNotice())
  })

  it('adds exactly one woff2 to a web package, plus its OFL notice', () => {
    const files = buildPublishedCourseWebPackageFiles(
      courseSources(courseProject({ formula: true })),
      PLAYER_BUNDLE,
    )
    const fontPaths = woff2Paths(files)
    expect(fontPaths).toHaveLength(1)
    expect(fontPaths[0]).toBe('player/fonts/stix-two-math-latin-400-normal.woff2')
    expect(files[fontPaths[0]!]!.byteLength).toBeGreaterThan(0)

    const css = strFromU8(files['player/player.css']!)
    expect(faceBlocks(css)).toHaveLength(1)
    expect(css).toContain('./fonts/stix-two-math-latin-400-normal.woff2')

    const notices = strFromU8(files['THIRD_PARTY_NOTICES.md']!)
    expect(notices).toContain(`## ${BUNDLED_MATH_FONT_FAMILY}`)
    expect(notices).toContain('- Package: @fontsource/stix-two-math')
    expect(notices).toContain(stixNotice())
    expect(notices).not.toContain(`## ${BUNDLED_TEXT_FONT_FAMILY}`)
  })

  it('is what the formula renderer actually asks for first', () => {
    // Otherwise the export would embed a face nothing renders with.
    const renderer = readFileSync(join(repoRoot, 'src/shared/formulaRenderer.ts'), 'utf8')
    expect(renderer).toContain('`"${BUNDLED_MATH_FONT_FAMILY}", "Cambria Math"')
  })
})

describe('the editor renderer reads its own font bytes', () => {
  /** The manifest shape `virtual:bundled-fonts` produces at build time. */
  function rendererManifest(): BundledFontManifest {
    const descriptors = resolveBundledFontDescriptors(join(repoRoot, 'node_modules'))
    return assembleBundledFontManifest(
      descriptors,
      bundledFontFaceSpecifiers(descriptors).map(
        (specifier) => `./assets/${specifier.slice(specifier.lastIndexOf('/') + 1)}`,
      ),
    )
  }

  /**
   * Stands in for `courseware-editor://app/assets/<face>.woff2`.
   *
   * Duck-typed rather than a real `Response` so the test states exactly which
   * two members the production code may rely on.
   */
  function recordingFetch(urls: string[]): (url: string) => Promise<Response> {
    return async (url) => {
      urls.push(url)
      const file = url.slice(url.lastIndexOf('/') + 1)
      const bytes = readFileSync(join(
        repoRoot,
        'node_modules',
        file.startsWith('stix-two-math')
          ? `@fontsource/stix-two-math/files/${file}`
          : `@fontsource-variable/noto-sans-sc/files/${file}`,
      ))
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      } as unknown as Response
    }
  }

  it('registers without reading a byte, then embeds once prepared', async () => {
    const course = courseSources(courseProject({ nodeFontFamily: NOTO_STACK }))
    // The Node byte source is the proven path; the fetch path has to land on
    // exactly the same product, or the two hosts disagree about a lesson.
    const expected = buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE)
    expect(expected).toContain('data:font/woff2')

    const urls: string[] = []
    installFetchBundledFontEmbedSource({
      manifest: rendererManifest(),
      fetchResource: recordingFetch(urls),
    })
    // Installation is the whole cost of a session that never exports.
    expect(urls).toEqual([])
    expect(buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE))
      .not.toContain('@font-face')

    await prepareBundledFontEmbedding()

    expect(urls).toHaveLength(102)
    expect(urls.every((url) => url.startsWith('./assets/'))).toBe(true)
    expect(buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE)).toBe(expected)
  })

  it('caches for the session, so a second export reads nothing', async () => {
    const urls: string[] = []
    installFetchBundledFontEmbedSource({
      manifest: rendererManifest(),
      fetchResource: recordingFetch(urls),
    })
    await prepareBundledFontEmbedding()
    await prepareBundledFontEmbedding()
    expect(urls).toHaveLength(102)

    const html = buildPublishedCourseStandaloneHtml(
      courseSources(courseProject({ formula: true })),
      PLAYER_BUNDLE,
    )
    expect(faceBlocks(html)).toHaveLength(1)
    expect(html).toContain('data:font/woff2;base64,')
  })

  it('keeps exporting when the bytes cannot be read, and retries next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const urls: string[] = []
    let failing = true
    installFetchBundledFontEmbedSource({
      manifest: rendererManifest(),
      fetchResource: async (url) => {
        if (failing) throw new Error('protocol unavailable')
        return recordingFetch(urls)(url)
      },
    })

    await prepareBundledFontEmbedding()
    // A failed read degrades typography; it never fails the export.
    expect(buildPublishedCourseStandaloneHtml(
      courseSources(courseProject({ formula: true })),
      PLAYER_BUNDLE,
    )).not.toContain('@font-face')
    expect(warn).toHaveBeenCalled()

    failing = false
    await prepareBundledFontEmbedding()
    expect(faceBlocks(buildPublishedCourseStandaloneHtml(
      courseSources(courseProject({ formula: true })),
      PLAYER_BUNDLE,
    ))).toHaveLength(1)
    warn.mockRestore()
  })

  it('embeds nothing when a family has no license copy to ship with it', async () => {
    // OFL 1.1 §2 only allows shipping the bytes together with the notice.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installFetchBundledFontEmbedSource({
      manifest: rendererManifest(),
      fetchResource: recordingFetch([]),
      licenseTexts: {},
    })
    await prepareBundledFontEmbedding()
    expect(buildPublishedCourseStandaloneHtml(
      courseSources(courseProject({ formula: true })),
      PLAYER_BUNDLE,
    )).not.toContain('@font-face')
    warn.mockRestore()
  })

  it('is what the editor entry point installs', () => {
    // The wiring lives in an entry point no unit test can execute, so its one
    // line is asserted as text: without it the properties panel's "导出时嵌入"
    // label is a promise the export button does not keep.
    const main = readFileSync(join(repoRoot, 'src/renderer/main.tsx'), 'utf8')
    expect(main).toContain('installFetchBundledFontEmbedSource({ manifest: BUNDLED_FONT_MANIFEST })')

    // And the export commands are what await the lazy read.
    const delivery = readFileSync(join(repoRoot, 'src/renderer/app/useCourseDelivery.ts'), 'utf8')
    const html = delivery.indexOf('const emitHtml')
    const web = delivery.indexOf('const emitWebPackage')
    const pptx = delivery.indexOf('const emitPptx')
    expect(html).toBeGreaterThan(-1)
    expect(web).toBeGreaterThan(-1)
    expect(pptx).toBeGreaterThan(-1)
    expect(delivery.indexOf('await prepareBundledFontEmbedding()', html)).toBeLessThan(web)
    expect(delivery.indexOf('await prepareBundledFontEmbedding()', web)).toBeLessThan(pptx)
  })
})

describe('font embedding boundary', () => {
  // The renderer runs sandboxed and its bundle cannot resolve `node:fs`, so a
  // static path from an export builder to the Node byte source would fail the
  // browser build outright. The reverse costs just as much: the fetch source
  // resolves assets through Vite, which the six `scripts/*.ts` hosts cannot.
  const forbidden = [
    'bundledFontEmbedSourceNode',
    'bundledFontEmbedSourceFetch',
    'node:fs',
    'virtual:bundled-fonts',
  ]

  /** The two byte sources are the only host-specific modules in the directory. */
  const byteSources = [
    'bundledFontEmbedSourceNode.ts',
    'bundledFontEmbedSourceFetch.ts',
  ]

  function sourceFiles(directory: string): string[] {
    const result: string[] = []
    const visit = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const next = join(path, entry.name)
        if (entry.isDirectory()) visit(next)
        else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(next)
      }
    }
    visit(join(repoRoot, directory))
    return result
  }

  function builderFiles(): string[] {
    return sourceFiles('src/renderer/export')
      .filter((path) => !byteSources.some((name) => path.endsWith(name)))
  }

  it('keeps the export builders free of filesystem and bundler coupling', () => {
    const violations = builderFiles().flatMap((path) => {
      const text = readFileSync(path, 'utf8')
      return forbidden
        .filter((needle) => text.includes(`'${needle}'`) || text.includes(`"${needle}"`))
        .map((needle) => `${relative(repoRoot, path).replaceAll('\\', '/')} -> ${needle}`)
    })
    expect(violations).toEqual([])
  })

  it('keeps bundler asset queries inside the byte sources', () => {
    // `?raw` / `?url` / `?inline` are Vite-only specifiers; a builder carrying
    // one stops loading under `tsx`.
    const violations = builderFiles()
      .filter((path) => /\?(?:raw|url|inline)['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(repoRoot, path).replaceAll('\\', '/'))
    expect(violations).toEqual([])
  })
})
