import { expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'

it('M16 plain paste ignores a rich document slice and uses only text/plain', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const change = vi.fn(), diagnostic = vi.fn()
  const editor = createLayoutEditor(host, { document: { content: { blocks: [{ id: 'p', type: 'paragraph',
    content: { inlines: [{ type: 'text', text: '前旧后' }] } }] }, resources: emptyDocumentResources() },
    revision: '1', change, diagnostic, undo: vi.fn(), redo: vi.fn() })
  try {
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2, 3)))
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain'
      ? '纯' : type === 'application/x-cw-document-slice' ? '{invalid-rich-slice}' : '' } })
    editor.requestPlainPaste()
    editor.view.dom.dispatchEvent(event)
    const result = fromEditorDocument(editor.view.state.doc).blocks[0]
    expect(result).toMatchObject({ type: 'paragraph', content: { inlines: [{ type: 'text', text: '前纯后' }] } })
    expect(change).toHaveBeenCalledTimes(1)
    expect(diagnostic).not.toHaveBeenCalled()
  } finally { editor.destroy(); host.remove() }
})
