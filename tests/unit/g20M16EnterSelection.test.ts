import { expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'

it('M16 Enter reads the live collapsed DOM caret before splitting a paragraph', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const change = vi.fn()
  const editor = createLayoutEditor(host, { document: { content: { blocks: [{ id: 'p', type: 'paragraph',
    content: { inlines: [{ type: 'text', text: '乙段：保持原样。' }] } }] }, resources: emptyDocumentResources() },
    revision: '1', change, diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn() })
  try {
    editor.view.focus()
    const doc = editor.view.state.doc
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
    const text = host.querySelector('p')?.firstChild
    if (!(text instanceof Text)) throw new Error('Expected editable paragraph text')
    const range = document.createRange()
    range.setStart(text, text.length); range.collapse(true)
    const native = document.getSelection()!
    native.removeAllRanges(); native.addRange(range)
    expect(editor.view.state.selection.empty).toBe(false)
    expect(native.isCollapsed).toBe(true)
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const blocks = fromEditorDocument(editor.view.state.doc).blocks
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'paragraph', content: { inlines: [{ type: 'text', text: '乙段：保持原样。' }] } })
    expect(blocks[1]).toMatchObject({ type: 'paragraph', content: { inlines: [] } })
    expect(change).toHaveBeenCalledTimes(1)
  } finally { editor.destroy(); host.remove() }
})
