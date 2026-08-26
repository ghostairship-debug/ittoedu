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
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'published-runtime-canvas-v2-'))
const standalonePath = join(runRoot, 'standalone.html')
const onlineStandalonePath = join(runRoot, 'online-standalone.html')
const webRoot = join(runRoot, 'web')

const domSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    create(ctx) {
      var probe = window.__publishedCanvasApi2Probe || {};
      window.__publishedCanvasApi2Probe = probe;
      probe.domCreates = (probe.domCreates || 0) + 1;
      var count = 0;
      var button = document.createElement('button');
      button.dataset.publishedCanvasDomE2e = 'true';
      button.textContent = 'DOM API2:0';
      Object.assign(button.style, {
        width: '100%', height: '100%', pointerEvents: 'auto', cursor: 'pointer',
        font: 'bold 30px sans-serif'
      });
      var onClick = function () {
        count += 1;
        button.textContent = 'DOM API2:' + count;
      };
      button.addEventListener('click', onClick);
      ctx.dom.root.appendChild(button);
      return {
        destroy() {
          probe.domDestroys = (probe.domDestroys || 0) + 1;
          button.removeEventListener('click', onClick);
          button.remove();
        }
      };
    }
  });
`

const phaserSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    create(ctx) {
      var probe = window.__publishedCanvasApi2Probe || {};
      window.__publishedCanvasApi2Probe = probe;
      probe.phaserCreates = (probe.phaserCreates || 0) + 1;
      probe.phaserContext = ctx.renderMode === 'phaser'
        && !!ctx.Phaser && !!ctx.phaser.scene && !('dom' in ctx);
      var game = ctx.phaser.scene.game;
      var games = window.__publishedCanvasApi2Games || [];
      window.__publishedCanvasApi2Games = games;
      games.push(game);
      game.events.once(ctx.Phaser.Core.Events.DESTROY, function () {
        probe.phaserCoreDestroys = (probe.phaserCoreDestroys || 0) + 1;
      });
      var canvas = game.canvas;
      canvas.dataset.publishedCanvasPhaserE2e = 'true';
      var panel = ctx.phaser.scene.add.rectangle(0, 0, ctx.width, ctx.height, 0x2563eb, 1)
        .setOrigin(0, 0);
      var label = ctx.phaser.scene.add.text(48, 48, 'PHASER API2', {
        fontFamily: 'Arial', fontSize: '52px', color: '#ffffff'
      });
      ctx.phaser.root.add([panel, label]);
      return {
        setVisible(value) {
          value ? probe.phaserVisibleTrue = (probe.phaserVisibleTrue || 0) + 1
            : probe.phaserVisibleFalse = (probe.phaserVisibleFalse || 0) + 1;
        },
        suspend() {
          probe.phaserSuspends = (probe.phaserSuspends || 0) + 1;
          game.loop.stop();
          probe.phaserStopped = !game.loop.started && !game.loop.running;
        },
        resume() { probe.phaserResumes = (probe.phaserResumes || 0) + 1; },
        destroy() {
          probe.phaserDestroys = (probe.phaserDestroys || 0) + 1;
          delete canvas.dataset.publishedCanvasPhaserE2e;
        }
      };
    }
  });
`

const hybridSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    create(ctx) {
      var probe = window.__publishedCanvasApi2Probe || {};
      window.__publishedCanvasApi2Probe = probe;
      probe.hybridCreates = (probe.hybridCreates || 0) + 1;
      probe.hybridContext = ctx.renderMode === 'hybrid'
        && !!ctx.Phaser && !!ctx.phaser.scene && !!ctx.dom.root && !!ctx.nodes;
      var game = ctx.phaser.scene.game;
      var games = window.__publishedCanvasApi2Games || [];
      window.__publishedCanvasApi2Games = games;
      games.push(game);
      game.events.once(ctx.Phaser.Core.Events.DESTROY, function () {
        probe.hybridCoreDestroys = (probe.hybridCoreDestroys || 0) + 1;
      });
      var canvas = game.canvas;
      canvas.dataset.publishedCanvasHybridPhaserE2e = 'true';
      var panel = ctx.phaser.scene.add.rectangle(0, 0, ctx.width, ctx.height, 0x7c3aed, 1)
        .setOrigin(0, 0);
      ctx.phaser.root.add(panel);
      var count = 0;
      var button = document.createElement('button');
      button.dataset.publishedCanvasHybridDomE2e = 'true';
      button.textContent = 'HYBRID API2:0';
      Object.assign(button.style, {
        position: 'absolute', left: '18%', top: '30%', width: '64%', height: '40%',
        pointerEvents: 'auto', cursor: 'pointer', font: 'bold 30px sans-serif'
      });
      var onClick = function () {
        count += 1;
        button.textContent = 'HYBRID API2:' + count;
      };
      button.addEventListener('click', onClick);
      ctx.dom.root.appendChild(button);
      return {
        setVisible(value) {
          value ? probe.hybridVisibleTrue = (probe.hybridVisibleTrue || 0) + 1
            : probe.hybridVisibleFalse = (probe.hybridVisibleFalse || 0) + 1;
        },
        suspend() { probe.hybridSuspends = (probe.hybridSuspends || 0) + 1; },
        resume() { probe.hybridResumes = (probe.hybridResumes || 0) + 1; },
        destroy() {
          probe.hybridDestroys = (probe.hybridDestroys || 0) + 1;
          button.removeEventListener('click', onClick);
          button.remove();
          delete canvas.dataset.publishedCanvasHybridPhaserE2e;
        }
      };
    }
  });
