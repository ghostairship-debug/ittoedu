// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

it('keeps native clicks and background gestures inside the current Spatial viewport boundary', async () => {
  const bundled = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'spatial-input-browser.ts', contents: `
      import { bindSpatialInput } from './src/player/componentPlatform/spatialInput'
      import { createComponentSpatialCameraPort } from './src/player/surfaces/spatial/componentSpatialAdapter'
      const viewport = document.querySelector('#viewport')
      const native = document.querySelector('#native')
      const camera = createComponentSpatialCameraPort({ x: 250, y: 150, zoom: 1 })
      const paint = () => { viewport.dataset.camera = JSON.stringify(camera.read()) }
      camera.subscribe(paint); paint(); bindSpatialInput(viewport, camera)
      native.addEventListener('click', event => {
        native.dataset.clicks = String(Number(native.dataset.clicks || 0) + 1)
        native.dataset.target = event.target.id
      })
      document.addEventListener('pointerdown', event => { viewport.dataset.prevented = String(event.defaultPrevented) })
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    await page.setContent(`<div data-component-instance-id="outer-container">
      <div id="viewport" style="position:relative;width:500px;height:300px;background:#eee">
        <div id="world" style="position:absolute;inset:0">
          <div id="native" data-component-instance-id="native" style="position:absolute;left:20px;top:20px;width:180px;height:40px;background:white">
            <span id="label">Native overview</span>
          </div>
        </div>
      </div>
    </div>`)
    await page.addScriptTag({ content: bundled.outputFiles[0]!.text })
    const viewport = page.locator('#viewport'), native = page.locator('#native')
    const camera = () => viewport.getAttribute('data-camera').then(value => JSON.parse(value!) as { x: number; y: number; zoom: number })
    for (const rootMarked of [false, true]) {
      if (rootMarked) await viewport.evaluate(element => { (element as HTMLElement).dataset.componentInstanceId = 'same-container' })
      await page.locator('#label').click()
      expect(await native.getAttribute('data-clicks')).toBe(rootMarked ? '2' : '1')
      expect(await native.getAttribute('data-target')).toBe('label')
      expect(await viewport.getAttribute('data-prevented')).toBe('false')

      const before = await camera()
      await page.mouse.move(440, 250); await page.mouse.down(); await page.mouse.move(460, 265); await page.mouse.up()
      const after = await camera()
      expect(after.x).toBeCloseTo(before.x - 20 / before.zoom)
      expect(after.y).toBeCloseTo(before.y - 15 / before.zoom)
      expect(await viewport.getAttribute('data-prevented')).toBe('true')
      await page.mouse.wheel(0, -100)
      await expect.poll(() => camera().then(value => value.zoom)).toBeGreaterThan(before.zoom)
    }
    for (const gesture of ['space', 'middle']) {
      const before = await camera(), box = await native.boundingBox()
      expect(box).not.toBeNull()
      const x = box!.x + 30, y = box!.y + 15
      await page.mouse.move(x, y)
      if (gesture === 'space') await page.keyboard.down('Space')
      await page.mouse.down({ button: gesture === 'middle' ? 'middle' : 'left' })
      await page.mouse.move(x + 12, y + 8)
      await page.mouse.up({ button: gesture === 'middle' ? 'middle' : 'left' })
      if (gesture === 'space') await page.keyboard.up('Space')
      const after = await camera()
      expect(after.x).toBeCloseTo(before.x - 12 / before.zoom)
      expect(after.y).toBeCloseTo(before.y - 8 / before.zoom)
    }
  } finally { await browser.close() }
}, 30_000)
