// @vitest-environment node
import { setRootContainers } from '../helpers/glxWorkFixture'
import path from 'node:path'
import fs from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page, type Locator } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { JSDOM } from 'jsdom'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentAuthorEnhancementEdits } from '../../src/core/components/source/componentAuthorSource'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { ComponentCompilationInput } from '../../src/core/components/compilation/types'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'

const output = path.resolve('output/architecture-repair-20261019/runtime-document-creation')
const cases = ['web', 'program', 'enhanced-web', 'enhanced-program', 'factory-web', 'ordinary', 'no-fragments']
const compiler = createEsbuildComponentCompiler()
let server: ViteDevServer, browser: Browser, url: string
let model: Extract<DocumentModel, { kind: 'course-v10' }>, payload: PublishedCourseV3, artifact: CompiledCoursePlayback

function sourceProgram(web: boolean, markup: string) {
  return `const realm=Math.random();const documentKind=JSON.parse('"web"');
function mount({root,instance,scope}) {
  root.innerHTML=${JSON.stringify(markup)};root.dataset.proofRealm=String(realm);
  let clicks=0;const button=root.querySelector('[data-counter]');
  button.addEventListener('click',()=>button.textContent=String(++clicks));
  const key='proof-json:'+instance.id;
  scope.state.subscribe(key,value=>{value.score=400;value.values.push('listener');});
  scope.state.subscribe(key,value=>{root.dataset.proofListener=JSON.stringify(value);});
  scope.events.subscribe('__runtime.state',event=>{if(event.name===key)event.value.score=500;});
  const input={score:1,values:['first']};scope.state.set(key,input);input.values.push('caller');
  const read=scope.state.get(key);read.score=900;
  root.dataset.proofOptimistic=JSON.stringify(scope.state.get(key));
  const commit=root.ownerDocument.createElement('button');commit.textContent='Commit JSON';commit.dataset.commitJson=instance.id;root.append(commit);
  commit.addEventListener('click',()=>{const value=scope.state.get(key);value.score++;scope.state.set(key,value);value.score=999;});
  return {update(){},dispose(){}};
}
export default {${web ? 'document:documentKind,' : ''}mount};`
}

beforeAll(async () => {
  await loadBuiltinComponentSource('guoling.web')
  const project = createBlankCourseProjectV10('真实片段创作：普通组件、局部空增强与源码')
  for (const id of cases) {
    const custom = id === 'factory-web' || id === 'ordinary', key = id.includes('program') ? 'guoling.html-program' : 'guoling.web'
    project.definitions[id] = { id, title: id, role: 'content', implementation: { kind: 'builtin', key } }
    const fragments = id === 'no-fragments' ? '<p>Always visible</p>' : '<p class="fragment">First reveal</p><p class="fragment">Second reveal</p>'
    const code = custom ? '' : `<script>let clicks=0;document.querySelector('[data-counter="${id}"]').addEventListener('click',event=>event.currentTarget.textContent=String(++clicks));</script>`
    const markup = `<section data-proof="${id}" style="padding:20px;font:24px sans-serif"><button data-counter="${id}">0</button>${fragments}${code}</section>`
    project.instances[id] = { id, name: id, definitionId: id, data: { html: markup, css: '' },
      frame: { width: 500, height: 280, transform: [1, 0, 0, 1, 0, 0] },
      ...(custom ? { implementationOverride: { kind: 'source' as const, language: 'javascript' as const, source: sourceProgram(id === 'factory-web', markup) } } : {}) }
  }
  setRootContainers(project, cases.map(id => ({ id: 'page-' + id, title: id, kind: 'spatial', childIds: [id], designSize: { width: 1000, height: 700 },
    spatial: { home: { x: 250, y: 140, zoom: 1 }, frames: [{ id: 'frame-' + id, title: id, targetInstanceId: id, pose: { x: 250, y: 140, zoom: 1 } }] } })))
  model = { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
  const driver = new CourseV10Driver()
  for (const id of ['enhanced-web', 'enhanced-program']) {
    const edited = driver.apply(model, captureComponentOperation(model.project, componentAuthorEnhancementEdits(model.project, model.resources, id, 'export default () => {}')))
    if (edited.kind !== 'course-v10') throw new Error('Expected V10 enhanced document')
    model = edited
  }
  const published = await buildPublishedCourseV3({ project: model.project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(compiler) })
  payload = published.payload
  const dom = new JSDOM('<!doctype html>')
  try { artifact = await compileCoursePlayback(payload, { document: dom.window.document, renderBuiltin: async () => { throw new Error('Unexpected static builtin') } }) }
  finally { dom.window.close() }
  expect(artifact.diagnostics).toEqual([])
  // The declaration is computed by the real module. Static data or a professional
  // key cannot establish this capability; this safe static markup uses the local factory.
  expect(artifact.sourceFactories['instance:factory-web']).toBeTruthy()
  expect(artifact.sourceFactories['instance:ordinary']).toBeTruthy()
  expect(artifact.nativeSources?.['instance:enhanced-web']).toBeTruthy()
  expect(artifact.nativeSources?.['instance:enhanced-program']).toBeTruthy()
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'authored.glx'), driver.serialize(model))
  await fs.writeFile(path.join(output, 'published.json'), JSON.stringify(payload))
  await fs.writeFile(path.join(output, 'compiled.json'), JSON.stringify(artifact))
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-runtime-document-creation'),
    resolve: { alias: { '@': path.resolve('src') } }, optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'react-dom', 'zustand', 'mermaid', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__runtime-document-creation', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body><main id="fixture" style="position:relative;width:1000px;height:700px;display:flex"></main><script type="module">import {mountRuntimeDocumentCreation} from "/tests/helpers/runtimeDocumentCreationHarness.tsx";window.mountProof=mountRuntimeDocumentCreation;window.ready=true;</script></body></html>')
  })
  await server.listen(); const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  url = `http://127.0.0.1:${address.port}/__runtime-document-creation`
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 90_000)
afterAll(async () => { await browser?.close(); await server?.close() })

