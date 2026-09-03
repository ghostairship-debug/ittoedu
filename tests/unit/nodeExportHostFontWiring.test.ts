/**
 * Every Node host that packages a lesson has to bring its own font byte source.
 *
 * The renderer gets its source from `main.tsx`; the `scripts/*.ts` hosts have no
 * equivalent entry point, and the source registers itself on import, so a host
 * that simply never imports it produces a lesson whose `@font-face` set is
 * silently empty. That went unnoticed because the only importer in the repo was
 * a unit test — `bundledFontExportEmbedding.test.ts` pulls the module in at the
 * top of the file, which registers the source for everything that file builds
 * and hides whether any production host would have.
 *
 * So this file must never import `bundledFontEmbedSourceNode` itself, directly
 * or through a helper. The functional test below is only meaningful while the
 * sole thing that installs the source is the host it imports.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { BUNDLED_TEXT_FONT_FAMILY } from '@/shared/fonts/bundledFontFamilies'
import { buildPublishedCourseStandaloneHtml } from '@/renderer/export/course/buildCoursePackages'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'

const repoRoot = resolve(__dirname, '..', '..')
const scriptsDirectory = join(repoRoot, 'scripts')
const BYTE_SOURCE = 'src/renderer/export/bundledFontEmbedSourceNode'

/**
 * The builder families that emit `@font-face` and an OFL notice.
 *
 * `course/` owns every current V9 package emitter. A script importing that
 * family can produce an artifact with fonts in it; the rest of
 * `src/renderer/export/` — sizes and preflight — cannot.
 */
const PACKAGING_IMPORT = /from '\.\.\/src\/renderer\/export\/course/

function scriptSources(): { path: string; text: string }[] {
  return readdirSync(scriptsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => ({
      path: `scripts/${entry.name}`,
      text: readFileSync(join(scriptsDirectory, entry.name), 'utf8'),
    }))
}

describe('Node 导出宿主的字体接线', () => {
  it('has at least one packaging host to check', () => {
    // Guards the derivation itself: a regex that stops matching would otherwise
    // turn the next assertion into a green no-op.
    const hosts = scriptSources().filter((script) => PACKAGING_IMPORT.test(script.text))
    expect(hosts.map((host) => host.path).sort()).not.toEqual([])
  })

  it('makes every packaging host register the byte source', () => {
    const missing = scriptSources()
      .filter((script) => PACKAGING_IMPORT.test(script.text))
      .filter((script) => !script.text.includes(BYTE_SOURCE))
      .map((script) => script.path)
    expect(missing, '这些脚本会打包课件但没有注册字体字节源').toEqual([])
  })

  it('really embeds after a production host is imported, with nothing else installing a source', async () => {
    // Red before the wiring existed: the import below was the only thing that
    // could put bytes within reach of a synchronous builder, and no host had it.
    await import('../../scripts/build-interactive-lesson')

    const project = createBlankCourseProject({
      now: '2026-08-26T00:00:00.000Z',
      includeDefaultController: false,
      controls: 'none',
      idFactory: idFactory(),
    })
    const node = createTextNode({ x: 10, y: 10, idFactory: idFactory() })
    node.text = '课件正文'
    node.style.fontFamily = `"${BUNDLED_TEXT_FONT_FAMILY}", sans-serif`
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    slide.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(node, 10))

    const html = buildPublishedCourseStandaloneHtml(
      { project, assetFiles: {}, components: {} },
      'window.__PLAYER_PLACEHOLDER__=true;',
    )
    expect([...html.matchAll(/@font-face/g)]).not.toHaveLength(0)
    expect(html).toContain('SIL Open Font License, Version 1.1')
  })

  it('keeps its own imports clear of the byte source', () => {
    // The premise of the test above. Adding that import here would make it pass
    // no matter what the hosts do — which is precisely how the gap survived.
    const self = readFileSync(__filename, 'utf8')
    const imports = [...self.matchAll(/^import .*$/gmu)].map((match) => match[0])
    expect(imports.filter((line) => line.includes(BYTE_SOURCE))).toEqual([])
  })
})

function idFactory(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `id-${counter}`
  }
}
