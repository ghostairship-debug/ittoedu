import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { createTableData, TABLE_DEFINITION } from '../../src/components/table'
import { CHART_DEFINITION, createChartData } from '../../src/components/chart'
import { Workspace } from '../../src/renderer/ui/Workspace'
import { InstanceView } from '../../src/renderer/documents/CourseV10DocumentView'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import type { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import type { ComponentProps, ReactElement } from 'react'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

const h = vi.hoisted(() => ({ runtime: {} as unknown, selection: {} as ComponentProps<typeof NativeSelectionContext>,
  pointer: vi.fn(() => false), double: vi.fn(() => false), transform: vi.fn(), business: vi.fn(), fieldBounds: null as null | { left: number; top: number; width: number; height: number },
  authorTarget: null as unknown, selectedSpot: undefined as unknown,
  beginNative: vi.fn<(id: string, activate: () => boolean) => Promise<boolean>>(), selectNative: vi.fn<(spot: ComponentAuthorSpot) => void>() }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => ({ ...h.runtime as object }) }))
vi.mock('../../src/renderer/ui/workspaces/useComponentAuthorInteraction', () => ({ useComponentAuthorInteraction: () => ({
  pointerFromElement: h.pointer, doubleClickFromElement: h.double, contextMenuFromElement: () => false, openContextMenu: vi.fn(),
  authorBounds: () => h.fieldBounds, authorTarget: h.authorTarget, selectedSpot: h.selectedSpot, beginTransform: h.transform, editor: null,
  beginNative: h.beginNative, selectNativeField: h.selectNative, fieldIsCurrent: () => true,
}) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: (props: ComponentProps<typeof NativeSelectionContext>) => { h.selection = props; return null } }))
vi.mock('../../src/renderer/ui/workspaces/SlideWorkspaceConnector', () => ({ SlideWorkspaceConnector: () => null }))
vi.mock('../../src/renderer/ui/workspaces/FlowWorkspaceConnector', () => ({ FlowWorkspaceConnector: () => null }))
vi.mock('../../src/renderer/ui/workspaces/SpatialWorkspaceConnector', () => ({ SpatialWorkspaceConnector: () => null }))

beforeAll(async () => { await loadBuiltinComponentSource('guoling.html-program') })
let restore: (() => void) | undefined
afterEach(() => { cleanup(); restore?.(); restore = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); h.fieldBounds = null; h.authorTarget = null; h.selectedSpot = undefined; h.pointer.mockClear(); h.double.mockClear() })

function pointer(target: Element | Window, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerId', { value: 7 })
  fireEvent(target, event)
}

async function fixture() {
  const project = createBlankProgramProject('程序根'), rootId = project.rootIds[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.floating = { id: 'floating', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('浮层'))),
    frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 20, 30] } }
  project.global.overlay.push('floating')
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: [], frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 10, 10] } }
  project.instances[rootId].childIds = ['group']
  project.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION; project.definitions[CHART_DEFINITION.id] = CHART_DEFINITION
  project.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: JSON.parse(JSON.stringify(createTableData({ rows: 1, columns: 1 }))),
    frame: { width: 200, height: 80, transform: [1, 0, 0, 1, 20, 30] } }
  project.instances.chart = { id: 'chart', definitionId: CHART_DEFINITION.id, data: JSON.parse(JSON.stringify(createChartData())),
    frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 20, 30] } }
  project.instances[rootId].childIds.push('table', 'chart')
  const host = await createV10StoreHost(project, undefined, false), previous = useEditorStore.getState()
  await previous.connectCourseDocuments(host.api)
  useEditorStore.setState({ canvasMode: 'edit' })
  const bridge = useEditorStore.getState().courseBridge
  h.beginNative.mockImplementation(async (_id, activate) => { await useEditorStore.getState().commitSlideContentEdit(); return activate() })
  h.selectNative.mockImplementation(spot => bridge.selectAuthorSpot(host.first.documentId, spot))
  restore = () => { bridge.dispose(); useEditorStore.setState(previous, true); host.bridge.dispose() }
  const element = (id: string) => [...document.querySelectorAll<HTMLElement>('[data-component-instance]')].find(value => value.dataset.componentInstance === id)
  const draw = (id: string, current: CourseProjectV10 = useEditorStore.getState().courseView.editingProject!, placement: string = 'free'): ReactElement => {
    const instance = current.instances[id], frame = instance.frame
    return <div key={id} data-component-instance={id} data-component-placement={placement}
      style={{ width: frame?.width ?? 1000, height: frame?.height ?? 600, transform: frame ? `matrix(${frame.transform.join(',')})` : 'none' }}>
      <button data-testid={`body-${id}`} onClick={h.business}>对象 {id}</button>
      <svg><path data-testid={`vector-${id}`} d="M0 0 L20 20" /></svg>
      {id === 'chart' && <svg data-native-chart-id="chart"><text data-chart-text="title" data-testid="chart-title" ref={node => {
        if (node) { node.getBoundingClientRect = () => new DOMRect(30, 40, 160, 32); node.getBBox = () => ({ x: 0, y: 0, width: 160, height: 32 }) as DOMRect }
      }}>数据比较</text></svg>}
      {instance.childIds?.map(child => draw(child, current))}
    </div>
  }
  h.runtime = { documentId: host.first.documentId, surfaceId: null,
    get project() { return useEditorStore.getState().courseView.editingProject },
    get selectedInstanceIds() { return bridge.read().selectedInstanceIds },
    selectInstances: (ids: string[]) => bridge.selectInstances(host.first.documentId, ids), setPlaying() {},
    world: { targetElement: element }, renderInstance: draw }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = Number.parseFloat(this.style.width) || 1000, height = Number.parseFloat(this.style.height) || 600
    const transform = /^matrix\(([^)]+)\)/.exec(this.style.transform)?.[1].split(',').map(Number)
    return new DOMRect(transform?.[4] ?? 0, transform?.[5] ?? 0, width, height)
  })
  const ui = render(<Workspace onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />)
  return { host, bridge, rootId, ui }
}

