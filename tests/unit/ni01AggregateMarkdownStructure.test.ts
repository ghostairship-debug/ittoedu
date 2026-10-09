import { expect, it } from 'vitest'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import { documentTextSlots, plainDocumentText } from '../../src/shared/document/content'
import { planAggregateMarkdownTextEdit, type AggregateMarkdownFragment } from '../../src/shared/document/aggregateTextEdit'
import { unitsToRanges } from '../../src/shared/document/markdownSourceMap'

function parse(source: string) {
  let serial = 0
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => `test-${++serial}` })
  if (parsed.status !== 'valid') throw new Error(JSON.stringify(parsed.diagnostics))
  return parsed
}
function fragments(source: string, from = 0, to = source.length): AggregateMarkdownFragment[] {
  const parsed = parse(source)
  const ranges = unitsToRanges(source, parsed.sourceMap.blocks.flatMap(block => block.slots.flatMap(slot => slot.units))
    .filter(unit => !unit.barrier && unit.from >= from && unit.to <= to))
  return ranges.map((range, index) => {
    const gap = index ? source.slice(ranges[index - 1].to, range.from) : ''
    const separatorBefore = /\r?\n[\s]*\r?\n/.test(gap) ? '\n\n' : /[\r\n]/.test(gap) ? '\n' : ''
    return { from: range.from, to: range.to, ...(separatorBefore ? { separatorBefore } : {}) }
  })
}
function check(source: string, replacement: string, expected: string, selected = fragments(source)) {
  const result = planAggregateMarkdownTextEdit({ source, fragments: selected, replacement })
  expect(result.afterSource).toBe(expected)
  let applied = source
  for (const edit of [...result.edits].reverse()) applied = applied.slice(0, edit.from) + edit.text + applied.slice(edit.to)
  expect(applied).toBe(expected)
  const parsed = parse(result.afterSource)
  const serialized = serializeDocumentMarkdown(parsed.document, 'file')
  const reopened = parse(serialized)
  expect(reopened.document.content.blocks.flatMap(documentTextSlots).map(slot => plainDocumentText(slot.content)))
    .toEqual(parsed.document.content.blocks.flatMap(documentTextSlots).map(slot => plainDocumentText(slot.content)))
  return result
}

it('shortens a mixed selected range and removes only its empty link run, preserving unselected source formatting', () => {
  const source = '**前** 甲**乙**丙[丁](https://example.org) *后*'
  const from = source.indexOf('甲'), to = source.indexOf('丁') + 1
  const result = check(source, '新', '**前** **新** *后*', fragments(source, from, to))
  expect(result.selectedRanges.map(range => result.afterSource.slice(range.from, range.to))).toEqual(['新'])
  expect(result.selectedRanges[0].from).toBe(result.afterSource.indexOf('新'))
})

it.each([
  '甲**乙**丙[丁](https://example.org)',
  '甲**乙[丙](https://example.org)丁**戊',
  '甲[**乙**](https://example.org)丙',
  '甲[乙]{cw:bold=true}丙`丁`戊',
])('deletes all selected visible text and its empty original wrappers: %s', source => {
  const result = check(source, '', '')
  expect(result.selectedRanges).toEqual([{ from: 0, to: 0 }])
  const continued = planAggregateMarkdownTextEdit({ source: result.afterSource, fragments: result.selectedRanges, replacement: '继续' })
  expect(continued.afterSource).toBe('继续')
  expect(continued.selectedRanges).toEqual([{ from: 0, to: 2 }])
})

it('removes a complete nested link while retaining the unselected outer bold text and exact prefix/suffix', () => {
  const source = '人工前 **乙[丙](https://example.org)丁** 人工后'
  const result = check(source, '', '人工前 **乙丁** 人工后', fragments(source, source.indexOf('丙'), source.indexOf('丙') + 1))
  expect(result.selectedRanges).toEqual([{ from: '人工前 **乙'.length, to: '人工前 **乙'.length }])
})

