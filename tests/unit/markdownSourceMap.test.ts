import { describe, expect, it } from 'vitest'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { mapDocumentSelectionToSource } from '../../src/shared/document/markdownSourceMap'
import type { DocumentSlot } from '../../src/shared/document/ports'

function map(source: string, blockIndex: number, from: number, to: number, slot?: DocumentSlot) {
  let id = 0
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: kind => `${kind}-${++id}` })
  expect(parsed.status).toBe('valid')
  if (parsed.status !== 'valid') throw new Error('invalid fixture')
  const block = parsed.document.content.blocks[blockIndex]!
  slot ??= block.type === 'list' ? { kind: 'item', itemId: block.items[0]!.id } : block.type === 'table' ? { kind: 'cell', rowId: block.rows[0]!.id, columnId: block.columns[1]!.id } : { kind: 'field', field: 'content' }
  return mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: source,
    anchor: { blockId: block.id, slot, offset: from, affinity: 'after' }, head: { blockId: block.id, slot, offset: to, affinity: 'before' } })
}
describe('parser source spans', () => {
  it.each([
    ['相同内容\n\n相同内容\n', 1, 0, 2, ['相同']],
    ['# 标题 **加粗** 和 [链接](https://example.com)\n', 0, 3, 5, ['加粗']],
    ['# 标题 **加粗** 和 [链接](https://example.com)\n', 0, 8, 10, ['链接']],
    ['中文😀&amp;\\*后\r\n', 0, 2, 5, ['😀&amp;\\*']],
    ['- **重复**文字\n- 重复文字\n', 0, 0, 2, ['重复']],
    ['| 一 | 二 |\n| --- | --- |\n| 内容 | **内容** |\n', 0, 0, 2, ['内容']],
    ['甲 $x^2$ 乙\n', 0, 2, 3, ['$x^2$']],
    ['甲 `a*b` 乙\n', 0, 2, 5, ['a*b']],
    ['> 引用中文\r\n> 下一行\r\n', 0, 0, 2, ['引用']],
  ] as const)('maps %s without expanding the selected content', (source, block, from, to, expected) => {
    const result = map(source, block, from, to)
    expect(result.status).toBe('mapped')
    if (result.status === 'mapped') expect(result.ranges.map(r => r.before)).toEqual(expected)
  })
  it('repeated text resolves to the second structural block, not the first occurrence', () => {
    expect(map('重复\n\n重复\n', 1, 0, 2)).toEqual({ status: 'mapped', ranges: [{ from: 4, to: 6, before: '重复' }] })
  })
  it('preserves markup delimiters when a selection spans styled text', () => {
    expect(map('甲**乙**丙\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 1, before: '甲' }, { from: 3, to: 4, before: '乙' }, { from: 6, to: 7, before: '丙' }] })
  })
  it('rejects an out-of-range logical position instead of returning the whole file', () => { expect(map('正文\n', 0, 0, 100).status).toBe('unmapped') })
  it('consumes metadata before mapping identical visible text without a trailing newline', () => {
    const source = '<!--cw:block {"id":"hello"}-->\nhello'
    expect(map(source, 0, 0, 5)).toEqual({ status: 'mapped', ranges: [{ from: source.length - 5, to: source.length, before: 'hello' }] })
  })
  it('whole-object selection owns its metadata as well as its body', () => {
    const source = '<!--cw:block {"id":"rule"}-->\n---\n\nnext'
    const parsed = parseDocumentMarkdown(source, { createId: kind => kind, target: 'file' })
    if (parsed.status !== 'valid') throw new Error('invalid fixture')
    const result = mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'object', revision: source, blockId: 'rule' })
    expect(result).toEqual({ status: 'mapped', ranges: [{ from: 0, to: source.length - 6, before: '<!--cw:block {"id":"rule"}-->\n---' }] })
  })
  it('does not enlarge a partial selection of a multi-character entity', () => {
    expect(map('A &fjlig; Z', 0, 2, 3).status).toBe('unmapped')
    expect(map('A &fjlig; Z', 0, 2, 4)).toMatchObject({ status: 'mapped', ranges: [{ before: '&fjlig;' }] })
  })
  it('maps reversed rectangular cell selection without including adjacent cells or table delimiters', () => {
    const source = '| A | B | C |\n| --- | --- | --- |\n| 甲 | **乙** | 丙 |\n| 丁 | 戊 | 己 |\n'
    let id = 0
    const parsed = parseDocumentMarkdown(source, { createId: () => String(++id), target: 'file' })
    if (parsed.status !== 'valid') throw new Error('invalid fixture')
    const table = parsed.document.content.blocks[0]!
    if (table.type !== 'table') throw new Error('expected table')
    const result = mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'cells', revision: source, tableId: table.id,
      anchor: { rowId: table.rows[1]!.id, columnId: table.columns[1]!.id }, head: { rowId: table.rows[0]!.id, columnId: table.columns[0]!.id } })
    expect(result.status).toBe('mapped')
    if (result.status === 'mapped') expect(result.ranges.map(range => range.before)).toEqual(['甲', '乙', '丁', '戊'])
  })
  it('does not omit an object in the middle of a text selection', () => {
    let id = 0; const source = 'A\n\n---\n\nB'
    const parsed = parseDocumentMarkdown(source, { createId: () => String(++id), target: 'file' })
    if (parsed.status !== 'valid') throw new Error('invalid fixture')
    expect(mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: source,
      anchor: { blockId: parsed.document.content.blocks[0]!.id, slot: { kind: 'field', field: 'content' }, offset: 0, affinity: 'after' },
      head: { blockId: parsed.document.content.blocks[2]!.id, slot: { kind: 'field', field: 'content' }, offset: 1, affinity: 'before' },
    }).status).toBe('unmapped')
  })
})
