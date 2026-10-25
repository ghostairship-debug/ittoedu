import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { editorShortcut } from '../../src/shared/editorShortcuts'
import { MediaFileEditor } from '../../src/renderer/documentFiles/media/MediaFileEditor'
import type { MediaFileSnapshot } from '../../src/shared/workbench/mediaFiles'

vi.mock('../../src/renderer/documentFiles/media/PdfPagePreview', () => ({ PdfPagePreview: () => null }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shares exact undo/redo/save aliases and leaves AltGr and IME commands to the input', () => {
  expect(editorShortcut({ key: 'z', ctrlKey: true })).toBe('undo')
  expect(editorShortcut({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo')
  expect(editorShortcut({ key: 'y', ctrlKey: true })).toBe('redo')
  expect(editorShortcut({ key: 's', ctrlKey: true, shiftKey: true })).toBe('save-as')
  expect(editorShortcut({ key: 's', ctrlKey: true, altKey: true })).toBeUndefined()
  expect(editorShortcut({ key: 's', ctrlKey: true, isComposing: true })).toBeUndefined()
  expect(editorShortcut({ key: 'z', ctrlKey: true, keyCode: 229 })).toBeUndefined()
})

it('uses the existing media undo/redo owner for CtrlY too, while preserving an active property input', async () => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:keys' }; static revokeObjectURL() {} })
  const snapshot: MediaFileSnapshot = { binding: { path: 'D:/picture.png', fileVersion: '1', bindingVersion: 1 }, content: { kind: 'image', bytes: new Uint8Array([1]), mimeType: 'image/png', width: 100, height: 100, editable: true } }
  render(<MediaFileEditor snapshot={snapshot} port={{ preview: async () => snapshot, save: async () => snapshot, reload: async () => snapshot }} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '顺时针旋转' })) })
  const editor = screen.getByRole('region', { name: '图片查看与编辑' })
  await act(async () => { fireEvent.keyDown(editor, { key: 'z', ctrlKey: true }) })
  expect(screen.getByRole('button', { name: '重做' })).toBeEnabled()
  const property = screen.getByLabelText('标注颜色')
  await act(async () => { fireEvent.keyDown(property, { key: 'y', ctrlKey: true }) })
  expect(screen.getByRole('button', { name: '重做' })).toBeEnabled()
  await act(async () => { fireEvent.keyDown(editor, { key: 'y', ctrlKey: true, isComposing: true }) })
  expect(screen.getByRole('button', { name: '重做' })).toBeEnabled()
  await act(async () => { fireEvent.keyDown(editor, { key: 'y', ctrlKey: true }) })
  expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
})
