import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { PlainTextDocumentEditor } from '../../src/renderer/documentFiles/PlainTextDocumentEditor'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { prepareDocumentTextEdit } from '../../src/renderer/document/documentSelectionCommands'
import { captureMarkdownSelection, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { sourcePreviewField } from '../../src/renderer/document/editPreviewWidgets'
import type { EditEvent, EditSessionSnapshot } from '../../src/shared/workbench/editSession'

function clipboard(target: HTMLElement, type: 'copy' | 'cut') {
  const setData = vi.fn(), event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: { setData } })
  fireEvent(target, event)
  return { event, setData }
}
const previous = window.desktopAPI
function snapshot(source: string): DocumentSnapshot { return { documentId: 'md-aggregate', epoch: 'epoch', revision: 0,
  model: new MarkdownDriver().load(new TextEncoder().encode(source)), binding: { kind: 'untitled', suggestedName: '未保存.md' },
  dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 } }
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previous }) })
describe('formal text-card targets in actual document consumers', () => {
  it('renders and locates the aggregate target produced by prepareDocumentTextEdit in both real editor modes', async () => {
    const source = '第一段 OLD。\n\n第二段 tail\n', current = snapshot(source)
    const release = workbenchSelection.register(current.documentId, async () => current)
    const target = { mode: 'layout' as const, revision: '0', source, selection: null,
      ranges: [{ from: source.indexOf('OLD'), to: source.indexOf('OLD') + 3, before: 'OLD' }], label: '当前文字' }
    const prepared = await prepareDocumentTextEdit(current.documentId, target, captureMarkdownSelection)
    expect(prepared.target.kind).toBe('text-selection')
    if (prepared.target.kind !== 'text-selection') throw Error('Expected the real semantic text-card target')
    const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() }); if (parsed.status !== 'valid') throw Error('fixture')
    const cancel = vi.fn()
    const ui = render(<SharedDocumentEditor document={parsed.document} sourceDraft={source} sourceMap={parsed.sourceMap} revision={source} target="file"
      initialMode="layout" cardDocumentId={current.documentId} editPreviews={[{ editId: 'aggregate', target: prepared.target, value: '新的文字', cancel }]}
      onChange={() => true} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
    expect(ui.container.querySelector('[data-edit-preview]')?.textContent).toBe('新的文字')
    expect(workbenchSelection.targetView(current.documentId)?.select(prepared.target)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^源码$/ }))
    const raw = EditorView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    expect(raw.state.field(sourcePreviewField)[0]).toMatchObject({ from: target.ranges[0].from, to: target.ranges[0].to })
    expect(raw.dom.querySelector('[data-edit-preview]')?.textContent).toBe('新的文字')
    expect(workbenchSelection.targetView(current.documentId)?.select(prepared.target)).toBe(true)
    expect(raw.state.selection.main.from).toBe(target.ranges[0].from)
    release()
  })
  it('keeps aggregate fragments distinct so a simultaneous middle-object preview and unrelated edits remain visible and editable', () => {
    const source = 'AA\n\nKEEP\n\nZZ\n'
    const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() }); if (parsed.status !== 'valid') throw Error('fixture')
    const target = { kind: 'text-selection' as const, fragments: [{ target: { kind: 'markdown-range' as const, from: 0, to: 2 } },
      { target: { kind: 'markdown-range' as const, from: source.indexOf('ZZ'), to: source.indexOf('ZZ') + 2 }, separatorBefore: '\n' }] }
    const ui = render(<SharedDocumentEditor document={parsed.document} sourceDraft={source} sourceMap={parsed.sourceMap} revision={source} target="file"
      initialMode="layout" cardDocumentId="aggregate-gap-doc" editPreviews={[{ editId: 'aggregate-gap', target, value: 'AX\nZY', cancel() {} }, { editId: 'middle', target: { kind: 'markdown-range', from: 4, to: 8 }, value: '中央预览', cancel() {} }]}
      onChange={() => true} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
    expect([...ui.container.querySelectorAll('[data-edit-preview]')].map(node => node.textContent)).toEqual(['AX', '中央预览', 'ZY'])
    fireEvent.click(screen.getByRole('button', { name: /^源码$/ }))
    const raw = EditorView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    expect(raw.state.field(sourcePreviewField).map(value => [value.editId, value.from, value.to])).toEqual([['aggregate-gap', 0, 2], ['aggregate-gap', 10, 12], ['middle', 4, 8]])
    expect([...raw.dom.querySelectorAll('[data-edit-preview]')].map(node => node.textContent)).toEqual(['AX', '中央预览', 'ZY'])
    expect(workbenchSelection.targetView('aggregate-gap-doc')?.select(target)).toBe(true)
    expect(raw.state.selection.ranges.map(range => [range.from, range.to])).toEqual([[0,2],[10,12]])
    const copied = clipboard(raw.contentDOM, 'copy')
    expect(copied.event.defaultPrevented).toBe(true)
    expect(copied.setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'AX\nZY')
    expect(raw.state.doc.toString()).toBe(source)
    workbenchSelection.setManual('aggregate-gap-doc', { documentId: 'aggregate-gap-doc', epoch: 'epoch', revision: 0, targets: target.fragments.map(fragment => fragment.target), label: '两个片段' })
    act(() => workbenchSelection.removeSelection('aggregate-gap-doc', [target.fragments[0].target]))
    expect(raw.state.selection.ranges.map(range => [range.from, range.to])).toEqual([[10,12]])
    // The gap belongs to neither target, so an actual source edit in it is accepted.
    act(() => raw.dispatch({ changes: { from: 3, insert: '人工' } }))
    expect(raw.state.doc.toString()).toContain('人工')
    expect(raw.state.field(sourcePreviewField).find(value => value.editId === 'aggregate-gap' && value.partId === 1)).toMatchObject({ from: 12, to: 14 })
  })
  it.each([undefined, '', '\n\n'])('preserves the aggregate separator %j while copying both displayed fragments', separatorBefore => {
    const source = 'AA\n\nKEEP\n\nZZ\n'
    const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() }); if (parsed.status !== 'valid') throw Error('fixture')
    const separator = separatorBefore ?? ''
    const target = { kind: 'text-selection' as const, fragments: [{ target: { kind: 'markdown-range' as const, from: 0, to: 2 } },
      { target: { kind: 'markdown-range' as const, from: 10, to: 12 }, separatorBefore }] }
    render(<SharedDocumentEditor document={parsed.document} sourceDraft={source} sourceMap={parsed.sourceMap} revision={source} target="file"
      cardDocumentId="copy-separator" editPreviews={[{ editId: 'parts', target, value: `AX${separator}ZY`, cancel() {} }]}
      onChange={() => true} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^源码$/ }))
    const raw = EditorView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    act(() => { workbenchSelection.targetView('copy-separator')!.select(target) })
    const copied = clipboard(raw.contentDOM, 'copy')
    expect(copied.event.defaultPrevented).toBe(true)
    expect(copied.setData).toHaveBeenCalledExactlyOnceWith('text/plain', `AX${separator}ZY`)
    expect(raw.state.doc.toString()).toBe(source)
  })
  it('copies an ordinary main range and a secondary preview range, and blocks cutting the same exact selections', () => {
    const source = 'AA\n\nKEEP\n\nZZ\n'
    const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() }); if (parsed.status !== 'valid') throw Error('fixture')
    render(<SharedDocumentEditor document={parsed.document} sourceDraft={source} sourceMap={parsed.sourceMap} revision={source} target="file"
      editPreviews={[{ editId: 'secondary', target: { kind: 'markdown-range', from: 10, to: 12 }, value: 'ZY', cancel() {} }]}
      onChange={() => true} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^源码$/ }))
    const raw = EditorView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    act(() => raw.dispatch({ selection: EditorSelection.create([EditorSelection.range(4, 8), EditorSelection.range(10, 12)], 0) }))
    expect(raw.state.selection.main).toMatchObject({ from: 4, to: 8 })
    const copied = clipboard(raw.contentDOM, 'copy')
    expect(copied.event.defaultPrevented).toBe(true)
    expect(copied.setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'KEEP\nZY')
    const cut = clipboard(raw.contentDOM, 'cut')
    expect(cut.event.defaultPrevented).toBe(true)
    expect(cut.setData).not.toHaveBeenCalled()
    expect(raw.state.doc.toString()).toBe(source)
    expect(raw.state.selection.ranges.map(range => [range.from, range.to])).toEqual([[4, 8], [10, 12]])
  })
  it.each([true, false])('keeps preview copy available only with a clipboard bridge (%s), while cut and paste remain protected', async available => {
    const source = 'OLD tail\n', parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() }); if (parsed.status !== 'valid') throw Error('fixture')
    const target = { kind: 'markdown-range' as const, from: 0, to: 3 }, handle = createRef<SharedDocumentEditorHandle>()
    let copied: ReturnType<typeof clipboard> | undefined
    const bridge = vi.fn(async () => { copied = clipboard(ui.container.querySelector<HTMLElement>('.ProseMirror')!, 'copy') })
    Object.defineProperty(window, 'desktopAPI', { configurable: true, value: available ? { editorClipboard: bridge } : {} })
    const ui = render(<SharedDocumentEditor ref={handle} document={parsed.document} sourceDraft={source} sourceMap={parsed.sourceMap} revision={source} target="file"
      initialMode="layout" cardDocumentId="layout-preview-copy" editPreviews={[{ editId: 'layout-copy', target, value: '新稿', cancel() {} }]}
      onChange={() => true} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
    act(() => { workbenchSelection.targetView('layout-preview-copy')!.select(target) })
    const block = ui.container.querySelector<HTMLElement>('[data-flow-block-id]')!
    fireEvent.contextMenu(block, { clientX: 100, clientY: 100 })
    const copy = screen.getByRole('menuitem', { name: '复制' })
    expect(copy.getAttribute('aria-disabled')).toBe(available ? null : 'true')
    expect(screen.getByRole('menuitem', { name: '剪切' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: '粘贴' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: '粘贴为纯文本' })).toHaveAttribute('aria-disabled', 'true')
    if (available) {
      await act(async () => fireEvent.click(copy))
      expect(bridge).toHaveBeenCalledExactlyOnceWith('copy')
      expect(copied?.setData).toHaveBeenCalledExactlyOnceWith('text/plain', '新稿')
      act(() => handle.current!.clearSelection())
      fireEvent.contextMenu(block, { clientX: 100, clientY: 100 })
      expect(screen.getByRole('menuitem', { name: '复制' })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('menuitem', { name: '复制' })).toHaveAttribute('title', '请先选择文字或对象')
    } else {
      expect(copy).toHaveAttribute('title', '当前环境无法使用系统剪贴板')
      fireEvent.click(copy)
      expect(bridge).not.toHaveBeenCalled()
    }
  })
  it('exposes a real TXT range card entry and keeps current raw CRLF offsets for preview and explicit result selection', async () => {
    const source = '一二\r\n三四五', current = { ...snapshot(source), documentId: 'txt', model: { kind: 'text' as const, source } }
    let listener!: (event: EditEvent) => void
    Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: { read: async () => current }, execution: {
      edits: async () => [], subscribeEdits: (next: (event: EditEvent) => void) => { listener = next; return () => {} }, stop: vi.fn(),
    } } })
    vi.spyOn(EditorView.prototype, 'coordsAtPos').mockImplementation(position => ({ left: 10 + position * 8, right: 12 + position * 8, top: 20, bottom: 40 }))
    const ui = render(<PlainTextDocumentEditor documentId="txt" source={source} revision={0} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
    const raw = EditorView.findFromDOM(ui.container.querySelector('.cm-editor')!)!
    await act(async () => { raw.dispatch({ selection: { anchor: 3, head: 5 } }) })
    expect(screen.getByRole('button', { name: 'AI 修改' })).toBeTruthy()
    expect(workbenchSelection.getManual('txt')?.targets).toEqual([{ kind: 'markdown-range', from: 4, to: 6 }])
    const preview: EditSessionSnapshot = { editId: 'txt-edit', runId: 'run', documentId: 'txt', epoch: 'epoch', baseRevision: 0, revision: 0,
      targetHandle: 'handle', target: { kind: 'markdown-range', from: 4, to: 6 }, value: '新稿', sequence: 0, status: 'active' }
    await act(async () => { listener({ type: 'edit.changed', snapshot: preview }); await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(raw.dom.querySelector('[data-edit-preview]')?.textContent).toBe('新稿')
    expect(raw.state.doc.toString()).toBe('一二\n三四五')
    expect(workbenchSelection.targetView('txt')?.select(preview.target)).toBe(true)
    expect(raw.state.selection.main).toMatchObject({ from: 3, to: 5 })
  })
})
