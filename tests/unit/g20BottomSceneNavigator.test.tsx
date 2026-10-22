import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { BottomSceneNavigator, CourseBottomNavigation, buildBottomSceneCards } from '../../src/renderer/ui/BottomSceneNavigator'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
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
  expect(within(spatialCard).queryByRole('button', { name: '世界' })).toBeNull()
  await act(async () => { fireEvent.click(within(spatialCard).getByRole('button', { name: /页面 .*世界|页面 .*无限画布/ })) })
  expect(store().readSpatialView(h.spatialId).scope).toBe('world')
  expect(store().readSpatialView(h.spatialId).activeCameraFrameId).toBeNull()
  expect(h.session.read()).toEqual(before)
  act(() => { store().courseBridge.selectSurface(h.documentId, h.secondSlide) })
  rerender(<CourseEditorChromeContext.Provider value={{ documentId: h.documentId, mode: 'deep', setMode() {} }}><CourseBottomNavigation documentId={h.documentId} /></CourseEditorChromeContext.Provider>)
  expect(screen.queryByRole('navigation', { name: '场景与页面导航' })).toBeNull()
  expect(screen.getByRole('region', { name: '场景状态' })).toBeInTheDocument()
  for (const surfaceId of [flow.key, spatial.key]) {
    act(() => { store().courseBridge.selectSurface(h.documentId, surfaceId) })
    expect(screen.queryByRole('region', { name: '场景状态' })).toBeNull()
    expect(() => store().courseBridge.selectPresentationState(h.documentId, null, surfaceId)).toThrow('场景状态仅适用于演示页面')
  }
  expect(h.session.read()).toEqual(before)
})
it('keeps rail creation and page menu copy/rename/delete on the same Session and restores deleted contents in one Undo', async () => {
  const h = await fixture(), before = h.session.read()
  render(<BottomSceneNavigator documentId={h.documentId} />)
  const rail = screen.getByRole('navigation', { name: '场景与页面导航' })
  fireEvent.click(within(rail).getByRole('button', { name: '新建页面' }))
  const add = screen.getByRole('menu', { name: '新建页面' })
  expect(within(add).getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['演示页', '流式页面', '无限画布'])
  await act(async () => { fireEvent.click(within(add).getByRole('menuitem', { name: '演示页' })); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  const card = screen.getByTestId(`bottom-scene-${h.secondSlide}`)
  const priorOrder = componentSurfaces(store().courseView.project!).map(surface => surface.id)
  const priorGlobal = structuredClone(store().courseView.project!.global)
  fireEvent.contextMenu(card)
  await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '在此页后新建演示页' })); await store().courseBridge.drain() })
  const insertedId = store().courseView.surfaceId!
  expect(componentSurfaces(store().courseView.project!)[priorOrder.indexOf(h.secondSlide) + 1]?.id).toBe(insertedId)
  expect(componentSurfaces(store().courseView.project!).find(surface => surface.id === insertedId)?.kind).toBe('slide')
  expect(store().courseView.project!.global).toEqual(priorGlobal)
  await act(async () => { await store().courseBridge.undo(h.documentId) })
  expect(componentSurfaces(store().courseView.project!).map(surface => surface.id)).toEqual(priorOrder)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
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
  expect(componentSurfaces(store().courseView.project!).some(surface => surface.id === copyId)).toBe(false)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 4)
  await act(async () => { await store().courseBridge.undo(h.documentId) })
  expect(componentSurfaces(store().courseView.project!).find(surface => surface.id === copyId)?.title).toBe('练习副本')
})

it('keeps Source roots in the same light directory and navigates between program and native cards without author writes', async () => {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  const documentId = store().courseView.activeDocumentId!, slideId = store().courseView.rootInstanceId!
  const program = createBlankProgramProject('互动程序'), programId = program.rootIds[0]
  program.instances[programId].data = { html: '<button>原程序</button>', css: '' }
  await store().courseBridge.edit([
    ...Object.values(program.definitions).map(definition => ({ type: 'definition.set' as const, definition })),
    { type: 'instance.insert', container: { kind: 'project' }, index: 1, rootIds: [programId], instances: Object.values(program.instances) },
    { type: 'project.entry.set', entry: { rootInstanceId: programId } },
  ])
  const session = host.registry.get(documentId), before = session.read()
  const cards = buildBottomSceneCards(store().courseView.project!)
  expect(cards.map(card => [card.kind, card.key, card.number])).toEqual([['slide', slideId, 1], ['program', programId, 2]])
  expect(cards[1]).not.toHaveProperty('surface')
  render(<BottomSceneNavigator documentId={documentId} />)
  const programCard = screen.getByTestId(`bottom-program-${programId}`)
  await act(async () => { fireEvent.click(within(programCard).getByRole('button', { name: '程序 2：互动程序' })) })
  expect(store().courseView.rootInstanceId).toBe(programId)
  expect(store().courseView.surfaceId).toBeNull()
  expect(programCard).toHaveAttribute('data-current-card', 'true')
  await act(async () => { fireEvent.click(within(screen.getByTestId(`bottom-scene-${slideId}`)).getByRole('button', { name: /页面 1：/ })) })
  expect(store().courseView.rootInstanceId).toBe(slideId)
  expect(store().courseView.surfaceId).toBe(slideId)
  expect(session.read()).toEqual(before)
  fireEvent.contextMenu(programCard)
  await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: '程序操作' })).getByRole('menuitem', { name: '前移' })); await store().courseBridge.drain() })
  expect(store().courseView.project!.rootIds).toEqual([programId, slideId])
  expect(buildBottomSceneCards(store().courseView.project!).map(card => card.number)).toEqual([1, 2])
  expect(store().courseView.project!.instances[programId].data).toEqual(program.instances[programId].data)
  fireEvent.contextMenu(programCard)
  fireEvent.click(within(screen.getByRole('menu', { name: '程序操作' })).getByRole('menuitem', { name: '重命名' }))
  fireEvent.change(screen.getByRole('textbox', { name: '程序名称' }), { target: { value: '保留程序' } })
  await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: '程序名称' }), { key: 'Enter' }); await store().courseBridge.drain() })
  expect(store().courseView.project!.instances[programId].name).toBe('保留程序')
  fireEvent.contextMenu(programCard)
  fireEvent.click(within(screen.getByRole('menu', { name: '程序操作' })).getByRole('menuitem', { name: '删除程序' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog', { name: '删除程序？' })).getByRole('button', { name: '删除程序' })); await store().courseBridge.drain() })
  expect(store().courseView.project!.rootIds).toEqual([slideId])
  expect(store().courseView.project!.entry).toEqual({ rootInstanceId: slideId })
  await act(async () => { await store().courseBridge.undo(documentId) })
  expect(store().courseView.project!.rootIds).toEqual([programId, slideId])
  expect(store().courseView.project!.entry).toEqual({ rootInstanceId: programId })
  expect(store().courseView.project!.instances[programId].data).toEqual(program.instances[programId].data)
  await act(async () => { await store().deleteCourseSurface(slideId) })
  expect(store().courseView.project!.rootIds).toEqual([programId])
  const onlyProgram = screen.getByTestId(`bottom-program-${programId}`)
  expect(within(onlyProgram).getByRole('button', { name: '程序 1：保留程序' })).toBeInTheDocument()
  fireEvent.contextMenu(onlyProgram)
  expect(within(screen.getByRole('menu', { name: '程序操作' })).getByRole('menuitem', { name: '删除程序' })).toHaveAttribute('aria-disabled', 'true')
})
