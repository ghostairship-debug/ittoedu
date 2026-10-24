import { createRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentAuthorPointerEventDetail, ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import { useComponentAuthorInteraction } from '../../src/renderer/ui/workspaces/useComponentAuthorInteraction'
import { AUTHOR_FIELD_ACTION_EVENT } from '../../src/renderer/editing/commands/objectContextMenu'
import { interactionSelectionIdentity } from '../../src/renderer/documents/interactionSelection'

const h = vi.hoisted(() => ({ view: {} as any, state: {} as any, runtime: {} as any, fields: [] as ComponentAuthorSpot[],
  hit: vi.fn(), visible: vi.fn(), geometryEdits: vi.fn(), locked: false }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => h.runtime }))
vi.mock('../../src/renderer/components/componentAuthorHit', () => ({ requestComponentAuthorHit: h.hit, visibleComponentAuthorHit: h.visible }))
vi.mock('../../src/shared/contracts/component-platform/project', async original => ({
  ...await original<typeof import('../../src/shared/contracts/component-platform/project')>(), componentIsLocked: () => h.locked,
}))
vi.mock('../../src/renderer/componentPlatform/surfaces/slide/authorSpots', async original => ({
  ...await original<typeof import('../../src/renderer/componentPlatform/surfaces/slide/authorSpots')>(), authorSpotGeometryEdits: h.geometryEdits,
}))
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: Object.assign((select: (state: unknown) => unknown) => select(h.state), { getState: () => h.state }),
  selectActiveSlideContentEdit: (state: any) => state.slideContentEdit,
}))

const field = (): ComponentAuthorSpot => ({ id: 'a:title', instanceId: 'a', mountGeneration: 1, authorKey: 'title', kind: 'text',
  initialValue: 'Title', localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 20, 10] },
  geometry: { frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 20, 10] },
    parentToInstance: [1, 0, 0, 1, 0, 0], author: {}, boxInsets: { width: 0, height: 0 } } })
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>(accept => { resolve = accept }), resolve } }

beforeEach(() => {
  h.locked = false; h.fields = [field()]
  h.view = { activeDocumentId: 'doc', snapshot: { epoch: 'epoch' }, surfaceId: 'surface', rootInstanceId: 'surface', editingContainerId: null, activeStateId: null }
  const project = { id: 'project', instances: { a: { id: 'a', definitionId: 'program', frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } } },
    definitions: { program: { implementation: { kind: 'source' } } }, rootIds: [], global: { underlay: [], overlay: [] } }
  const bridge = { read: () => h.view,
    selectInstances: vi.fn((_id, instanceIds) => { h.view.interactionSelection = { kind: 'objects', instanceIds } }),
    selectAuthorSpot: vi.fn((_id, spot) => { h.view.interactionSelection = { kind: 'author-field', instanceId: spot.instanceId, field: spot } }),
    captureOwnedTarget: vi.fn(() => ({ documentId: 'doc', epoch: 'epoch', surfaceId: 'surface', rootInstanceId: 'surface', editingContainerId: null,
      activeStateId: null, project, editingProject: project, resources: {} })),
    capture: vi.fn((edits, target) => ({ edits, target })), editCaptured: vi.fn(async () => ({ revision: 1 })) }
  h.state = { courseBridge: bridge, courseView: h.view, slideContentEdit: null,
    commitSlideContentEdit: vi.fn(async () => undefined), beginSlideSpotEdit: vi.fn(async () => ({})) }
  h.runtime = { project, world: { authorSpots: () => h.fields, subscribeAuthorSpots: () => () => undefined }, previewAuthorSpot: vi.fn() }
  h.hit.mockReset(); h.hit.mockResolvedValue({ authorKey: 'title', painted: true })
  h.visible.mockReset(); h.visible.mockResolvedValue({ instanceId: 'a', authorKey: 'title' })
  h.geometryEdits.mockReset(); h.geometryEdits.mockImplementation((_project, spot, geometry) => [{ type: 'authoring.set', instanceId: spot.instanceId, path: ['geometry'], value: geometry }])
})
afterEach(() => { cleanup(); document.body.innerHTML = '' })

