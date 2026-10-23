// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { build } from 'esbuild'

let browser: Browser, page: Page, script: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const bundle = await build({ stdin: { contents: `export { createDomAuthoring, domAuthoringFactorySource } from './src/components/web/authoringDom';
    export { createNestedDomAuthoring } from './src/components/web/nestedAuthoringDom';
    export { createAuthoringFrameGeometry } from './src/components/web/authoringFrame';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'AuthorFacts' })
  script = bundle.outputFiles[0].text
})
afterAll(async () => { await browser?.close() })

async function html(source: string) {
  await page.goto('about:blank'); await page.setContent(source); await page.addScriptTag({ content: script })
}

it('discovers painted absolute course content when body has no in-flow height and viewport overflow is hidden', async () => {
  await html(`<!doctype html><style>html,body{margin:0;overflow:hidden}#app{position:absolute;inset:0;width:900px;height:600px}p{font:32px Georgia;white-space:normal}</style>
    <main id="app"><p>Five questions. One connection.</p><p>A
      B</p></main>`)
  const result = await page.evaluate(() => {
    const lab = (window as any).AuthorFacts
    const factory = new Function(`return ${lab.domAuthoringFactorySource()}`)(), author = factory(document.documentElement, { records: () => ({}) })
    const targets = author.scan(), label = targets.find((value: any) => value.initialValue.startsWith('Five'))
    const box = label.node.parentElement.getBoundingClientRect()
    const result = { bodyHeight: document.body.getBoundingClientRect().height,
      values: targets.map((value: any) => value.initialValue), whiteSpace: targets[1]?.textStyle?.['white-space'],
      hit: author.hit(box.left + 10, box.top + 15)?.initialValue }
    author.dispose(); return result
  })
  expect(result.bodyHeight).toBe(0)
  expect(result.values).toEqual(['Five questions. One connection.', 'A\n      B'])
  expect(result.whiteSpace).toBe('normal')
  expect(result.hit).toBe('Five questions. One connection.')
})

it('uses actual positioned containing blocks for overflow while retaining real clipping and opacity', async () => {
  await html(`<style>html,body{margin:0}.clip{overflow:hidden;width:40px;height:40px}.text{font:24px sans-serif;white-space:nowrap}</style>
    <div style="position:relative;width:800px;height:500px">
      <div class="clip"><span id="escaped" class="text" style="position:absolute;left:120px;top:60px">Absolute escaped</span></div>
      <div class="clip"><span id="fixed" class="text" style="position:fixed;left:120px;top:120px">Fixed escaped</span></div>
      <div class="clip" style="position:relative"><span class="text" style="position:absolute;left:120px;top:0">Really clipped</span></div>
      <div class="clip" style="transform:translate(0px,0px)"><span class="text" style="position:fixed;left:120px;top:0">Fixed clipped</span></div>
      <div style="opacity:0"><span class="text" style="position:fixed;left:120px;top:220px">Transparent parent</span></div>
    </div>`)
  const result = await page.evaluate(() => {
    const lab = (window as any).AuthorFacts, author = lab.createDomAuthoring(document.documentElement, { records: () => ({}) })
    const values = author.scan().map((value: any) => value.initialValue)
    const painted = ['escaped', 'fixed'].map(id => {
      const element = document.getElementById(id)!, rect = element.getBoundingClientRect()
      return document.elementsFromPoint(rect.left + 5, rect.top + 12).includes(element)
    })
    author.dispose(); return { values, painted }
  })
  expect(result.painted).toEqual([true, true])
  expect(result.values).toEqual(['Absolute escaped', 'Fixed escaped'])
})

it('does not replace a fixed descendant containing block with an intermediate positioned ancestor', async () => {
  await html(`<!doctype html><style>html,body{margin:0}</style>
    <div style="transform:translate(0px,0px);width:800px;height:500px">
      <div style="position:relative;overflow:hidden;width:40px;height:0">
        <div style="position:absolute;left:0;top:0;width:40px;height:40px">
          <span id="fixed" style="position:fixed;left:120px;top:60px;font:24px sans-serif">Fixed beyond intermediate clip</span>
        </div>
      </div>
    </div>`)
  const result = await page.evaluate(() => {
    const lab = (window as any).AuthorFacts, author = lab.createDomAuthoring(document.documentElement, { records: () => ({}) })
    const element = document.getElementById('fixed')!, box = element.getBoundingClientRect()
    const result = { painted: document.elementsFromPoint(box.left + 5, box.top + 12).includes(element),
      values: author.scan().map((value: any) => value.initialValue) }
    author.dispose(); return result
  })
  expect(result.painted).toBe(true)
  expect(result.values).toEqual(['Fixed beyond intermediate clip'])
})

it('composes nested frame glyph style with the same scale and rotation as its actual painted text', async () => {
  await html(`<style>html,body{margin:0}</style><div style="position:absolute;left:100px;top:80px">
    <iframe id="child" style="width:300px;height:150px;border:4px solid;padding:6px;transform:rotate(20deg) scale(.5);transform-origin:0 0"
      srcdoc="<style>html,body{margin:0}p{margin:0;font:40px Georgia;white-space:normal}</style><p>A
      B</p>"></iframe></div>`)
  await page.locator('iframe').contentFrame().locator('p').waitFor()
  const result = await page.evaluate(() => {
    const lab = (window as any).AuthorFacts, author = lab.createNestedDomAuthoring(document.documentElement, lab.createDomAuthoring, { records: () => ({}) })
    const observed = author.scan().find((value: any) => value.node.ownerDocument !== document)
    const style = author.textStyle(observed.node), bounds = author.rect(observed.node)
    const overlay = document.createElement('span'); overlay.textContent = observed.initialValue
    for (const [name, value] of Object.entries(style)) overlay.style.setProperty(name, String(value))
    Object.assign(overlay.style, { position: 'absolute', left: '500px', top: '300px', display: 'inline-block' })
    document.body.append(overlay)
    const range = document.createRange(); range.selectNodeContents(overlay); const ink = range.getBoundingClientRect()
    const matrix = new DOMMatrix(style.transform)
    const result = { font: style['font-size'], whiteSpace: style['white-space'], scale: Math.hypot(matrix.a, matrix.b),
      angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI, bounds, ink: { width: ink.width, height: ink.height },
      scanStyle: observed.textStyle.transform }
    author.dispose(); return result
  })
  expect(result.font).toBe('40px')
  expect(result.whiteSpace).toBe('normal')
  expect(result.scale).toBeCloseTo(.5, 5)
  expect(result.angle).toBeCloseTo(20, 4)
  expect(result.bounds.width).toBeCloseTo(result.ink.width, 0)
  expect(result.bounds.height).toBeCloseTo(result.ink.height, 0)
  expect(result.scanStyle).toBeDefined()
})

it('keeps the frame helper portable and includes padding and negative scale in viewport coordinates', async () => {
  await html(`<style>html,body{margin:0}</style><iframe id="child" style="position:absolute;left:400px;top:100px;width:200px;height:100px;border:4px solid;padding:6px;transform:scale(-.5,.5);transform-origin:0 0"></iframe>`)
  const result = await page.evaluate(() => {
    const lab = (window as any).AuthorFacts, frame = document.querySelector('iframe')!
    const factory = new Function(`return (${lab.createAuthoringFrameGeometry.toString()})`)(), facts = factory()
    const matrix = facts.frameMatrix(frame, { width: 200, height: 100 })
    return { matrix, corner: facts.transformRect({ x: 0, y: 0, width: 200, height: 100 }, matrix) }
  })
  expect(result.matrix).toEqual([-.5, 0, 0, .5, 395, 105])
  expect(result.corner).toEqual({ x: 295, y: 105, width: 100, height: 50 })
})
