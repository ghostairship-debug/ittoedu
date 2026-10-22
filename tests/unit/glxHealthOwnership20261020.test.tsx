import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createImageData, IMAGE_DEFINITION } from '../../src/components/image'
import { createComponentContainerInstance } from '../../src/shared/contracts/component-platform/project'
import type { ComponentProjectHealthFinding } from '../../src/shared/componentProjectHealth'
import { resolveCourseProjectDiagnosticTargetRoute, resolveCourseProjectDeliveryFindingRoute, selectCourseProjectDiagnosticRoute } from '../../src/renderer/diagnostics/projectHealthNavigation'
import { ProjectHealthPanel } from '../../src/renderer/ui/ProjectHealthPanel'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { setRootContainers } from '../helpers/glxWorkFixture'

afterEach(() => { cleanup(); useEditorStore.getState().courseBridge.dispose() })

function fixture() {
  const project = createBlankCourseProjectV10('真实归属定位')
  project.definitions.image = { ...IMAGE_DEFINITION, id: 'image' }
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  setRootContainers(project, [{ id: 'other', kind: 'slide', title: '原位置', childIds: [] },
    { id: 'outer', kind: 'flow', title: '根讲义', childIds: ['inner'] }])
  const definitionId = project.instances.outer.definitionId
  project.instances.inner = createComponentContainerInstance({ id: 'inner', kind: 'flow', title: '局部讲义', childIds: ['nested-group'] }, definitionId)
  project.instances['nested-group'] = { id: 'nested-group', definitionId: 'group', data: {}, childIds: ['nested-picture'] }
  project.instances['nested-picture'] = { id: 'nested-picture', definitionId: 'image', data: JSON.parse(JSON.stringify(createImageData('missing'))) }
  project.instances.program = { id: 'program', definitionId: 'source', name: '程序作品', data: {}, childIds: ['program-title'] }
  project.instances['program-title'] = { id: 'program-title', definitionId: 'group', data: {} }
  project.rootIds.push('program')
  project.instances.shared = createComponentContainerInstance({ id: 'shared', kind: 'flow', title: '共享层容器', childIds: ['shared-picture'] }, definitionId)
  project.instances['shared-picture'] = { id: 'shared-picture', definitionId: 'image', data: JSON.parse(JSON.stringify(createImageData('missing'))) }
  project.global.overlay.push('shared')
  return project
}

it('resolves the real work root and nearest editing container for local, program and shared targets', () => {
  const project = fixture(), target = (instanceId: string) => ({ projectId: project.id, kind: 'instance' as const, instanceId })
  expect(resolveCourseProjectDiagnosticTargetRoute(project, target('nested-picture'))).toEqual({ available: true,
    scope: 'scene', tab: 'properties', surfaceId: 'inner', rootInstanceId: 'outer', editingContainerId: 'inner', instanceId: 'nested-picture' })
  expect(resolveCourseProjectDiagnosticTargetRoute(project, { projectId: project.id, kind: 'surface', surfaceId: 'inner' })).toEqual({ available: true,
    scope: 'scene', tab: 'properties', surfaceId: 'inner', rootInstanceId: 'outer', editingContainerId: 'inner' })
  expect(resolveCourseProjectDeliveryFindingRoute(project, { code: 'source-output', surfaceId: 'program' })).toEqual({ available: true,
    scope: 'scene', tab: 'properties', rootInstanceId: 'program' })
  expect(resolveCourseProjectDiagnosticTargetRoute(project, target('shared-picture'))).toEqual({ available: true,
    scope: 'global', tab: 'properties', surfaceId: 'shared', editingContainerId: 'shared', instanceId: 'shared-picture' })
})

it.each([
  { id: 'nested-picture', root: 'outer', surface: 'inner', editing: 'inner', plane: undefined, scope: 'scene' },
  { id: 'program-title', root: 'program', surface: null, editing: null, plane: undefined, scope: 'scene' },
  { id: 'shared-picture', root: 'other', surface: 'shared', editing: 'shared', plane: 'overlay', scope: 'global' },
])('the health panel locates $id through the real Bridge without changing author data or History', async item => {
  const project = fixture(), host = await createV10StoreHost(project, undefined, false)
  await useEditorStore.getState().connectCourseDocuments(host.api)
  const before = useEditorStore.getState().courseView.snapshot!, onClose = vi.fn()
  const diagnostic: ComponentProjectHealthFinding = { severity: 'error', code: 'image-asset-reference-missing',
    message: '定位真实对象', path: ['instances', item.id], target: { projectId: project.id, kind: 'instance', instanceId: item.id } }
  render(<ProjectHealthPanel open diagnostics={[diagnostic]} onClose={onClose} />)
  fireEvent.click(within(screen.getByText(diagnostic.code).closest('li')!).getByRole('button', { name: '定位' }))
  const state = useEditorStore.getState()
  expect(state.courseView).toMatchObject({ rootInstanceId: item.root, surfaceId: item.surface,
    editingContainerId: item.editing, editingPlane: item.plane, selectedInstanceId: item.id })
  expect(state.editingScope).toBe(item.scope)
  expect(state.activeTab).toBe('properties')
  expect(state.courseView.snapshot).toEqual(before)
  expect(state.courseView.snapshot!.undoDepth).toBe(0)
  expect(onClose).toHaveBeenCalledOnce()
  host.bridge.dispose()
})

it('delivery navigation uses the same Bridge selection for a nested container and a Source root', async () => {
  const project = fixture(), host = await createV10StoreHost(project)
  for (const finding of [{ code: 'output', instanceId: 'nested-picture' }, { code: 'output', surfaceId: 'program' }]) {
    const route = resolveCourseProjectDeliveryFindingRoute(project, finding)
    if (!route.available) throw new Error(route.reason)
    selectCourseProjectDiagnosticRoute(host.kernel, route)
  }
  expect(host.bridge.read()).toMatchObject({ rootInstanceId: 'program', surfaceId: null, editingContainerId: null, selectedInstanceId: null })
  expect(host.first.read().undoDepth).toBe(0)
  expect(host.first.read().model).toEqual({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  host.bridge.dispose()
})
