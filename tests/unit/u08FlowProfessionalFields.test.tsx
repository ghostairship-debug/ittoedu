import { useEffect, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { CHART_DEFINITION } from '../../src/components/chart'
import { createChartData, chartDataSchema } from '../../src/components/chart/data'
import { chartRuntimeImplementation } from '../../src/components/chart/runtime'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { flowContentClientMatrix } from '../../src/renderer/ui/flow/flowParagraphLayout'
import { transformPoint } from '../../src/core/components/geometry'

const probe = vi.hoisted(() => ({ state: {} as Record<string, unknown>, runtime: {} as Record<string, unknown>, version: 0, listeners: new Set<() => void>() }))
vi.mock('../../src/renderer/store/editorStore', async () => {
  const { useSyncExternalStore } = await import('react')
  return { useEditorStore: (select: (state: typeof probe.state) => unknown) => {
    useSyncExternalStore(listener => { probe.listeners.add(listener); return () => { probe.listeners.delete(listener) } }, () => probe.version)
    return select(probe.state)
  } }
})
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'

it('opens a real registered Flow chart title and commits through the shared draft, Session history and normal save', async () => {
  const data = createChartData(), resources = { assets: {}, components: {} }
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'flow-professional', revision: 0, title: '讲义图表', definitions: { [CHART_DEFINITION.id]: CHART_DEFINITION },
    instances: { chart: { id: 'chart', definitionId: CHART_DEFINITION.id, data: JSON.parse(JSON.stringify(data)), frame: { width: 600, height: 400, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['chart'] }], global: { underlay: [], overlay: [] }, assets: {} }
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-flow-professional-'))
  const host = new DocumentHostService(path.join(directory, 'recovery')), created = await host.internalAPI.create({ kind: 'course-v10', project, resources }, '图表.h5lesson')
  const unavailable = async (): Promise<never> => { throw new Error('No dialogs') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(), saveWithDialog: unavailable, closeWithDialog: unavailable, close: unavailable,
    discardRecovery: unavailable, subscribe: listener => host.subscribeEvents(listener), readAuthoringDrafts: id => host.readAuthoringDrafts(id),
    writeAuthoringDrafts: (id, drafts) => host.writeAuthoringDrafts(id, drafts), clearAuthoringDrafts: id => host.clearAuthoringDrafts(id) }
  const bridge = new CourseV10DocumentBridge(), feedback = vi.fn()
  const world = new ComponentPlatformRuntime('flow-professional', { mode: 'edit', builtins: new Map([[CHART_DEFINITION.id, chartRuntimeImplementation]]), report: feedback })
  const changed = () => { probe.version++; probe.listeners.forEach(listener => listener()) }
  let owned = createInitialSlideOwnedState(), stopBridge = () => {}
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'flow-paper' ? new DOMRect(0, 0, 800, 1400) : new DOMRect(100, 100, 600, 400)
  })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600), height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)
  const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox'), ctm = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getCTM')
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value(this: SVGElement) {
    return this.getAttribute('data-chart-text') === 'title' ? { x: 200, y: 10, width: 200, height: 24 } : { x: 0, y: 300, width: 80, height: 20 }
  } })
  Object.defineProperty(SVGElement.prototype, 'getCTM', { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) })
  try {
    await bridge.connect(api); await bridge.activate(created.documentId)
    const kernel = createEditorStoreKernel({ bridge, commit: feedback })
    const slice = createSlideAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch }; probe.state = { ...probe.state, ...owned }; changed() } })
    probe.state = { ...slice, ...owned, courseBridge: bridge, courseKernel: kernel, flowDocumentDrafts: {}, setFlowDocumentDraft: () => {}, setFlowContextSelection: () => {}, flowEditingInstance: null }
    probe.runtime = { resources, world, selectedInstanceIds: [], selectInstances: () => {}, onElement: world.bind, onTargetElement: world.bindTarget, renderInstance: () => null,
      navigation: { changed: () => {} }, registerObservation: () => () => {} }
    await world.sync(project, resources)
    stopBridge = bridge.subscribe(changed)
    function Workspace() {
      useSyncExternalStore(listener => { probe.listeners.add(listener); return () => { probe.listeners.delete(listener) } }, () => probe.version)
      const current = bridge.read().editingProject!
      useEffect(() => { void world.sync(current, resources) }, [current.revision])
      return <FlowWorkspace documentId={created.documentId} project={current} surfaceId="flow" onSelectImageAsset={async () => null} />
    }
    const ui = render(<Workspace />)
    await waitFor(() => expect(world.authorSpots().some(spot => spot.instanceId === 'chart' && spot.dataPath?.join('.') === 'title')).toBe(true))
    const title = ui.container.querySelector<SVGElement>('[data-chart-text="title"]')!
    await act(async () => fireEvent.doubleClick(title, { clientX: 400, clientY: 122 }))
    expect(ui.getByLabelText('编辑此处文字')).toHaveValue(data.title)
    fireEvent.change(ui.getByLabelText('编辑此处文字'), { target: { value: '正式图表标题' } })
    expect((await host.internalAPI.read(created.documentId)).undoDepth).toBe(0)
    await act(async () => fireEvent.keyDown(ui.getByLabelText('编辑此处文字'), { key: 'Enter', ctrlKey: true }))
    await waitFor(() => expect(owned.slideContentEdit).toBeNull())
    const accepted = await host.internalAPI.read(created.documentId)
    expect(accepted.undoDepth).toBe(1)
    if (accepted.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(chartDataSchema.parse(accepted.model.project.instances.chart.data)).toEqual({ ...data, title: '正式图表标题' })
    await waitFor(() => expect(ui.container.querySelector('[data-chart-text="title"]')).toHaveTextContent('正式图表标题'))
    const filename = path.join(directory, 'edited.h5lesson')
    await host.internalAPI.save(created.documentId, filename)
    const cold = new DocumentHostService(path.join(directory, 'cold-recovery'))
    const reopened = await cold.internalAPI.open(filename)
    if (reopened.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(chartDataSchema.parse(reopened.model.project.instances.chart.data).title).toBe('正式图表标题')
    expect(feedback).not.toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.any(String) }))
  } finally {
    cleanup(); stopBridge(); bridge.dispose(); await world.dispose(); rect.mockRestore(); width.mockRestore(); height.mockRestore(); vi.unstubAllGlobals()
    if (bbox) Object.defineProperty(SVGElement.prototype, 'getBBox', bbox); else Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
    if (ctm) Object.defineProperty(SVGElement.prototype, 'getCTM', ctm); else Reflect.deleteProperty(SVGElement.prototype, 'getCTM')
    await rm(directory, { recursive: true, force: true })
  }
})

it('maps registered bounds through the observed Flow parent rotation and scale once', () => {
  const parent = document.createElement('div'), element = document.createElement('div')
  parent.style.transform = 'matrix(0,2,-2,0,0,0)'; element.style.width = '600px'; element.style.height = '400px'; parent.append(element); document.body.append(parent)
  element.getBoundingClientRect = () => new DOMRect(-700, 200, 800, 1200)
  try { expect(transformPoint(flowContentClientMatrix(element)!, { x: 200, y: 10 })).toEqual({ x: 80, y: 600 }) }
  finally { parent.remove() }
})
