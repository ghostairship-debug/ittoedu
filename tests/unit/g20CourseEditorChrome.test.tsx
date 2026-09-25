import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { CourseAdvancedChrome, CourseEditorChromeContext, CourseEditorFrame } from '../../src/renderer/documents/CourseEditorChromeContext'
import { useContentEditorMode } from '../../src/renderer/documents/useContentEditorMode'
import { CourseLightToolbar } from '../../src/renderer/documents/CourseLightToolbar'
import { EditorPanelLayout } from '../../src/renderer/ui/EditorPanelLayout'
import { selectActiveCourseLocationId, selectActiveCourseProjectDocument, selectCanRedoActiveSurface, selectCanUndoActiveSurface, selectSelectedNodeId, useEditorStore } from '../../src/renderer/store/editorStore'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'

const store = () => useEditorStore.getState()
afterEach(() => cleanup())
function Tools({ documentId, reportError = () => {} }: { documentId: string; reportError?: (message: string) => void }) {
  const mode = useEditorStore(state => state.canvasMode)
  return <CourseLightToolbar documentId={documentId} isCurrentDocument={id => store().courseDocument.documentId === id}
    canUndo={selectCanUndoActiveSurface(store())} canRedo={selectCanRedoActiveSurface(store())}
    undo={() => store().undo()} redo={() => store().redo()} save={() => {}} onReplaceImage={() => {}} onAddImage={() => {}}
    onAddVideo={() => {}} onAddAudio={() => {}} insertSurface="slide" editingScope="scene" spatialScope={null}
    onAddText={() => store().addTextNode()} mode={mode} reportError={reportError} />
}
it('M03 keeps the same document, workspace instance, draft, selection and History across light/deep while a real edit and undo use main', async () => {
  const h = await createCourseStoreHost()
  await h.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  store().addTextNode(); await store().drainCourseDocument()
  expect(store().courseDocument.snapshot?.undoDepth, store().errorMessage ?? 'text should be committed').toBe(1)
  const id = store().courseDocument.documentId!, selected = selectSelectedNodeId(store())!, location = selectActiveCourseLocationId(store())
  const mounted = vi.fn(), unmounted = vi.fn()
  function WorkspaceProbe() { const [draft, setDraft] = useState('unfinished input'); useEffect(() => { mounted(); return unmounted }, []); return <input aria-label="retained surface input" value={draft} onChange={event => setDraft(event.target.value)} /> }
  function View() {
    const [focused, setFocused] = useState(false)
    const chrome = useContentEditorMode(id, focused, () => setFocused(true), () => setFocused(false))
    return <CourseEditorChromeContext.Provider value={chrome}>
      <button onClick={() => chrome.setMode(chrome.mode === 'light' ? 'deep' : 'light')}>切换深度</button>
      <CourseEditorFrame lightTools={<Tools documentId={id} />}>
        <CourseAdvancedChrome><button>完整编辑工具</button></CourseAdvancedChrome>
        <EditorPanelLayout><aside>高级图层</aside><WorkspaceProbe /><aside>组件源码</aside></EditorPanelLayout>
      </CourseEditorFrame>
    </CourseEditorChromeContext.Provider>
  }
  render(<View />)
  expect(screen.queryByRole('button', { name: '完整编辑工具' })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '加粗' })); await store().drainCourseDocument() })
  const revision = h.registry.get(id).read().revision, history = h.registry.get(id).read().undoDepth
  const model = h.registry.get(id).read().model
  if (model.kind !== 'course-v9') throw new Error('fixture')
  expect(locateCourseLayer(model.project, selected)?.item).toMatchObject({ content: { data: { style: { bold: true } } } })
  fireEvent.change(screen.getByLabelText('retained surface input'), { target: { value: 'still composing here' } })
  fireEvent.click(screen.getByRole('button', { name: '切换深度' }))
  expect(screen.getByRole('button', { name: '完整编辑工具' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '切换深度' }))
  expect(screen.getByLabelText('retained surface input')).toHaveValue('still composing here')
  expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled()
  expect(store().courseDocument.documentId).toBe(id)
  expect(selectSelectedNodeId(store())).toBe(selected); expect(selectActiveCourseLocationId(store())).toBe(location)
  expect(h.registry.get(id).read()).toMatchObject({ revision, undoDepth: history })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '撤销' })); await store().drainCourseDocument() })
  expect(h.registry.get(id).read().undoDepth).toBe(history - 1)
})
it('M03 rejects a retained toolbar from another DocumentId even for identical project copies', async () => {
  const h = await createCourseStoreHost()
  await h.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  store().addTextNode(); await store().drainCourseDocument()
  const original = structuredClone(selectActiveCourseProjectDocument(store())!), oldId = store().courseDocument.documentId!
  const error = vi.fn()
  render(<CourseEditorChromeContext.Provider value={{ documentId: oldId, mode: 'light', setMode: () => {} }}><Tools documentId={oldId} reportError={error} /></CourseEditorChromeContext.Provider>)
  await act(async () => { await h.open(original) })
  const newId = store().courseDocument.documentId!
  expect(newId).not.toBe(oldId)
  const revision = h.registry.get(newId).read().revision
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '添加文字' })); await store().drainCourseDocument() })
  expect(error).toHaveBeenCalledWith(expect.stringContaining('文档已切换'))
  expect(h.registry.get(newId).read().revision).toBe(revision)
})
