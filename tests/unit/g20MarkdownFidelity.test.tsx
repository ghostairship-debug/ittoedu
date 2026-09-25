import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, createRef } from 'react'
import { TextSelection } from 'prosemirror-state'
import { EditorView as SourceView } from '@codemirror/view'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { mapDocumentSelectionToSource } from '../../src/shared/document/markdownSourceMap'
import { editMarkdownSource } from '../../src/shared/document/markdownSourceEdit'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import * as sessions from '../../src/renderer/document/editorSession'
import type { DocumentPoint } from '../../src/shared/document/ports'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const parse = (source: string, previous?: Extract<ReturnType<typeof parseDocumentMarkdown>, { status: 'valid' }>) => {
  const result = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID(), previous })
  if (result.status !== 'valid') throw new Error(JSON.stringify(result.diagnostics))
  return result
}
const point = (blockId: string, offset: number): DocumentPoint => ({ blockId, slot: { kind: 'field', field: 'content' }, offset, affinity: 'after' })
it('M05 maps basic Markdown including cross-paragraph, quote/list continuation, escaped links, table code and emoji without omitting text', () => {
  const source = '# 标题\n\n  前文  \n\n> 甲乙\n> 丙丁\n\n- 一二\n  三四\n- [\\[1\\]](https://e.com)\n\n| 列 | 值 |\n| --- | --- |\n| `a\\|b` | 中文😀 |\n\nhttps://e.com\n\n重复\n\n重复\n'
  const parsed = parse(source)
  expect(parsed.sourceMap.blocks.every(block => block.slots.length === block.keys.length)).toBe(true)
  const [heading, paragraph, quote, list, table, url, first, second] = parsed.document.content.blocks
  const select = (anchor: DocumentPoint, head: DocumentPoint) => mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: '0', anchor, head })
  expect(select(point(heading.id, 0), point(paragraph.id, 6))).toMatchObject({ status: 'mapped', ranges: [{ before: '标题' }, { before: '  前文  ' }] })
  expect(select(point(quote.id, 0), point(quote.id, 5))).toMatchObject({ status: 'mapped', ranges: [{ before: '甲乙' }, { before: '丙丁' }] })
  if (list.type !== 'list' || table.type !== 'table') throw new Error('fixture')
  const itemPoint = (id: string, offset: number): DocumentPoint => ({ ...point(list.id, offset), slot: { kind: 'item', itemId: id } })
  expect(select(itemPoint(list.items[0].id, 0), itemPoint(list.items[1].id, 3))).toMatchObject({ status: 'mapped', ranges: [{ before: '一二' }, { before: '三四' }, { before: '\\[1\\]' }] })
  const cell = { ...point(table.id, 0), slot: { kind: 'cell' as const, rowId: table.rows[0].id, columnId: table.columns[0].id } }
  expect(select(cell, { ...cell, offset: 3 })).toMatchObject({ status: 'mapped', ranges: [{ before: 'a\\|b' }] })
  expect(select(point(second.id, 0), point(second.id, 2))).toMatchObject({ status: 'mapped', ranges: [{ from: source.lastIndexOf('重复'), before: '重复' }] })
  const broken = structuredClone(parsed.sourceMap); broken.blocks.find(block => block.blockId === quote.id)!.slots = []
  expect(mapDocumentSelectionToSource(source, broken, { kind: 'text', revision: '0', anchor: point(paragraph.id, 0), head: point(url.id, 1) }).status).toBe('unmapped')
  const nested = parse('- 父项\n  - 子项😀\n  - 另一个\n- 末项\n')
  expect(nested.sourceMap.blocks[0].slots.map(slot => slot.depth)).toEqual([0, 1, 1, 0])
})
it('M05 edits only the second repeated paragraph and retains IDs, surrounding whitespace, links and list indentation', () => {
  const source = '# 标题\r\n\r\n  重复 😀  \r\n\r\n  重复 😀  \r\n\r\n- 原样\r\n  续行\r\n\r\n[链接](https://e.com)\r\n'
  const parsed = parse(source), edited = structuredClone(parsed.document), block = edited.content.blocks[2]
  if (block.type !== 'paragraph') throw new Error('fixture')
  block.content = { inlines: [{ type: 'text', text: '  更新 😀  ' }] }
  const result = editMarkdownSource(source, parsed.document, edited, parsed.sourceMap, { target: 'file', createId: () => crypto.randomUUID() })
  expect(result).toBe(source.slice(0, source.lastIndexOf('重复')) + source.slice(source.lastIndexOf('重复')).replace('重复', '更新'))
  const after = parse(result, parsed)
  expect(after.document.content.blocks.map(block => block.id)).toEqual(parsed.document.content.blocks.map(block => block.id))
  const list = parsed.document.content.blocks[3], nextList = after.document.content.blocks[3]
  expect(list.type === 'list' && nextList.type === 'list' && nextList.items[0].id).toBe(list.type === 'list' && list.items[0].id)
})
it('M05 real editor keeps source bytes on body input, retains an incomplete source draft and returns to the same mapped body', () => {
  const source = '# 标题\n\n原文😀\n\n[链接](https://e.com)\n', initial = parse(source), factory = vi.spyOn(sessions, 'createLayoutEditor')
  const handle = createRef<SharedDocumentEditorHandle>(), saved: string[] = []
  function View() {
    const [current, setCurrent] = useState(initial), [draft, setDraft] = useState(source)
    return <SharedDocumentEditor ref={handle} document={current.document} sourceMap={current.sourceMap} sourceDraft={draft} revision={draft} initialMode="layout" target="file"
      onChange={document => { setCurrent(value => ({ ...value, document })); return true }}
      onDraft={text => { saved.push(text); setDraft(text); const parsed = parseDocumentMarkdown(text, { target: 'file', createId: () => crypto.randomUUID(), previous: current }); if (parsed.status === 'valid') setCurrent(parsed) }} onUndo={() => {}} onRedo={() => {}} />
  }
  const ui = render(<View />), editor = factory.mock.results[0].value as ReturnType<typeof sessions.createLayoutEditor>
  let position = 0; editor.view.state.doc.descendants((node, at) => { if (node.isText && node.text === '原文😀') position = at })
  act(() => editor.view.dispatch(editor.view.state.tr.insertText('新', position, position + 1)))
  expect(handle.current?.flush().source).toBe(source.replace('原文', '新文'))
  fireEvent.click(screen.getByRole('button', { name: '源文' }))
  const cm = SourceView.findFromDOM(ui.container.querySelector('.cm-content')!)!
  act(() => cm.dispatch({ changes: { from: cm.state.doc.length, insert: '\n```js\nunfinished' } }))
  expect(handle.current?.flush().source).toContain('unfinished')
  fireEvent.click(screen.getByRole('button', { name: '正文' }))
  expect(ui.container.querySelector('.cm-content')).toBeTruthy()
  expect(handle.current?.flush().source).toContain('unfinished')
  act(() => cm.dispatch({ changes: { from: cm.state.doc.length, insert: '\n```' } }))
  fireEvent.click(screen.getByRole('button', { name: '正文' }))
  expect(screen.getByRole('textbox', { name: '正文编辑' })).toBeTruthy()
  expect(handle.current?.flush().source).toContain('unfinished\n```')
})
