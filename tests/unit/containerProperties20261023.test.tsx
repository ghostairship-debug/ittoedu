import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { componentPropertiesEdits, componentPropertiesView } from '../../src/renderer/ui/properties/componentProperties'
import { CommonNodeProperties } from '../../src/renderer/ui/properties/SlideNativePropertiesPanel'
import { ContainerProperties } from '../../src/renderer/ui/properties/ContainerProperties'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'

afterEach(() => { cleanup(); useEditorStore.getState().courseBridge.dispose() })

const fixture = (): CourseProjectV10 => ({
  schemaVersion: 11, id: 'container-properties', revision: 0, title: '混排作品',
  definitions: Object.fromEntries(['flow', 'slide', 'spatial'].map(kind => [kind, {
    id: kind, role: 'mixed', implementation: { kind: 'builtin', key: `guoling.container.${kind}` },
  }])),
  instances: {
    root: { id: 'root', definitionId: 'flow', data: {}, childIds: ['slide', 'flow', 'spatial'], container: { kind: 'flow' } },
    slide: { id: 'slide', definitionId: 'slide', data: { retained: 'business data' }, childIds: [],
      frame: { width: 360, height: 200, transform: [1, 0, 0, 1, 12, 24] },
      container: { kind: 'slide', designSize: { width: 1280, height: 720 } } },
    flow: { id: 'flow', definitionId: 'flow', data: { retained: 'flow data' }, childIds: [],
      container: { kind: 'flow', designSize: { width: 640, height: 300 },
        flow: { layout: { readingWidth: 640, wideContentWidth: 960, widthMode: 'reading', toc: 'hidden', edgeToEdge: true } } } },
    spatial: { id: 'spatial', definitionId: 'spatial', data: {}, childIds: [],
      container: { kind: 'spatial', spatial: {
        home: { x: 200, y: 100, zoom: 0.5, rotation: 15 },
        frames: [{ id: 'camera', title: '原镜头', pose: { x: 400, y: 300, zoom: 1 } }],
        paths: [{ id: 'route', title: '原路线', frameIds: ['camera'] }], defaultPathId: 'route',
      } } },
  },
  rootIds: ['root'], entry: { rootInstanceId: 'root' }, global: { underlay: [], overlay: [] }, assets: {},
})

it('edits a Slide design canvas through container.patch independently from its outer frame', () => {
  const project = fixture(), node = project.instances.slide
  const view = componentPropertiesView(node, project.definitions.slide)
  expect(view).toMatchObject({ type: 'container', width: 360, height: 200, container: { designSize: { width: 1280, height: 720 } } })
  const edits = componentPropertiesEdits(node, project.definitions.slide, { container: { designSize: { width: 1600 } } })
  expect(edits).toEqual([{ type: 'container.patch', instanceId: 'slide', patch: { designSize: { width: 1600, height: 720 } } }])
  const changed = applyComponentOperation(project, captureComponentOperation(project, edits))
  expect(changed.instances.slide.frame).toEqual(node.frame)
  expect(changed.instances.slide.data).toEqual(node.data)
  expect(changed.instances.slide.container?.designSize).toEqual({ width: 1600, height: 720 })
  expect(project.instances.slide.container?.designSize).toEqual({ width: 1280, height: 720 })
  render(<CommonNodeProperties node={view} update={() => {}} />)
  expect(screen.getByLabelText('外框宽')).toHaveValue('360')
  expect(screen.getByLabelText('外框高')).toHaveValue('200')
})

it('commits nested Flow reading controls through the properties owner, History and archive reload', async () => {
  const project = fixture(), host = await createV10StoreHost(project, undefined, false)
  await useEditorStore.getState().connectCourseDocuments(host.api)
  await useEditorStore.getState().courseBridge.activate(host.first.documentId)
  useEditorStore.getState().setEditingScope('scene')
  useEditorStore.getState().selectNodes(['flow'])
  render(<PropertiesTab onReplaceImage={() => {}} />)
  expect(screen.getByTestId('container-properties')).toBeInTheDocument()
  expect(screen.queryByLabelText('组件数据')).toBeNull()
  const input = screen.getByLabelText('阅读宽度')
  fireEvent.change(input, { target: { value: '820' } }); fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(useEditorStore.getState().courseKernel.readDocument().instances.flow.container?.flow?.layout.readingWidth).toBe(820))
  const changed = useEditorStore.getState().courseKernel.readDocument().instances.flow
  expect(changed.container?.flow?.layout).toEqual({ ...project.instances.flow.container!.flow!.layout, readingWidth: 820 })
  expect(changed.container?.designSize).toEqual(project.instances.flow.container?.designSize)
  expect(changed.data).toEqual(project.instances.flow.data)
  expect(changed.frame).toBeUndefined()
  expect((await host.api.read(host.first.documentId)).undoDepth).toBe(1)
  await act(async () => { await useEditorStore.getState().courseBridge.undo(host.first.documentId) })
  expect(useEditorStore.getState().courseKernel.readDocument().instances.flow).toEqual(project.instances.flow)
  await act(async () => { await useEditorStore.getState().courseBridge.redo(host.first.documentId) })
  await host.api.save(host.first.documentId, 'container.glx')
  const cold = await host.driver.load(host.disk.get('container.glx')!)
  expect(cold).toMatchObject({ kind: 'course-v10', project: { instances: { flow: changed } } })
})

it('keeps Spatial camera stops and paths while updating only the initial camera', () => {
  const project = fixture(), node = project.instances.spatial, update = vi.fn()
  const view = componentPropertiesView(node, project.definitions.spatial)
  if (view.type !== 'container') throw new Error('Expected container properties')
  render(<ContainerProperties node={view} update={update} />)
  const input = screen.getByLabelText('初始镜头缩放')
  fireEvent.change(input, { target: { value: '1.2' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(update).toHaveBeenCalledWith({ container: { spatial: { home: { zoom: 1.2 } } } })
  const edits = componentPropertiesEdits(node, project.definitions.spatial, update.mock.calls[0][0])
  const changed = applyComponentOperation(project, captureComponentOperation(project, edits)).instances.spatial
  expect(changed.container?.spatial).toEqual({ ...node.container!.spatial, home: { ...node.container!.spatial!.home, zoom: 1.2 } })
  expect(changed.data).toEqual(node.data)
  expect(screen.getByLabelText('默认播放路线')).toHaveValue('route')
})

it('does not write defaults while opening an unconfigured container', () => {
  const project = fixture(), node = project.instances.slide, update = vi.fn()
  delete node.container!.designSize
  const view = componentPropertiesView(node, project.definitions.slide)
  if (view.type !== 'container') throw new Error('Expected container properties')
  render(<ContainerProperties node={view} update={update} />)
  expect(update).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('设计画幅宽')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '设置设计画幅（1280 × 720）' }))
  expect(update).toHaveBeenCalledWith({ container: { designSize: { width: 1280, height: 720 } } })
})
