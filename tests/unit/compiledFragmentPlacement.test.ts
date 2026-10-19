// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { mkdir, writeFile } from 'node:fs/promises'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { mountCompiledCourse } from '../../src/player/componentPlatform/compiledPlayer'

declare global {
  interface Window {
    CompiledPlacement: { mountCompiledCourse: typeof mountCompiledCourse }
    compiledPlacementPlayer: Awaited<ReturnType<typeof mountCompiledCourse>>
  }
}

it('keeps HTML program placement and document roots while normalizing only measured Web frames', async () => {
  const output = 'output/real-authoring-20261014/staged-layout-v1/html-preview-crypto/fragment-placement'
  await mkdir(output, { recursive: true })
  const project = createBlankCourseProjectV10('compiled fragment placement')
  const html = '<section id="fragment" style="position:absolute;left:48px;top:200px;width:1184px;height:450px"><button id="press">0</button><script>document.getElementById("press").onclick=function(){this.textContent=String(Number(this.textContent)+1)}</script></section>'
  for (const [id, key, source] of [
    ['program', 'guoling.html-program', html],
    ['web', 'guoling.web', html],
    ['document', 'guoling.html-program', '<!doctype html><html><head></head><body>' + html + '</body></html>'],
  ] as const) {
    project.definitions[id] = { id, role: 'mixed', implementation: { kind: 'builtin', key } }
    project.instances[id] = { id, definitionId: id, data: { html: source }, frame: { width: 1280, height: 720, transform: [1, 0, 0, 1, 0, 0] } }
  }
  project.surfaces = ['program', 'web', 'document'].map(id => ({ id: 'surface-' + id, kind: 'slide', title: id, childIds: [id], designSize: { width: 1280, height: 720 } }))
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document, renderBuiltin: async () => { throw new Error('Unexpected static builtin') } })
  dom.window.close()
  expect(artifact.diagnostics).toEqual([])
  expect(['program', 'web', 'document'].map(id => artifact.webPrograms[id][0].program.fragment)).toEqual([true, true, false])
  expect(['program', 'web', 'document'].map(id => Boolean(artifact.webPrograms[id][0].program.nativeData))).toEqual([false, false, false])
  const bundle = await build({ stdin: { contents: "export { mountCompiledCourse } from './src/player/componentPlatform/compiledPlayer'", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'CompiledPlacement', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  const metrics: Record<string, unknown> = {}, errors: string[] = []
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:1280px;height:720px}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate(async serialized => {
      const value: CompiledCoursePlayback = JSON.parse(serialized)
      window.compiledPlacementPlayer = await window.CompiledPlacement.mountCompiledCourse(value, document.getElementById('root')!)
    }, JSON.stringify(artifact))
    for (const id of ['program', 'web', 'document']) {
      await page.evaluate(id => window.compiledPlacementPlayer.go('surface-' + id), id)
      const root = page.locator(`[data-compiled-runtime-root="${id}"] #fragment`)
      metrics[id] = await root.evaluate(element => {
        const root = element as HTMLElement, css = getComputedStyle(root)
        return { measured: root.hasAttribute('data-guoling-measured-root'), position: css.position,
          left: css.left, top: css.top, width: css.width, height: css.height }
      })
      await page.locator(`[data-compiled-runtime-root="${id}"] #press`).click()
      expect(await page.locator(`[data-compiled-runtime-root="${id}"] #press`).textContent()).toBe('1')
    }
    expect(metrics.program).toEqual({ measured: false, position: 'absolute', left: '48px', top: '200px', width: '1184px', height: '450px' })
    expect(metrics.web).toEqual({ measured: true, position: 'relative', left: '0px', top: '0px', width: '1280px', height: '720px' })
    expect(metrics.document).toEqual(metrics.program)
    expect(errors).toEqual([])
    await page.evaluate(() => window.compiledPlacementPlayer.dispose())
  } finally {
    await writeFile(output + '/fixture-' + (process.env.COMPILED_PLACEMENT_PHASE || 'latest') + '.json', JSON.stringify({ metrics, errors }, null, 2))
    await browser.close()
  }
}, 30000)
