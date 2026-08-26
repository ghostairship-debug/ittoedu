import { chromium, expect, test, type Locator, type Page } from '@playwright/test'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const projectRoot = resolve(__dirname, '..', '..')
const htmlV2Path = join(
  projectRoot,
  'examples',
  'render-host-benchmark',
  'render-host-benchmark-v2.html',
)
async function goToScene(page: Page, index: number): Promise<void> {
  expect(await page.evaluate((targetIndex) =>
    window.__H5_LESSON_PLAYER__?.goToScene(targetIndex) === true,
  index)).toBe(true)
  await page.waitForFunction((targetIndex) =>
    window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() === targetIndex,
  index)
}

async function screenshotLogicalCanvasRegion(
  canvas: Locator,
  region: { x: number; y: number; width: number; height: number },
  logicalSize = { width: 1280, height: 720 },
): Promise<Buffer> {
  const image = sharp(await canvas.screenshot())
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Canvas screenshot has no dimensions')
  }
  return image.extract({
    left: Math.floor(region.x / logicalSize.width * metadata.width),
    top: Math.floor(region.y / logicalSize.height * metadata.height),
    width: Math.max(1, Math.floor(region.width / logicalSize.width * metadata.width)),
    height: Math.max(1, Math.floor(region.height / logicalSize.height * metadata.height)),
  }).png().toBuffer()
}

