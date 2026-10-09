import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { selectActiveCourseLocationId, selectSelectedNodeId, selectSelectedNodeIds, useEditorStore } from '../../src/renderer/store/editorStore'
import { NativeSelectionContext, stepFontSize } from '../../src/renderer/workbench/NativeSelectionContext'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const store = () => useEditorStore.getState()
const previousDesktopAPI = window.desktopAPI
afterEach(() => {
  cleanup(); if (store().courseView.project) store().cancelTextEdit(); store().courseBridge.dispose()
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktopAPI })
})

it('M21 quick bar edits a selected object and a legal multi-selection through existing commands, one History step each', async () => {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api); store().setEditingScope('scene')
  store().addTextNode(); await store().drainCourseDocument()
  const documentId = store().courseView.activeDocumentId!
  const first = selectSelectedNodeId(store())!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  const item = () => {
    const model = host.registry.get(documentId).read().model
    if (model.kind !== 'course-v10') throw new Error('course fixture')
    return (id: string) => model.project.instances[id]
  }
  const depth = () => host.registry.get(documentId).read().undoDepth
  const box = () => ({ left: 200, top: 200, width: 120, height: 40 })

  function CurrentSelection() {
    const revision = useEditorStore(state => state.courseView.snapshot?.revision ?? 0)
    const itemIds = useEditorStore(selectSelectedNodeIds)
    const locationId = useEditorStore(selectActiveCourseLocationId)
    return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
      <main><NativeSelectionContext documentId={documentId} revision={revision} locationId={locationId} itemIds={itemIds} enabled bounds={box} /></main>
    </CourseEditorChromeContext.Provider>
  }
  render(<CurrentSelection />)
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  // The current quick bar exposes its property entry and the common object actions.
  expect(within(bar).getByRole('button', { name: '属性' })).toBeInTheDocument()
  expect(screen.queryByLabelText('X')).toBeNull()
  expect(screen.queryByRole('button', { name: /更多属性|详细属性|打开图层|深度编辑/ })).toBeNull()
  expect(within(bar).getByRole('button', { name: 'AI 修改' })).toBeTruthy()

  const beforeBold = depth()
  await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: '加粗' })); await store().drainCourseDocument() })
  expect(depth()).toBe(beforeBold + 1)
  expect(item()(first)).toMatchObject({ data: { appearance: { bold: true } } })

  // Colours open the palette first; a continuous picker only appears behind "更多颜色".
  fireEvent.click(within(bar).getByRole('button', { name: '文字颜色' }))
  expect(screen.getByRole('radiogroup', { name: '常用色' })).toBeTruthy()
  expect(screen.queryByLabelText('自定义颜色')).toBeNull()
  const beforeColor = depth()
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: '红色' })); await store().drainCourseDocument() })
  expect(depth()).toBe(beforeColor + 1)
  expect(item()(first)).toMatchObject({ data: { appearance: { color: '#ef4444' } } })
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

it('edits the same global teacher-controller from Slide and Flow and places its bar over the visible footprint', async () => {
  const host = await createCourseDocumentHost(); await store().connectCourseDocuments(host.api)
  const project = structuredClone(store().courseView.project!)
  project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: [] })
  await store().createCourseDocumentFrom(project)
  const documentId = store().courseView.activeDocumentId!, controllerId = project.global.overlay[0]
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  function CurrentSelection() {
    const view = useEditorStore(state => state.courseView)
    return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
      <main data-testid="flow-main"><div data-component-instance-id={controllerId} data-testid="controller-card" /><div data-controller-authoring-id={controllerId} data-testid="controller-footprint" />
        <NativeSelectionContext documentId={documentId} revision={view.snapshot?.revision ?? 0} locationId={view.surfaceId} itemIds={view.selectedInstanceIds} enabled />
      </main>
    </CourseEditorChromeContext.Provider>
  }
  render(<CurrentSelection />)
  const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
  vi.spyOn(screen.getByTestId('flow-main'), 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 700))
  vi.spyOn(screen.getByTestId('controller-card'), 'getBoundingClientRect').mockReturnValue(rect(20, 600, 680, 64))
  vi.spyOn(screen.getByTestId('controller-footprint'), 'getBoundingClientRect').mockReturnValue(rect(900, 612, 52, 52))
  act(() => { store().setEditingScope('global'); store().selectNodes([controllerId]) })
  const controller = () => store().courseView.project!.instances[controllerId]
  const initial = store().courseView.snapshot!, beforeFrame = structuredClone(controller().frame)
  let bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(bar).toHaveTextContent('教师控制台')
  const positioned = document.querySelector<HTMLElement>('[data-selection-quick-bar]')!
  expect(positioned.dataset.placement).toBe('above'); expect(positioned.style.left).toBe('900px')
  await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: /^展开/ })); await store().courseBridge.drain() })
  expect(controller().data).toMatchObject({ defaultCollapsed: false })
  expect(store().courseView.snapshot!.undoDepth).toBe(initial.undoDepth + 1)
  act(() => { store().courseBridge.selectSurface(documentId, 'flow'); store().setEditingScope('global'); store().selectNodes([controllerId]) })
  bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: /^收起/ })); await store().courseBridge.drain() })
  expect(controller().data).toMatchObject({ collapsible: true, defaultCollapsed: true })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '锁定' })); await store().courseBridge.drain() })
  expect(controller().locked).toBe(true)
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '解锁' })); await store().courseBridge.drain() })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '隐藏' })); await store().courseBridge.drain() })
  expect(controller().visible).toBe(false); expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toHaveTextContent('已隐藏')
  expect(controller().frame).toEqual(beforeFrame)
  await act(async () => { await store().courseBridge.undo(documentId) })
  expect(controller().visible).not.toBe(false)
})

it('M21 steps font sizes in readable increments inside the Native limits', () => {
  expect(stepFontSize(16, 1)).toBe(18)
  expect(stepFontSize(40, -1)).toBe(36)
  expect(stepFontSize(100, 1)).toBe(108)
  expect(stepFontSize(9, -1)).toBe(8)
  expect(stepFontSize(398, 1)).toBe(400)
})
