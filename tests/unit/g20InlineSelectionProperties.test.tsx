import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { selectActiveCourseLocationId, selectSelectedNodeId, selectSelectedNodeIds, useEditorStore } from '../../src/renderer/store/editorStore'
import { NativeSelectionContext, stepFontSize } from '../../src/renderer/workbench/NativeSelectionContext'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

const store = () => useEditorStore.getState()
const previousDesktopAPI = window.desktopAPI
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktopAPI })
})

it('M21 quick bar edits a selected object and a legal multi-selection through existing commands, one History step each', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  store().addTextNode(); await store().drainCourseDocument()
  const documentId = store().courseDocument.documentId!
  const first = selectSelectedNodeId(store())!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  const item = () => {
    const model = host.registry.get(documentId).read().model
    if (model.kind !== 'course-v9') throw new Error('course fixture')
    return (id: string) => locateCourseLayer(model.project, id)?.item
  }
  const depth = () => host.registry.get(documentId).read().undoDepth
  const box = () => ({ left: 200, top: 200, width: 120, height: 40 })

  function CurrentSelection() {
    const revision = useEditorStore(state => state.courseDocument.snapshot?.revision ?? 0)
    const itemIds = useEditorStore(selectSelectedNodeIds)
    const locationId = useEditorStore(selectActiveCourseLocationId)
    return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
      <main><NativeSelectionContext documentId={documentId} revision={revision} locationId={locationId} itemIds={itemIds} enabled bounds={box} /></main>
    </CourseEditorChromeContext.Provider>
  }
  render(<CurrentSelection />)
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  // No property card, numeric geometry or editor entry is left on the selection.
  expect(within(bar).queryByRole('button', { name: '属性' })).toBeNull()
  expect(screen.queryByLabelText('X')).toBeNull()
  expect(screen.queryByRole('button', { name: /更多属性|详细属性|打开图层|深度编辑/ })).toBeNull()
  expect(within(bar).getByRole('button', { name: 'AI 修改' })).toBeTruthy()

  const beforeBold = depth()
  await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: '加粗' })); await store().drainCourseDocument() })
  expect(depth()).toBe(beforeBold + 1)
  expect(item()(first)).toMatchObject({ content: { data: { style: { bold: true } } } })

  // Colours open the palette first; a continuous picker only appears behind "更多颜色".
  fireEvent.click(within(bar).getByRole('button', { name: '文字颜色' }))
  expect(screen.getByRole('radiogroup', { name: '常用色' })).toBeTruthy()
  expect(screen.queryByLabelText('自定义颜色')).toBeNull()
  const beforeColor = depth()
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: '红色' })); await store().drainCourseDocument() })
  expect(depth()).toBe(beforeColor + 1)
  expect(item()(first)).toMatchObject({ content: { data: { style: { color: '#ef4444' } } } })
  fireEvent.click(within(bar).getByRole('button', { name: '高亮' }))
  expect(screen.getByRole('button', { name: '无高亮' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '更多颜色…' }))
  expect(screen.getByLabelText('自定义颜色')).toBeTruthy()
  // Focus stays with the selection's owner, so Escape reaches the window: it closes the palette and keeps the selection.
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByLabelText('自定义颜色')).toBeNull()
  expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toBeTruthy()

  // Locking moves to "⋯"; a locked object is unlocked in place on the bar.
  fireEvent.click(within(bar).getByRole('button', { name: '更多操作' }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '锁定' })); await store().drainCourseDocument() })
  expect(item()(first)?.locked).toBe(true)
  const unlock = await screen.findByRole('button', { name: '解锁' })
  expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toHaveTextContent('已锁定')
  await act(async () => { fireEvent.click(unlock); await store().drainCourseDocument() })
  expect(item()(first)?.locked).toBe(false)

  // A hidden object keeps its selection, and the bar says so and shows it again in place.
  fireEvent.click(within(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).getByRole('button', { name: '更多操作' }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '隐藏' })); await store().drainCourseDocument() })
  expect(item()(first)?.visible).toBe(false)
  expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toHaveTextContent('已隐藏')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '显示' })); await store().drainCourseDocument() })
  expect(item()(first)?.visible).toBe(true)

  store().addTextNode(); await store().drainCourseDocument()
  const second = selectSelectedNodeId(store())!
  expect(second).not.toBe(first)
  act(() => store().selectNodes([first, second]))
  await waitFor(() => expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toHaveTextContent('已选 2 项'))
  const beforeMulti = depth()
  fireEvent.click(within(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).getByRole('button', { name: '更多操作' }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '全部隐藏' })); await store().drainCourseDocument() })
  expect(depth()).toBe(beforeMulti + 1)
  expect(item()(first)?.visible).toBe(false)
  expect(item()(second)?.visible).toBe(false)
  await waitFor(() => expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toHaveTextContent('已选 2 项（已隐藏）'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '全部显示' })); await store().drainCourseDocument() })
  expect(item()(first)?.visible).toBe(true)
  expect(item()(second)?.visible).toBe(true)

  act(() => store().selectNodes([]))
  await waitFor(() => expect(screen.queryByRole('toolbar', { name: '选中对象快捷工具' })).toBeNull())
})

it('M19 teacher controller quick bar collapses, hides and locks the controller in place', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject())
  const documentId = store().courseDocument.documentId!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  const model = () => {
    const read = host.registry.get(documentId).read().model
    if (read.kind !== 'course-v9') throw new Error('course fixture')
    return read.project
  }
  const controllerId = model().globalLayerItems[0]!.item.layerItemId
  const controller = () => locateCourseLayer(model(), controllerId)?.item
  function CurrentSelection() {
    const revision = useEditorStore(state => state.courseDocument.snapshot?.revision ?? 0)
    const itemIds = useEditorStore(selectSelectedNodeIds)
    const locationId = useEditorStore(selectActiveCourseLocationId)
    return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
      <main><NativeSelectionContext documentId={documentId} revision={revision} locationId={locationId} itemIds={itemIds} enabled bounds={() => ({ left: 200, top: 600, width: 400, height: 40 })} /></main>
    </CourseEditorChromeContext.Provider>
  }
  render(<CurrentSelection />)
  act(() => store().selectNodes([controllerId]))
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(bar).toHaveTextContent('教师控制台')
  expect(within(bar).getByRole('button', { name: 'AI 修改' })).toBeTruthy()
  // The default controller starts collapsed in playback; the bar switches that default both ways.
  await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: /^展开/ })); await store().drainCourseDocument() })
  expect(controller()).toMatchObject({ props: { defaultCollapsed: false } })
  await act(async () => { fireEvent.click(within(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).getByRole('button', { name: /^收起/ })); await store().drainCourseDocument() })
  expect(controller()).toMatchObject({ props: { collapsible: true, defaultCollapsed: true } })
  await act(async () => { fireEvent.click(within(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).getByRole('button', { name: '锁定' })); await store().drainCourseDocument() })
  expect(controller()?.locked).toBe(true)
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '解锁' })); await store().drainCourseDocument() })
  await act(async () => { fireEvent.click(within(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).getByRole('button', { name: '隐藏' })); await store().drainCourseDocument() })
  expect(controller()?.visible).toBe(false)
  expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toHaveTextContent('已隐藏')
})

it('M21 steps font sizes in readable increments inside the Native limits', () => {
  expect(stepFontSize(16, 1)).toBe(18)
  expect(stepFontSize(40, -1)).toBe(36)
  expect(stepFontSize(100, 1)).toBe(108)
  expect(stepFontSize(9, -1)).toBe(8)
  expect(stepFontSize(398, 1)).toBe(400)
})
