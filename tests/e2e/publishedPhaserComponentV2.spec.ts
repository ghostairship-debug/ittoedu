import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageFiles,
} from '../../src/renderer/export/course/buildCoursePackages'
import {
  createPublishedPhaserComponentV2Fixture,
  PUBLISHED_PHASER_COMPONENT_ITEM_ID,
} from '../fixtures/publishedPhaserComponentV2Fixture'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'published-phaser-component-v2-'))
const standalonePath = join(runRoot, 'standalone.html')
const onlineStandalonePath = join(runRoot, 'online-standalone.html')
const webRoot = join(runRoot, 'web')

function writeFixture(): void {
  const fixture = createPublishedPhaserComponentV2Fixture()
  const sources = {
    project: fixture.project,
    assetFiles: fixture.assetFiles,
    components: fixture.components,
  }
  const playerBundle = readFileSync(join(root, 'dist-player', 'player.iife.js'), 'utf8')
  writeFileSync(
    standalonePath,
    buildPublishedCourseStandaloneHtml(sources, playerBundle),
    'utf8',
  )
  writeFileSync(
    onlineStandalonePath,
    buildPublishedCourseStandaloneHtml(sources, {
      playerBundle,
      singleHtmlMode: 'online-lightweight',
    }),
    'utf8',
  )
  const webFiles = buildPublishedCourseWebPackageFiles(sources, playerBundle)
  for (const [path, bytes] of Object.entries(webFiles)) {
    const target = join(webRoot, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
}

test.beforeAll(() => {
  writeFixture()
})

test.afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true })
})

