import { createRef } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import * as sessions from '../../src/renderer/document/editorSession'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import type { DocumentBlock } from '../../src/shared/document/content'
import { emptyDocumentResources } from '../../src/shared/document/resources'

const paragraph = (id: string, text: string): DocumentBlock => ({ id, type: 'paragraph', content: { inlines: [{ type: 'text', text }] } })
const group = (id: string, blocks: DocumentBlock[]): DocumentBlock => ({ id, type: 'course-instance', blocks })
const boxes: Record<string, DOMRect> = {
  a: new DOMRect(20, 30, 300, 40), b: new DOMRect(20, 90, 300, 40),
  grid: new DOMRect(20, 160, 640, 180), left: new DOMRect(20, 160, 300, 180), right: new DOMRect(360, 160, 300, 180),
  c: new DOMRect(20, 170, 300, 40), d: new DOMRect(360, 170, 300, 40),
}
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, options: MouseEventInit & { pointerId?: number } = {}) { super(type, options); this.pointerId = options.pointerId ?? 1 }
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return boxes[(this as HTMLElement).dataset.flowBlockId ?? ''] ?? new DOMRect(0, 0, 800, 600)
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mount(blocks: DocumentBlock[] = [paragraph('a', 'Alpha'), paragraph('b', 'Beta')], target: 'flow' | 'file' = 'flow', disabled?: string, renderObject?: (block: DocumentBlock, host: HTMLElement) => void) {
  const factory = vi.spyOn(sessions, 'createLayoutEditor'), change = vi.fn(() => true), selection = vi.fn()
  const handle = createRef<SharedDocumentEditorHandle>()
  const ui = render(<SharedDocumentEditor ref={handle} document={{ content: { blocks }, resources: emptyDocumentResources() }} revision="0" target={target}
    renderObject={renderObject} blockMoveDisabledReason={id => disabled === id ? '对象已锁定' : null} onDraft={() => {}} onSelection={selection} onChange={change} onUndo={() => {}} onRedo={() => {}} />)
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
  const block = (id: string) => ui.container.querySelector<HTMLElement>(`[data-flow-block-id="${id}"]`)!
  const position = (id: string) => { let result = -1; editor.view.state.doc.descendants((node, at) => { if (node.attrs.id === id) result = at }); return result }
  return { ui, handle, editor, change, selection, block, position }
}

