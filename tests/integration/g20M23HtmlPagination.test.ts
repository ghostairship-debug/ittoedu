// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import { indexHtmlElements } from '../../src/shared/html/htmlSourceScanner'
import { htmlObservationReadyScript } from '../../src/main/workbench/observation/HtmlActionDesktopPort'

let browser: Browser
let script: string

beforeAll(async () => {
  script = buildSync({
    stdin: { contents: `export {mountPagination} from './src/player/htmlPreview/htmlPreviewPagination'; export {mountPlaceholders} from './src/player/htmlPreview/htmlPreviewPlaceholders';`,
      resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'HtmlPages', platform: 'browser',
  }).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 15000)
afterAll(async () => { await browser?.close() })

async function mounted(source: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
  await page.setContent(source)
  await page.addScriptTag({ content: script })
  const sections = indexHtmlElements(source).sections
  await page.evaluate(sections => {
    const states: unknown[] = []
    const instance = (window as any).HtmlPages.mountPagination(document, sections, (state: unknown) => states.push(state))
    ;(window as any).testPages = { instance, states }
  }, sections)
  return page
}

it('preserves authored active-page navigation and waits for original startup and later live rendering before observing', async () => {
  const page = await mounted('<!doctype html><html><head><style>section{display:none}section.active{display:block}</style></head><body><section id="one" class="active"><button id="next">下一页</button></section><section id="two"><p id="result">第二页</p></section><script>document.querySelector("#next").onclick=()=>{document.querySelector("#one").classList.remove("active");document.querySelector("#two").classList.add("active")}</script></body></html>')
  try {
    await page.locator('#next').click()
    expect(await page.locator('#two').isVisible()).toBe(true)
    expect(await page.locator('#one').isVisible()).toBe(false)
    expect(await page.evaluate(() => (window as any).testPages.instance.readView().pageIndex)).toBe(1)
    await page.evaluate(() => {
      (window as any).coursePlayerReady = new Promise(resolve => setTimeout(() => resolve({ waitForCaptureReady: () =>
        new Promise<void>(ready => setTimeout(() => { document.querySelector('#result')!.textContent = '真实运行就绪'; ready() }, 100)) }), 120))
    })
    await page.evaluate(htmlObservationReadyScript())
    expect(await page.locator('#result').textContent()).toBe('真实运行就绪')
    await page.evaluate(() => { (window as any).coursePlayerReady = Promise.resolve({ waitForCaptureReady: () => Promise.reject(new Error('后页资源失败')) }) })
    await expect(page.evaluate(htmlObservationReadyScript())).rejects.toThrow('后页资源失败')
  } finally { await page.close() }
})

it('uses only indexed direct sections and retains DOM, handlers and script state across navigation', async () => {
  const source = `<!doctype html><body><script>window.runs=(window.runs||0)+1</script>
    <!-- <section id="fake"> -->
    <section id="one" style="color:red"><button id="button">click</button><section id="nested">nested</section></section>
    <section id="two" style="display:grid"><p>second</p></section>
    <script>document.getElementById('button').onclick=()=>window.clicks=(window.clicks||0)+1; const s='<section id="string">'</script></body>`
  const page = await mounted(source)
  try {
    expect(indexHtmlElements(source).sections.map(section => section.id)).toEqual(['one', 'two'])
    await page.evaluate(() => { (window as any).testPages.instance.navigate(1) })
    expect(await page.locator('#one').evaluate(node => getComputedStyle(node).display)).toBe('none')
    expect(await page.locator('#two').evaluate(node => getComputedStyle(node).display)).toBe('grid')
    await page.evaluate(() => {
      (document.getElementById('one') as HTMLElement).style.display = 'flex';
      (document.getElementById('two') as HTMLElement).style.display = 'block'
    })
    await page.evaluate(() => { (window as any).testPages.instance.navigate(0) })
    expect(await page.locator('#one').evaluate(node => getComputedStyle(node).display)).toBe('flex')
    await page.evaluate(() => { (window as any).testPages.instance.navigate(1) })
    expect(await page.locator('#two').evaluate(node => getComputedStyle(node).display)).toBe('block')
    await page.evaluate(() => { (window as any).testPages.instance.navigate(0) })
    await page.locator('#button').click()
    expect(await page.evaluate(() => ({ runs: (window as any).runs, clicks: (window as any).clicks, sections: document.querySelectorAll('section').length })))
      .toEqual({ runs: 1, clicks: 1, sections: 3 })
    await page.evaluate(() => { (window as any).testPages.instance.destroy() })
    expect(await page.locator('#two').evaluate(node => (node as HTMLElement).style.display)).toBe('block')
    expect(await page.locator('#one').evaluate(node => (node as HTMLElement).style.display)).toBe('flex')
  } finally { await page.close() }
})

it('keeps unpaginated documents intact and restores page index and scrolling', async () => {
  const source = '<!doctype html><body><main><section id="first" style="height:1000px">first</section><section id="second" style="height:1000px">second</section></main></body>'
  const page = await mounted(source)
  try {
    await page.evaluate(() => { (window as any).testPages.instance.restore({ pageIndex: 1, perPageScroll: 240 }) })
    expect(await page.evaluate(() => (window as any).testPages.instance.readView())).toEqual({ pageIndex: 1, perPageScroll: 240 })
    expect(await page.locator('#first').evaluate(node => getComputedStyle(node).display)).toBe('none')
    await page.evaluate(() => { (window as any).testPages.instance.navigate(0) })
    expect(await page.evaluate(() => (window as any).testPages.instance.readView().pageIndex)).toBe(0)
  } finally { await page.close() }
  const unpaged = await mounted('<!doctype html><body><article id="whole">whole<section>nested</section></article></body>')
  try {
    expect(await unpaged.locator('#whole').isVisible()).toBe(true)
    expect(await unpaged.locator('section').isVisible()).toBe(true)
  } finally { await unpaged.close() }
})

it('does not steal arrow keys from inputs, composing text or consumed page events', async () => {
  const source = '<!doctype html><body><section><input id="edit"><button id="plain">go</button></section><section>two</section><script>document.addEventListener("keydown",e=>{if(window.consume)e.preventDefault()},{capture:true})</script></body>'
  const page = await mounted(source)
  try {
    await page.locator('#edit').focus()
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => (window as any).testPages.instance.readView().pageIndex)).toBe(0)
    await page.locator('#plain').focus()
    await page.evaluate(() => document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => (window as any).testPages.instance.readView().pageIndex)).toBe(0)
    await page.evaluate(() => document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await page.evaluate(() => { (window as any).consume = true })
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => (window as any).testPages.instance.readView().pageIndex)).toBe(0)
    await page.evaluate(() => { (window as any).consume = false })
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => (window as any).testPages.instance.readView().pageIndex)).toBe(1)
  } finally { await page.close() }
})

