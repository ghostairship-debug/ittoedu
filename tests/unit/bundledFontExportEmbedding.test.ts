import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { strFromU8 } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  NativeLayerItem,
} from '@/shared/courseProjectTypes'
import {
  BUNDLED_MATH_FONT_FAMILY,
  BUNDLED_TEXT_FONT_FAMILY,
} from '@/shared/fonts/bundledFontFamilies'
import type { ExportPayload } from '@/shared/componentTypes'
import type { CoursePublishSources } from '@/renderer/export/course/buildPublishedCourse'
import { buildStandaloneHtml } from '@/renderer/export/buildStandaloneHtml'
import { buildWebPackageFiles } from '@/renderer/export/buildWebPackage'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageFiles,
} from '@/renderer/export/course/buildCoursePackages'
import {
  collectBundledFontFamiliesInUse,
  parseCssFontStack,
  registerBundledFontEmbedSource,
} from '@/renderer/export/bundledFontEmbedding'
import { resolveEmbeddableBundledFonts } from '@/renderer/export/bundledFontEmbedSourceNode'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createFormulaNode,
  createProject,
  createTextNode,
} from '@/renderer/project/createProject'

const NOW = '2026-08-26T00:00:00.000Z'
const PLAYER_BUNDLE = 'window.__PLAYER_PLACEHOLDER__=true;'
const NOTO_STACK = `"${BUNDLED_TEXT_FONT_FAMILY}", "Microsoft YaHei", sans-serif`
const SINGLE_HTML_WARNING_BYTES = 50 * 1024 * 1024
const repoRoot = resolve(__dirname, '..', '..')

/** Importing the Node byte source registers it; restore it after opt-out tests. */
afterEach(() => {
  registerBundledFontEmbedSource(resolveEmbeddableBundledFonts)
})

function stableIds(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `id-${counter}`
  }
}

function lessonPayload(fontFamily?: string): ExportPayload {
  const project = createProject({ now: NOW, idFactory: stableIds() })
  const node = createTextNode({ x: 10, y: 10, idFactory: stableIds() })
  node.text = '课件正文 abc'
  if (fontFamily !== undefined) node.style.fontFamily = fontFamily
  project.scenes[0]!.nodes.push(node)
  return { project, assets: {}, components: {} }
}

function courseTextItem(fontFamily: string): NativeLayerItem {
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
        runs: [],
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
  tokenFontFamily?: string
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
  if (options.nodeFontFamily !== undefined) {
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    slide.scenes[0]!.layerItems.push(courseTextItem(options.nodeFontFamily))
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
    expect(collectBundledFontFamiliesInUse(lessonPayload().project)).toEqual([])
    expect(collectBundledFontFamiliesInUse({
      style: { fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif' },
    })).toEqual([])
    // A family name that merely contains a bundled one is a different family.
    expect(collectBundledFontFamiliesInUse({
      style: { fontFamily: '"Noto Sans SC Display"' },
    })).toEqual([])
  })

  it('never claims the math family from a formula node', () => {
    // `STIX Two Math` lives in the formula renderer's own chain, never in an
    // authored declaration, so the Owner's rule leaves it unembedded.
    const payload = lessonPayload()
    payload.project.scenes[0]!.nodes.push(
      createFormulaNode({ x: 20, y: 20, idFactory: stableIds() }),
    )
    expect(collectBundledFontFamiliesInUse(payload.project)).toEqual([])
  })
})

