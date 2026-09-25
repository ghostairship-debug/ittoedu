import { describe, expect, it } from 'vitest'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { mapDocumentSelectionToSource } from '../../src/shared/document/markdownSourceMap'
import type { DocumentPoint, DocumentSlot } from '../../src/shared/document/ports'

const unmapped = { status: 'unmapped', message: '此选区暂时无法精确对应源文，请在源文模式选择要修改的内容。' } as const
function fixture(source: string) {
  let id = 0
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: kind => `${kind}-${++id}` })
  if (parsed.status !== 'valid') throw new Error(`invalid fixture: ${JSON.stringify(parsed.diagnostics)}`)
  return parsed
}
function select(source: string, anchor: DocumentPoint, head: DocumentPoint) {
  return mapDocumentSelectionToSource(source, fixture(source).sourceMap, { kind: 'text', revision: source, anchor, head })
}
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

// The logical text joins two quoted lines with one space, but the source between them is
// "\n> ". A range covering that break would leave the marker behind as visible body text.
describe('quote soft line breaks', () => {
  it('maps quoted lines separately while preserving their structural line breaks and prefixes', () => {
    for (const source of ['> 引用中文\n> 下一行\n', '> 引用中文\r\n> 下一行\r\n']) {
      const result = map(source, 0, 0, 8)
      expect(result.status).toBe('mapped')
      if (result.status === 'mapped') {
        expect(result.ranges.map(range => range.before)).toEqual(['引用中文', '下一行'])
        const changed = result.ranges.reduceRight((text, range) => text.slice(0, range.from) + '新内容' + text.slice(range.to), source)
        expect(changed).toBe(source.replace('引用中文', '新内容').replace('下一行', '新内容'))
      }
    }
  })
  it('still maps a quote selection inside one line, on either side of the break', () => {
    expect(map('> 引用中文\n> 下一行\n', 0, 0, 4)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 6, before: '引用中文' }] })
    expect(map('> 引用中文\r\n> 下一行\r\n', 0, 0, 4)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 6, before: '引用中文' }] })
    expect(map('> 引用中文\n> 下一行\n', 0, 5, 8)).toEqual({ status: 'mapped', ranges: [{ from: 9, to: 12, before: '下一行' }] })
    expect(map('> 引用中文\r\n> 下一行\r\n', 0, 5, 8)).toEqual({ status: 'mapped', ranges: [{ from: 10, to: 13, before: '下一行' }] })
  })
  it('keeps a quote whose continuation line carries no marker mapped', () => {
    expect(map('> 甲\n乙\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 5, before: '甲\n乙' }] })
  })
  it('never returns a range that would turn a quote marker into body text', () => {
    const source = '> 引用中文\r\n> 下一行\r\n'
    for (let from = 0; from <= 8; from++) for (let to = from; to <= 8; to++) {
      const result = map(source, 0, from, to)
      if (result.status !== 'mapped') continue
      for (const range of result.ranges) expect(source.slice(range.from, range.to)).not.toMatch(/(^|\n) {0,3}>/)
    }
  })
})

// A slot with no units is text this map cannot locate; skipping it would return ranges that
// leave the teacher's own words outside the edit the model is allowed to make.
describe('list slot coverage', () => {
  const items = (source: string) => {
    const list = fixture(source).document.content.blocks[0]!
    if (list.type !== 'list') throw new Error('expected list')
    return { list, ids: list.items.map(item => item.id) }
  }
  const point = (blockId: string, itemId: string, offset: number): DocumentPoint => ({ blockId, slot: { kind: 'item', itemId }, offset, affinity: 'after' })
  it('refuses an actually unmapped middle slot and includes an escaped-bracket link when it is mapped', () => {
    const source = '- 甲\n- [\\[1\\]](https://e.com)\n- 丙\n'
    const parsed = fixture(source), { list, ids } = items(source)
    const selection = { kind: 'text' as const, revision: source, anchor: point(list.id, ids[0]!, 0), head: point(list.id, ids[2]!, 1) }
    const complete = mapDocumentSelectionToSource(source, parsed.sourceMap, selection)
    expect(complete.status).toBe('mapped')
    if (complete.status === 'mapped') expect(complete.ranges.map(range => range.before)).toEqual(['甲', '\\[1\\]', '丙'])
    parsed.sourceMap.blocks[0].slots.splice(1, 1)
    expect(mapDocumentSelectionToSource(source, parsed.sourceMap, selection)).toEqual(unmapped)
    expect(mapDocumentSelectionToSource(source, parsed.sourceMap, { ...selection, anchor: selection.head, head: selection.anchor })).toEqual(unmapped)
  })
  it('refuses a tab-indented item instead of guessing its offsets', () => {
    // marked expands a tab after the marker, which shifts every following offset; the item
    // is dropped rather than mapped from a source span that would be off by one.
    const source = '- 甲\n- \t乙\n- 丙\n'
    const { list, ids } = items(source)
    expect(fixture(source).sourceMap.blocks[0]!.slots.map(slot => slot.key)).toEqual([`item:${ids[0]}`, `item:${ids[2]}`])
    expect(select(source, point(list.id, ids[0]!, 0), point(list.id, ids[2]!, 1))).toEqual(unmapped)
  })
  it('maps a selection across items that all have a source map', () => {
    const source = '- 甲\n- 乙\n- 丙\n'
    const { list, ids } = items(source)
    const expected = { status: 'mapped', ranges: [{ from: 2, to: 3, before: '甲' }, { from: 6, to: 7, before: '乙' }, { from: 10, to: 11, before: '丙' }] }
    expect(select(source, point(list.id, ids[0]!, 0), point(list.id, ids[2]!, 1))).toEqual(expected)
    expect(select(source, point(list.id, ids[2]!, 1), point(list.id, ids[0]!, 0))).toEqual(expected)
  })
})

