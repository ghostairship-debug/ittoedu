// @vitest-environment node
import path from 'node:path'
import fs from 'node:fs/promises'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer, browser: Browser, url: string
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-spatial-button-ui'),
    resolve: { alias: { '@': path.resolve('src') } },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'react-dom', 'zustand', 'mermaid', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__spatial-button-ui', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><body style="margin:0;display:flex"><div id="stage" style="position:relative;width:900px;height:700px;display:flex"></div><aside id="props" style="width:320px;height:700px;overflow:auto"></aside><script type="module">import {mountSpatialButtonNavigationProperties} from "/tests/helpers/spatialButtonNavigationPropertiesHarness.tsx";window.fixture=await mountSpatialButtonNavigationProperties(document.querySelector("#stage"),document.querySelector("#props"));window.ready=true;</script>')
  })
  await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('Missing port')
  url = `http://127.0.0.1:${address.port}/__spatial-button-ui`; browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })
it('real object and teacher button properties configure a non-first camera and their actual runtime click reaches it', async () => {
  const page = await browser.newPage({ viewport: { width: 1240, height: 720 } })
  try {
    await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'ready'))
    const read = () => page.evaluate(() => Reflect.get(window, 'fixture').read())
    await page.evaluate(() => Reflect.get(window, 'fixture').select('button'))
    expect(await page.getByRole('combobox', { name: '点击动作', exact: true }).inputValue()).toBe('')
    expect(await page.getByRole('button', { name: '试运行', exact: true }).getAttribute('title')).toBe('从起始镜头试运行')
    expect((await read()).revision).toBe(0); expect((await read()).operations).toHaveLength(0)
    await page.getByRole('combobox', { name: '点击动作', exact: true }).selectOption('scene.go')
    await expect.poll(async () => (await read()).revision).toBe(1)
    await page.getByRole('combobox', { name: '目标页面', exact: true }).selectOption('B')
    await expect.poll(async () => (await read()).revision).toBe(2)
    await page.getByRole('combobox', { name: '进入镜头', exact: true }).selectOption('b-last')
    await expect.poll(async () => (await read()).revision).toBe(3)
    await fs.mkdir(path.resolve('output/playwright/spatial-button-ui'), { recursive: true })
    await page.getByRole('combobox', { name: '进入镜头', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.resolve('output/playwright/spatial-button-ui/ordinary-button-properties.png') })
    await page.getByRole('button', { name: '试运行', exact: true }).click()
    await expect.poll(async () => (await read()).playing).toBe(true)
    await page.evaluate(() => Reflect.get(window, 'fixture').click())
    await expect.poll(async () => (await read()).surface).toBe('B')
    expect((await read()).camera.x).toBe(900)
    await page.evaluate(async () => { await Reflect.get(window, 'fixture').navigate({ type: 'scene.previous' }); Reflect.get(window, 'fixture').mode('edit'); Reflect.get(window, 'fixture').select(Reflect.get(window, 'fixture').teacherId) })
    await page.locator('#props summary').filter({ hasText: '按钮与动作' }).click()
    const row = page.locator('#props details').filter({ has: page.locator('summary').filter({ hasText: '按钮与动作' }) }).locator('fieldset').first()
    await row.getByRole('combobox', { name: '点击动作', exact: true }).selectOption('scene.go')
    await expect.poll(async () => (await read()).revision).toBe(4)
    await row.getByRole('combobox', { name: '目标页面', exact: true }).selectOption('B')
    await expect.poll(async () => (await read()).revision).toBe(5)
    await row.getByRole('combobox', { name: '进入镜头', exact: true }).selectOption('b-last')
    await expect.poll(async () => (await read()).revision).toBe(6)
    await page.screenshot({ path: path.resolve('output/playwright/spatial-button-ui/teacher-button-properties.png') })
    await page.getByRole('button', { name: '试运行', exact: true }).click()
    await expect.poll(async () => (await read()).playing).toBe(true)
    await page.evaluate(() => Reflect.get(window, 'fixture').clickTeacher())
    await expect.poll(async () => (await read()).surface).toBe('B')
    expect((await read()).camera.x).toBe(900); expect((await read()).errors).toEqual([])
    expect((await read()).revision).toBe(6)
  } finally { await page.evaluate(async () => Reflect.get(window, 'fixture')?.dispose()); await page.close() }
}, 30_000)
