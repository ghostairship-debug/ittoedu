import { createElement, createRef } from 'react'
import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'
import { LessonDocumentEditor, type LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { ElementTextCardLayer } from '../../src/renderer/workbench/elementCards/ElementTextCards'
import { elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'

const original = '正文'
const diagnosed = '正文\n\n$$\nx^2'
afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const card of elementCards.texts()) elementCards.closeText(card.id) })

async function fixture() {
  const documentRef = { kind: 'file' as const, path: '/lesson/formula.md' }
  const port: RecoverableDocumentFilePort = {
    openDocument: async () => ({ ref: documentRef, source: original, version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }),
    watchDocument: () => () => {}, saveDocument: vi.fn(),
  }
  const host = attachMarkdownRendererHost(port, documentRef)
  const handle = createRef<LessonDocumentEditorHandle>()
  render(createElement(LessonDocumentEditor, { ref: handle, documentRef, port }))
  fireEvent.click(await screen.findByRole('button', { name: '源码' }))
  const node = screen.getByLabelText('正文源文编辑')
  return { ...host, handle, port, node, view: EditorView.findFromDOM(node)!, id: handle.current!.session.documentId! }
}
function enter(view: EditorView, source = diagnosed) {
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } }))
}

describe('NI-01 file source diagnostics and formal input ACK', () => {
  it('reads acknowledged raw source with a layout diagnostic and opens its precise repair card without saving', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} })
    const f = await fixture()
    render(createElement(ElementTextCardLayer))
    enter(f.view)
    await act(async () => { expect(await f.handle.current!.session.drain()).toBe(true) })
    expect(screen.getByRole('alert')).toHaveTextContent('独立公式未闭合')
    const prepared = await workbenchSelection.prepare(f.id)
    expect(prepared.model).toMatchObject({ kind: 'markdown', source: diagnosed })
    act(() => f.view.dispatch({ selection: { anchor: diagnosed.indexOf('$$'), head: diagnosed.length } }))
    fireEvent.click(await screen.findByRole('button', { name: 'AI 修改' }))
    await screen.findByRole('dialog', { name: 'AI 修改：“$$ x^2”' })
    expect(elementCards.texts()).toMatchObject([{ target: { kind: 'markdown-range', from: diagnosed.indexOf('$$'), to: diagnosed.length } }])
    expect(f.port.saveDocument).not.toHaveBeenCalled()
    const repaired = `${diagnosed}\n$$`
    await act(async () => { expect(await f.documents.dispatch({ documentId: f.id, epoch: prepared.epoch, baseRevision: prepared.revision, operationId: crypto.randomUUID(), actor: 'agent', mutation: { type: 'command', command: { type: 'markdown.replace', source: repaired, resources: prepared.model.resources } } })).toMatchObject({ status: 'applied' }) })
    await waitFor(() => expect(f.view.state.doc.toString()).toBe(repaired))
    expect(screen.queryByText(/独立公式未闭合/)).not.toBeInTheDocument()
    expect(f.port.saveDocument).not.toHaveBeenCalled()
  })

  it('waits for the original DocumentSession ACK before returning diagnosed source', async () => {
    const f = await fixture()
    let acknowledge!: () => void
    const gate = new Promise<void>(resolve => { acknowledge = resolve })
    const dispatch = f.documents.dispatch
    const called = vi.spyOn(f.documents, 'dispatch').mockImplementation(async operation => { await gate; return dispatch(operation) })
    enter(f.view)
    await waitFor(() => expect(called).toHaveBeenCalled())
    const completed = vi.fn()
    const pending = workbenchSelection.prepare(f.id).then(value => { completed(value); return value })
    await act(async () => { await Promise.resolve() })
    expect(completed).not.toHaveBeenCalled()
    expect(f.registry.get(f.id).read().model).toMatchObject({ source: original })
    acknowledge()
    await act(async () => { expect((await pending).model).toMatchObject({ kind: 'markdown', source: diagnosed }) })
    expect(f.port.saveDocument).not.toHaveBeenCalled()
  })

  it('keeps diagnosed input when its formal transaction fails instead of reporting a fake ACK', async () => {
    const f = await fixture()
    vi.spyOn(f.documents, 'dispatch').mockRejectedValue(new Error('实际输入提交失败'))
    enter(f.view)
    await waitFor(() => expect(f.handle.current!.session.getSnapshot().error).toContain('实际输入提交失败'))
    await expect(workbenchSelection.prepare(f.id)).rejects.toThrow('正文输入尚未确认')
    expect(f.registry.get(f.id).read().model).toMatchObject({ source: original })
    expect(f.view.state.doc.toString()).toBe(diagnosed)
    expect(f.port.saveDocument).not.toHaveBeenCalled()
  })

  it('does not read composition input before its original owner completes it', async () => {
    const f = await fixture()
    fireEvent.compositionStart(f.node)
    enter(f.view)
    await expect(workbenchSelection.prepare(f.id)).rejects.toThrow('请先完成当前输入')
    expect(f.registry.get(f.id).read().model).toMatchObject({ source: original })
    fireEvent.compositionEnd(f.node)
    await act(async () => { await Promise.resolve() })
    await expect(workbenchSelection.prepare(f.id)).resolves.toMatchObject({ model: { kind: 'markdown', source: diagnosed } })
    expect(f.port.saveDocument).not.toHaveBeenCalled()
  })

  it('keeps Flow projection diagnostics blocking and cannot turn rejected source commits into ACKs', async () => {
    const parsed = parseDocumentMarkdown(original, { createId: () => crypto.randomUUID(), target: 'flow' })
    if (parsed.status !== 'valid') throw new Error('Expected valid initial projection')
    const handle = createRef<SharedDocumentEditorHandle>()
    const f = render(createElement(SharedDocumentEditor, { ref: handle, document: parsed.document, revision: '1', sourceDraft: original, initialMode: 'source', target: 'flow', onChange: () => false, onDraft() {}, onUndo() {}, onRedo() {} }))
    const view = EditorView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    enter(view)
    expect(await handle.current!.drainSource()).toMatchObject({ ready: false, source: diagnosed })
    f.rerender(createElement(SharedDocumentEditor, { ref: handle, document: parsed.document, revision: '1', sourceDraft: original, initialMode: 'source', target: 'file', onChange: () => false, onDraft() {}, onUndo() {}, onRedo() {} }))
    enter(view, '修复正文')
    expect(await handle.current!.drainSource()).toMatchObject({ ready: false, source: '修复正文' })
  })
})
