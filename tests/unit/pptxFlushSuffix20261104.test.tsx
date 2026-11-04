// @vitest-environment jsdom
import React, { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import PptxGenJS from 'pptxgenjs'
import type { EditorSession, SlideEditor, SlideEditorOptions } from '@web-ppt/editor'
import type { OfficeEditorHandle } from '../../src/renderer/documentFiles/office/officeEditorHandle'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { PptxFileEditor } from '../../src/renderer/documentFiles/office/PptxFileEditor'

const sessions = vi.hoisted(() => [] as EditorSession[])
vi.mock('@web-ppt/editor', async original => {
  const actual = await original<typeof import('@web-ppt/editor')>()
  return { ...actual, openEditor: async (...args: Parameters<typeof actual.openEditor>) => {
    const session = await actual.openEditor(...args); sessions.push(session)
    session.mount = (container: HTMLElement, options: SlideEditorOptions = {}) => {
      let slideId = options.slideId ?? session.editor.doc.slideOrder[0]
      const element = document.createElement('div'); container.append(element)
      return { element, get slideId() { return slideId }, destroyed: false,
        setSlide(id: string) { slideId = id }, setZoom() {}, registerTextUi() { return () => {} },
        queryRunProps() { return null }, destroy() { element.remove() } } as unknown as SlideEditor
    }
    return session
  } }
})
vi.mock('../../src/renderer/documentFiles/office/PptxFilePreview', () => ({ PptxFilePreview: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessions.length = 0 })

test('flush preserves later canvas edits and reports that the draft still needs synchronization', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const ppt = new PptxGenJS(); ppt.addSlide().addText('A', { x: 1, y: 1, w: 3, h: 1 })
  const bytes = await ppt.write({ outputType: 'uint8array' }) as Uint8Array
  const inspection = inspectOfficeContent(bytes, 'pptx')
  if (inspection.format !== 'pptx') throw new Error('PPT fixture expected')
  const snapshot = { binding: { path: 'test.pptx', bindingVersion: 1, fileVersion: 'v1' }, bytes, inspection,
    history: { undoDepth: 0, redoDepth: 0, entries: [] } }
  let finish!: () => void
  const onCommit = vi.fn((_binding, savedBytes: Uint8Array) => new Promise<typeof snapshot>(resolve => {
    finish = () => resolve({ ...snapshot, bytes: savedBytes, binding: { ...snapshot.binding, fileVersion: 'v2' } })
  }))
  const ref = createRef<OfficeEditorHandle>()
  render(<PptxFileEditor ref={ref} snapshot={snapshot} name="test.pptx" onCommit={onCommit}
    onUndo={async () => {}} onRedo={async () => {}} onReload={async () => {}} onDirtyChange={() => {}} onFocusChange={() => {}} />)
  await waitFor(() => expect(screen.getByTestId('pptx-edit-surface').firstElementChild).not.toBeNull())
  const editor = sessions[0].editor, id = editor.doc.slides[editor.doc.slideOrder[0]].children[0]
  act(() => { editor.exec({ type: 'SetXfrm', id, x: 200 }) })
  let result!: Promise<boolean>
  act(() => { result = ref.current!.flush() })
  await waitFor(() => expect(onCommit).toHaveBeenCalledOnce())
  act(() => { editor.exec({ type: 'SetXfrm', id, x: 300 }) })
  await act(async () => { finish(); expect(await result).toBe(false) })
  expect(editor.effectiveElement(id).x).toBe(300)
  expect(editor.isDirty()).toBe(true)
})

test('save waits for a pending shared history action before reporting completion', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const ppt = new PptxGenJS(); ppt.addSlide().addText('A', { x: 1, y: 1, w: 3, h: 1 })
  const bytes = await ppt.write({ outputType: 'uint8array' }) as Uint8Array
  const inspection = inspectOfficeContent(bytes, 'pptx')
  if (inspection.format !== 'pptx') throw new Error('PPT fixture expected')
  const snapshot = { binding: { path: 'test.pptx', bindingVersion: 1, fileVersion: 'v1' }, bytes, inspection,
    history: { undoDepth: 1, redoDepth: 1, entries: [] } }
  let finish!: () => void
  const redo = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const ref = createRef<OfficeEditorHandle>()
  render(<PptxFileEditor ref={ref} snapshot={snapshot} name="test.pptx" onCommit={async () => snapshot}
    onUndo={async () => {}} onRedo={redo} onReload={async () => {}} onDirtyChange={() => {}} onFocusChange={() => {}} />)
  await waitFor(() => expect(screen.getByTestId('pptx-edit-surface').firstElementChild).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  await waitFor(() => expect(redo).toHaveBeenCalledOnce())
  let done = false
  const saving = ref.current!.flush().then(value => { done = true; return value })
  await act(async () => { await Promise.resolve() })
  expect(done).toBe(false)
  await act(async () => { finish(); expect(await saving).toBe(true) })
})
