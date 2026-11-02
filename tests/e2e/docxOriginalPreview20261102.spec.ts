import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Document, Header, Footer, HeadingLevel, ImageRun, PageNumber, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import sharp from 'sharp'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20Row, m20VisibleTextEditor } from './helpers/g20M20Harness'

const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAApUlEQVR4nO3QAQnDUABEsXqZh6qZpzGT1VEZ7z4EoiDX5/s/zvO7j3Pla6J35Wuid4kWLTqXr4neJVq06Fy+JnqXaNGic/ma6F2iRYvO5Wuid4kWLTqXr4neJVq06Fy+JnqXaNGic/ma6F2iRYvO5Wuid4kWLTqXr4neJVq06Fy+JnqXaNGic/ma6F2iRYvO5Wuid4kWLTqXr4neJVq06Fy+JnrXC4sWZ+u7ydVFAAAAAElFTkSuQmCC', 'base64')
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const fileHash = (filename: string) => digest(readFileSync(filename))
const previewFor = (page: Page, name: string) => page.locator('.docx-file-preview')
  .filter({ has: page.locator('strong', { hasText: name }) })

// Independent LibreOffice conversions can rasterize edges slightly differently.
// This measures bounded visual differences; it does not assert their cause.
async function compareRaster(firstPath: string, secondPath: string) {
  const decode = (filename: string) => sharp(filename).flatten({ background: '#ffffff' }).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const [a, b] = await Promise.all([decode(firstPath), decode(secondPath)])
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== 3 || b.info.channels !== 3) {
    throw new Error(`Raster dimensions/channels differ: ${JSON.stringify([a.info, b.info])}`)
  }
  const width = a.info.width, height = a.info.height, pixels = width * height
  const edge = (data: Buffer) => {
    const mask = new Uint8Array(pixels)
    const mark = (p: number, other: number) => {
      const i = p * 3, j = other * 3
      if (Math.max(Math.abs(data[i]! - data[j]!), Math.abs(data[i + 1]! - data[j + 1]!), Math.abs(data[i + 2]! - data[j + 2]!)) >= 16) {
        mask[p] = 1; mask[other] = 1
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (x) mark(p, p - 1)
      if (y) mark(p, p - width)
    }
    return mask
  }
  const aEdge = edge(a.data), bEdge = edge(b.data)
  const nearEdge = (mask: Uint8Array, x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) return true
    }
    return false
  }
  let changed = 0, significant = 0, outsideFirstEdge = 0, outsideSecondEdge = 0, maxDelta = 0, totalDelta = 0
  for (let p = 0; p < pixels; p++) {
    const i = p * 3, r = Math.abs(a.data[i]! - b.data[i]!), g = Math.abs(a.data[i + 1]! - b.data[i + 1]!), blue = Math.abs(a.data[i + 2]! - b.data[i + 2]!)
    const delta = Math.max(r, g, blue)
    totalDelta += r + g + blue; maxDelta = Math.max(maxDelta, delta)
    if (delta) changed++
    if (delta > 2) {
      significant++
      const x = p % width, y = Math.floor(p / width)
      if (!nearEdge(aEdge, x, y)) outsideFirstEdge++
      if (!nearEdge(bEdge, x, y)) outsideSecondEdge++
    }
  }
  return { width, height, pixels, changed, changedFraction: changed / pixels, significant,
    maxDelta, meanChannelDelta: totalDelta / (pixels * 3), outsideFirstEdge, outsideSecondEdge,
    edgeGradient: 16, edgeRadius: 1, significantThreshold: 2 }
}

