import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const projectRoot = resolve(__dirname, '..', '..')
const htmlPath = join(
  projectRoot,
  'examples',
  'render-host-benchmark',
  'render-host-benchmark.html',
)
const htmlV2Path = join(
  projectRoot,
  'examples',
  'render-host-benchmark',
  'render-host-benchmark-v2.html',
)
const visualOutputDirectory = join(projectRoot, 'output', 'playwright')

async function goToScene(page: Page, index: number): Promise<void> {
  expect(await page.evaluate((targetIndex) =>
    window.__H5_LESSON_PLAYER__?.goToScene(targetIndex) === true,
  index)).toBe(true)
  await page.waitForFunction((targetIndex) =>
    window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() === targetIndex,
  index)
}

async function clickLogicalPoint(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.locator('.lesson-canvas-host canvas').first()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Player canvas is not visible')
  await page.mouse.click(
    bounds.x + x / 1280 * bounds.width,
    bounds.y + y / 720 * bounds.height,
  )
}

async function phaserTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const player = window.__H5_LESSON_PLAYER__
    if (!player) throw new Error('Player is not initialized')
    const scene = player.game.scene.getScene('courseware-player')
    const texts: string[] = []
    const visit = (candidate: unknown): void => {
      if (typeof candidate !== 'object' || candidate === null) return
      const record = candidate as Record<string, unknown>
      if (typeof record.text === 'string') texts.push(record.text)
      if (Array.isArray(record.list)) record.list.forEach(visit)
    }
    scene.children.list.forEach(visit)
    return texts
  })
}

