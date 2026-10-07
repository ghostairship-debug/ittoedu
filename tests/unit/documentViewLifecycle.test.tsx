import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import * as sessions from '../../src/renderer/document/editorSession'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import type { MarkdownDocument } from '../../src/shared/document/markdown'

it('deactivates hits and portals while retaining unacknowledged input and its commit owner', async () => {
  const factory = vi.spyOn(sessions, 'createLayoutEditor')
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 600, 400))
  let reject: (accepted: boolean) => void = () => {}
  const ack = new Promise<boolean>(resolve => { reject = resolve })
  const originalOwner = vi.fn(() => ack), nextOwner = vi.fn(() => true), originalDraft = vi.fn()
  const handle = createRef<SharedDocumentEditorHandle>()
  const document: MarkdownDocument = { content: { blocks: [{ id: 'body', type: 'paragraph', content: { inlines: [{ type: 'text', text: '原正文' }] } }] }, resources: emptyDocumentResources() }
  const host = window.document.createElement('div'); window.document.body.append(host)
  const props = { document, revision: '1', target: 'file' as const, toolbarHost: host,
    onChange: originalOwner, onDraft: originalDraft, onUndo() {}, onRedo() {} }
  const ui = render(<SharedDocumentEditor ref={handle} {...props} />)
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
  try {
    act(() => { editor.view.focus(); editor.view.dispatch(editor.view.state.tr.insertText('待确认', 1)) })
    expect(originalOwner).toHaveBeenCalledOnce()
    const originalDom = editor.view.dom
    expect(within(host).getByRole('toolbar', { name: '正文工具' })).toBeInTheDocument()
    fireEvent.contextMenu(editor.view.dom.querySelector('[data-flow-block-id="body"]')!, { clientX: 100, clientY: 100 })
    expect(screen.getByRole('menu', { name: '段落操作' })).toBeInTheDocument()

    ui.rerender(<SharedDocumentEditor ref={handle} {...props} active={false} revision="2" onChange={nextOwner} />)
    expect(ui.container.firstChild).toHaveAttribute('inert')
    expect(within(host).queryByRole('toolbar')).toBeNull()
    expect(screen.queryByRole('menu', { name: '段落操作' })).toBeNull()
    expect(screen.queryByRole('button', { name: '插入段落' })).toBeNull()
    expect(handle.current!.focusAtClientPoint({ x: 100, y: 100 })).toBe(false)
    expect(editor.view.dom).toBe(originalDom)
    expect(editor.view.isDestroyed).toBe(false)
    expect(editor.view.state.doc.textContent).toBe('待确认原正文')
    await act(async () => reject(false))
    expect(await handle.current!.drain()).toMatchObject({ ready: false, source: expect.stringContaining('待确认原正文') })

    ui.rerender(<SharedDocumentEditor ref={handle} {...props} active revision="2" onChange={nextOwner} />)
    expect(within(host).getByRole('toolbar', { name: '正文工具' })).toBeInTheDocument()
    expect(editor.view.dom).toBe(originalDom)
    act(() => editor.view.dispatch(editor.view.state.tr.insertText('继续', 1)))
    expect(originalOwner).toHaveBeenCalledTimes(2)
    expect(nextOwner).not.toHaveBeenCalled()
    expect(editor.view.state.doc.textContent).toBe('继续待确认原正文')
  } finally { cleanup(); host.remove(); geometry.mockRestore(); factory.mockRestore() }
})
