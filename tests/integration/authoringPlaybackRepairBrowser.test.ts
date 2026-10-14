// @vitest-environment node
import path from 'node:path'
import fs from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { createR08MixedSavedFixture } from '../helpers/r08MixedSaveFixture'

let server: ViteDevServer, browser: Browser, url: string
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-authoring-playback-repair'),
    plugins: [{ name: 'fixture-player-bundle', resolveId: id => id === 'virtual:player-bundle' ? '\0fixture-player-bundle' : undefined,
      load: async id => id === '\0fixture-player-bundle' ? `export default ${JSON.stringify(await fs.readFile('dist-player/player.iife.js', 'utf8'))}` : undefined }],
    resolve: { alias: { '@': path.resolve('src') } }, optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'react-dom', 'zustand', 'mermaid', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__authoring-playback-repair', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body style="margin:0"><div id="fixture" style="width:1100px;height:740px"></div><script type="module">import {mountAuthoringPlaybackRepair} from "/tests/helpers/authoringPlaybackRepairHarness.tsx";window.fixture=mountAuthoringPlaybackRepair(document.querySelector("#fixture"));window.ready=true;</script></body></html>')
  })
  server.middlewares.use('/__flow-toc', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body style="margin:0"><div id="fixture" style="width:100vw;height:100vh;position:relative"></div><script type="module">import {mountFlowToc} from "/tests/helpers/r05FlowTocHarness.ts";window.fixture=await mountFlowToc(document.querySelector("#fixture"),location.search.includes("hidden"));window.ready=true;</script></body></html>')
  })
  server.middlewares.use('/__mixed-data', (_request, response) => {
    void createR08MixedSavedFixture().then(payload => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload)) })
      .catch(error => { response.statusCode = 500; response.end(String(error)) })
  })
  server.middlewares.use('/__mixed-navigation', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body style="margin:0"><div id="fixture" style="width:100vw;height:100vh;position:relative"></div><script type="module">import {mountPublishedCourseV3} from "/src/player/componentPlatform/publishedPlayer.ts";const payload=await(await fetch("/__mixed-data")).json();window.errors=[];window.player=await mountPublishedCourseV3(payload,document.querySelector("#fixture"),{report:text=>window.errors.push(text)});window.ready=true;</script></body></html>')
  })
  await server.listen(); const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  url = `http://127.0.0.1:${address.port}/__authoring-playback-repair`
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)

it('R05: independent Flow title drawer follows actual scrolling and leaves reading width unchanged at desktop and narrow sizes', async () => {
  const page = await browser.newPage({ viewport: { width: 1120, height: 780 } })
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => console.info('Flow fixture page error:', error.message))
  try {
    await page.goto(url.replace('/__authoring-playback-repair', '/__flow-toc'))
    await page.waitForFunction(() => Reflect.get(window, 'ready'))
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').diagnostics)).toEqual([])
    const toggle = page.getByTestId('flow-runtime-toc-toggle'), paper = page.locator('[data-flow-paper-scroll] article')
    expect(await toggle.getAttribute('aria-expanded')).toBe('false')
    const width = await paper.evaluate(element => element.getBoundingClientRect().width)
    await toggle.click()
    expect(await paper.evaluate(element => element.getBoundingClientRect().width)).toBe(width)
    await page.locator('[data-flow-toc-anchor="conclusion"]').click()
    await expect.poll(() => page.locator('[data-flow-paper-scroll]').evaluate(element => element.scrollTop)).toBeGreaterThan(500)
    await expect.poll(() => page.locator('[data-flow-toc-anchor="conclusion"]').getAttribute('aria-current')).toBe('location')
    await page.screenshot({ path: 'output/authoring-playback-repair-20261012/R05-flow-desktop.png' })
    await toggle.click(); await page.setViewportSize({ width: 390, height: 740 })
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    const narrowWidth = await paper.evaluate(element => element.getBoundingClientRect().width)
    await toggle.click()
    expect(await paper.evaluate(element => element.getBoundingClientRect().width)).toBe(narrowWidth)
    await page.locator('[data-flow-toc-anchor="intro"]').click()
    await expect.poll(() => page.locator('[data-flow-paper-scroll]').evaluate(element => element.scrollTop)).toBeLessThan(150)
    await page.screenshot({ path: 'output/authoring-playback-repair-20261012/R05-flow-narrow.png' })
    await page.goto(url.replace('/__authoring-playback-repair', '/__flow-toc?hidden'))
    await page.waitForFunction(() => Reflect.get(window, 'ready'))
    expect(await page.getByTestId('flow-runtime-toc-toggle').count()).toBe(0)
  } finally { await page.close() }
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })

