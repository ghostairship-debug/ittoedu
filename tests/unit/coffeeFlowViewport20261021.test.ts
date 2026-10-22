// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import type { PublishedCourseV4 } from '../../src/shared/contracts/component-platform/published'

it('reflows Flow text and fits only the fixed local group when the actual viewport changes', async () => {
  const payload: PublishedCourseV4 = {
    schemaVersion: 4, id: 'flow-viewport', title: 'Flow viewport regression', rootIds: ['flow'], entry: { rootInstanceId: 'flow' },
    global: { underlay: [], overlay: [] }, assets: {}, definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
    }, instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['body', 'fixed'], container: {
        kind: 'flow', designSize: { width: 1280, height: 900 }, flow: { layout: { widthMode: 'reading', readingWidth: 1000, wideContentWidth: 1280, toc: 'hidden' } },
      } },
      body: { id: 'body', definitionId: 'text', data: { text: 'Flow text must reflow at its original font size. '.repeat(20) } },
      fixed: { id: 'fixed', definitionId: 'group', data: {}, childIds: ['fixed-text'], frame: { width: 1120, height: 300, transform: [1, 0, 0, 1, 0, 0] } },
      'fixed-text': { id: 'fixed-text', definitionId: 'text', data: { text: 'Fixed composition' }, frame: { width: 300, height: 60, transform: [1, 0, 0, 1, 800, 200] } },
    },
  }
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(payload, { document: dom.window.document,
    renderBuiltin: async instance => `<p style="font:22px/1.6 sans-serif;margin:0">${(instance.data as { text?: string }).text ?? ''}</p>` })
  dom.window.close()
  const bundle = await build({ stdin: { contents: "export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'FlowViewport', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const metrics: Record<string, any> = {}, errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const output = process.env.COFFEE_V01_EVIDENCE_DIR
  try {
    await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.evaluate(async serialized => { (window as any).flowViewportPlayer = await (window as any).FlowViewport.mountCompiledCourse(JSON.parse(serialized), document.getElementById('root')) }, JSON.stringify(artifact))
    const read = () => page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('[data-compiled-node="body"]')!, fixed = document.querySelector<HTMLElement>('[data-compiled-node="fixed"]')!
      const p = body.querySelector('p')!, text = p.firstChild!, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1)
      const children = fixed.querySelector<HTMLElement>(':scope > [data-compiled-stage] > [data-compiled-children]')!
      const box = (node: Element) => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
      return { body: box(body), glyph: range.getBoundingClientRect().height, fixed: box(fixed), children: box(children),
        childrenTransform: getComputedStyle(children).transform, contentWidth: body.clientWidth, observationZoom: (window as any).flowViewportPlayer.observation('flow').state.zoom }
    })
    metrics.desktop = await read()
    await page.setViewportSize({ width: 390, height: 900 })
    await expect.poll(async () => (await read()).contentWidth).toBeLessThan(metrics.desktop.contentWidth)
    metrics.narrow = await read()
    if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'narrow.png') }) }
    expect(metrics.narrow.glyph).toBeCloseTo(metrics.desktop.glyph, 1)
    expect(metrics.narrow.body.height).toBeGreaterThan(metrics.desktop.body.height)
    expect(metrics.narrow.children.width).toBeLessThanOrEqual(metrics.narrow.fixed.width + 0.5)
    expect(metrics.narrow.children.width / metrics.narrow.children.height).toBeCloseTo(1120 / 300, 2)
    await page.evaluate(() => (window as any).flowViewportPlayer.observation('flow').zoomTo(2))
    metrics.zoomed = await read()
    expect(metrics.zoomed.contentWidth).toBe(metrics.narrow.contentWidth)
    expect(metrics.zoomed.glyph).toBeCloseTo(metrics.narrow.glyph * 2, 1)
    expect(errors).toEqual([])
  } finally {
    if (output) { await mkdir(output, { recursive: true }); await writeFile(join(output, 'facts.json'), JSON.stringify({ metrics, errors }, null, 2)) }
    await page.evaluate(() => (window as any).flowViewportPlayer?.dispose()).catch(() => {})
    await browser.close()
  }
}, 30000)
