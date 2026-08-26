import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'published-online-single-html-'))
const htmlPath = join(runRoot, 'online.html')
const imageUrl = 'https://assets.example.test/course/hero.png?revision=7'
const apiOrigin = 'https://api.example.test'
const blockedOrigin = 'https://blocked.example.test'
const imageBytes = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
))

function writeFixture(): void {
  const project = createBlankCourseProject({
    now: '2026-08-26T09:30:00.000Z',
    includeDefaultController: false,
    controls: 'none',
  })
  project.title = '在线轻量单 HTML E2E'
  project.assets.hero = {
    id: 'hero',
    filename: 'hero.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/hero.png',
    byteLength: imageBytes.byteLength,
    width: 1,
    height: 1,
    remote: { url: imageUrl },
  }
  project.network = { connectOrigins: [apiOrigin] }
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected blank Slide surface')
  slide.scenes[0]!.backgroundAssetId = 'hero'

  const sources = {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: { hero: imageBytes },
    components: {},
  }
  const playerBundle = readFileSync(join(root, 'dist-player', 'player.iife.js'), 'utf8')
  writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml(sources, {
    playerBundle,
    singleHtmlMode: 'online-lightweight',
  }), 'utf8')
}

test.beforeAll(() => {
  writeFixture()
})

test.afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true })
})

test('在线轻量单 HTML 加载已声明 HTTPS 依赖并由 CSP 拒绝未声明 origin', async ({ page }) => {
  let imageRequests = 0
  let allowedApiRequests = 0
  let blockedRequests = 0
  const consoleErrors: string[] = []

  await page.route(imageUrl, async (route) => {
    imageRequests += 1
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(imageBytes) })
  })
  await page.route(`${apiOrigin}/**`, async (route) => {
    allowedApiRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true }),
    })
  })
  await page.route(`${blockedOrigin}/**`, async (route) => {
    blockedRequests += 1
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      body: 'should not be reached',
    })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto(pathToFileURL(htmlPath).toString())
  await expect(page.locator('.slide-published-adapter')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => imageRequests).toBe(1)

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain(`img-src data: blob: ${new URL(imageUrl).origin}`)
  expect(csp).toContain(`connect-src data: blob: ${apiOrigin}`)
  expect(csp).not.toContain(blockedOrigin)
  expect(csp).not.toContain('*')
  expect(csp?.match(/script-src[^;]*/)?.[0]).not.toContain('https://')

  const allowed = await page.evaluate(async (url) => {
    const response = await fetch(url)
    return { ok: response.ok, body: await response.json() }
  }, `${apiOrigin}/course-state`)
  expect(allowed).toEqual({ ok: true, body: { ok: true } })
  expect(allowedApiRequests).toBe(1)

  const blocked = await page.evaluate(async (url) => {
    try {
      await fetch(url)
      return 'unexpected-success'
    } catch (error) {
      return error instanceof TypeError ? 'blocked-by-browser' : String(error)
    }
  }, `${blockedOrigin}/course-state`)
  expect(blocked).toBe('blocked-by-browser')
  expect(blockedRequests).toBe(0)
  expect(consoleErrors.some((message) => (
    message.includes('Content Security Policy') && message.includes(blockedOrigin)
  ))).toBe(true)
})
