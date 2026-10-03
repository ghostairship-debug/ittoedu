// @vitest-environment node
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import ExcelJS from 'exceljs'
import { Document, Packer, Paragraph, TextRun, ImageRun } from 'docx'
import PptxGenJS from 'pptxgenjs'
import { PDFDocument } from 'pdf-lib'
import { applyOfficeContent, inspectOfficeContent, type OfficeContentResult } from '../../src/main/workbench/office/OfficeContentService'
import { descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64')
const execute = promisify(execFile)

async function docxFixture() {
  const created = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', title: 'Lesson', blocks: [
    { type: 'paragraph', heading: 'title', text: 'Energy lesson' },
    { type: 'paragraph', runs: [{ text: 'Predict ', bold: true }, { text: 'the result.' }] },
    { type: 'table', rows: [['Item', 'Value'], ['Height', '2 m']] },
  ] })
  const edited = await applyOfficeContent(created.bytes, { format: 'docx', operation: 'edit', edits: [
    { type: 'replaceText', oldText: 'the result.', text: 'the final speed.' },
    { type: 'tableCell', table: 0, row: 1, column: 1, text: '4 m' },
  ] })
  return { created, edited }
}

async function xlsxFixture() {
  const created = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [
    { name: 'Data', header: true, columnWidths: [22, 18], rows: [['Quantity', 'Value'], ['Mass', 2], ['Height', 3], ['Total', { formula: 'SUM(B2:B3)' }]] },
    { name: 'Summary', rows: [['Double', { formula: "Data!B4*2" }], ['Label', { formula: 'IF(B1>10,"High","Low")' }]] },
  ] })
  const edited = await applyOfficeContent(created.bytes, { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Data', cell: 'B2', value: 5 }] })
  return { created, edited }
}

async function pptxFixture() {
  const created = await applyOfficeContent(undefined, { format: 'pptx', operation: 'create', title: 'Energy lesson', slides: [
    { title: 'Energy lesson', body: ['Predict the result', 'Observe the experiment'], notes: 'Teacher notes stay intact.' },
    { title: 'Discussion', body: ['Compare predictions with observations.'] },
  ] })
  const edited = await applyOfficeContent(created.bytes, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Mechanical energy' }] })
  return { created, edited }
}

describe('native Office content operations', () => {
  it('creates and edits DOCX paragraphs/tables while retaining run styles and unrelated media', async () => {
    const { created, edited } = await docxFixture()
    const inspection = inspectOfficeContent(edited.bytes, 'docx')
    expect(inspection.format).toBe('docx')
    if (inspection.format !== 'docx') throw new Error('wrong format')
    expect(inspection.paragraphs[1].text).toBe('Predict the final speed.')
    expect(inspection.tables[0][1]).toEqual(['Height', '4 m'])
    const pkg = new OfficePackage(edited.bytes)
    const paragraph = descendants(pkg.xml(pkg.main()), NS.word, 'p')[1]
    expect(descendants(paragraph, NS.word, 'b')).toHaveLength(1)
    expect(edited.changedParts).toEqual(['word/document.xml'])
    const originalParts = unzipSync(created.bytes), editedParts = unzipSync(edited.bytes)
    expect(strFromU8(editedParts['word/styles.xml'])).toBe(strFromU8(originalParts['word/styles.xml']))

    const withImage = new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'Before', bold: true })] }),
      new Paragraph({ children: [new ImageRun({ type: 'png', data: pixel, transformation: { width: 24, height: 24 } })] }),
    ] }] })))
    const preserved = await applyOfficeContent(withImage, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'After' }] })
    const originalImagePackage = new OfficePackage(withImage), preservedImagePackage = new OfficePackage(preserved.bytes)
    expect(descendants(preservedImagePackage.xml(preservedImagePackage.main()), NS.word, 'drawing')).toHaveLength(1)
    const media = Object.keys(originalImagePackage.parts).find(name => name.startsWith('word/media/') && name.endsWith('.png'))!
    // Exact preservation is part of the local-edit contract for an unrelated embedded image.
    expect(preservedImagePackage.parts[media]).toEqual(originalImagePackage.parts[media])
    expect(strFromU8(preservedImagePackage.parts['word/_rels/document.xml.rels'])).toBe(strFromU8(originalImagePackage.parts['word/_rels/document.xml.rels']))
  })

  it('recalculates XLSX dependencies and preserves unrelated cell styles, images and formula definitions', async () => {
    const { created, edited } = await xlsxFixture()
    expect(created.calculation?.values.find(value => value.sheet === 'Summary' && value.cell === 'B1')?.value).toBe(10)
    expect(edited.calculation?.status).toBe('complete')
    expect(edited.calculation?.values).toEqual(expect.arrayContaining([
      { sheet: 'Data', cell: 'B4', value: 8 },
      { sheet: 'Summary', cell: 'B1', value: 16 },
      { sheet: 'Summary', cell: 'B2', value: 'High' },
    ]))
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(Uint8Array.from(edited.bytes).buffer)
    expect(reopened.getWorksheet('Data')!.getCell('B4').value).toEqual({ formula: 'SUM(B2:B3)', result: 8 })
    expect(reopened.getWorksheet('Data')!.getCell('A1').font.bold).toBe(true)
    expect(reopened.getWorksheet('Summary')!.getCell('B1').value).toEqual({ formula: 'Data!B4*2', result: 16 })

    const existing = new ExcelJS.Workbook()
    const sheet = existing.addWorksheet('Existing')
    sheet.getCell('A1').value = 2; sheet.getCell('B1').value = { formula: 'A1*3', result: 6 }
    sheet.getCell('C2').value = 'Keep'; sheet.getCell('C2').font = { italic: true, color: { argb: 'FFFF0000' } }
    const image = existing.addImage({ buffer: Uint8Array.from(pixel).buffer, extension: 'png' })
    sheet.addImage(image, 'E2:F4')
    const existingBytes = new Uint8Array(await existing.xlsx.writeBuffer())
    const patched = await applyOfficeContent(existingBytes, { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Existing', cell: 'A1', value: 4 }] })
    const after = new ExcelJS.Workbook(); await after.xlsx.load(Uint8Array.from(patched.bytes).buffer)
    expect(after.getWorksheet('Existing')!.getCell('B1').value).toEqual({ formula: 'A1*3', result: 12 })
    expect(after.getWorksheet('Existing')!.getCell('C2').font.italic).toBe(true)
    expect(after.getWorksheet('Existing')!.getImages()).toHaveLength(1)
    expect(patched.changedParts.some(part => part.includes('drawing') || part.includes('media') || part.endsWith('styles.xml'))).toBe(false)
  })

  it('keeps unsupported XLSX formulas and useful edits with an explicit incomplete calculation result', async () => {
    const existing = new ExcelJS.Workbook(); const sheet = existing.addWorksheet('Sheet1')
    sheet.getCell('A1').value = 2
    sheet.getCell('B1').value = { formula: 'UNSUPPORTED(A1)', result: 123 }
    sheet.getCell('C1').value = { formula: 'B1+1', result: 124 }
    const edited = await applyOfficeContent(new Uint8Array(await existing.xlsx.writeBuffer()), { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Sheet1', cell: 'A1', value: 9 }] })
    expect(edited.calculation).toEqual({ engine: 'xlsx-calc', status: 'partial', values: [] })
    expect(edited.diagnostics.map(value => value.code)).toEqual(['formula-not-supported', 'formula-caches-cleared'])
    const reopened = inspectOfficeContent(edited.bytes, 'xlsx')
    if (reopened.format !== 'xlsx') throw new Error('wrong format')
    expect(reopened.sheets[0].cells).toEqual(expect.arrayContaining([
      { cell: 'A1', value: 9 }, { cell: 'B1', value: null, formula: 'UNSUPPORTED(A1)' }, { cell: 'C1', value: null, formula: 'B1+1' },
    ]))
  })

  it('creates and locally edits PPTX text while retaining geometry, another slide, notes and pictures', async () => {
    const { created, edited } = await pptxFixture()
    const before = new OfficePackage(created.bytes), after = new OfficePackage(edited.bytes)
    const reopened = inspectOfficeContent(edited.bytes, 'pptx')
    if (reopened.format !== 'pptx') throw new Error('wrong format')
    expect(reopened.slides[0].shapes.find(shape => shape.name === 'title')?.text).toBe('Mechanical energy')
    expect(reopened.slides[1].shapes.find(shape => shape.name === 'title')?.text).toBe('Discussion')
    expect(edited.changedParts).toEqual(['ppt/slides/slide1.xml'])
    expect(strFromU8(after.parts['ppt/notesSlides/notesSlide1.xml'])).toBe(strFromU8(before.parts['ppt/notesSlides/notesSlide1.xml']))
    const geometry = (pkg: OfficePackage) => descendants(pkg.xml('ppt/slides/slide1.xml'), NS.drawing, 'xfrm').map(node => node.toString())
    expect(geometry(after)).toEqual(geometry(before))

    const pptx = new PptxGenJS(); const slide = pptx.addSlide()
    slide.addText('Before', { x: 1, y: 1, w: 4, h: 1, objectName: 'headline' })
    slide.addImage({ data: `image/png;base64,${pixel.toString('base64')}`, x: 5, y: 1, w: 1, h: 1, objectName: 'picture' })
    const original = await pptx.write({ outputType: 'uint8array' }) as Uint8Array
    const patched = await applyOfficeContent(original, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'headline', text: 'After' }] })
    const packageAfter = new OfficePackage(patched.bytes)
    expect(descendants(packageAfter.xml('ppt/slides/slide1.xml'), NS.slide, 'pic')).toHaveLength(1)
    expect(patched.changedParts).toEqual(['ppt/slides/slide1.xml'])
  })
})

