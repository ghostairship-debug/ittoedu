import { expect, it } from 'vitest'
import { Workbook } from 'exceljs'
import { createDocx, wordBody } from '../../src/main/workbench/office/docxContent'
import { editDocxObject } from '../../src/main/workbench/office/docxObjectCompiler'
import { createXlsx, inspectXlsx } from '../../src/main/workbench/office/xlsxContent'
import { editXlsxObject } from '../../src/main/workbench/office/xlsxObjectCompiler'
import { children, descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'
import { Document, Header, Packer, Paragraph } from 'docx'
import { applyOfficeObjectEdit, inspectOfficeObjectSource } from '../../src/main/workbench/office/officeObjectCompiler'

it('finds and edits a raw Word header part while keeping the document body unchanged', async () => {
  const bytes = new Uint8Array(await Packer.toBuffer(new Document({ sections: [{
    headers: { default: new Header({ children: [new Paragraph('Existing header')] }) },
    children: [new Paragraph('Body remains untouched')],
  }] })))
  const listing = inspectOfficeObjectSource(bytes, { format: 'docx', packageParts: true })
  if (!('packageParts' in listing)) throw new Error('missing part listing')
  const header = listing.packageParts.find(part => part.contentType?.endsWith('.header+xml'))!
  const observed = inspectOfficeObjectSource(bytes, { format: 'docx', packagePart: header.part })
  if (!('packagePart' in observed) || !observed.xml) throw new Error('missing header XML')
  const target = { part: observed.packagePart.part, partVersion: observed.packagePart.partVersion }
  const result = applyOfficeObjectEdit(bytes, { format: 'docx', packagePart: target,
    native: { path: [], xml: observed.xml.replace('Existing header', 'Native header update') } })
  expect(result.changedParts).toEqual([header.part])
  const pkg = new OfficePackage(result.bytes)
  expect(pkg.xml(header.part).documentElement.textContent).toBe('Native header update')
  expect(pkg.parts[pkg.main()]).toEqual(new OfficePackage(bytes).parts[pkg.main()])
  expect(() => applyOfficeObjectEdit(result.bytes, { format: 'docx', packagePart: target, native: { path: [], xml: observed.xml! } }))
    .toThrow('原生部件版本已改变')
})

it('adds a native peer paragraph and refuses a table cell outside a row', async () => {
  const bytes = await createDocx({ format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: '保留' }] })
  const target = { kind: 'paragraph' as const, paragraph: 0 }
  const edit = (xml: string) => applyOfficeObjectEdit(bytes, { format: 'docx', target, native: { path: [], insert: 'after', xml } })
  expect(() => edit('<w:tc/>')).toThrow('正文不能直接包含')
  const result = wordBody(new OfficePackage(edit('<w:p><w:r><w:t>新增</w:t></w:r></w:p>').bytes)).body
  expect(children(result, NS.word, 'p').map(node => node.textContent)).toEqual(['保留', '新增'])
})

