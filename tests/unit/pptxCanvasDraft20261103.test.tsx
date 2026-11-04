// @vitest-environment jsdom
import { createRef } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PptxGenJS from 'pptxgenjs'
import type { EditorSession, SlideEditor, SlideEditorOptions } from '@web-ppt/editor'
import type { PptxPreviewSnapshot } from '../../src/shared/workbench/officePreview'
import type { OfficeEditorHandle } from '../../src/renderer/documentFiles/office/officeEditorHandle'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { PptxFileEditor } from '../../src/renderer/documentFiles/office/PptxFileEditor'
import { copyPptxObjects } from '../../src/renderer/documentFiles/office/pptxCanvasCommands'

const opened = vi.hoisted(() => [] as EditorSession[])
vi.mock('@web-ppt/editor', async original => {
  const actual = await original<typeof import('@web-ppt/editor')>()
  return { ...actual, openEditor: vi.fn(async (...args: Parameters<typeof actual.openEditor>) => {
    const session = await actual.openEditor(...args); opened.push(session)
    // Keep the real document/parser/commands. Only browser rendering is replaced;
    // geometry/text paint is covered by the Electron canvas test, not jsdom.
    session.mount = (container: HTMLElement, options: SlideEditorOptions = {}) => {
      let slideId = options.slideId ?? session.editor.doc.slideOrder[0], destroyed = false
      const element = document.createElement('div'); element.tabIndex = 0; container.append(element)
      return {
        element, get slideId() { return slideId }, get destroyed() { return destroyed },
        setSlide(id: string) { slideId = id; session.editor.select({ kind: 'none' }); options.onSlideChange?.(id) },
        setZoom() {}, registerTextUi() { return () => {} }, queryRunProps() { return null },
        destroy() { destroyed = true; element.remove() },
      } as unknown as SlideEditor
    }
    return session
  }) }
})
vi.mock('../../src/renderer/documentFiles/office/PptxFilePreview', () => ({ PptxFilePreview: () => null }))
let original: PptxPreviewSnapshot, changed: PptxPreviewSnapshot, removed: PptxPreviewSnapshot
beforeAll(async () => {
  async function fixture(title: string, version: string, keepSecond = true): Promise<PptxPreviewSnapshot> {
    const ppt = new PptxGenJS(), slide = ppt.addSlide(); ppt.layout = 'LAYOUT_WIDE'
    slide.addText(title, { x: 1, y: 1, w: 5, h: 1, fontSize: 24 })
    if (keepSecond) slide.addText('第二个对象', { x: 1, y: 3, w: 5, h: 1 })
    const bytes = await ppt.write({ outputType: 'uint8array' }); if (!(bytes instanceof Uint8Array)) throw new Error('fixture expected')
    const inspection = inspectOfficeContent(bytes, 'pptx'); if (inspection.format !== 'pptx') throw new Error('PPT inspection expected')
    return { binding: { path: 'D:/canvas.pptx', bindingVersion: 1, fileVersion: version }, bytes, inspection, history: { undoDepth: 1, redoDepth: 0, entries: [] } }
  }
  original = await fixture('人工原件', 'v1'); changed = await fixture('模型新内容', 'v2'); removed = await fixture('删除之后', 'v3', false)
})
beforeEach(() => {
  opened.length = 0
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function props() {
  return { snapshot: original, name: 'canvas.pptx', onCommit: vi.fn(async (_binding, bytes: Uint8Array) => ({ ...original, bytes, binding: { ...original.binding, fileVersion: 'saved' } })),
    onUndo: vi.fn(async () => {}), onRedo: vi.fn(async () => {}), onReload: vi.fn(async () => {}), onEdit: vi.fn(async () => {}), onDirtyChange: vi.fn(), onFocusChange: vi.fn() }
}
async function ready() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    // Session readiness precedes the passive mount effect; user canvas actions
    // require the mounted view, as the Electron test's painted-text wait does.
    expect(screen.getByTestId('pptx-edit-surface').firstElementChild).not.toBeNull()
  })
  await act(async () => { await Promise.resolve() })
  return opened[0].editor
}

