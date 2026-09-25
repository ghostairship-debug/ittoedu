import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { SharedDocumentEditor } from '../../src/renderer/document/SharedDocumentEditor'
import * as session from '../../src/renderer/document/editorSession'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { pinnedSelectionKey } from '../../src/renderer/document/selectionDecorations'
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('whole-body preview caret and later decoration refresh never become manual context, while real text/object selection still publishes', () => {
  const source = '# 原标题\n\n原正文😀\n', parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() })
  if (parsed.status !== 'valid') throw new Error('fixture')
  const factory = vi.spyOn(session, 'createLayoutEditor'), capture = vi.fn()
  const props = { document: parsed.document, revision: '1', sourceDraft: source, sourceMap: parsed.sourceMap, target: 'file' as const, initialMode: 'layout' as const,
    onChange: () => true, onDraft() {}, onUndo() {}, onRedo() {}, onContextualTargetChange: capture, onContextualCommand: vi.fn() }
  const ui = render(<SharedDocumentEditor {...props} />)
  const editor = factory.mock.results[0].value as ReturnType<typeof session.createLayoutEditor>
  const preview = { editId: 'whole', target: { kind: 'markdown-range' as const, from: 0, to: source.length }, value: '# 生成标题\n\n生成正文', cancel() {} }
  ui.rerender(<SharedDocumentEditor {...props} editPreview={preview} />)
  expect(editor.view.state.selection).toBeInstanceOf(NodeSelection)
  ui.rerender(<SharedDocumentEditor {...props} editPreview={{ ...preview, value: '# 生成标题\n\n继续生成正文' }} />)
  act(() => editor.view.dispatch(editor.view.state.tr.setMeta(pinnedSelectionKey, [])))
  expect(capture.mock.calls.filter(([target]) => target !== null)).toHaveLength(0)
  expect(screen.queryByLabelText('当前编辑目标')).toBeNull()
  ui.rerender(<SharedDocumentEditor {...props} />)
  expect(editor.view.state.selection).toBeInstanceOf(TextSelection)
  expect(capture.mock.calls.filter(([target]) => target !== null)).toHaveLength(0)
  act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 3))))
  expect(capture.mock.calls.at(-1)?.[0].selection.kind).toBe('text')
  expect(screen.getByLabelText('当前编辑目标')).toBeTruthy()
  act(() => editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, 0))))
  expect(capture.mock.calls.at(-1)?.[0].selection.kind).toBe('object')
})
