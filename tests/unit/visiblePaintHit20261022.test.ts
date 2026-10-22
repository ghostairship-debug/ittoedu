// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { createSlideWorkspaceAuthoringController } from '../../src/renderer/ui/workspaceSlideAuthoring'

let browser: Browser, page: Page, script: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true }); page = await browser.newPage()
  const bundle = await build({ stdin: { contents: `export { componentPaintStack } from './src/components/web/paintHit';
    export { createDomAuthoring, domAuthoringFactorySource } from './src/components/web/authoringDom';
    export { createNestedDomAuthoring } from './src/components/web/nestedAuthoringDom';
    export { visibleComponentAuthorHit } from './src/renderer/components/componentAuthorHit';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'HitLab' })
  script = bundle.outputFiles[0].text
})
afterAll(async () => { await browser?.close() })
async function html(source: string) {
  await page.goto('about:blank'); await page.setContent(`<style>html,body{margin:0}.box{position:absolute;left:20px;top:20px;width:240px;height:120px}</style>${source}`)
  await page.addScriptTag({ content: script })
}

it('reads foreground paint rather than pointer-event eligibility and reveals the field when the cover leaves', async () => {
  await html(`<p class="box" style="margin:0;font:30px sans-serif">Visible later</p><div id="cover" class="box" style="background:white;pointer-events:none!important"></div>`)
  const result = await page.evaluate(() => {
    const lab = (window as any).HitLab, original = document.documentElement.outerHTML
    const factory = new Function(`return ${lab.domAuthoringFactorySource()}`)(), author = factory(document.documentElement, { records: () => ({}) })
    const hidden = author.hit(50, 35), front = lab.componentPaintStack(document.documentElement, 50, 35)[0].id
    const restored = document.documentElement.outerHTML === original && document.adoptedStyleSheets.length === 0
    document.getElementById('cover')!.style.display = 'none'
    const shown = author.hit(50, 35)?.initialValue; author.dispose()
    return { hidden: Boolean(hidden), front, restored, shown }
  })
  expect(result).toEqual({ hidden: false, front: 'cover', restored: true, shown: 'Visible later' })
})

it('honours empty-content pseudo covers, transparent text and open shadow foregrounds', async () => {
  await html(`<style>#cover::before{content:"";position:absolute;inset:0;background:#fff;pointer-events:none!important}</style>
    <p class="box" style="margin:0;font:30px sans-serif">Behind</p><div id="cover" class="box"></div><span id="ghost" style="position:absolute;left:320px;top:20px;color:transparent">Invisible</span><div id="shadow" style="position:absolute;left:20px;top:200px"></div>`)
  const result = await page.evaluate(() => {
    const lab = (window as any).HitLab, shadow = document.getElementById('shadow')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<span style="font:30px sans-serif">Shadow text</span>'
    const author = lab.createDomAuthoring(document.documentElement, { records: () => ({}) })
    const result = { covered: Boolean(author.hit(50, 35)), ghost: Boolean(author.hit(325, 25)), shadow: author.hit(40, 210)?.initialValue }
    author.dispose(); return result
  })
  expect(result).toEqual({ covered: false, ghost: false, shadow: 'Shadow text' })
  await html(`<style>#owner::after{content:"";position:absolute;inset:0;background:white;z-index:99;pointer-events:none!important}</style><div id="owner" class="box"><p id="hidden">Covered</p></div>`)
  expect(await page.evaluate(() => (window as any).HitLab.componentPaintStack(document.documentElement, 40, 45)[0]?.id)).toBe('owner')
})

it('descends only into the visible nested document', async () => {
  await html(`<iframe id="child" class="box" style="border:0" srcdoc="<p style='margin:0;font:30px sans-serif'>Nested</p>"></iframe><div id="cover" class="box" style="background:#fff;pointer-events:none"></div>`)
  await page.locator('iframe').contentFrame().locator('p').waitFor()
  const result = await page.evaluate(() => {
    const lab = (window as any).HitLab, author = lab.createNestedDomAuthoring(document.documentElement, lab.createDomAuthoring, { records: () => ({}) })
    const covered = Boolean(author.hit(40, 35)); document.getElementById('cover')!.style.display = 'none'
    const shown = author.hit(40, 35)?.initialValue; author.dispose(); return { covered, shown }
  })
  expect(result).toEqual({ covered: false, shown: 'Nested' })
})

it('keeps Surface paint blocking Underlay and preserves an object outer background when its realm is transparent', async () => {
  await html(`<div data-component-instance="under" class="box" style="background:green"></div>
    <div id="surface" class="box" style="background:white;pointer-events:none"></div>
    <div data-component-instance="front" class="box" style="top:200px;background:red"><div data-component-render="front" style="width:100%;height:100%"><iframe style="width:100%;height:100%;border:0"></iframe></div></div>
    <div data-slide-authoring-hit-plane class="box" style="z-index:99"></div>`)
  const result = await page.evaluate(async () => {
    const lab = (window as any).HitLab, content = (id: string) => document.querySelector(`[data-component-render="${id}"]`)
    content('front')!.addEventListener('component-author-hit-test', ((event: CustomEvent) => { event.preventDefault(); event.detail.resolve({ painted: false, authorKey: null }) }) as EventListener)
    const covered = await lab.visibleComponentAuthorHit(document.body, { x: 60, y: 50 }, content)
    document.getElementById('surface')!.style.background = 'transparent'
    const transparent = await lab.visibleComponentAuthorHit(document.body, { x: 60, y: 50 }, content)
    const outer = await lab.visibleComponentAuthorHit(document.body, { x: 60, y: 230 }, content)
    return { covered, transparent, outer }
  })
  expect(result).toEqual({ covered: null, transparent: { instanceId: 'under', authorKey: null }, outer: { instanceId: 'front', authorKey: null } })
})

it('never gives a selected covered sibling priority over the current front leaf', () => {
  const frame = { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] }
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'siblings', revision: 0, title: 'Siblings',
    definitions: { shape: { id: 'shape', role: 'content', implementation: { kind: 'builtin', key: 'guoling.shape' } } },
    instances: { group: { id: 'group', definitionId: 'shape', data: {}, frame, childIds: ['back', 'front'] },
      back: { id: 'back', definitionId: 'shape', data: {}, frame }, front: { id: 'front', definitionId: 'shape', data: {}, frame } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['group'], designSize: { width: 400, height: 300 } }], global: { underlay: [], overlay: [] }, assets: {} } as any)
  const controller = createSlideWorkspaceAuthoringController({ read: () => ({ project, surfaceId: 'slide', documentId: 'lab', selectedInstanceIds: ['back'] }), capture: () => ({} as any), select() {}, async commit() {}, report() {} })
  expect(controller.captureHit({ x: 50, y: 50 }, [1, 0, 0, 1, 0, 0])).toEqual({ kind: 'object', instanceId: 'group' })
  expect(controller.captureHit({ x: 50, y: 50, altKey: true }, [1, 0, 0, 1, 0, 0])).toEqual({ kind: 'object', instanceId: 'front' })
})
