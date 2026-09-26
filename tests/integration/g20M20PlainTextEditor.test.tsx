import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { PlainTextDocumentEditor, type PlainTextDocumentEditorHandle } from '../../src/renderer/documentFiles/PlainTextDocumentEditor'
import { LessonDocumentEditor, type LessonDocumentEditorHandle } from '../../src/renderer/documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { DocumentEvent, DocumentModel } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

afterEach(cleanup)

it('M20-T02 mounted document editor commits its exact source through DocumentSession and saves it', async () => {
  const path = '/lesson/notes.txt', ref = { kind: 'file' as const, path }
  const original = '\ufeffone\r\ntwo\r\n'
  let disk = original, version = 'v1'
  const saveDocument = vi.fn<NonNullable<RecoverableDocumentFilePort['saveDocument']>>(async request => {
    expect(request.expectedVersion?.contentVersion).toBe(version)
    disk = request.source; version = 'v2'
    return { status: 'saved', operationId: request.operationId, version: { contentVersion: version, attachments: [] } }
  })
  const port: RecoverableDocumentFilePort = { openDocument: async () => ({ ref, source: disk, version: { contentVersion: version, attachments: [] }, diagnostics: [] }),
    watchDocument: () => () => {}, saveDocument }
  const model = (source: string): DocumentModel => ({ kind: 'text', source, resources: { assets: {}, components: {} } })
  const listeners = new Set<(event: DocumentEvent) => void>()
  const registry = new DocumentRegistry({ createId: () => crypto.randomUUID(), drivers: [new TextDriver()], bindingKey: binding => binding.path,
    persistence: { append: async () => {}, save: async input => {
      if (input.binding.kind !== 'file' || input.model.kind !== 'text') throw new Error('Expected text file')
      const result = await port.saveDocument({ ref, source: input.model.source, expectedVersion: { contentVersion: input.binding.version!, attachments: [] }, attachments: [], operationId: crypto.randomUUID() })
      if (result.status !== 'saved') throw new Error('Save failed')
      return { ...input.binding, version: result.version.contentVersion }
    } } })
  const documents: DocumentHostAPI = {
    bootstrapCourse: async () => { throw new Error('unused') }, list: async () => registry.list(),
    create: async () => { throw new Error('unused') },
    open: async () => {
      const session = await registry.open({ kind: 'file', path, version, bindingVersion: 1 }, async () => model(disk))
      session.subscribe(event => { for (const listener of listeners) listener(event) })
      return session.read()
    },
    read: async id => registry.get(id).read(), dispatch: operation => registry.get(operation.documentId).execute(operation),
    lookup: async (id, operationId) => registry.get(id).lookupOperation(operationId), save: id => registry.save(id),
    saveWithDialog: async () => { throw new Error('unused') }, closeWithDialog: async () => true,
    observeFile: async id => { const binding = registry.get(id).read().binding; if (binding.kind !== 'file') throw new Error('Expected file binding'); return { bindingVersion: binding.bindingVersion, version, model: model(disk) } },
    reconcileFile: async () => { throw new Error('unused') }, close: async () => {}, recoverable: async () => [],
    restore: async () => { throw new Error('unused') }, discardRecovery: async () => {},
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  port.documents = documents
  const handle = createRef<LessonDocumentEditorHandle>()
  render(<LessonDocumentEditor ref={handle} documentRef={ref} port={port} />)
  const box = await screen.findByRole('textbox', { name: '纯文本编辑' })
  const view = EditorView.findFromDOM(box)
  if (!view) throw new Error('CodeMirror did not mount')
  act(() => view.dispatch({ changes: { from: 1, to: 4, insert: 'ONE' } }))
  await waitFor(() => expect(handle.current?.session.committedDocument?.model).toMatchObject({ kind: 'text', source: '\ufeffONE\r\ntwo\r\n' }))
  await act(async () => { expect(await handle.current?.flush()).toBe(true) })
  expect(saveDocument).toHaveBeenCalledOnce()
  expect(disk).toBe('\ufeffONE\r\ntwo\r\n')
  expect(handle.current?.session.committedDocument?.dirty).toBe(false)
})

it('M20-T02 real editor sends a BOM and CRLF preserving draft through its formal port', async () => {
  const source = '\ufeffone\r\ntwo\r\n'
  const draft = vi.fn()
  const ref = createRef<PlainTextDocumentEditorHandle>()
  const props = { source, revision: 1, onDraft: draft, onUndo: vi.fn(), onRedo: vi.fn() }
  const mounted = render(<PlainTextDocumentEditor ref={ref} {...props} />)
  const box = screen.getByRole('textbox', { name: '纯文本编辑' })
  const view = EditorView.findFromDOM(box)
  if (!view) throw new Error('CodeMirror did not mount')
  act(() => view.dispatch({ changes: { from: 1, to: 4, insert: 'ONE' } }))
  expect(ref.current?.flush()).toEqual({ ready: true, source: '\ufeffONE\r\ntwo\r\n' })
  expect(draft).toHaveBeenLastCalledWith('\ufeffONE\r\ntwo\r\n')
  mounted.rerender(<PlainTextDocumentEditor ref={ref} {...props} source={'\ufeffONE\r\ntwo\r\n'} revision={2} />)
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: 'end' } }))
  expect(ref.current?.flush().source).toBe('\ufeffONE\r\ntwo\r\nend')
  mounted.rerender(<PlainTextDocumentEditor ref={ref} {...props} source={source} revision={3} />)
  expect(view.state.doc.toString()).toBe('\ufeffone\ntwo\n')
  expect(ref.current?.flush().source).toBe(source)
})

it('M20-T02 IME completion reconciles visible text against untouched mixed line endings', async () => {
  const source = 'first\r\nsecond\nthird\rrest'
  const draft = vi.fn()
  const ref = createRef<PlainTextDocumentEditorHandle>()
  render(<PlainTextDocumentEditor ref={ref} source={source} revision={1} onDraft={draft} onUndo={() => {}} onRedo={() => {}} />)
  const box = screen.getByRole('textbox', { name: '纯文本编辑' })
  const view = EditorView.findFromDOM(box)
  if (!view) throw new Error('CodeMirror did not mount')
  fireEvent.compositionStart(view.contentDOM)
  act(() => view.dispatch({ changes: { from: 13, to: 18, insert: 'THIRD' } }))
  expect(ref.current?.flush().ready).toBe(false)
  fireEvent.compositionEnd(view.contentDOM)
  await waitFor(() => expect(draft).toHaveBeenLastCalledWith('first\r\nsecond\nTHIRD\rrest'))
  expect(ref.current?.flush()).toEqual({ ready: true, source: 'first\r\nsecond\nTHIRD\rrest' })
})
