import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { BottomSceneNavigator, buildBottomSceneCards } from '../../src/renderer/ui/BottomSceneNavigator'
import { selectProjectLibraryDefinitions } from '../../src/renderer/components/componentLibraryModel'
import { builtInWorkAssetMetadata } from '../../src/core/components/library/workAssets'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentsTab } from '../../src/renderer/ui/ComponentsTab'

vi.mock('../../src/renderer/ui/SceneThumbnail', () => ({ SceneThumbnail: () => <span>缩略图</span> }))
const store = () => useEditorStore.getState()
afterEach(() => { cleanup(); if (store().courseView.project) store().cancelTextEdit(); store().courseBridge.dispose() })

it('offers an explicit whole-page delete on all root cards, preserving the other pages and one-step Undo', async () => {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  await store().addCourseContent('flow-page')
  await store().addCourseContent('spatial-page')
  const id = store().courseView.activeDocumentId!, session = host.registry.get(id)
  const cards = buildBottomSceneCards(store().courseView.project!)
  render(<BottomSceneNavigator documentId={id} />)
  for (const card of cards) {
    const before = session.read()
    const label = card.kind === 'slide' ? '整个演示场景' : card.kind === 'flow' ? '流式页' : '无限画布'
    const button = screen.getByRole('button', { name: `删除${label}：${card.page.label}` })
    expect(button).toHaveTextContent('删除整页')
    fireEvent.click(button)
    const dialog = screen.getByRole('alertdialog', { name: `删除${label}？` })
    expect(dialog).toHaveTextContent(card.kind === 'slide' ? '命名状态' : card.kind === 'flow' ? '全部正文' : '全部对象和镜头')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '删除整页' })); await store().courseBridge.drain() })
    expect(store().courseView.project!.rootIds).toEqual(before.model.kind === 'course-v10' ? before.model.project.rootIds.filter(root => root !== card.key) : [])
    expect(session.read().undoDepth).toBe(before.undoDepth + 1)
    await act(async () => { await store().courseBridge.undo(id) })
    expect(session.read().revision).toBe(before.revision + 2)
    expect(store().courseView.project).toEqual(before.model.kind === 'course-v10' ? { ...before.model.project, revision: before.revision + 2 } : null)
  }
})

it('opens a non-current state menu without navigation and applies deletion to that state only', async () => {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  await store().addPresentationState('当前状态')
  const current = store().courseView.activeStateId!
  await store().addPresentationState('菜单目标')
  const other = store().courseView.activeStateId!, id = store().courseView.activeDocumentId!, surface = store().courseView.surfaceId!
  store().courseBridge.selectPresentationState(id, current, surface)
  const session = host.registry.get(id), before = session.read()
  render(<BottomSceneNavigator documentId={id} />)
  fireEvent.contextMenu(screen.getByRole('button', { name: /菜单目标，命名状态/ }))
  expect(store().courseView.activeStateId).toBe(current)
  expect(session.read()).toEqual(before)
  const menu = screen.getByRole('menu', { name: '状态操作' })
  fireEvent.click(within(menu).getByRole('menuitem', { name: '删除状态' }))
  const dialog = screen.getByRole('alertdialog', { name: '删除场景状态？' })
  expect(dialog).toHaveTextContent('菜单目标')
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '删除状态' })); await store().courseBridge.drain() })
  expect(store().courseView.activeStateId).toBe(current)
  const presentation = store().courseView.project!.instances[surface].container!.presentation!
  expect(presentation.states.some(state => state.id === other)).toBe(false)
  expect(presentation.states.some(state => state.id === current)).toBe(true)
})

it('disables whole-page deletion on the last root while keeping the master state intact', async () => {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  const id = store().courseView.activeDocumentId!
  render(<BottomSceneNavigator documentId={id} />)
  expect(screen.getByRole('button', { name: /^删除整个演示场景：/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: '删除当前状态' })).toBeDisabled()
  expect(screen.getByRole('button', { name: /母版，所有命名状态的继承源/ })).toBeInTheDocument()
})

it('hides host surface definitions without removing the actual insertable container assets', () => {
  const project = createBlankCourseProjectV10('库过滤')
  expect(selectProjectLibraryDefinitions(project.definitions)).toEqual([])
  expect(builtInWorkAssetMetadata().filter(entry => ['guoling.work.slide', 'guoling.work.flow', 'guoling.work.spatial'].includes(entry.id))).toHaveLength(3)
})

it('adds an embedded project component to the selected global scope instead of the local page', async () => {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  const id = store().courseView.activeDocumentId!, page = store().courseView.surfaceId!
  await store().courseBridge.edit([
    { type: 'definition.set', definition: { id: 'widget', title: '可复制组件', role: 'content',
      implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' } } },
    { type: 'instance.insert', container: { kind: 'surface', surfaceId: page }, index: 0, rootIds: ['source'],
      instances: [{ id: 'source', definitionId: 'widget', data: { title: '原实例正文' }, frame: { width: 120, height: 80, transform: [1, 0, 0, 1, 10, 20] } }] },
  ])
  store().setEditingScope('global')
  store().courseKernel.selectInstances([], page, id)
  const before = structuredClone(store().courseView.project!)
  render(<ComponentsTab />)
  fireEvent.click(screen.getByTestId('component-widget'))
  await waitFor(() => expect(store().courseView.project!.global.overlay).toHaveLength(1))
  const after = store().courseView.project!, added = after.global.overlay[0]
  expect(after.instances[page].childIds).toEqual(before.instances[page].childIds)
  expect(after.instances[added].data).toEqual({ title: '原实例正文' })
  expect(after.instances.source).toEqual(before.instances.source)
  await act(async () => { await store().courseBridge.undo(id) })
  expect(store().courseView.project!.global.overlay).toEqual(before.global.overlay)
})