type ObjectPointerHandler = NonNullable<Parameters<typeof useComponentAuthorInteraction>[0]['onObjectPointer']>
const mount = (onObjectPointer?: ReturnType<typeof vi.fn<ObjectPointerHandler>>, options: {
  resolveObjectTarget?(id: string): string | null; onObjectDoubleClick?(id: string, point: { x: number; y: number }): void
  selectImage?: Parameters<typeof useComponentAuthorInteraction>[0]['selectImage']
} = {}) => {
  const element = document.createElement('main'), host = document.createElement('div')
  host.dataset.componentInstance = 'a'; host.style.width = '200px'; host.style.height = '100px'
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 } as DOMRect)
  const capture = vi.fn(), release = vi.fn()
  host.setPointerCapture = capture; host.hasPointerCapture = () => true; host.releasePointerCapture = release
  element.append(host); document.body.append(element)
  h.runtime.world.contentElement = () => host
  const root = createRef<HTMLElement>(); root.current = element
  const report = vi.fn()
  const hook = renderHook(() => useComponentAuthorInteraction({ root, documentId: 'doc', surfaceId: 'surface', enabled: true, report, onObjectPointer, ...options }))
  const pointer = (extra: Record<string, unknown> = {}) => ({ button: 0, pointerId: 4, target: host, currentTarget: host, clientX: 30, clientY: 20,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }) as unknown as ReactPointerEvent<HTMLElement>
  const phase = async (phase?: ComponentAuthorPointerEventDetail['phase'], extra: Partial<ComponentAuthorPointerEventDetail> = {}) => {
    await act(async () => { element.dispatchEvent(new CustomEvent('component-author-pointer', { bubbles: true, detail: {
      instanceId: 'a', mountGeneration: 1, authorKey: 'title', localPoint: { x: 30, y: 20 }, pointerId: 4, phase, ...extra,
    } })) })
  }
  const nativePointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true }); Object.assign(event, { pointerId: 4, clientX: x, clientY: y }); window.dispatchEvent(event)
  }
  return { ...hook, element, host, capture, release, report, pointer, phase, nativePointer }
}

