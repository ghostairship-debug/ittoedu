import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { Workspace } from '../../src/renderer/ui/Workspace'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

vi.mock('../../src/renderer/ui/workspaces/SlideWorkspaceConnector', () => ({ SlideWorkspaceConnector: () => <div /> }))
vi.mock('../../src/renderer/ui/workspaces/FlowWorkspaceConnector', () => ({ FlowWorkspaceConnector: () => <div /> }))
vi.mock('../../src/renderer/ui/workspaces/SpatialWorkspaceConnector', () => ({ SpatialWorkspaceConnector: () => <div /> }))
afterEach(cleanup)

function fixture() {
  let index = 0
  const project = createBlankCourseProjectV10('Work root', () => ['project', 'slide'][index++])
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.outer = { id: 'outer', name: 'Outer group', definitionId: 'group', data: {}, childIds: ['inner'] }
  project.instances.inner = { id: 'inner', name: 'Inner group', definitionId: 'group', data: {}, childIds: [] }
  project.instances.shared = { id: 'shared', name: 'Shared group', definitionId: 'group', data: {}, childIds: ['container'] }
  project.instances.container = { id: 'container', name: 'Shared container', definitionId: 'guoling.container.slide', data: {}, childIds: [], container: { kind: 'slide' } }
  project.instances.slide.childIds = ['outer']; project.global.overlay = ['shared']
  return project
}

it('the real workspace navigation enters groups and returns through each level before the real container', async () => {
  const h = await createV10StoreHost(fixture(), undefined, false), previous = useEditorStore.getState(), id = h.first.documentId
  await previous.connectCourseDocuments(h.api)
  const bridge = useEditorStore.getState().courseBridge
  try {
    bridge.selectInstances(id, ['outer'])
    const ui = render(<Workspace onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />)
    fireEvent.click(ui.getByTestId('group-edit-enter'))
    await waitFor(() => expect(bridge.read().activeGroupId).toBe('outer'))
    act(() => bridge.selectInstances(id, ['inner']))
    fireEvent.click(ui.getByTestId('group-edit-enter'))
    await waitFor(() => expect(bridge.read().activeGroupId).toBe('inner'))
    fireEvent.click(ui.getByTestId('group-edit-return'))
    await waitFor(() => expect(bridge.read()).toMatchObject({ activeGroupId: 'outer', selectedInstanceIds: ['inner'] }))
    fireEvent.click(ui.getByTestId('group-edit-return'))
    await waitFor(() => expect(bridge.read()).toMatchObject({ activeGroupId: null, selectedInstanceIds: ['outer'] }))
    expect(h.first.read().undoDepth).toBe(0)
  } finally { cleanup(); bridge.dispose(); useEditorStore.setState(previous, true); h.bridge.dispose() }
})

it('shared-container return switches shell scope before restoring its ordinary shared parent group', async () => {
  const h = await createV10StoreHost(fixture(), undefined, false), previous = useEditorStore.getState(), id = h.first.documentId
  await previous.connectCourseDocuments(h.api)
  const bridge = useEditorStore.getState().courseBridge
  useEditorStore.setState({ editingScope: 'global',
    setEditingScope: editingScope => {
      while (bridge.read().activeGroupId) bridge.leaveGroup(id)
      bridge.selectInstances(id, []); useEditorStore.setState({ editingScope })
    } })
  try {
    bridge.selectInstances(id, ['container'])
    const ui = render(<Workspace onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />)
    fireEvent.click(ui.getByTestId('container-edit-enter'))
    await waitFor(() => expect(bridge.read()).toMatchObject({ activeGroupId: null, editingContainerId: 'container' }))
    fireEvent.click(ui.getByTestId('container-edit-return'))
    await waitFor(() => expect(bridge.read()).toMatchObject({ activeGroupId: 'shared', editingContainerId: null, selectedInstanceIds: ['container'] }))
    expect(useEditorStore.getState().editingScope).toBe('global')
    expect(ui.getByLabelText('容器编辑位置')).toHaveTextContent('共享浮层 / Shared group')
    expect(ui.getByLabelText('容器编辑位置')).not.toHaveTextContent('Work root')
    expect(h.first.read().undoDepth).toBe(0)
  } finally { cleanup(); bridge.dispose(); useEditorStore.setState(previous, true); h.bridge.dispose() }
})
