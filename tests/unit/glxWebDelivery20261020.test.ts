// @vitest-environment node
import { build } from 'esbuild'
import { chromium, type Page } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentModel } from '../../src/shared/workbench/document'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

function webApplication(): CourseProjectV11 {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{width:100%;height:100%;margin:0}main{box-sizing:border-box;min-height:100%;padding:24px;background:#edf7ff}
    input,button,output{font:20px sans-serif;margin:8px}
    </style></head><body><main><h1>Initial heading</h1><label for="number">Number</label><input id="number" value="2">
    <button id="apply">Calculate</button><output id="answer">waiting</output></main>
    <script type="module" src="./main.js"></script></body></html>`
  return { schemaVersion: 11, id: 'web-delivery', revision: 0, title: '模块化 Web 程序',
    rootIds: ['app'], entry: { rootInstanceId: 'app' }, global: { underlay: [], overlay: [] }, assets: {},
    definitions: { web: { id: 'web', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.web' } } },
    instances: { app: { id: 'app', definitionId: 'web', data: { html, modules: {
      'main.js': `import {label} from './label.js';
        document.documentElement.dataset.modulesReady=label;
        document.getElementById('apply').onclick=()=>{
          document.getElementById('answer').textContent=label+': '+(Number(document.getElementById('number').value)*3);
        };`,
      'label.js': `export const label='module result';`,
    } } } },
  }
}

async function programContent(page: Page, kind: 'published' | 'compiled') {
  const host = kind === 'published' ? '[data-component-instance-id="app"]' : '[data-compiled-node="app"]'
  const iframe = page.locator(`${host} iframe`)
  await expect.poll(async () => page.locator(host).count()).toBe(1)
  return await iframe.count() ? page.frameLocator(`${host} iframe`) : page
}

it('runs saved Web module dependencies and real input in the exported file and Published player', async () => {
  const original = webApplication(), driver = new CourseV10Driver()
  const source = (original.instances.app.data as { html: string }).html
  const model: DocumentModel = { kind: 'course-v10', project: original, resources: { assets: {}, components: {} } }
  const changed = driver.apply(model, captureComponentOperation(original, [
    { type: 'data.set', instanceId: 'app', path: ['html'], value: source.replace('Initial heading', 'Saved heading') },
    { type: 'data.set', instanceId: 'app', path: ['modules', 'label.js'], value: `export const label='saved module';` },
  ]))
  const directory = await mkdtemp(join(tmpdir(), 'glx-web-delivery-')), glx = join(directory, 'web-program.glx'), htmlFile = join(directory, 'web-program.html')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  page.setDefaultTimeout(8_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await writeFile(glx, driver.serialize(changed))
    const reopened = driver.load(new Uint8Array(await readFile(glx)))
    if (reopened.kind !== 'course-v10') throw new Error('Expected the formal work document')
    expect((reopened.project.instances.app.data as { html: string }).html).toContain('Saved heading')
    expect((reopened.project.instances.app.data as { modules: Record<string, string> }).modules['label.js']).toContain('saved module')
    const result = await buildPublishedCourseV4({ project: reopened.project, assetBytes: reopened.resources.assets, componentFiles: reopened.resources.components }, {
      compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()),
    })
    expect(result.diagnostics).toEqual([])
    expect(result.payload).not.toHaveProperty('surfaces')
    const preparedData = result.payload.instances.app.data as { publishedModuleBundle?: string }
    expect(preparedData.publishedModuleBundle).toContain('saved module')
    const dom = new JSDOM('<!doctype html>')
    const artifact = await compileCoursePlayback(result.payload, { document: dom.window.document, renderBuiltin: async () => '' })
    dom.window.close()
    const bundle = (await build({ stdin: { contents: `export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';
      export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';`, loader: 'ts', resolveDir: process.cwd() },
      bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'GLXWebDelivery' })).outputFiles[0]!.text
    await writeFile(htmlFile, buildCompiledSingleHtml(artifact, `${bundle};var CoursewareCompiledPlayer=GLXWebDelivery;`), 'utf8')
    await page.goto(pathToFileURL(htmlFile).href)
    await page.evaluate(async () => { (window as any).workPlayer = await (window as any).coursePlayerReady })
    const compiled = await programContent(page, 'compiled')
    await expect.poll(() => compiled.locator('html[data-modules-ready]').getAttribute('data-modules-ready')).toBe('saved module')
    await expect.poll(() => compiled.getByRole('heading').textContent()).toBe('Saved heading')
    await compiled.getByLabel('Number').fill('7')
    await compiled.getByRole('button', { name: 'Calculate' }).click()
    await expect.poll(() => compiled.locator('#answer').textContent()).toBe('saved module: 21')
    expect(await page.locator('[data-compiled-surface]').count()).toBe(0)
    expect(await page.locator('[data-compiled-program-viewport]').boundingBox()).toMatchObject({ x: 0, y: 0, width: 1000, height: 700 })
    expect(await page.locator('#course-diagnostic').isHidden()).toBe(true)
    await page.evaluate(() => (window as any).workPlayer.dispose())

    await page.goto('about:blank')
    await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async serialized => { const payload = JSON.parse(serialized); (window as any).reports=[];(window as any).workPlayer = await (window as any).GLXWebDelivery.mountPublishedCourseV4(payload, document.getElementById('root'), { report: (message: string) => (window as any).reports.push(message) }) }, JSON.stringify(result.payload))
    const published = await programContent(page, 'published')
    await expect.poll(() => published.locator('html[data-modules-ready]').getAttribute('data-modules-ready')).toBe('saved module')
    await published.getByLabel('Number').fill('9')
    await published.getByRole('button', { name: 'Calculate' }).click()
    await expect.poll(() => published.locator('#answer').textContent()).toBe('saved module: 27')
    expect(await page.locator('[data-component-surface]').count()).toBe(0)
    expect(await page.evaluate(() => (window as any).reports)).toEqual([])
    expect(errors).toEqual([])
    await page.evaluate(() => (window as any).workPlayer.dispose())
    expect((original.instances.app.data as { html: string }).html).toContain('Initial heading')
  } finally {
    await browser.close()
    await unlink(glx).catch(() => {}); await unlink(htmlFile).catch(() => {}); await rmdir(directory)
  }
}, 60_000)
