import { createRef } from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import { serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import { EditorView } from '@codemirror/view'

const document = { content: { blocks: [{ id: 'body', type: 'paragraph' as const,
  content: { inlines: [{ type: 'text' as const, text: '当前正式正文' }] } }] }, resources: emptyDocumentResources() }
const raw = '旧源码 $x+\\unknown{1}$ 尚未修正'
const diagnostic = { message: '局部公式尚未完成', offset: 4, endOffset: 20, line: 1, column: 5 }

describe('Flow raw source exits retain the original owner', () => {
  it('waits for durable retention before returning to the formal layout without discarding the retained raw', async () => {
    const handle = createRef<SharedDocumentEditorHandle>(), onDraft = vi.fn(), onDiscardDraft = vi.fn()
    let release!: (ready: boolean) => void
    const onPreserveDraft = vi.fn(() => new Promise<boolean>(resolve => { release = resolve }))
    const ui = render(<SharedDocumentEditor ref={handle} document={document} revision="1" target="flow"
      sourceDraft={raw} sourceDiagnostics={[diagnostic]} initialMode="source"
      onPreserveDraft={onPreserveDraft} onDiscardDraft={onDiscardDraft}
      onDraft={onDraft} onChange={() => true} onUndo={() => {}} onRedo={() => {}} />)
    try {
      await act(async () => fireEvent.click(ui.getByRole('button', { name: '保留原稿并继续编辑' })))
      expect(onPreserveDraft).toHaveBeenCalledOnce()
      expect(handle.current!.flush()).toMatchObject({ ready: false, source: raw })
      expect(handle.current!.canPreserveDraft()).toBe(true)
      expect(ui.getByRole('textbox', { name: '正文源文编辑' })).toBeInTheDocument()
      await act(async () => release(true))
      expect(ui.getByRole('textbox', { name: '正文编辑' })).toHaveTextContent('当前正式正文')
      expect((await handle.current!.drain()).ready).toBe(true)
      expect(handle.current!.canPreserveDraft()).toBe(false)
      expect(onDraft.mock.calls.at(-1)?.[0]).toBe(serializeDocumentMarkdown(document, 'flow'))
      expect(onDiscardDraft).not.toHaveBeenCalled()
    } finally { ui.unmount() }
  })

  it('keeps raw input in place when its owner cannot yet preserve prepared resources', async () => {
    const handle = createRef<SharedDocumentEditorHandle>(), onDraft = vi.fn()
    const ui = render(<SharedDocumentEditor ref={handle} document={document} revision="1" target="flow"
      sourceDraft={raw} sourceDiagnostics={[diagnostic]} initialMode="source" onPreserveDraft={async () => false}
      onDraft={onDraft} onChange={() => true} onUndo={() => {}} onRedo={() => {}} />)
    try {
      await act(async () => fireEvent.click(ui.getByRole('button', { name: '保留原稿并继续编辑' })))
      expect(handle.current!.flush()).toMatchObject({ ready: false, source: raw })
      expect(ui.getByRole('textbox', { name: '正文源文编辑' })).toHaveTextContent(raw)
      expect(onDraft.mock.calls.some(([source]) => source !== raw)).toBe(false)
    } finally { ui.unmount() }
  })

  it('does not drop local raw source when the formal input owner still reports an unknown operation', async () => {
    const handle = createRef<SharedDocumentEditorHandle>(), onDraft = vi.fn()
    const ui = render(<SharedDocumentEditor ref={handle} document={document} revision="1" target="flow"
      sourceDraft={raw} sourceDiagnostics={[diagnostic]} initialMode="source" onDiscardDraft={async () => false}
      onDraft={onDraft} onChange={() => true} onUndo={() => {}} onRedo={() => {}} />)
    try {
      await act(async () => fireEvent.click(ui.getByRole('button', { name: '丢弃待修草稿' })))
      expect(handle.current!.flush()).toMatchObject({ ready: false, source: raw })
      expect(ui.getByRole('textbox', { name: '正文源文编辑' })).toHaveTextContent(raw)
      expect(onDraft.mock.calls.some(([source]) => source !== raw)).toBe(false)
    } finally { ui.unmount() }
  })

  it('does not clear newer source typed while the original retention waits for its ACK', async () => {
    const handle = createRef<SharedDocumentEditorHandle>(), onDraft = vi.fn()
    let release!: (ready: boolean) => void
    const ui = render(<SharedDocumentEditor ref={handle} document={document} revision="1" target="flow"
      sourceDraft={raw} sourceDiagnostics={[diagnostic]} initialMode="source"
      onPreserveDraft={() => new Promise<boolean>(resolve => { release = resolve })}
      onDraft={onDraft} onChange={() => true} onUndo={() => {}} onRedo={() => {}} />)
    try {
      await act(async () => fireEvent.click(ui.getByRole('button', { name: '保留原稿并继续编辑' })))
      const editor = EditorView.findFromDOM(ui.getByRole('textbox', { name: '正文源文编辑' }))!
      const newer = `${raw}，等待期间的新输入`
      await act(async () => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: newer } }))
      await act(async () => release(true))
      expect(handle.current!.flush()).toMatchObject({ ready: false, source: newer })
      expect(ui.getByRole('textbox', { name: '正文源文编辑' })).toHaveTextContent(newer)
      expect(onDraft.mock.calls.at(-1)?.[0]).toBe(newer)
    } finally { ui.unmount() }
  })
})
