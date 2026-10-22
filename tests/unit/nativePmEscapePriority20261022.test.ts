import { afterEach, expect, it, vi } from 'vitest'
import { createEvent, fireEvent } from '@testing-library/dom'
import { Plugin } from 'prosemirror-state'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { emptyDocumentResources } from '../../src/shared/document/resources'

afterEach(() => vi.restoreAllMocks())
it.each([{ key: 'Escape', keyCode: 27, which: 27 }, { key: 'Enter', keyCode: 13, which: 13, ctrlKey: true }])('professional PM preserves an earlier tool claim for $key', key => {
  const host = document.createElement('div'); document.body.append(host)
  const claim = vi.fn(() => true), change = vi.fn()
  const editor = createLayoutEditor(host, { document: { content: { blocks: [{ id: 'text', type: 'paragraph',
    content: { inlines: [{ type: 'text', text: 'kept text' }] } }] }, resources: emptyDocumentResources() },
    contentScope: 'inline-text', revision: 'one', change, undo() {}, redo() {}, diagnostic() {},
    projectionPlugins: [new Plugin({ props: { handleKeyDown: claim } })] })
  try {
    const event = createEvent.keyDown(editor.view.dom, key)
    fireEvent(editor.view.dom, event)
    expect(claim).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    expect(change).not.toHaveBeenCalled()
    expect(editor.view.state.doc.textContent).toBe('kept text')
  } finally { editor.destroy(); host.remove() }
})

it('professional PM does not re-route an already prevented completion key', () => {
  const host = document.createElement('div'); document.body.append(host)
  const claim = vi.fn(() => true)
  const editor = createLayoutEditor(host, { document: { content: { blocks: [{ id: 'text', type: 'paragraph',
    content: { inlines: [{ type: 'text', text: 'kept text' }] } }] }, resources: emptyDocumentResources() },
    contentScope: 'inline-text', revision: 'one', change() {}, undo() {}, redo() {}, diagnostic() {},
    projectionPlugins: [new Plugin({ props: { handleKeyDown: claim } })] })
  const prevent = (event: Event) => event.preventDefault()
  host.addEventListener('keydown', prevent, true)
  try {
    const event = createEvent.keyDown(editor.view.dom, { key: 'Escape', keyCode: 27, which: 27 })
    fireEvent(editor.view.dom, event)
    expect(event.defaultPrevented).toBe(true)
    expect(claim).not.toHaveBeenCalled()
  } finally { host.removeEventListener('keydown', prevent, true); editor.destroy(); host.remove() }
})
