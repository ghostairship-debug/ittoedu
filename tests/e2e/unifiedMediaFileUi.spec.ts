import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23, m23Row, m23Shot, writeM23Evidence } from './helpers/g20M23Harness'

async function openMedia(page: Page, name: string, kind: 'image' | 'pdf') {
  await m23Row(page, name).dblclick()
  await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: new RegExp(`^${name.replace(/\./g, '\\.')}`) }))
    .toHaveAttribute('aria-selected', 'true')
  const region = page.getByRole('region', { name: kind === 'image' ? '图片查看与编辑' : 'PDF 查看与编辑', exact: true })
  await expect(region).toBeVisible()
  return region
}

async function pdfPaint(canvas: Locator) {
  return canvas.evaluate(element => {
    const source = element as HTMLCanvasElement
    const pixels = source.getContext('2d')?.getImageData(0, 0, source.width, source.height).data
    let dark = 0, colored = 0
    if (pixels) for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! < 200) continue
      if (pixels[index]! < 100 && pixels[index + 1]! < 100 && pixels[index + 2]! < 100) dark += 1
      if (pixels[index]! > 150 && pixels[index + 1]! < 130 && pixels[index + 2]! < 100) colored += 1
    }
    return { width: source.width, height: source.height, displayWidth: source.getBoundingClientRect().width,
      devicePixelRatio: window.devicePixelRatio, dark, colored }
  })
}

async function imageDimensions(path: string) {
  const metadata = await sharp(readFileSync(path)).metadata()
  return [metadata.width, metadata.height]
}

function assertPdfResolution(paint: Awaited<ReturnType<typeof pdfPaint>>) {
  const requestedWidth = Math.floor(paint.displayWidth * paint.devicePixelRatio)
  const capLimited = paint.width < requestedWidth
  if (capLimited) expect(Math.max(paint.width, paint.height)).toBeGreaterThanOrEqual(3600)
  else expect(paint.width).toBeGreaterThanOrEqual(requestedWidth)
  return { requestedWidth, capLimited, dprCoverageRatio: paint.width / requestedWidth }
}

