import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { TextSelection } from 'prosemirror-state'
import { EditorView as SourceView } from '@codemirror/view'
import * as markdown from '../../src/shared/document/markdown'
import * as sessions from '../../src/renderer/document/editorSession'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import type { MarkdownDocument } from '../../src/shared/document/markdown'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const initial = (): MarkdownDocument => ({ content: { blocks: [{ id: 'body', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Original text' }] } }] }, resources: emptyDocumentResources() })

describe('main Flow materializes source only when it is consumed', () => {
  it('keeps ordinary input, ACK and semantic selection source-free, then shares source/map materialization', () => {
    const serialize = vi.spyOn(markdown, 'serializeDocumentMarkdown'), parse = vi.spyOn(markdown, 'parseDocumentMarkdown')
    const factory = vi.spyOn(sessions, 'createLayoutEditor'), handle = createRef<SharedDocumentEditorHandle>(), onChange = vi.fn(), onDraft = vi.fn()
    const props = { document: initial(), revision: '1', target: 'flow' as const, deferLayoutSource: true, onChange, onDraft, onUndo() {}, onRedo() {} }
    const ui = render(<SharedDocumentEditor ref={handle} {...props} />)
    expect(serialize).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled()
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
    act(() => editor.view.dispatch(editor.view.state.tr.insertText('Changed ', 1)))
    const accepted = onChange.mock.calls.at(-1)![0] as MarkdownDocument
    ui.rerender(<SharedDocumentEditor ref={handle} {...props} document={accepted} revision="2" />)
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 8))))
    expect(handle.current!.getContextualEditTarget()).toMatchObject({ mode: 'layout', revision: '2', selection: { kind: 'text' } })
    expect(handle.current!.getContextualEditTarget()).not.toHaveProperty('source')
    expect(handle.current!.getContextualEditTarget()).not.toHaveProperty('ranges')
    expect(serialize).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled(); expect(onDraft).not.toHaveBeenCalled()
    expect(handle.current!.flush().source).toContain('Changed Original text')
    expect(handle.current!.flush().ready).toBe(true)
    expect(serialize).toHaveBeenCalledTimes(1); expect(parse).not.toHaveBeenCalled()
    fireEvent.click(ui.getByRole('button', { name: /^源码$/ }))
    expect(serialize).toHaveBeenCalledTimes(1); expect(parse).toHaveBeenCalledTimes(1)
    const source = SourceView.findFromDOM(ui.getByLabelText('正文源文编辑'))!
    const invalid = '```cw-object-v1\n{broken\n```\n'
    act(() => source.dispatch({ changes: { from: 0, to: source.state.doc.length, insert: invalid } }))
    expect(handle.current!.flush()).toMatchObject({ ready: false, source: invalid })
    expect(onDraft.mock.calls.at(-1)![0]).toBe(invalid)
  })

  it('materializes a rejected local draft and keeps it through unrelated incoming canonical data', async () => {
    const serialize = vi.spyOn(markdown, 'serializeDocumentMarkdown'), parse = vi.spyOn(markdown, 'parseDocumentMarkdown')
    const factory = vi.spyOn(sessions, 'createLayoutEditor'), handle = createRef<SharedDocumentEditorHandle>(), onDraft = vi.fn()
    const props = { document: initial(), revision: '1', target: 'flow' as const, deferLayoutSource: true, onChange: () => false, onDraft, onUndo() {}, onRedo() {} }
    const ui = render(<SharedDocumentEditor ref={handle} {...props} />)
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
    act(() => editor.view.dispatch(editor.view.state.tr.insertText('Local ', 1)))
    expect(onDraft.mock.calls.at(-1)![0]).toContain('Local Original text')
    expect(onDraft.mock.calls.at(-1)![1]).not.toHaveLength(0)
    ui.rerender(<SharedDocumentEditor ref={handle} {...props} document={initial()} revision="2" />)
    let result: Awaited<ReturnType<SharedDocumentEditorHandle['drain']>> | undefined
    await act(async () => { result = await handle.current!.drain() })
    expect(result).toMatchObject({ ready: false, source: expect.stringContaining('Local Original text') })
    expect(serialize).toHaveBeenCalledTimes(1); expect(parse).not.toHaveBeenCalled()
  })

  it('publishes the final composed semantic document before exposing its source at the composition boundary', async () => {
    const factory = vi.spyOn(sessions, 'createLayoutEditor'), handle = createRef<SharedDocumentEditorHandle>(), onChange = vi.fn(), composition = vi.fn()
    render(<SharedDocumentEditor ref={handle} document={initial()} revision="1" target="flow" deferLayoutSource onChange={onChange} onDraft={() => {}}
      onCompositionChange={composition} onUndo={() => {}} onRedo={() => {}} />)
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
    fireEvent.compositionStart(editor.view.dom)
    act(() => editor.view.dispatch(editor.view.state.tr.insertText('中文', 1)))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { fireEvent.compositionEnd(editor.view.dom); await Promise.resolve() })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(composition.mock.calls.at(-1)).toEqual([false, expect.stringContaining('中文Original text')])
    expect(handle.current!.flush().source).toContain('中文Original text')
  })
})
