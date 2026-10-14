import { it, expect } from 'vitest'
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { imageDataSchema } from '../../src/components/image/data'
import { createTableData } from '../../src/components/table/data'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { bytesToDataUrl } from '../../src/renderer/export/base64'
import type { affineOutputPicture, outputImageDimensions } from '../../src/renderer/export/outputImage'
import { auditExportPng } from '../fixtures/auditExportPng'

it('CA090/030/211/032/179: real Chromium consumes cropped Print paint, opacity, and the affine bitmap projection', async () => {
  const sourceImage = auditExportPng(4, 2, x => x === 0 ? [255, 0, 0, 255] : x === 3 ? [0, 0, 255, 255] : [0, 255, 0, 255])
  const table = createTableData({ rows: 1, columns: 1 }); table.rows[0]!.cells[0]!.text = 'Visible table text'; Object.assign(table.style, { fillColor: '#ff0000', fillOpacity: 0, borderColor: '#0000ff', borderOpacity: 0 })
  const source = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'pixels', revision: 0, title: '绘制检查',
    definitions: Object.fromEntries(['image', 'text', 'table'].map(key => [`guoling.${key}`, { id: `guoling.${key}`, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: {
      image: { id: 'image', definitionId: 'guoling.image', data: imageDataSchema.parse({ assetId: 'art', originalAssetId: 'art', fit: 'contain', crop: { left: 0.25, right: 0.25, top: 0, bottom: 0 } }), frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } },
      invisible: { id: 'invisible', definitionId: 'guoling.text', style: { opacity: 0 }, data: { content: { inlines: [{ type: 'text', text: 'Invisible text' }] } } },
      table: { id: 'table', definitionId: 'guoling.table', data: table },
    }, surfaces: [{ id: 'page', title: '绘制检查', kind: 'flow', childIds: ['image', 'invisible', 'table'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const print = await buildComponentPrintHtml(source, { surfaceId: 'page', resolveAsset: () => ({ bytes: sourceImage, mimeType: 'image/png' }) })
  // esbuild requires Node's Uint8Array realm, while this serializer test needs jsdom.
  const bundle = execFileSync(process.execPath, ['-e', "process.stdout.write(require('esbuild').buildSync({entryPoints:[process.argv[1]],bundle:true,write:false,format:'iife',globalName:'auditOutputImage',platform:'browser'}).outputFiles[0].text)", resolve('src/renderer/export/outputImage.ts')], { encoding: 'utf8' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 })
    await page.setContent(print.html)
    await page.addScriptTag({ content: bundle })
    const transform = [1, 0, 0.5, 1, 10, 20] as const
    const projected = await page.evaluate(async ({ image, transform }) => {
      const api = (window as unknown as { auditOutputImage: { affineOutputPicture: typeof affineOutputPicture } }).auditOutputImage
      const picture = await api.affineOutputPicture(image, { width: 100, height: 100 }, [...transform])
      const bitmap = new Image(); bitmap.src = picture.dataUrl; await bitmap.decode()
      const canvas = document.createElement('canvas'); canvas.width = bitmap.naturalWidth; canvas.height = bitmap.naturalHeight
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0)
      const pixels = [[5, 5], [145, 5], [5, 95], [145, 95]].map(([x, y]) => Array.from(context.getImageData(x!, y!, 1, 1).data))
      const display = document.createElement('img'); display.src = picture.dataUrl; display.dataset.affineProof = 'true'; document.body.append(display)
      return { bounds: picture.bounds, pixels }
    }, { image: bytesToDataUrl(auditExportPng(100, 100, () => [255, 0, 0, 255]), 'image/png'), transform })
    expect(projected.bounds).toEqual({ x: 10, y: 20, width: 150, height: 100 })
    expect(projected.pixels).toEqual([[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255]])
    const regions = await page.evaluate(() => {
      const box = (element: Element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
      return { image: box(document.querySelector('figure')!), invisible: box(document.querySelector('[data-component-output="invisible"]')!), table: box(document.querySelector('td')!) }
    })
    const directory = resolve('output/playwright/auditAllExports'); mkdirSync(directory, { recursive: true })
    const screenshot = await page.screenshot({ path: resolve(directory, 'b5-real-paint.png') })
    const paint = await page.evaluate(async ({ screenshot, regions }) => {
      const image = new Image(); image.src = screenshot; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
      const pixel = (x: number, y: number) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data)
      const countDark = (rect: { x: number; y: number; width: number; height: number }) => {
        const values = context.getImageData(Math.round(rect.x), Math.round(rect.y), Math.floor(rect.width), Math.floor(rect.height)).data
        let count = 0; for (let i = 0; i < values.length; i += 4) if (values[i]! < 100 && values[i + 1]! < 100 && values[i + 2]! < 100) count++
        return count
      }
      return { crop: [10, 100, 190].map(x => pixel(regions.image.x + x, regions.image.y + 50)), invisibleDark: countDark(regions.invisible), tableDark: countDark(regions.table), tablePadding: pixel(regions.table.x + 4, regions.table.y + 4) }
    }, { screenshot: bytesToDataUrl(screenshot, 'image/png'), regions })
    expect(paint.crop).toEqual([[255, 255, 255, 255], [0, 255, 0, 255], [255, 255, 255, 255]])
    expect(paint.invisibleDark).toBe(0); expect(paint.tableDark).toBeGreaterThan(0); expect(paint.tablePadding).toEqual([255, 255, 255, 255])
    // Keep the sniffed signature and positive dimensions, but use an impossible PNG color type.
    const corrupted = new Uint8Array(sourceImage); corrupted[25] = 255
    const decoded = await page.evaluate(async dataUrl => {
      const api = (window as unknown as { auditOutputImage: { outputImageDimensions: typeof outputImageDimensions } }).auditOutputImage
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]!), character => character.charCodeAt(0))
      try { await api.outputImageDimensions(bytes, 'image/png'); return true } catch { return false }
    }, bytesToDataUrl(corrupted, 'image/png'))
    expect(decoded).toBe(false)
  } finally { await browser.close() }
}, 20_000)
