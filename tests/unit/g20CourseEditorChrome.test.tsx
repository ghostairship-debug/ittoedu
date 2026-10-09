import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseAdvancedChrome, CourseEditorChromeContext, CourseEditorFrame } from '../../src/renderer/documents/CourseEditorChromeContext'
import { useContentEditorMode } from '../../src/renderer/documents/useContentEditorMode'
import { CourseLightToolbar } from '../../src/renderer/documents/CourseLightToolbar'
import { EditorPanelLayout } from '../../src/renderer/ui/EditorPanelLayout'
import { useEditorStore, selectCanRedoActiveSurface, selectCanUndoActiveSurface } from '../../src/renderer/store/editorStore'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })
function Tools({ documentId, reportError = () => {} }: { documentId: string; reportError?: (message: string) => void }) {
  const mode = useEditorStore(state => state.canvasMode)
  const depth = useEditorStore(state => state.courseView.snapshot?.undoDepth)
  void depth
  return <CourseLightToolbar documentId={documentId} isCurrentDocument={id => store().courseView.activeDocumentId === id}
    canUndo={selectCanUndoActiveSurface(store())} canRedo={selectCanRedoActiveSurface(store())}
    undo={() => { void store().undo() }} redo={() => { void store().redo() }} save={() => {}} saveAs={() => {}}
    onReplaceImage={() => {}} onAddImage={() => {}} onAddVideo={() => {}} onAddAudio={() => {}}
    insertSurface="slide" editingScope="scene" spatialScope={null} onAddText={() => { void store().addTextNode() }} mode={mode} reportError={reportError} />
}
async function fixture() {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  store().setEditingScope('scene')
  await act(async () => { store().setCanvasMode('edit'); await Promise.resolve() })
  await store().addTextNode()
  const documentId = store().courseView.activeDocumentId!, session = host.registry.get(documentId)
  return { host, documentId, session }
}
it('retains the same workspace, local draft, selected author object and History across light/deep while Undo uses Main', async () => {
  const h = await fixture(), before = h.session.read(), selection = store().courseView.selectedInstanceIds
  const mounted = vi.fn(), unmounted = vi.fn()
  function WorkspaceProbe() { const [draft, setDraft] = useState('unfinished input'); useEffect(() => { mounted(); return unmounted }, []); return <input aria-label="retained surface input" value={draft} onChange={event => setDraft(event.target.value)} /> }
  function View() {
    const [focused, setFocused] = useState(false)
    const chrome = useContentEditorMode(h.documentId, focused, () => setFocused(true), () => setFocused(false))
    return <CourseEditorChromeContext.Provider value={chrome}><button onClick={() => chrome.setMode(chrome.mode === 'light' ? 'deep' : 'light')}>切换深度</button>
      <CourseEditorFrame lightTools={<Tools documentId={h.documentId} />}><CourseAdvancedChrome><button>完整编辑工具</button></CourseAdvancedChrome>
        <EditorPanelLayout><aside>高级图层</aside><WorkspaceProbe /><aside>组件源码</aside></EditorPanelLayout></CourseEditorFrame></CourseEditorChromeContext.Provider>
  }
  render(<View />)
  expect(screen.queryByRole('button', { name: '完整编辑工具' })).toBeNull()
  fireEvent.change(screen.getByLabelText('retained surface input'), { target: { value: '仍在输入' } })
  fireEvent.click(screen.getByRole('button', { name: '切换深度' }))
  expect(screen.getByRole('button', { name: '完整编辑工具' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '切换深度' }))
  expect(screen.getByLabelText('retained surface input')).toHaveValue('仍在输入')
  expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled()
  expect(store().courseView.activeDocumentId).toBe(h.documentId)
  expect(store().courseView.selectedInstanceIds).toEqual(selection)
  expect(h.session.read()).toEqual(before)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '撤销' })); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(before.undoDepth - 1)
  expect(store().courseView.project!.instances[selection[0]]).toBeUndefined()
})
it('rejects a retained toolbar after switching to an identical project copy without a document or resource write', async () => {
  const h = await fixture(), copy = structuredClone(store().courseView.project!), report = vi.fn()
  render(<CourseEditorChromeContext.Provider value={{ documentId: h.documentId, mode: 'light', setMode() {} }}><Tools documentId={h.documentId} reportError={report} /></CourseEditorChromeContext.Provider>)
  await act(async () => { await store().createCourseDocumentFrom(copy) })
  const documentId = store().courseView.activeDocumentId!, before = h.host.registry.get(documentId).read()
  expect(documentId).not.toBe(h.documentId)
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '添加文字' })); await store().courseBridge.drain() })
  expect(report).toHaveBeenCalledWith(expect.stringContaining('文档已切换'))
  expect(h.host.registry.get(documentId).read()).toEqual(before)
})
