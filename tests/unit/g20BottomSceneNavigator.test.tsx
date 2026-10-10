import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { BottomSceneNavigator, CourseBottomNavigation, buildBottomSceneCards } from '../../src/renderer/ui/BottomSceneNavigator'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
vi.mock('../../src/renderer/ui/SceneThumbnail', () => ({ SceneThumbnail: () => <span aria-hidden="true">缩略图</span> }))
const store = () => useEditorStore.getState()
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })
async function fixture() {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  await store().addCourseContent('scene')
  const secondSlide = store().courseView.surfaceId!
  await store().addPresentationState('反馈')
  const stateId = store().courseView.activeStateId!
  await store().addCourseContent('flow-page')
  await store().addCourseContent('spatial-page')
  const spatialId = store().courseView.surfaceId!
  await store().addSpatialCameraFrameFromSession(spatialId)
  const documentId = store().courseView.activeDocumentId!, session = host.registry.get(documentId)
  return { documentId, session, secondSlide, stateId, spatialId }
}
it('uses the formal surface order and exact state/camera targets without navigation History, retaining light/deep rails', async () => {
  const h = await fixture(), before = h.session.read(), cards = buildBottomSceneCards(store().courseView.project!)
  expect(cards.map(card => card.kind)).toEqual(['slide', 'slide', 'flow', 'spatial'])
  const { rerender } = render(<CourseEditorChromeContext.Provider value={{ documentId: h.documentId, mode: 'light', setMode() {} }}><CourseBottomNavigation documentId={h.documentId} /></CourseEditorChromeContext.Provider>)
  const slideCard = screen.getByTestId(`bottom-scene-${h.secondSlide}`)
  await act(async () => { fireEvent.click(within(slideCard).getByRole('button', { name: /反馈，命名状态/ })) })
  expect(store().courseView.surfaceId).toBe(h.secondSlide)
  expect(store().courseView.activeStateId).toBe(h.stateId)
  expect(within(slideCard).getByRole('button', { name: /反馈，命名状态/ })).toHaveAttribute('aria-pressed', 'true')
  const spatial = cards.find(card => card.kind === 'spatial')!, flow = cards.find(card => card.kind === 'flow')!
  const spatialCard = screen.getByTestId(`bottom-page-${spatial.key}`), flowCard = screen.getByTestId(`bottom-page-${flow.key}`)
  expect(within(spatialCard).queryByRole('group', { name: /呈现状态/ })).toBeNull()
  expect(within(flowCard).queryByRole('group', { name: /呈现状态/ })).toBeNull()
  const camera = spatial.page.children.flatMap(group => group.children)[0]
  await act(async () => { fireEvent.click(within(spatialCard).getByRole('button', { name: `镜头 · ${camera.label}` })) })
  expect(store().readSpatialView(h.spatialId).activeCameraFrameId).toBe(camera.frameId)
  store().setEditingScope('global')
  await act(async () => { fireEvent.click(within(spatialCard).getByRole('button', { name: '世界' })) })
  expect(store().readSpatialView(h.spatialId).scope).toBe('world')
  expect(store().readSpatialView(h.spatialId).activeCameraFrameId).toBeNull()
  expect(h.session.read()).toEqual(before)
  act(() => { store().courseBridge.selectSurface(h.documentId, h.secondSlide) })
  rerender(<CourseEditorChromeContext.Provider value={{ documentId: h.documentId, mode: 'deep', setMode() {} }}><CourseBottomNavigation documentId={h.documentId} /></CourseEditorChromeContext.Provider>)
  expect(screen.queryByRole('navigation', { name: '场景与页面导航' })).toBeNull()
  expect(screen.getByRole('region', { name: '场景状态' })).toBeInTheDocument()
})
it('keeps rail creation and page menu copy/rename/delete on the same Session and restores deleted contents in one Undo', async () => {
  const h = await fixture(), before = h.session.read()
  render(<BottomSceneNavigator documentId={h.documentId} />)
  const rail = screen.getByRole('navigation', { name: '场景与页面导航' })
  fireEvent.click(within(rail).getByRole('button', { name: '新建场景或页面' }))
  const add = screen.getByRole('menu', { name: '新建场景或页面' })
  expect(within(add).getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['新建场景', '新建演示页', '新建流式布局', '新建无限画布'])
  await act(async () => { fireEvent.click(within(add).getByRole('menuitem', { name: '新建场景' })); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  const card = screen.getByTestId(`bottom-scene-${h.secondSlide}`)
  fireEvent.contextMenu(card)
  await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '创建副本' })); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 2)
  const copyId = store().courseView.surfaceId!
  fireEvent.contextMenu(screen.getByTestId(`bottom-scene-${copyId}`))
  fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '重命名' }))
  const title = screen.getByRole('textbox', { name: '页面名称' })
  fireEvent.change(title, { target: { value: '练习副本' } })
  await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); await store().courseBridge.drain() })
  const saved = h.session.read()
  expect(saved.undoDepth).toBe(before.undoDepth + 3)
  fireEvent.contextMenu(screen.getByTestId(`bottom-scene-${copyId}`))
  fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '删除场景' }))
  expect(h.session.read()).toEqual(saved)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '删除页面' })); await store().courseBridge.drain() })
  expect(store().courseView.project!.surfaces.some(surface => surface.id === copyId)).toBe(false)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 4)
  await act(async () => { await store().courseBridge.undo(h.documentId) })
  expect(store().courseView.project!.surfaces.find(surface => surface.id === copyId)?.title).toBe('练习副本')
})