it('R08: current human and agent edits survive cold open and two ordinary source controls keep separate views across Slide Flow Spatial', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.setDefaultTimeout(6000)
  page.on('pageerror', error => console.info('Mixed source page error:', error.message))
  try {
    await page.goto(url.replace('/__authoring-playback-repair', '/__mixed-navigation'))
    await page.waitForFunction(() => Reflect.get(window, 'ready'))
    const a = page.frameLocator('[data-component-object="a"] iframe'), b = page.frameLocator('[data-component-object="b"] iframe')
    await a.locator('#move').waitFor(); await b.locator('#move').waitFor()
    expect(await a.locator('output').textContent()).toContain('AI 在人工布局上改文案 / slide / false')
    const beforeA = await page.locator('[data-component-object="a"]').boundingBox(), beforeB = await page.locator('[data-component-object="b"]').boundingBox()
    await a.locator('#move').click()
    await expect.poll(async () => (await page.locator('[data-component-object="a"]').boundingBox())!.x).toBeCloseTo(beforeA!.x + 40 * beforeA!.width / 430, 0)
    expect(await page.locator('[data-component-object="b"]').boundingBox()).toEqual(beforeB)
    await a.locator('#fold').click()
    await expect.poll(() => a.locator('output').textContent()).toContain('/ true / 1')
    expect(await b.locator('output').textContent()).toContain('/ false / 0')
    await a.locator('#next').click()
    await expect.poll(() => a.locator('output').textContent()).toContain('/ flow / true / 1')
    expect(await b.locator('output').textContent()).toContain('/ flow / false / 0')
    await b.locator('#next').click()
    await expect.poll(() => a.locator('output').textContent()).toContain('/ spatial / true / 1')
    expect(await b.locator('output').textContent()).toContain('/ spatial / false / 0')
    await page.screenshot({ path: 'output/authoring-playback-repair-20261012/R08-two-source-controls.png' })
    expect(await page.evaluate(() => Reflect.get(window, 'errors'))).toEqual([])
    await page.evaluate(() => Reflect.get(window, 'player').dispose())
  } finally { await page.close() }
}, 30_000)

it('R02: real dynamic content remains clickable with unknown dependencies and a failed sibling; startup failure remains visible and closable', async () => {
  const page = await browser.newPage({ viewport: { width: 1120, height: 780 } })
  try {
    await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'ready'))
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixture').read().feedback)).toBeNull()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixture').read().diagnostics.join('\n'))).toContain('不能静态确定')
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixture').read().diagnostics.join('\n'))).toContain('missing-fixture-implementation')
    const dynamic = page.frames().find(frame => frame.name().includes('dynamic'))
    // The content realm is selected by its real button, not an assumed frame name.
    let content = dynamic
    await expect.poll(async () => {
      for (const frame of page.frames()) if (await frame.getByRole('button', { name: '开始实验' }).count()) { content = frame; return true }
      return false
    }).toBe(true)
    await content!.getByRole('button', { name: '开始实验' }).click()
    await expect.poll(() => content!.locator('#result').textContent()).toBe('结果 1')
    await page.getByText(/^播放说明/).click()
    await expect.poll(() => page.getByTestId('course-preview-notices').getAttribute('open')).toBe('')
    await page.getByText(/^播放说明/).click()
    await content!.getByRole('button', { name: '开始实验' }).click()
    await expect.poll(() => content!.locator('#result').textContent()).toBe('结果 2')
    await fs.mkdir(path.resolve('output/authoring-playback-repair-20261012'), { recursive: true })
    await page.screenshot({ path: path.resolve('output/authoring-playback-repair-20261012/R02-preview.png') })
    await page.getByRole('button', { name: '关闭预览' }).click()
    await page.evaluate(() => Reflect.get(window, 'fixture').invalidate())
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    await expect.poll(() => page.getByTestId('course-preview-feedback').textContent()).toContain('整课预览启动失败')
    await page.getByRole('button', { name: '关闭预览' }).click()
    expect(await page.getByRole('button', { name: '整课预览', exact: true }).count()).toBe(1)
  } finally { await page.close() }
}, 30_000)