it('program root selects without a phantom frame, and its business click stays out of author mode', async () => {
  const { host, bridge, rootId, ui } = await fixture(), body = ui.getByTestId(`body-${rootId}`)
  pointer(body, 'pointerdown', 100, 100); pointer(window, 'pointerup', 130, 100)
  await waitFor(() => expect(bridge.read().selectedInstanceIds).toEqual([rootId]))
  fireEvent.click(body)
  expect(h.business).not.toHaveBeenCalled()
  expect(h.pointer).toHaveBeenCalledTimes(1)
  expect(h.selection.bounds?.(rootId)).toMatchObject({ width: 1000, height: 600 })
  expect(ui.container.querySelector('[data-handle]')).toBeNull()
  expect(host.first.read().undoDepth).toBe(0)
  fireEvent.doubleClick(body)
  expect(h.double).toHaveBeenCalledTimes(1)
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
})

it('program free object SVG body uses the existing transform owner, including threshold and cancellation', async () => {
  const { host, bridge, ui } = await fixture(), body = ui.getByTestId('vector-floating')
  pointer(body, 'pointerdown', 30, 40); pointer(window, 'pointerup', 31, 40)
  await waitFor(() => expect(bridge.read().selectedInstanceIds).toEqual(['floating']))
  expect(host.first.read().undoDepth).toBe(0)
  pointer(body, 'pointerdown', 30, 40)
  await act(async () => { await Promise.resolve() })
  pointer(window, 'pointermove', 60, 50)
  pointer(window, 'pointercancel', 60, 50)
  expect(host.first.read().undoDepth).toBe(0)
  pointer(body, 'pointerdown', 30, 40)
  await act(async () => { await Promise.resolve() })
  pointer(window, 'pointerup', 70, 60)
  await waitFor(() => expect(host.first.read().undoDepth).toBe(1))
  const model = host.first.read().model
  if (model.kind !== 'course-v10') throw new Error('Expected course')
  expect(model.project.instances.floating.frame!.transform).toEqual([1, 0, 0, 1, 60, 50])
})

it('program double-click enters the existing ordinary group scope', async () => {
  const { host, bridge, ui } = await fixture()
  fireEvent.doubleClick(ui.getByTestId('body-group'))
  await waitFor(() => expect(bridge.read().activeGroupId).toBe('group'))
  expect(host.first.read().undoDepth).toBe(0)
})

it('program pointer keeps the frame accepted by input ACK even when pointerup arrived first', async () => {
  const { host, ui } = await fixture()
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const current = useEditorStore.getState(), original = current.navigateCourseView
  useEditorStore.setState({ navigateCourseView: async select => { await waiting; return original(select) } })
  pointer(ui.getByTestId('vector-floating'), 'pointerdown', 30, 40)
  await act(async () => {
    await current.courseKernel.edit([{ type: 'frame.set', instanceId: 'floating', frame: { width: 320, height: 100, transform: [1, 0, 0, 1, 20, 30] } }])
  })
  pointer(window, 'pointerup', 70, 60)
  await act(async () => { release(); await waiting })
  await waitFor(() => expect(host.first.read().undoDepth).toBe(2))
  const model = host.first.read().model
  if (model.kind !== 'course-v10') throw new Error('Expected course')
  expect(model.project.instances.floating.frame).toEqual({ width: 320, height: 100, transform: [1, 0, 0, 1, 60, 50] })
})

it.each(['table', 'chart'] as const)('program %s double-click enters the existing native cell or label editor', async kind => {
  const { ui } = await fixture(), body = kind === 'chart' ? ui.getByTestId('chart-title') : ui.getByTestId('body-table')
  pointer(body, 'pointerdown', 30, 40); pointer(window, 'pointerup', 30, 40)
  await act(async () => { await Promise.resolve() })
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
  fireEvent.doubleClick(body, { clientX: 30, clientY: 40 })
  await waitFor(() => expect(useEditorStore.getState().slideContentEdit?.instanceId).toBe(kind))
  expect(h.beginNative).toHaveBeenCalledWith(kind, expect.any(Function))
  await waitFor(() => expect(ui.container.querySelector('[data-component-professional-editor]')).not.toBeNull())
  const selected = useEditorStore.getState().courseView.interactionSelection
  expect(selected?.kind).toBe('author-field')
  expect(selected?.kind === 'author-field' ? selected.field.dataPath?.[0] : '').toBe(kind === 'table' ? 'rows' : 'title')
})

it('a precise selection suppresses the derived parent outline without changing standalone or run rendering', () => {
  const project = createBlankProgramProject('投影'), instance = project.instances[project.rootIds[0]]
  const props = { instance, project, selectedInstanceId: instance.id, selectedInstanceIds: [instance.id], onSelect() {} }
  const ui = render(<InstanceView {...props} selectionKind="author-field" />)
  expect((ui.container.firstElementChild as HTMLElement).style.outline).toBe('')
  ui.rerender(<InstanceView {...props} selectionKind="objects" />)
  expect((ui.container.firstElementChild as HTMLElement).style.outline).toBe('2px solid #2563eb')
  ui.rerender(<InstanceView {...props} />)
  expect((ui.container.firstElementChild as HTMLElement).style.outline).toBe('2px solid #2563eb')
  ui.rerender(<InstanceView {...props} selectionKind="objects" player />)
  expect((ui.container.firstElementChild as HTMLElement).style.outline).toBe('')
})