describe('Flow unified selection and continuous input', () => {
  it('single-clicks select a paragraph without input or history; double-click edits the same PM and Esc returns to that paragraph', async () => {
    const h = mount(), root = h.editor.view.dom
    expect(root.getAttribute('contenteditable')).toBe('false')
    fireEvent.pointerDown(h.block('a'), { clientX: 50, clientY: 50, button: 0, pointerId: 7 })
    expect(vi.mocked(HTMLElement.prototype.setPointerCapture).mock.instances.at(-1)).toBe(h.block('a'))
    fireEvent.pointerUp(h.block('a'), { clientX: 50, clientY: 50, pointerId: 7 })
    expect(h.editor.view.state.selection).toBeInstanceOf(NodeSelection)
    expect(h.selection).toHaveBeenLastCalledWith({ kind: 'object', blockId: 'a', revision: '0' })
    expect(h.change).not.toHaveBeenCalled()
    expect(h.ui.getAllByRole('toolbar')).toHaveLength(1)
    vi.spyOn(h.editor.view, 'posAtCoords').mockReturnValue({ pos: h.position('a') + 2, inside: h.position('a') })
    fireEvent.doubleClick(h.block('a'), { clientX: 50, clientY: 50 })
    expect(h.editor.view.dom).toBe(root)
    expect(h.editor.isInputActive()).toBe(true)
    expect(h.editor.view.state.selection).toBeInstanceOf(TextSelection)
    expect(h.ui.getAllByRole('toolbar')).toHaveLength(1)
    expect(h.ui.getByRole('button', { name: '完成编辑' })).toBeTruthy()
    act(() => h.editor.view.dispatch(h.editor.view.state.tr.setSelection(TextSelection.create(h.editor.view.state.doc, h.position('b') + 1)).insertText('续')))
    expect(h.editor.view.dom).toBe(root)
    fireEvent.keyDown(root, { key: 'Escape' })
    await waitFor(() => expect(h.editor.isInputActive()).toBe(false))
    expect(h.editor.readSelection()).toMatchObject({ kind: 'object', blockId: 'b' })
    expect(fromEditorDocument(h.editor.view.state.doc).blocks[1]).toMatchObject(paragraph('b', '续Beta'))
    expect(h.change).toHaveBeenCalledTimes(1)
  })

  it('uses the same semantic column drop for a body drag and commits exactly once at the release coordinate', () => {
    const h = mount([group('grid', [group('left', [paragraph('c', 'Left')]), group('right', [paragraph('d', 'Right')])])])
    fireEvent.pointerDown(h.block('c'), { clientX: 50, clientY: 180, button: 0, pointerId: 2 })
    fireEvent.pointerMove(h.block('c'), { clientX: 370, clientY: 200, pointerId: 2 })
    expect(document.querySelector('.document-block-drop-indicator')).toBeTruthy()
    fireEvent.pointerUp(h.block('c'), { clientX: 380, clientY: 230, pointerId: 2 })
    expect(fromEditorDocument(h.editor.view.state.doc).blocks).toEqual([group('grid', [group('left', []), group('right', [paragraph('d', 'Right'), paragraph('c', 'Left')])])])
    expect(h.change).toHaveBeenCalledTimes(1)
    expect(h.editor.readSelection()).toMatchObject({ kind: 'object', blockId: 'c' })
    expect(h.editor.isInputActive()).toBe(false)
  })

  it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels a body preview through %s without a document write', kind => {
    const h = mount()
    fireEvent.pointerDown(h.block('a'), { clientX: 40, clientY: 50, button: 0, pointerId: 3 })
    fireEvent.pointerMove(h.block('a'), { clientX: 40, clientY: 130, pointerId: 3 })
    if (kind === 'Escape') fireEvent.keyDown(h.editor.view.dom, { key: 'Escape' })
    else fireEvent(h.block('a'), new TestPointerEvent(kind, { bubbles: true, pointerId: 3 }))
    fireEvent.pointerUp(h.block('a'), { clientX: 40, clientY: 130, pointerId: 3 })
    expect(h.change).not.toHaveBeenCalled()
    expect(fromEditorDocument(h.editor.view.state.doc).blocks.map(block => block.id)).toEqual(['a', 'b'])
    expect(document.querySelector('.document-block-drop-indicator')).toBeNull()
  })

  it('ignores another pointer and locked-body movement while keeping the locked block selectable', () => {
    const h = mount(undefined, 'flow', 'a')
    fireEvent.pointerDown(h.block('a'), { clientX: 40, clientY: 50, button: 0, pointerId: 3 })
    fireEvent.pointerMove(h.block('a'), { clientX: 40, clientY: 130, pointerId: 9 })
    fireEvent.pointerUp(h.block('a'), { clientX: 40, clientY: 130, pointerId: 9 })
    expect(h.editor.readSelection()).toMatchObject({ kind: 'object', blockId: 'a' })
    expect(h.change).not.toHaveBeenCalled()
    expect(document.querySelector('.document-block-drop-indicator')).toBeNull()
  })

  it('reuses the whole-block owner for realm pointers released while the current body input drains', async () => {
    const h = mount()
    act(() => h.handle.current!.focusBlock('a'))
    let acknowledge!: (ready: boolean) => void
    vi.spyOn(h.editor, 'drain').mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve }))
    act(() => {
      h.handle.current!.objectPointer({ blockId: 'a', phase: 'start', pointerId: 5, point: { x: 40, y: 50 } })
      h.handle.current!.objectPointer({ blockId: 'a', phase: 'end', pointerId: 5, point: { x: 40, y: 150 } })
    })
    expect(h.change).not.toHaveBeenCalled()
    await act(async () => acknowledge(true))
    expect(fromEditorDocument(h.editor.view.state.doc).blocks.map(block => block.id)).toEqual(['b', 'a'])
    expect(h.change).toHaveBeenCalledTimes(1)
    expect(h.editor.isInputActive()).toBe(false)
    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled()
  })

  it('formats all selected block text through the common controls without opening input', () => {
    const h = mount()
    fireEvent.pointerDown(h.block('a'), { button: 0, clientX: 40, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(h.block('a'), { clientX: 40, clientY: 50, pointerId: 1 })
    fireEvent.click(h.ui.getByRole('button', { name: '加粗' }))
    expect(fromEditorDocument(h.editor.view.state.doc).blocks[0]).toMatchObject({ content: { inlines: [{ text: 'Alpha', style: { bold: true } }] } })
    expect(fromEditorDocument(h.editor.view.state.doc).blocks[1]).toEqual(paragraph('b', 'Beta'))
    expect(h.editor.isInputActive()).toBe(false)
    expect(h.ui.getAllByRole('toolbar')).toHaveLength(1)
  })

  it('keeps native word selection and IME Escape inside continuous input, then lets an external click settle without reclaiming selection', async () => {
    const h = mount()
    act(() => h.handle.current!.focusBlock('a'))
    const hit = vi.spyOn(h.editor.view, 'posAtCoords')
    fireEvent.doubleClick(h.block('a'), { clientX: 40, clientY: 50 })
    expect(hit).not.toHaveBeenCalled()
    fireEvent.keyDown(h.editor.view.dom, { key: 'Escape', isComposing: true, keyCode: 229 })
    expect(h.editor.isInputActive()).toBe(true)
    h.selection.mockClear()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(h.editor.isInputActive()).toBe(false))
    expect(h.selection).not.toHaveBeenCalled()
    expect(h.change).not.toHaveBeenCalled()
  })

  it('hands a rendered component click out of continuous input without executing its authored button', async () => {
    const business = vi.fn()
    const h = mount([paragraph('a', 'Alpha'), { id: 'widget', type: 'course-instance' }], 'flow', undefined, (_block, host) => {
      host.dataset.componentRender = 'widget'
      const button = document.createElement('button'); button.textContent = '业务按钮'; button.addEventListener('click', business); host.append(button)
    })
    act(() => h.handle.current!.focusBlock('a'))
    const button = h.ui.getByRole('button', { name: '业务按钮' })
    fireEvent.pointerDown(button, { button: 0, clientX: 40, clientY: 110, pointerId: 4 })
    fireEvent.click(button)
    fireEvent.pointerUp(button, { clientX: 40, clientY: 110, pointerId: 4 })
    await waitFor(() => expect(h.editor.readSelection()).toMatchObject({ kind: 'object', blockId: 'widget' }))
    expect(h.editor.isInputActive()).toBe(false)
    expect(business).not.toHaveBeenCalled()
    expect(h.change).not.toHaveBeenCalled()
  })

  it('keeps file bodies directly editable and explicit Flow focus as immediate input', () => {
    const file = mount(undefined, 'file')
    expect(file.editor.isInputActive()).toBe(true)
    file.ui.unmount()
    const flow = mount()
    act(() => { expect(flow.handle.current!.focusBlock('b')).toBe(true) })
    expect(flow.editor.isInputActive()).toBe(true)
    expect(flow.editor.view.state.selection).toBeInstanceOf(TextSelection)
    expect(flow.change).not.toHaveBeenCalled()
  })
})
