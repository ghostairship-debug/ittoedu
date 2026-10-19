// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { componentAuthorPaintAtPoint } from '../../src/player/components/runtime/SandboxComponentRuntime'

let browser: Browser, page: Page
beforeAll(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage() })
afterAll(async () => { await browser?.close() })

async function painted(html: string, x: number, y: number) {
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:400px;height:200px}</style>${html}`)
  return page.evaluate(({ source, x, y }) => {
    const paintAt = new Function(`return (${source})`)() as (root: Element, x: number, y: number) => boolean
    return paintAt(document.documentElement, x, y)
  }, { source: componentAuthorPaintAtPoint.toString(), x, y })
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
