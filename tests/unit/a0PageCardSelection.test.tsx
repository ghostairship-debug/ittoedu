// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { BottomSceneNavigator } from '../../src/renderer/ui/BottomSceneNavigator'

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown>, listeners: new Set<() => void>() }))
vi.mock('../../src/renderer/store/editorStore', async () => {
  const { useSyncExternalStore } = await import('react')
  const useEditorStore = Object.assign((select: (state: Record<string, unknown>) => unknown) => {
    const state = useSyncExternalStore(listener => { store.listeners.add(listener); return () => { store.listeners.delete(listener) } }, () => store.state)
    return select(state)
  }, { getState: () => store.state })
  return { useEditorStore }
})

let dispose: (() => Promise<void>) | undefined
afterEach(async () => { cleanup(); await dispose?.(); dispose = undefined; store.listeners.clear() })

it('selects the page from card padding while retaining child controls, menus, dragging and native keyboard navigation', async () => {
  const project = createBlankCourseProjectV10('页面卡片交互')
  const firstId = project.surfaces[0].id
  project.surfaces[0].title = '第一页'
  project.instances[project.global.overlay[0]].visible = false
  project.surfaces.push({ id: 'second', kind: 'slide', title: '第二页', childIds: [], designSize: { width: 1280, height: 720 },
    presentation: { states: [{ id: 'question', title: '问题', overrides: {} }] } },
  { id: 'space', kind: 'spatial', title: '空间页', childIds: [], spatial: { home: { x: 0, y: 0, zoom: 1 },
    frames: [{ id: 'camera', title: '局部镜头', pose: { x: 20, y: 30, zoom: 2 } }] } })
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-a0-page-card-'))
  const host = new DocumentHostService(directory), bridge = new CourseV10DocumentBridge()
  const api = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(), subscribe: listener => host.subscribeEvents(listener) } as DocumentHostAPI
  await bridge.connect(api)
  await bridge.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  const documentId = bridge.read().activeDocumentId!
  const refresh = (patch: Record<string, unknown> = {}) => {
    store.state = { ...store.state, ...patch, courseView: bridge.read() }
    for (const listener of store.listeners) listener()
  }
  const stop = bridge.subscribe(() => refresh())
  dispose = async () => { stop(); bridge.dispose(); await fs.rm(directory, { recursive: true, force: true }) }
  const selectSurface = vi.spyOn(bridge, 'selectSurface'), selectState = vi.spyOn(bridge, 'selectPresentationState')
  const setEditingScope = vi.fn((editingScope: string) => refresh({ editingScope }))
  const camera = vi.fn((surfaceId: string, activeCameraFrameId: string | null) => refresh({ spatialViewStates: { [documentId]: { [surfaceId]: { activeCameraFrameId } } } }))
  const rename = vi.fn(async () => undefined), reorder = vi.fn(async () => undefined), add = vi.fn(async () => ({ ok: false })), error = vi.fn()
  refresh({ editingScope: 'global', spatialViewStates: {}, courseBridge: bridge, setEditingScope, setError: error,
    activateSpatialCameraFrame: camera, activateFlowHeading: vi.fn(), renameCourseSurface: rename,
    reorderCourseSurfaces: reorder, addCourseContent: add })
  const before = bridge.read().snapshot!
  render(<BottomSceneNavigator documentId={documentId} />)
  const first = screen.getByTestId('bottom-scene-' + firstId), second = screen.getByTestId('bottom-scene-second'), space = screen.getByTestId('bottom-page-space')
  expect(first).toHaveAttribute('data-current-card', 'false')

  // The padding/body is the li itself, outside every existing button.
  fireEvent.click(second)
  expect(selectSurface).toHaveBeenCalledExactlyOnceWith(documentId, 'second')
  expect(setEditingScope).toHaveBeenCalledExactlyOnceWith('scene')
  expect(second).toHaveAttribute('data-current-card', 'true')
  expect(within(second).getByRole('button', { name: '页面 2：第二页' })).toHaveAttribute('aria-current', 'page')

  selectSurface.mockClear(); setEditingScope.mockClear()
  fireEvent.click(within(second).getByRole('button', { name: /^问题，命名状态/ }))
  expect(selectState).toHaveBeenCalledExactlyOnceWith(documentId, 'question', 'second')
  expect(selectSurface).not.toHaveBeenCalled()
  expect(bridge.read().activeStateId).toBe('question')

  fireEvent.click(within(space).getByRole('button', { name: '镜头 · 局部镜头' }))
  expect(selectSurface).toHaveBeenCalledExactlyOnceWith(documentId, 'space')
  expect(camera).toHaveBeenCalledExactlyOnceWith('space', 'camera')
  expect(within(space).getByRole('button', { name: '镜头 · 局部镜头' })).toHaveAttribute('aria-current', 'location')

  // Renaming another card must leave the selected page/camera alone.
  selectSurface.mockClear()
  fireEvent.contextMenu(first)
  fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '重命名' }))
  const input = screen.getByRole('textbox', { name: '页面名称' })
  fireEvent.click(input)
  fireEvent.change(input, { target: { value: '改名第一页' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(rename).toHaveBeenCalledExactlyOnceWith(firstId, '改名第一页')
  expect(selectSurface).not.toHaveBeenCalled()
  expect(bridge.read().surfaceId).toBe('space')
  expect(camera).toHaveBeenCalledTimes(1)

  fireEvent.contextMenu(second)
  fireEvent.click(within(screen.getByRole('menu', { name: '页面操作' })).getByRole('menuitem', { name: '前移' }))
  expect(reorder).toHaveBeenCalledExactlyOnceWith(['second', firstId, 'space'])
  expect(selectSurface).not.toHaveBeenCalled()

  reorder.mockClear()
  const dataTransfer = { types: ['application/x-guoling-page-card'], setData: vi.fn(), effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(second, { dataTransfer })
  fireEvent.dragOver(first, { dataTransfer })
  fireEvent.drop(first, { dataTransfer })
  expect(reorder).toHaveBeenCalledExactlyOnceWith(['second', firstId, 'space'])
  expect(selectSurface).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '新建场景或页面' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: '新建场景或页面' })).getByRole('menuitem', { name: '新建无限画布' })) })
  expect(add).toHaveBeenCalledExactlyOnceWith('spatial-page', { surfaceId: 'space' })
  expect(selectSurface).not.toHaveBeenCalled()

  const user = userEvent.setup()
  within(first).getByRole('button', { name: '页面 1：第一页' }).focus()
  await user.keyboard('{Enter}')
  expect(selectSurface).toHaveBeenCalledExactlyOnceWith(documentId, firstId)
  expect(first).toHaveAttribute('data-current-card', 'true')
  expect(error).not.toHaveBeenCalled()
  expect(bridge.read().snapshot!.undoDepth).toBe(before.undoDepth)
  expect(bridge.read().snapshot!.revision).toBe(before.revision)
})
