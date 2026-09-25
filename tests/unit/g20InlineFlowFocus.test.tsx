import { createElement, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as editorSession from '../../src/renderer/document/editorSession'
import { buildFlowEditorView } from '../../src/renderer/course/flowEditorView'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { FlowWorkspace, requestFlowBlockFocus } from '../../src/renderer/ui/FlowWorkspace'
import { createCourseStoreHost } from '../helpers/courseStoreHost'

const store = () => useEditorStore.getState()
function FlowHarness() {
  const session = useEditorStore(state => state.flowSession)
  const authoringSession = useEditorStore(state => state.courseAuthoringSession)
  const textEdit = useEditorStore(state => state.flowTextEdit)
  if (!session || !authoringSession) return null
  const props: ComponentProps<typeof FlowWorkspace> = {
    documentId: 'focus-document',
    view: buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId }),
    sessionToken: authoringSession.token,
    assets: session.history.present.assets,
    selection: session.selection,
    textEdit,
    commands: { run: (target, intent) => store().runFlowAuthoringIntent(target, intent) },
  }
  return createElement(FlowWorkspace, props)
}
beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  // JSDOM reports a zero-sized editor; contextual controls require visible bounds.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON() {} }))
  await createCourseStoreHost()
  store().createNewFlowProject()
  await store().drainCourseDocument()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  store().createNewProject()
})

it('M03 Flow contextual card opens the existing properties owner while retaining inline AI', () => {
  expect(store().flowSession).toBeTruthy()
  expect(store().courseAuthoringSession).toBeTruthy()
  const factory = vi.spyOn(editorSession, 'createLayoutEditor')
  render(createElement(FlowHarness))
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
  const text = editor.view.state.doc.textContent
  expect(text.length).toBeGreaterThan(1)
  act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 2))))
  const card = screen.getByLabelText('当前编辑目标')
  expect(card).toHaveTextContent('AI 指令')
  fireEvent.click(screen.getByRole('button', { name: '属性' }))
  expect(screen.getByLabelText('正文选中属性')).toHaveTextContent('块结构')
  expect(card).toHaveTextContent('AI 指令')
})

it('M03 Flow insertion focus request only focuses the new selected paragraph in the mounted document', async () => {
  expect(store().flowSession).toBeTruthy()
  expect(store().courseAuthoringSession).toBeTruthy()
  const factory = vi.spyOn(editorSession, 'createLayoutEditor')
  const mounted = render(createElement(FlowHarness))
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
  act(() => store().addTextNode())
  const session = store().flowSession!
  const blockId = session.selection.selectedBlockId!
  const revision = session.history.present.revision
  expect(blockId).toBeTruthy()
  expect(requestFlowBlockFocus({ documentId: 'another-document', surfaceId: session.selection.surfaceId, blockId, revision })).toBe(false)
  expect(requestFlowBlockFocus({ documentId: 'focus-document', surfaceId: session.selection.surfaceId, blockId, revision })).toBe(true)
  await waitFor(() => expect(editor.view.state.selection.$from.parent.attrs.id).toBe(blockId))
  expect(editor.view.hasFocus()).toBe(true)
  expect(store().flowSession!.history.present.revision).toBe(revision)
  mounted.unmount()
  expect(requestFlowBlockFocus({ documentId: 'focus-document', surfaceId: session.selection.surfaceId, blockId, revision })).toBe(false)
})
