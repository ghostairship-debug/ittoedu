import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import * as editorSession from '@/renderer/document/editorSession'
import { SharedDocumentEditor } from '@/renderer/document/SharedDocumentEditor'
import { fromEditorDocument } from '@/renderer/document/documentAdapter'
import { FormulaAuthoringEditor } from '@/renderer/ui/FormulaAuthoringEditor'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '@/shared/document/markdown'
import { emptyDocumentResources } from '@/shared/document/resources'

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  for (const [key, descriptor] of [['getClientRects', rangeRects], ['getBoundingClientRect', rangeBounds]] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor)
    else Reflect.deleteProperty(Range.prototype, key)
  }
})

const initial = { content: { blocks: [
  { id: 'first', type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: '第一段文字' }] } },
  { id: 'second', type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: '第二段文字' }] } },
] }, resources: emptyDocumentResources() }

function mountDocument() {
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(100, 100, 80, 24)] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(100, 100, 80, 24) })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 600, 400))
  const factory = vi.spyOn(editorSession, 'createLayoutEditor')
  const change = vi.fn(() => true)
  const props = { document: initial, revision: '1', target: 'file' as const, onChange: change, onDraft() {}, onUndo() {}, onRedo() {} }
  const rendered = render(<SharedDocumentEditor {...props} />)
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
  return { rendered, editor, change, props }
}

describe('ordinary shared document editing', () => {
  it('inserts a table from the common toolbar and retains edited cell text in the existing Markdown codec', async () => {
    const { rendered, editor, change } = mountDocument()
    expect(rendered.getByRole('button', { name: '正文' })).toHaveAttribute('aria-pressed', 'true')
    expect(rendered.getByRole('button', { name: '源码' })).toBeVisible()
    fireEvent.click(rendered.getByRole('button', { name: '插入表格' }))
    let cell = -1
    editor.view.state.doc.descendants((node, at) => { if (cell < 0 && node.type.name === 'slot' && node.attrs.key.startsWith('cell:')) cell = at + 1 })
    expect(cell).toBeGreaterThan(0)
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, cell)).insertText('教师填写')))
    await act(async () => { await editor.drain() })
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, cell))))
    fireEvent.click(rendered.getByRole('button', { name: '属性' }))
    fireEvent.click(rendered.getByRole('checkbox', { name: '表格标题行' }))
    expect(fromEditorDocument(editor.view.state.doc).blocks.find(block => block.type === 'table')).toMatchObject({ headerEnabled: false })
    fireEvent.click(rendered.getByRole('checkbox', { name: '表格标题行' }))
    await act(async () => { expect(await editor.drain()).toBe(true) })
    const content = fromEditorDocument(editor.view.state.doc)
    const table = content.blocks.find(block => block.type === 'table')!
    expect(table.type === 'table' && Object.values(table.rows[0].cells)[0]).toMatchObject({ inlines: [{ text: '教师填写' }] })
    expect(content.blocks.filter(block => block.type === 'paragraph')).toEqual(initial.content.blocks)
    const source = serializeDocumentMarkdown({ ...initial, content }, 'file')
    const reopened = parseDocumentMarkdown(source, { createId: () => crypto.randomUUID(), target: 'file' })
    expect(reopened.status).toBe('valid')
    if (reopened.status === 'valid') {
      const savedTable = reopened.document.content.blocks.find(block => block.type === 'table')!
      expect(savedTable.type === 'table' && Object.values(savedTable.rows[0].cells)[0]).toMatchObject({ inlines: [{ text: '教师填写' }] })
    }
    expect(source).toContain('教师填写')
    expect(change).toHaveBeenCalled()
    expect(rendered.queryByRole('alert')).toBeNull()
    fireEvent.click(rendered.getByRole('button', { name: '源码' }))
    expect(rendered.getByLabelText('正文源文编辑')).toHaveTextContent('教师填写')
    fireEvent.click(rendered.getByRole('button', { name: '正文' }))
    expect(rendered.getByRole('button', { name: '正文' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('binds properties to the current file block and removes portals when the tab is hidden', async () => {
    const { rendered, editor, props } = mountDocument()
    act(() => { editor.view.focus(); editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 3))) })
    fireEvent.click(rendered.getByRole('button', { name: '属性' }))
    fireEvent.change(rendered.getByRole('combobox', { name: '段落对齐' }), { target: { value: 'center' } })
    await act(async () => { await editor.drain() })
    expect(fromEditorDocument(editor.view.state.doc).blocks[0]).toMatchObject({ id: 'first', textAlign: 'center' })
    const secondAt = editor.view.state.doc.child(0).nodeSize + 1
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, secondAt, secondAt + 2))))
    fireEvent.click(rendered.getByRole('button', { name: '属性' }))
    expect(rendered.getByRole('combobox', { name: '段落对齐' })).toHaveValue('left')
    fireEvent.change(rendered.getByRole('combobox', { name: '段落对齐' }), { target: { value: 'right' } })
    expect(fromEditorDocument(editor.view.state.doc).blocks[1]).toMatchObject({ id: 'second', textAlign: 'right' })
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1))))
    expect(document.querySelector('.document-block-handle')).not.toBeNull()
    rendered.rerender(<SharedDocumentEditor {...props} active={false} />)
    expect(document.querySelector('.document-block-handle')).toBeNull()
    expect(document.querySelector('[data-selection-quick-bar]')).toBeNull()
    expect(rendered.queryByRole('toolbar', { name: '正文工具' })).toBeNull()
  })

  it('fills fraction and root templates through the current LaTeX interface and previews and reopens the result', () => {
    const commit = vi.fn()
    const node = { id: 'formula', formulaId: 'formula', type: 'formula' as const, name: '公式', x: 0, y: 0, width: 300, height: 100, rotation: 0, opacity: 1, locked: false, visible: true, playbackInitialVisibility: 'inherit' as const,
      accessibleText: 'x', style: { fontSize: 32, color: '#000000', align: 'center' as const } }
    const props = { node, latexSource: 'x', onCommit: vi.fn(), onCommitLatex: commit }
    const rendered = render(<FormulaAuthoringEditor {...props} autoFocus />)
    fireEvent.click(rendered.getByRole('button', { name: '分式' }))
    expect(rendered.getByRole('textbox', { name: '公式 LaTeX' })).toHaveValue('\\frac{x}{□}')
    fireEvent.change(rendered.getByRole('textbox', { name: '公式 LaTeX' }), { target: { value: '\\frac{x}{2}' } })
    expect(rendered.getByTestId('formula-preview').querySelector('mfrac')).not.toBeNull()
    fireEvent.click(rendered.getByRole('button', { name: '应用公式' }))
    expect(commit).toHaveBeenCalledWith('\\frac{x}{2}', expect.stringContaining('分式'))
    rendered.rerender(<FormulaAuthoringEditor {...props} node={{ ...node, accessibleText: commit.mock.calls[0][1] }} latexSource={'\\frac{x}{2}'} />)
    const input = rendered.getByRole('textbox', { name: '公式 LaTeX' }) as HTMLInputElement
    input.setSelectionRange(0, input.value.length)
    fireEvent.click(rendered.getByRole('button', { name: '平方根' }))
    expect(input).toHaveValue('\\sqrt{\\frac{x}{2}}')
    expect(rendered.getByTestId('formula-preview').querySelector('msqrt')).not.toBeNull()
    fireEvent.click(rendered.getByRole('button', { name: '应用公式' }))
    expect(commit).toHaveBeenLastCalledWith('\\sqrt{\\frac{x}{2}}', expect.stringContaining('根'))
  })
})