it('edits a native Word paragraph property without replacing its runs or neighboring structure', async () => {
  const bytes = await createDocx({ format: 'docx', operation: 'create', blocks: [
    { type: 'paragraph', runs: [{ text: '当前段落', bold: true }] },
    { type: 'paragraph', text: '下一段' },
    { type: 'table', rows: [['表格内容']] },
  ] })
  const pkg = new OfficePackage(bytes)
  editDocxObject(pkg, { format: 'docx', target: { kind: 'paragraph', paragraph: 0 }, properties: [
    '<w:spacing w:before="120" w:after="220"/>',
    '<w:pBdr><w:bottom w:val="single" w:sz="8" w:color="00FF00"/></w:pBdr>',
  ] })
  const result = new OfficePackage(pkg.save())
  const { main, body } = wordBody(result)
  expect([...pkg.changed]).toEqual([main])
  const [first, second] = descendants(body, NS.word, 'p')
  const [properties] = children(first!, NS.word, 'pPr')
  expect(children(properties!, NS.word, '*').map(node => node.localName)).toEqual(['pBdr', 'spacing'])
  expect(descendants(properties!, NS.word, 'bottom')[0]!.getAttributeNS(NS.word, 'color')).toBe('00FF00')
  expect(descendants(first!, NS.word, 'b')).toHaveLength(1)
  expect(descendants(first!, NS.word, 't')[0]!.textContent).toBe('当前段落')
  expect(descendants(second!, NS.word, 'spacing')[0]!.getAttributeNS(NS.word, 'after')).toBe('160')
  expect(descendants(body, NS.word, 'tbl')).toHaveLength(1)
  expect(() => editDocxObject(result, { format: 'docx', target: { kind: 'paragraph', paragraph: 0 }, properties: ['<w:sectPr/>'] })).toThrow(/不支持修改/)
  expect(() => editDocxObject(result, { format: 'docx', target: { kind: 'paragraph', paragraph: 0 }, properties: ['<w:pBdr><w:hyperlink/></w:pBdr>'] })).toThrow(/子节点/)
})

it('uses a private style for the edited Excel cell while preserving shared style, formula and display', async () => {
  const workbook = new Workbook(), sheet = workbook.addWorksheet('账本')
  sheet.getCell('A1').value = { formula: '1+2', result: 3 }
  sheet.getCell('B1').value = 4
  sheet.getCell('A1').font = { name: 'Arial', italic: true }
  sheet.getCell('B1').font = { name: 'Arial', italic: true }
  const pkg = new OfficePackage(new Uint8Array(await workbook.xlsx.writeBuffer()))
  editXlsxObject(pkg, { format: 'xlsx', target: { sheet: '账本', cell: 'A1' }, style: {
    numberFormat: '0.00', alignment: '<alignment horizontal="right" wrapText="1"/>',
    font: '<font><b/></font>', border: '<border><bottom style="thin"><color rgb="FF008800"/></bottom></border>',
  } })
  expect([...pkg.changed]).toEqual(['xl/styles.xml', 'xl/worksheets/sheet1.xml'])
  const output = pkg.save(), result = new Workbook()
  await result.xlsx.load(Uint8Array.from(output).buffer)
  const edited = result.getWorksheet('账本')!.getCell('A1'), sibling = result.getWorksheet('账本')!.getCell('B1')
  expect(edited.value).toEqual({ formula: '1+2', result: 3 })
  expect(edited.font).toMatchObject({ name: 'Arial', italic: true, bold: true })
  expect(edited.alignment).toMatchObject({ horizontal: 'right', wrapText: true })
  expect(edited.border.bottom).toMatchObject({ style: 'thin', color: { argb: 'FF008800' } })
  expect(edited.numFmt).toBe('0.00')
  expect(sibling.font).toEqual({ name: 'Arial', italic: true })
  expect(sibling.numFmt).toBeUndefined()
  expect(inspectXlsx(new OfficePackage(output)).sheets[0]!.cells).toEqual([
    { cell: 'A1', formula: '1+2', value: 3, numberFormat: '0.00', display: '3.00' },
    { cell: 'B1', value: 4 },
  ])
})

it('styles an empty Excel cell and rejects an imported relationship in a style fragment', async () => {
  const bytes = await createXlsx({ format: 'xlsx', operation: 'create', sheets: [{ name: '表', rows: [[1]] }] })
  const pkg = new OfficePackage(bytes)
  expect(() => editXlsxObject(pkg, { format: 'xlsx', target: { sheet: '表', cell: 'C3' }, style: {
    alignment: '<alignment xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>',
  } })).toThrow(/不支持 alignment 的属性/)
  editXlsxObject(pkg, { format: 'xlsx', target: { sheet: '表', cell: 'C3' }, style: { numberFormat: '0%' } })
  const inspect = inspectXlsx(new OfficePackage(pkg.save()))
  expect(inspect.sheets[0]!.cells).toContainEqual({ cell: 'C3', value: null, numberFormat: '0%' })
})
