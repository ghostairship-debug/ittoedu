import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PlainTextDocumentEditor } from '../../src/renderer/documentFiles/PlainTextDocumentEditor'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('routes both redo aliases through the existing source editor history owner', () => {
  const undo = vi.fn(), redo = vi.fn()
  const view = render(<PlainTextDocumentEditor source="draft" revision={0} onDraft={() => {}} onUndo={undo} onRedo={redo} />)
  const input = view.getByRole('textbox', { name: '纯文本编辑' })
  input.focus()
  fireEvent.keyDown(input, { key: 'Z', code: 'KeyZ', keyCode: 90, ctrlKey: true, shiftKey: true })
  expect(redo).toHaveBeenCalledOnce()
  fireEvent.keyDown(input, { key: 'y', code: 'KeyY', keyCode: 89, ctrlKey: true })
  expect(redo).toHaveBeenCalledTimes(2)
  fireEvent.keyDown(input, { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true })
  expect(undo).toHaveBeenCalledOnce()
})