const libreOffice = process.env.OFFICE_TEST_SOFFICE ?? 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
describe('Office real application interoperability', () => {
  it.runIf(existsSync(libreOffice))('opens the edited DOCX/XLSX/PPTX in LibreOffice and produces real page layouts', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-office-real-'))
    try {
      const artifacts: OfficeContentResult[] = [(await docxFixture()).edited, (await xlsxFixture()).edited, (await pptxFixture()).edited]
      const files: string[] = []
      for (const artifact of artifacts) {
        const file = path.join(temporary, `lesson-${artifact.format}.${artifact.format}`)
        await fs.writeFile(file, artifact.bytes); files.push(file)
      }
      const output = path.join(temporary, 'rendered'); await fs.mkdir(output)
      await execute(libreOffice, [`-env:UserInstallation=${pathToFileURL(path.join(temporary, 'profile')).href}`, '--headless', '--convert-to', 'pdf', '--outdir', output, ...files], { windowsHide: true, timeout: 60000 })
      for (const artifact of artifacts) {
        const pdf = await PDFDocument.load(await fs.readFile(path.join(output, `lesson-${artifact.format}.pdf`)))
        expect(pdf.getPageCount()).toBe(artifact.format === 'pptx' ? 2 : artifact.format === 'xlsx' ? 2 : 1)
        expect(pdf.getPages().every(page => page.getWidth() > 100 && page.getHeight() > 100)).toBe(true)
      }
      // Optional retained fixture evidence for manual visual review; ordinary tests leave no product files.
      if (process.env.OFFICE_TEST_EVIDENCE_DIRECTORY) {
        const evidence = process.env.OFFICE_TEST_EVIDENCE_DIRECTORY
        await fs.mkdir(evidence, { recursive: true })
        for (const file of files) await fs.copyFile(file, path.join(evidence, path.basename(file)))
        await fs.cp(output, path.join(evidence, 'rendered'), { recursive: true })
      }
    } finally {
      const resolved = path.resolve(temporary)
      if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture path')
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }, 90000)
})
