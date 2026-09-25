import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { selectActiveCourseLocationId, selectSelectedNodeId, selectSelectedNodeIds, useEditorStore } from '../../src/renderer/store/editorStore'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

const store = () => useEditorStore.getState()
const previousDesktopAPI = window.desktopAPI
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktopAPI })
})

it('M03 selected text and legal multi-selection use existing authoring commands and one History', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  store().addTextNode(); await store().drainCourseDocument()
  const documentId = store().courseDocument.documentId!
  const first = selectSelectedNodeId(store())!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })

  function CurrentSelection() {
    const revision = useEditorStore(state => state.courseDocument.snapshot?.revision ?? 0)
    const itemIds = useEditorStore(selectSelectedNodeIds)
    const locationId = useEditorStore(selectActiveCourseLocationId)
    return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'deep', setMode() {} }}>
      <main><NativeSelectionContext documentId={documentId} revision={revision} locationId={locationId} itemIds={itemIds} enabled /></main>
    </CourseEditorChromeContext.Provider>
  }
  render(<CurrentSelection />)
  await waitFor(() => expect(screen.getByRole('button', { name: '属性' })).toBeVisible())
  expect(document.querySelector('.native-selection-context')).not.toHaveClass('native-selection-context--idle')
  fireEvent.click(screen.getByRole('button', { name: '属性' }))
  expect(screen.getByRole('complementary', { name: '选中对象属性' })).toHaveTextContent('字号')
  const beforeText = host.registry.get(documentId).read().undoDepth
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '加粗' })); await store().drainCourseDocument() })
  const afterText = host.registry.get(documentId).read()
  expect(afterText.undoDepth).toBe(beforeText + 1)
  if (afterText.model.kind !== 'course-v9') throw new Error('course fixture')
  expect(locateCourseLayer(afterText.model.project, first)?.item).toMatchObject({ content: { data: { style: { bold: true } } } })

  store().addTextNode(); await store().drainCourseDocument()
  const second = selectSelectedNodeId(store())!
  expect(second).not.toBe(first)
  act(() => store().selectNodes([first, second]))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: '选中对象属性' })).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: '属性' })).toBeVisible())
  fireEvent.click(screen.getByRole('button', { name: '属性' }))
  expect(screen.getByRole('complementary', { name: '选中对象属性' })).toHaveTextContent('已选 2 个对象')
  const beforeMulti = host.registry.get(documentId).read().undoDepth
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '全部隐藏' })); await store().drainCourseDocument() })
  const afterMulti = host.registry.get(documentId).read()
  expect(afterMulti.undoDepth).toBe(beforeMulti + 1)
  if (afterMulti.model.kind !== 'course-v9') throw new Error('course fixture')
  expect(locateCourseLayer(afterMulti.model.project, first)?.item.visible).toBe(false)
  expect(locateCourseLayer(afterMulti.model.project, second)?.item.visible).toBe(false)
  workbenchSelection.setManual(documentId, null)
  await waitFor(() => expect(document.querySelector('.native-selection-context')).toHaveClass('native-selection-context--idle'))
})