async function wordFixture(link: string): Promise<Uint8Array> {
  const document = new Document({
    title: 'Word 原件分页验收', creator: '果铃验收样本',
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 }, paragraph: { spacing: { after: 160, line: 320 } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: '果铃课堂 · 原件页眉', color: '48667C', size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: 'center', children: [new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页'] })] })] }) },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: '原件：声速与频率', bold: true, color: '235C91' })] }),
        new Paragraph('这是保留原件分页、中文排版与表格的验收文稿。温度、频率和波长分别记录在下表中。'),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
          ['温度', '声速', '说明'], ['20 ℃', '343 m/s', '保持此表格和单元格格式'], ['30 ℃', '349 m/s', '频率 f = 440 Hz'],
        ].map((row, index) => new TableRow({ children: row.map(text => new TableCell({
          shading: { fill: index === 0 ? 'DFEAF4' : 'FFFFFF' },
          children: [new Paragraph({ children: [new TextRun({ text, bold: index === 0 })] })],
        })) })) }),
        new Paragraph({ children: [new ImageRun({ type: 'png', data: picture, transformation: { width: 240, height: 120 } })] }),
        new Paragraph({ children: [new TextRun({ text: '图 1：两种介质的示意色块（保留文稿中的图片）', italics: true, size: 18 })] }),
        new Paragraph('GUOLING_FORMULA_PLACEHOLDER'),
        new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, text: '第二页：保持此页内容' }),
        new Paragraph('这一页用于核对分页和冷开。修改第一页标题后，本页的段落、页眉、页脚和页面尺寸应继续保留。'),
        new Paragraph({ bullet: { level: 0 }, text: '问题一：频率不变时，波长如何随声速改变？' }),
        new Paragraph({ bullet: { level: 0 }, text: '问题二：说明你的推理并保留人工批注空间。' }),
      ],
    }],
  })
  const parts = unzipSync(await Packer.toBuffer(document))
  // Keep an embedded cached picture while adding a linked source. Merely opening
  // a preview must not contact it; the HTTP counter also observes native LO.
  let main = strFromU8(parts['word/document.xml']!)
  // Use a real Office Math fraction so the visual comparison exercises equations,
  // not a text string that merely looks like a formula.
  const formula = '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>v = </m:t></m:r><m:f><m:num><m:r><m:t>λ</m:t></m:r></m:num><m:den><m:r><m:t>T</m:t></m:r></m:den></m:f></m:oMath>'
  const marker = /<w:t(?:\s[^>]*)?>GUOLING_FORMULA_PLACEHOLDER<\/w:t>/
  if (!marker.test(main)) throw new Error('fixture formula placeholder was not generated')
  main = main.replace(marker, '<w:t></w:t></w:r>' + formula + '<w:r>')
  if (!main.includes('<a:blip ')) throw new Error('fixture picture was not generated')
  parts['word/document.xml'] = strToU8(main.replace('<a:blip ', '<a:blip r:link="guolingLinkedImage" '))
  const relations = 'word/_rels/document.xml.rels'
  parts[relations] = strToU8(strFromU8(parts[relations]!).replace('</Relationships>',
    `<Relationship Id="guolingLinkedImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="${link}"/></Relationships>`))
  return zipSync(parts)
}

