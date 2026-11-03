import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocxFileEditor } from '../../src/renderer/documentFiles/office/DocxFileEditor'
import type { OfficeEditorHandle } from '../../src/renderer/documentFiles/office/officeEditorHandle'
import type { OfficeDocumentSnapshot } from '../../src/shared/workbench/officeDocument'
import type { OfficeLeafEditorProps } from '../../src/renderer/documentFiles/office/officeLeafEditorProps'
import * as wordKernel from '../../src/renderer/documentFiles/office/wordEditorKernel'
import { wordParagraphs } from '../../src/renderer/documentFiles/office/wordEditorModel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function snapshot(text = 'Original paragraph', version = 1): OfficeDocumentSnapshot {
  return { binding: { path: 'C:/word-fixture.docx', fileVersion: `file-${version}`, bindingVersion: version }, bytes: new Uint8Array(), history: { undoDepth: version - 1, redoDepth: 0, entries: [] },
    inspection: { format: 'docx', paragraphs: [{ index: 0, text, runs: [{ text, style: {} }], editable: true, structureEditable: true }], tables: [], body: [{ type: 'paragraph', index: 0 }] } }
}
async function input(text: string) {
  const paragraph = screen.getByRole('textbox', { name: '第 1 段' })
  await act(async () => { paragraph.textContent = text; fireEvent.input(paragraph, { inputType: 'insertText', data: text }); await Promise.resolve() })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('有未保存修改'))
  return paragraph
}
function captureKernel() {
  const create = wordKernel.createWordEditor
  let current!: ReturnType<typeof create>
  vi.spyOn(wordKernel, 'createWordEditor').mockImplementation((...args) => {
    current = create(...args); current.view.setProps({ handleScrollToSelection: () => true }); return current
  })
  return () => current
}
function paragraphsSnapshot(texts: string[], version: number): OfficeDocumentSnapshot {
  const result = snapshot(texts[0], version)
  result.inspection = { format: 'docx', paragraphs: texts.map((text, index) => ({ index, text, runs: [{ text, style: {} }], editable: true, structureEditable: true })),
    tables: [], body: texts.map((_, index) => ({ type: 'paragraph', index })) }
  return result
}
function deferredSnapshot() {
  let resolve!: (value: OfficeDocumentSnapshot) => void, reject!: (reason: Error) => void
  const promise = new Promise<OfficeDocumentSnapshot>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function append(getKernel: ReturnType<typeof captureKernel>, text: string, index = 0) {
  const view = getKernel().view, paragraph = wordParagraphs(view.state.doc)[index]
  view.dispatch(view.state.tr.insertText(text, paragraph.to))
}

describe('Word leaf editor lifecycle', () => {
  it('keeps native typing enabled while Ctrl+S is waiting for the file owner', async () => {
    let complete!: (value: OfficeDocumentSnapshot) => void
    const onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>(() => new Promise<OfficeDocumentSnapshot>(resolve => { complete = resolve }))
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor snapshot={snapshot()} {...props} />)
    await input('First draft')
    const body = screen.getByLabelText('Word 正文输入区')
    fireEvent.keyDown(body, { key: 's', code: 'KeyS', ctrlKey: true })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    const editableWhileSaving = body.getAttribute('contenteditable')
    await act(async () => { complete(snapshot('First draft', 2)) })
    expect(editableWhileSaving).toBe('true')
    expect(body).toHaveTextContent('First draft') // a lagging parent snapshot cannot roll back our own receipt
    await input('First draft continued')
    fireEvent.keyDown(body, { key: 's', code: 'KeyS', ctrlKey: true })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2)); expect(onEdit.mock.calls[1][0]).toEqual(snapshot('First draft', 2).binding)
    await act(async () => { complete(snapshot('First draft continued', 3)) })
    expect(body).toHaveTextContent('First draft continued')
    rendered.rerender(<DocxFileEditor snapshot={snapshot('New external version', 4)} {...props} />)
    expect(body).toHaveTextContent('New external version')
  })

  it('preserves immediate typing after Enter while its structural save is still in flight', async () => {
    const getKernel = captureKernel(), ref = createRef<OfficeEditorHandle>()
    let complete!: (value: OfficeDocumentSnapshot) => void
    const onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>(() => new Promise<OfficeDocumentSnapshot>(resolve => { complete = resolve })), dirty = vi.fn()
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn(), onDirtyChange: dirty }
    const rendered = render(<DocxFileEditor ref={ref} snapshot={snapshot('First')} {...props} />)
    await act(async () => { getKernel().focusParagraph(0, 5); fireEvent.keyDown(getKernel().view.dom, { key: 'Enter', code: 'Enter', keyCode: 13 }) })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    await act(async () => {
      const view = getKernel().view, paragraph = wordParagraphs(view.state.doc)[1]
      view.dispatch(view.state.tr.insertText('Second', paragraph.from))
    })
    const savedPrefix = paragraphsSnapshot(['First', ''], 2)
    await act(async () => { rendered.rerender(<DocxFileEditor ref={ref} snapshot={savedPrefix} {...props} />); complete(savedPrefix) })
    expect(screen.getByRole('textbox', { name: '第 2 段' })).toHaveTextContent('Second')
    expect(screen.getByRole('status')).toHaveTextContent('有未保存修改'); expect(dirty).toHaveBeenLastCalledWith(true)
    let flushed: Promise<boolean> | undefined
    await act(async () => { flushed = ref.current!.flush(); await Promise.resolve() })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2))
    expect(onEdit.mock.calls[1][0]).toEqual(savedPrefix.binding)
    expect(onEdit.mock.calls[1][1].edits).toEqual([{ type: 'replaceRange', start: { paragraph: 1, offset: 0 }, end: { paragraph: 1, offset: 0 }, paragraphs: [{ runs: [{ text: 'Second', style: { bold: false, italic: false, underline: false } }] }] }])
    const savedAll = paragraphsSnapshot(['First', 'Second'], 3)
    await act(async () => { rendered.rerender(<DocxFileEditor ref={ref} snapshot={savedAll} {...props} />); complete(savedAll); expect(await flushed).toBe(true) })
    expect(screen.getByRole('status')).toHaveTextContent('已保存')
  })

  it('retains the complete prefix and suffix with the original binding when a save fails', async () => {
    const getKernel = captureKernel(), ref = createRef<OfficeEditorHandle>(), deferred = deferredSnapshot()
    const onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>().mockReturnValueOnce(deferred.promise).mockRejectedValue(new Error('CAS conflict'))
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor ref={ref} snapshot={snapshot('A')} {...props} />)
    await act(async () => { append(getKernel, 'B') })
    let flushing!: Promise<boolean>
    await act(async () => { flushing = ref.current!.flush(); await Promise.resolve() })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    await act(async () => { append(getKernel, 'C'); rendered.rerender(<DocxFileEditor ref={ref} snapshot={snapshot('External', 9)} {...props} />); deferred.reject(new Error('CAS conflict')); expect(await flushing).toBe(false) })
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('ABC')
    await act(async () => { expect(await ref.current!.flush()).toBe(false) })
    expect(onEdit.mock.calls[1][0]).toEqual(snapshot('A').binding)
    expect(onEdit.mock.calls[1][1].edits).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('有未保存修改')
  })

  it('advances the suffix only to its own save receipt, never to an external snapshot', async () => {
    const getKernel = captureKernel(), ref = createRef<OfficeEditorHandle>(), deferred = deferredSnapshot()
    const onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>().mockReturnValueOnce(deferred.promise).mockRejectedValue(new Error('CAS conflict'))
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor ref={ref} snapshot={snapshot('A')} {...props} />)
    await act(async () => { append(getKernel, 'B') })
    let flushing!: Promise<boolean>
    await act(async () => { flushing = ref.current!.flush(); await Promise.resolve() })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    const receipt = snapshot('AB', 2)
    await act(async () => { append(getKernel, 'C'); rendered.rerender(<DocxFileEditor ref={ref} snapshot={snapshot('External', 9)} {...props} />); deferred.resolve(receipt); expect(await flushing).toBe(false) })
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('ABC')
    await act(async () => { expect(await ref.current!.flush()).toBe(false) })
    expect(onEdit.mock.calls[1][0]).toEqual(receipt.binding)
    expect(onEdit.mock.calls[1][1].edits).toHaveLength(1)
    expect(screen.getAllByRole('alert').map(node => node.textContent).join(' ')).toContain('文件已被其他操作更新')
  })

  it('does not reset a live IME composition when an earlier save is acknowledged', async () => {
    const getKernel = captureKernel(), ref = createRef<OfficeEditorHandle>(), first = deferredSnapshot(), second = deferredSnapshot()
    const onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor ref={ref} snapshot={snapshot('A')} {...props} />)
    await act(async () => { append(getKernel, 'B') })
    let firstFlush!: Promise<boolean>
    await act(async () => { firstFlush = ref.current!.flush(); await Promise.resolve() })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    const reset = vi.spyOn(getKernel(), 'reset'), body = screen.getByLabelText('Word 正文输入区')
    const receipt = snapshot('AB', 2)
    await act(async () => {
      fireEvent.compositionStart(body, { data: '' })
      const paragraph = screen.getByRole('textbox', { name: '第 1 段' }); paragraph.textContent = 'AB中'; fireEvent.input(paragraph, { inputType: 'insertCompositionText', data: '中' })
      rendered.rerender(<DocxFileEditor ref={ref} snapshot={receipt} {...props} />); first.resolve(receipt); expect(await firstFlush).toBe(false)
    })
    expect(reset).not.toHaveBeenCalled(); expect(body).toHaveTextContent('AB中'); expect(body).toHaveAttribute('contenteditable', 'true')
    await act(async () => { expect(await ref.current!.flush()).toBe(false) }); expect(onEdit).toHaveBeenCalledTimes(1)
    fireEvent.compositionEnd(body, { data: '中' })
    let finalFlush!: Promise<boolean>
    await act(async () => { finalFlush = ref.current!.flush(); await Promise.resolve() })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2)); expect(onEdit.mock.calls[1][0]).toEqual(receipt.binding)
    const final = snapshot('AB中', 3)
    await act(async () => { rendered.rerender(<DocxFileEditor ref={ref} snapshot={final} {...props} />); second.resolve(final); expect(await finalFlush).toBe(true) })
  })

  it('queues a later structural auto-save behind the current prefix with one writer', async () => {
    const getKernel = captureKernel(), first = deferredSnapshot(), second = deferredSnapshot()
    const onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor snapshot={snapshot('A')} {...props} />)
    await act(async () => { getKernel().focusParagraph(0, 1); fireEvent.keyDown(getKernel().view.dom, { key: 'Enter', keyCode: 13 }) })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    await act(async () => { getKernel().focusParagraph(1, 0); fireEvent.keyDown(getKernel().view.dom, { key: 'Enter', keyCode: 13 }) })
    expect(onEdit).toHaveBeenCalledTimes(1)
    const prefix = paragraphsSnapshot(['A', ''], 2)
    await act(async () => { rendered.rerender(<DocxFileEditor snapshot={prefix} {...props} />); first.resolve(prefix) })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2)); expect(onEdit.mock.calls[1][0]).toEqual(prefix.binding)
    const final = paragraphsSnapshot(['A', '', ''], 3)
    await act(async () => { rendered.rerender(<DocxFileEditor snapshot={final} {...props} />); second.resolve(final) })
    expect(screen.getAllByRole('textbox')).toHaveLength(3); expect(screen.getByRole('status')).toHaveTextContent('已保存')
  })

  it('waits for the in-flight prefix but refuses to call a moving suffix clean during send preparation', async () => {
    const getKernel = captureKernel(), ref = createRef<OfficeEditorHandle>(), first = deferredSnapshot(), second = deferredSnapshot()
    const onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor ref={ref} snapshot={snapshot('A')} {...props} />)
    await act(async () => { append(getKernel, 'B'); fireEvent.keyDown(getKernel().view.dom, { key: 's', ctrlKey: true }) })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    let sendFlush!: Promise<boolean>
    await act(async () => { append(getKernel, 'C'); sendFlush = ref.current!.flush(); await Promise.resolve() })
    expect(onEdit).toHaveBeenCalledTimes(1)
    const prefix = snapshot('AB', 2)
    await act(async () => { rendered.rerender(<DocxFileEditor ref={ref} snapshot={prefix} {...props} />); first.resolve(prefix) })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2)); expect(onEdit.mock.calls[1][0]).toEqual(prefix.binding)
    const next = snapshot('ABC', 3)
    await act(async () => { append(getKernel, 'D'); rendered.rerender(<DocxFileEditor ref={ref} snapshot={next} {...props} />); second.resolve(next); expect(await sendFlush).toBe(false) })
    expect(onEdit).toHaveBeenCalledTimes(2); expect(screen.getByRole('status')).toHaveTextContent('有未保存修改')
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('ABCD')
  })

  it('keeps an IME draft, rejects flush while composing, then saves once through the existing binding', async () => {
    const ref = createRef<OfficeEditorHandle>(), onEdit = vi.fn().mockResolvedValue(snapshot('中文输入', 2)), dirty = vi.fn()
    render(<DocxFileEditor ref={ref} snapshot={snapshot()} name="fixture.docx" onEdit={onEdit} onUndo={vi.fn()} onRedo={vi.fn()} onDirtyChange={dirty} />)
    const editor = screen.getByLabelText('Word 正文输入区')
    fireEvent.compositionStart(editor, { data: '' })
    const paragraph = await input('中文输入')
    let result: boolean | undefined
    await act(async () => { result = await ref.current!.flush() })
    expect(result).toBe(false); expect(onEdit).not.toHaveBeenCalled(); expect(paragraph.textContent).toBe('中文输入')
    expect(screen.getByRole('alert')).toHaveTextContent('请先完成当前输入')
    fireEvent.compositionEnd(editor, { data: '中文输入' })
    await act(async () => { result = await ref.current!.flush() })
    expect(result).toBe(true); expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0][0]).toEqual(snapshot().binding)
    expect(onEdit.mock.calls[0][1].edits[0].type).toBe('replaceRange')
    expect(screen.getByRole('status')).toHaveTextContent('已保存'); expect(dirty).toHaveBeenLastCalledWith(false)
  })

  it('retains a local draft across an external snapshot and a rejected CAS save', async () => {
    const ref = createRef<OfficeEditorHandle>(), onEdit = vi.fn().mockRejectedValue(new Error('文件绑定已失效'))
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor ref={ref} snapshot={snapshot()} {...props} />)
    await input('Human draft')
    rendered.rerender(<DocxFileEditor ref={ref} snapshot={snapshot('External owner text', 2)} {...props} />)
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('Human draft')
    let saved: boolean | undefined
    await act(async () => { saved = await ref.current!.flush() })
    expect(saved).toBe(false); expect(onEdit.mock.calls[0][0]).toEqual(snapshot().binding)
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('Human draft')
    expect(screen.getByRole('status')).toHaveTextContent('有未保存修改')
    expect(screen.getAllByRole('alert').map(node => node.textContent).join(' ')).toContain('文件绑定已失效')
  })

  it('refreshes a clean external update and routes undo to the shared file history', async () => {
    const onUndo = vi.fn().mockResolvedValue(undefined), onEdit = vi.fn(), props = { name: 'fixture.docx', onEdit, onUndo, onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor snapshot={snapshot()} {...props} />)
    rendered.rerender(<DocxFileEditor snapshot={snapshot('AI update', 2)} {...props} />)
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('AI update')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '撤销' })) })
    expect(onUndo).toHaveBeenCalledTimes(1); expect(onEdit).not.toHaveBeenCalled()
    rendered.rerender(<DocxFileEditor snapshot={{ ...snapshot('Original paragraph', 3), history: { undoDepth: 0, redoDepth: 1, entries: [] } }} {...props} />)
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('Original paragraph')
  })

  it('captures the pre-input binding before an external render can outrun PM DOM observation', async () => {
    const original = snapshot(), onEdit = vi.fn().mockRejectedValue(new Error('version conflict'))
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor snapshot={original} {...props} />)
    const paragraph = screen.getByRole('textbox', { name: '第 1 段' })
    paragraph.textContent = 'Immediate human draft'; fireEvent.input(paragraph)
    rendered.rerender(<DocxFileEditor snapshot={snapshot('External version', 2)} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(onEdit.mock.calls[0][0]).toEqual(original.binding)
    expect(screen.getByRole('textbox', { name: '第 1 段' })).toHaveTextContent('Immediate human draft')
  })

  it('allows the shared history owner to reenter flush after the draft has drained', async () => {
    const ref = createRef<OfficeEditorHandle>(), completed = vi.fn()
    const onUndo = vi.fn(async () => { completed(await ref.current!.flush()) })
    render(<DocxFileEditor ref={ref} snapshot={snapshot('Saved', 2)} name="fixture.docx" onEdit={vi.fn()} onUndo={onUndo} onRedo={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(completed).toHaveBeenCalledWith(true))
  })

  it('dispatches each body keyboard history action only once through PM and the surrounding toolbar', async () => {
    const onUndo = vi.fn().mockResolvedValue(undefined), onRedo = vi.fn().mockResolvedValue(undefined)
    render(<DocxFileEditor snapshot={snapshot('Saved', 2)} name="fixture.docx" onEdit={vi.fn()} onUndo={onUndo} onRedo={onRedo} />)
    const body = screen.getByLabelText('Word 正文输入区')
    await act(async () => { fireEvent.keyDown(body, { key: 'z', code: 'KeyZ', ctrlKey: true }) })
    expect(onUndo).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.keyDown(body, { key: 'y', code: 'KeyY', ctrlKey: true }) })
    expect(onRedo).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.keyDown(body, { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true }) })
    expect(onRedo).toHaveBeenCalledTimes(2); expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('keeps the original Word input focused throughout an ordinary asynchronous save', async () => {
    captureKernel()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let complete!: (value: OfficeDocumentSnapshot) => void
    const onEdit = vi.fn(() => new Promise<OfficeDocumentSnapshot>(resolve => { complete = resolve }))
    render(<DocxFileEditor snapshot={snapshot()} name="fixture.docx" onEdit={onEdit} onUndo={vi.fn()} onRedo={vi.fn()} />)
    await input('Continuous input')
    const body = screen.getByLabelText('Word 正文输入区'); body.tabIndex = 0; body.focus()
    fireEvent.keyDown(body, { key: 's', code: 'KeyS', ctrlKey: true })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(body).toHaveAttribute('contenteditable', 'true'); expect(body).toHaveFocus()
    await act(async () => { complete(snapshot('Continuous input', 2)) })
    expect(screen.getByRole('status')).toHaveTextContent('已保存')
    expect(body).toHaveFocus()
  })

  it('does not reclaim focus when the user moves to another control during the save', async () => {
    captureKernel()
    let complete!: (value: OfficeDocumentSnapshot) => void
    const onEdit = vi.fn(() => new Promise<OfficeDocumentSnapshot>(resolve => { complete = resolve }))
    render(<><DocxFileEditor snapshot={snapshot()} name="fixture.docx" onEdit={onEdit} onUndo={vi.fn()} onRedo={vi.fn()} /><button>Other control</button></>)
    await input('Pending input')
    const body = screen.getByLabelText('Word 正文输入区'); body.tabIndex = 0; body.focus()
    fireEvent.keyDown(body, { key: 's', code: 'KeyS', ctrlKey: true })
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    const other = screen.getByRole('button', { name: 'Other control' }); fireEvent.pointerDown(other); other.focus()
    await act(async () => { complete(snapshot('Pending input', 2)) })
    expect(screen.getByRole('status')).toHaveTextContent('已保存')
    expect(other).toHaveFocus()
  })

  it('keeps the History input lease but cancels focus restoration after the user moves away', async () => {
    captureKernel(); vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let finish!: () => void
    const onUndo = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    render(<><DocxFileEditor snapshot={snapshot('Saved', 2)} name="fixture.docx" onEdit={vi.fn()} onUndo={onUndo} onRedo={vi.fn()} /><button>Other control</button></>)
    const body = screen.getByLabelText('Word 正文输入区'); body.tabIndex = 0; body.focus()
    fireEvent.keyDown(body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1)); expect(body).toHaveAttribute('contenteditable', 'false')
    const other = screen.getByRole('button', { name: 'Other control' }); fireEvent.pointerDown(other); other.focus()
    await act(async () => { finish() })
    expect(body).toHaveAttribute('contenteditable', 'true'); expect(other).toHaveFocus()
  })

  it('keeps OOXML-only toolbar commands locked until their projection arrives', async () => {
    captureKernel(); vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const deferred = deferredSnapshot(), onEdit = vi.fn<OfficeLeafEditorProps['onEdit']>().mockReturnValue(deferred.promise)
    const props = { name: 'fixture.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const rendered = render(<DocxFileEditor snapshot={snapshot()} {...props} />)
    const body = screen.getByLabelText('Word 正文输入区'); body.tabIndex = 0; body.focus()
    fireEvent.click(screen.getByRole('button', { name: '加粗' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1)); expect(body).toHaveAttribute('contenteditable', 'false'); body.blur()
    const saved = snapshot('Original paragraph', 2)
    if (saved.inspection.format === 'docx') saved.inspection.paragraphs[0].runs![0].style.bold = true
    await act(async () => { rendered.rerender(<DocxFileEditor snapshot={saved} {...props} />); deferred.resolve(saved) })
    expect(body).toHaveAttribute('contenteditable', 'true'); expect(body).toHaveFocus()
  })
})
