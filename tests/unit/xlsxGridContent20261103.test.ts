import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { columnWidthCharacters, columnWidthPixels, inputValue, parseTsv, serializeTsv } from '../../src/renderer/documentFiles/office/xlsxGridModel'

describe('XLSX grid edits retain the original package and calculation owner', () => {
  it('splits a column range and keeps its style, formula cache, and opaque parts', async () => {
    const initial = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: '预算', rows: [[3, { formula: 'A1*2' }]], columnWidths: [12, 12, 12] }, { name: '保留', rows: [['untouched']] }] })
    const parts = unzipSync(initial.bytes), sheet = 'xl/worksheets/sheet1.xml'
    parts[sheet] = strToU8(strFromU8(parts[sheet]).replace(/<cols>[\s\S]*?<\/cols>/, '<cols><col min="1" max="3" width="12" customWidth="1" style="0" outlineLevel="1" bestFit="1"/></cols>'))
    parts['customXml/opaque.bin'] = Uint8Array.of(0, 47, 255, 11)
    const edited = await applyOfficeContent(zipSync(parts), { format: 'xlsx', operation: 'edit', edits: [{ type: 'columnWidth', sheet: '预算', column: 2, width: 24.5 }] })
    const after = unzipSync(edited.bytes), xml = strFromU8(after[sheet]), inspection = inspectOfficeContent(edited.bytes, 'xlsx')
    expect(inspection.format).toBe('xlsx')
    if (inspection.format !== 'xlsx') throw new Error('Expected XLSX')
    expect(inspection.sheets[0].columnWidths).toEqual([{ min: 1, max: 1, width: 12 }, { min: 2, max: 2, width: 24.5 }, { min: 3, max: 3, width: 12 }])
    expect(xml).toMatch(/<col[^>]*min="2"[^>]*max="2"[^>]*width="24.5"[^>]*style="0"[^>]*outlineLevel="1"/)
    expect(xml.match(/<col\s[^>]*min="2"[^>]*>/)?.[0]).not.toContain('bestFit')
    expect(after['xl/worksheets/sheet2.xml']).toEqual(parts['xl/worksheets/sheet2.xml'])
    expect(after['customXml/opaque.bin']).toEqual(parts['customXml/opaque.bin'])
    expect(inspection.sheets[0].cells.find(cell => cell.cell === 'B1')).toMatchObject({ formula: 'A1*2', value: 6 })
    expect(edited.calculation).toBeUndefined()
    expect(edited.changedParts).toEqual([sheet])
  })

  it('reports merged ranges and preserves the non-anchor write guard', async () => {
    const initial = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: 'Data', rows: [['merged']] }] })
    const parts = unzipSync(initial.bytes), sheet = 'xl/worksheets/sheet1.xml'
    parts[sheet] = strToU8(strFromU8(parts[sheet]).replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>'))
    const bytes = zipSync(parts), inspection = inspectOfficeContent(bytes, 'xlsx')
    expect(inspection.format === 'xlsx' && inspection.sheets[0].mergedRanges).toEqual(['A1:B2'])
    await expect(applyOfficeContent(bytes, { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Data', cell: 'B2', value: 'bad' }] })).rejects.toThrow('合并单元格')
  })

  it('preserves unsupported formulas without claiming a completed recalculation', async () => {
    const initial = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: 'Data', rows: [[1, { formula: 'XLOOKUP(A1,A1:A2,A1:A2)' }]] }] })
    const edited = await applyOfficeContent(initial.bytes, { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Data', cell: 'A1', value: 2 }] })
    const inspection = inspectOfficeContent(edited.bytes, 'xlsx')
    expect(edited.calculation?.status).toBe('partial')
    expect(inspection.format === 'xlsx' && inspection.sheets[0].cells.find(cell => cell.cell === 'B1')).toMatchObject({ formula: 'XLOOKUP(A1,A1:A2,A1:A2)', value: null })
  })

  it('roundtrips quoted spreadsheet clipboard fields and leading-zero identifiers', () => {
    const rows = [['项目\t一', 'line 1\nline 2', 'say "yes"'], ['00123', '=A1*2', '']]
    expect(parseTsv(serializeTsv(rows) + '\r\n')).toEqual(rows)
    expect(parseTsv('"unclosed\t2')).toEqual([['"unclosed', '2']])
    expect(inputValue('00123')).toBe('00123')
    expect(inputValue('=A1*2')).toEqual({ formula: 'A1*2' })
    expect(columnWidthPixels(columnWidthCharacters(175))).toBe(175)
  })
})
