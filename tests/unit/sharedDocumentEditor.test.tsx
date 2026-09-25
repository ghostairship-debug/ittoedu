import * as editorSession from '@/renderer/document/editorSession'
import { FONT_FAMILY_OPTIONS } from '@/shared/fonts/fontFamilyCatalog'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { SharedDocumentEditor } from '@/renderer/document/SharedDocumentEditor'
import { serializeDocumentMarkdown } from '@/shared/document/markdown'
import { TextSelection } from 'prosemirror-state'
import { Slice } from 'prosemirror-model'
import { splitBlock, joinBackward } from 'prosemirror-commands'
import { createLayoutEditor } from '@/renderer/document/editorSession'
import { fromEditorDocument, toEditorDocument, editorPositionToPoint, renewEditorIdentities } from '@/renderer/document/documentAdapter'
import type { DocumentContent } from '@/shared/document/content'
import { emptyDocumentResources } from '@/shared/document/resources'

const content: DocumentContent = { blocks: [
  { id: 'p1', type: 'paragraph', content: { inlines: [{ type: 'text', text: '中文😀' }, { type: 'math', formulaId: 'f1', latex: 'x^2', accessibleText: 'x的平方' }, { type: 'text', text: '末尾', style: { bold: true, color: '#112233' } }] } },
  { id: 'p2', type: 'paragraph', content: { inlines: [{ type: 'text', text: '第二段' }] } },
  { id: 'list', type: 'list', ordered: false, items: [{ id: 'item', content: { inlines: [{ type: 'text', text: '列表' }] } }] },
  { id: 'table', type: 'table', columns: [{ id: 'column', header: { inlines: [{ type: 'text', text: '表头' }] } }], rows: [{ id: 'row', cells: { column: { inlines: [{ type: 'text', text: '单元格' }] } } }] },
] }
function mount() {
  const element = document.createElement('div'); document.body.append(element)
  const change = vi.fn(); const undo = vi.fn(); const redo = vi.fn(); const diagnostic = vi.fn()
  const editor = createLayoutEditor(element, { document: { content, resources: emptyDocumentResources() }, revision: '1', change, undo, redo, diagnostic })
  return { ...editor, change, undo, redo, diagnostic, cleanup: () => { editor.destroy(); element.remove() } }
}
describe('sharedDocumentEditor', () => {
  it('retains Flow presentation views through resource refresh without changing document content', () => {
    const element = document.createElement('div'); document.body.append(element)
    const flowDocument = { content: { blocks: [
      { id: 'section', type: 'section' as const, title: { inlines: [{ type: 'text' as const, text: '小节' }] }, collapsedByDefault: false, blocks: [content.blocks[0]!] },
      { id: 'quote', type: 'quote' as const, content: { inlines: [{ type: 'text' as const, text: '引用' }] }, citation: { inlines: [{ type: 'text' as const, text: '来源' }] } },
    ] }, resources: emptyDocumentResources() }
    const change = vi.fn(), options = { document: flowDocument, revision: '1', presentation: 'flow' as const, change, diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), objectRevision: {} }
    const editor = createLayoutEditor(element, options)
    try {
      expect(element.querySelector('details[open] > summary [data-flow-idle-rich-text]')?.textContent).toBe('小节')
      expect(element.querySelector('blockquote > cite [data-flow-idle-rich-text]')?.textContent).toBe('来源')
      expect(element.querySelector('.document-object')).toBeNull()
      editor.update({ ...options, objectRevision: {} })
      expect(element.querySelector('details[open] > summary')?.textContent).toBe('小节')
      expect(element.querySelector('p[data-flow-body-block="paragraph"] [data-flow-idle-rich-text]')).toBeTruthy()
      expect(fromEditorDocument(editor.view.state.doc)).toEqual(flowDocument.content)
      expect(change).not.toHaveBeenCalled()
    } finally { editor.destroy(); element.remove() }
  })
  it('shows the full formal font catalog, mixed selection and stored input style, then refreshes after owner Undo', () => {
    const factory = vi.spyOn(editorSession, 'createLayoutEditor')
    const initial = { content: { blocks: [{ id: 'font-body', type: 'paragraph' as const, content: { inlines: [
      { type: 'text' as const, text: '甲乙', style: { fontFamily: 'SimSun', fontSize: 20, bold: true } },
      { type: 'text' as const, text: '丙丁', style: { fontFamily: 'Arial', fontSize: 30 } },
    ] } }] }, resources: emptyDocumentResources() }
    const onChange = vi.fn(); const onDraft = vi.fn()
    const props = { document: initial, revision: '1', onChange, onDraft, onUndo() {}, onRedo() {} }
    const rendered = render(<SharedDocumentEditor {...props} />)
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof createLayoutEditor>
    try {
      const family = rendered.getByLabelText('字体') as HTMLSelectElement
      expect(Array.from(family.options).filter(option => option.value).map(option => option.value)).toEqual(FONT_FAMILY_OPTIONS.map(option => option.family))
      expect(family.value).toBe('SimSun')
      act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 5))))
      expect(family.value).toBe('__mixed')
      expect(rendered.getByLabelText('字号').getAttribute('placeholder')).toBe('混合')
      expect(rendered.getByRole('button', { name: '粗体' }).getAttribute('aria-pressed')).toBe('mixed')
      fireEvent.change(family, { target: { value: 'KaiTi' } })
      expect(family.value).toBe('KaiTi')
      const changed = fromEditorDocument(editor.view.state.doc).blocks[0]
      expect(changed.type === 'paragraph' && changed.content.inlines.every(inline => inline.type === 'text' && inline.style?.fontFamily === 'KaiTi')).toBe(true)
      act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 5))))
      fireEvent.change(rendered.getByLabelText('字号'), { target: { value: '32' } })
      expect((rendered.getByLabelText('字号') as HTMLInputElement).value).toBe('32')
      act(() => editor.view.dispatch(editor.view.state.tr.insertText('新')))
      const typed = fromEditorDocument(editor.view.state.doc).blocks[0]
      expect(typed.type === 'paragraph' && typed.content.inlines.at(-1)).toMatchObject({ text: '新', style: { fontFamily: 'KaiTi', fontSize: 32 } })
      // Owner restores the canonical document; editor has no independent Undo history.
      expect(editor.view.state.selection.anchor).toBe(6)
      rendered.rerender(<SharedDocumentEditor {...props} revision="2" />)
      // The removed character maps the caret to the old tail, instead of rebuilding at the first paragraph.
      expect(editor.view.state.selection.anchor).toBe(5)
      expect(fromEditorDocument(editor.view.state.doc)).toEqual(initial.content)
      expect(family.value).toBe('Arial')
      expect((rendered.getByLabelText('字号') as HTMLInputElement).value).toBe('30')
      expect(rendered.getByRole('button', { name: '粗体' }).getAttribute('aria-pressed')).toBe('false')
    } finally { cleanup(); factory.mockRestore() }
  })
  it('captures a clicked DOM caret before toolbar focus changes and preserves subsequent stored marks', () => {
    const factory = vi.spyOn(editorSession, 'createLayoutEditor')
    const initial = { content: { blocks: [{ id: 'caret', type: 'paragraph' as const, content: { inlines: [
      { type: 'text' as const, text: '甲乙', style: { bold: true } }, { type: 'text' as const, text: '丙丁' },
    ] } }] }, resources: emptyDocumentResources() }
    const onChange = vi.fn()
    const rendered = render(<SharedDocumentEditor document={initial} revision="1" onChange={onChange} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof createLayoutEditor>
    try {
      act(() => { editor.view.focus(); editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 5))) })
      expect(rendered.getByRole('button', { name: '粗体' })).toHaveAttribute('aria-pressed', 'mixed')
      // Browser caret changes before its asynchronous selectionchange reaches PM.
      const end = editor.view.domAtPos(5)
      document.getSelection()!.collapse(end.node, end.offset)
      expect(editor.view.state.selection.empty).toBe(false)
      fireEvent.pointerDown(rendered.getByRole('toolbar'))
      fireEvent.change(rendered.getByLabelText('字体'), { target: { value: 'KaiTi' } })
      fireEvent.change(rendered.getByLabelText('字号'), { target: { value: '32' } })
      expect(editor.view.state.selection.empty).toBe(true)
      expect(rendered.getByRole('button', { name: '粗体' })).toHaveAttribute('aria-pressed', 'false')
      expect(onChange).not.toHaveBeenCalled()
      act(() => editor.view.dispatch(editor.view.state.tr.insertText('新')))
      const block = fromEditorDocument(editor.view.state.doc).blocks[0]
      expect(block.type === 'paragraph' && block.content.inlines.at(-1)).toMatchObject({ text: '新', style: { fontFamily: 'KaiTi', fontSize: 32 } })
      expect(block.type === 'paragraph' && block.content.inlines.slice(0, -1)).toEqual(initial.content.blocks[0].content.inlines)
    } finally { cleanup(); factory.mockRestore() }
  })
  it('does not commit source merely because StrictMode remounts its view', () => {
    const onChange = vi.fn(); const onDraft = vi.fn()
    const document = { content, resources: emptyDocumentResources() }
    const rendered = render(<StrictMode><SharedDocumentEditor document={document} sourceDraft={serializeDocumentMarkdown(document)} revision="1" onChange={onChange} onDraft={onDraft} onUndo={() => {}} onRedo={() => {}} /></StrictMode>)
    expect(rendered.getAllByLabelText('正文源文编辑')).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(onDraft).not.toHaveBeenCalled()
    cleanup()
  })
  it('does not publish a queued composition after the owner unmounts', async () => {
    const editor = mount()
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    editor.view.dispatch(editor.view.state.tr.insertText('未提交', 1))
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    editor.cleanup()
    await Promise.resolve()
    expect(editor.change).not.toHaveBeenCalled()
  })
  it.each([false, true])('prepares cross-owner resource paste and discards when editor changed: %s', async stale => {
    const element = document.createElement('div'); document.body.append(element)
    const change = vi.fn(); const diagnostic = vi.fn(); const discard = vi.fn(async () => {})
    let finish!: () => void
    const ready = new Promise<void>(resolve => { finish = resolve })
    const handle = {}
    const editor = createLayoutEditor(element, { document: { content, resources: emptyDocumentResources() }, revision: '1', change, diagnostic, undo() {}, redo() {}, clipboardResourcePort: () => ({ discard, prepareResources: async () => { await ready; return { resources: { assets: [{ assetId: 'target-image', source: { kind: 'project' } }], components: [] }, assetIds: { image: 'target-image' }, components: [], prepared: handle } } }) })
    const source = toEditorDocument({ blocks: [{ id: 'media', type: 'media', mediaKind: 'image', assetId: 'image', layout: 'content-width' }] })
    const payload = JSON.stringify({ editorId: 'other-owner', slice: new Slice(source.content, 0, 0).toJSON(), resources: { assets: [{ assetId: 'image', source: { kind: 'project' } }], components: [] } })
    editor.view.someProp('handlePaste', fn => fn(editor.view, { clipboardData: { getData: () => payload } } as unknown as ClipboardEvent, Slice.empty))
    expect(change).not.toHaveBeenCalled()
    if (stale) editor.view.dispatch(editor.view.state.tr.insertText('新', 1))
    finish()
    await vi.waitFor(() => stale ? expect(discard).toHaveBeenCalledWith(handle) : expect(change).toHaveBeenCalledOnce())
    if (!stale) {
      expect(change.mock.calls[0][1].preparedResources).toBe(handle)
      expect(change.mock.calls[0][0].content.blocks.some((block: { assetId?: string }) => block.assetId === 'target-image')).toBe(true)
    } else expect(change).toHaveBeenCalledOnce()
    expect(diagnostic).not.toHaveBeenCalled()
    editor.destroy(); element.remove()
  })
  it('round trips mixed body slots and maps Unicode plus math atoms', () => {
    const doc = toEditorDocument(content)
    expect(fromEditorDocument(doc)).toEqual(content)
    expect(editorPositionToPoint(doc, 6)).toMatchObject({ blockId: 'p1', offset: 4 })
    const editor = mount()
    expect(editor.view.dom.textContent).toContain('中文😀')
    expect(editor.view.dom.querySelector('[data-document-slot="column:column"]')?.textContent).toBe('表头')
    expect(editor.view.dom.querySelector('[data-formula-id="f1"]')).toBeTruthy()
    editor.cleanup()
  })
  it('preserves DOM during composition and publishes one completed edit', async () => {
    const editor = mount()
    const original = editor.view.dom.firstChild
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    editor.view.dispatch(editor.view.state.tr.insertText('输入', 1))
    expect(editor.change).not.toHaveBeenCalled()
    expect(editor.view.dom.firstChild).toBe(original)
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await Promise.resolve()
    expect(editor.change).toHaveBeenCalledTimes(1)
    expect(editor.change.mock.calls[0][0].content.blocks[0].content.inlines[0].text).toBe('输入中文😀')
    expect(editor.diagnostic).not.toHaveBeenCalled()
    editor.cleanup()
  })
  it('splits with a fresh right identity, joins, and delegates undo to the owner', () => {
    const editor = mount()
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 3)))
    splitBlock(editor.view.state, editor.view.dispatch)
    const split = fromEditorDocument(editor.view.state.doc)
    expect(split.blocks[0].id).toBe('p1')
    expect(split.blocks[1].id).not.toBe('p1')
    expect(new Set(split.blocks.map(b => b.id)).size).toBe(split.blocks.length)
    joinBackward(editor.view.state, editor.view.dispatch, editor.view)
    expect(fromEditorDocument(editor.view.state.doc)).toEqual(content)
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(editor.undo).toHaveBeenCalledOnce()
    expect(editor.diagnostic).not.toHaveBeenCalled()
    editor.cleanup()
  })
  it('uses a shared input group until selection moves', () => {
    const editor = mount()
    editor.view.dispatch(editor.view.state.tr.insertText('甲', 1))
    editor.view.dispatch(editor.view.state.tr.insertText('乙', 2))
    expect(editor.change.mock.calls[0][1].historyGroup).toBe(editor.change.mock.calls[1][1].historyGroup)
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 6)))
    editor.view.dispatch(editor.view.state.tr.insertText('丙', 6))
    expect(editor.change.mock.calls[2][1].historyGroup).not.toBe(editor.change.mock.calls[1][1].historyGroup)
    editor.cleanup()
  })
  it('copies complete list/table/math identities and keeps source identities intact', () => {
    let id = 0
    const copy = fromEditorDocument(renewEditorIdentities(toEditorDocument(content), () => `copy-${++id}`, true))
    expect(copy.blocks.map(block => block.id)).not.toEqual(content.blocks.map(block => block.id))
    const list = copy.blocks[2]
    const table = copy.blocks[3]
    expect(list.type === 'list' && list.items[0].id).not.toBe('item')
    expect(table.type === 'table' && table.columns[0].id).not.toBe('column')
    expect(table.type === 'table' && table.rows[0].cells[table.columns[0].id].inlines[0]).toEqual({ type: 'text', text: '单元格' })
    expect(fromEditorDocument(toEditorDocument(content))).toEqual(content)
  })
  it('deletes a cross-paragraph range containing a math atom in one transaction', () => {
    const editor = mount()
    const secondStart = editor.view.state.doc.child(0).nodeSize + 1
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 3, secondStart + 1)).deleteSelection())
    const document = fromEditorDocument(editor.view.state.doc)
    expect(document.blocks[0].id).toBe('p1')
    expect(document.blocks[0].type === 'paragraph' && document.blocks[0].content.inlines.map(atom => atom.type === 'text' ? atom.text : '$').join('')).toBe('中文二段')
    expect(editor.change).toHaveBeenCalledOnce()
    editor.cleanup()
  })
})