describe('one hook selection and transform owner', () => {
  it('selects on an old unphased realm pointer and edits only on double-click', async () => {
    const owner = mount()
    await owner.phase()
    expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledOnce()
    expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
    await act(async () => { owner.element.dispatchEvent(new CustomEvent('component-author-double-click', { detail: {
      instanceId: 'a', authorKey: 'title', localPoint: { x: 30, y: 20 }, caretOffset: 2,
    } })) })
    expect(h.state.beginSlideSpotEdit).toHaveBeenCalledOnce()
  })

  it('selects an internal image on single click and opens its existing picker on double-click only after the previous input settles', async () => {
    h.fields = [{ ...field(), kind: 'image', dataPath: ['src'], initialValue: 'old.png' }]
    h.runtime.project.instances.a.data = { src: 'old.png' }
    const selectImage = vi.fn(async () => null), owner = mount(undefined, { selectImage })
    await owner.phase()
    expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledWith('doc', h.fields[0], 'surface')
    expect(selectImage).not.toHaveBeenCalled()
    const ack = deferred<void>()
    h.state.slideContentEdit = { instanceId: 'previous-input', target: { documentId: 'doc', epoch: 'epoch', surfaceId: 'surface', activeStateId: null } }
    h.state.commitSlideContentEdit.mockImplementation(() => ack.promise.then(() => { h.state.slideContentEdit = null }))
    await act(async () => { owner.element.dispatchEvent(new CustomEvent('component-author-double-click', { detail: {
      instanceId: 'a', authorKey: 'title', localPoint: { x: 30, y: 20 },
    } })) })
    expect(h.state.commitSlideContentEdit).toHaveBeenCalledOnce()
    expect(selectImage).not.toHaveBeenCalled()
    await act(async () => { ack.resolve() })
    expect(selectImage).toHaveBeenCalledOnce()
    expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenLastCalledWith('doc', h.fields[0], 'surface')
    expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
    expect(h.state.courseBridge.editCaptured).not.toHaveBeenCalled()
    expect(owner.report).not.toHaveBeenCalled()
  })

  it('keeps a locked internal image selectable without opening its picker on double-click', async () => {
    h.fields = [{ ...field(), kind: 'image', dataPath: ['src'], initialValue: 'old.png' }]
    h.runtime.project.instances.a.data = { src: 'old.png' }; h.locked = true
    const selectImage = vi.fn(async () => null), owner = mount(undefined, { selectImage })
    await owner.phase()
    expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledWith('doc', h.fields[0], 'surface')
    await act(async () => { owner.element.dispatchEvent(new CustomEvent('component-author-double-click', { detail: {
      instanceId: 'a', authorKey: 'title', localPoint: { x: 30, y: 20 },
    } })) })
    expect(selectImage).not.toHaveBeenCalled()
    expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
    expect(h.state.courseBridge.editCaptured).not.toHaveBeenCalled()
  })

  it.each(['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart'])('leaves %s native whole pointer and double-click to its workspace owner', key => {
    h.runtime.project.definitions.program.implementation = { kind: 'builtin', key }
    const owner = mount()
    act(() => {
      expect(owner.result.current.pointerFromElement(owner.pointer())).toBe(false)
      expect(owner.result.current.doubleClickFromElement(owner.pointer() as unknown as ReactMouseEvent<HTMLElement>)).toBe(false)
    })
    expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled(); expect(h.state.courseBridge.selectAuthorSpot).not.toHaveBeenCalled()
  })

  it('uses the final pointerup coordinate after delayed field hit, without late capture or a text draft', async () => {
    const hit = deferred<{ authorKey: string; painted: boolean }>(); h.hit.mockImplementation(() => hit.promise)
    const owner = mount()
    act(() => { expect(owner.result.current.pointerFromElement(owner.pointer())).toBe(true) })
    act(() => { owner.nativePointer('pointermove', 45, 20); owner.nativePointer('pointerup', 60, 25) })
    await act(async () => { hit.resolve({ authorKey: 'title', painted: true }) })
    expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
    expect(h.geometryEdits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ authorKey: 'title' }), { translateX: 30, translateY: 5 }, expect.anything())
    expect(h.state.courseBridge.editCaptured).toHaveBeenCalledOnce()
    expect(owner.capture).toHaveBeenCalledTimes(1)
  })

  it('accepts an already released async visible-hit event with its final point and never captures it', async () => {
    const owner = mount()
    await act(async () => { owner.result.current.pointerFromElement(owner.pointer({ released: true, finalPointer: { clientX: 50, clientY: 20 } })) })
    expect(owner.capture).not.toHaveBeenCalled()
    expect(h.geometryEdits.mock.calls[0]?.[2]).toEqual({ translateX: 20 })
    expect(h.state.courseBridge.editCaptured).toHaveBeenCalledOnce()
  })

  it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels %s without committing pending or previewed geometry', async kind => {
    const owner = mount()
    await act(async () => { owner.result.current.pointerFromElement(owner.pointer()) })
    act(() => {
      owner.nativePointer('pointermove', 50, 20)
      if (kind === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else owner.nativePointer(kind, 50, 20)
      owner.nativePointer('pointerup', 60, 20)
    })
    expect(h.state.courseBridge.editCaptured).not.toHaveBeenCalled()
    expect(h.runtime.previewAuthorSpot).toHaveBeenLastCalledWith('a:title', null)
  })

  it('keeps a no-geometry field precise, and below-threshold/unchanged gestures out of History', async () => {
    h.fields[0]!.geometry = undefined
    const owner = mount()
    await act(async () => { owner.result.current.pointerFromElement(owner.pointer()) })
    act(() => { owner.nativePointer('pointermove', 100, 100); owner.nativePointer('pointerup', 100, 100) })
    expect(h.view.interactionSelection.kind).toBe('author-field')
    expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled(); expect(h.state.courseBridge.editCaptured).not.toHaveBeenCalled()
    h.fields = [field()]
    await act(async () => { owner.result.current.pointerFromElement(owner.pointer()) })
    act(() => { owner.nativePointer('pointerup', 31, 20) })
    expect(h.state.courseBridge.editCaptured).not.toHaveBeenCalled()
  })

  it('freezes the realm field after start and commits only the end coordinate', async () => {
    const owner = mount()
    await owner.phase('start')
    await owner.phase('update', { authorKey: 'another', localPoint: { x: 40, y: 20 } })
    await owner.phase('end', { authorKey: 'another', localPoint: { x: 55, y: 20 } })
    expect(h.geometryEdits.mock.calls[0]?.[1].authorKey).toBe('title')
    expect(h.geometryEdits.mock.calls[0]?.[2]).toEqual({ translateX: 25 })
    expect(h.state.courseBridge.editCaptured).toHaveBeenCalledOnce()
  })

  it('continues a drag preview when returning inside the original click threshold', async () => {
    const owner = mount()
    await owner.phase('start')
    await owner.phase('update', { localPoint: { x: 50, y: 20 } })
    await owner.phase('update', { localPoint: { x: 32, y: 20 } })
    expect(h.runtime.previewAuthorSpot).toHaveBeenLastCalledWith('a:title', { translateX: 2 })
    await owner.phase('end', { localPoint: { x: 32, y: 20 } })
    expect(h.geometryEdits.mock.calls[0]?.[2]).toEqual({ translateX: 2 })
    expect(h.state.courseBridge.editCaptured).toHaveBeenCalledOnce()
  })

  it('forwards an opaque owning-object start and end to the workspace, including release before paint hit', async () => {
    const hit = deferred<{ authorKey: null; painted: boolean }>(); h.hit.mockImplementation(() => hit.promise)
    h.visible.mockResolvedValue({ instanceId: 'a' })
    const object = vi.fn<ObjectPointerHandler>(), owner = mount(object)
    await owner.phase('start', { authorKey: undefined })
    await owner.phase('end', { authorKey: undefined, localPoint: { x: 70, y: 35 } })
    await act(async () => { hit.resolve({ authorKey: null, painted: true }) })
    expect(object.mock.calls.map(call => call[0].phase)).toEqual(['start', 'end'])
    expect(object.mock.calls[0]?.[0].released).toBe(true)
    expect(object.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ x: 70, y: 35 }))
    expect(h.state.courseBridge.editCaptured).not.toHaveBeenCalled()
  })

  it('nudges a field in surface units even when its owning object is rotated and scaled', async () => {
    h.runtime.project.instances.a.frame.transform = [0, 2, -2, 0, 0, 0]
    const owner = mount()
    await owner.phase()
    expect(h.view.interactionSelection?.kind).toBe('author-field')
    await act(async () => { window.dispatchEvent(new CustomEvent(AUTHOR_FIELD_ACTION_EVENT, { cancelable: true, detail: {
      action: 'nudge', documentId: 'doc', epoch: 'epoch', selectionIdentity: interactionSelectionIdentity(h.view.interactionSelection), dx: 10, dy: 0,
    } })) })
    expect(owner.report.mock.calls).toEqual([])
    expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledTimes(2)
    expect(h.geometryEdits.mock.calls[0]?.[2]).toEqual({ translateY: -5 })
    expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled()
    expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
  })

  it('keeps realm single/double clicks on the current group until its workspace enters the next level', async () => {
    let scope = 'outer'
    const object = vi.fn<ObjectPointerHandler>(), double = vi.fn(() => { scope = scope === 'outer' ? 'inner' : 'leaf' })
    const owner = mount(object, { resolveObjectTarget: () => scope === 'leaf' ? 'a' : scope, onObjectDoubleClick: double })
    await owner.phase('start')
    await owner.phase('end')
    expect(h.state.courseBridge.selectInstances).toHaveBeenLastCalledWith('doc', ['outer'], 'surface')
    expect(h.state.courseBridge.selectAuthorSpot).not.toHaveBeenCalled()
    const dbl = async () => { await act(async () => { owner.element.dispatchEvent(new CustomEvent('component-author-double-click', { detail: {
      instanceId: 'a', authorKey: 'title', localPoint: { x: 30, y: 20 },
    } })) }) }
    await dbl()
    expect(double).toHaveBeenLastCalledWith('a', { x: 30, y: 20 })
    expect(scope).toBe('inner'); expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
    await owner.phase('start'); await owner.phase('end')
    expect(h.state.courseBridge.selectInstances).toHaveBeenLastCalledWith('doc', ['inner'], 'surface')
    await dbl()
    expect(scope).toBe('leaf'); expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
    await owner.phase('start'); await owner.phase('end')
    expect(h.view.interactionSelection.kind).toBe('author-field')
    await dbl()
    expect(h.state.beginSlideSpotEdit).toHaveBeenCalledOnce()
  })
})
