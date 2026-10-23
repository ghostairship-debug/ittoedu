// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

async function stage<T>(name: string, work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error(`${name} did not complete`)), 8_000) })]) }
  finally { clearTimeout(timeout) }
}

const initialHtml = `<!doctype html><html><head><meta charset="utf-8"><title>V2 program</title><style>
html,body{margin:0;width:100%;height:100%;background:#15334c;color:#fff;font:24px Arial}main{padding:40px;box-sizing:border-box}button,input{font:inherit;padding:10px;margin:12px}canvas{display:block;background:#234d6b;width:360px;height:100px}output{display:block;margin:20px}</style></head>
<body data-step="2"><main data-v2-root><h1>V2 original title</h1><label>Answer<input id="v2-answer" value="initial"></label><button id="v2-apply">Apply input</button><output id="v2-result">Ready</output><canvas id="v2-canvas" width="360" height="100"></canvas></main>
<script>document.getElementById('v2-apply').onclick=()=>{document.getElementById('v2-result').textContent=document.getElementById('v2-answer').value+' / '+(Number(document.body.dataset.step) + 0)};let ticks=0;const canvas=document.getElementById('v2-canvas');function paint(){canvas.dataset.ticks=String(++ticks);const ctx=canvas.getContext('2d');ctx.fillStyle='#69dbb0';ctx.fillRect(ticks%360,20,2,40);requestAnimationFrame(paint)};paint();</script></body></html>`

it('updates a no-frame HTML Source program through World/Host/Sandbox with a new live document and one instance', async () => {
  const source = await loadBuiltinComponentSource('guoling.html-program')
  if (!source) throw new Error('The installed HTML program Source is unavailable')
  const project: CourseProjectV11 = { schemaVersion: 11, id: 'source-document-update', revision: 1, title: 'V2 source update',
    rootIds: ['app'], entry: { rootInstanceId: 'app' },
    definitions: { app: { id: 'app', role: 'mixed', implementation: source } },
    instances: { app: { id: 'app', definitionId: 'app', data: { html: initialHtml } } },
    global: { underlay: [], overlay: [] }, assets: {} }
  const published = await stage('publish Source document', buildPublishedCourseV4({ project, assetBytes: {} },
    { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) }))
  const bundle = await stage('bundle Source update player', build({ stdin: {
    contents: `export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';
      export {publishedComponentModel} from './src/player/componentPlatform/publishedProjection';`,
    resolveDir: process.cwd(), loader: 'ts' }, platform: 'browser', target: 'es2022', bundle: true, write: false, format: 'iife', globalName: 'SourceDocumentUpdate' }))
  const browser = await stage('launch Source update browser', chromium.launch({ headless: true }))
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }), errors: string[] = []
    page.setDefaultTimeout(5_000); page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await stage('mount Source document', page.evaluate(async serialized => {
      const api = (window as any).SourceDocumentUpdate
      const payload = JSON.parse(serialized)
      ;(window as any).reports = []
      ;(window as any).publishedPayload = payload
      ;(window as any).workPlayer = await api.mountPublishedCourseV4(payload, document.getElementById('root'),
        { keyboardNavigation: false, report: (message: string) => (window as any).reports.push(message) })
    }, JSON.stringify(published.payload)))
    const content = page.frameLocator('#root iframe')
    const probe = async (title: string, entered: string, result: string) => {
      await content.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' })
      await content.getByRole('textbox', { name: 'Answer', exact: true }).fill(entered)
      await content.getByRole('button', { name: 'Apply input', exact: true }).click()
      expect(await content.locator('#v2-result').textContent()).toBe(`${entered} / ${result}`)
      const before = Number(await content.locator('canvas').getAttribute('data-ticks'))
      await expect.poll(async () => Number(await content.locator('canvas').getAttribute('data-ticks')), { timeout: 5_000 }).toBeGreaterThan(before)
    }
    await probe('V2 original title', 'warm input', '2')
    const initialRealm = await page.locator('#root iframe').getAttribute('name')
    await stage('sync revised Source HTML', page.evaluate(async () => {
      const model = (window as any).SourceDocumentUpdate.publishedComponentModel((window as any).publishedPayload)
      const next = structuredClone(model.project)
      next.revision = 2
      next.instances.app.data.html = next.instances.app.data.html
        .replace('V2 original title', 'V2 locally revised title')
        .replace('data-step="2"', 'data-step="3"')
        .replace('Number(document.body.dataset.step) + 0', 'Number(document.body.dataset.step) + 1')
      await (window as any).workPlayer.runtime.sync(next, { assets: {}, components: {} })
    }))
    await probe('V2 locally revised title', 'edited input', '4')
    expect(await page.locator('#root iframe').count()).toBe(1)
    expect(await page.locator('#root iframe').getAttribute('name')).not.toBe(initialRealm)
    expect(await page.evaluate(() => (window as any).workPlayer.runtime.target({ kind: 'instance', instanceId: 'app' })?.instanceId)).toBe('app')
    expect(await page.evaluate(() => (window as any).reports)).toEqual([])
    expect(errors).toEqual([])
    await page.evaluate(() => (window as any).workPlayer.dispose())
  } finally { await browser.close() }
}, 30_000)