async function content(page: Page, id: string): Promise<Locator> {
  let found: Locator | undefined
  await expect.poll(async () => {
    for (const frame of page.frames()) { const candidate = frame.locator(`[data-proof="${id}"]`); if (await candidate.count()) { found = candidate; return true } }
    return false
  }).toBe(true)
  return found!
}
const fragments = (root: Locator) => root.locator('.fragment').evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); return style.visibility !== 'hidden' && style.display !== 'none' }))

it.each(['editor', 'published', 'compiled'] as const)('%s preserves the same real empty-enhancement fragments, counter state and JSON ownership through navigation', async kind => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }), errors: string[] = [], metrics: Record<string, unknown> = {}
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  await page.exposeFunction('compileForFixture', (input: ComponentCompilationInput) => compiler.compile(input))
  try {
    await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'ready'))
    const start = performance.now()
    await page.evaluate(async serialized => {
      const input = JSON.parse(serialized)
      Reflect.set(window, 'proof', await Reflect.get(window, 'mountProof')(input.kind, document.querySelector('#fixture'), input))
    }, JSON.stringify({ kind, model, payload, artifact }))
    if (kind === 'editor') await page.getByRole('button', { name: '试运行', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'proof').playing())).toBe(true)
    metrics.initialMountMs = performance.now() - start
    for (const id of cases) {
      metrics.currentCase = id
      const entered = performance.now()
      expect(await page.evaluate(id => Reflect.get(window, 'proof').go('page-' + id), id)).toBe(true)
      const root = await content(page, id), count = id === 'ordinary' || id === 'no-fragments' ? 1 : 3
      await expect.poll(() => page.evaluate(() => Reflect.get(window, 'proof').read().progress.stepCount)).toBe(count)
      expect(await page.evaluate(() => Reflect.get(window, 'proof').read().progress.stepIndex)).toBe(0)
      if (count === 3) await expect.poll(() => fragments(root)).toEqual([false, false])
      else if (id === 'ordinary') expect(await fragments(root)).toEqual([true, true])
      await root.locator('[data-counter]').click(); expect(await root.locator('[data-counter]').textContent()).toBe('1')
      if (count === 3) {
        expect(await page.evaluate(() => Reflect.get(window, 'proof').next())).toBe(true)
        await expect.poll(() => fragments(root)).toEqual([true, false])
        expect(await page.evaluate(() => Reflect.get(window, 'proof').next())).toBe(true)
        await expect.poll(() => fragments(root)).toEqual([true, true])
      }
      metrics[id] = { steps: count, visible: await fragments(root), entryMs: performance.now() - entered }
      if (id === 'factory-web' || id === 'ordinary') {
        const expected = { score: 1, values: ['first'] }
        await expect.poll(() => page.evaluate(id => Reflect.get(window, 'proof').get('proof-json:' + id), id)).toEqual(expected)
        await expect.poll(() => root.evaluate(element => element.parentElement!.dataset.proofOptimistic)).toBe(JSON.stringify(expected))
        await expect.poll(() => root.evaluate(element => element.parentElement!.dataset.proofListener)).toBe(JSON.stringify(expected))
        // Locate the same native/compiled document, without relying on iframe order.
        const commit = root.locator('..').locator(`[data-commit-json="${id}"]`)
        await commit.click()
        await expect.poll(() => page.evaluate(id => Reflect.get(window, 'proof').get('proof-json:' + id), id)).toEqual({ score: 2, values: ['first'] })
      }
    }
    // Returning to a mounted source replays fragments while keeping private clicks.
    expect(await page.evaluate(() => Reflect.get(window, 'proof').go('page-enhanced-web'))).toBe(true)
    const returned = await content(page, 'enhanced-web')
    expect(await returned.locator('[data-counter]').textContent()).toBe('1')
    await expect.poll(() => fragments(returned)).toEqual([false, false])
    if (kind === 'editor') expect(await page.evaluate(() => Reflect.get(window, 'proof').formal())).toEqual({ project: model.project, operations: [] })
    expect(await page.evaluate(() => Reflect.get(window, 'proof').errors)).toEqual([]); expect(errors).toEqual([])
    await page.screenshot({ path: path.join(output, `${kind}-empty-enhancement.png`) })
    await page.evaluate(() => Reflect.get(window, 'proof').dispose())
  } finally {
    await page.screenshot({ path: path.join(output, `${kind}-last-state.png`) }).catch(() => undefined)
    metrics.finalRuntime = await page.evaluate(() => { const proof = Reflect.get(window, 'proof'); return proof ? { playing: proof.playing(), navigation: proof.read(), errors: proof.errors } : null }).catch(() => null)
    await fs.writeFile(path.join(output, `${kind}-metrics.json`), JSON.stringify({ metrics, errors }, null, 2))
    await page.close()
  }
}, 90_000)
