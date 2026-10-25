// @vitest-environment node
import { beforeAll, afterAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

let browser: Browser, agent: string, frameBootstrap: string
const output = resolve('output/test-runs/html-paint-input-20261025')
beforeAll(async () => {
  await mkdir(output, { recursive: true })
  const bundle = await build({ entryPoints: [resolve('src/player/htmlPreview/htmlPreviewAgent.ts')], bundle: true,
    platform: 'browser', format: 'iife', target: 'es2022', write: false })
  agent = bundle.outputFiles[0]!.text
  const frame = await build({ entryPoints: [resolve('src/shared/html/htmlFrameAuthoring.ts')], bundle: true,
    platform: 'browser', format: 'iife', globalName: 'FrameFixture', target: 'es2022', write: false })
  frameBootstrap = new Function(frame.outputFiles[0]!.text + ';return FrameFixture.htmlFrameAuthoringBootstrapSource()')()
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

async function mount(html: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 650 } })
  await page.setContent(html)
  await page.evaluate(() => {
    const events: any[] = []; (window as any).htmlPaintEvents = events
    window.addEventListener('message', event => {
      const value = event.data
      if (value?.protocol !== 1) return
      events.push(value)
      if (value.event === 'html-preview.hello') window.postMessage({ type: 'html-preview.init', leaseId: 'paint-test', loadId: 'paint-test' }, '*')
      if (value.event === 'ready') window.postMessage({ type: 'html-preview.edit-mode', loadId: 'paint-test', requestId: 'edit', enabled: true }, '*')
      if (value.event === 'edit-targets') window.postMessage({ type: 'html-preview.confirm-targets', loadId: 'paint-test',
        scanId: value.scanId, handles: value.targets.map((target: any) => target.handle) }, '*')
    })
  })
  await page.addScriptTag({ content: agent })
  await page.waitForFunction(() => (window as any).htmlPaintEvents.some((event: any) => event.event === 'edit-mode-ready' && event.enabled))
  return page
}

