// @vitest-environment node
import path from 'node:path'
import fs from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer, browser: Browser, url: string
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-spatial-navigation-feedback'),
    resolve: { alias: { '@': path.resolve('src') } },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'react-dom', 'zustand', 'mermaid', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__spatial-navigation-feedback', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body style="margin:0"><div id="fixture" style="position:relative;width:960px;height:640px;display:flex"></div><div id="published" style="position:relative;width:960px;height:640px"></div><script type="module">import {mountSpatialNavigationFeedback} from "/tests/helpers/spatialNavigationFeedbackHarness.tsx";window.fixture=await mountSpatialNavigationFeedback(document.querySelector("#fixture"));window.ready=true;</script></body></html>')
  })
  await server.listen(); const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  url = `http://127.0.0.1:${address.port}/__spatial-navigation-feedback`
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })
async function mount(): Promise<Page> { const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } }); await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'ready')); return page }
it('actual Runtime/SpatialConnector starts run from the first camera and preserves explicit cross-surface target and previous last step', async () => {
  const page = await mount()
  try {
    const read = () => page.evaluate(() => Reflect.get(window, 'fixture').read())
    await page.evaluate(() => Reflect.get(window, 'fixture').free())
    expect((await read()).view.camera.x).toBe(999)
    await page.getByRole('button', { name: '试运行', exact: true }).click()
    await expect.poll(async () => (await read()).playing).toBe(true)
    expect((await read()).view.camera.x).toBe(200)
    expect((await read()).progress).toMatchObject({ stepIndex: 0, stepCount: 2 })
    await page.evaluate(() => Reflect.get(window, 'fixture').click())
    await expect.poll(async () => (await read()).surface).toBe('B')
    await expect.poll(async () => (await read()).view.camera.x).toBe(900)
    expect((await read()).playing).toBe(true)
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').navigate({ type: 'scene.previous' }))).toBe(true)
    expect((await read()).view.camera.x).toBe(200)
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').navigate({ type: 'scene.next' }))).toBe(true)
    expect((await read()).view.camera.x).toBe(400)
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').navigate({ type: 'step.previous' }))).toBe(true)
    expect((await read()).view.camera.x).toBe(700)
    await page.evaluate(() => Reflect.get(window, 'fixture').mode('edit'))
    await expect.poll(async () => (await read()).playing).toBe(false)
    await page.evaluate(() => { Reflect.get(window, 'fixture').free(); Reflect.get(window, 'fixture').mode('run') })
    await expect.poll(async () => (await read()).view.camera.x).toBe(200)
    expect((await read()).project.revision).toBe(0); expect((await read()).operations).toHaveLength(0)
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').errors)).toEqual([])
    await fs.mkdir(path.resolve('output/playwright/spatial-navigation-feedback'), { recursive: true })
    await page.screenshot({ path: path.resolve('output/playwright/spatial-navigation-feedback/author-first-camera.png') })
  } finally { await page.close() }
}, 30_000)
it('actual Published starts at the authored first camera, respects an explicit camera and leaves capture pose alone', async () => {
  const page = await mount()
  try {
    const run = async (options: Record<string, unknown>) => page.evaluate(async options => {
      await Reflect.get(window, 'publishedPlayer')?.dispose()
      const player = await Reflect.get(window, 'fixture').publish(document.querySelector('#published'), options)
      Reflect.set(window, 'publishedPlayer', player)
      return { camera: player.camera('A').read(), progress: player.navigation.read().progress, stateId: player.navigation.currentStateId() }
    }, options)
    const first = await run({})
    expect(first.camera.x).toBe(200); expect(first.progress).toMatchObject({ stepIndex: 0, stepCount: 2 })
    expect(first.stateId).toBeNull()
    const explicit = await run({ initialStateId: 'a-last' })
    expect(explicit.camera.x).toBe(700); expect(explicit.progress).toMatchObject({ stepIndex: 1, stepCount: 2 })
    const explicitGoState = await page.evaluate(async () => { const player = Reflect.get(window, 'publishedPlayer'); await player.go('A', 'a-last'); return player.navigation.currentStateId() })
    expect(explicit.stateId).toBeNull(); expect(explicit.stateId).toBe(explicitGoState)
    const follow = await page.evaluate(async () => {
      await Reflect.get(window, 'publishedPlayer').dispose()
      const container = document.querySelector<HTMLElement>('#published')!
      container.style.width = '640px'; container.style.height = '360px'
      const player = await Reflect.get(window, 'fixture').publish(container, {}, true)
      Reflect.set(window, 'publishedPlayer', player)
      const initial = player.camera('A').read()
      await player.go('A', 'a-first')
      return { initial, explicit: player.camera('A').read(), viewport: player.viewport('A') }
    })
    expect(follow.viewport).toEqual({ width: 1280, height: 720 })
    expect(follow.initial).toEqual(follow.explicit)
    expect(follow.initial.zoom).toBeGreaterThan(5)
    const captured = await run({ capture: true })
    expect(captured.camera.x).toBe(0)
    const pose = await page.evaluate(() => { const player = Reflect.get(window, 'publishedPlayer'); player.camera('A').set({ x: 333, y: 7, zoom: 1.2 }); return player.camera('A').read() })
    expect(pose).toEqual({ x: 333, y: 7, zoom: 1.2 })
  } finally { await page.close() }
}, 30_000)
