import { describe, expect, it } from 'vitest'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'

describe('Excel ROUND calculation across a saved workbook', () => {
  it('rounds ties away from zero at decimal and integer positions', async () => {
    const formulas = ['ROUND(-1.5,0)', 'ROUND(1.5,0)', 'ROUND(-1.475,2)', 'ROUND(2.15,1)',
      'ROUND(-150,-2)', 'ROUND(150,-2)', 'ROUND(2.149,1)', 'ROUND(-50.55,-2)']
    const created = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [
      { name: 'Sheet1', rows: [formulas.map(formula => ({ formula }))] },
    ] })
    const original = Uint8Array.from(created.bytes)
    const edited = await applyOfficeContent(created.bytes, { format: 'xlsx', operation: 'edit', edits: [
      { sheet: 'Sheet1', cell: 'A2', value: 42 },
    ] })
    expect(created.bytes).toEqual(original)
    expect(edited.calculation?.status).toBe('complete')
    const reopened = inspectOfficeContent(edited.bytes, 'xlsx')
    if (reopened.format !== 'xlsx') throw new Error('Expected XLSX')
    expect(reopened.sheets[0].cells.filter(cell => cell.formula !== undefined).map(cell => cell.value))
      .toEqual([-2, 2, -1.48, 2.2, -200, 200, 2.1, -100])
  })
})