test('D2 Word original pages, same-owner edit/reload and independent offline cold reopen use the real App', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The release acceptance uses Windows Electron and a local Writer runtime.')
  test.setTimeout(240_000)
  const base = resolve('output/goal-correction-20261102/word')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'ui-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const requests: string[] = []
  const server = createServer((request, response) => { requests.push(request.url ?? ''); response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(picture) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture HTTP listener unavailable')
  const name = '中文原件分页验收.docx', filename = join(workspace, name)
  writeFileSync(filename, await wordFixture(`http://127.0.0.1:${address.port}/linked-picture.png`))
  writeFileSync(join(workspace, '课堂笔记.txt'), '切换文件后返回 Word 原件。\n', 'utf8')
  const original = readFileSync(filename), before = digest(original)
  const evidence: Record<string, unknown> = { case: 'D2 Word original paginated preview', before, workspace, phase: 'launch' }
  const errors: string[] = []
  let running: Awaited<ReturnType<typeof launchM20>> | undefined
  try {
    running = await launchM20(fixture)
    let { app, page } = running
    page.on('pageerror', error => errors.push(error.message))
    const initialPid = app.process().pid
    evidence.initialPid = initialPid
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const preview = previewFor(page, name)
    await expect(preview).toBeVisible({ timeout: 60_000 })
    await expect(preview).toContainText('第 1 / 2 页', { timeout: 60_000 })
    await expect(preview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    await expect(preview).toHaveAttribute('data-source-sha256', before)
    const canvas = preview.locator('canvas')
    const dimensionsByLabel: Record<string, { width: number; height: number; pixelRatio: number; css: { width: number; height: number } }> = {}
    const captureCanvas = async (label: string, current = canvas) => {
      const captured = await current.evaluate(node => {
        const canvas = node as HTMLCanvasElement, rect = canvas.getBoundingClientRect()
        return { png: canvas.toDataURL(), width: canvas.width, height: canvas.height, pixelRatio: devicePixelRatio, css: { width: rect.width, height: rect.height } }
      })
      writeFileSync(join(directory, label + '.png'), Buffer.from(captured.png.split(',')[1]!, 'base64'))
      const { png, ...dimensions } = captured
      dimensionsByLabel[label] = dimensions
      evidence[label] = { ...dimensions, sha256: digest(png) }
      return digest(png)
    }
    const assertEquivalentRaster = async (label: string, first: string, second: string) => {
      expect(dimensionsByLabel[first]).toEqual(dimensionsByLabel[second])
      const comparison = await compareRaster(join(directory, `${first}.png`), join(directory, `${second}.png`))
      evidence[label] = comparison
      // Cross-process rasterization can change high-contrast edge pixels by
      // more than 40 levels. Keep maxDelta as evidence, and bound the actual
      // spatial error against BOTH images instead of an arbitrary peak value.
      // Source/part hashes, exact page geometry and independent visual review
      // separately protect content; no significant difference may leave a 1px edge.
      expect(comparison.meanChannelDelta).toBeLessThanOrEqual(0.05)
      expect(comparison.changedFraction).toBeLessThanOrEqual(0.01)
      expect(comparison.outsideFirstEdge).toBe(0)
      expect(comparison.outsideSecondEdge).toBe(0)
    }
    const bounds = await canvas.boundingBox()
    expect(bounds && bounds.width > 100 && bounds.height > 100).toBe(true)
    const initialCanvas = await captureCanvas('canvas-original-page-1')
    evidence.initialCanvas = initialCanvas; evidence.initialBounds = bounds
    expect(fileHash(filename)).toBe(before)
    expect(requests).toEqual([])
    await page.screenshot({ path: join(directory, '01-original-page-1.png'), fullPage: true })

    evidence.phase = 'page-navigation-and-inactive-tab'
    await preview.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(preview).toContainText('第 2 / 2 页')
    await expect(preview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    const secondCanvas = await captureCanvas('canvas-original-page-2')
    expect(secondCanvas).not.toBe(initialCanvas)
    await page.screenshot({ path: join(directory, '02-original-page-2.png'), fullPage: true })
    await m20Row(page, '课堂笔记.txt').dblclick()
    await expect(m20VisibleTextEditor(page)).toBeVisible()
    await expect(preview).toBeHidden()
    await expect(preview.locator('canvas')).toHaveCount(0)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name, exact: true }).click()
    await expect(preview).toContainText('第 2 / 2 页')
    await preview.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(preview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')

    evidence.phase = 'same-main-owner-formal-edit'
    const edit = await app.evaluate(async ({ app }, filename) => {
      const load = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
      const { documentHost } = load('./dist-electron/main/workbench/documentHost.js')
      const { OfficeFileService } = load('./dist-electron/main/workbench/office/OfficeFileService.js')
      const host = documentHost(), binding = await host.artifacts.bind(filename)
      const saved = await new OfficeFileService(host).edit(binding, { format: 'docx', operation: 'edit', edits: [{
        type: 'paragraph', index: 0, text: '最新原件：声速与频率',
      }] })
      // Same owner as the preview: this invalidates its prior issued binding.
      let oldBindingRejected = false
      try { host.artifacts.resolveBinding(binding) } catch { oldBindingRejected = true }
      return { status: saved.status, beforeVersion: binding.fileVersion, afterVersion: saved.binding.fileVersion, oldBindingRejected }
    }, filename)
    expect(edit.status).toBe('saved'); expect(edit.oldBindingRejected).toBe(true)
    expect(edit.afterVersion).not.toBe(edit.beforeVersion)
    const editedHash = fileHash(filename), editedParts = unzipSync(readFileSync(filename)), originalParts = unzipSync(original)
    expect(editedHash).not.toBe(before)
    expect(Object.keys(editedParts).sort()).toEqual(Object.keys(originalParts).sort())
    const changedParts = Object.keys(originalParts).filter(part => !Buffer.from(originalParts[part]!).equals(editedParts[part]!))
    expect(changedParts).toEqual(['word/document.xml'])
    evidence.edit = edit; evidence.editedHash = editedHash; evidence.changedParts = changedParts

    evidence.phase = 'actual-refresh-click'
    await preview.getByRole('button', { name: '重新载入', exact: true }).click()
    await expect(preview).toHaveAttribute('data-source-sha256', editedHash, { timeout: 60_000 })
    await expect(preview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    await expect.poll(async () => digest(await canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL()))).not.toBe(initialCanvas)
    await expect(preview.getByRole('alert')).toHaveCount(0)
    const editedCanvas = await captureCanvas('canvas-edited-page-1')
    expect(fileHash(filename)).toBe(editedHash)
    expect(requests).toEqual([])
    await page.screenshot({ path: join(directory, '03-latest-source-after-edit.png'), fullPage: true })

    evidence.phase = 'independent-process-offline-cold-reopen'
    await closeM20(app); running = undefined
    running = await launchM20(fixture); ({ app, page } = running)
    page.on('pageerror', error => errors.push(error.message))
    expect(app.process().pid).not.toBe(initialPid)
    evidence.coldPid = app.process().pid
    await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }))
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const cold = previewFor(page, name)
    await expect(cold).toContainText('第 1 / 2 页', { timeout: 60_000 })
    await expect(cold).toHaveAttribute('data-source-sha256', editedHash)
    await expect(cold.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    await captureCanvas('canvas-cold-page-1', cold.locator('canvas'))
    await assertEquivalentRaster('cold-page-1-comparison', 'canvas-edited-page-1', 'canvas-cold-page-1')
    await cold.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(cold.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    await captureCanvas('canvas-cold-page-2', cold.locator('canvas'))
    await assertEquivalentRaster('cold-page-2-comparison', 'canvas-original-page-2', 'canvas-cold-page-2')
    expect(fileHash(filename)).toBe(editedHash)
    expect(errors).toEqual([]); expect(requests).toEqual([])
    evidence.phase = 'complete'; evidence.status = 'real-ui-same-owner-reload-and-offline-cold-reopen-passed'
    evidence.editedCanvas = editedCanvas; evidence.finalHash = fileHash(filename); evidence.errors = errors; evidence.externalRequests = requests
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.errors = errors; evidence.externalRequests = requests; evidence.finalHash = fileHash(filename)
    if (running) await m20Evidence(info, fixture, running.page, evidence, error)
    else writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ ...evidence, failure: error instanceof Error ? error.message : String(error) }, null, 2))
    throw error
  } finally {
    if (running) await closeM20(running.app)
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
