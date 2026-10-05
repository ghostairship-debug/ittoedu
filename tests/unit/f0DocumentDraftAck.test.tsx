import { createRef } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { EditorView as SourceView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as sessions from '../../src/renderer/document/editorSession'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { parseDocumentMarkdown, type MarkdownDocument } from '../../src/shared/document/markdown'
import { Slice } from 'prosemirror-model'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'

const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => geometry.forEach((key, index) => {
  const descriptor = descriptors[index]
  if (descriptor) Object.defineProperty(Range.prototype, key, descriptor)
  else Reflect.deleteProperty(Range.prototype, key)
}))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function body(text: string): MarkdownDocument {
  return { content: { blocks: [{ id: 'body', type: 'paragraph', content: { inlines: [{ type: 'text', text }] } }] }, resources: emptyDocumentResources() }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('F0 actual draft ACK boundary', () => {
  it('explicitly discards restored rejected source and caller-owned handles before publishing canonical input', async () => {
    for (const entry of ['button', 'handle'] as const) {
      const events: string[] = [], restoredHandles = new Set(['private-source-files'])
      const handle = createRef<SharedDocumentEditorHandle>(), onChange = vi.fn()
      const diagnostics = [{ message: '原目标拒绝提交', offset: 0, endOffset: 0, line: 1, column: 1 }]
      const toolbarHost = entry === 'button' ? document.createElement('div') : undefined
      if (toolbarHost) document.body.append(toolbarHost)
      const expectCanonicalSource = (source: string) => {
        const parsed = parseDocumentMarkdown(source, { target: 'flow', createId: () => 'unexpected-new-id' })
        expect(parsed.status).toBe('valid')
        if (parsed.status === 'valid') expect(parsed.document).toEqual(body('正式正文'))
      }
      const ui = render(<SharedDocumentEditor ref={handle} document={body('正式正文')} revision="original-doc:0" target="flow"
        sourceDraft="恢复的未提交正文" sourceDiagnostics={diagnostics} toolbarHost={toolbarHost} onChange={onChange} onUndo={() => {}} onRedo={() => {}}
        onDiscardDraft={() => { events.push('discard:original-doc'); restoredHandles.clear() }}
        onDraft={(source, issues) => {
          expect(restoredHandles.size).toBe(0)
          expectCanonicalSource(source)
          expect(issues).toEqual([])
          events.push('canonical:original-doc')
        }} />)
      try {
        expect(SourceView.findFromDOM(ui.getByLabelText('正文源文编辑'))!.state.doc.toString()).toBe('恢复的未提交正文')
        expect(await handle.current!.drain()).toMatchObject({ ready: false, source: '恢复的未提交正文', diagnostics })
        expect(onChange).not.toHaveBeenCalled()
        expect(restoredHandles.size).toBe(1)
        await act(async () => {
          if (toolbarHost) {
            fireEvent.click(within(toolbarHost).getByLabelText('更多正文操作'))
            fireEvent.click(within(toolbarHost).getByRole('button', { name: '丢弃待修草稿' }))
          } else await handle.current!.discardDraft()
        })
        expect(ui.getByRole('textbox', { name: '正文编辑' }).textContent).toBe('正式正文')
        const drained = await handle.current!.drain()
        expect(drained).toMatchObject({ ready: true, diagnostics: [] })
        expectCanonicalSource(drained.source)
        expect(onChange).not.toHaveBeenCalled()
        expect(events).toEqual(['discard:original-doc', 'canonical:original-doc'])
        expect(restoredHandles.size).toBe(0)
      } finally { ui.unmount(); toolbarHost?.remove() }
    }
  })

  it('waits for the actual ACK before formal undo and consumes ACK without a second intent', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const ack = deferred<boolean>(), change = vi.fn((_document: MarkdownDocument) => ack.promise), undo = vi.fn(), diagnostic = vi.fn()
    const options = { document: body('原文'), revision: '0', change, undo, redo() {}, diagnostic }
    const editor = sessions.createLayoutEditor(host, options), view = editor.view
    try {
      view.dispatch(view.state.tr.insertText('新', 1))
      editor.update({ ...options, revision: 'external-1' })
      expect(view.state.doc.textContent).toBe('新原文')
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
      await Promise.resolve()
      expect(undo).not.toHaveBeenCalled()
      expect(change).toHaveBeenCalledTimes(1)
      ack.resolve(true)
      await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(1))
      const committed = change.mock.calls[0][0]
      editor.update({ ...options, document: committed, revision: '1' })
      expect(editor.view).toBe(view)
      expect(await editor.drain()).toBe(true)
      expect(change).toHaveBeenCalledTimes(1)
      editor.update({ ...options, revision: '2' })
      expect(view.state.doc.textContent).toBe('原文')
      expect(diagnostic).not.toHaveBeenCalled()
    } finally { editor.destroy(); host.remove() }
  })

  it('retains a rejected draft and its original commit owner across external updates', async () => {
    const factory = vi.spyOn(sessions, 'createLayoutEditor'), ack = deferred<boolean>()
    const originalChange = vi.fn(() => ack.promise), otherChange = vi.fn(), originalDraft = vi.fn(), otherDraft = vi.fn()
    const handle = createRef<SharedDocumentEditorHandle>()
    const props = { document: body('原目标'), revision: '0', contentScope: 'inline-text' as const, onUndo() {}, onRedo() {} }
    const ui = render(<SharedDocumentEditor ref={handle} {...props} onChange={originalChange} onDraft={originalDraft} />)
    const view = factory.mock.results.at(-1)!.value.view
    await act(async () => view.dispatch(view.state.tr.insertText('保留', 1)))
    ui.rerender(<SharedDocumentEditor ref={handle} {...props} document={body('其他目标')} revision="other:1" onChange={otherChange} onDraft={otherDraft} />)
    expect(view.state.doc.textContent).toBe('保留原目标')
    await act(async () => ack.reject(new Error('正式提交被拒绝')))
    expect(originalDraft.mock.calls.at(-1)![1][0].message).toBe('正式提交被拒绝')
    expect(otherDraft).not.toHaveBeenCalled()
    expect(await handle.current!.drain()).toMatchObject({ ready: false })
    expect(factory.mock.results.at(-1)!.value.view).toBe(view)
    await act(async () => view.dispatch(view.state.tr.insertText('续写', 1)))
    expect(originalChange).toHaveBeenCalledTimes(2)
    expect(otherChange).not.toHaveBeenCalled()
    expect(view.state.doc.textContent).toBe('续写保留原目标')
    await act(async () => fireEvent.click(ui.getByRole('button', { name: '丢弃待修草稿' })))
    expect(view.state.doc.textContent).toBe('其他目标')
  })

  it('keeps source input after a delayed rejection and does not resubmit it during drain', async () => {
    const ack = deferred<boolean>(), onChange = vi.fn(() => ack.promise), onDraft = vi.fn(), handle = createRef<SharedDocumentEditorHandle>()
    const props = { document: body('原文'), sourceDraft: '原文', initialMode: 'source' as const, revision: '0', target: 'flow' as const, onChange, onDraft, onUndo() {}, onRedo() {} }
    const ui = render(<SharedDocumentEditor ref={handle} {...props} />)
    const view = SourceView.findFromDOM(ui.getByLabelText('正文源文编辑'))!
    await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '新正文' } }))
    ui.rerender(<SharedDocumentEditor ref={handle} {...props} revision="1" sourceDraft="外部回显" document={body('外部回显')} />)
    expect(view.state.doc.toString()).toBe('新正文')
    await act(async () => ack.resolve(false))
    expect(await handle.current!.drain()).toMatchObject({ ready: false, source: '新正文' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(view.state.doc.toString()).toBe('新正文')
  })

  it('does not force ongoing IME into a formal commit', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const change = vi.fn(), editor = sessions.createLayoutEditor(host, { document: body('原文'), revision: '0', change, undo() {}, redo() {}, diagnostic() {} })
    try {
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      editor.view.dispatch(editor.view.state.tr.insertText('组合输入', 1))
      expect(await editor.drain()).toBe(false)
      expect(change).not.toHaveBeenCalled()
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1))
      expect(editor.view.state.doc.textContent).toBe('组合输入原文')
    } finally { editor.destroy(); host.remove() }
  })

  it('retains prepared resource batches on rejection, forwards them on a new edit and discards only explicitly', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const ack = deferred<boolean>(), change = vi.fn((_document: MarkdownDocument, _operation: sessions.DocumentOperation) => ack.promise)
    const discard = vi.fn(async () => {}), handle = { asset: 'prepared-image' }
    const options = { document: body('正文'), revision: '0', change, undo() {}, redo() {}, diagnostic() {},
      clipboardResourcePort: () => ({ discard, prepareResources: async () => ({
        resources: { assets: [{ assetId: 'prepared-image', source: { kind: 'project' as const } }], components: [] },
        assetIds: { image: 'prepared-image' }, components: [], prepared: handle,
      }) }) }
    const editor = sessions.createLayoutEditor(host, options)
    try {
      const source = toEditorDocument({ blocks: [{ id: 'image', type: 'media', mediaKind: 'image', assetId: 'image', layout: 'content-width' }] })
      const payload = JSON.stringify({ editorId: 'other', slice: new Slice(source.content, 0, 0).toJSON(),
        resources: { assets: [{ assetId: 'image', source: { kind: 'project' } }], components: [] } })
      editor.view.someProp('handlePaste', run => run(editor.view, { clipboardData: { getData: () => payload } } as unknown as ClipboardEvent, Slice.empty))
      await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1))
      expect(change.mock.calls[0][1]).toMatchObject({ preparedResources: handle, preparedResourceBatches: [handle] })
      ack.resolve(false)
      expect(await editor.drain()).toBe(false)
      expect(discard).not.toHaveBeenCalled()
      editor.view.dispatch(editor.view.state.tr.insertText('继续', editor.view.state.doc.content.size - 1))
      expect(change).toHaveBeenCalledTimes(2)
      expect(change.mock.calls[1][1].preparedResourceBatches).toEqual([handle])
      expect(await editor.drain()).toBe(false)
      expect(await editor.discardDraft(options)).toBe(true)
      expect(discard).toHaveBeenCalledTimes(1)
      expect(editor.view.state.doc.textContent).toBe('正文')
    } finally { editor.destroy(); host.remove() }
  })

  it.each(['copy', 'move'] as const)('prepares empty-manifest V10 %s and waits through decoration refreshes', async identity => {
    const host = document.createElement('div'); document.body.append(host)
    const gate = deferred<void>(), change = vi.fn((_document: MarkdownDocument, _operation: sessions.DocumentOperation) => {})
    const context = vi.fn((_resources: MarkdownDocument['resources'], content: MarkdownDocument['content']) => ({ kind: 'cw-course-v10-resources', content }))
    const prepareResources = vi.fn(async (input: { identity?: 'copy' | 'move' }) => {
      await gate.promise
      return { resources: emptyDocumentResources(), assetIds: {}, components: [], identities: { formal: input.identity === 'move' ? 'formal' : 'cloned' }, prepared: {} }
    })
    const editor = sessions.createLayoutEditor(host, { document: { ...body('正文'), content: { blocks: [{ id: 'formal', type: 'course-instance' }, ...body('正文').content.blocks] } },
      revision: '0', change, undo() {}, redo() {}, diagnostic() {}, clipboardContext: context,
      clipboardResourcePort: () => ({ prepareResources, discard: async () => {} }) })
    const data = new Map<string, string>(), event = { clipboardData: { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '' }, preventDefault() {} } as unknown as ClipboardEvent
    try {
      const view = editor.view
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
      view.someProp('handleDOMEvents', handlers => handlers[identity === 'move' ? 'cut' : 'copy']?.(view, event))
      expect(context.mock.calls[0][1].blocks).toEqual([{ id: 'formal', type: 'course-instance' }])
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
      view.someProp('handlePaste', run => run(view, event, Slice.empty))
      expect(prepareResources.mock.calls[0][0].identity).toBe(identity)
      expect(editor.flush()).toBe(false)
      let drained = false
      const waiting = editor.drain().then(result => { drained = true; return result })
      view.dispatch(view.state.tr.setMeta('decoration-only', true))
      await Promise.resolve()
      expect(drained).toBe(false)
      gate.resolve()
      expect(await waiting).toBe(true)
      const last = change.mock.calls.at(-1)![0]
      expect(last.content.blocks.filter(block => block.type === 'course-instance').map(block => block.id)).toEqual(identity === 'move' ? ['formal'] : ['formal', 'cloned'])
      expect(change).toHaveBeenCalledTimes(identity === 'move' ? 2 : 1)
    } finally { editor.destroy(); host.remove() }
  })
})
