import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SelectionContextController, captureSelection, captureFlowSelection, selectionReference } from '../../src/renderer/workbench/SelectionContextController'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { SharedDocumentEditor } from '../../src/renderer/document/SharedDocumentEditor'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import * as editorSession from '../../src/renderer/document/editorSession'
import { TextSelection } from 'prosemirror-state'
import { pinnedSelectionKey } from '../../src/renderer/document/selectionDecorations'
import { executionDocumentReferenceSchema } from '../../src/shared/workbench/executionDesktop'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => {
  // JSDOM has no layout; give the contextual overlay a visible editor viewport.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON() {} }))
})
const snapshot = (): DocumentSnapshot => ({ documentId: 'md', epoch: 'epoch', revision: 0, model: new MarkdownDriver().load(new TextEncoder().encode('一二三四五六')), binding: { kind: 'untitled', suggestedName: '未保存.md' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 })
it('M04 freezes a multi-range reference independently of the next manual selection, and rejects stale or empty local edits', async () => {
  const current = snapshot(), controller = new SelectionContextController(async () => current), sent = vi.fn()
  controller.onRequest(sent)
  const selected = captureSelection(current, [{ kind: 'markdown-range', from: 0, to: 1 }, { kind: 'markdown-range', from: 3, to: 4 }], '两处')
  controller.setManual('md', selected)
  const reference = selectionReference(selected, false); controller.setPinned([reference])
  controller.setManual('md', captureSelection(current, [{ kind: 'markdown-range', from: 4, to: 6 }], '新选择'))
  expect(controller.getPinned('md')?.targets).toEqual(selected.targets)
  expect(reference.writable).toEqual([])
  await controller.request(selected, '只改两处'); expect(sent.mock.calls[0][0].selection.targets).toEqual(selected.targets)
  current.revision++; await expect(controller.request(selected, '迟到请求')).rejects.toThrow('已改变')
  expect(sent).toHaveBeenCalledTimes(1)
  const course = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = course.surfaces[0]
  if (flow.type !== 'flow') throw new Error('fixture')
  flow.blocks = [{ id: 'body', type: 'paragraph', content: { inlines: [{ type: 'text', text: '甲乙丙丁' }] } }]
  const flowSnapshot: DocumentSnapshot = { ...snapshot(), documentId: 'flow', model: { kind: 'course-v9', project: course, resources: snapshot().model.resources } }
  const textSelection = { mode: 'layout' as const, revision: '0', source: '', label: '讲义两字', ranges: null,
    selection: { kind: 'text' as const, revision: '0', anchor: { blockId: 'body', slot: { kind: 'field' as const, field: 'content' as const }, offset: 1, affinity: 'after' as const }, head: { blockId: 'body', slot: { kind: 'field' as const, field: 'content' as const }, offset: 3, affinity: 'before' as const } } }
  expect(captureFlowSelection(flowSnapshot, flow.id, textSelection).targets).toEqual([{ kind: 'flow-range', surfaceId: flow.id, blockId: 'body', parentId: null, slot: { kind: 'field', field: 'content' }, from: 1, to: 3 }])
  expect(() => captureFlowSelection(flowSnapshot, flow.id, { ...textSelection, selection: { ...textSelection.selection, head: { ...textSelection.selection.head, blockId: 'other' } } })).toThrow()

  expect(() => captureSelection(current, [], '空')).toThrow('没有选中')
  expect(executionDocumentReferenceSchema.safeParse({ ...reference, selection: [{ kind: 'markdown-range', from: 1, to: 1 }] }).success).toBe(false)
})
it('M04 pins remain decorated after editor focus leaves and an inline draft keeps its old target until explicitly replaced', async () => {
  const parsed = parseDocumentMarkdown('正文一二三四', { target: 'file', createId: () => crypto.randomUUID() })
  if (parsed.status !== 'valid') throw new Error('fixture')
  const factory = vi.spyOn(editorSession, 'createLayoutEditor'), command = vi.fn()
  const ui = render(<><SharedDocumentEditor document={parsed.document} revision="0" sourceMap={parsed.sourceMap} initialMode="layout" target="file"
    pinnedTargets={[{ kind: 'markdown-range', from: 0, to: 2 }]} onChange={() => true} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} onContextualCommand={command} /><input aria-label="outside" /></>)
  const editor = factory.mock.results[0].value as ReturnType<typeof editorSession.createLayoutEditor>
  act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 3))))
  fireEvent.change(screen.getByLabelText('AI 指令'), { target: { value: '改成新的' } })
  const initial = screen.getByLabelText('AI 指令')
  act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 4, 6))))
  fireEvent.focus(screen.getByLabelText('outside'))
  expect(pinnedSelectionKey.getState(editor.view.state)?.find().length).toBeGreaterThan(0)
  expect(ui.container.querySelector('[data-context-pin]')).toBeTruthy()
  await act(async () => { fireEvent.submit(initial.closest('form')!) })
  expect(command.mock.calls[0][1].ranges[0]).toMatchObject({ from: 0, to: 2 })
})

it('M04 keeps an inline draft but removes obsolete range decoration after a new committed revision', () => {
  const parsed = parseDocumentMarkdown('原来正文', { target: 'file', createId: () => crypto.randomUUID() })
  if (parsed.status !== 'valid') throw new Error('fixture')
  const factory = vi.spyOn(editorSession, 'createLayoutEditor'), onCommand = vi.fn()
  const props = { document: parsed.document, sourceMap: parsed.sourceMap, initialMode: 'layout' as const, target: 'file' as const,
    onChange: () => true, onDraft() {}, onUndo() {}, onRedo() {}, onContextualCommand: onCommand }
  const ui = render(<SharedDocumentEditor {...props} revision="0" />)
  const editor = factory.mock.results[0].value as ReturnType<typeof editorSession.createLayoutEditor>
  act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 3))))
  fireEvent.change(screen.getByLabelText('AI 指令'), { target: { value: '仅改旧选区' } })
  ui.rerender(<SharedDocumentEditor {...props} revision="1" />)
  expect(screen.getByLabelText('AI 指令')).toHaveValue('仅改旧选区')
  expect(screen.getByText('选中的内容已改变，请改为当前选择；原指令仍保留。')).toBeTruthy()
  expect(pinnedSelectionKey.getState(editor.view.state)?.find()).toHaveLength(0)
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  expect(onCommand).not.toHaveBeenCalled()
})
