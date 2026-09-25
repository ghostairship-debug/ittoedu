import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { EditorView as SourceView } from '@codemirror/view'
import { TextSelection } from 'prosemirror-state'
import { EditPreviewProjection } from '../../src/renderer/workbench/EditPreviewProjection'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { LessonDocumentEditor, type LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import * as editorSession from '../../src/renderer/document/editorSession'
import { layoutPreviewKey } from '../../src/renderer/document/editPreviewWidgets'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import type { EditEvent, EditSessionSnapshot } from '../../src/shared/workbench/editSession'
import type { OpenDocumentResult } from '../../src/shared/document/ports'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'

const previousDesktop = window.desktopAPI
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktop }) })
const preview = (patch: Partial<EditSessionSnapshot> = {}): EditSessionSnapshot => ({ editId: 'edit', runId: 'run', documentId: 'doc', epoch: 'epoch', baseRevision: 0, revision: 0,
  targetHandle: 'handle', target: { kind: 'markdown-range', from: 0, to: 3 }, value: '生成内容', sequence: 0, status: 'active', ...patch })

describe('mounted canonical editors with volatile generation projection', () => {
  it('renders a whole Markdown draft across heading, paragraph separators and trailing newline without committing the preview', () => {
    const source = '# 原有标题\n\n原有正文😀。\n'
    const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() })
    if (parsed.status !== 'valid') throw new Error('fixture must parse')
    const handle = createRef<SharedDocumentEditorHandle>(), onDraft = vi.fn()
    const ui = render(<SharedDocumentEditor ref={handle} document={parsed.document} revision={source} sourceDraft={source} sourceMap={parsed.sourceMap}
      target="file" onChange={() => true} onDraft={onDraft} onUndo={() => {}} onRedo={() => {}}
      editPreview={{ editId: 'whole', target: { kind: 'markdown-range', from: 0, to: source.length }, value: '正在生成完整正文😀', cancel() {} }} />)
    expect(ui.container.querySelector('[data-edit-preview]')?.textContent).toBe('正在生成完整正文😀')
    expect(handle.current!.flush().source).toBe(source)
    expect(onDraft.mock.calls.every(call => !String(call[0]).includes('正在生成'))).toBe(true)
  })
  it('subscribes before hydration, batches active updates and never resurrects stopped content from a late snapshot', async () => {
    let listener!: (event: EditEvent) => void, resolve!: (value: EditSessionSnapshot[]) => void
    const store = new EditPreviewProjection({ edits: () => new Promise(done => { resolve = done }), subscribeEdits: next => { listener = next; return () => {} }, stop: vi.fn() })
    const notify = vi.fn(), stop = store.subscribe(notify), attached = store.attach('doc')
    listener({ type: 'edit.changed', snapshot: preview({ value: '第一片' }) })
    listener({ type: 'edit.changed', snapshot: preview({ sequence: 1, value: '第二片😀' }) })
    expect(store.read('doc')?.value).toBe('第二片😀')
    expect(notify).not.toHaveBeenCalled()
    listener({ type: 'edit.aborted', snapshot: preview({ status: 'aborted' }), reason: '停止' })
    resolve([preview()]); await attached
    listener({ type: 'edit.changed', snapshot: preview({ sequence: 99, value: '迟到' }) })
    expect(store.read('doc')).toBeNull(); expect(notify).toHaveBeenCalledTimes(1)
    stop()
  })

  it('renders real Markdown EditSession text in layout and source while flush/save excludes preview and human edits remain canonical', async () => {
    const ref = { kind: 'file' as const, path: '/ws/preview.md' }
    let disk: OpenDocumentResult = { ref, source: '第一段 OLD。\n\n第二段\n', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const port: RecoverableDocumentFilePort = { openDocument: async () => disk, watchDocument: () => () => {},
      saveDocument: vi.fn(async request => { disk = { ...disk, source: request.source, version: { contentVersion: crypto.randomUUID(), attachments: [] } }; return { status: 'saved' as const, operationId: request.operationId, version: disk.version } }),
       }
    const host = attachMarkdownRendererHost(port, ref), gateway = new DocumentToolGateway(host.registry, [new MarkdownDriver()], () => crypto.randomUUID())
    const edits = new EditSessionService(host.registry, gateway)
    const stop = vi.fn(async (runId: string) => { await gateway.stop(runId); for (const document of host.registry.list()) for (const item of edits.list(document.documentId)) edits.abort(item.editId, '停止'); return null })
    Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { execution: { edits: async (id: string) => edits.list(id), subscribeEdits: (listener: (event: EditEvent) => void) => edits.subscribe(listener), stop } } })
    const handle = createRef<LessonDocumentEditorHandle>(), factory = vi.spyOn(editorSession, 'createLayoutEditor')
    render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
    await screen.findByText('第一段 OLD。')
    const documentId = handle.current!.session.documentId!, canonical = host.registry.get(documentId)
    await gateway.beginRun({ runId: 'run', actor: 'agent', documents: [{ documentId, writable: [{ kind: 'document' }] }] })
    const targetHandle = await gateway.issueTarget('run', documentId, { kind: 'markdown-range', from: 4, to: 7 })
    await act(async () => { await edits.begin({ editId: 'edit', runId: 'run', targetHandle }); await edits.snapshot('edit', 0, '新的😀正文') })
    await screen.findByText('新的😀正文')
    const layout = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
    expect(layout.view.state.doc.textContent).toBe('第一段 OLD。第二段')
    expect(layout.view.dom.querySelector('[data-edit-preview]')?.getAttribute('contenteditable')).toBe('false')
    await act(async () => { expect(await handle.current!.flush()).toBe(true) })
    expect(disk.source).toBe('第一段 OLD。\n\n第二段\n'); expect(canonical.read().undoDepth).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: /^源文$/ }))
    const source = SourceView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    expect(source.state.doc.toString()).toBe(disk.source)
    await waitFor(() => expect(source.dom.querySelector('[data-edit-preview]')?.textContent).toBe('新的😀正文'))
    act(() => source.dispatch({ changes: { from: source.state.doc.length - 1, insert: '人工保留' } }))
    await act(async () => { expect(await handle.current!.flush()).toBe(true) })
    expect(disk.source).toBe('第一段 OLD。\n\n第二段人工保留\n')
    expect(canonical.read().model).toMatchObject({ source: disk.source })
    await act(async () => { await edits.snapshot('edit', 1, '最终😀正文') })
    await waitFor(() => expect(source.dom.querySelector('[data-edit-preview]')?.textContent).toBe('最终😀正文'))
    fireEvent.keyDown(source.contentDOM, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(source.dom.querySelector('[data-edit-preview]')).toBeNull())
    expect(stop).toHaveBeenCalledWith('run'); expect(canonical.read().undoDepth).toBe(1)
    expect(disk.source).not.toContain('最终😀正文')
  })

  it.each(['flow-block', 'flow-range'] as const)('paints a %s widget, preserves the live editor/caret, guards overlapping input and copies presented text', async kind => {
    const document = { content: { blocks: [
      { id: 'one', type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: '甲😀乙丙' }] } },
      { id: 'two', type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: '另一段' }] } },
    ] }, resources: { assets: [], components: [] } }
    const target = kind === 'flow-block' ? { kind, surfaceId: 'flow', blockId: 'one', parentId: null }
      : { kind, surfaceId: 'flow', blockId: 'one', parentId: null, slot: { kind: 'field' as const, field: 'content' as const }, from: 1, to: 3 }
    const cancel = vi.fn(), onChange = vi.fn(), onDraft = vi.fn(), onUndo = vi.fn(), factory = vi.spyOn(editorSession, 'createLayoutEditor')
    const handle = createRef<SharedDocumentEditorHandle>(), props = { document, revision: '0', target: 'flow' as const, onChange, onDraft, onUndo, onRedo() {},
      editPreview: { editId: 'flow-edit', target, value: '新内容😀', cancel } }
    const ui = render(<SharedDocumentEditor ref={handle} {...props} />)
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>, originalView = editor.view
    expect(screen.getByText('新内容😀')).toBeTruthy(); expect(onChange).not.toHaveBeenCalled(); expect(onDraft).not.toHaveBeenCalled()
    const range = layoutPreviewKey.getState(editor.view.state)!
    act(() => editor.view.dispatch(editor.view.state.tr.insertText('不可插入', range.from + 1)))
    expect(onChange).not.toHaveBeenCalled(); expect(screen.getAllByRole('alert').every(node => node.textContent?.includes('暂时只读'))).toBe(true)
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 6))))
    const setData = vi.fn(), clipboard = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(clipboard, 'clipboardData', { value: { setData } }); editor.view.dom.dispatchEvent(clipboard)
    expect(setData).toHaveBeenCalledWith('text/plain', kind === 'flow-block' ? '新内容😀' : '甲新内容😀丙')
    const cut = new Event('cut', { bubbles: true, cancelable: true }), cutData = vi.fn()
    Object.defineProperty(cut, 'clipboardData', { value: { setData: cutData } })
    act(() => { editor.view.dom.dispatchEvent(cut) })
    expect(cut.defaultPrevented).toBe(true); expect(cutData).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled(); expect(screen.getAllByRole('alert').every(node => node.textContent?.includes('暂时只读'))).toBe(true)
    const next = structuredClone(document); next.content.blocks[1].content.inlines[0].text = '另一段人工更新'
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, editor.view.state.doc.content.size - 1))))
    ui.rerender(<SharedDocumentEditor ref={handle} {...props} document={next} revision="1" editPreview={{ ...props.editPreview, value: '继续生成' }} />)
    expect(factory.mock.calls).toHaveLength(1); expect(editor.view).toBe(originalView)
    expect(editor.view.state.doc.textContent).toBe('甲😀乙丙另一段人工更新')
    expect(handle.current!.flush().source).not.toContain('继续生成')
    fireEvent.click(screen.getByRole('button', { name: /^源文$/ }))
    const source = SourceView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    expect(source.state.doc.toString()).toBe(serializeDocumentMarkdown(next, 'flow'))
    expect(source.dom.querySelector('[data-edit-preview]')?.textContent).toBe('继续生成')
    fireEvent.click(screen.getByRole('button', { name: /^撤销$/ }))
    expect(cancel).toHaveBeenCalledTimes(1); expect(onUndo).not.toHaveBeenCalled()
  })
})
