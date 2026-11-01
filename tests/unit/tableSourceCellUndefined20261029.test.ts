import { describe, expect, it } from 'vitest'
import { createTableData, parseTableData, toNativeTableData, type TableCell } from '../../src/components/table/data'

const rich = { inlines: [{ type: 'text' as const, text: '派生值' }] }
function envelope(value: Record<string, unknown>) {
  const data = createTableData({ rows: 1, columns: 1 })
  const base = data.rows[0]!.cells[0]!
  return { data: { ...data, rows: [{ ...data.rows[0]!, cells: [{ id: base.id, columnId: base.columnId, ...value }] }] }, base }
}

describe('Source table cells share the typed optional-content contract', () => {
  it('normalizes an explicitly undefined rich slot without mutating its caller', () => {
    const { data, base } = envelope({ text: '42', content: undefined })
    const source: TableCell = Object.freeze({ ...base, text: '42', content: undefined })
    data.rows[0]!.cells[0] = source
    const parsed = parseTableData(data), value = parsed.rows[0]!.cells[0]!
    expect(value).toEqual({ ...base, text: '42' })
    expect(Object.hasOwn(value, 'content')).toBe(false)
    expect(Object.hasOwn(source, 'content')).toBe(true)
    expect(toNativeTableData(parsed).rows[0]!.cells[0]!.text).toBe('42')
  })

  it('normalizes an explicitly undefined plain slot without losing rich content', () => {
    const { data, base } = envelope({ content: rich, text: undefined })
    const { text: _text, ...identity } = base
    const source: TableCell = Object.freeze({ ...identity, content: rich, text: undefined })
    data.rows[0]!.cells[0] = source
    const parsed = parseTableData(data), value = parsed.rows[0]!.cells[0]!
    expect(value).toEqual({ ...identity, content: rich })
    expect(Object.hasOwn(value, 'text')).toBe(false)
    expect(Object.hasOwn(source, 'text')).toBe(true)
    expect(toNativeTableData(parsed).rows[0]!.cells[0]!.text).toBe('派生值')
  })

  it.each([
    { text: '42', content: rich }, { text: '', content: rich },
    { text: '42', content: null }, { content: rich, text: null },
    { text: '42', unrelated: undefined }, { text: undefined, content: undefined }, {},
  ])('retains strict rejection for conflicting, missing or unknown content: %j', value => {
    expect(() => parseTableData(envelope(value).data)).toThrow()
  })
})