// marked emits a bare URL or a `www` autolink as a link whose raw equals its own visible
// text, so re-lexing that text repeats itself; the URL is mapped from its source characters.
describe('links without markup', () => {
  it('maps a bare URL instead of dropping its whole slot', () => {
    expect(map('见 https://e.com 好\n', 0, 2, 15)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 15, before: 'https://e.com' }] })
    expect(map('见 https://e.com 好\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 3, before: '见 h' }] })
    expect(map('见 www.e.com 好\n', 0, 2, 11)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 11, before: 'www.e.com' }] })
    expect(map('见 <https://e.com> 好\n', 0, 2, 15)).toEqual({ status: 'mapped', ranges: [{ from: 3, to: 16, before: 'https://e.com' }] })
  })
  it('maps a bare URL inside a heading, a quote, a list item and a table cell', () => {
    expect(map('# 见 https://e.com\n', 0, 2, 15)).toEqual({ status: 'mapped', ranges: [{ from: 4, to: 17, before: 'https://e.com' }] })
    expect(map('> 见 https://e.com\n', 0, 2, 15)).toEqual({ status: 'mapped', ranges: [{ from: 4, to: 17, before: 'https://e.com' }] })
    expect(map('- 见 https://e.com\n', 0, 2, 15)).toEqual({ status: 'mapped', ranges: [{ from: 4, to: 17, before: 'https://e.com' }] })
    const source = '| 甲 | 乙 |\n| --- | --- |\n| 见 https://e.com | 丙 |\n'
    const table = fixture(source).document.content.blocks[0]!
    if (table.type !== 'table') throw new Error('expected table')
    expect(map(source, 0, 2, 15, { kind: 'cell', rowId: table.rows[0]!.id, columnId: table.columns[0]!.id }))
      .toEqual({ status: 'mapped', ranges: [{ from: 28, to: 41, before: 'https://e.com' }] })
  })
  it('maps the visible text of a link that contains markup or another URL', () => {
    expect(map('见 [见 https://e.com](https://x.com) 好\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 2, before: '见 ' }, { from: 3, to: 4, before: '见' }] })
    expect(map('见 [**粗**](https://e.com) 好\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 2, before: '见 ' }, { from: 5, to: 6, before: '粗' }] })
  })
  it('maps escaped link labels from their raw brackets instead of decoded child tokens', () => {
    expect(map('见 [\\[1\\]](https://e.com) 好\n', 0, 0, 3)).toMatchObject({ status: 'mapped', ranges: [{ before: '见 ' }, { before: '\\[' }] })
  })
})

// The body used to be trimmed before mapping, which removed the spaces the document model
// keeps, so these slots had no map at all even though the source carries their text verbatim.
describe('block bodies keep their own whitespace', () => {
  it('maps both lines of an indented list item without granting its newline or indentation', () => {
    for (const source of ['- 甲\n  乙\n- 丙\n', '- 甲\r\n  乙\r\n- 丙\r\n']) {
      expect(map(source, 0, 0, 3)).toMatchObject({ status: 'mapped', ranges: [{ before: '甲' }, { before: '乙' }] })
    }
    expect(map('- 甲\n  乙\n- 丙\n', 0, 2, 3)).toEqual({ status: 'mapped', ranges: [{ from: 6, to: 7, before: '乙' }] })
  })
  it('gaps between ranges contain only the retained structural newline and indentation', () => {
    // 与实现无关的不变量：区间之间只要还剩没被覆盖的源文字，改写相邻区间就会把那段文字
    // 留成可见正文。穷举每个选区的目的不是覆盖实现，而是保证拒绝一切不算通过。
    const sources = ['- 甲\n  乙\n- 丙\n', '- 甲\r\n  乙\r\n- 丙\r\n', '- 甲\n    乙\n', '- 甲\n  \n  乙\n',
      '- 甲\n 乙\n- 丙\n', '- 甲\n乙\n- 丙\n', '- 甲\n\n- 乙\n', '- 甲  \n  乙\n']
    let mapped = 0
    for (const source of sources) {
      for (let from = 0; from <= 10; from++) for (let to = from; to <= 10; to++) {
        const result = map(source, 0, from, to)
        if (result.status !== 'mapped') continue
        mapped++
        const holes = result.ranges.slice(1).filter((range, index) => range.from > result.ranges[index]!.to)
        for (const range of holes) { const previous = result.ranges[result.ranges.indexOf(range) - 1]; expect(source.slice(previous.to, range.from)).toMatch(/^[ \t]*(?:\r?\n[ \t]*)+$/) }
      }
    }
    expect(mapped).toBeGreaterThan(0)
  })
  it('keeps the leading space that a lazy continuation line contributes', () => {
    expect(map('- 甲\n 乙\n- 丙\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 5, before: '甲\n ' }] })
    expect(map('- 甲\n乙\n- 丙\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 5, before: '甲\n乙' }] })
  })
  it('maps a block whose text starts or ends with a space', () => {
    expect(map('  甲\n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 3, before: '  甲' }] })
    expect(map('甲  \n', 0, 0, 3)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 3, before: '甲  ' }] })
    expect(map('甲 \n', 0, 0, 2)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 2, before: '甲 ' }] })
    expect(map('  甲  \n', 0, 0, 4)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 4, before: '  甲 ' }] })
    expect(map('  甲  \n', 0, 2, 4)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 4, before: '甲 ' }] })
  })
  it('maps a setext heading body without swallowing its underline', () => {
    expect(map('标题\n===\n', 0, 0, 2)).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 2, before: '标题' }] })
  })
  // marked leaves a different number of trailing newlines in each token's raw: a paragraph keeps
  // the one ending its last line, but a heading followed by a blank line keeps that blank line too
  // (`"# a\n\n"`). Dropping only one of them left a phantom space unit, so the unit text disagreed
  // with the parsed text and the slot was dropped as unlocatable — every heading with content
  // after it failed closed, while a heading that was the whole document still mapped.
  it('maps a heading that is followed by other blocks', () => {
    expect(map('# a\n\n段落\n', 0, 0, 1)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 3, before: 'a' }] })
    expect(map('# 标题\n\n正文\n', 0, 0, 2)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 4, before: '标题' }] })
    expect(map('段落\n\n# a\n\n段落\n', 1, 0, 1)).toEqual({ status: 'mapped', ranges: [{ from: 6, to: 7, before: 'a' }] })
    expect(map('# a\n\n# b\n', 0, 0, 1)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 3, before: 'a' }] })
    expect(map('# a\n\n- x\n  y\n', 0, 0, 1)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 3, before: 'a' }] })
  })
  it('maps a heading that is followed by several blank lines', () => {
    expect(map('# a\n\n\n段落\n', 0, 0, 1)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 3, before: 'a' }] })
  })
  it('keeps an item text that ends with the newline marked leaves in a loose item', () => {
    expect(map('- 甲\n\n- 乙\n', 0, 0, 2)).toEqual({ status: 'mapped', ranges: [{ from: 2, to: 4, before: '甲\n' }] })
  })
})

// Known fail-closed gap: marked unescapes "\|" inside a table cell before lexing it, so the
// cell's code span no longer matches the source; the cell is dropped, never guessed.
describe('table cell escapes', () => {
  it('maps the exact escaped pipe span in a code cell', () => {
    const source = '| 甲 | 乙 |\n| --- | --- |\n| `a\\|b` | 丙 |\n'
    const table = fixture(source).document.content.blocks[0]!
    if (table.type !== 'table') throw new Error('expected table')
    expect(map(source, 0, 0, 3, { kind: 'cell', rowId: table.rows[0]!.id, columnId: table.columns[0]!.id })).toMatchObject({ status: 'mapped', ranges: [{ before: 'a\\|b' }] })
    expect(map(source, 0, 0, 1, { kind: 'cell', rowId: table.rows[0]!.id, columnId: table.columns[1]!.id }))
      .toEqual({ status: 'mapped', ranges: [{ from: 35, to: 36, before: '丙' }] })
  })
})
