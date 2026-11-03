import { describe, expect, it } from 'vitest'
import { strToU8, zipSync, unzipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { children, descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'

const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'
const formulaCell = (ref: string, formula: string, cached: number) => '<c r="' + ref + '"><f>' + formula + '</f><v>' + cached + '</v></c>'
function workbook(summary: string, names = ['Jan', 'Feb', 'Mar', 'Total']): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {
    '_rels/.rels': '<Relationships xmlns="' + NS.relationship + '"><Relationship Id="rId1" Type="' + NS.officeRelationship + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    '[Content_Types].xml': '<Types xmlns="' + contentTypes + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      names.map((_, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + NS.relationship + '">' +
      names.map((_, index) => '<Relationship Id="rId' + (index + 1) + '" Type="' + NS.officeRelationship + '/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>').join('') +
      '<Relationship Id="rIdCalc" Type="' + NS.officeRelationship + '/calcChain" Target="calcChain.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="' + NS.sheet + '" xmlns:r="' + NS.officeRelationship + '"><sheets>' +
      names.map((name, index) => '<sheet name="' + name + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join('') +
      '</sheets><calcPr calcId="124519" calcMode="auto" fullCalcOnLoad="0"/></workbook>',
    'xl/calcChain.xml': '<calcChain xmlns="' + NS.sheet + '">' +
      [...summary.matchAll(/<c r="([^"]+)"><f>/g)].map(match => '<c r="' + match[1] + '" i="4"/>').join('') + '</calcChain>',
    'customXml/opaque.bin': Uint8Array.of(0, 255, 23, 11),
  }
  for (let index = 0; index < names.length; index++) parts['xl/worksheets/sheet' + (index + 1) + '.xml'] =
    '<worksheet xmlns="' + NS.sheet + '"><dimension ref="A1:C1"/><sheetData><row r="1">' +
    (index === 3 ? summary : '<c r="A1"><v>' + (index + 1) * 10 + '</v></c>') + '</row></sheetData></worksheet>'
  return zipSync(Object.fromEntries(Object.entries(parts).map(([part, value]) => [part, typeof value === 'string' ? strToU8(value) : value])))
}

describe('Excel structural operations preserve formula meaning and invalidate stale dependent caches', () => {
  it.each([
    { label: 'middle worksheet leaving the 3-D range', sheet: 'Feb', index: 3, formula: 'SUM(Jan:Mar!A1)' },
    { label: 'first endpoint crossing the last endpoint', sheet: 'Jan', index: 3, formula: "SUM('Jan:Mar'!A1)" },
    { label: 'last endpoint crossing the first endpoint', sheet: 'Mar', index: 0, formula: 'SUM(Jan:Mar!A1)' },
    { label: 'unquoted Chinese 3-D worksheet names', sheet: '二月', index: 3, formula: 'SUM(一月:三月!A1)', names: ['一月', '二月', '三月', '合计'] },
  ])('refuses $label before publishing changed bytes', async ({ sheet, index, formula, names }) => {
    const source = workbook(formulaCell('A1', formula, 60), names), original = Uint8Array.from(source)
    await expect(applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ type: 'sheetMove', sheet, index }] })).rejects.toThrow('引用')
    expect(source).toEqual(original)
  })

  it.each([
    { label: 'adding a worksheet changes SHEETS', edit: { type: 'sheetAdd', name: 'New' } as const,
      summary: formulaCell('A1', 'SHEETS()', 4) + formulaCell('B1', 'A1+1', 5) },
    { label: 'deleting a worksheet changes SHEETS', edit: { type: 'sheetDelete', sheet: 'Feb' } as const,
      summary: formulaCell('A1', 'SHEETS()', 4) + formulaCell('B1', 'A1+1', 5) },
    { label: 'moving a worksheet changes SHEET', edit: { type: 'sheetMove', sheet: 'Feb', index: 3 } as const,
      summary: formulaCell('A1', 'SHEET()', 4) + formulaCell('B1', 'A1+1', 5) },
    { label: 'renaming leaves a dynamic INDIRECT string unresolved', edit: { type: 'sheetRename', sheet: 'Feb', name: 'Renamed' } as const,
      summary: '<c r="A1" t="inlineStr"><is><t>Feb!A1</t></is></c>' + formulaCell('B1', 'INDIRECT(A1)', 20) + formulaCell('C1', 'B1+1', 21) },
  ])('reports partial and clears the entire formula chain when $label', async ({ edit, summary }) => {
    const source = workbook(summary), before = unzipSync(source)
    const original = inspectOfficeContent(source, 'xlsx')
    if (original.format !== 'xlsx') throw new Error('Expected XLSX')
    const formulas = original.sheets.find(sheet => sheet.name === 'Total')!.cells.filter(cell => cell.formula !== undefined)
    const result = await applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [edit] })
    expect(result.calculation).toEqual({ engine: 'xlsx-calc', status: 'partial', values: [] })
    expect(result.diagnostics.map(value => value.code)).toEqual(['formula-not-supported', 'formula-caches-cleared'])
    const inspection = inspectOfficeContent(result.bytes, 'xlsx')
    if (inspection.format !== 'xlsx') throw new Error('Expected XLSX')
    expect(inspection.sheets.find(sheet => sheet.name === 'Total')!.cells.filter(cell => cell.formula !== undefined))
      .toEqual(formulas.map(cell => ({ ...cell, value: null })))
    const after = new OfficePackage(result.bytes), calc = children(after.xml(after.main()).documentElement, NS.sheet, 'calcPr')[0]
    expect(calc.getAttribute('calcMode')).toBe('auto')
    expect(calc.getAttribute('fullCalcOnLoad')).toBe('1')
    expect(calc.getAttribute('forceFullCalc')).toBe('1')
    expect(after.parts['xl/calcChain.xml']).toBeUndefined()
    expect(after.relationships(after.main()).has('rIdCalc')).toBe(false)
    expect(descendants(after.xml('[Content_Types].xml'), contentTypes, 'Override').some(node => node.getAttribute('PartName') === '/xl/calcChain.xml')).toBe(false)
    expect(after.parts['customXml/opaque.bin']).toEqual(before['customXml/opaque.bin'])
    expect(after.parts['xl/worksheets/sheet1.xml']).toEqual(before['xl/worksheets/sheet1.xml'])
    expect(after.parts['xl/worksheets/sheet3.xml']).toEqual(before['xl/worksheets/sheet3.xml'])
  })

  it('allows named-sheet references during ordinary moves and computes through the existing provider', async () => {
    const source = workbook(formulaCell('A1', 'SUM(Jan!A1,Mar!A1)', 40) + formulaCell('B1', 'A1*2', 80))
    const result = await applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ type: 'sheetMove', sheet: 'Feb', index: 3 }] })
    expect(result.calculation?.status).toBe('complete')
    expect(result.diagnostics).toEqual([])
    const inspection = inspectOfficeContent(result.bytes, 'xlsx')
    if (inspection.format !== 'xlsx') throw new Error('Expected XLSX')
    expect(inspection.sheets.map(sheet => sheet.name)).toEqual(['Jan', 'Mar', 'Total', 'Feb'])
    expect(inspection.sheets.find(sheet => sheet.name === 'Total')!.cells).toEqual([
      { cell: 'A1', value: 40, formula: 'SUM(Jan!A1,Mar!A1)' },
      { cell: 'B1', value: 80, formula: 'A1*2' },
    ])
  })

  it('keeps width-only edits outside calculation, including original 3-D caches and calcChain', async () => {
    const source = workbook(formulaCell('A1', 'SUM(Jan:Mar!A1)', 60)), before = unzipSync(source)
    const result = await applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [{ type: 'columnWidth', sheet: 'Feb', column: 1, width: 22 }] })
    expect(result.calculation).toBeUndefined()
    expect(result.diagnostics).toEqual([])
    expect(result.changedParts).toEqual(['xl/worksheets/sheet2.xml'])
    const after = unzipSync(result.bytes)
    for (const part of ['xl/workbook.xml', 'xl/calcChain.xml', 'xl/worksheets/sheet4.xml', 'customXml/opaque.bin']) expect(after[part]).toEqual(before[part])
    expect(inspectOfficeContent(result.bytes, 'xlsx')).toMatchObject({ sheets: expect.arrayContaining([
      expect.objectContaining({ name: 'Total', cells: [{ cell: 'A1', value: 60, formula: 'SUM(Jan:Mar!A1)' }] }),
    ]) })
  })

  it.each([
    { type: 'sheetRename', sheet: 'Feb', name: 'Renamed' } as const,
    { type: 'sheetDelete', sheet: 'Feb' } as const,
  ])('retains the existing 3-D protection for $type', async edit => {
    const source = workbook(formulaCell('A1', 'SUM(Jan:Mar!A1)', 60)), original = Uint8Array.from(source)
    await expect(applyOfficeContent(source, { format: 'xlsx', operation: 'edit', edits: [edit] })).rejects.toThrow('引用')
    expect(source).toEqual(original)
  })
})
