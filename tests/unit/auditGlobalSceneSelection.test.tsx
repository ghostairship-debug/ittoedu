import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData } from '../../src/components/text/data'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform/project'
import { owningContainer } from '../../src/shared/contracts/component-platform/project'
import { createSlideWorkspaceAuthoringController, listSlideWorkspaceHitTargets } from '../../src/renderer/ui/workspaceSlideAuthoring'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

const store = () => useEditorStore.getState()
const previousDesktopAPI = window.desktopAPI
afterEach(() => {
  cleanup(); if (store().courseView.project) store().cancelTextEdit(); store().courseBridge.dispose()
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktopAPI })
  vi.restoreAllMocks()
})
function fixture(): CourseProjectV10 {
  const project = createBlankCourseProjectV10(), surface = project.surfaces[0]
  surface.id = 'slide'; surface.presentation = { states: [{ id: 'answer', title: '答案', overrides: {} }] }
  project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: [] })
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.definitions.group = { id: 'group', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.group' } }
  for (const [id, x] of [['local', 100], ['shared', 300], ['child', 5]] as const) project.instances[id] = { id, definitionId: 'text',
    data: JSON.parse(JSON.stringify(createTextComponentData(id))) as JsonValue,
    frame: { width: 120, height: 40, transform: [1, 0, 0, 1, x, 40] } }
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['child'], frame: { width: 160, height: 100, transform: [1, 0, 0, 1, 500, 100] } }
  project.global.overlay.push('shared', 'group'); surface.childIds = ['local']
  return project
}
async function connected(project = fixture()) {
  const host = await createCourseDocumentHost(); await store().connectCourseDocuments(host.api)
  await store().createCourseDocumentFrom(project)
  store().setEditingScope('scene')
  const documentId = store().courseView.activeDocumentId!
  store().courseBridge.selectPresentationState(documentId, 'answer', 'slide')
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  return { host, documentId, session: host.registry.get(documentId) }
}
function authoring() {
  return createSlideWorkspaceAuthoringController({
    read: () => { const view = store().courseView; return view.editingProject ? { project: view.editingProject, surfaceId: view.surfaceId!, documentId: view.activeDocumentId!,
      activeStateId: view.activeStateId, selectedInstanceIds: view.selectedInstanceIds, editingScope: 'scene' } : null },
    capture: () => store().courseKernel.captureTarget(), select: ids => store().courseKernel.selectInstances(ids),
    commit: (edits, target, group) => store().courseKernel.editCaptured(store().courseKernel.capture(edits, target), group), report: message => { throw new Error(message) },
  })
}
function CurrentSelection({ enabled = true }: { enabled?: boolean }) {
  const view = useEditorStore(state => state.courseView)
  return <CourseEditorChromeContext.Provider value={{ documentId: view.activeDocumentId, mode: 'light', setMode() {} }}>
    <main><NativeSelectionContext documentId={view.activeDocumentId} revision={view.snapshot?.revision ?? 0} surfaceId={view.surfaceId}
      itemIds={view.selectedInstanceIds} stateId={view.activeStateId} enabled={enabled} bounds={() => ({ left: 200, top: 200, width: 120, height: 40 })} /></main>
  </CourseEditorChromeContext.Provider>
}

it('the existing Slide scene hit/controller selects and transforms the same global instance through canonical Session without changing scene or state', async () => {
  const { session, documentId } = await connected(), controller = authoring(), before = session.read(), project = store().courseView.project!
  controller.pointerDown({ x: 310, y: 50 }, [1, 0, 0, 1, 0, 0])
  expect(store().courseView.selectedInstanceIds).toEqual(['shared'])
  await controller.pointerUp({ x: 330, y: 60 }, [1, 0, 0, 1, 0, 0])
  const after = session.read(); if (after.model.kind !== 'course-v10') throw new Error('fixture')
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(after.model.project.instances.shared.frame?.transform).toEqual([1, 0, 0, 1, 320, 50])
  expect(owningContainer(after.model.project, 'shared')).toEqual({ kind: 'global', plane: 'overlay' })
  expect(after.model.project.instances.local).toEqual(project.instances.local)
  expect(after.model.project.surfaces[0].presentation).toEqual(project.surfaces[0].presentation)
  expect(store().courseView).toMatchObject({ activeDocumentId: documentId, surfaceId: 'slide', activeStateId: 'answer', selectedInstanceIds: ['shared'] })
  expect(store().editingScope).toBe('scene')
  controller.pointerDown({ x: 110, y: 50, additive: true }, [1, 0, 0, 1, 0, 0])
  expect(store().courseView.selectedInstanceIds).toEqual(['shared', 'local'])
})

