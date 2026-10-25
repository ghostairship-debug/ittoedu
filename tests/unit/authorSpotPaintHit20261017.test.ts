// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { componentPaintStack } from '../../src/components/web/paintHit'

let browser: Browser, page: Page
beforeAll(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage() })
afterAll(async () => { await browser?.close() })

async function painted(html: string, x: number, y: number) {
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:400px;height:200px}</style>${html}`)
  return page.evaluate(({ source, x, y }) => {
    const paintAt = new Function(`return (${source})`)() as (root: Element, x: number, y: number) => Element[]
    return paintAt(document.documentElement, x, y).length > 0
  }, { source: componentPaintStack.toString(), x, y })
}

it('lets a retained fragment empty viewport pass without treating its real text or graphics as empty', async () => {
  const text = '<svg viewBox="0 0 400 200"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><text x="220" y="150" font-size="20">Other label</text></svg>'
  expect(await painted(text, 40, 40)).toBe(false)
  expect(await painted(text, 250, 144)).toBe(true)
  expect(await painted('<svg viewBox="0 0 400 200"><rect width="100" height="100" fill="red"/></svg>', 40, 40)).toBe(true)
  expect(await painted('<svg viewBox="0 0 400 200"><rect width="400" height="200" fill="transparent"/></svg>', 40, 40)).toBe(false)
  expect(await painted('<svg viewBox="0 0 400 200"><rect width="400" height="200" fill="red" fill-opacity="0"/></svg>', 40, 40)).toBe(false)
})

it('keeps actual HTML backgrounds and foreground controls blocking while transparent wrappers pass', async () => {
  expect(await painted('<div style="width:400px;height:200px"><span style="margin-left:220px">Other label</span></div>', 40, 100)).toBe(false)
  expect(await painted('<div style="width:400px;height:200px;background:#fff"></div>', 40, 100)).toBe(true)
  expect(await painted('<button style="width:100px;height:100px">Foreground</button>', 40, 40)).toBe(true)
  expect(await painted('<div style="visibility:hidden"><div style="visibility:visible;width:100px;height:100px;background:red"></div></div>', 40, 40)).toBe(true)
})

it('keeps a hollow border and visible descendants coordinate-correct within one synchronous paint read', async () => {
  await page.setContent(`<style>html,body{margin:0}#border{position:absolute;left:10px;top:10px;width:100px;height:100px;border:10px solid red;pointer-events:none!important}
    #hidden{position:absolute;top:160px;visibility:hidden}#visible{visibility:visible;width:100px;height:80px;background:red}</style>
    <div id="border"></div><div id="hidden"><div id="visible"></div></div>`)
  const result = await page.evaluate(source => {
    const paintAt = new Function(`return (${source})`)() as typeof componentPaintStack
    const scope = { prepared: new Map(), restore: [] as Array<() => void>, paint: new Map(), shown: new Map() }
    try {
      const has = (id: string, x: number, y: number) => paintAt(document.documentElement, x, y, '', undefined, scope).some(element => element.id === id)
      return { edge: has('border', 15, 50), empty: has('border', 60, 60), otherEdge: has('border', 125, 50), visible: has('visible', 40, 180) }
    } finally { for (const restore of scope.restore.reverse()) restore() }
  }, componentPaintStack.toString())
  expect(result).toEqual({ edge: true, empty: false, otherEdge: true, visible: true })
})