for (const delivery of [
  { name: '离线便携单 HTML', path: standalonePath, online: false },
  { name: '在线轻量单 HTML', path: onlineStandalonePath, online: true },
  { name: '网页包', path: join(webRoot, 'index.html'), online: false },
] as const) {
  test(`${delivery.name} 执行同一 Slide scene-local Phaser Component API 4 host`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(pathToFileURL(delivery.path).toString())
    await page.evaluate(() => {
      window.addEventListener('courseware-component-event', (event) => {
        window.__publishedPhaserComponentV4Event = (event as CustomEvent).detail
      })
    })

    const componentLayer = page.locator(
      `[data-slide-layer-item="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )
    const canvas = page.locator(
      `[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await expect(componentLayer).toHaveCSS('left', '123px')
    await expect(componentLayer).toHaveCSS('top', '87px')
    await expect(componentLayer).toHaveCSS('width', '360px')
    await expect(componentLayer).toHaveCSS('height', '210px')
    const componentOrder = Number(await componentLayer.evaluate((element) => (
      (element as HTMLElement).style.zIndex
    )))
    const sentinelOrder = Number(await page.locator(
      '[data-slide-layer-item="published-phaser-order-sentinel"]',
    ).evaluate((element) => (element as HTMLElement).style.zIndex))
    expect(componentOrder).toBeLessThan(sentinelOrder)
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({
        context: true,
        props: { label: '真实导入', projectAssetId: 'fixture-project-asset' },
        frame: { width: 360, height: 210 },
        mode: 'preview',
      })
    await expect.poll(() => page.evaluate(() => {
      const probe = window.__publishedPhaserComponentV4Probe
      const creates = Number(probe?.creates ?? 0)
      return creates >= 1
        && Number(probe?.destroys ?? 0) === creates - 1
        && Number(probe?.coreDestroys ?? 0) === creates - 1
    })).toBe(true)
    const baseline = await page.evaluate(() => ({
      creates: Number(window.__publishedPhaserComponentV4Probe?.creates ?? 0),
      destroys: Number(window.__publishedPhaserComponentV4Probe?.destroys ?? 0),
      coreDestroys: Number(window.__publishedPhaserComponentV4Probe?.coreDestroys ?? 0),
      suspends: Number(window.__publishedPhaserComponentV4Probe?.suspends ?? 0),
      resumes: Number(window.__publishedPhaserComponentV4Probe?.resumes ?? 0),
      visibleFalse: Number(window.__publishedPhaserComponentV4Probe?.visibleFalse ?? 0),
      visibleTrue: Number(window.__publishedPhaserComponentV4Probe?.visibleTrue ?? 0),
    }))
    const urls = await page.evaluate(() => ({
      asset: window.__publishedPhaserComponentV4Probe?.assetUrl,
      project: window.__publishedPhaserComponentV4Probe?.projectAssetUrl,
    }))
    expect(String(urls.asset)).not.toBe('')
    expect(String(urls.project)).not.toBe('')

    await componentLayer.click({ position: { x: 180, y: 105 } })
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({ hits: 1 })
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Event))
      .toMatchObject({
        scope: 'scene',
        sceneId: expect.any(String),
        componentId: 'com.example.published-phaser-v4',
        instanceId: PUBLISHED_PHASER_COMPONENT_ITEM_ID,
        eventName: 'phaser:hit',
        payload: { count: 1, label: '真实导入' },
      })

    await page.locator('[data-slide-layer-item="published-phaser-order-sentinel"]')
      .click({ position: { x: 8, y: 8 } })
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({
        creates: baseline.creates + 1,
        destroys: baseline.destroys + 1,
        coreDestroys: baseline.coreDestroys + 1,
      })

    await page.locator('[data-slide-layer-item="published-phaser-restart-sentinel"]')
      .click({ position: { x: 8, y: 8 } })
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({
        creates: baseline.creates + 2,
        destroys: baseline.destroys + 2,
        coreDestroys: baseline.coreDestroys + 2,
      })

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(1))
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({
        destroys: baseline.destroys + 3,
        coreDestroys: baseline.coreDestroys + 3,
      })
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(0))
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({ creates: baseline.creates + 3 })
    const beforeTemporaryLeave = await page.evaluate(() => ({
      creates: Number(window.__publishedPhaserComponentV4Probe?.creates ?? 0),
      suspends: Number(window.__publishedPhaserComponentV4Probe?.suspends ?? 0),
      resumes: Number(window.__publishedPhaserComponentV4Probe?.resumes ?? 0),
      visibleFalse: Number(window.__publishedPhaserComponentV4Probe?.visibleFalse ?? 0),
      visibleTrue: Number(window.__publishedPhaserComponentV4Probe?.visibleTrue ?? 0),
    }))

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(2))
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({
        suspends: beforeTemporaryLeave.suspends + 1,
        stopped: true,
        visibleFalse: beforeTemporaryLeave.visibleFalse + 1,
      })
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(0))
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({
        creates: beforeTemporaryLeave.creates,
        resumes: beforeTemporaryLeave.resumes + 1,
        visibleTrue: beforeTemporaryLeave.visibleTrue + 1,
      })
    await componentLayer.click({ position: { x: 180, y: 105 } })
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe?.hits))
      .toBe(2)

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(2))
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({ suspends: beforeTemporaryLeave.suspends + 2, stopped: true })
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.destroy())
    await expect.poll(() => page.evaluate(() => window.__publishedPhaserComponentV4Probe))
      .toMatchObject({
        destroys: baseline.destroys + 4,
        coreDestroys: baseline.coreDestroys + 4,
      })
    const expectedGames = Array.from({ length: baseline.creates + 3 }, () => ({
      canvasConnected: false,
      loopGameReleased: true,
      loopCallbackReleased: true,
    }))
    await expect.poll(() => page.evaluate(() => (
      window.__publishedPhaserComponentV4Games ?? []
    ).map((game) => ({
      canvasConnected: game.canvas.isConnected,
      loopGameReleased: game.loop.game === null,
      loopCallbackReleased: game.loop.callback === null,
    })))).toEqual(expectedGames)
    await expect(page.locator('[data-published-phaser-component-v4-e2e="true"]'))
      .toHaveCount(0)

    if (delivery.online) {
      const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content')
      const scriptPolicy = csp?.match(/script-src[^;]*/)?.[0]
      expect(scriptPolicy).toContain("'unsafe-eval'")
      expect(scriptPolicy).not.toContain('https://')
      expect(scriptPolicy).not.toContain('*')
    }
    expect(errors).toEqual([])
  })
}

declare global {
  interface Window {
    __publishedPhaserComponentV4Probe?: Record<string, unknown>
    __publishedPhaserComponentV4Event?: Record<string, unknown>
    __publishedPhaserComponentV4Games?: Array<{
      canvas: HTMLCanvasElement
      loop: { game: unknown; callback: unknown }
    }>
  }
}
