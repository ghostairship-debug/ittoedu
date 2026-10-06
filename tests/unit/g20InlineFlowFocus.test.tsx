import { createElement, Fragment, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as editorSession from '../../src/renderer/document/editorSession'
import { buildFlowEditorView } from '../../src/renderer/course/flowEditorView'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'
import { requestFlowBlockFocus } from '../../src/renderer/document/flowWorkspaceRegistry'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { ElementTextCardLayer } from '../../src/renderer/workbench/elementCards/ElementTextCards'
import { elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'

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
  await store().createCourseDocument('flow')
  await store().drainCourseDocument()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  store().createNewProject()
})

it('M21 Flow text selection shows the shared quick bar with formatting and AI, and no properties card', async () => {
  expect(store().flowSession).toBeTruthy()
  expect(store().courseAuthoringSession).toBeTruthy()
  const factory = vi.spyOn(editorSession, 'createLayoutEditor')
  // The app registers how to read the open course; here the store's committed document stands in.
  const unregister = workbenchSelection.register('focus-document', async () => ({ ...await store().drainCourseDocument(), documentId: 'focus-document' }))
  render(createElement(Fragment, null, createElement(FlowHarness), createElement(ElementTextCardLayer)))
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
  const text = editor.view.state.doc.textContent
  expect(text.length).toBeGreaterThan(1)
  act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 2))))
  const bar = screen.getByRole('toolbar', { name: '选中内容快捷工具' })
  expect(within(bar).getByRole('button', { name: '当前选区加粗' })).toBeTruthy()
  expect(within(bar).getByRole('button', { name: '当前选区高亮' })).toBeTruthy()
  expect(within(bar).queryByRole('button', { name: '属性' })).toBeNull()
  // M15: the text gets its own card, which stays until it is closed.
  fireEvent.click(within(bar).getByRole('button', { name: 'AI 修改' }))
  expect(await screen.findByLabelText('AI 修改要求')).toBeTruthy()
  expect(elementCards.texts()).toMatchObject([{ kind: 'text', target: { kind: 'flow-range', from: 0, to: 1 } }])
  await act(async () => { await elementCards.closeText(elementCards.texts()[0]!.key) })
  unregister()
})

it('M03 Flow insertion focus request only focuses the new selected paragraph in the mounted document', async () => {
  expect(store().flowSession).toBeTruthy()
  expect(store().courseAuthoringSession).toBeTruthy()
  const factory = vi.spyOn(editorSession, 'createLayoutEditor')
  const mounted = render(createElement(FlowHarness))
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
  act(() => store().addTextNode())
  // Same order as App: the host confirms the insertion before focus is requested,
  // so the request carries the committed revision rather than the optimistic one.
  await act(async () => { await store().drainCourseDocument() })
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
