import { afterAll, beforeAll, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

let browser: Browser
let script: string
beforeAll(async () => {
  script = execFileSync(process.execPath, [resolve(process.cwd(), 'node_modules/esbuild/bin/esbuild'), '--loader=ts', '--bundle', '--format=iife', '--global-name=HeightReview', '--platform=browser', '--define:process.env.NODE_ENV="test"'], { input: `export {observeSurfaceRuntimeContentSize} from './src/player/surfaces/runtime/surfaceRuntimeContentSize'; export {mountPublishedSurfaceRuntime,createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount'; export {createHtmlDocumentRuntimeSource} from './src/shared/runtime/htmlDocumentSource';`, encoding: 'utf8' })
  browser = await chromium.launch({ headless: true })
}, 15000)
afterAll(async () => { await browser?.close() })

async function pageWith(html: string, network?: { requests: number }): Promise<Page> {
  const page = await browser.newPage()
  if (network) await page.route('https://measurement.invalid/**', async route => {
    network.requests++
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' })
  })
  await page.setContent('<div id="root"><iframe style="width:640px;height:300px;border:0"></iframe></div>')
  await page.addScriptTag({ content: script })
  await page.evaluate(async html => {
    const frame = document.querySelector('iframe')!
    const ready = new Promise<void>(resolve => frame.onload = () => resolve())
    frame.srcdoc = html
    await ready
    const state = { heights: [] as number[], errors: [] as string[], measures: 0, resizes: 0, observer: null as any }
    frame.contentWindow!.addEventListener('resize', () => { state.resizes++; frame.contentDocument!.body.dataset.resizes = String(state.resizes) })
    state.observer = (window as any).HeightReview.observeSurfaceRuntimeContentSize({
      root: document.getElementById('root'),
      source: () => { state.measures++; return { kind: 'managed-document', iframe: frame, origin: frame.contentDocument!.documentElement, minimumHeight: 1 } },
      onHeightChange: (height: number) => { state.heights.push(height); frame.style.height = `${height}px` },
      onError: (error: Error) => state.errors.push(error.message),
    })
    ;(window as any).testHeight = state
  }, html)
  return page
}

const settled = (page: Page) => page.evaluate(() => (window as any).testHeight.observer.waitForReady())

it('preserves loaded local image dimensions without duplicating author load handlers', async () => {
  const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="600"/>')}`
  const page = await pageWith(`<!doctype html><style>body{margin:0}img{display:block}</style><img src="${svg}" onload="parent.imageLoads=(parent.imageLoads||0)+1">`)
  try {
    await settled(page)
    expect(await page.evaluate(() => ({ heights: (window as any).testHeight.heights, loads: (window as any).imageLoads }))).toEqual({ heights: [600], loads: 1 })
  } finally { await page.close() }
})

it.each([500, 1200])('preserves a real fixed %ipx box with only 21px of text', async height => {
  const page = await pageWith(`<!doctype html><style>body{margin:0}main{height:${height}px}p{height:21px;margin:0}</style><main><p>text</p></main>`)
  try {
    await settled(page)
    expect(await page.evaluate(() => (window as any).testHeight.heights)).toEqual([height])
  } finally { await page.close() }
})

it('uses real isolated layout for growth, shrink, nested roots and fixed height; resize handlers settle', async () => {
  const page = await pageWith('<!doctype html><style>body{margin:0}#app{min-height:100vh}</style><div id="app"><main><article style="height:920px"></article></main></div>')
  try {
    await settled(page)
    await page.evaluate(() => { document.querySelector('iframe')!.contentDocument!.querySelector<HTMLElement>('article')!.style.height = '480px' })
    await settled(page)
    await page.evaluate(() => { document.querySelector('iframe')!.contentDocument!.querySelector<HTMLElement>('main')!.style.height = '700px' })
    await settled(page)
    await page.evaluate(() => {
      const document = window.document.querySelector('iframe')!.contentDocument!
      document.querySelector<HTMLElement>('main')!.style.height = ''
      document.querySelector<HTMLElement>('article')!.style.height = '200px'
    })
    await settled(page)
    await page.evaluate(() => { document.querySelector('iframe')!.contentDocument!.querySelector<HTMLElement>('main')!.style.height = '900px' })
    await settled(page)
    await page.evaluate(() => { document.querySelector('iframe')!.contentDocument!.querySelector<HTMLElement>('main')!.style.height = '700px' })
    await settled(page)
    await page.waitForTimeout(80)
    const first = await page.evaluate(() => { const s = (window as any).testHeight; return { heights: s.heights, errors: s.errors, measures: s.measures, resizes: s.resizes } })
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => { const s = (window as any).testHeight; return { heights: s.heights, errors: s.errors, measures: s.measures, resizes: s.resizes } })).toEqual(first)
    expect(first.errors).toEqual([])
    expect(first.heights).toEqual([920, 480, 700, 200, 900, 700])
    expect(first.resizes).toBeLessThanOrEqual(6)
    expect(await page.locator('[data-html-height-measurement]').count()).toBe(0)
  } finally { await page.close() }
})

it.each([
  '#app{min-height:100vh;padding:20px}',
  '#app{min-height:100vh}footer{height:40px}',
])('rejects a nonconvergent document without resizing the live page: %s', async css => {
  const page = await pageWith(`<!doctype html><style>body{margin:0}${css}</style><div id="app"><article style="height:480px"></article></div>${css.includes('footer') ? '<footer></footer>' : ''}`)
  try {
    await expect(settled(page)).rejects.toThrow('无法')
    expect(await page.evaluate(() => ({ heights: (window as any).testHeight.heights, height: document.querySelector('iframe')!.clientHeight }))).toEqual({ heights: [], height: 300 })
    expect(await page.locator('[data-html-height-measurement]').count()).toBe(0)
  } finally { await page.close() }
})

