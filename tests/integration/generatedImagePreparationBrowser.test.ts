// @vitest-environment node
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'

let server: ViteDevServer, browser: Browser, page: Page
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-generated-image-browser'), resolve: { alias: { '@': path.resolve('src') } },
    optimizeDeps: { noDiscovery: true, include: ['nanoid', 'zod'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__image-preparation-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Image preparation fixture</title><script type="module">import("/src/renderer/project/prepareGeneratedImage.ts").then(module => { window.prepareGeneratedImage = module.prepareGeneratedImage }).catch(error => { window.preparationLoadError = String(error) });</script>')
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}/__image-preparation-test`)
  await page.waitForFunction(() => typeof Reflect.get(window, 'prepareGeneratedImage') === 'function' || Reflect.get(window, 'preparationLoadError'))
  expect(await page.evaluate(() => Reflect.get(window, 'preparationLoadError'))).toBeUndefined()
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })

function prepare(bytes: Buffer, mimeType = 'image/png', preserveResolution = false,
  display = { width: 320, height: 160 }, fit: 'contain' | 'cover' | 'stretch' = 'contain') {
  return page.evaluate(async ({ base64, mimeType, preserveResolution, display, fit }) => {
    const prepareGeneratedImage = Reflect.get(window, 'prepareGeneratedImage')
    const input = { bytes: Uint8Array.from(atob(base64), character => character.charCodeAt(0)), mimeType, filename: 'misnamed-source.jpeg',
      display, fit, preserveResolution }
    const result = await prepareGeneratedImage(input)
    const repeat = await prepareGeneratedImage(input)
    let binary = ''
    for (const value of result.bytes) binary += String.fromCharCode(value)
    return { width: result.width, height: result.height, mimeType: result.mimeType, filename: result.filename, base64: btoa(binary), cached: result === repeat }
  }, { base64: bytes.toString('base64'), mimeType, preserveResolution, display, fit })
}

describe('generated image preparation in the real Chromium resource decoder', () => {
  it('resizes the complete PNG at display scale, preserves alpha and edges, and prepares the copy idempotently', async () => {
    const raw = Buffer.alloc(2048 * 1024 * 4)
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 2048; x++) {
      const at = (y * 2048 + x) * 4
      raw[at] = x < 1024 ? 255 : 0; raw[at + 2] = x >= 1024 ? 255 : 0
      raw[at + 3] = x < 64 && y < 64 ? 0 : 255
    }
    const source = await sharp(raw, { raw: { width: 2048, height: 1024, channels: 4 } }).png().toBuffer()
    const result = await prepare(source)
    expect(result).toMatchObject({ width: 640, height: 320, mimeType: 'image/png', filename: 'misnamed-source.png', cached: true })
    const output = Buffer.from(result.base64, 'base64'), decoded = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 640, height: 320, channels: 4 })
    expect([...decoded.data.subarray(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...decoded.data.subarray((319 * 640) * 4, (319 * 640) * 4 + 4)]).toEqual([255, 0, 0, 255])
    expect([...decoded.data.subarray((319 * 640 + 639) * 4, (319 * 640 + 639) * 4 + 4)]).toEqual([0, 0, 255, 255])
    const second = await prepare(output)
    expect(second.base64).toBe(result.base64)
    const preserved = await prepare(source, 'image/png', true)
    expect(preserved).toMatchObject({ width: 2048, height: 1024, base64: source.toString('base64') })
  }, 30_000)

  it.each(['jpeg', 'webp'] as const)('uses real %s format and proportional output instead of the filename', async format => {
    const source = await sharp({ create: { width: 1536, height: 768, channels: 4, background: { r: 40, g: 180, b: 80, alpha: format === 'webp' ? 0.5 : 1 } } })[format]().toBuffer()
    const result = await prepare(source, `image/${format}`)
    const output = Buffer.from(result.base64, 'base64'), metadata = await sharp(output).metadata()
    expect(result).toMatchObject({ width: 640, height: 320, mimeType: `image/${format}` })
    expect(metadata).toMatchObject({ format, width: 640, height: 320 })
    if (format === 'webp') {
      const pixels = await sharp(output).ensureAlpha().raw().toBuffer()
      expect(pixels[3]).toBeGreaterThanOrEqual(126); expect(pixels[3]).toBeLessThanOrEqual(129)
    }
  }, 30_000)

  it('does not upscale small images and rejects a mislabeled or damaged image before producing an import', async () => {
    const source = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#ff000080' } }).png().toBuffer()
    expect(await prepare(source)).toMatchObject({ width: 64, height: 32, base64: source.toString('base64') })
    await expect(prepare(source, 'image/jpeg')).rejects.toThrow('真实字节')
    await expect(prepare(source.subarray(0, 42))).rejects.toThrow('无法完整解码')
  }, 30_000)

  it('budgets a square illustration by its actual contained display and reduces large PNG encoding without losing text or alpha', async () => {
    const width = 1024, raw = Buffer.alloc(width * width * 4)
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      raw[at] = Math.round(130 + Math.sin(x / 11) * 40 + Math.cos(y / 14) * 40)
      raw[at + 1] = Math.round(150 + Math.sin(x / 13 + y / 15) * 60)
      raw[at + 2] = Math.round(160 + Math.cos(x / 7 - y / 21) * 70)
      raw[at + 3] = x < 64 ? 0 : x < 128 ? 128 : 255
    }
    const text = Buffer.from('<svg width="1024" height="1024"><rect x="250" y="250" width="520" height="420" fill="white"/><text x="280" y="510" font-family="sans-serif" font-size="180" fill="black">H2O</text></svg>')
    const source = await sharp(raw, { raw: { width, height: width, channels: 4 } }).composite([{ input: text }]).png().toBuffer()
    const original = Buffer.from(source)
    const contain = await prepare(source, 'image/png', false, { width: 500, height: 120 })
    expect(contain).toMatchObject({ width: 512, height: 512, mimeType: 'image/webp' })
    const output = Buffer.from(contain.base64, 'base64')
    expect(output.length).toBeLessThan(source.length * 0.5)
    expect(source).toEqual(original)
    const pixels = await sharp(output).ensureAlpha().raw().toBuffer()
    expect(pixels[3]).toBe(0)
    expect(pixels[(400 * 512 + 48) * 4 + 3]).toBe(128)
    // Compare the text region to a high-quality full-source resize, not a screenshot.
    const reference = await sharp(source).resize(512, 512).ensureAlpha().raw().toBuffer()
    let error = 0, count = 0
    for (let y = 125; y < 335; y++) for (let x = 125; x < 385; x++) for (let channel = 0; channel < 3; channel++) {
      const at = (y * 512 + x) * 4 + channel
      error += Math.abs(pixels[at]! - reference[at]!); count++
    }
    expect(error / count).toBeLessThan(4)
    expect((await prepare(source, 'image/png', false, { width: 500, height: 120 }, 'cover')).width).toBe(1000)
    expect((await prepare(output, 'image/webp', false, { width: 500, height: 120 })).base64).toBe(contain.base64)
    const sameSizePng = await sharp(source).resize(512, 512).png().toBuffer()
    const encoded = await prepare(sameSizePng, 'image/png', false, { width: 500, height: 120 })
    expect(encoded).toMatchObject({ width: 512, height: 512, mimeType: 'image/webp' })
    expect(Buffer.from(encoded.base64, 'base64').length).toBeLessThan(sameSizePng.length * 0.9)
  }, 30_000)
})