test('Course Project V9 的 Published V2 五种渲染路径可离线互动且压力切换无泄漏', async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (/^(?:https?|wss?):/i.test(request.url())) externalRequests.push(request.url())
  })

  await page.addInitScript(() => {
    const originalRequest = window.requestAnimationFrame.bind(window)
    const originalCancel = window.cancelAnimationFrame.bind(window)
    const active = new Set<number>()
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      let id = 0
      id = originalRequest((time) => {
        active.delete(id)
        callback(time)
      })
      active.add(id)
      return id
    }
    window.cancelAnimationFrame = (id: number): void => {
      active.delete(id)
      originalCancel(id)
    }
    window.__renderHostActiveRafCount = () => active.size

    const webgl = { created: 0, lost: 0 }
    const seen = new WeakSet<object>()
    const lostContexts = new WeakSet<object>()
    const extensionProxies = new WeakMap<object, object>()
    const instrumentLoseContext = (prototype: object | undefined): void => {
      if (!prototype) return
      const originalGetExtension = Reflect.get(prototype, 'getExtension') as
        | ((name: string) => object | null)
        | undefined
      if (!originalGetExtension) return
      Reflect.set(prototype, 'getExtension', function (this: object, name: string) {
        const extension = Reflect.apply(originalGetExtension, this, [name]) as object | null
        if (name !== 'WEBGL_lose_context' || !extension) return extension
        const existing = extensionProxies.get(extension)
        if (existing) return existing
        const context = this
        const proxy = new Proxy(extension, {
          get(target, key, receiver) {
            if (key !== 'loseContext') return Reflect.get(target, key, receiver)
            const lose = Reflect.get(target, key) as (() => void) | undefined
            return () => {
              if (!lostContexts.has(context)) {
                lostContexts.add(context)
                webgl.lost += 1
              }
              if (lose) Reflect.apply(lose, target, [])
            }
          },
        })
        extensionProxies.set(extension, proxy)
        return proxy
      })
    }
    instrumentLoseContext(WebGLRenderingContext.prototype)
    instrumentLoseContext(globalThis.WebGL2RenderingContext?.prototype)
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) {
      const context = Reflect.apply(originalGetContext, this, [contextId, ...args]) as object | null
      if (/^webgl2?$/i.test(contextId) && context && !seen.has(context)) {
        seen.add(context)
        webgl.created += 1
      }
      return context
    } as typeof originalGetContext
    Reflect.set(window, '__renderHostWebGlCounts', () => ({ ...webgl }))
  })

  const waitForLocation = async (sceneId: string): Promise<void> => {
    await page.waitForFunction((id) =>
      document.querySelector<HTMLElement>('.slide-published-adapter')?.dataset.locationId === id,
    sceneId)
  }

  try {
    await page.goto(pathToFileURL(htmlV2Path).href, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__H5_LESSON_PLAYER__))
    await expect(page.getByTestId('teacher-escape-controls')).toHaveCount(0)
    await waitForLocation('scene_native_nodes_v9')
    await expect.poll(() => page.evaluate(() =>
      window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() ?? -1,
    )).toBe(0)

    const nativeTrigger = page.locator('[data-slide-layer-item="native_click_target_v9"]')
    const nativeProbe = page.locator('[data-slide-layer-item="native_click_probe_v9"]')
    await expect(nativeTrigger).toBeVisible()
    await nativeTrigger.click()
    await expect(nativeProbe).toHaveAttribute('data-interaction-visibility', 'hidden')

    await goToScene(page, 1)
    await waitForLocation('scene_runtime_phaser_v9')
    const phaserRuntimeCanvas = page.locator(
      '[data-slide-layer-item="phaser_runtime_instance_v9"] .published-canvas-runtime-mount canvas',
    )
    await expect(phaserRuntimeCanvas).toBeVisible()
    await page.waitForTimeout(200)
    const phaserBounds = await phaserRuntimeCanvas.boundingBox()
    if (!phaserBounds) throw new Error('Published V2 Phaser Runtime canvas is not visible')
    const phaserStatusRegion = { x: 80, y: 460, width: 440, height: 58 }
    const phaserStatusBefore = await screenshotLogicalCanvasRegion(
      phaserRuntimeCanvas,
      phaserStatusRegion,
    )
    await phaserRuntimeCanvas.click({
      position: {
        x: phaserBounds.width * (652 / 1280),
        y: phaserBounds.height * (344 / 720),
      },
    })
    await expect.poll(async () => (
      await screenshotLogicalCanvasRegion(phaserRuntimeCanvas, phaserStatusRegion)
    ).equals(phaserStatusBefore)).toBe(false)
    const phaserRuntimeStats = await sharp(await phaserRuntimeCanvas.screenshot()).stats()
    expect(phaserRuntimeStats.channels.some(({ stdev }) => stdev > 12)).toBe(true)

    await goToScene(page, 2)
    await waitForLocation('scene_runtime_three_v9')
    const threeCanvas = page.locator(
      '[data-slide-layer-item="three_runtime_instance_v9"] .published-canvas-runtime-mount canvas',
    )
    await expect(threeCanvas).toBeVisible()
    const threeBounds = await threeCanvas.boundingBox()
    if (!threeBounds) throw new Error('Published V2 Three.js canvas is not visible')
    await page.mouse.move(
      threeBounds.x + threeBounds.width * 0.7,
      threeBounds.y + threeBounds.height * 0.48,
    )
    await page.mouse.down()
    await page.mouse.move(
      threeBounds.x + threeBounds.width * 0.55,
      threeBounds.y + threeBounds.height * 0.34,
      { steps: 8 },
    )
    await page.mouse.up()
    const threeMount = page.locator(
      '[data-slide-layer-item="three_runtime_instance_v9"] .published-canvas-runtime-mount',
    )
    await expect(threeMount.locator('output')).toHaveText('视角已更新')
    await threeCanvas.hover()
    await page.mouse.wheel(0, -180)
    await expect(threeMount.locator('output')).toHaveText('观察距离已更新')
    await threeMount.getByRole('button', { name: '恢复视角' }).click()
    await expect(threeMount.locator('output')).toHaveText('已恢复默认观察视角')

    await goToScene(page, 3)
    await waitForLocation('scene_component_v4_dom_v9')
    const table = page.locator('[data-component-instance-id="table_component_instance"]')
    await expect(table.locator('h2')).toHaveText('课件渲染路径选型表')
    await table.locator('tbody tr').first().click()
    await expect(table.locator('output')).toContainText('已选中：原生节点')
    await table.getByRole('button', { name: '按适用度排序' }).click()
    await expect(table.locator('output')).toHaveText('已按适用度从高到低排序')
    expect(await table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => {
      const cells = [...row.querySelectorAll('td')]
      return {
        route: cells[0]?.textContent?.trim() ?? '',
        score: cells[3]?.textContent?.trim() ?? '',
      }
    }))).toEqual([
      { route: '原生节点', score: '95' },
      { route: 'DOM / Three.js 增强', score: '92' },
      { route: 'Phaser 运行时', score: '88' },
    ])

    await goToScene(page, 4)
    await waitForLocation('scene_component_v4_phaser_v9')
    const meterWrapper = page.locator(
      '[data-slide-layer-item="phaser_meter_component_instance"]',
    )
    const meterCanvas = page.locator(
      '[data-slide-layer-item="phaser_meter_component_instance"] canvas[data-published-phaser-component]',
    )
    await expect(meterCanvas).toBeVisible()
    await page.waitForTimeout(200)
    const meterBounds = await meterCanvas.boundingBox()
    if (!meterBounds) throw new Error('Published V2 Phaser Component canvas is not visible')
    const meterBefore = await meterCanvas.screenshot()
    const meterStatusRegion = { x: 110, y: 330, width: 500, height: 44 }
    const meterStatusBefore = await screenshotLogicalCanvasRegion(
      meterCanvas,
      meterStatusRegion,
      { width: 720, height: 390 },
    )
    await meterCanvas.click({
      position: { x: meterBounds.width * 0.5, y: meterBounds.height * 0.58 },
    })
    await page.waitForTimeout(50)
    const meterAfter = await meterCanvas.screenshot()
    expect(meterAfter.equals(meterBefore)).toBe(false)
    const meterStatusAfter = await screenshotLogicalCanvasRegion(
      meterCanvas,
      meterStatusRegion,
      { width: 720, height: 390 },
    )
    expect(meterStatusAfter.equals(meterStatusBefore)).toBe(false)
    const stableRafCount = await page.evaluate(() =>
      window.__renderHostActiveRafCount?.() ?? 0,
    )
    const stableWebglOutstanding = await page.evaluate(() => {
      const read = Reflect.get(window, '__renderHostWebGlCounts') as
        | (() => { created: number; lost: number })
        | undefined
      const counts = read?.() ?? { created: 0, lost: 0 }
      return counts.created - counts.lost
    })

    const stressLocationIds = [
      'scene_native_nodes_v9',
      'scene_runtime_phaser_v9',
      'scene_runtime_three_v9',
      'scene_component_v4_dom_v9',
      'scene_component_v4_phaser_v9',
    ]
    let switches = 0
    let replays = 0
    let replayResetObserved = false
    for (let round = 0; round < 25; round += 1) {
      await expect.poll(() => page.evaluate(() => {
        const probe = Reflect.get(window, '__renderHostPhaserMeterGenerationProbe') as
          | { creates?: unknown; destroys?: unknown }
          | undefined
        return typeof probe?.creates === 'number'
          && typeof probe.destroys === 'number'
          && probe.creates === probe.destroys + 1
      })).toBe(true)
      const generationBefore = await page.evaluate(() => {
        const probe = Reflect.get(window, '__renderHostPhaserMeterGenerationProbe') as
          | { creates?: unknown; destroys?: unknown }
          | undefined
        if (typeof probe?.creates !== 'number' || typeof probe.destroys !== 'number') {
          throw new Error('Phaser meter generation probe is unavailable')
        }
        return { creates: probe.creates, destroys: probe.destroys }
      })
      const oldWrapper = await meterWrapper.elementHandle()
      const oldCanvas = await meterCanvas.elementHandle()
      if (!oldWrapper || !oldCanvas) {
        throw new Error(`stress replay ${round} old host generation missing`)
      }
      const oldCanvasParent = await oldCanvas.evaluateHandle((canvas) => canvas.parentElement)
      expect(await page.evaluate(() => (
        window.__H5_LESSON_PLAYER__?.replayScene() === true
      ))).toBe(true)
      await expect.poll(() => oldWrapper.evaluate((wrapper) => wrapper.isConnected)).toBe(false)
      await expect.poll(() => oldCanvasParent.evaluate((parent) => (
        parent?.isConnected ?? false
      ))).toBe(false)
      await expect.poll(() => page.evaluate(() => {
        const probe = Reflect.get(window, '__renderHostPhaserMeterGenerationProbe') as
          | { creates?: unknown; destroys?: unknown }
          | undefined
        return typeof probe?.creates === 'number' && typeof probe.destroys === 'number'
          ? { creates: probe.creates, destroys: probe.destroys }
          : null
      })).toEqual({
        creates: generationBefore.creates + 1,
        destroys: generationBefore.destroys + 1,
      })
      await expect(meterWrapper).toBeVisible()
      await expect(meterCanvas).toBeVisible()
      const newWrapper = await meterWrapper.elementHandle()
      const newCanvas = await meterCanvas.elementHandle()
      if (!newWrapper || !newCanvas) {
        throw new Error(`stress replay ${round} new host generation missing`)
      }
      const newCanvasParent = await newCanvas.evaluateHandle((canvas) => canvas.parentElement)
      expect(await oldWrapper.evaluate(
        (wrapper, replacement) => wrapper === replacement,
        newWrapper,
      )).toBe(false)
      expect(await oldCanvasParent.evaluate(
        (parent, replacement) => parent === replacement,
        newCanvasParent,
      )).toBe(false)
      await expect.poll(() => page.evaluate(() => ({
        index: window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() ?? -1,
        locationId: document.querySelector<HTMLElement>(
          '.slide-published-adapter',
        )?.dataset.locationId ?? null,
      }))).toEqual({
        index: 4,
        locationId: stressLocationIds[4],
      })
      if (round === 0) {
        await page.waitForTimeout(50)
        const meterStatusReset = await screenshotLogicalCanvasRegion(
          meterCanvas,
          meterStatusRegion,
          { width: 720, height: 390 },
        )
        expect(meterStatusReset.equals(meterStatusBefore)).toBe(true)
        expect(meterStatusReset.equals(meterStatusAfter)).toBe(false)
        replayResetObserved = true
      }
      replays += 1

      for (const index of [1, 2, 3, 4]) {
        await goToScene(page, index)
        await waitForLocation(stressLocationIds[index]!)
        if (index === 4) await expect(meterCanvas).toBeVisible()
        switches += 1
      }
    }
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    }))
    expect(replayResetObserved).toBe(true)
    const stress = await page.evaluate(() => {
      const webglCounts = Reflect.get(window, '__renderHostWebGlCounts') as
        | (() => { created: number; lost: number })
        | undefined
      const meterGenerations = Reflect.get(window, '__renderHostPhaserMeterGenerationProbe') as
        | { creates: number; destroys: number }
        | undefined
      return {
        index: window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() ?? -1,
        rafCount: window.__renderHostActiveRafCount?.() ?? 0,
        runtimeMounts: document.querySelectorAll('.published-canvas-runtime-mount').length,
        componentMounts: document.querySelectorAll('.published-component-mount').length,
        phaserComponentMounts: document.querySelectorAll('.published-slide-phaser-component-mount').length,
        canvases: document.querySelectorAll('canvas').length,
        webgl: webglCounts?.() ?? { created: 0, lost: 0 },
        meterGenerations: meterGenerations
          ? { ...meterGenerations }
          : { creates: -1, destroys: -1 },
      }
    })
    expect(stress).toEqual(expect.objectContaining({
      index: 4,
      runtimeMounts: 0,
      componentMounts: 0,
      phaserComponentMounts: 1,
      canvases: 1,
      meterGenerations: { creates: 51, destroys: 50 },
    }))
    expect({ switches, replays }).toEqual({ switches: 100, replays: 25 })
    expect(stress.webgl.lost).toBeGreaterThanOrEqual(26)
    expect(stress.webgl.created - stress.webgl.lost).toBe(stableWebglOutstanding)
    expect(stress.rafCount).toBeLessThanOrEqual(stableRafCount + 2)
    await expect(page.getByTestId('teacher-escape-controls')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(externalRequests).toEqual([])
  } finally {
    await browser.close()
  }
})
