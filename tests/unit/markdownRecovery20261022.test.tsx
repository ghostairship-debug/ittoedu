import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { EditorView as SourceView } from '@codemirror/view'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { editMarkdownSource } from '../../src/shared/document/markdownSourceEdit'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import * as sessions from '../../src/renderer/document/editorSession'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const options = () => ({ target: 'file' as const, recoverUnsupportedBlocks: true, createId: () => crypto.randomUUID() })
function parse(source: string, previous?: Extract<ReturnType<typeof parseDocumentMarkdown>, { status: 'valid' }>) {
  const result = parseDocumentMarkdown(source, { ...options(), previous })
  if (result.status !== 'valid') throw new Error(JSON.stringify(result.diagnostics))
  return result
}
const mixed = '# 标题😀\r\n\r\n正常前文。\r\n\r\n<div>Keep RAW</div>\r\n\r\n<!--cw:block {bad}-->\r\n\r\n正常后文。\r\n'

it('keeps usable blocks around local errors and locates metadata and inline failures in the original CRLF source', () => {
  const source = mixed + '\r\nText <!--cw:inline {bad}--> tail\r\n\r\nEnd.\r\n'
  const result = parse(source)
  expect(result.diagnostics).toHaveLength(3)
  expect(result.document.content.blocks.map(block => block.type)).toEqual(['heading', 'paragraph', 'code', 'code', 'paragraph', 'code', 'paragraph'])
  expect(result.source).toBe(source)
  expect(result.sourceMap.blocks.filter(block => block.rawSource)).toHaveLength(3)
  const metadata = result.diagnostics.find(issue => issue.offset === source.indexOf('<!--cw:block'))!
  expect(metadata).toMatchObject({ line: 7, column: 1, endOffset: source.indexOf('<!--cw:block') + '<!--cw:block {bad}-->'.length })
  const inline = result.diagnostics.find(issue => issue.offset === source.indexOf('<!--cw:inline'))!
  expect(inline).toMatchObject({ line: 11, column: 6 })
  expect(source.slice(inline.offset, inline.endOffset)).toBe('<!--cw:inline {bad}-->')
})

it('recovers duplicate identities and file-incompatible object resources at their own source blocks', () => {
  const object = JSON.stringify({ kind: 'flow-block', block: { id: 'image', type: 'media', mediaKind: 'image', assetId: 'asset', layout: 'content-width' }, resources: { assets: [{ assetId: 'asset', source: { kind: 'project' } }], components: [] } })
  const source = '<!--cw:block {"id":"a"}-->\nOne\n\n<!--cw:block {"id":"a"}-->\nTwo\n\n```cw-object-v1\n' + object + '\n```\n\nTail.\n'
  const result = parse(source)
  expect(result.document.content.blocks.map(block => block.type)).toEqual(['paragraph', 'code', 'code', 'paragraph'])
  expect(result.diagnostics).toHaveLength(2)
  expect(result.diagnostics[0]).toMatchObject({ line: 4, offset: source.indexOf('<!--cw:block', 1) })
  expect(result.diagnostics[1].message).toContain('相对资源')
  expect(result.document.resources).toEqual({ assets: [], components: [] })
})

it('preserves raw fragments and untouched paragraphs during local and multi-block structural body edits', () => {
  const before = parse(mixed), after = structuredClone(before.document)
  const first = after.content.blocks[1]
  if (first.type !== 'paragraph') throw new Error('fixture')
  first.content.inlines = [{ type: 'text', text: '改后前文。' }]
  expect(editMarkdownSource(mixed, before.document, after, before.sourceMap, options())).toBe(mixed.replace('正常前文。', '改后前文。'))
  const structured = structuredClone(before.document)
  const heading = structured.content.blocks[0], tail = structured.content.blocks.at(-1)!
  if (heading.type !== 'heading' || tail.type !== 'paragraph') throw new Error('fixture')
  structured.content.blocks[0] = { id: heading.id, type: 'paragraph', content: heading.content }
  structured.content.blocks[structured.content.blocks.length - 1] = { ...tail, type: 'quote' }
  const output = editMarkdownSource(mixed, before.document, structured, before.sourceMap, options())
  for (const span of before.sourceMap.blocks.slice(1, -1)) expect(output).toContain(mixed.slice(span.from, span.to))
  expect(output).not.toContain('```markdown')
  expect(parse(output).diagnostics).toHaveLength(2)
})

