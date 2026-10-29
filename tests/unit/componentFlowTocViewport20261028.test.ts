// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from '@playwright/test'
import type { PublishedCourseV4 } from '../../src/shared/contracts/component-platform/published'

let browser: Browser, bundle: string
beforeAll(async () => {
  const built = await build({ stdin: { contents: `
    export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';
    export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';
    export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';
    export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife',
  globalName: 'FlowTocViewport', platform: 'browser', target: 'es2022', loader: { '.png': 'dataurl', '.woff2': 'dataurl' } })
  bundle = built.outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => { await browser?.close() })

function fixture(): PublishedCourseV4 {
  return {
    schemaVersion: 4, id: 'flow-toc-viewport', title: 'Flow TOC viewport regression', rootIds: ['flow'], entry: { rootInstanceId: 'flow' },
    global: { underlay: [], overlay: [] }, assets: {}, definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      block: { id: 'block', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
    }, instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['heading', 'body'], container: {
        kind: 'flow', designSize: { width: 1280, height: 900 },
        flow: { layout: { widthMode: 'reading', readingWidth: 888, wideContentWidth: 1100 } },
      } },
      heading: { id: 'heading', definitionId: 'block', data: { type: 'heading', level: 2,
        content: { inlines: [{ type: 'text', text: '12:00 候车厅档案' }] } } },
      body: { id: 'body', definitionId: 'text', data: {
        content: { inlines: [{ type: 'text', text: 'The Flow article must remain beside the open directory when the viewport becomes narrower. '.repeat(35) }] } } },
    },
  }
}

it.each(['model', 'compiled'] as const)('keeps the %s Flow article clear of the TOC through open, resize and close at default zoom', async mode => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, offline: true })
  const errors: string[] = [], metrics: Record<string, any> = {}
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async ({ mode, payload }) => {
      const api = (window as any).FlowTocViewport, root = document.getElementById('root')!
      const decoded = JSON.parse(payload)
      const input = mode === 'compiled' ? await api.compileCoursePlayback(decoded, { document,
        renderBuiltin: (instance: any, key: string, project: any) => api.renderCompiledBuiltin(instance, key, project, document) }) : decoded
      ;(window as any).flowTocViewportPlayer = await (mode === 'compiled' ? api.mountCompiledCourse : api.mountPublishedCourseV4)(input, root)
      await document.fonts.ready
    }, { mode, payload: JSON.stringify(fixture()) })
    const read = () => page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!
      const paper = scroll.querySelector<HTMLElement>('[data-compiled-flow-paper],article')!
      const body = document.querySelector<HTMLElement>('[data-compiled-node="body"],[data-component-object="body"]')!
      const drawer = document.querySelector<HTMLElement>('[data-testid="flow-runtime-toc-drawer"]')!
      const toggle = document.querySelector<HTMLElement>('[data-testid="flow-runtime-toc-toggle"]')!
      const box = (element: Element) => { const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width, top: rect.top, height: rect.height } }
      const transform = new DOMMatrixReadOnly(getComputedStyle(scroll.parentElement!).transform)
      return { root: box(drawer.parentElement!), scroll: box(scroll), paper: box(paper), body: box(body), drawer: box(drawer),
        contentWidth: scroll.parentElement!.clientWidth, scrollClientWidth: scroll.clientWidth, scrollClientLeft: scroll.clientLeft,
        expanded: toggle.getAttribute('aria-expanded') === 'true',
        observation: { zoom: Math.hypot(transform.a, transform.b), panX: transform.e, panY: transform.f } }
    })
    await expect.poll(async () => (await read()).body.width).toBeGreaterThan(0)
    await expect.poll(async () => (await read()).body.height).toBeGreaterThan(0)
    metrics.closed1440 = await read()
    const toggle = page.getByTestId('flow-runtime-toc-toggle')
    await toggle.click()
    await expect.poll(async () => (await read()).drawer.left).toBeCloseTo(metrics.closed1440.root.left, 2)
    metrics.open1440 = await read()
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect.poll(async () => (await read()).root.width).toBe(1280)
    await expect.poll(async () => (await read()).contentWidth).toBe(1280)
    metrics.open1280 = await read()
    await toggle.click()
    await expect.poll(async () => (await read()).drawer.right).toBeLessThanOrEqual(metrics.open1280.root.left + 0.1)
    metrics.closed1280 = await read()

    // Finish every interaction before checking geometry so a red run captures
    // the real narrow-window overlap as well as open/close state.
    for (const value of Object.values(metrics)) {
      expect(value.observation).toEqual({ zoom: 1, panX: 0, panY: 0 })
      expect(value.body.height).toBeGreaterThan(0)
    }
    for (const name of ['open1440', 'open1280']) {
      const value = metrics[name]
      expect(value.expanded, name).toBe(true)
      expect(value.scroll.left, name).toBeCloseTo(value.drawer.right, 1)
      expect(value.scroll.right, name).toBeCloseTo(value.root.right, 1)
      expect(value.body.left, name).toBeGreaterThanOrEqual(value.drawer.right - 0.5)
      expect(value.body.right, name).toBeLessThanOrEqual(value.scroll.right + 0.5)
    }
    for (const name of ['closed1440', 'closed1280']) {
      const value = metrics[name]
      expect(value.expanded, name).toBe(false)
      expect(value.scroll.left, name).toBeCloseTo(value.root.left, 1)
      expect(value.scroll.width, name).toBeCloseTo(value.root.width, 1)
      expect(value.paper.left + value.paper.width / 2, name).toBeCloseTo(value.scroll.left + value.scrollClientLeft + value.scrollClientWidth / 2, 1)
    }
    expect(errors).toEqual([])
  } finally {
    process.stdout.write('FLOW_TOC_VIEWPORT ' + JSON.stringify({ mode, metrics, errors }) + '\n')
    await page.evaluate(() => (window as any).flowTocViewportPlayer?.dispose()).catch(() => {})
    await page.close()
  }
}, 30_000)

it.each(['model','compiled'] as const)('%s respects explicit no-host intent in real offline Flow while controls:none alone does not hide its directory',async mode=>{
 const page=await browser.newPage({viewport:{width:1280,height:800},offline:true}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 try{
  await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>');await page.addScriptTag({content:bundle})
  for(const hidden of [false,true]){
   const payload=fixture();payload.playback={controls:'none',keyboardNavigation:true,presenter:{enabled:true,strategy:'scene-navigation',additionalBindings:[]},...(hidden?{hostNavigation:'intentionally-hidden' as const}:{})}
   await page.evaluate(async({mode,payloadText})=>{
    const payload=JSON.parse(payloadText)
    const w=window as any;await w.flowTocViewportPlayer?.dispose()
    document.body.innerHTML='<main id="root"></main>'
    const api=w.FlowTocViewport,input=mode==='compiled'?await api.compileCoursePlayback(payload,{document,renderBuiltin:(instance:any,key:string,project:any)=>api.renderCompiledBuiltin(instance,key,project,document)}):payload
    w.flowTocViewportPlayer=await(mode==='compiled'?api.mountCompiledCourse:api.mountPublishedCourseV4)(input,document.getElementById('root'))
    w.intentOutput=mode==='compiled'?input.course.playback:input.playback
   },{mode,payloadText:JSON.stringify(payload)})
   if(hidden){expect(await page.getByTestId('flow-runtime-toc-toggle').count()).toBe(0);expect(await page.locator('[data-playback-chrome]:visible').count()).toBe(0)}
   else await expect.poll(()=>page.getByTestId('flow-runtime-toc-toggle').isVisible(),{timeout:5000}).toBe(true)
   await expect.poll(()=>page.getByText('12:00 候车厅档案',{exact:true}).first().isVisible()).toBe(true)
   expect(await page.evaluate(()=> (window as any).intentOutput)).toEqual(payload.playback)
   if(hidden){
    await page.evaluate(()=> (window as any).flowTocViewportPlayer.navigation.setZoom(1.5))
    await expect.poll(()=>page.locator('[data-playback-chrome]:visible').count()).toBe(0)
   }
  }
  expect(errors).toEqual([])
 }finally{await page.evaluate(()=> (window as any).flowTocViewportPlayer?.dispose()).catch(()=>{});await page.close()}
},30_000)
