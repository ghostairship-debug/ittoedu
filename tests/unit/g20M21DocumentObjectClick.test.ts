import { expect, it, vi } from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import { createLayoutEditor, DOCUMENT_OBJECT_CONTEXT_MENU_EVENT } from '../../src/renderer/document/editorSession'
import type { DocumentContent } from '../../src/shared/document/content'
import { emptyDocumentResources } from '../../src/shared/document/resources'

const content = { blocks: [
  { id: 'intro', type: 'paragraph', content: { inlines: [{ type: 'text', text: '引言' }] } },
  { id: 'figure', type: 'media', assetId: 'picture', mediaKind: 'image', altText: '示意图', caption: { inlines: [{ type: 'text', text: '图注' }] }, layout: 'wide', wrap: 'none' },
] } as unknown as DocumentContent

it('M21 selects a document picture as a whole on a plain click, as a page object is, so its quick bar opens', () => {
  const element = document.createElement('div')
  document.body.append(element)
  const selection = vi.fn()
  const editor = createLayoutEditor(element, {
    document: { content, resources: emptyDocumentResources() }, revision: 'r1', presentation: 'flow',
    change: vi.fn(), diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), selection,
    renderObject: (_block, container) => { container.textContent = '图片' },
  })
  try {
    const host = element.querySelector<HTMLElement>('figure[data-document-id="figure"] > div:first-child')!
    expect(host).not.toBeNull()
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection)
    expect((editor.view.state.selection as NodeSelection).node.attrs.id).toBe('figure')
    expect(selection).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'object', blockId: 'figure' }))
    // Ctrl+click is left to ProseMirror; the caption stays editable text.
    const caption = element.querySelector<HTMLElement>('figure[data-document-id="figure"] figcaption')
    expect(caption?.textContent).toContain('图注')
  } finally { editor.destroy(); element.remove() }
})

it('M21 a right-click on a document picture selects it and asks for its menu', () => {
  const element = document.createElement('div')
  document.body.append(element)
  const selection = vi.fn(), requests: unknown[] = []
  element.addEventListener(DOCUMENT_OBJECT_CONTEXT_MENU_EVENT, event => requests.push((event as CustomEvent).detail))
  const editor = createLayoutEditor(element, {
    document: { content, resources: emptyDocumentResources() }, revision: 'r1', presentation: 'flow',
    change: vi.fn(), diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), selection,
    renderObject: (_block, container) => { container.textContent = '图片' },
  })
  try {
    const host = element.querySelector<HTMLElement>('figure[data-document-id="figure"] > div:first-child')!
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 })
    host.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    expect((editor.view.state.selection as NodeSelection).node.attrs.id).toBe('figure')
    expect(requests).toEqual([{ x: 120, y: 80, blockId: 'figure' }])
  } finally { editor.destroy(); element.remove() }
})
