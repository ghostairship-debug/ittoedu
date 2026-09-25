import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { useDocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import type { LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'

const roots: string[] = []
afterEach(async () => {
  cleanup()
  document.body.replaceChildren()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

it('M02 routes Ctrl+Shift+S to exactly one Save As even when the editor also handles the shortcut', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m02-shortcut-'))
  roots.push(root)
  const host = createMarkdownTestHost(root)
  const unavailable = async (): Promise<never> => { throw new Error('Legacy file path is unused by this shortcut test') }
  const port: RecoverableDocumentFilePort = { documents: host.documents, openDocument: unavailable, saveDocument: unavailable, watchDocument: () => () => {} }
  const { result } = renderHook(() => useDocumentTabsController({ documentPort: port }))
  await act(async () => { await result.current.createMarkdown() })
  const id = result.current.activeTab
  const flush = vi.fn(async () => true)
  const saveAs = vi.fn(async () => true)
  const editor = { session: { documentId: id, subscribe: () => () => {} }, flush, saveAs } as unknown as LessonDocumentEditorHandle
  act(() => { result.current.registerEditor(id, editor) })

  const section = document.createElement('section')
  section.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') void saveAs()
  })
  document.body.append(section)
  await act(async () => {
    section.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  })
  expect(flush).not.toHaveBeenCalled()
  expect(saveAs).toHaveBeenCalledOnce()

  const outsideEditor = document.createElement('button')
  document.body.append(outsideEditor)
  await act(async () => {
    outsideEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  })
  expect(saveAs).toHaveBeenCalledTimes(2)
})