it('fits a bounded fixed page without replacing its transform, while a long flow page scrolls naturally', async () => {
  const source = '<!doctype html><style>#fixed{width:1200px;height:600px;overflow:hidden;transform:translateX(3px)}</style><body style="margin:0"><section id="fixed"><div style="position:absolute">fixed</div></section><section id="flow"><div style="height:1200px">flow</div></section></body>'
  const page = await mounted(source)
  try {
    const fixed = await page.locator('#fixed').evaluate(node => ({ zoom: Number((node as HTMLElement).style.zoom), transform: getComputedStyle(node).transform }))
    expect(fixed.zoom).toBeCloseTo(800 / 1200, 4)
    expect(fixed.transform).toBe('matrix(1, 0, 0, 1, 3, 0)')
    await page.evaluate(() => { (window as any).testPages.instance.navigate(1) })
    expect(await page.locator('#flow').evaluate(node => (node as HTMLElement).style.zoom)).toBe('')
    expect(await page.locator('#flow').evaluate(node => node.scrollHeight)).toBeGreaterThan(1000)
    await page.evaluate(() => { (window as any).testPages.instance.destroy() })
    expect(await page.locator('#fixed').evaluate(node => (node as HTMLElement).style.zoom)).toBe('')
  } finally { await page.close() }
})

it('fits dimensions declared inside an active media rule', async () => {
  const source = '<!doctype html><style>@media (min-width:1px){#fixed{width:400px;height:200px}}</style><body style="margin:0"><section id="fixed">small fixed page</section><section>second</section></body>'
  const page = await mounted(source)
  try {
    expect(await page.locator('#fixed').evaluate(node => Number((node as HTMLElement).style.zoom))).toBeCloseTo(2, 3)
  } finally { await page.close() }
})

