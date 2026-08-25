import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageFiles,
} from '../../src/renderer/export/course/buildCoursePackages'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'published-global-runtime-canvas-v2-'))
const standalonePath = join(runRoot, 'standalone.html')
const onlineStandalonePath = join(runRoot, 'online-standalone.html')
const webRoot = join(runRoot, 'web')
let controllerItemId = ''
let restartButtonId = ''

const globalHybridSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    create(ctx) {
      var probe = window.__publishedGlobalCanvasApi2Probe || {
        creates: 0, destroys: 0, coreDestroys: 0,
        suspends: 0, resumes: 0, visibleFalse: 0, visibleTrue: 0
      };
      window.__publishedGlobalCanvasApi2Probe = probe;
      probe.creates += 1;
      probe.scope = ctx.scope;
      probe.context = ctx.renderMode === 'hybrid'
        && !!ctx.Phaser && !!ctx.phaser.scene && !!ctx.dom.root;
      var game = ctx.phaser.scene.game;
      window.__publishedGlobalCanvasApi2Game = game;
      window.__publishedGlobalCanvasApi2Games = window.__publishedGlobalCanvasApi2Games || [];
      window.__publishedGlobalCanvasApi2Games.push(game);
      game.events.once(ctx.Phaser.Core.Events.DESTROY, function () {
        probe.coreDestroys += 1;
      });
      var count = 0;
      var button = document.createElement('button');
      button.dataset.publishedGlobalCanvasE2e = 'true';
      button.textContent = 'GLOBAL API2:' + count;
      Object.assign(button.style, {
        width: '100%', height: '100%', pointerEvents: 'auto', cursor: 'pointer',
        font: 'bold 30px sans-serif'
      });
      button.addEventListener('click', function () {
        count += 1;
        button.textContent = 'GLOBAL API2:' + count;
      });
      ctx.dom.root.appendChild(button);
      var panel = ctx.phaser.scene.add.rectangle(0, 0, ctx.width, ctx.height, 0x0f766e, 0.25)
        .setOrigin(0, 0);
      ctx.phaser.root.add(panel);
      return {
        setVisible(value) {
          value ? probe.visibleTrue += 1 : probe.visibleFalse += 1;
        },
        suspend() {
          probe.suspends += 1;
          game.loop.stop();
          probe.stopped = !game.loop.started && !game.loop.running;
        },
        resume() { probe.resumes += 1; },
        destroy() {
          probe.destroys += 1;
          button.remove();
        }
      };
    }
  });
`

const hostileGlobalHybridSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    create(ctx) {
      var probe = window.__publishedHostileGlobalCanvasApi2Probe || {
        creates: 0, suspends: 0, lifecycleDestroys: 0,
        gameObjectDestroys: 0, coreDestroys: 0
      };
      window.__publishedHostileGlobalCanvasApi2Probe = probe;
      probe.creates += 1;
      var game = ctx.phaser.scene.game;
      window.__publishedHostileGlobalCanvasApi2Games =
        window.__publishedHostileGlobalCanvasApi2Games || [];
      window.__publishedHostileGlobalCanvasApi2Games.push(game);
      game.events.once(ctx.Phaser.Core.Events.DESTROY, function () {
        probe.coreDestroys += 1;
      });
      var marker = document.createElement('div');
      marker.dataset.publishedHostileGlobalCanvasE2e = 'true';
      marker.textContent = 'HOSTILE GLOBAL API2';
      marker.style.pointerEvents = 'auto';
      ctx.dom.root.appendChild(marker);
      var object = ctx.phaser.scene.add.rectangle(0, 0, 48, 48, 0xdc2626, 0.4)
        .setOrigin(0, 0);
      ctx.phaser.root.add(object);
      object.destroy = function () {
        probe.gameObjectDestroys += 1;
        throw new Error('hostile global GameObject destroy failed intentionally');
      };
      return {
        suspend() {
          probe.suspends += 1;
          game.loop.stop();
          throw new Error('hostile global suspend failed intentionally');
        },
        destroy() {
          probe.lifecycleDestroys += 1;
          marker.remove();
        }
      };
    }
  });
`

const hostileCreateGlobalHybridSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    create(ctx) {
      var probe = window.__publishedHostileCreateGlobalCanvasApi2Probe || {
        creates: 0, attachedDestroys: 0, looseDestroys: 0, coreDestroys: 0
      };
      window.__publishedHostileCreateGlobalCanvasApi2Probe = probe;
      probe.creates += 1;
      var game = ctx.phaser.scene.game;
      window.__publishedHostileCreateGlobalCanvasApi2Games =
        window.__publishedHostileCreateGlobalCanvasApi2Games || [];
      window.__publishedHostileCreateGlobalCanvasApi2Games.push(game);
      game.events.once(ctx.Phaser.Core.Events.DESTROY, function () {
        probe.coreDestroys += 1;
      });
      var attached = ctx.phaser.scene.add.rectangle(0, 0, 32, 32, 0x7c3aed, 0.4);
      ctx.phaser.root.add(attached);
      attached.destroy = function () {
        probe.attachedDestroys += 1;
        throw new Error('hostile create attached destroy failed intentionally');
      };
      var loose = ctx.phaser.scene.add.rectangle(40, 0, 32, 32, 0x9333ea, 0.4);
      loose.destroy = function () {
        probe.looseDestroys += 1;
        throw new Error('hostile create loose destroy failed intentionally');
      };
      throw new Error('hostile create failed intentionally');
    }
  });