it('global visibility and ancestor locks still apply, and dedicated global scope still excludes local objects', async () => {
  const project = fixture(); project.instances.shared.visibility = { mode: 'include', surfaceIds: ['flow'] }; project.instances.group.locked = true
  const { session } = await connected(project), view = store().courseView
  const state = { project: view.editingProject!, documentId: view.activeDocumentId!, surfaceId: 'slide', selectedInstanceIds: [], editingScope: 'scene' as const }
  expect(listSlideWorkspaceHitTargets(state).map(target => target.instanceId)).not.toContain('shared')
  expect(listSlideWorkspaceHitTargets({ ...state, editingScope: 'global' }).map(target => target.instanceId)).not.toContain('local')
  const controller = authoring(), before = session.read().revision
  controller.pointerDown({ x: 512, y: 148, altKey: true }, [1, 0, 0, 1, 0, 0])
  expect(store().courseView.selectedInstanceIds).toEqual(['child'])
  await controller.pointerUp({ x: 542, y: 178 }, [1, 0, 0, 1, 0, 0])
  expect(session.read().revision).toBe(before)
  expect(() => applyComponentOperation(project, captureComponentOperation(project, [{ type: 'frame.set', instanceId: 'child', frame: { ...project.instances.child.frame!, width: 150 } }]))).toThrow('锁定')
  const hidden = structuredClone(project); hidden.instances.group.visible = false
  expect(listSlideWorkspaceHitTargets({ ...state, project: hidden }).map(target => target.instanceId)).not.toContain('child')
})

it('the real shared quick bar labels a scene-selected global object and writes its global data once from both Slide and Flow', async () => {
  const { session, documentId } = await connected(); act(() => store().selectNodes(['shared']))
  render(<CurrentSelection />)
  const before = session.read(), bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(bar).toHaveTextContent('全局元素，修改会影响所有场景')
  await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: '加粗' })); await store().drainCourseDocument() })
  expect(session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(store().courseView.project!.instances.shared.data).toMatchObject({ appearance: { bold: true } })
  expect(store().courseView.project!.surfaces[0].presentation?.states[0].overrides).toEqual({})
  expect(store().courseView.project!.global.overlay).toContain('shared')
  act(() => { store().courseBridge.selectSurface(documentId, 'flow'); store().selectNodes(['shared']) })
  await waitFor(() => expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).toHaveTextContent('全局元素，修改会影响所有场景'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '斜体' })); await store().drainCourseDocument() })
  expect(store().courseView.project!.instances.shared.data).toMatchObject({ appearance: { bold: true, italic: true } })
  expect(store().courseView.surfaceId).toBe('flow'); expect(store().editingScope).toBe('scene')
})

it('mixed selections accurately mark only their global members including descendants, and disabled workspaces expose no quick-bar edits', async () => {
  const { documentId } = await connected(); act(() => store().selectNodes(['child', 'local']))
  const ui = render(<CurrentSelection />), bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(bar).toHaveTextContent('含全局元素（1 项），修改全局元素会影响所有场景')
  act(() => store().selectNodes(['local']))
  await waitFor(() => expect(screen.getByRole('toolbar', { name: '选中对象快捷工具' })).not.toHaveTextContent('全局元素'))
  act(() => store().courseKernel.selectInstances(['shared'], 'slide', documentId)); ui.rerender(<CurrentSelection enabled={false} />)
  expect(screen.queryByRole('toolbar', { name: '选中对象快捷工具' })).toBeNull()
})