it('fits an externally styled fixed page in an opaque sandbox where CSSOM cannot be read', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
  const source = '<!doctype html><link rel="stylesheet" href="https://preview.invalid/page.css"><body><section id="fixed">external fixed page</section></body>'
  const sections = indexHtmlElements(source).sections
  const child = `${source}<script>${script.replace(/<\/script/gi, '<\\/script')};
    let cssomReadable = true; try { document.styleSheets[0].cssRules.length } catch { cssomReadable = false }
    HtmlPages.mountPagination(document, ${JSON.stringify(sections)}, () => {});
    parent.postMessage({ type: 'opaque-fixed-page', cssomReadable, zoom: document.getElementById('fixed').style.zoom, availableWidth: document.documentElement.clientWidth - 16 }, '*')
  </script>`
  await page.route('https://preview.invalid/index.html', route => route.fulfill({ contentType: 'text/html', body: child }))
  await page.route('https://preview.invalid/page.css', route => route.fulfill({ contentType: 'text/css', body: '#fixed{width:1200px;height:600px;overflow:hidden}' }))
  try {
    await page.setContent('<script>window.addEventListener("message",event=>{if(event.data.type==="opaque-fixed-page")window.opaqueResult=event.data})</script><iframe sandbox="allow-scripts" style="width:800px;height:500px;border:0" src="https://preview.invalid/index.html"></iframe>')
    await page.waitForFunction(() => Boolean((window as any).opaqueResult))
    const result = await page.evaluate(() => (window as any).opaqueResult)
    expect(result.cssomReadable).toBe(false)
    expect(Number(result.zoom)).toBeCloseTo(result.availableWidth / 1200, 3)
  } finally { await page.close() }
})

it('keeps a camera script running while its page is hidden and later shown', async () => {
  const source = '<!doctype html><body><section id="camera" style="width:1200px;height:600px"><div style="position:absolute">camera</div></section><section>other</section><script>window.cameraTick=0;setInterval(()=>{document.getElementById("camera").style.transform=`translateX(${++window.cameraTick}px)`},20)</script></body>'
  const page = await mounted(source)
  try {
    await page.evaluate(() => { (window as any).testPages.instance.navigate(1) })
    await page.waitForFunction(() => (window as any).cameraTick >= 3)
    await page.evaluate(() => { (window as any).testPages.instance.navigate(0) })
    expect(await page.locator('#camera').evaluate(node => ({ transform: (node as HTMLElement).style.transform, zoom: Number((node as HTMLElement).style.zoom) })))
      .toMatchObject({ zoom: expect.any(Number), transform: expect.stringMatching(/^translateX\(\d+px\)$/) })
    expect(await page.evaluate(() => (window as any).cameraTick)).toBeGreaterThanOrEqual(3)
  } finally { await page.close() }
})

it('renders missing media descriptions without removing selectable original nodes or retaining overlays after refresh', async () => {
  const page = await mounted('<!doctype html><body><section><img id="photo" alt="实验示意" width="180" height="100"><audio id="sound" title="讲解音频"></audio><video id="movie" width="200" height="100"></video><picture><source srcset="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="><img id="picture" width="40" height="40"></picture></section></body>')
  try {
    await page.evaluate(() => { (window as any).placeholders = (window as any).HtmlPages.mountPlaceholders(document) })
    expect((await page.locator('[data-html-preview-placeholder]').allTextContents()).sort()).toEqual(['图片：实验示意', '音频：讲解音频', '视频'].sort())
    expect(await page.locator('#photo').count()).toBe(1)
    expect(await page.locator('[data-html-preview-placeholder]').first().evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none')
    expect(await page.locator('[data-html-preview-placeholder="audio"]').isVisible()).toBe(true)
    expect((await page.locator('[data-html-preview-placeholder="audio"]').boundingBox())!.width).toBeGreaterThan(100)
    await page.evaluate(() => { document.getElementById('photo')!.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='); (window as any).placeholders.refresh() })
    expect(await page.locator('[data-html-preview-placeholder]').count()).toBe(2)
    await page.evaluate(() => { (window as any).placeholders.destroy() })
    expect(await page.locator('[data-html-preview-placeholder]').count()).toBe(0)
  } finally { await page.close() }
})

it('defers fallback dimensions for a CSS-sized image on a hidden page until it is visible', async () => {
  const source = '<!doctype html><style>#late{width:320px;height:180px}</style><body><section>first</section><section><img id="late" alt="后页图"></section></body>'
  const page = await mounted(source)
  try {
    await page.evaluate(() => { (window as any).placeholders = (window as any).HtmlPages.mountPlaceholders(document) })
    expect(await page.locator('#late').evaluate(node => ({ width: (node as HTMLElement).style.width, height: (node as HTMLElement).style.height })))
      .toEqual({ width: '', height: '' })
    await page.evaluate(() => { (window as any).testPages.instance.navigate(1); (window as any).placeholders.refresh() })
    expect(await page.locator('#late').evaluate(node => ({ width: (node as HTMLElement).style.width, height: (node as HTMLElement).style.height })))
      .toEqual({ width: '', height: '' })
    const box = await page.locator('[data-html-preview-placeholder="img"]').boundingBox()
    expect(box?.width).toBeCloseTo(320, 0)
    expect(box?.height).toBeCloseTo(180, 0)
  } finally { await page.close() }
})