`

function writeFixture(): void {
  const fixture = createPublishedCanvasRuntimeV2Fixture([
    { itemId: 'global-api2-template', renderMode: 'hybrid', source: globalHybridSource },
  ], { includeFlow: true, includeSpatial: true })
  const project = structuredClone(fixture.project)
  const controller = project.globalLayerItems.find((entry) => (
    entry.item.kind === 'native'
    && entry.item.content.nativeType === 'teacher-controller'
  ))
  if (
    !controller
    || controller.item.kind !== 'native'
    || controller.item.content.nativeType !== 'teacher-controller'
  ) throw new Error('expected global teacher controller')
  controller.item.content.data.defaultCollapsed = false
  controllerItemId = controller.item.layerItemId
  const restartButton = controller.item.content.data.buttons.find(
    (button) => button.action.type === 'course.restart',
  )
  if (!restartButton) throw new Error('expected course.restart controller button')
  restartButton.visible = true
  restartButtonId = restartButton.id
  const slide = project.surfaces.find((surface) => surface.id === fixture.slideSurfaceId)
  if (!slide || slide.type !== 'slide') throw new Error('expected Slide fixture')
  const item = slide.scenes[0]?.layerItems.find(
    (candidate): candidate is RuntimeLayerItem => candidate.kind === 'runtime',
  )
  if (!item) throw new Error('expected authored Runtime')
  slide.scenes[0]!.layerItems = slide.scenes[0]!.layerItems.filter(
    (candidate) => candidate.layerItemId !== item.layerItemId,
  )
  item.layerItemId = 'published-global-api2-hybrid'
  item.label = 'Published global API2 hybrid'
  item.order = 415
  item.frame = { mode: 'absolute', x: 72, y: 64, width: 360, height: 180 }
  item.hitPolicy = 'auto'
  const hostileItem = structuredClone(item)
  hostileItem.layerItemId = 'published-global-api2-hostile'
  hostileItem.label = 'Published hostile global API2 hybrid'
  hostileItem.runtime.source = hostileGlobalHybridSource
  hostileItem.order = 425
  hostileItem.frame = { mode: 'absolute', x: 460, y: 64, width: 280, height: 180 }
  const hostileCreateItem = structuredClone(item)
  hostileCreateItem.layerItemId = 'published-global-api2-create-hostile'
  hostileCreateItem.label = 'Published hostile create global API2 hybrid'
  hostileCreateItem.runtime.source = hostileCreateGlobalHybridSource
  hostileCreateItem.order = 435
  hostileCreateItem.frame = { mode: 'absolute', x: 760, y: 64, width: 280, height: 180 }
  project.globalLayerItems.push({
    item,
    visibility: { mode: 'all', locationIds: [] },
  }, {
    item: hostileItem,
    visibility: { mode: 'all', locationIds: [] },
  }, {
    item: hostileCreateItem,
    visibility: { mode: 'all', locationIds: [] },
  })
  const sources = {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: {},
    components: {},
  }
  const playerBundle = readFileSync(join(root, 'dist-player', 'player.iife.js'), 'utf8')
  writeFileSync(standalonePath, buildPublishedCourseStandaloneHtml(sources, playerBundle), 'utf8')
  writeFileSync(onlineStandalonePath, buildPublishedCourseStandaloneHtml(sources, {
    playerBundle,
    singleHtmlMode: 'online-lightweight',
  }), 'utf8')
  for (const [path, bytes] of Object.entries(
    buildPublishedCourseWebPackageFiles(sources, playerBundle),
  )) {
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
  { name: '离线便携单 HTML', path: standalonePath },
  { name: '在线轻量单 HTML', path: onlineStandalonePath },
  { name: '网页包', path: join(webRoot, 'index.html') },
] as const) {
  test(`${delivery.name} 共用跨 Slide/Flow/Spatial 的全局 API 2 单实例`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(pathToFileURL(delivery.path).toString())

    const button = page.locator('[data-published-global-canvas-e2e="true"]')
    const hostileMarker = page.locator('[data-published-hostile-global-canvas-e2e="true"]')
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(hostileMarker).toBeVisible()
    await expect(button).toHaveText('GLOBAL API2:0')
    await expect(page.locator('[data-global-layer-item="published-global-api2-hybrid"]'))
      .toHaveCSS('z-index', '415')
    await expect(page.locator('[data-global-layer-item="published-global-api2-hybrid"]'))
      .toHaveCSS('pointer-events', 'auto')
    const hostileCreateSlideWrapper = page.locator(
      '[data-global-layer-item="published-global-api2-create-hostile"]',
    )
    await expect(hostileCreateSlideWrapper.locator('[data-runtime-fallback="true"]'))
      .toHaveCount(1)
    await expect(hostileCreateSlideWrapper).toHaveCSS('pointer-events', 'none')
    await expect.poll(() => page.evaluate(() => (
      window.__publishedHostileCreateGlobalCanvasApi2Probe
    ))).toMatchObject({
      creates: 1,
      attachedDestroys: 1,
      looseDestroys: 1,
      coreDestroys: 1,
    })
    await expect.poll(() => page.evaluate(() => ({
      games: window.__publishedHostileCreateGlobalCanvasApi2Games?.length,
      released: window.__publishedHostileCreateGlobalCanvasApi2Games?.every((game) => (
        !game.canvas.isConnected
        && game.loop.game === null
        && game.loop.callback === null
        && game.renderer.game === null
        && game.renderer.gameCanvas === null
        && game.renderer.gameContext === null
      )),
    }))).toEqual({ games: 1, released: true })
    await button.click()
    await expect(button).toHaveText('GLOBAL API2:1')

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(1))
    await expect(page.locator(
      '[data-flow-overlay-source="global"][data-flow-overlay-item="published-global-api2-hybrid"] '
      + '[data-published-global-runtime-inner="published-global-api2-hybrid"]',
    )).toBeVisible()
    const hostileFlowWrapper = page.locator(
      '[data-flow-overlay-source="global"][data-flow-overlay-item="published-global-api2-hostile"]',
    )
    await expect(hostileFlowWrapper.locator('[data-runtime-fallback="true"]')).toBeVisible()
    await expect(hostileFlowWrapper).toHaveCSS('pointer-events', 'none')
    await expect(hostileMarker).toHaveCount(0)
    const hostileCreateFlowWrapper = page.locator(
      '[data-flow-overlay-source="global"]'
      + '[data-flow-overlay-item="published-global-api2-create-hostile"]',
    )
    await expect(hostileCreateFlowWrapper.locator('[data-runtime-fallback="true"]'))
      .toHaveCount(1)
    await expect(hostileCreateFlowWrapper).toHaveCSS('pointer-events', 'none')
    await expect.poll(() => page.evaluate(() => window.__publishedHostileGlobalCanvasApi2Probe))
      .toMatchObject({
        creates: 1,
        suspends: 1,
        lifecycleDestroys: 1,
        gameObjectDestroys: 1,
        coreDestroys: 1,
      })
    await expect.poll(() => page.evaluate(() => ({
      canvasConnected: window.__publishedHostileGlobalCanvasApi2Games?.[0]?.canvas.isConnected,
      rendererGameReleased:
        window.__publishedHostileGlobalCanvasApi2Games?.[0]?.renderer.game === null,
      rendererCanvasReleased:
        window.__publishedHostileGlobalCanvasApi2Games?.[0]?.renderer.gameCanvas === null,
      rendererContextReleased:
        window.__publishedHostileGlobalCanvasApi2Games?.[0]?.renderer.gameContext === null,
      loopGameReleased: window.__publishedHostileGlobalCanvasApi2Games?.[0]?.loop.game === null,
      loopCallbackReleased:
        window.__publishedHostileGlobalCanvasApi2Games?.[0]?.loop.callback === null,
    }))).toEqual({
      canvasConnected: false,
      rendererGameReleased: true,
      rendererCanvasReleased: true,
      rendererContextReleased: true,
      loopGameReleased: true,
      loopCallbackReleased: true,
    })
    await expect(button).toHaveText('GLOBAL API2:1')
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(2))
    await expect(page.locator(
      '[data-layer-source="global"][data-layer-item-id="published-global-api2-hybrid"] '
      + '[data-published-global-runtime-inner="published-global-api2-hybrid"]',
    )).toBeVisible()
    await expect(button).toHaveText('GLOBAL API2:1')
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.goToScene(0))
    await expect(button).toBeVisible()
    await expect(button).toHaveText('GLOBAL API2:1')

    await expect.poll(() => page.evaluate(() => window.__publishedGlobalCanvasApi2Probe))
      .toMatchObject({
        creates: 1,
        destroys: 0,
        scope: 'global',
        context: true,
        suspends: 3,
        resumes: 3,
        visibleFalse: 3,
        visibleTrue: 3,
        stopped: true,
      })

    await page.locator(
      `[data-global-layer-item="${controllerItemId}"] `
      + `[data-controller-button-id="${restartButtonId}"]`,
    ).dispatchEvent('click')
    await expect(button).toBeVisible()
    await expect(button).toHaveText('GLOBAL API2:0')
    await expect.poll(() => page.evaluate(() => window.__publishedGlobalCanvasApi2Probe))
      .toMatchObject({ creates: 2, destroys: 1, coreDestroys: 1 })
    await expect(hostileMarker).toBeVisible()
    await expect(page.locator(
      '[data-global-layer-item="published-global-api2-create-hostile"] '
      + '[data-runtime-fallback="true"]',
    )).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => (
      window.__publishedHostileCreateGlobalCanvasApi2Probe
    ))).toMatchObject({
      creates: 2,
      attachedDestroys: 2,
      looseDestroys: 2,
      coreDestroys: 2,
    })
    await expect.poll(() => page.evaluate(() => ({
      games: window.__publishedHostileCreateGlobalCanvasApi2Games?.length,
      released: window.__publishedHostileCreateGlobalCanvasApi2Games?.every((game) => (
        !game.canvas.isConnected
        && game.loop.game === null
        && game.loop.callback === null
        && game.renderer.game === null
      )),
    }))).toEqual({ games: 2, released: true })
    await expect.poll(() => page.evaluate(() => ({
      hostileGames: window.__publishedHostileGlobalCanvasApi2Games?.length,
      releasedGames: window.__publishedHostileGlobalCanvasApi2Games?.filter((game) => (
        game.loop.game === null && game.renderer.game === null
      )).length,
    }))).toEqual({ hostileGames: 2, releasedGames: 1 })
    await expect.poll(() => page.evaluate(() => ({
      loopGameReleased: window.__publishedGlobalCanvasApi2Games?.[0]?.loop.game === null,
      loopCallbackReleased: window.__publishedGlobalCanvasApi2Games?.[0]?.loop.callback === null,
    }))).toEqual({
      loopGameReleased: true,
      loopCallbackReleased: true,
    })

    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.destroy())
    await expect.poll(() => page.evaluate(() => window.__publishedGlobalCanvasApi2Probe))
      .toMatchObject({ creates: 2, destroys: 2, coreDestroys: 2 })
    await expect.poll(() => page.evaluate(() => window.__publishedHostileGlobalCanvasApi2Probe))
      .toMatchObject({
        creates: 2,
        suspends: 1,
        lifecycleDestroys: 2,
        gameObjectDestroys: 2,
        coreDestroys: 2,
      })
    await expect.poll(() => page.evaluate(() => (
      window.__publishedHostileGlobalCanvasApi2Games?.every((game) => (
        !game.canvas.isConnected
        && game.loop.game === null
        && game.loop.callback === null
        && game.renderer.game === null
        && game.renderer.gameCanvas === null
        && game.renderer.gameContext === null
      ))
    ))).toBe(true)
    await expect.poll(() => page.evaluate(() => ({
      canvasConnected: window.__publishedGlobalCanvasApi2Games?.[1]?.canvas.isConnected,
      loopGameReleased: window.__publishedGlobalCanvasApi2Games?.[1]?.loop.game === null,
      loopCallbackReleased: window.__publishedGlobalCanvasApi2Games?.[1]?.loop.callback === null,
    }))).toEqual({
      canvasConnected: false,
      loopGameReleased: true,
      loopCallbackReleased: true,
    })
    await expect(button).toHaveCount(0)
    expect(errors.filter((message) => (
      message.includes('published-global-api2-create-hostile')
      && message.includes('启动失败')
      && !message.includes('启动失败后的清理失败')
    ))).toHaveLength(2)
    expect(errors.filter((message) => (
      !message.includes('published-global-api2-hostile')
      && !message.includes('hostile global')
      && !message.includes('published-global-api2-create-hostile')
      && !message.includes('hostile create')
    ))).toEqual([])
  })
}

declare global {
  interface Window {
    __publishedGlobalCanvasApi2Probe?: Record<string, unknown>
    __publishedGlobalCanvasApi2Game?: {
      canvas: HTMLCanvasElement
      loop: { game: unknown; callback: unknown }
    }
    __publishedGlobalCanvasApi2Games?: Array<{
      canvas: HTMLCanvasElement
      loop: { game: unknown; callback: unknown }
    }>
    __publishedHostileGlobalCanvasApi2Probe?: Record<string, unknown>
    __publishedHostileGlobalCanvasApi2Games?: Array<{
      canvas: HTMLCanvasElement
      loop: { game: unknown; callback: unknown }
      renderer: { game: unknown; gameCanvas: unknown; gameContext: unknown }
    }>
    __publishedHostileCreateGlobalCanvasApi2Probe?: Record<string, unknown>
    __publishedHostileCreateGlobalCanvasApi2Games?: Array<{
      canvas: HTMLCanvasElement
      loop: { game: unknown; callback: unknown }
      renderer: { game: unknown; gameCanvas: unknown; gameContext: unknown }
    }>
  }
}
