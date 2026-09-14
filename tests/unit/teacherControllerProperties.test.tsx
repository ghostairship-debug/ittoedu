import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { useEditorStore, selectActiveCourseProjectDocument, selectSlideAuthoringBackend } from '../../src/renderer/store/editorStore'
afterEach(cleanup)
const controller = () => selectActiveCourseProjectDocument(useEditorStore.getState())!.globalLayerItems[0]!.item
function openProperties() {
  act(() => {
    useEditorStore.getState().createNewProject()
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().selectNode(controller().layerItemId)
  })
  return render(<PropertiesTab onReplaceImage={() => undefined} />)
}
describe('component teacher controller properties', () => {
  it('shows each component setting once and keeps recovery in collapsed maintenance', () => {
    const { container } = openProperties()
    expect(screen.getByTestId('teacher-controller-properties')).toBeInTheDocument()
    expect(screen.getAllByLabelText('标题')).toHaveLength(1)
    expect(screen.getAllByLabelText('默认收起')).toHaveLength(1)
    expect(screen.getAllByLabelText('背景图片 / 纹理')).toHaveLength(1)
    expect(screen.queryByText('外部组件')).not.toBeInTheDocument()
    expect(screen.queryByText('控制器标题')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('按钮文字')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-controller-layout-preview')).not.toBeInTheDocument()
    const restore = screen.getByRole('button', { name: '恢复默认控制台源码', hidden: true })
    expect(restore.closest('details')?.open).toBe(false)
    expect(container.querySelectorAll('[data-testid="component-properties-editor"]')).toHaveLength(1)
  })
  it('edits component props through the real undo transaction', () => {
    openProperties()
    const before = controller()
    if (before.kind !== 'component') throw new Error('component required')
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '第六课 · 教师台' } })
    expect(controller()).toMatchObject({ kind: 'component', props: { title: '第六课 · 教师台' } })
    act(() => useEditorStore.getState().undo())
    expect(controller()).toMatchObject({ props: { title: before.props.title } })
  })
})

it.each([false, true])('edits the global controller in the scene without navigation and supports undo (named state: %s)', (namedState) => {
  act(() => useEditorStore.getState().createNewProject())
  if (namedState) act(() => useEditorStore.getState().addPresentationState('第二步'))
  const before = controller()
  const backend = () => selectSlideAuthoringBackend(useEditorStore.getState())!
  const locationId = backend().getSnapshot().locationId
  const stateId = backend().getSnapshot().stateId
  const surfaces = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState())!.surfaces)
  act(() => useEditorStore.getState().selectNode(before.layerItemId))
  expect(backend().getSnapshot().scope).toBe('scene')
  expect(backend().getSnapshot().selection.selectionIds).toEqual([before.layerItemId])
  render(<PropertiesTab onReplaceImage={() => undefined} />)
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '场景内编辑' } })
  expect(controller()).toMatchObject({ props: { title: '场景内编辑' } })
  expect(backend().getSnapshot().scope).toBe('scene')
  expect(backend().getSnapshot().locationId).toBe(locationId)
  expect(backend().getSnapshot().stateId).toBe(stateId)
  expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.surfaces).toEqual(surfaces)
  act(() => useEditorStore.getState().undo())
  expect(controller()).toEqual(before)
})