`

function writeFixture(): void {
  const fixture = createPublishedCanvasRuntimeV2Fixture([
    { itemId: 'published-api2-dom', renderMode: 'dom', source: domSource },
    { itemId: 'published-api2-phaser', renderMode: 'phaser', source: phaserSource },
    { itemId: 'published-api2-hybrid', renderMode: 'hybrid', source: hybridSource },
  ], { includeFlow: true })
  const sources = {
    project: fixture.project,
    assetFiles: {},
    components: {},
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
  test(`${delivery.name} 共用 Slide API 2 DOM/Phaser/hybrid Published host`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(pathToFileURL(delivery.path).toString())

    const domButton = page.locator('[data-published-canvas-dom-e2e="true"]')
    await expect(domButton).toBeVisible({ timeout: 15_000 })
    await expect(domButton).toHaveText('DOM API2:0')
    await expect(page.locator('[data-slide-layer-item="published-api2-dom"]'))
      .toHaveCSS('pointer-events', 'auto')
    await domButton.click()
    await expect(domButton).toHaveText('DOM API2:1')

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(1))
    const phaserCanvas = page.locator('[data-published-canvas-phaser-e2e="true"]')
    await expect(phaserCanvas).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => window.__publishedCanvasApi2Probe))
      .toMatchObject({
        domCreates: 1,
        domDestroys: 1,
        phaserCreates: 1,
        phaserContext: true,
      })

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(2))
    const hybridButton = page.locator('[data-published-canvas-hybrid-dom-e2e="true"]')
    const hybridCanvas = page.locator('[data-published-canvas-hybrid-phaser-e2e="true"]')
    await expect(hybridButton).toBeVisible({ timeout: 15_000 })
    await expect(hybridCanvas).toBeVisible()
    await hybridButton.click()
    await expect(hybridButton).toHaveText('HYBRID API2:1')
    await expect.poll(() => page.evaluate(() => window.__publishedCanvasApi2Probe))
      .toMatchObject({
        phaserDestroys: 1,
        phaserCoreDestroys: 1,
        hybridCreates: 1,
        hybridContext: true,
      })

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(3))
    await expect(hybridButton).toBeHidden()
    await expect.poll(() => page.evaluate(() => window.__publishedCanvasApi2Probe))
      .toMatchObject({
        hybridCreates: 1,
        hybridSuspends: 1,
        hybridVisibleFalse: 1,
      })
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(2))
    await expect(hybridButton).toBeVisible()
    await expect(hybridButton).toHaveText('HYBRID API2:1')
    await expect.poll(() => page.evaluate(() => window.__publishedCanvasApi2Probe))
      .toMatchObject({
        hybridCreates: 1,
        hybridResumes: 1,
        hybridVisibleTrue: 1,
      })

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(1))
    await expect(page.locator('[data-published-canvas-phaser-e2e="true"]'))
      .toBeVisible({ timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => window.__publishedCanvasApi2Probe))
      .toMatchObject({
        hybridDestroys: 1,
        hybridCoreDestroys: 1,
        phaserCreates: 2,
      })

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(3))
    await expect.poll(() => page.evaluate(() => window.__publishedCanvasApi2Probe))
      .toMatchObject({ phaserSuspends: 1, phaserStopped: true })
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.destroy())
    await expect.poll(() => page.evaluate(() => window.__publishedCanvasApi2Probe))
      .toMatchObject({ phaserDestroys: 2, phaserCoreDestroys: 2 })
    await expect.poll(() => page.evaluate(() => (
      window.__publishedCanvasApi2Games ?? []
    ).map((game) => ({
      canvasConnected: game.canvas.isConnected,
      loopGameReleased: game.loop.game === null,
      loopCallbackReleased: game.loop.callback === null,
    })))).toEqual([
      { canvasConnected: false, loopGameReleased: true, loopCallbackReleased: true },
      { canvasConnected: false, loopGameReleased: true, loopCallbackReleased: true },
      { canvasConnected: false, loopGameReleased: true, loopCallbackReleased: true },
    ])
    await expect(page.locator('[data-published-canvas-phaser-e2e="true"]')).toHaveCount(0)

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
    __publishedCanvasApi2Probe?: Record<string, unknown>
    __publishedCanvasApi2Games?: Array<{
      canvas: HTMLCanvasElement
      loop: { game: unknown; callback: unknown }
    }>
  }
}
