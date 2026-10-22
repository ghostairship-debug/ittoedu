import { expect, it, vi } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
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

it('publishes the current same caret on native click without a document or selection transaction', () => {
  const element = document.createElement('div'); document.body.append(element)
  const selection = vi.fn(), change = vi.fn()
  const editor = createLayoutEditor(element, {
    document: { content, resources: emptyDocumentResources() }, revision: 'r1', presentation: 'flow',
    change, diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), selection,
  })
  try {
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2)))
    const state = editor.view.state, current = editor.readSelection()
    selection.mockClear()
    editor.view.focus()
    expect(selection).not.toHaveBeenCalled()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    element.querySelector('[data-document-id="intro"] [data-flow-idle-rich-text]')!.dispatchEvent(click)
    expect(selection).toHaveBeenCalledExactlyOnceWith(current)
    expect(click.defaultPrevented).toBe(false)
    expect(editor.view.state).toBe(state)
    expect(change).not.toHaveBeenCalled()
  } finally { editor.destroy(); element.remove() }
})


it('refreshes the existing editor read-only state without replacing its document, selection or retained draft', () => {
  const element = document.createElement('div'); document.body.append(element)
  const change = vi.fn(() => false), options = {
    document: { content, resources: emptyDocumentResources() }, revision: 'r1', presentation: 'flow' as const,
    change, diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    renderObject: (_block: unknown, container: HTMLElement) => { container.textContent = '图片' },
  }
  const editor = createLayoutEditor(element, options), view = editor.view
  try {
    view.dispatch(view.state.tr.insertText('未提交', 1))
    const state = view.state, host = element.querySelector('figure')
    const commits = change.mock.calls.length
    expect(view.editable).toBe(true)
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    editor.update({ ...options, readOnly: true })
    expect(editor.view).toBe(view)
    expect(view.editable).toBe(false)
    expect(view.dom.getAttribute('contenteditable')).toBe('false')
    expect(view.state).toBe(state)
    expect(element.querySelector('figure')).toBe(host)
    expect(view.state.doc.textContent).toContain('未提交')
    editor.update({ ...options, readOnly: false })
    expect(view.editable).toBe(true)
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    expect(view.state).toBe(state)
    expect(change).toHaveBeenCalledTimes(commits)
    expect(options.undo).not.toHaveBeenCalled(); expect(options.redo).not.toHaveBeenCalled()
  } finally { editor.destroy(); element.remove() }
})


it('keeps a rendered image field owner on its click and lets ordinary text reclaim the same PM caret', () => {
  const element = document.createElement('div'); document.body.append(element)
  let owner = 'document'
  const selection = vi.fn(() => { owner = 'document' }), change = vi.fn()
  let image!: HTMLImageElement
  const editor = createLayoutEditor(element, {
    document: { content, resources: emptyDocumentResources() }, revision: 'r1', presentation: 'flow',
    change, diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), selection,
    renderObject: (_block, host) => {
      host.setAttribute('contenteditable', 'false') // Reflect the real Chromium object host in jsdom.
      image = document.createElement('img'); host.append(image)
    },
  })
  try {
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2)))
    const state = editor.view.state, caret = editor.readSelection()
    selection.mockClear()
    // The field's pointer owner already took selection and canceled compatible mousedown.
    // Chromium still sends click; that event must not report the old PM text caret.
    owner = 'image-field'
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    image.dispatchEvent(click)
    expect(selection).not.toHaveBeenCalled()
    expect(owner).toBe('image-field')
    expect(click.defaultPrevented).toBe(false)
    expect(editor.view.state).toBe(state)
    element.querySelector('[data-document-id="intro"] [data-flow-idle-rich-text]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(selection).toHaveBeenCalledExactlyOnceWith(caret)
    expect(owner).toBe('document')
    expect(editor.view.state).toBe(state)
    expect(change).not.toHaveBeenCalled()
  } finally { editor.destroy(); element.remove() }
})
