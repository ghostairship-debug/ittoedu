import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useContentEditorMode } from '../../src/renderer/documents/useContentEditorMode'

function host(initial: { documentId: string | null; focused: boolean }) {
  const enter = vi.fn(), exit = vi.fn()
  const view = renderHook(
    ({ documentId, focused }) => useContentEditorMode(documentId, focused, enter, exit),
    { initialProps: initial },
  )
  return { ...view, enter, exit }
}

it('keeps a document created or opened from inside the editor in the editor', () => {
  const { result, rerender, enter, exit } = host({ documentId: 'a', focused: false })
  act(() => result.current.setMode('deep'))
  expect(enter).toHaveBeenCalledTimes(1)
  rerender({ documentId: 'a', focused: true })
  rerender({ documentId: 'b', focused: true })
  expect(exit).not.toHaveBeenCalled()
  expect(result.current.mode).toBe('deep')
})

it('never enters the editor by itself when the workbench switches documents', () => {
  const { rerender, enter, result } = host({ documentId: 'a', focused: false })
  rerender({ documentId: 'b', focused: false })
  expect(enter).not.toHaveBeenCalled()
  expect(result.current.mode).toBe('light')
})

it('returns to the workbench when the editor is left without a document', () => {
  const { result, rerender, exit } = host({ documentId: 'a', focused: false })
  act(() => result.current.setMode('deep'))
  rerender({ documentId: 'a', focused: true })
  rerender({ documentId: null, focused: true })
  expect(exit).toHaveBeenCalledTimes(1)
})
