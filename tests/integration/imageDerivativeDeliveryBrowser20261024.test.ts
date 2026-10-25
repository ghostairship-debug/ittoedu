// @vitest-environment node
import path from 'node:path'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { unzipSync } from 'fflate'
import type { ImageDerivativeDemand } from '../../src/shared/imageDerivative'

let server: ViteDevServer, browser: Browser, page: Page
const evidence = path.resolve('output/test-runs/image-derivative-delivery-20261024')
const comparisons: Array<Record<string, unknown>> = []
beforeAll(async () => {
  await mkdir(evidence, { recursive: true })
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-delivery-image-browser-20261024'),
    resolve: { alias: { '@': path.resolve('src') } }, optimizeDeps: { noDiscovery: true, include: ['nanoid', 'zod'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__delivery-image-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Delivery images</title><script type="module">import("/src/renderer/export/componentPlatform/encodeDeliveryImage.ts").then(module => { window.deliveryImage = module.encodeDeliveryImage });</script>')
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.goto(`http://127.0.0.1:${address.port}/__delivery-image-test`)
  await page.waitForFunction(() => typeof Reflect.get(window, 'deliveryImage') === 'function')
}, 30_000)
afterAll(async () => {
  await writeFile(path.join(evidence, 'image-comparisons.json'), JSON.stringify(comparisons, null, 2))
  await browser?.close(); await server?.close()
})

async function encode(bytes: Buffer, mimeType: string, demand?: ImageDerivativeDemand) {
  return page.evaluate(async ({ base64, mimeType, demand }) => {
    const source = Uint8Array.from(atob(base64), character => character.charCodeAt(0)), before = source.slice()
    const start = performance.now()
    const result = await Reflect.get(window, 'deliveryImage')({ id: 'sample', path: 'assets/sample', mimeType, filename: 'sample' }, source, document, undefined, demand)
    return { result: result ? { ...result, bytes: undefined, base64: btoa(Array.from(result.bytes as Uint8Array, value => String.fromCharCode(value)).join('')) } : undefined,
      milliseconds: performance.now() - start, originalUnchanged: source.every((value, index) => value === before[index]) }
  }, { base64: bytes.toString('base64'), mimeType, demand })
}

async function compare(name: string, original: Buffer, mimeType: string, demand: ImageDerivativeDemand) {
  const sourceMetadata = await sharp(original).metadata(), encoded = await encode(original, mimeType, demand)
  expect(encoded.originalUnchanged).toBe(true)
  expect(encoded.result).toBeDefined()
  const result = encoded.result!, output = Buffer.from(result.base64, 'base64'), metadata = await sharp(output).metadata()
  expect(metadata).toMatchObject({ width: result.width, height: result.height })
  expect(output.length).toBeLessThan(original.length)
  expect(result.width).toBeLessThanOrEqual(sourceMetadata.width!)
  expect(result.height).toBeLessThanOrEqual(sourceMetadata.height!)
  const width = demand.width, height = demand.height, fit = demand.fit === 'cover' ? 'cover' as const : 'contain' as const
  const reference = await sharp(original).resize(width, height, { fit, background: '#ffffff' }).flatten({ background: '#fff' }).raw().toBuffer()
  const actual = await sharp(output).resize(width, height, { fit, background: '#ffffff' }).flatten({ background: '#fff' }).raw().toBuffer()
  let error = 0
  for (let index = 0; index < actual.length; index++) error += Math.abs(actual[index]! - reference[index]!)
  const meanAbsoluteDisplayError = error / actual.length
  expect(meanAbsoluteDisplayError).toBeLessThan(9)
  const extension = result.mimeType === 'image/png' ? 'png' : 'webp'
  await writeFile(path.join(evidence, `${name}-original.${mimeType.split('/')[1]}`), original)
  await writeFile(path.join(evidence, `${name}-delivery.${extension}`), output)
  const markup = `<body style="font:16px sans-serif;background:#ddd"><h1>${name}: original / runtime derivative at same display</h1><div style="display:flex;gap:24px"><figure><figcaption>Original ${original.length}B</figcaption><img style="width:${width}px;height:${height}px;object-fit:${fit}" src="data:${mimeType};base64,${original.toString('base64')}"></figure><figure><figcaption>Derivative ${output.length}B</figcaption><img style="width:${width}px;height:${height}px;object-fit:${fit}" src="data:${result.mimeType};base64,${output.toString('base64')}"></figure></div></body>`
  await writeFile(path.join(evidence, `${name}-comparison.html`), markup)
  await page.setContent(markup)
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())))
  await page.screenshot({ path: path.join(evidence, `${name}-comparison.png`), fullPage: true })
  comparisons.push({ name, source: { width: sourceMetadata.width, height: sourceMetadata.height, mimeType, bytes: original.length, alpha: sourceMetadata.hasAlpha },
    derivative: { width: metadata.width, height: metadata.height, mimeType: result.mimeType, bytes: output.length, alpha: metadata.hasAlpha }, demand,
    savedPercent: (1 - output.length / original.length) * 100, meanAbsoluteDisplayError, millisecondsFirstEncoding: encoded.milliseconds, originalUnchanged: true })
  return metadata
}

it('optimizes actual v08 photography and transparent artwork through production delivery encoding without changing its GLX', async () => {
  const archive = unzipSync(await readFile(path.resolve('docs/creative-production/works/coffee-journey/design/v08/native/coffee-journey-v08.glx')))
  const entries = Object.entries(archive).filter(([name]) => name.startsWith('assets/'))
  const jpeg = entries.filter(([name]) => /\.jpe?g$/i.test(name)).sort((a, b) => b[1].length - a[1].length)[0]!
  const webp = entries.filter(([name]) => /\.webp$/i.test(name)).sort((a, b) => b[1].length - a[1].length)[0]!
  expect(jpeg).toBeDefined(); expect(webp).toBeDefined()
  await compare('v08-photo', Buffer.from(jpeg[1]), 'image/jpeg', { width: 360, height: 240, fit: 'cover', quality: 'photo' })
  const alpha = await compare('v08-alpha', Buffer.from(webp[1]), 'image/webp', { width: 320, height: 320, fit: 'contain' })
  expect(alpha.hasAlpha).toBe(true)
}, 30_000)

it('retains text/chart PNG losslessly and preserves vectors and animated carriers', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect x="1" y="1" width="2398" height="1598" fill="white" stroke="black" stroke-width="2"/><path d="M100 1400L800 200 1600 1200 2300 100" fill="none" stroke="navy" stroke-width="12"/><text x="150" y="800" font-family="sans-serif" font-size="100">H₂O + CO₂ → chart 123</text></svg>')
  const png = await sharp(svg).png().toBuffer()
  const metadata = await compare('detail-chart', png, 'image/png', { width: 600, height: 400, quality: 'detail' })
  expect(metadata.format).toBe('png')
  const losslessWebp = await sharp(png).webp({ lossless: true }).toBuffer()
  const detail = await encode(losslessWebp, 'image/webp', { width: 600, height: 400, quality: 'detail' })
  // A fine-chart lossless WebP may remain smaller than a resized PNG. Either
  // preserve that source or return a PNG; canvas q1 WebP would still be lossy.
  expect(detail.originalUnchanged).toBe(true)
  if (detail.result) expect(detail.result.mimeType).toBe('image/png')
  expect((await encode(svg, 'image/svg+xml', { width: 100, height: 100 })).result).toBeUndefined()
  const gif = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff000080' } }).gif().toBuffer()
  expect((await encode(gif, 'image/gif', { width: 8, height: 8 })).result).toBeUndefined()
}, 30_000)
