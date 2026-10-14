// @vitest-environment node
import path from 'node:path'
import fs from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'

let server: ViteDevServer, browser: Browser, url: string
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-flow-manual-feedback'),
    resolve: { alias: { '@': path.resolve('src') } },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'react-dom', 'zustand', 'mermaid', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__flow-feedback', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body style="margin:0"><div id="fixture" style="position:relative;width:960px;height:640px;display:flex"></div><script type="module">import { mountFlowManualFeedback } from "/tests/helpers/flowManualFeedbackHarness.tsx"; window.mountFlow=async(...args)=>{await window.flow?.dispose();window.flow=await mountFlowManualFeedback(document.querySelector("#fixture"),...args)};await window.mountFlow();window.ready=true;</script></body></html>')
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  url = `http://127.0.0.1:${address.port}/__flow-feedback`
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })
async function mount(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  await page.goto(url)
  await page.waitForFunction(() => Reflect.get(window, 'ready'))
  await page.locator('[data-controller-authoring-id] [data-component-render]').waitFor()
  return page
}
async function rectangles(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector('[data-controller-authoring-id]')!.getBoundingClientRect()
    const points = document.querySelector('[data-flow-controller-selection] polygon')?.getAttribute('points')?.split(' ').map(value => value.split(',').map(Number)) ?? []
    return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, corners: points,
      project: Reflect.get(window, 'flow').read().project, operations: Reflect.get(window, 'flow').read().operations }
  })
}
it('Flow teacher body drag shares rendered selection preview and one saved undoable frame transaction', async () => {
  const page = await mount()
  try {
    const before = await rectangles(page)
    const point = { x: before.box.x + before.box.width / 2, y: before.box.y + before.box.height / 2 }
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 30, point.y - 70, { steps: 3 })
    const moving = await rectangles(page)
    expect(moving.box.x - before.box.x).toBeCloseTo(30, 1)
    expect(moving.box.y - before.box.y).toBeCloseTo(-70, 1)
    expect(moving.corners[0][0]).toBeCloseTo(moving.box.x, 1)
    expect(moving.corners[0][1]).toBeCloseTo(moving.box.y, 1)
    expect(moving.project).toEqual(before.project)
    expect(moving.operations).toHaveLength(0)
    await page.mouse.up()
    await expect.poll(async () => (await rectangles(page)).project.revision).toBe(1)
    const committed = await rectangles(page), teacherId = await page.evaluate(() => Reflect.get(window, 'flow').teacherId)
    expect(committed.box.x).toBeCloseTo(moving.box.x, 1); expect(committed.box.y).toBeCloseTo(moving.box.y, 1)
    expect(committed.operations).toHaveLength(1)
    const saved = await page.evaluate(() => Reflect.get(window, 'flow').save())
    expect(saved.project.instances[teacherId].frame).toEqual(committed.project.instances[teacherId].frame)
    expect(saved.project.surfaces[0]).toEqual(before.project.surfaces[0])
    await page.evaluate(() => Reflect.get(window, 'flow').undo())
    await expect.poll(async () => (await rectangles(page)).project.instances[teacherId].frame).toEqual(before.project.instances[teacherId].frame)
    await page.evaluate(() => Reflect.get(window, 'flow').redo())
    await expect.poll(async () => (await rectangles(page)).project.instances[teacherId].frame).toEqual(committed.project.instances[teacherId].frame)
    await fs.mkdir(path.resolve('output/playwright/flow-manual-feedback'), { recursive: true })
    await page.screenshot({ path: path.resolve('output/playwright/flow-manual-feedback/teacher-drag.png') })
  } finally { await page.close() }
}, 30_000)

it('Flow zoom uses the existing observer and blank paper continues below the visible end without formal edits', async () => {
  const page = await mount()
  try {
    const measure = () => page.evaluate(() => {
      const paper = document.querySelector<HTMLElement>('.flow-paper')!, scroll = document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!, teacher = document.querySelector('[data-controller-authoring-id]')!.getBoundingClientRect()
      return { width: paper.offsetWidth, paintWidth: paper.getBoundingClientRect().width, height: paper.offsetHeight, view: scroll.clientHeight, scrollHeight: scroll.scrollHeight,
        teacher: { x: teacher.x, y: teacher.y, width: teacher.width }, project: Reflect.get(window, 'flow').read().project, operations: Reflect.get(window, 'flow').read().operations }
    })
    const before = await measure()
    expect(before.width).toBe(900); expect(before.height).toBeGreaterThanOrEqual(before.view * 2)
    await page.getByRole('button', { name: '放大画布', exact: true }).click()
    await expect.poll(() => page.getByLabel('画布缩放比例').textContent()).toBe('110%')
    const enlarged = await measure()
    expect(enlarged.width).toBe(before.width); expect(enlarged.paintWidth / before.paintWidth).toBeCloseTo(1.1, 2)
    expect(enlarged.teacher).toEqual(before.teacher)
    await page.getByRole('button', { name: '适合窗口', exact: true }).click()
    await expect.poll(() => page.getByLabel('画布缩放比例').textContent()).toBe('100%')
    await page.locator('[data-flow-paper-scroll]').evaluate(node => { node.scrollTop = node.scrollHeight })
    await expect.poll(async () => (await measure()).height).toBeGreaterThan(before.height)
    const firstExtension = await measure()
    await page.locator('[data-flow-paper-scroll]').evaluate(node => { node.scrollTop = node.scrollHeight })
    await expect.poll(async () => (await measure()).height).toBeGreaterThan(firstExtension.height)
    const extended = await measure()
    expect(extended.project).toEqual(before.project); expect(extended.operations).toHaveLength(0)
    const saved = await page.evaluate(() => Reflect.get(window, 'flow').save())
    expect(saved.project).toEqual(before.project)
    await fs.mkdir(path.resolve('output/playwright/flow-manual-feedback'), { recursive: true })
    await page.screenshot({ path: path.resolve('output/playwright/flow-manual-feedback/blank-extension-zoom.png') })
    await page.evaluate(() => Reflect.get(window, 'mountFlow')(1280, false))
    await expect.poll(async () => (await measure()).width).toBe(1280)
  } finally { await page.close() }
}, 30_000)

it('readonly acceptance archive keeps its saved 900 reading width and missing designSize', async () => {
  const bytes = await fs.readFile(path.resolve('output/audit-real-machine-20261011/workspace/acceptance-saved-as.glx'))
  const model = new CourseV10Driver().load(bytes)
  if (model.kind !== 'course-v10') throw new Error('Expected V10 archive')
  const flow = model.project.surfaces.find(surface => surface.id === 'acceptance-flow')!
  expect(flow.flow!.layout).toMatchObject({ widthMode: 'reading', readingWidth: 900, wideContentWidth: 1100 })
  expect(flow.designSize).toBeUndefined()
})