it('respects the browser cascade for supports, custom properties, calc, layers and fixed minimums', async () => {
  const page = await pageWith('<!doctype html><style>body{margin:0}#app{min-height:100vh}@supports(display:block){#app{--fixed:400px;min-height:calc(var(--fixed) + 0px)}}@layer nested{main{height:350px}}</style><div id="app"><main>text</main></div>')
  try {
    await settled(page)
    expect(await page.evaluate(() => ({ heights: (window as any).testHeight.heights, actual: document.querySelector('iframe')!.contentDocument!.getElementById('app')!.getBoundingClientRect().height }))).toEqual({ heights: [400], actual: 400 })
  } finally { await page.close() }
})

it('cancels old document results and destroys pending mirrors without late callbacks', async () => {
  const page = await pageWith('<!doctype html><style>body{margin:0}</style><article style="height:920px"></article>')
  try {
    await settled(page)
    await page.evaluate(async () => {
      const frame = document.querySelector('iframe')!
      const loaded = new Promise<void>(resolve => frame.onload = () => resolve())
      frame.srcdoc = '<!doctype html><style>body{margin:0}</style><article style="height:600px"></article>'
      await loaded
      ;(window as any).testHeight.observer.refresh()
    })
    await settled(page)
    expect(await page.evaluate(() => (window as any).testHeight.heights)).toEqual([920, 600])
    await page.evaluate(() => {
      const state = (window as any).testHeight
      state.observer.refresh()
      state.observer.destroy()
      document.querySelector('iframe')!.contentDocument!.body.textContent = 'late mutation'
    })
    await page.waitForTimeout(80)
    expect(await page.evaluate(() => (window as any).testHeight.heights)).toEqual([920, 600])
    expect(await page.locator('[data-html-height-measurement]').count()).toBe(0)
  } finally { await page.close() }
})

it('does not rerun the live document script in the sandboxed measurement copy', async () => {
  const network = { requests: 0 }
  const page = await pageWith('<!doctype html><style>body{margin:0;background:url(https://measurement.invalid/background.svg)}</style><article style="height:500px">text</article><script>parent.executions=(parent.executions||0)+1</script>', network)
  try {
    await settled(page)
    expect(await page.evaluate(() => (window as any).executions)).toBe(1)
    expect(await page.evaluate(() => (window as any).testHeight.heights)).toEqual([500])
    expect(network.requests).toBe(1)
  } finally { await page.close() }
})

it('destroys a mirror during its load and rejects readiness without a late height or error callback', async () => {
  const page = await pageWith('<!doctype html><style>body{margin:0}</style><article style="height:500px"></article>')
  try {
    await settled(page)
    const result = await page.evaluate(async () => {
      const state = (window as any).testHeight
      const observed = new MutationObserver(() => {
        if (!document.querySelector('[data-html-height-measurement]')) return
        state.observer.destroy()
        observed.disconnect()
      })
      observed.observe(document.body, { childList: true })
      let failed = false
      try { await state.observer.waitForReady() } catch { failed = true }
      await new Promise(resolve => setTimeout(resolve, 40))
      return { failed, heights: state.heights, errors: state.errors, mirrors: document.querySelectorAll('[data-html-height-measurement]').length }
    })
    expect(result).toEqual({ failed: true, heights: [500], errors: [], mirrors: 0 })
  } finally { await page.close() }
})

it.each([true, false])('formal managed runtime observation readiness includes isolated layout (unsupported=%s)', async unsupported => {
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="host" style="width:640px"></div>')
    await page.addScriptTag({ content: script })
    const result = await page.evaluate(async unsupported => {
      const api = (window as any).HeightReview
      const source = api.createHtmlDocumentRuntimeSource({ html: `<!doctype html><style>body{margin:0}main{min-height:100vh;${unsupported ? 'padding:20px' : ''}}</style><main><article style="height:480px"></article></main>`, resourceKeys: [] })
      const bytes = new Uint8Array(source.length * 2)
      for (let index = 0; index < source.length; index++) { bytes[index * 2] = source.charCodeAt(index) & 255; bytes[index * 2 + 1] = source.charCodeAt(index) >>> 8 }
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
      const session = api.createPublishedSurfaceRuntimeSession()
      const errors: string[] = []
      let handle: any
      handle = api.mountPublishedSurfaceRuntime(document.getElementById('host'), { instanceId: 'review', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', code: { encoding: 'base64-utf16le', data: btoa(binary) }, content: { values: {} }, assets: {} }, width: 640, height: 300, visible: true, session, resolveAsset: () => undefined, onContentHeightChange: (height: number) => handle.updateSize(640, height), reportError: (_phase: string, error: Error) => errors.push(error.message) })
      let failure = ''
      try { await handle.waitForObservationReady() } catch (error) { failure = String(error) }
      const result = { failure, ok: handle.ok, errors, mirrors: document.querySelectorAll('[data-html-height-measurement]').length }
      handle.destroy(); session.destroy()
      return result
    }, unsupported)
    expect(result.ok).toBe(!unsupported)
    if (unsupported) expect(result.failure).toContain('无法')
    else expect(result.failure).toBe('')
    expect(result.errors).toHaveLength(unsupported ? 1 : 0)
    expect(result.mirrors).toBe(0)
  } finally { await page.close() }
})
