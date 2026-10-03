// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import type { PublishedCompositionLayerItem } from '../../src/shared/publishedCourseTypes'

let browser: Browser
let bundle: string
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `export {mountWebComposition} from './src/player/composition/mountWebComposition';export {createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount';export {courseThemeStyleText} from './src/shared/contracts/design-v1/theme';export {withCompositionNodeAttributes, compositionStateNodeAttributes} from './src/shared/composition/stateNodes'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CompositionTest', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 30000)
afterAll(async () => { await browser?.close() })

type Content = PublishedCompositionLayerItem['content']
type CNode = Content['root']
const element = (id: string, tagName: string, children: CNode[], attributes: Record<string, string> = {}): CNode => ({ id, kind: 'element', tagName, attributes, children })
const text = (id: string, value: string): CNode => ({ id, kind: 'text', text: value })
const encode = (source: string) => ({ encoding: 'base64-utf16le' as const, data: Buffer.from(source, 'utf16le').toString('base64') })

function lesson(): Content {
  return { assets: {}, doctype: '<!DOCTYPE html>', root: element('document', '#document', [element('html', 'html', [
    element('head', 'head', [element('style', 'style', [text('css', 'h1{margin:0}')])]),
    element('body', 'body', [
      element('title', 'h1', [text('title-text', '四季的成因')]),
      element('a', 'p', [text('a-text', '地轴倾斜')], { class: 'fragment' }),
      element('b', 'p', [text('b-text', '公转')], { class: 'fragment' }),
      element('img', 'img', [], { src: '../assets/地轴.svg', alt: '地轴倾斜示意图', style: 'width:320px;height:180px' }),
      element('pending', 'iframe', [], { src: '../components/公转模拟.html', title: '公转模拟' }),
      element('draft', 'iframe', [{ id: 'draft-runtime', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: false, renderMode: 'dom',
        code: encode('CoursewareRuntime.define({create(){return{destroy(){}}}})'), content: { values: {} }, assets: {}, draft: { reason: '第 3 行语法错误' } } }],
      { src: '../components/季节.html', title: '季节' }),
    ]),
  ])]) }
}

async function open(mode: 'playback' | 'capture' | 'authoring', step: number | undefined): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await page.setContent('<div id="host" style="width:900px;height:800px"></div>')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(async ({ content, mode, step }) => {
    const api = (window as any).CompositionTest
    const scene = { layerItems: [{ layerItemId: 'lesson', kind: 'composition', content }], presentation: { states: [{ layerItemOverrides: {}, fragmentStep: step }] } }
    const stateful = (k: number | undefined) => api.withCompositionNodeAttributes(content, api.compositionStateNodeAttributes(scene, { layerItemOverrides: {}, fragmentStep: k }).get('lesson'))
    const theme = api.courseThemeStyleText({ designTokens: { fonts: [], colors: [{ id: 'accent', label: '强调', color: '#ff0000' }] }, theme: { css: 'h1{color:var(--color-accent)}' } })
    const handle = api.mountWebComposition(document.getElementById('host'), { instanceId: 'lesson', content: stateful(step), width: 900, height: 800, mode, theme,
      session: api.createPublishedSurfaceRuntimeSession(), resolveAsset: () => undefined })
    Object.assign(window, { handle, stateful })
    await handle.ready
  }, { content: lesson(), mode, step })
  return page
}

const visibility = (page: Page, selector: string) => page.frameLocator('iframe[data-web-composition]').locator(selector)
  .evaluate(node => { const style = getComputedStyle(node); return { opacity: style.opacity, visibility: style.visibility } })

it('applies the course theme below the page styles and fades in revealed steps', async () => {
  const page = await open('playback', 0)
  try {
    expect(await page.frameLocator('iframe[data-web-composition]').locator('h1').evaluate(node => getComputedStyle(node).color)).toBe('rgb(255, 0, 0)')
    expect(await visibility(page, '[data-composition-node="a"]')).toEqual({ opacity: '0', visibility: 'hidden' })
    await page.evaluate(async () => { const w = window as any; await w.handle.update(w.stateful(1)) })
    await page.waitForTimeout(600)
    expect(await visibility(page, '[data-composition-node="a"]')).toEqual({ opacity: '1', visibility: 'visible' })
    expect(await visibility(page, '[data-composition-node="b"]')).toEqual({ opacity: '0', visibility: 'hidden' })
  } finally { await page.close() }
})

it('shows every step in a static capture and in the editing view', async () => {
  for (const mode of ['capture', 'authoring'] as const) {
    const page = await open(mode, 0)
    try {
      expect(await visibility(page, '[data-composition-node="b"]')).toEqual({ opacity: '1', visibility: 'visible' })
    } finally { await page.close() }
  }
})

it('shows placeholders for an unfilled image, an unwritten component and a draft component', async () => {
  const page = await open('playback', undefined)
  try {
    const frame = page.frameLocator('iframe[data-web-composition]')
    const image = await frame.locator('img').evaluate(node => ({ src: node.getAttribute('src'), title: node.getAttribute('title'), pending: node.getAttribute('data-guoling-pending') }))
    expect(image.src).toMatch(/^data:image\/svg\+xml/)
    expect(decodeURIComponent(image.src!)).toContain('地轴倾斜示意图')
    expect(image).toMatchObject({ title: '地轴倾斜示意图', pending: 'asset' })
    const pending = await frame.locator('[data-composition-node="pending"]').evaluate(node => ({ src: node.getAttribute('src'), srcdoc: node.getAttribute('srcdoc') }))
    expect(pending.src).toBeNull()
    expect(pending.srcdoc).toContain('公转模拟')
    await expect.poll(() => frame.frameLocator('[data-composition-node="draft"]').locator('body').textContent()).toContain('第 3 行语法错误')
  } finally { await page.close() }
})