test('unified media UI renders PDF and saves rotated PNG and PDF to original files before reopening', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Requires the actual Windows Electron host.')
  test.setTimeout(180_000)
  const fixture = m23Fixture('unified-media-file-ui')
  const pngPath = join(fixture.workspace, 'media-rotation.png')
  const pdfPath = join(fixture.workspace, 'media-rotation.pdf')
  const pixels = Buffer.alloc(80 * 40 * 3)
  for (let y = 0; y < 40; y += 1) for (let x = 0; x < 80; x += 1) {
    const index = (y * 80 + x) * 3
    pixels.set(x < 40 ? [230, 35, 30] : [25, 75, 220], index)
  }
  writeFileSync(pngPath, await sharp(pixels, { raw: { width: 80, height: 40, channels: 3 } }).png().toBuffer())
  const source = await PDFDocument.create()
  const sourcePage = source.addPage([200, 100])
  const font = await source.embedFont(StandardFonts.Helvetica)
  sourcePage.drawText('MEDIA PDF ORIGINAL', { x: 12, y: 72, size: 12, font })
  sourcePage.drawRectangle({ x: 20, y: 18, width: 130, height: 25, color: rgb(0.9, 0.2, 0.05) })
  writeFileSync(pdfPath, await source.save())
  const facts: Record<string, unknown> = { case: 'unified-media-file-ui', status: 'running', pngPath, pdfPath }
  let runtime: Awaited<ReturnType<typeof launchM23>> | undefined
  let failure: unknown
  try {
    runtime = await launchM23(fixture)
    const { app, page, capture } = runtime
    await chooseM23Workspace(app, page, fixture.workspace)

    let image = await openMedia(page, 'media-rotation.png', 'image')
    await expect(image.getByRole('img', { name: '当前图片', exact: true })).toBeVisible()
    await expect(image.getByRole('status')).toHaveText('80 × 40')
    await image.getByRole('button', { name: '顺时针旋转', exact: true }).click()
    await expect(image.getByRole('status')).toHaveText('1 项编辑尚未保存')
    await image.getByRole('button', { name: '保存', exact: true }).focus()
    await page.keyboard.press('Control+s')
    await expect(image.getByRole('status')).toHaveText('已保存到原文件，并重新读取确认。')
    expect(await imageDimensions(pngPath)).toEqual([40, 80])
    const savedPixels = await sharp(readFileSync(pngPath)).removeAlpha().raw().toBuffer()
    expect(Array.from(savedPixels.subarray((10 * 40 + 10) * 3, (10 * 40 + 10) * 3 + 3))).toEqual([230, 35, 30])
    expect(Array.from(savedPixels.subarray((60 * 40 + 10) * 3, (60 * 40 + 10) * 3 + 3))).toEqual([25, 75, 220])
    await m23Shot(fixture, page, info, 'png-rotated-saved', app)
    await page.getByRole('button', { name: '关闭 media-rotation.png', exact: true }).click()
    await expect(image).toHaveCount(0)
    image = await openMedia(page, 'media-rotation.png', 'image')
    await expect(image.getByRole('status')).toHaveText('40 × 80')
    await expect.poll(() => image.getByRole('img', { name: '当前图片', exact: true }).evaluate(element => {
      const img = element as HTMLImageElement
      return [img.naturalWidth, img.naturalHeight]
    })).toEqual([40, 80])
    facts.png = { savedFormat: 'png', dimensions: [40, 80], originalColoredHalvesPreserved: true, shortcutSave: true, reopened: true }

    let pdf = await openMedia(page, 'media-rotation.pdf', 'pdf')
    const canvas = pdf.getByLabel('PDF 第 1 页', { exact: true })
    await expect(pdf.getByRole('button', { name: '顺时针旋转', exact: true })).toBeEnabled()
    await expect.poll(async () => (await pdfPaint(canvas)).dark).toBeGreaterThan(100)
    await expect.poll(async () => (await pdfPaint(canvas)).colored).toBeGreaterThan(100)
    const beforePaint = await pdfPaint(canvas)
    expect(beforePaint.width).toBeGreaterThan(beforePaint.height)
    const originalResolution = assertPdfResolution(beforePaint)
    await m23Shot(fixture, page, info, 'pdf-original-rendered', app)
    await pdf.getByRole('button', { name: '顺时针旋转', exact: true }).click()
    await expect(pdf.getByRole('status')).toHaveText('1 项编辑尚未保存')
    await expect(pdf.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await pdf.getByRole('button', { name: '保存', exact: true }).click()
    await expect(pdf.getByRole('status')).toHaveText('已保存到原文件，并重新读取确认。')
    const savedPdf = await PDFDocument.load(readFileSync(pdfPath))
    expect(savedPdf.getPageCount()).toBe(1)
    expect(savedPdf.getPage(0).getRotation().angle).toBe(90)
    expect(savedPdf.getPage(0).getSize()).toEqual({ width: 200, height: 100 })
    await page.getByRole('button', { name: '关闭 media-rotation.pdf', exact: true }).click()
    await expect(pdf).toHaveCount(0)
    pdf = await openMedia(page, 'media-rotation.pdf', 'pdf')
    const reopenedCanvas = pdf.getByLabel('PDF 第 1 页', { exact: true })
    await expect(pdf.getByRole('button', { name: '顺时针旋转', exact: true })).toBeEnabled()
    await expect.poll(async () => (await pdfPaint(reopenedCanvas)).dark).toBeGreaterThan(100)
    await expect.poll(async () => (await pdfPaint(reopenedCanvas)).colored).toBeGreaterThan(100)
    const reopenedPaint = await pdfPaint(reopenedCanvas)
    expect(reopenedPaint.height).toBeGreaterThan(reopenedPaint.width)
    const reopenedResolution = assertPdfResolution(reopenedPaint)
    facts.pdf = { originalPaint: beforePaint, originalResolution, reopenedPaint, reopenedResolution,
      savedRotation: 90, pageSizePreserved: true, reopened: true }
    await m23Shot(fixture, page, info, 'pdf-rotated-reopened', app)
    expect(capture.pageErrors).toEqual([])
    facts.status = 'passed'
  } catch (error) {
    failure = error; facts.status = 'failed'; throw error
  } finally {
    if (runtime) {
      const { app, page, capture } = runtime
      if (failure) await m23Shot(fixture, page, info, 'failure', app)
      const evidence = await writeM23Evidence(fixture, page, app, capture, facts, failure)
      await info.attach('Media actual Electron evidence', { path: evidence, contentType: 'application/json' })
      await closeM23(app)
    }
  }
})