test('Project V8 五种渲染路径可离线互动且反复切换不泄漏宿主', async () => {
  mkdirSync(visualOutputDirectory, { recursive: true })
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
  })

  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__H5_LESSON_PLAYER__))
    await expect.poll(() => page.evaluate(() =>
      window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() ?? -1,
    )).toBe(0)
    await expect.poll(() => page.evaluate(() => {
      const scene = window.__H5_LESSON_PLAYER__?.game.scene
        .getScene('courseware-player')
      if (!scene) return 0
      const sceneNodes = scene.children.getByName('scene-nodes')
      if (!sceneNodes) return 0
      const children = Reflect.get(sceneNodes, 'list')
      return Array.isArray(children) ? children.length : 0
    })).toBe(8)

    await goToScene(page, 1)
    await clickLogicalPoint(page, 900, 344)
    await expect.poll(async () => (await phaserTexts(page)).some((text) =>
      text.includes('已从右侧施加脉冲'),
    )).toBe(true)

    await goToScene(page, 2)
    const threeCanvas = page.locator('.lesson-runtime-mount canvas')
    await expect(threeCanvas).toBeVisible()
    const threeBounds = await threeCanvas.boundingBox()
    if (!threeBounds) throw new Error('Three.js canvas is not visible')
    await page.mouse.move(threeBounds.x + threeBounds.width * 0.7, threeBounds.y + threeBounds.height * 0.48)
    await page.mouse.down()
    await page.mouse.move(threeBounds.x + threeBounds.width * 0.55, threeBounds.y + threeBounds.height * 0.34, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.lesson-runtime-mount output')).toHaveText('视角已更新')
    await threeCanvas.hover()
    await page.mouse.wheel(0, -180)
    await expect(page.locator('.lesson-runtime-mount output')).toHaveText('观察距离已更新')
    await page.getByRole('button', { name: '恢复视角' }).click()
    await expect(page.locator('.lesson-runtime-mount output')).toHaveText('已恢复默认观察视角')
    await page.evaluate(() => window.__H5_LESSON_PLAYER__?.waitForCaptureReady())
    const preparedThreeFrame = await page.evaluate(() => {
      const player = window.__H5_LESSON_PLAYER__
      if (!player) throw new Error('Player is not initialized')
      const source = [...document.querySelectorAll<HTMLElement>(
        '.lesson-runtime-mount',
      )]
        .map((mount) => mount.shadowRoot?.querySelector<HTMLCanvasElement>('canvas'))
        .find((canvas): canvas is HTMLCanvasElement => Boolean(canvas))
      if (!source) return null
      const snapshot = player.getPreparedCanvasSnapshot(source) as
        | HTMLCanvasElement
        | undefined
      if (!snapshot) return null
      return {
        sameCanvas: snapshot === source,
        width: snapshot.width,
        height: snapshot.height,
        png: snapshot.toDataURL('image/png'),
      }
    })
    expect(preparedThreeFrame).not.toBeNull()
    expect(preparedThreeFrame?.sameCanvas).toBe(false)
    expect(preparedThreeFrame?.width ?? 0).toBeGreaterThanOrEqual(1156)
    expect(preparedThreeFrame?.height ?? 0).toBeGreaterThanOrEqual(432)
    const preparedThreeStats = await sharp(Buffer.from(
      preparedThreeFrame!.png.split(',')[1] ?? '',
      'base64',
    )).stats()
    expect(preparedThreeStats.channels.some(({ stdev }) => stdev > 12)).toBe(true)
    const threeScreenshot = await threeCanvas.screenshot({
      path: join(visualOutputDirectory, 'render-host-three-runtime.png'),
    })
    const threeStats = await sharp(threeScreenshot).stats()
    expect(threeStats.channels.some(({ stdev }) => stdev > 12)).toBe(true)

    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(threeCanvas).toBeVisible()
    const resizedThreeBounds = await threeCanvas.boundingBox()
    expect(resizedThreeBounds?.width ?? 0).toBeGreaterThan(500)
    await page.setViewportSize({ width: 1440, height: 900 })

    await goToScene(page, 3)
    const table = page.locator('[data-component-instance-id="table_component_instance"]')
    await expect(table.locator('h2')).toHaveText('课件渲染路径选型表')
    await table.locator('tbody tr').first().click()
    await expect(table.locator('output')).toContainText('已选中：原生节点')
    await table.getByRole('button', { name: '按适用度排序' }).click()
    await expect(table.locator('output')).toHaveText('已按适用度从高到低排序')
    await table.screenshot({
      path: join(visualOutputDirectory, 'render-host-v4-dom-table.png'),
    })

    await goToScene(page, 4)
    expect(await phaserTexts(page)).toContain('V4 OK')
    await clickLogicalPoint(page, 640, 380)
    await expect.poll(async () => (await phaserTexts(page)).some((text) =>
      text.includes('第 1 次交互'),
    )).toBe(true)
    await page.waitForTimeout(50)
    const stableRafCount = await page.evaluate(() =>
      window.__renderHostActiveRafCount?.() ?? 0,
    )
    const stress = await page.evaluate(async () => {
      const player = window.__H5_LESSON_PLAYER__
      if (!player) throw new Error('Player is not initialized')
      let switches = 0
      let replays = 0
      for (let round = 0; round < 25; round += 1) {
        for (const index of [1, 2, 3, 4]) {
          if (!player.goToScene(index)) throw new Error(`stress scene ${index} failed`)
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
          switches += 1
        }
        if (!player.replayScene()) throw new Error(`stress replay ${round} failed`)
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        replays += 1
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      return {
        index: player.getCurrentSceneIndex(),
        rafCount: window.__renderHostActiveRafCount?.() ?? 0,
        runtimeMounts: document.querySelectorAll('.lesson-runtime-mount').length,
        componentMounts: document.querySelectorAll('.lesson-component-mount').length,
        runtimeCanvases: document.querySelectorAll('.lesson-runtime-mount canvas').length,
        switches,
        replays,
      }
    })
    expect(stress).toEqual(expect.objectContaining({
      index: 4,
      runtimeMounts: 0,
      componentMounts: 0,
      runtimeCanvases: 0,
      switches: 100,
      replays: 25,
    }))
    expect(stress.rafCount).toBeLessThanOrEqual(stableRafCount + 2)

    await page.screenshot({
      path: join(visualOutputDirectory, 'render-host-benchmark-final.png'),
      fullPage: true,
    })
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(externalRequests).toEqual([])
  } finally {
    await browser.close()
  }
})

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
    await phaserRuntimeCanvas.click({
      position: {
        x: phaserBounds.width * (652 / 1280),
        y: phaserBounds.height * (344 / 720),
      },
    })
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

    await goToScene(page, 4)
    await waitForLocation('scene_component_v4_phaser_v9')
    const meterCanvas = page.locator(
      '[data-slide-layer-item="phaser_meter_component_instance"] canvas[data-published-phaser-component]',
    )
    await expect(meterCanvas).toBeVisible()
    await page.waitForTimeout(200)
    const meterBounds = await meterCanvas.boundingBox()
    if (!meterBounds) throw new Error('Published V2 Phaser Component canvas is not visible')
    const meterBefore = await meterCanvas.screenshot()
    await meterCanvas.click({
      position: { x: meterBounds.width * 0.5, y: meterBounds.height * 0.58 },
    })
    await page.waitForTimeout(50)
    const meterAfter = await meterCanvas.screenshot()
    expect(meterAfter.equals(meterBefore)).toBe(false)
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

    const stress = await page.evaluate(async () => {
      const player = window.__H5_LESSON_PLAYER__
      if (!player) throw new Error('Published V2 Player is not initialized')
      const ids = [
        'scene_native_nodes_v9',
        'scene_runtime_phaser_v9',
        'scene_runtime_three_v9',
        'scene_component_v4_dom_v9',
        'scene_component_v4_phaser_v9',
      ]
      const waitUntil = async (accept: () => boolean, label: string): Promise<void> => {
        const deadline = performance.now() + 8_000
        while (!accept()) {
          if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}`)
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
      }
      const go = async (index: number): Promise<void> => {
        if (!player.goToScene(index)) throw new Error(`stress scene ${index} failed`)
        await waitUntil(() => (
          player.getCurrentSceneIndex() === index &&
          document.querySelector<HTMLElement>('.slide-published-adapter')?.dataset.locationId === ids[index]
        ), `scene ${index}`)
      }
      let switches = 0
      let replays = 0
      for (let round = 0; round < 25; round += 1) {
        for (const index of [1, 2, 3, 4]) {
          await go(index)
          switches += 1
        }
        let replay = document.querySelector<HTMLButtonElement>(
          '.slide-native-teacher-controller [data-controller-button-id="teacher_button_benchmark_06"]',
        )
        if (!replay) {
          document.querySelector<HTMLButtonElement>(
            '.slide-native-teacher-controller [data-teacher-controller-collapse="true"]',
          )?.click()
          replay = document.querySelector<HTMLButtonElement>(
            '.slide-native-teacher-controller [data-controller-button-id="teacher_button_benchmark_06"]',
          )
        }
        if (!replay) throw new Error(`stress replay ${round} control missing`)
        replay.click()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        replays += 1
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const webglCounts = Reflect.get(window, '__renderHostWebGlCounts') as
        | (() => { created: number; lost: number })
        | undefined
      return {
        index: player.getCurrentSceneIndex(),
        rafCount: window.__renderHostActiveRafCount?.() ?? 0,
        runtimeMounts: document.querySelectorAll('.published-canvas-runtime-mount').length,
        componentMounts: document.querySelectorAll('.published-component-mount').length,
        phaserComponentMounts: document.querySelectorAll('.published-slide-phaser-component-mount').length,
        canvases: document.querySelectorAll('canvas').length,
        webgl: webglCounts?.() ?? { created: 0, lost: 0 },
        switches,
        replays,
      }
    })
    expect(stress).toEqual(expect.objectContaining({
      index: 4,
      runtimeMounts: 0,
      componentMounts: 0,
      phaserComponentMounts: 1,
      canvases: 1,
      switches: 100,
      replays: 25,
    }))
    expect(stress.webgl.lost).toBeGreaterThanOrEqual(26)
    expect(stress.webgl.created - stress.webgl.lost).toBe(stableWebglOutstanding)
    expect(stress.rafCount).toBeLessThanOrEqual(stableRafCount + 2)
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(externalRequests).toEqual([])
  } finally {
    await browser.close()
  }
})
