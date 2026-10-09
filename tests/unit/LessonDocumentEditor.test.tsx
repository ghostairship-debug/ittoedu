import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import type { DocumentEvent, DocumentModel } from '../../src/shared/workbench/document'
import { authoringDraftRecoverySchema, type AuthoringDraftRecovery, type DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentFileRef } from '../../src/shared/document/ports'
import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LessonDocumentEditor, type LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OpenDocumentResult } from '../../src/shared/document/ports'

function attachTextRendererHost(port: RecoverableDocumentFilePort, fixedRef: DocumentFileRef) {
  const listeners = new Set<(event: DocumentEvent) => void>()
  const authoringDrafts = new Map<string, AuthoringDraftRecovery>()
  const model = (source: string): DocumentModel => ({ kind: 'text', source, resources: { assets: {}, components: {} } })
  const registry = new DocumentRegistry({
    createId: () => crypto.randomUUID(), drivers: [new TextDriver()], bindingKey: binding => binding.path.replace(/\\/g, '/').toLowerCase(),
    persistence: {
      append: async () => {},
      save: async input => {
        if (input.binding.kind !== 'file' || input.model.kind !== 'text') throw new Error('Expected bound text')
        const disk = await port.openDocument(fixedRef)
        if (disk.version.contentVersion !== input.binding.version) throw new Error('File changed')
        const result = await port.saveDocument({ ref: fixedRef, source: input.model.source, expectedVersion: disk.version, attachments: [], operationId: crypto.randomUUID() })
        if (result.status !== 'saved') throw new Error('File save failed')
        return { ...input.binding, version: result.version.contentVersion }
      },
    },
  })
  const documents: DocumentHostAPI = {
    async bootstrapCourse() { throw new Error('unused') },
    list: async () => registry.list(),
    create: async (initial, name) => (await registry.create(initial, name)).read(),
    open: async filename => {
      const disk = await port.openDocument(fixedRef)
      return (await registry.open({ kind: 'file', path: filename, version: disk.version.contentVersion, bindingVersion: 1 }, async () => model(disk.source))).read()
    },
    read: async id => registry.get(id).read(),
    readAuthoringDrafts: async id => { registry.get(id); return structuredClone(authoringDrafts.get(id) ?? null) },
    writeAuthoringDrafts: async (id, drafts) => { registry.get(id); authoringDrafts.set(id, structuredClone(authoringDraftRecoverySchema.parse(drafts))) },
    clearAuthoringDrafts: async id => { registry.get(id); authoringDrafts.delete(id) },
    dispatch: operation => registry.get(operation.documentId).execute(operation),
    lookup: async (id, operationId) => registry.get(id).lookupOperation(operationId),
    save: id => registry.save(id),
    saveWithDialog: async () => { throw new Error('unused') },
    closeWithDialog: async () => true,
    observeFile: async id => {
      const current = registry.get(id).read()
      if (current.binding.kind !== 'file') throw new Error('Expected bound document')
      const disk = await port.openDocument(fixedRef)
      return { bindingVersion: current.binding.bindingVersion, version: disk.version.contentVersion, model: model(disk.source) }
    },
    reconcileFile: input => registry.get(input.documentId).reconcileFile(input, async () => { throw new Error('unused') }),
    close: async (id, discardDirty) => { await registry.close(id, { discardDirty }); authoringDrafts.delete(id) },
    recoverable: async () => [],
    restore: async () => { throw new Error('unused') },
    discardRecovery: async () => {},
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const registryDocuments = documents
  const wrapped: DocumentHostAPI = { ...registryDocuments, dispatch: async operation => {
    const result = await registry.get(operation.documentId).execute(operation)
    const snapshot = registry.get(operation.documentId).read()
    for (const listener of listeners) listener({ type: 'changed', snapshot, operationId: operation.operationId })
    return result
  }, save: async id => {
    const saved = await registry.save(id)
    for (const listener of listeners) listener({ type: 'changed', snapshot: saved })
    return saved
  } }
  port.documents = wrapped
  return wrapped
}

afterEach(cleanup)
describe('LessonDocumentEditor mounted shared core', () => {
  it('opens once through StrictMode replay and releases its watcher on real unmount', async () => {
    const ref = { kind: 'lesson' as const, lessonId: 'lesson', lessonDirectory: '/lesson', relativePath: 'strict.md' }
    const stop = vi.fn()
    const port: RecoverableDocumentFilePort = {
      openDocument: vi.fn(async () => ({ ref, source: '严格模式真实正文', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] })),
      watchDocument: vi.fn(() => stop), saveDocument: vi.fn(),
    }
    const host = attachMarkdownRendererHost(port, ref)
    const open = vi.spyOn(host.documents, 'open')
    const view = render(<StrictMode><LessonDocumentEditor documentRef={ref} port={port} /></StrictMode>)
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('严格模式真实正文'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(host.listeners.size).toBe(1)
    view.unmount()
    await waitFor(() => expect(host.listeners.size).toBe(0))
  })
  it('renders the real layout editor and explicitly adopts the external conflict', async () => {
    const ref = { kind: 'file' as const, path: '/lesson/plan.md' }
    let disk: OpenDocumentResult = { ref, source: '原稿', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const port: RecoverableDocumentFilePort = {
      openDocument: async () => disk, watchDocument: () => () => {}, saveDocument: vi.fn(),
    }
    attachMarkdownRendererHost(port, ref)
    const handle = createRef<LessonDocumentEditorHandle>()
    render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
    await screen.findByRole('button', { name: '源码' })
    await act(async () => {
      handle.current!.session.edit('教师稿')
      await handle.current!.session.drain()
      disk = { ...disk, source: '磁盘稿', version: { contentVersion: 'v2', attachments: [] } }
      expect(await handle.current!.session.flush()).toBe(false)
    })
    fireEvent.click(await screen.findByRole('button', { name: '此处采用磁盘稿' }))
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('磁盘稿'))
    expect(port.saveDocument).not.toHaveBeenCalled()
  })
  it('presents a local conflict choice and saves both independent changes', async () => {
    const ref = { kind: 'file' as const, path: '/lesson/plan.md' }
    let disk: OpenDocumentResult = { ref, source: 'A原始\nB原始\nC原始', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const save = vi.fn<RecoverableDocumentFilePort['saveDocument']>(async request => {
      disk = { ...disk, source: request.source, version: { contentVersion: 'v3', attachments: [] } }
      return { status: 'saved', operationId: request.operationId, version: disk.version }
    })
    const port: RecoverableDocumentFilePort = { openDocument: async () => disk, watchDocument: () => () => {}, saveDocument: save,  }
    attachMarkdownRendererHost(port, ref)
    const handle = createRef<LessonDocumentEditorHandle>()
    render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
    await screen.findByRole('button', { name: '源码' })
    await act(async () => {
      handle.current!.session.edit('A教师\nB本地\nC原始')
      await handle.current!.session.drain()
      disk = { ...disk, source: 'A磁盘\nB原始\nC外部', version: { contentVersion: 'v2', attachments: [] } }
      expect(await handle.current!.session.flush()).toBe(false)
    })
    fireEvent.click(await screen.findByRole('button', { name: '此处采用磁盘稿' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]![0].source).toBe('A磁盘\nB本地\nC外部')
    expect(screen.queryByRole('button', { name: '采用磁盘稿' })).not.toBeInTheDocument()
  })
  it('renders a plain text editor, becomes dirty, and saves without Markdown tools', async () => {
    const ref = { kind: 'file' as const, path: '/lesson/notes.txt' }
    let disk: OpenDocumentResult = { ref, source: '原文', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
    const save = vi.fn<RecoverableDocumentFilePort['saveDocument']>(async request => {
      disk = { ...disk, source: request.source, version: { contentVersion: 'v2', attachments: [] } }
      return { status: 'saved', operationId: request.operationId, version: disk.version }
    })
    const port: RecoverableDocumentFilePort = { openDocument: async () => disk, watchDocument: () => () => {}, saveDocument: save }
    attachTextRendererHost(port, ref)
    const handle = createRef<LessonDocumentEditorHandle>()
    render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
    const box = await screen.findByRole('textbox', { name: '纯文本编辑' })
    const undo = screen.getByRole('button', { name: '撤销' }), redo = screen.getByRole('button', { name: '重做' })
    const autoSave = screen.getByRole('checkbox', { name: '自动保存' })
    expect(autoSave).not.toBeChecked()
    expect(undo).toBeDisabled(); expect(redo).toBeDisabled()
    expect(screen.queryByRole('button', { name: '源码' })).not.toBeInTheDocument()
    const view = EditorView.findFromDOM(box)
    if (!view) throw new Error('纯文本编辑器尚未挂载')
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '增' } }) })
    await waitFor(() => expect(handle.current!.session.getSnapshot().dirty).toBe(true))
    await waitFor(() => expect(undo).toBeEnabled())
    fireEvent.click(undo)
    await waitFor(() => expect(handle.current!.session.getSnapshot().source).toBe('原文'))
    expect(redo).toBeEnabled()
    fireEvent.click(redo)
    await waitFor(() => expect(handle.current!.session.getSnapshot().source).toBe('原文增'))
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save).toHaveBeenCalled()
    expect(save.mock.calls[0]![0].source).toBe('原文增')
    expect(handle.current!.session.committedDocument?.model).toMatchObject({ kind: 'text', source: '原文增' })
    fireEvent.click(autoSave)
    expect(handle.current!.session.getSnapshot().autoSave).toBe(true)
  })
})