describe('font-free exports stay byte-identical', () => {
  it('produces the same bytes with and without a registered byte source', () => {
    const payload = lessonPayload()
    const course = courseSources(courseProject())

    const withSource = {
      lessonHtml: buildStandaloneHtml(payload, PLAYER_BUNDLE),
      lessonFiles: buildWebPackageFiles(payload, PLAYER_BUNDLE),
      courseHtml: buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE),
      courseFiles: buildPublishedCourseWebPackageFiles(course, PLAYER_BUNDLE),
    }
    registerBundledFontEmbedSource(null)
    const withoutSource = {
      lessonHtml: buildStandaloneHtml(payload, PLAYER_BUNDLE),
      lessonFiles: buildWebPackageFiles(payload, PLAYER_BUNDLE),
      courseHtml: buildPublishedCourseStandaloneHtml(course, PLAYER_BUNDLE),
      courseFiles: buildPublishedCourseWebPackageFiles(course, PLAYER_BUNDLE),
    }

    expect(withSource.lessonHtml).toBe(withoutSource.lessonHtml)
    expect(withSource.courseHtml).toBe(withoutSource.courseHtml)
    expect(withSource.lessonFiles).toEqual(withoutSource.lessonFiles)
    expect(withSource.courseFiles).toEqual(withoutSource.courseFiles)
    expect(Object.keys(withSource.lessonFiles)).toEqual(
      Object.keys(withoutSource.lessonFiles),
    )
    expect(Object.keys(withSource.courseFiles)).toEqual(
      Object.keys(withoutSource.courseFiles),
    )
  })

  it('adds neither a face, a file nor a notice to a default project', () => {
    const payload = lessonPayload()
    const course = courseSources(courseProject())
    const artifacts = [
      buildStandaloneHtml(payload, PLAYER_BUNDLE),
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
    for (const files of [
      buildWebPackageFiles(payload, PLAYER_BUNDLE),
      buildPublishedCourseWebPackageFiles(course, PLAYER_BUNDLE),
    ]) {
      expect(woff2Paths(files)).toEqual([])
      expect(Object.keys(files)).not.toContain('THIRD_PARTY_NOTICES.md')
      expect(strFromU8(files['player/player.css']!)).not.toContain('@font-face')
    }
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

  it('embeds the same family for a V8 lesson run-level override', () => {
    const payload = lessonPayload()
    const node = payload.project.scenes[0]!.nodes.at(-1)!
    if (node.type !== 'text') throw new Error('expected text node')
    node.runs = [{ start: 0, end: 2, style: { fontFamily: NOTO_STACK } }]
    const html = buildStandaloneHtml(payload, PLAYER_BUNDLE)

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
    expect(notices).toContain(`## ${BUNDLED_TEXT_FONT_FAMILY}`)
    expect(notices).toContain('- License: OFL-1.1')
    expect(notices).toContain('- Copyright: Google Inc.')
    expect(notices).toContain('`player/fonts/`')
    expect(notices).toContain(
      readFileSync(join(repoRoot, 'vendor/fonts/noto-sans-sc/LICENSE'), 'utf8').trimEnd(),
    )
  })

  it('writes the same layout for a V8 lesson web package', () => {
    const payload = lessonPayload(NOTO_STACK)
    const files = buildWebPackageFiles(payload, PLAYER_BUNDLE)

    expect(woff2Paths(files)).toHaveLength(101)
    expect(strFromU8(files['player/player.css']!))
      .toMatch(/src: url\(\.\/fonts\/[A-Za-z0-9._-]+\.woff2\)/)
    expect(strFromU8(files['index.html']!)).toContain("font-src 'self' data:")
    expect(strFromU8(files['THIRD_PARTY_NOTICES.md']!))
      .toContain('SIL Open Font License, Version 1.1')
  })
})

describe('font embedding boundary', () => {
  // The renderer runs sandboxed and its bundle cannot resolve `node:fs`, so a
  // static path from an export builder to the Node byte source would fail the
  // browser build outright.
  const forbidden = ['bundledFontEmbedSourceNode', 'node:fs', 'virtual:bundled-fonts']

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

  it('keeps the export builders free of filesystem and bundler coupling', () => {
    const violations = sourceFiles('src/renderer/export')
      .filter((path) => !path.endsWith('bundledFontEmbedSourceNode.ts'))
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8')
        return forbidden
          .filter((needle) => text.includes(`'${needle}'`) || text.includes(`"${needle}"`))
          .map((needle) => `${relative(repoRoot, path).replaceAll('\\', '/')} -> ${needle}`)
      })
    expect(violations).toEqual([])
  })
})
