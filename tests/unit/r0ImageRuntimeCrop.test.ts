// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { decodeImageTransformPng } from '../../src/shared/imageTransform'
import { createImageData, replaceImageSource } from '../../src/components/image/data'

it('renders only the kept 75% source in contain while preserving the image, display style and author frame', async () => {
  const display = { ...createImageData('original', '裁剪原图'), crop: { left: .25, top: 0, right: 0, bottom: 0 }, cornerRadius: 12,
    filters: { brightness: 1.2, contrast: 1, saturation: 1, grayscale: 0, blur: 0 } }
  const replacement = replaceImageSource(display, 'replacement')
  // Replacement changes recoverable source identity, retaining the teacher's display edits.
  expect.soft(replacement).toEqual({ ...display, assetId: 'replacement', originalAssetId: 'replacement' })
  const bundle = await build({ stdin: { contents: `export { createImageRuntimeImplementation } from './src/components/image/runtime';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'CropRuntime', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 })
    await page.setContent('<style>body{margin:0;background:white}</style><div id="frame" style="width:320px;height:180px;transform:matrix(1,0,0,1,480,270)"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    const original = await page.evaluate(async () => {
      const api = (window as any).CropRuntime, root = document.getElementById('frame')!, controller = new AbortController()
      const source = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="blue"/><rect width="80" height="180" fill="#ffcc00"/></svg>'
      const instance = { id: 'image-target', definitionId: 'guoling.image', frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 480, 270] },
        data: { assetId: 'source', originalAssetId: 'source', alt: '裁剪原图', crop: { left: .25, top: 0, right: 0, bottom: 0 }, fit: 'contain', cornerRadius: 12,
          filters: { brightness: 1.2, contrast: 1, saturation: 1, grayscale: 0, blur: 0 } } }
      const scope = { signal: controller.signal, isActive: () => !controller.signal.aborted, cleanup() {} }
      const mounted = api.createImageRuntimeImplementation(() => ({ url: `data:image/svg+xml,${encodeURIComponent(source)}`, animated: false })).mount({ root, instance, scope })
      const image = root.querySelector('img')!
      await image.decode()
      image.dispatchEvent(new Event('load'))
      Object.assign(window, { cropFixture: { mounted, instance, image, root, controller } })
      return { frame: structuredClone(instance.frame), data: structuredClone(instance.data), rootStyle: root.getAttribute('style') }
    })
    const readPixels = async () => {
      const pixels = decodeImageTransformPng(await page.locator('#frame').screenshot())
      const pixel = (x: number, y: number) => [...pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3)]
      return { leftMargin: pixel(20, 90), keptSource: pixel(60, 90), rightMargin: pixel(300, 90) }
    }
    // The discarded yellow quarter formerly leaked into this 40px contain margin.
    expect.soft(await readPixels()).toEqual({ leftMargin: [255, 255, 255], keptSource: [0, 0, 255], rightMargin: [255, 255, 255] })
    const state = await page.evaluate(() => {
      const { mounted, instance, image, root } = (window as any).cropFixture
      const host = image.parentElement!, before = { left: image.style.left, width: image.style.width, filter: host.style.filter, radius: host.style.borderRadius }
      mounted.update({ ...instance, data: { ...instance.data, flipX: true } })
      return { frame: instance.frame, data: instance.data, rootStyle: root.getAttribute('style'), sameImage: root.querySelector('img') === image,
        alt: image.alt, before, transform: image.style.transform }
    })
    expect(state.frame).toEqual(original.frame); expect(state.data).toEqual(original.data); expect(state.rootStyle).toBe(original.rootStyle)
    expect(state.sameImage).toBe(true); expect(state.alt).toBe('裁剪原图')
    expect(state.before).toMatchObject({ left: '-40px', width: '320px', radius: '12px' }); expect(state.before.filter).toContain('brightness(1.2)')
    expect(state.transform).toContain('scale(-1, 1)')
    expect.soft(await readPixels()).toEqual({ leftMargin: [255, 255, 255], keptSource: [0, 0, 255], rightMargin: [255, 255, 255] })
    const replacedState = await page.evaluate(data => {
      const { mounted, instance, image, root } = (window as any).cropFixture
      mounted.update({ ...instance, data })
      return { sameImage: root.querySelector('img') === image, frame: instance.frame, left: image.style.left }
    }, replacement)
    expect(replacedState.sameImage).toBe(true); expect(replacedState.frame).toEqual(original.frame)
    expect.soft(replacedState.left).toBe('-40px')
    await page.evaluate(() => { const fixture = (window as any).cropFixture; fixture.controller.abort(); fixture.mounted.dispose() })
    expect(await page.locator('#frame img').count()).toBe(0)
  } finally { await browser.close() }
}, 15_000)