it('draws hints only for exposed content and selects painted decorations and transparent paragraph bodies through the actual agent', async () => {
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="red"/></svg>')
  const page = await mount(`<style>html,body{margin:0}p{margin:0;font:20px/30px monospace;position:absolute;left:20px}
    #covered{top:30px}#cover{position:absolute;inset:0 auto auto 0;width:600px;height:110px;background:white;z-index:3}
    #partial{top:140px}#partial-cover{position:absolute;left:20px;top:140px;width:130px;height:35px;background:white;z-index:3}
    #under-image{top:240px}#body-hit{top:350px;width:400px;height:50px;background:transparent}
    img{position:absolute;left:20px;top:235px;width:150px;height:50px;z-index:3;pointer-events:none}</style>
    <p id="covered">Hidden behind cover</p><div id="cover"><span>Front cover</span></div>
    <p id="partial">Partly exposed text</p><div id="partial-cover"></div>
    <p id="under-image">Behind image</p><img src="${image}"><p id="body-hit">Paragraph</p>`)
  try {
    await writeFile(resolve(output, 'paint-start.json'), JSON.stringify(await page.evaluate(() => ({
      events: (window as any).htmlPaintEvents.map((event: any) => ({ event: event.event, targets: event.targets?.map((target: any) => ({ text: target.rawText, handle: target.handle })) })),
      content: ['covered', 'partial', 'under-image', 'body-hit'].map(id => { const element = document.getElementById(id)!; return {
        id, rect: element.getBoundingClientRect().toJSON(), painted: (window as any).__cwHtmlAuthoringConsumer.painted(element.firstChild) } }),
    })), null, 2))
    await page.waitForFunction(() => {
      const reports = (window as any).htmlPaintEvents.filter((event: any) => event.event === 'edit-targets').flatMap((event: any) => event.targets)
      const partial = reports.find((target: any) => target.rawText === 'Partly exposed text')
      return partial && document.querySelector('[data-html-preview-edit-markers]')?.shadowRoot?.querySelector(`[data-html-preview-edit-target="${partial.handle}"]`)
    })
    const facts = await page.evaluate(() => {
      const reports = (window as any).htmlPaintEvents.filter((event: any) => event.event === 'edit-targets').flatMap((event: any) => event.targets)
      const layer = document.querySelector('[data-html-preview-edit-markers]')?.shadowRoot
      const has = (text: string) => { const target = reports.find((value: any) => value.rawText === text); return Boolean(target && layer?.querySelector(`[data-html-preview-edit-target="${target.handle}"]`)) }
      return { covered: has('Hidden behind cover'), underImage: has('Behind image'), partial: has('Partly exposed text') }
    })
    expect(facts).toEqual({ covered: false, underImage: false, partial: true })
    await page.mouse.dblclick(70, 250)
    await page.waitForFunction(() => (window as any).htmlPaintEvents.some((event: any) => event.event === 'targets' && event.intent === 'edit' && event.targets[0]?.kind === 'image'))
    await page.mouse.click(380, 365)
    await page.waitForFunction(() => (window as any).htmlPaintEvents.some((event: any) => event.event === 'targets' && event.intent === 'select' && event.targets[0]?.rawText === 'Paragraph'))
    const partialBox = await page.locator('#partial').boundingBox()
    if (!partialBox) throw new Error('Missing partial text layout')
    await page.mouse.move(partialBox.x + partialBox.width - 5, partialBox.y + partialBox.height / 2)
    await page.waitForFunction(() => document.querySelector('[data-html-preview-edit-markers]')?.shadowRoot?.querySelector('[data-state="hovered"]'))
    const hints = await page.evaluate(() => (window as any).__cwHtmlAuthoringConsumer.targets().filter((node: Node) => /点此编辑|点此选中/.test(node.textContent ?? '')).length)
    expect(hints).toBe(0)
    const batching = await page.evaluate(() => {
      const consumer = (window as any).__cwHtmlAuthoringConsumer
      const sheets = [...document.adoptedStyleSheets], image = document.querySelector('img')!
      image.style.setProperty('pointer-events', 'none', 'important')
      const authoredStyle = image.getAttribute('style')
      const original = CSSStyleSheet.prototype.replaceSync
      let installations = 0
      CSSStyleSheet.prototype.replaceSync = function(...args) { installations++; return original.apply(this, args) }
      let threw = false
      try {
        consumer.withReadScope(() => {
          consumer.painted(document.getElementById('partial')!.firstChild)
          consumer.withReadScope(() => consumer.painted(image))
          consumer.hit(70, 250)
          throw new Error('stop this read')
        })
      } catch (error) { threw = (error as Error).message === 'stop this read' }
      finally { CSSStyleSheet.prototype.replaceSync = original }
      return { installations, threw, restoredInline: image.getAttribute('style') === authoredStyle,
        restoredSheets: sheets.length === document.adoptedStyleSheets.length && sheets.every((sheet, i) => document.adoptedStyleSheets[i] === sheet) }
    })
    expect(batching).toEqual({ installations: 1, threw: true, restoredInline: true, restoredSheets: true })
    const settledReports = await page.evaluate(async () => {
      const reports = () => (window as any).htmlPaintEvents.filter((event: any) => event.event === 'edit-targets').length
      for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const before = reports()
      for (let i = 0; i < 6; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      return { before, after: reports() }
    })
    expect(settledReports.after).toBe(settledReports.before)
    await page.screenshot({ path: resolve(output, 'painted-hints.png') })
    await writeFile(resolve(output, 'painted-facts.json'), JSON.stringify(facts, null, 2))
  } finally { await page.close() }
})

it('does not discover again from its own opaque-frame hints and still observes an authored text change', async () => {
  const child = `<script>${frameBootstrap}</script><style>body{margin:0}p{margin:0;font:18px/24px monospace}</style><p id="title">Opaque title</p>${Array.from({ length: 12 }, (_, i) => `<p>Row ${i}</p>`).join('')}`
  const page = await mount(`<style>iframe{width:700px;height:500px}</style><iframe sandbox="allow-scripts" srcdoc="${child.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`)
  try {
    const frame = page.frames().find(frame => frame !== page.mainFrame())!
    await frame.waitForSelector('[data-html-preview-edit-markers]')
    const frames = async (count: number) => page.evaluate(async count => {
      for (let i = 0; i < count; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }, count)
    await frames(4)
    const reports = () => page.evaluate(() => (window as any).htmlPaintEvents.filter((event: any) => event.event === 'edit-targets').length)
    const before = await reports()
    expect(before).toBeGreaterThan(0)
    await frames(6)
    expect(await reports()).toBe(before)
    await frame.locator('#title').evaluate(element => { element.textContent = 'Changed opaque title' })
    await page.waitForFunction(() => (window as any).htmlPaintEvents.some((event: any) => event.event === 'edit-targets'
      && event.targets.some((target: any) => target.rawText === 'Changed opaque title')))
    const afterText = await reports()
    await frame.locator('#title').evaluate(element => { (element as HTMLElement).style.fontSize = '24px' })
    await page.waitForFunction(count => (window as any).htmlPaintEvents.filter((event: any) => event.event === 'edit-targets').length > count, afterText)
    await page.screenshot({ path: resolve(output, 'opaque-stable-hints.png') })
  } finally { await page.close() }
})

it('keeps a nested preview responsive after hovering its empty painted viewport and then double-clicking text', async () => {
  const child = `<style>html,body{margin:0}body{background:#152b29}main{position:fixed;left:100px;top:260px;width:500px;height:250px;background:white}h1{margin:40px}</style><main><h1>Nested text</h1></main>`
  const page = await mount(`<style>html,body{margin:0}iframe{position:fixed;inset:0;width:800px;height:650px;border:0}</style><iframe srcdoc="${child.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`)
  try {
    await page.mouse.move(600, 100)
    await page.mouse.dblclick(240, 320)
    await page.waitForFunction(() => (window as any).htmlPaintEvents.some((event: any) => event.event === 'targets' && event.intent === 'edit' && event.targets[0]?.rawText === 'Nested text'))
    expect(await page.evaluate(() => 1)).toBe(1)
    await page.screenshot({ path: resolve(output, 'nested-after-empty-hit.png') })
    await writeFile(resolve(output, 'nested-events.json'), JSON.stringify(await page.evaluate(() => (window as any).htmlPaintEvents.filter((event: any) => event.event === 'targets')), null, 2))
  } finally { await page.close() }
})

it('accepts a text receipt already projected by canonical state and still rejects a different live value', async () => {
  const page = await mount('<p id="text">Before</p>')
  try {
    await page.waitForFunction(() => (window as any).htmlPaintEvents.some((event: any) => event.event === 'edit-targets' && event.targets.some((target: any) => target.rawText === 'Before')))
    const handle = await page.evaluate(() => (window as any).htmlPaintEvents.find((event: any) => event.event === 'edit-targets').targets.find((target: any) => target.rawText === 'Before').handle)
    await page.evaluate(handle => {
      const text = document.getElementById('text')!.firstChild!
      text.nodeValue = 'Canonical after'
      ;(window as any).idempotentTextWrites = 0
      new MutationObserver(records => { (window as any).idempotentTextWrites += records.length }).observe(text, { characterData: true })
      window.postMessage({ type: 'html-preview.patch', loadId: 'paint-test', handle, kind: 'text', expected: 'Before', value: 'Canonical after' }, '*')
      window.postMessage({ type: 'html-preview.edit-mode', loadId: 'paint-test', requestId: 'text-receipt-barrier', enabled: true }, '*')
    }, handle)
    await page.waitForFunction(() => (window as any).htmlPaintEvents.some((event: any) => event.event === 'edit-mode-ready' && event.requestId === 'text-receipt-barrier'))
    expect(await page.evaluate(handle => (window as any).htmlPaintEvents.some((event: any) => event.event === 'html-preview.patch-result' && event.handle === handle && !event.ok), handle)).toBe(false)
    expect(await page.evaluate(() => (window as any).idempotentTextWrites)).toBe(0)
    await page.evaluate(handle => {
      document.getElementById('text')!.firstChild!.nodeValue = 'Another live edit'
      window.postMessage({ type: 'html-preview.patch', loadId: 'paint-test', handle, kind: 'text', expected: 'Before', value: 'Canonical after' }, '*')
    }, handle)
    await page.waitForFunction(handle => (window as any).htmlPaintEvents.some((event: any) => event.event === 'html-preview.patch-result' && event.handle === handle && !event.ok), handle)
    expect(await page.locator('#text').textContent()).toBe('Another live edit')
  } finally { await page.close() }
})
