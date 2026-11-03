import { describe, expect, it } from 'vitest'
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { children, descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'

const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'
function packageBytes(parts: Record<string, string | Uint8Array>) {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([path, content]) => [path, typeof content === 'string' ? strToU8(content) : content])))
}
function word() {
  return packageBytes({
    '_rels/.rels': `<Relationships xmlns="${NS.relationship}"><Relationship Id="rId1" Type="${NS.officeRelationship}/officeDocument" Target="word/document.xml"/></Relationships>`,
    '[Content_Types].xml': `<Types xmlns="${contentTypes}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    'word/document.xml': `<w:document xmlns:w="${NS.word}"><w:body><w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Alpha </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:color w:val="125499"/></w:rPr><w:t xml:space="preserve"> omega</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p><w:p><w:bookmarkStart w:id="1" w:name="retained"/><w:r><w:t>Protected bookmark</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
    'customXml/opaque.bin': new Uint8Array([0, 255, 17, 34, 91, 222]),
  })
}
function workbook(withReference = false) {
  return packageBytes({
    '_rels/.rels': `<Relationships xmlns="${NS.relationship}"><Relationship Id="rId1" Type="${NS.officeRelationship}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    '[Content_Types].xml': `<Types xmlns="${contentTypes}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${NS.relationship}"><Relationship Id="rId1" Type="${NS.officeRelationship}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS.officeRelationship}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${NS.sheet}" xmlns:r="${NS.officeRelationship}"><bookViews><workbookView activeTab="1" firstSheet="0"/></bookViews><sheets><sheet name="Data" sheetId="7" r:id="rId1"/><sheet name="Review" sheetId="12" r:id="rId2"/></sheets><definedNames><definedName name="LocalValue" localSheetId="1">$A$1</definedName></definedNames></workbook>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS.sheet}"><dimension ref="A1:B1"/><sheetData><row r="1"><c r="A1"><v>4</v></c><c r="B1"><f>A1*2</f><v>8</v></c></row></sheetData><extLst><ext uri="kept"><opaque xmlns="urn:guoling:test">retained</opaque></ext></extLst></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${NS.sheet}"><dimension ref="A1"/><sheetData><row r="1"><c r="A1">${withReference ? '<f>Data!A1</f>' : ''}<v>4</v></c></row></sheetData></worksheet>`,
    'customXml/opaque.bin': new Uint8Array([17, 18, 19, 255]),
  })
}

describe('Word / Excel original package editing', () => {
  it('edits only the changed Word run and preserves other run formatting and opaque parts', async () => {
    const source = word()
    const result = await applyOfficeContent(source, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'Alpha BOLD omega' }] })
    const pkg = new OfficePackage(result.bytes), paragraph = descendants(pkg.xml(pkg.main()), NS.word, 'p')[0]
    const runs = descendants(paragraph, NS.word, 'r')
    expect(runs.map(run => descendants(run, NS.word, 't')[0].textContent)).toEqual(['Alpha ', 'BOLD', ' omega'])
    expect(descendants(runs[0], NS.word, 'i')).toHaveLength(1)
    expect(descendants(runs[1], NS.word, 'b')).toHaveLength(1)
    expect(descendants(runs[2], NS.word, 'color')[0].getAttributeNS(NS.word, 'val')).toBe('125499')
    expect(pkg.parts['customXml/opaque.bin']).toEqual(unzipSync(source)['customXml/opaque.bin'])
    expect(result.changedParts).toEqual(['word/document.xml'])
  })

  it('adds real Word styles and paragraphs while preserving section properties and protected structures', async () => {
    const source = word()
    const first = await applyOfficeContent(source, { format: 'docx', operation: 'edit', edits: [
      { type: 'paragraphStyle', index: 0, style: { heading: 'Heading1', bold: true, alignment: 'center' } },
      { type: 'insertParagraph', after: 0, text: 'New paragraph' },
    ] })
    const pkg = new OfficePackage(first.bytes), inspection = inspectOfficeContent(first.bytes, 'docx')
    expect(inspection.format).toBe('docx')
    if (inspection.format !== 'docx') throw new Error('wrong format')
    expect(inspection.paragraphs[0].style).toMatchObject({ heading: 'Heading1', bold: true, alignment: 'center' })
    expect(inspection.paragraphs[1].text).toBe('New paragraph')
    expect(pkg.parts['word/styles.xml']).toBeDefined()
    expect(descendants(pkg.xml('word/styles.xml'), NS.word, 'style').map(node => node.getAttributeNS(NS.word, 'styleId'))).toEqual(['Normal', 'Heading1'])
    expect(pkg.relationships('word/document.xml').size).toBe(1)
    expect(descendants(pkg.xml(pkg.main()), NS.word, 'sectPr')).toHaveLength(1)
    const second = await applyOfficeContent(first.bytes, { format: 'docx', operation: 'edit', edits: [{ type: 'deleteParagraph', index: 1 }] })
    expect(inspectOfficeContent(second.bytes, 'docx')).toMatchObject({ paragraphs: [{ text: 'Alpha bold omega' }, { text: 'Second paragraph' }, { text: 'Protected bookmark' }] })
    await expect(applyOfficeContent(second.bytes, { format: 'docx', operation: 'edit', edits: [{ type: 'deleteParagraph', index: 2 }] })).rejects.toThrow('范围标记')
  })

  it('patches Excel values/formulas and adds, reorders, renames and deletes independent sheets', async () => {
    const source = workbook()
    const result = await applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [
      { sheet: 'Data', cell: 'A1', value: 6 },
      { type: 'sheetAdd', name: 'New sheet' },
      { sheet: 'New sheet', cell: 'A1', value: 42 },
      { type: 'sheetRename', sheet: 'New sheet', name: 'Result' },
      { type: 'sheetMove', sheet: 'Result', index: 0 },
    ] })
    const inspection = inspectOfficeContent(result.bytes, 'xlsx')
    if (inspection.format !== 'xlsx') throw new Error('wrong format')
    expect(inspection.sheets.map(sheet => sheet.name)).toEqual(['Result', 'Data', 'Review'])
    expect(inspection.sheets.map(sheet => sheet.sheetId)).toEqual(['13', '7', '12'])
    expect(inspection.sheets[1].cells.find(cell => cell.cell === 'B1')).toMatchObject({ formula: 'A1*2', value: 12 })
    const pkg = new OfficePackage(result.bytes), root = pkg.xml(pkg.main())
    expect(descendants(root, NS.sheet, 'definedName')[0].getAttribute('localSheetId')).toBe('2')
    expect(descendants(root, NS.sheet, 'workbookView')[0].getAttribute('activeTab')).toBe('2')
    expect(pkg.parts['customXml/opaque.bin']).toEqual(unzipSync(source)['customXml/opaque.bin'])
    expect(strFromU8(pkg.parts['xl/worksheets/sheet1.xml'])).toContain('urn:guoling:test')
    const deleted = await applyOfficeContent(result.bytes, { format: 'xlsx', operation: 'edit', edits: [{ type: 'sheetDelete', sheet: 'Result' }] })
    const after = new OfficePackage(deleted.bytes)
    expect(descendants(after.xml(after.main()), NS.sheet, 'definedName')[0].getAttribute('localSheetId')).toBe('1')
    expect(after.parts['xl/worksheets/sheet3.xml']).toBeUndefined()
    expect(after.relationships(after.main()).size).toBe(2)
    expect(children(after.xml('[Content_Types].xml').documentElement, contentTypes, 'Override').some(node => node.getAttribute('PartName') === '/xl/worksheets/sheet3.xml')).toBe(false)
  })

  it('rejects dependency-breaking sheet changes and invalid names without changing original bytes', async () => {
    const source = workbook(true), original = Uint8Array.from(source)
    await expect(applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ type: 'sheetRename', sheet: 'Data', name: 'Renamed' }] })).rejects.toThrow('引用')
    await expect(applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ type: 'sheetDelete', sheet: 'Data' }] })).rejects.toThrow('引用')
    await expect(applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ type: 'sheetAdd', name: 'data' }] })).rejects.toThrow('已存在')
    await expect(applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ type: 'sheetAdd', name: 'bad/name' }] })).rejects.toThrow('工作表名')
    expect(source).toEqual(original)
  })
})
