import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { applyOfficeObjectEdit } from '../../src/main/workbench/office/officeObjectCompiler'
import { OfficePackage } from '../../src/main/workbench/office/officePackage'
import { mergeOfficeContent } from '../../src/main/workbench/office/officeDraftMerge'

async function workbook(formula = 'A1*2') {
  return (await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [
    { name: 'Sheet1', rows: [[2, { formula }]] },
  ] })).bytes
}
function cells(bytes: Uint8Array) {
  const result = inspectOfficeContent(bytes, 'xlsx')
  if (result.format !== 'xlsx') throw new Error('Expected XLSX')
  return result.sheets[0].cells
}
describe('Excel native edits maintain formula caches', () => {
  it('recalculates a dependent formula after an object value edit and reopening', async () => {
    const source = await workbook(), original = Uint8Array.from(source)
    const result = applyOfficeObjectEdit(source, { format: 'xlsx', target: { sheet: 'Sheet1', cell: 'A1' },
      native: { path: [], xml: '<c xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r="A1"><v>9</v></c>' } })
    expect(source).toEqual(original)
    expect(result.calculation?.status).toBe('complete')
    expect(cells(result.bytes)).toMatchObject([{ cell: 'A1', value: 9 }, { cell: 'B1', value: 18, formula: 'A1*2' }])
  })
  it('recalculates formula edits made through the versioned package part', async () => {
    const source = await workbook(), pkg = new OfficePackage(source), part = 'xl/worksheets/sheet1.xml'
    const result = applyOfficeObjectEdit(source, { format: 'xlsx', packagePart: { part, partVersion: pkg.partVersion(part) },
      native: { path: [{ name: 'sheetData', index: 0 }, { name: 'row', index: 0 }, { name: 'c', index: 1 }, { name: 'f', index: 0 }], xml: '<f>A1*3</f>' } })
    expect(result.calculation?.status).toBe('complete')
    expect(cells(result.bytes)).toMatchObject([{ cell: 'A1', value: 2 }, { cell: 'B1', value: 6, formula: 'A1*3' }])
  })
  it('leaves calculation and other worksheet parts untouched for a style-only native edit', async () => {
    const source = await workbook()
    const result = applyOfficeObjectEdit(source, { format: 'xlsx', target: { sheet: 'Sheet1', cell: 'A1' },
      native: { path: [], xml: '<c xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r="A1" s="0"><v>2</v></c>' } })
    expect(result.calculation).toBeUndefined()
    expect(result.changedParts).toEqual(['xl/worksheets/sheet1.xml'])
    expect(cells(result.bytes)).toMatchObject([{ cell: 'A1', value: 2 }, { cell: 'B1', value: 4, formula: 'A1*2' }])
  })
  it('reports partial and clears stale caches when the formula cannot be calculated', async () => {
    const source = await workbook('COUNTIF(A1:A2,1)')
    const result = applyOfficeObjectEdit(source, { format: 'xlsx', target: { sheet: 'Sheet1', cell: 'A1' },
      native: { path: [], xml: '<c xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r="A1"><v>9</v></c>' } })
    expect(result.calculation?.status).toBe('partial')
    expect(result.diagnostics.map(item => item.code)).toContain('formula-caches-cleared')
    expect(cells(result.bytes)[1]).toMatchObject({ cell: 'B1', value: null, formula: 'COUNTIF(A1:A2,1)' })
  })
  it('recalculates again after merging a concurrent unrelated edit', async () => {
    const source = await workbook()
    const request = { format: 'xlsx' as const, target: { sheet: 'Sheet1', cell: 'A1' },
      native: { path: [], xml: '<c xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r="A1"><v>9</v></c>' } }
    const proposed = applyOfficeObjectEdit(source, request)
    const latest = await applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Sheet1', cell: 'A2', value: 42 }] })
    const merged = mergeOfficeContent(source, proposed, latest.bytes, request)
    expect(merged.calculation?.status).toBe('complete')
    expect(cells(merged.bytes)).toMatchObject([{ cell: 'A1', value: 9 }, { cell: 'B1', value: 18 }, { cell: 'A2', value: 42 }])
  })
  it('invalidates formula caches when a linked table definition changes', async () => {
    const pkg = new OfficePackage(await workbook('SUM(Table1[Amount])'))
    const rels = 'xl/worksheets/_rels/sheet1.xml.rels', part = 'xl/tables/table1.xml'
    pkg.setBinary(rels, strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>'))
    pkg.setBinary(part, strToU8('<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" ref="A1:A2"/>'))
    const types = pkg.xml('[Content_Types].xml'), entry = types.createElementNS(types.documentElement.namespaceURI!, 'Override')
    entry.setAttribute('PartName', '/' + part); entry.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml')
    types.documentElement.appendChild(entry); pkg.write('[Content_Types].xml')
    const source = pkg.save(), snapshot = new OfficePackage(source)
    const result = applyOfficeObjectEdit(source, { format: 'xlsx', packagePart: { part, partVersion: snapshot.partVersion(part) },
      native: { path: [], xml: '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" ref="A1:A3"/>' } })
    expect(result.calculation?.status).toBe('partial')
    expect(result.diagnostics.map(item => item.code)).toContain('formula-caches-cleared')
  })
})