describe('PPT host draft, clipboard and focus boundaries', () => {
  it('preserves a property draft across refresh, refuses a stale apply and loads the new content after cancel', async () => {
    const callbacks = props(), rendered = render(<PptxFileEditor {...callbacks} />), editor = await ready()
    const id = editor.doc.slides[editor.doc.slideOrder[0]].children[1]
    act(() => editor.select({ kind: 'elements', ids: [id], enteredGroup: null }))
    fireEvent.click(screen.getByRole('button', { name: '精细属性' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '对象文字' }), { target: { value: '未提交的属性输入' } })
    rendered.rerender(<PptxFileEditor {...callbacks} snapshot={changed} />)
    expect(screen.getByRole('textbox', { name: '对象文字' })).toHaveValue('未提交的属性输入')
    expect(opened).toHaveLength(1)
    expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }))
    expect(await screen.findByText('属性输入基于旧版本，未覆盖新内容。请取消输入并重新选择对象。')).toBeInTheDocument()
    expect(callbacks.onEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消当前输入' }))
    await waitFor(() => expect(opened).toHaveLength(2))
    await waitFor(() => expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(false))
    expect(opened[1].editor.toSlide(opened[1].editor.doc.slideOrder[0]).elements.some(element => element.kind === 'shape' && element.text?.paragraphs.some(p => p.runs.some(r => r.text === '模型新内容')))).toBe(true)
  })

  it('retains the real dirty property panel when an external revision removes its object', async () => {
    const callbacks = props(), rendered = render(<PptxFileEditor {...callbacks} />), editor = await ready()
    const id = editor.doc.slides[editor.doc.slideOrder[0]].children[1]
    act(() => editor.select({ kind: 'elements', ids: [id], enteredGroup: null }))
    fireEvent.click(screen.getByRole('button', { name: '精细属性' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '对象文字' }), { target: { value: '删除前的人工作品' } })
    expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true)
    rendered.rerender(<PptxFileEditor {...callbacks} snapshot={removed} />)
    expect(screen.getByRole('textbox', { name: '对象文字' })).toHaveValue('删除前的人工作品')
    expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(opened).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }))
    expect(await screen.findByText('属性输入基于旧版本，未覆盖新内容。请取消输入并重新选择对象。')).toBeInTheDocument()
    expect(callbacks.onEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消当前输入' }))
    await waitFor(() => expect(opened).toHaveLength(2))
    expect(screen.queryByRole('textbox', { name: '对象文字' })).not.toBeInTheDocument()
    expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('routes object layer shortcuts through the same contiguous-selection commands as the toolbar', async () => {
    const callbacks = props(); render(<PptxFileEditor {...callbacks} />)
    const editor = await ready(), slideId = editor.doc.slideOrder[0]
    fireEvent.click(screen.getByRole('button', { name: '插入文本框' }))
    const ids = [...editor.doc.slides[slideId].children]
    act(() => editor.select({ kind: 'elements', ids: ids.slice(0, 2), enteredGroup: null }))
    fireEvent.keyDown(screen.getByTestId('pptx-edit-surface').firstElementChild!, { key: ']', code: 'BracketRight', ctrlKey: true })
    expect(editor.doc.slides[slideId].children).toEqual([ids[2], ids[0], ids[1]])
  })

  it('routes duplicate for structurally edited tables through the same native clipboard projection as the menu', async () => {
    const callbacks = props(); render(<PptxFileEditor {...callbacks} />)
    const editor = await ready(), slideId = editor.doc.slideOrder[0]
    act(() => {
      editor.exec({ type: 'AddTable', slideId, rows: 2, cols: 2, rect: { x: 60, y: 200, w: 400, h: 150 } })
      if (editor.selection.kind !== 'elements') throw new Error('table selection expected')
      editor.exec({ type: 'InsertColumn', id: editor.selection.ids[0] })
    })
    fireEvent.keyDown(screen.getByTestId('pptx-edit-surface').firstElementChild!, { key: 'd', code: 'KeyD', ctrlKey: true })
    expect(Object.values(editor.doc.elements).filter(record => record.src.kind === 'table')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a canvas draft on external refresh and commits with the original CAS binding', async () => {
    const callbacks = props(), ref = createRef<OfficeEditorHandle>()
    callbacks.onCommit.mockRejectedValue(new Error('version conflict'))
    const rendered = render(<PptxFileEditor ref={ref} {...callbacks} />), editor = await ready()
    const id = editor.doc.slides[editor.doc.slideOrder[0]].children[0]
    act(() => editor.exec({ type: 'SetXfrm', id, x: 210 }))
    rendered.rerender(<PptxFileEditor ref={ref} {...callbacks} snapshot={changed} />)
    expect(opened).toHaveLength(1)
    await act(async () => { expect(await ref.current!.flush()).toBe(false) })
    expect(callbacks.onCommit).toHaveBeenCalledTimes(1)
    expect(callbacks.onCommit.mock.calls[0][0]).toEqual(original.binding)
    expect(editor.effectiveElement(id).x).toBe(210)
    expect(editor.isDirty()).toBe(true)
    expect(screen.getByText('version conflict')).toBeInTheDocument()
  })

  it('does not cut a newly selected object when the clipboard write completes late', async () => {
    let finish!: () => void
    const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const callbacks = props(); render(<PptxFileEditor {...callbacks} />)
    const editor = await ready(), slideId = editor.doc.slideOrder[0], ids = [...editor.doc.slides[slideId].children]
    act(() => editor.select({ kind: 'elements', ids: [ids[0]], enteredGroup: null }))
    fireEvent.click(await screen.findByRole('button', { name: '更多对象与文字操作' }))
    fireEvent.click(screen.getByRole('button', { name: '剪切对象（Ctrl+X）' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    act(() => editor.select({ kind: 'elements', ids: [ids[1]], enteredGroup: null }))
    await act(async () => { finish(); await Promise.resolve() })
    expect(editor.doc.slides[slideId].children).toEqual(ids)
    expect(editor.isDirty()).toBe(false)
    expect(screen.getByRole('alert')).toHaveTextContent('对象已复制，尚未剪切')
  })

  it('refuses a late paste after the user changes the entered group without modifying the document', async () => {
    let finish!: (text: string) => void
    const readText = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
    const callbacks = props(); render(<PptxFileEditor {...callbacks} />)
    const editor = await ready(), slideId = editor.doc.slideOrder[0], ids = [...editor.doc.slides[slideId].children]
    act(() => editor.exec({ type: 'Group', ids }))
    if (editor.selection.kind !== 'elements') throw new Error('group selection expected')
    const group = editor.selection.ids[0]
    act(() => editor.select({ kind: 'elements', ids: [ids[0]], enteredGroup: group }))
    const payload = JSON.stringify(copyPptxObjects(editor, slideId)), count = Object.keys(editor.doc.elements).length
    fireEvent.click(screen.getByRole('button', { name: '页面操作' }))
    fireEvent.click(screen.getByRole('button', { name: '粘贴对象（Ctrl+V）' }))
    act(() => editor.select({ kind: 'elements', ids: [group], enteredGroup: null }))
    await act(async () => { finish(payload); await Promise.resolve() })
    expect(Object.keys(editor.doc.elements)).toHaveLength(count)
    expect(screen.getByRole('alert')).toHaveTextContent('编辑目标已改变，请重新粘贴')
  })

  it('formats a newly selected text box without a caret, commits once and publishes its current shape reference', async () => {
    const callbacks = props(), ref = createRef<OfficeEditorHandle>(); render(<PptxFileEditor ref={ref} {...callbacks} />)
    const editor = await ready(), slideId = editor.doc.slideOrder[0]
    fireEvent.click(screen.getByRole('button', { name: '插入文本框' }))
    fireEvent.click(await screen.findByRole('button', { name: '更多对象与文字操作' }))
    expect(screen.getByRole('combobox', { name: '字号' })).toBeEnabled()
    expect(screen.getByLabelText('文字颜色')).toHaveValue('#202124')
    fireEvent.change(screen.getByRole('combobox', { name: '字号' }), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: '加粗' }))
    await act(async () => { expect(await ref.current!.flush()).toBe(true) })
    expect(callbacks.onCommit).toHaveBeenCalledTimes(1)
    expect(editor.history.undoCount).toBe(0)
    const focus = callbacks.onFocusChange.mock.calls.at(-1)![0]
    expect(focus.part).toBe(editor.doc.slides[slideId].origin?.part)
    expect(focus.shapeIds).toHaveLength(1)
    const saved = inspectOfficeContent(callbacks.onCommit.mock.calls[0][1], 'pptx')
    if (saved.format !== 'pptx') throw new Error('PPT inspection expected')
    const shape = saved.slides[0].shapes.find(shape => shape.shapeId === focus.shapeIds[0])
    expect(shape?.text).toBe('双击编辑文字')
    expect(shape?.runs[0]?.[0]?.style.fontSize).toBe(40)
    expect(shape?.runs[0]?.[0]?.style.bold).toBe(true)
    expect(shape?.runs[0]?.[0]?.style.color).toBe('202124')
  })
})
