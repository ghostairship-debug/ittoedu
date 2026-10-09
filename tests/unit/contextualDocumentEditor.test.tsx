import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from '@codemirror/view'
import * as editorSession from '../../src/renderer/document/editorSession'
import { LessonDocumentEditor, type LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OpenDocumentResult } from '../../src/shared/document/ports'
import { workbenchSelection, type ContextualEditRequest } from '../../src/renderer/workbench/SelectionContextController'
import { ElementTextCardLayer } from '../../src/renderer/workbench/elementCards/ElementTextCards'
import { elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
// JSDOM has no layout; the selection quick bar only appears over a visible editor.
const visibleEditor = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 800, bottom: 600,
  width: 800, height: 600, x: 0, y: 0, toJSON() {} }))
function fixture() {
  const ref = { kind: 'file' as const, path: '/ws/review.md' }
  let disk: OpenDocumentResult = { ref, source: '第一段 **加粗** 链接\n\n第二段\n', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
  const port: RecoverableDocumentFilePort = {
    openDocument: async () => disk, watchDocument: () => () => {},
    saveDocument: vi.fn(async request => { disk = { ...disk, source: request.source, version: { contentVersion: crypto.randomUUID(), attachments: [] } }; return { status: 'saved' as const, operationId: request.operationId, version: disk.version } }),
    
  }
  attachMarkdownRendererHost(port, ref)
  return { ref, port, read: () => disk }
}
describe('file contextual editing in mounted UI', () => {
  it('selects plain Markdown without IDs, opens a text card on the precise range, and clears it after source changes', async () => {
    visibleEditor()
    const factory = vi.spyOn(editorSession, 'createLayoutEditor'), f = fixture(), handle = createRef<LessonDocumentEditorHandle>()
    render(<><LessonDocumentEditor ref={handle} documentRef={f.ref} port={f.port} /><ElementTextCardLayer /></>)
    await screen.findByText('加粗')
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 5, 7))))
    expect(handle.current?.getContextualEditTarget()?.ranges).toEqual([{ from: 6, to: 8, before: '加粗' }])
    // M15: selected text gets its own card on the frozen Markdown range, which stays until it is closed.
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
    const card = await screen.findByRole('dialog', { name: 'AI 修改：“加粗”' })
    expect(card).toHaveTextContent('这里的 AI 只改选中的文字')
    expect(elementCards.texts()).toMatchObject([{ kind: 'text', target: { kind: 'text-selection', fragments: [{ target: { kind: 'markdown-range', from: 6, to: 8 } }] } }])
    fireEvent.click(within(card).getByRole('button', { name: '关闭 AI 卡' }))
    await waitFor(() => expect(elementCards.texts()).toEqual([]))
    act(() => editor.view.dispatch(editor.view.state.tr.insertText('新词')))
    await waitFor(() => expect(handle.current?.getContextualEditTarget()).toBeNull())
  })
  it('CodeMirror reports exact source indices without inventing a logical point', async () => {
    const f = fixture(), handle = createRef<LessonDocumentEditorHandle>()
    render(<LessonDocumentEditor ref={handle} documentRef={f.ref} port={f.port} />)
    await screen.findByText('加粗')
    fireEvent.click(screen.getByRole('button', { name: /^源码$/ }))
    const node = screen.getByLabelText('正文源文编辑'), view = EditorView.findFromDOM(node)!
    act(() => view.dispatch({ selection: { anchor: 4, head: 10 } }))
    expect(handle.current?.getContextualEditTarget()).toMatchObject({ mode: 'source', selection: null, ranges: [{ from: 4, to: 10, before: '**加粗**' }] })
  })
  it('manual formatting is one owner history step and survives save and reopen', async () => {
    visibleEditor()
    const factory = vi.spyOn(editorSession, 'createLayoutEditor'), f = fixture(), handle = createRef<LessonDocumentEditorHandle>()
    const ui = render(<LessonDocumentEditor ref={handle} documentRef={f.ref} port={f.port} />)
    await screen.findByText('加粗')
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 4))))
    fireEvent.click(screen.getByRole('button', { name: '当前选区斜体' }))
    await act(async () => { expect(await handle.current!.flush()).toBe(true) })
    expect(f.read().source).toContain('cw:italic=true')
    await act(async () => { await handle.current!.session.undo() })
    await act(async () => { expect(await handle.current!.flush()).toBe(true) })
    expect(f.read().source).not.toContain('cw:italic=true')
    await act(async () => { await handle.current!.session.redo() })
    await act(async () => { await handle.current!.flush() })
    ui.unmount()
    render(<LessonDocumentEditor documentRef={f.ref} port={f.port} />)
    const restored = await screen.findByText('第一段')
    expect(getComputedStyle(restored).fontStyle).toBe('italic')
  })
})
