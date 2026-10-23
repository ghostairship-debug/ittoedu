import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as sessions from '../../src/renderer/document/editorSession'
import { SharedDocumentEditor } from '../../src/renderer/document/SharedDocumentEditor'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each(['file', 'flow'] as const)('%s retains the handle through synchronous blur publication and hides it outside the editor', async target => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 80, top: 100, right: 580, bottom: 130, width: 500, height: 30 } as DOMRect)
  const factory = vi.spyOn(sessions, 'createLayoutEditor')
  const parsed = parseDocumentMarkdown('First paragraph.\n\nSecond paragraph.\n', { target, createId: () => crypto.randomUUID() })
  if (parsed.status !== 'valid') throw new Error('Invalid fixture')
  render(<><SharedDocumentEditor document={parsed.document} revision="0" target={target}
    onDraft={() => {}} onChange={() => true} onUndo={() => {}} onRedo={() => {}} /><button>Outside editor</button></>)
  const editor = factory.mock.results[0].value as ReturnType<typeof sessions.createLayoutEditor>
  act(() => { editor.view.focus() })
  const handle = screen.getByRole('button', { name: '段落操作' })
  act(() => {
    fireEvent.blur(editor.view.dom, { relatedTarget: handle })
    // Flow's blur boundary publishes editor state before the browser focuses the handle.
    factory.mock.calls[0][1].stateChanged?.(editor.view.state)
  })
  expect(handle.isConnected).toBe(true)
  act(() => { handle.focus() })
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(screen.getByRole('button', { name: '段落操作' })).toBe(handle)
  fireEvent.click(handle)
  expect(screen.getByRole('menuitem', { name: '下方插入正文' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '删除段落' })).toBeTruthy()
  act(() => { screen.getByRole('button', { name: 'Outside editor' }).focus() })
  await waitFor(() => expect(screen.queryByRole('button', { name: '段落操作' })).toBeNull())
  act(() => { editor.view.focus() })
  fireEvent.click(screen.getByRole('button', { name: '段落操作' }))
  fireEvent.pointerDown(document.body)
  await waitFor(() => expect(screen.queryByRole('button', { name: '段落操作' })).toBeNull())
})