it('writes an edited raw fragment into source and lets its repaired syntax become rendered paragraphs', () => {
  const before = parse(mixed), after = structuredClone(before.document), raw = after.content.blocks[2]
  if (raw.type !== 'code') throw new Error('fixture')
  raw.code = '修好的正文😀。\n\n第二段。'
  const output = editMarkdownSource(mixed, before.document, after, before.sourceMap, options())
  expect(output).toBe(mixed.replace('<div>Keep RAW</div>', '修好的正文😀。\r\n\r\n第二段。'))
  const repaired = parse(output)
  expect(repaired.document.content.blocks.map(block => block.type)).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph', 'code', 'paragraph'])
  expect(repaired.diagnostics).toHaveLength(1)
})

it.each(['Fixed', 'Fixed\n\nSecond paragraph.'])('keeps a simultaneous heading-level change when a raw fragment becomes %j', repair => {
  const source = '# A\n\n<div>bad</div>\n\nUnchanged tail.\n'
  const before = parse(source), after = structuredClone(before.document)
  const heading = after.content.blocks[0], raw = after.content.blocks[1]
  if (heading.type !== 'heading' || raw.type !== 'code') throw new Error('fixture')
  heading.level = 2; raw.code = repair
  const output = editMarkdownSource(source, before.document, after, before.sourceMap, options())
  const result = parse(output)
  expect(result.document.content.blocks[0]).toMatchObject({ type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: 'A' }] } })
  expect(result.document.content.blocks.slice(1).map(block => block.type === 'paragraph' ? block.content.inlines.map(atom => atom.type === 'text' ? atom.text : '').join('') : block.type))
    .toEqual([...repair.split('\n\n'), 'Unchanged tail.'])
  const tail = before.sourceMap.blocks[2]
  expect(output).toContain(source.slice(tail.from, tail.to))
  expect(output).not.toContain('```markdown')
})

function renderEditor(source: string) {
  const factory = vi.spyOn(sessions, 'createLayoutEditor'), handle = createRef<SharedDocumentEditorHandle>()
  function View() {
    const [current, setCurrent] = useState(() => parse(source))
    return <SharedDocumentEditor ref={handle} document={current.document} sourceMap={current.sourceMap} sourceDraft={current.source}
      projectionDiagnostics={current.diagnostics} revision={current.source} target="file" initialMode="layout"
      onDraft={text => setCurrent(previous => parse(text, previous))} onChange={() => true} onUndo={() => {}} onRedo={() => {}} />
  }
  const ui = render(<View />)
  const editor = () => factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
  return { ...ui, handle, editor }
}
function replaceBodyText(editor: ReturnType<typeof sessions.createLayoutEditor>, text: string, replacement: string) {
  let from = -1
  editor.view.state.doc.descendants((node, position) => { if (node.isText && node.text === text) from = position })
  if (from < 0) throw new Error(`Missing editor text: ${text}`)
  act(() => editor.view.dispatch(editor.view.state.tr.insertText(replacement, from, from + text.length)))
}

it('switches between body and source with diagnostics, selects the full issue range and repairs a raw block in body', async () => {
  const source = '# Good heading\n\nBefore normal.\n\n<div>Keep RAW</div>\n\nAfter normal.\n'
  const ui = renderEditor(source)
  expect(screen.getByRole('textbox', { name: '正文编辑' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /第 5 行，第 1 列/ }))
  const cm = SourceView.findFromDOM(ui.container.querySelector('.cm-content')!)!
  const diagnostic = parse(source).diagnostics[0]
  expect(cm.state.selection.main).toMatchObject({ from: diagnostic.offset, to: diagnostic.endOffset })
  expect(ui.container.querySelector('.cm-lineNumbers')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '正文' }))
  replaceBodyText(ui.editor(), 'Before normal.', 'Updated normal.')
  expect(ui.handle.current!.flush()).toMatchObject({ ready: true, source: source.replace('Before normal.', 'Updated normal.') })
  replaceBodyText(ui.editor(), '<div>Keep RAW</div>', 'Fixed body.')
  const result = await ui.handle.current!.drainSource()
  expect(result.ready).toBe(true)
  expect(result.source).toBe(source.replace('Before normal.', 'Updated normal.').replace('<div>Keep RAW</div>', 'Fixed body.'))
  expect(result.diagnostics).toEqual([])
  expect(screen.queryByRole('alert', { name: '源文问题' })).toBeNull()
  expect(ui.editor().view.dom.querySelector('pre')).toBeNull()
  expect(ui.editor().view.dom.textContent).toContain('After normal.')
})
