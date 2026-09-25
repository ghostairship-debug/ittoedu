import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { addCourseFlowPage, addCourseSpatialPage } from '../../src/core/tools/courseLocations'
import { setSpatialEditingScope } from '../../src/renderer/course/spatialEditorCommands'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
  useEditorStore,
} from '../../src/renderer/store/editorStore'
import { BottomSceneNavigator, CourseBottomNavigation, buildBottomSceneCards } from '../../src/renderer/ui/BottomSceneNavigator'
import { createCourseStoreHost } from '../helpers/courseStoreHost'

vi.mock('../../src/renderer/ui/SceneThumbnail', () => ({ SceneThumbnail: () => <span aria-hidden="true">缩略图</span> }))

const store = () => useEditorStore.getState()
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
const project = () => {
  const value = selectActiveCourseProjectDocument(store())
  if (!value) throw new Error('expected a current project')
  return value
}
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

it('projects Slide scenes and Flow/Spatial pages from the existing mixed course tree without inventing states', () => {
  const first = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = addCourseFlowPage(first, { title: '讲义 A' })
  if (!flow.ok) throw new Error(flow.reason)
  const spatial = addCourseSpatialPage(flow.project, { title: '空间 B' })
  if (!spatial.ok) throw new Error(spatial.reason)
  const cards = buildBottomSceneCards(spatial.project)
  expect(cards.map(card => card.kind)).toEqual(['slide', 'flow', 'spatial'])
  expect(cards[1]?.page.children.some(child => child.kind === 'flow-heading')).toBe(true)
  expect(cards[2]?.page.children.flatMap(group => group.children).some(child => child.kind === 'spatial-camera')).toBe(true)
})

it('switches to the target scene before its named state, highlights both levels and leaves History unchanged', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  const id = store().courseDocument.documentId!
  const firstLocation = selectActiveCourseLocationId(store())!
  const surfaceId = project().surfaces.find(surface => surface.type === 'slide')!.id
  store().addCourseContent('scene', { surfaceId })
  await store().drainCourseDocument()
  const secondLocation = selectActiveCourseLocationId(store())!
  store().addPresentationState('反馈')
  await store().drainCourseDocument()
  const secondScene = project().surfaces.find(surface => surface.id === surfaceId)
  if (secondScene?.type !== 'slide') throw new Error('expected slide page')
  const secondId = project().locations.find(location => location.id === secondLocation)
  if (secondId?.kind !== 'slide-scene') throw new Error('expected second scene')
  const feedback = secondScene.scenes.find(scene => scene.id === secondId.sceneId)?.presentation?.states.find(state => state.name === '反馈')
  if (!feedback) throw new Error('expected feedback state')
  store().activateCourseLocation(firstLocation)
  await store().drainCourseDocument()
  const undoBefore = host.registry.get(id).read().undoDepth
  const scroll = vi.fn()
  HTMLElement.prototype.scrollIntoView = scroll
  render(<BottomSceneNavigator documentId={id} />)

  const secondCard = screen.getByTestId(`bottom-scene-${secondLocation}`)
  await act(async () => { fireEvent.click(within(secondCard).getByRole('button', { name: '反馈' })) })
  expect(selectActiveCourseLocationId(store())).toBe(secondLocation)
  expect(selectActivePresentationStateId(store())).toBe(feedback.id)
  expect(within(secondCard).getByRole('button', { name: /场景 2：/ })).toHaveAttribute('aria-current', 'page')
  expect(within(secondCard).getByRole('button', { name: '反馈' })).toHaveAttribute('aria-pressed', 'true')
  expect(scroll).toHaveBeenCalled()
  await store().drainCourseDocument()
  expect(host.registry.get(id).read().undoDepth).toBe(undoBefore)
})

it('keeps Flow outline and Spatial world/camera navigation distinct from Slide presentation states', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  const id = store().courseDocument.documentId!
  store().addCourseContent('flow-page')
  await store().drainCourseDocument()
  store().addCourseContent('spatial-page')
  await store().drainCourseDocument()
  const cards = buildBottomSceneCards(project())
  const flow = cards.find(card => card.kind === 'flow')
  const spatial = cards.find(card => card.kind === 'spatial')
  if (!flow || !spatial) throw new Error('expected mixed pages')
  render(<BottomSceneNavigator documentId={id} />)
  const flowCard = screen.getByTestId(`bottom-page-${flow.key}`)
  const spatialCard = screen.getByTestId(`bottom-page-${spatial.key}`)
  expect(within(flowCard).queryByRole('group', { name: /呈现状态/ })).toBeNull()
  expect(within(spatialCard).queryByRole('group', { name: /呈现状态/ })).toBeNull()
  const heading = flow.page.children.find(child => child.kind === 'flow-heading')
  const camera = spatial.page.children.flatMap(group => group.children).find(child => child.kind === 'spatial-camera')
  if (!heading?.locationId || !camera?.locationId) throw new Error('expected outline and camera')
  await act(async () => { fireEvent.click(within(flowCard).getByRole('button', { name: `标题 · ${heading.label}` })) })
  expect(selectActiveCourseLocationId(store())).toBe(heading.locationId)
  await act(async () => { fireEvent.click(within(spatialCard).getByRole('button', { name: `镜头 · ${camera.label}` })) })
  expect(selectActiveCourseLocationId(store())).toBe(camera.locationId)
  const spatialSession = store().spatialSession
  if (!spatialSession) throw new Error('expected Spatial session')
  const cameraScope = setSpatialEditingScope(spatialSession, 'surface')
  if (!cameraScope.ok) throw new Error(cameraScope.reason)
  useEditorStore.setState({ spatialSession: cameraScope.nextSession })
  expect(store().spatialSession?.scope).toBe('surface')
  await act(async () => { fireEvent.click(within(spatialCard).getByRole('button', { name: '世界' })) })
  expect(store().spatialSession?.scope).toBe('world')
  expect(within(spatialCard).getByRole('button', { name: '世界' })).toHaveAttribute('aria-pressed', 'true')
  store().setEditingScope('global')
  await act(async () => { fireEvent.click(within(spatialCard).getByRole('button', { name: '世界' })) })
  expect(store().spatialSession?.scope).toBe('world')
})

it('shows the new rail only in light mode and preserves the professional state strip', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  const id = store().courseDocument.documentId!
  const { rerender } = render(<CourseEditorChromeContext.Provider value={{ documentId: id, mode: 'light', setMode: () => {} }}>
    <CourseBottomNavigation documentId={id} />
  </CourseEditorChromeContext.Provider>)
  expect(screen.getByRole('navigation', { name: '课件场景与页面导航' })).toBeInTheDocument()
  rerender(<CourseEditorChromeContext.Provider value={{ documentId: id, mode: 'deep', setMode: () => {} }}>
    <CourseBottomNavigation documentId={id} />
  </CourseEditorChromeContext.Provider>)
  expect(screen.queryByRole('navigation', { name: '课件场景与页面导航' })).toBeNull()
  expect(screen.getByRole('region', { name: '场景状态' })).toBeInTheDocument()
})
