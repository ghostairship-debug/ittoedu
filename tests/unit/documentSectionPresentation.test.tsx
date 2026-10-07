import { expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'

it('opens a collapsed playback chapter in the real author NodeView and retains editable title/body without an author write', () => {
  const host = document.createElement('div'); document.body.append(host)
  const change = vi.fn(), diagnostic = vi.fn()
  const content = { blocks: [{ id: 'chapter', type: 'section' as const, collapsedByDefault: true,
    title: { inlines: [{ type: 'text' as const, text: '章节标题' }] },
    blocks: [{ id: 'body', type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: '正文内容', style: { bold: true } }] } }] }] }
  const editor = createLayoutEditor(host, { document: { content, resources: emptyDocumentResources() }, revision: '1', presentation: 'flow', change, diagnostic, undo() {}, redo() {} })
  try {
    const details = host.querySelector('details')!
    expect(details.open).toBe(true)
    expect(details.querySelector('summary [data-flow-idle-rich-text]')?.textContent).toBe('章节标题')
    const paragraph = details.querySelector('[data-flow-body-block="paragraph"] [data-flow-idle-rich-text]')!
    expect(paragraph.textContent).toBe('正文内容')
    expect(paragraph.closest('[contenteditable="false"]')).toBeNull()
    const position = editor.view.posAtDOM(paragraph, 0)
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, position)))
    expect(editor.view.state.selection.$from.parent.inlineContent).toBe(true)
    expect(fromEditorDocument(editor.view.state.doc)).toEqual(content)
    expect(change).not.toHaveBeenCalled()
    expect(diagnostic).not.toHaveBeenCalled()
  } finally { editor.destroy(); host.remove() }
})
