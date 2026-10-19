// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import type { HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'

let browser: Browser, page: Page
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: "export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'PrecisionCapture', target: 'es2022' })
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
})
afterAll(async () => { await browser?.close() })

async function capture(html: string) {
  await page.setContent(`<!doctype html><style>body{margin:0}</style>${html}`)
  return page.evaluate(() => {
    const api = (window as unknown as { PrecisionCapture: { captureHtmlDesignViewport(wait: number, css: unknown): Promise<HtmlDesignCapture>; cssUsesViewport: unknown } }).PrecisionCapture
    return api.captureHtmlDesignViewport(200, api.cssUsesViewport)
  })
}

it('keeps the actual subpixel widths of the frozen one-line example instead of CSSOM serialization', async () => {
  const measured = await capture(`<div style="position:relative;width:1280px;height:720px;font-family:'Microsoft YaHei',sans-serif"><p id="parameters" style="position:absolute;left:52px;top:489px;font-size:22px;margin:0">P = 30 毫米　f = 0.6（60%）　I = 20 毫米</p><p id="result" style="position:absolute;left:52px;top:532px;font-size:28px;font-weight:bold;margin:0">3000 升总雨量 = 800 升入渗 + 2200 升径流</p></div>`)
  const actual = await page.evaluate(() => ['parameters', 'result'].map(id => {
    const element = document.getElementById(id)!, rect = element.getBoundingClientRect()
    return { id, width: rect.width, height: rect.height, cssWidth: Number.parseFloat(getComputedStyle(element).width) }
  }))
  expect(actual.some(value => value.width !== value.cssWidth)).toBe(true)
  for (const original of actual) {
    const frame = measured.elements.find(element => element.attributes.id === original.id)?.frame
    expect(frame?.width).toBe(original.width)
    expect(frame?.height).toBe(original.height)
  }
})

it('keeps local border boxes through rotation, reflection, scale and vertical writing without accepting fragmented or 3D geometry', async () => {
  const measured = await capture(`<div style="position:absolute;left:120px;top:100px;transform:rotate(23deg) scale(1.2,-0.8);transform-origin:17px 9px"><div id="rotated" style="width:210.671875px;height:90.828125px;padding:7.25px 13.125px;border:2px solid;transform:rotate(22deg);transform-origin:30% 80%"></div></div><div id="vertical" style="position:absolute;left:600px;top:80px;width:170.671875px;height:92.828125px;box-sizing:border-box;padding:8.5px;border:3px solid;writing-mode:vertical-rl;transform:scale(-1.25,0.75)"></div><div id="zoomed" style="position:absolute;left:300px;top:250px;width:210.671875px;height:90.828125px;zoom:1.5;transform:rotate(45deg)"></div><div style="position:absolute;top:400px;width:70px;font:20px serif"><b id="fragmented">several words wrapping across lines</b></div><div id="threeD" style="position:absolute;left:800px;top:200px;width:90px;height:40px;transform:rotateY(20deg)"></div>`)
  const rotated = measured.elements.find(element => element.attributes.id === 'rotated')!
  expect(rotated.geometryIssue).toBeUndefined()
  expect(rotated.frame?.width).toBe(210.671875 + 13.125 * 2 + 4)
  expect(rotated.frame?.height).toBe(90.828125 + 7.25 * 2 + 4)
  const vertical = measured.elements.find(element => element.attributes.id === 'vertical')!
  expect(vertical.geometryIssue).toBeUndefined()
  expect(vertical.frame).toMatchObject({ width: 170.671875, height: 92.828125 })
  expect(vertical.frame?.transform.slice(0, 4)).toEqual([-1.25, 0, 0, 0.75])
  const zoomed = measured.elements.find(element => element.attributes.id === 'zoomed')!
  expect(zoomed.geometryIssue).toBeUndefined()
  const projected = await page.evaluate(frames => frames.map(({ id, frame }) => {
    const original = document.getElementById(id)!.getBoundingClientRect(), root = document.createElement('div')
    Object.assign(root.style, { position: 'absolute', left: '0', top: '0', width: `${frame.width}px`, height: `${frame.height}px`, transformOrigin: '0 0', transform: `matrix(${frame.transform.join(',')})` })
    document.body.append(root)
    const actual = root.getBoundingClientRect()
    root.remove()
    return { original: [original.x, original.y, original.width, original.height], actual: [actual.x, actual.y, actual.width, actual.height] }
  }), [rotated, vertical, zoomed].map(element => ({ id: element.attributes.id!, frame: element.frame! })))
  // Affine coefficients still come from CSSOM's serialized transform matrix;
  // this check retains its existing geometric tolerance, separate from exact local sizes.
  for (const pair of projected) for (let axis = 0; axis < 4; axis++) expect(Math.abs(pair.actual[axis]! - pair.original[axis]!)).toBeLessThan(0.1)
  expect(measured.elements.find(element => element.attributes.id === 'fragmented')?.geometryIssue).toBe('non-rectangular-layout-box')
  expect(measured.elements.find(element => element.attributes.id === 'threeD')?.geometryIssue).toBe('non-affine-3d-transform')
})