it.each([
  ['甲\n\n乙', '甲乙'],
  ['- 甲\n- 乙', '- 甲乙'],
  ['> 甲\n> 乙', '> 甲乙'],
  ['甲\r\n\r\n**乙**', '甲[乙]{cw:bold=true}'],
])('merges selected paragraph/list/quote boundaries using the original source projection: %s', (source, expected) => {
  const result = check(source, '甲乙', expected)
  expect(result.selectedRanges.map(range => result.afterSource.slice(range.from, range.to))).toEqual(expected.includes('cw:bold=true') ? ['甲', '乙'] : ['甲乙'])
  if (source.includes('\r\n')) {
    const inlines = documentTextSlots(parse(result.afterSource).document.content.blocks[0])[0].content.inlines
    expect(inlines).toMatchObject([{ type: 'text', text: '甲' }, { type: 'text', text: '乙', style: { bold: true } }])
    expect(inlines[0].type === 'text' && inlines[0].style?.bold).not.toBe(true)
  }
})

it('retains the existing mixed full rewrite formatting and URL outside the narrow ACK ranges', () => {
  const source = '前 甲**乙**丙[丁](https://example.org) 后'
  const result = check(source, '天地玄黄宇宙', '前 天地**玄**黄宇[宙](https://example.org) 后', fragments(source, 2, source.indexOf('丁') + 1))
  expect(result.selectedRanges.map(range => result.afterSource.slice(range.from, range.to))).toEqual(['天地', '玄', '黄宇', '宙'])
  expect(result.selectedRanges.every(range => !result.afterSource.slice(range.from, range.to).includes('example.org'))).toBe(true)
})

it('maps selected wrapper deletion correctly after CRLF and preserves unrelated source bytes', () => {
  const source = '不改\r\n\r\n前[**乙**](https://example.org)后\r\n\r\n尾'
  check(source, '', '不改\r\n\r\n前后\r\n\r\n尾', fragments(source, source.indexOf('乙'), source.indexOf('乙') + 1))
})

it('preserves unrelated preexisting empty inline syntax when clearing a selected styled run', () => {
  const source = '前[](https://example.org) **乙** 后'
  check(source, '', '前[](https://example.org)  后', fragments(source, source.indexOf('乙'), source.indexOf('乙') + 1))
})

it('uses the existing inline code serializer for new backticks and keeps its unselected prefix/suffix outside ACK', () => {
  const source = '人工前 `abc` 人工后'
  const result = check(source, '`', '人工前 ``a`c`` 人工后', fragments(source, source.indexOf('b'), source.indexOf('b') + 1))
  expect(result.selectedRanges.map(range => result.afterSource.slice(range.from, range.to))).toEqual(['`'])
  const parsed = parse(result.afterSource)
  expect(plainDocumentText(documentTextSlots(parsed.document.content.blocks[0])[0].content)).toBe('人工前 a`c 人工后')
})

it('continues the precise caret after partial code deletion instead of selecting the original wrapper start', () => {
  const source = '前 `abc` 后'
  const result = check(source, '', '前 `ac` 后', [{ from: 4, to: 5 }])
  expect(result.selectedRanges).toEqual([{ from: 4, to: 4 }])
  const continued = planAggregateMarkdownTextEdit({ source: result.afterSource, fragments: result.selectedRanges, replacement: '*' })
  expect(continued.afterSource).toBe('前 `a*c` 后')
  expect(continued.selectedRanges.map(range => continued.afterSource.slice(range.from, range.to))).toEqual(['*'])
})

it('reserializes the original code delimiter when deletion joins two existing backticks', () => {
  const source = '前 `` `a` `` 后'
  const result = check(source, '', '前 ``` `` ``` 后', fragments(source, source.indexOf('a'), source.indexOf('a') + 1))
  expect(result.selectedRanges).toEqual([{ from: result.afterSource.indexOf('``', 6) + 1, to: result.afterSource.indexOf('``', 6) + 1 }])
})

it('merges formatted paragraph boundaries without making joined bold delimiters visible', () => {
  const result = check('**甲**\n\n**乙**', '甲乙', '**甲乙**')
  expect(result.selectedRanges).toEqual([{ from: 2, to: 4 }])
  expect(parse(result.afterSource).document.content.blocks[0]).toMatchObject({ content: { inlines: [{ type: 'text', text: '甲乙', style: { bold: true } }] } })
})

it('keeps differing emphasis at the merged boundary and preserves the unselected prefix/suffix text', () => {
  const source = '__前甲__\n\n*乙后*'
  const result = check(source, '甲乙', '[前甲]{cw:bold=true}[乙后]{cw:italic=true}', fragments(source, source.indexOf('甲'), source.indexOf('乙') + 1))
  expect(result.selectedRanges.map(range => result.afterSource.slice(range.from, range.to))).toEqual(['甲', '乙'])
  expect(parse(result.afterSource).document.content.blocks[0]).toMatchObject({ content: { inlines: [
    { type: 'text', text: '前甲', style: { bold: true } }, { type: 'text', text: '乙后', style: { italic: true } },
  ] } })
})

it.each([
  ['前 **a[](https://example.org)** 后', '前 **[](https://example.org)** 后'],
  ['前 **[a[](https://example.org)]{cw:italic=true}** 后', '前 **[[](https://example.org)]{cw:italic=true}** 后'],
])('retains an unselected empty link inside a wrapper when deleting its last visible letter: %s', (source, expected) => {
  const start = source.indexOf('a')
  check(source, '', expected, [{ from: start, to: start + 1 }])
})

it('preserves an original empty link while serializing the actual changed emphasis boundary', () => {
  const source = '__甲[](https://example.org)__\n\n*乙*'
  const result = check(source, '甲乙', '__甲[](https://example.org)__*乙*')
  expect(result.selectedRanges.map(range => result.afterSource.slice(range.from, range.to))).toEqual(['甲', '乙'])
  const parsed = parse(result.afterSource)
  expect(documentTextSlots(parsed.document.content.blocks[0])[0].content.inlines).toMatchObject([
    { type: 'text', text: '甲', style: { bold: true } }, { type: 'text', text: '乙', style: { italic: true } },
  ])
  expect(parsed.sourceMap.blocks[0].slots[0].retained).toHaveLength(1)
  expect(result.edits.filter(edit => source.slice(edit.from, edit.to).includes('example.org'))).toEqual([])
})

it('deletes the selected last prose of a formatted multiline quote including its consumed structural barrier', () => {
  const source = '> **甲\n> 乙**'
  const result = check(source, '', '', [{ from: 4, to: 5 }, { from: 8, to: 9, separatorBefore: '\n' }])
  expect(result.selectedRanges).toEqual([{ from: 0, to: 0 }])
})

it.each([
  { source: '> 甲[](https://example.org)', selected: [{ from: 2, to: 3 }] },
  { source: '> 甲[](https://example.org)\n> 乙', selected: [{ from: 2, to: 3 }, { from: 29, to: 30, separatorBefore: '\n' }] },
])('keeps a quote direct empty child while deleting only selected prose: $source', ({ source, selected }) => {
  expect(parse(source).sourceMap.blocks[0].slots[0].retained?.length).toBe(1)
  const result = check(source, '', '> [](https://example.org)', selected)
  expect(result.selectedRanges).toEqual([{ from: 2, to: 2 }])
  expect(result.edits.every(edit => edit.from >= 2)).toBe(true)
  const continued = planAggregateMarkdownTextEdit({ source: result.afterSource, fragments: result.selectedRanges, replacement: '续' })
  expect(continued.afterSource).toBe('> 续[](https://example.org)')
  expect(continued.selectedRanges).toEqual([{ from: 2, to: 3 }])
})

it('preserves the original empty link separating same-context wrappers when merging selected paragraphs', () => {
  const source = '**甲**[](https://example.org)\n\n**乙**'
  const result = check(source, '甲乙', '**甲**[](https://example.org)**乙**')
  expect(result.selectedRanges.map(range => result.afterSource.slice(range.from, range.to))).toEqual(['甲', '乙'])
  expect(result.edits.filter(edit => source.slice(edit.from, edit.to).includes('example.org'))).toEqual([])
  expect(parse(result.afterSource).document.content.blocks[0]).toMatchObject({ content: { inlines: [{ type: 'text', text: '甲乙', style: { bold: true } }] } })
})
