import { createRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import { useComponentAuthorInteraction } from '../../src/renderer/ui/workspaces/useComponentAuthorInteraction'
import { authorFieldIdentity } from '../../src/renderer/documents/interactionSelection'

const h = vi.hoisted(() => ({ view: {} as any, state: {} as any, runtime: {} as any, hit: vi.fn() }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => h.runtime }))
vi.mock('../../src/renderer/components/componentAuthorHit', () => ({ requestComponentAuthorHit: h.hit }))
vi.mock('../../src/shared/contracts/component-platform/project', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/shared/contracts/component-platform/project')>(), componentIsLocked: () => false,
}))
vi.mock('../../src/renderer/authoring/professionalContentFields', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/renderer/authoring/professionalContentFields')>(), nativeTextSpotFromElement: () => undefined,
}))
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: Object.assign((select: (state: unknown) => unknown) => select(h.state), { getState: () => h.state }),
}))

const spot = (id: string): ComponentAuthorSpot => ({
  id: `spot-${id}`, instanceId: id, mountGeneration: 1, authorKey: `field-${id}`, kind: 'text',
  dataPath: ['title'], initialValue: id, localBounds: { width: 200, height: 50, transform: [1, 0, 0, 1, 0, 0] },
})
const fields = [spot('a'), spot('b')]
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

beforeEach(() => {
  const elements = new Map(fields.map(field => {
    const element = document.createElement('div'); element.dataset.hitId = field.instanceId
    return [field.instanceId, element]
  }))
  const bridge = {
    read: () => h.view,
    captureOwnedTarget: () => ({ documentId: 'doc', epoch: 'epoch', surfaceId: 'surface', rootInstanceId: 'surface',
      editingContainerId: null, activeStateId: null, editingProject: h.runtime.project }),
    selectInstances: vi.fn(),
    selectAuthorSpot: vi.fn((_id, value) => { h.view.interactionSelection = { kind: 'author-field', instanceId: value.instanceId, field: value } }),
  }
  h.view = { activeDocumentId: 'doc', snapshot: { epoch: 'epoch' }, surfaceId: 'surface', rootInstanceId: 'surface', editingContainerId: null, activeStateId: null }
  h.state = { courseBridge: bridge, courseView: h.view, slideContentEdit: null, commitSlideContentEdit: vi.fn(async () => undefined), beginSlideSpotEdit: vi.fn(async () => ({})) }
  h.runtime = { project: { instances: { a: {}, b: {} }, definitions: {} }, world: {
    authorSpots: () => fields, subscribeAuthorSpots: () => () => undefined, contentElement: (id: string) => elements.get(id),
  } }
  h.hit.mockReset()
})

describe('a realm caret reaches the same professional plain-text input', () => {
  const pointerOwner = () => {
    const element = document.createElement('main'); document.body.append(element)
    const root = createRef<HTMLElement>(); root.current = element
    const hook = renderHook(({ contextKey }) => useComponentAuthorInteraction({ root, documentId: 'doc', surfaceId: 'surface',
      enabled: true, contextKey, report: vi.fn() }), { initialProps: { contextKey: 'program' } })
    h.state.beginSlideSpotEdit.mockImplementation(async (field: ComponentAuthorSpot, target: unknown) => {
      h.state.slideContentEdit = { source: 'canvas', instanceId: field.instanceId, definitionId: 'program', authorSpot: field,
        spotText: field.initialValue, target }
      return h.state.slideContentEdit
    })
    const pointer = async (field: ComponentAuthorSpot, caretOffset?: number) => {
      await act(async () => { element.dispatchEvent(new CustomEvent('component-author-pointer', { bubbles: true, detail: {
        instanceId: field.instanceId, localPoint: { x: 85, y: 20 }, mountGeneration: field.mountGeneration,
        authorKey: field.authorKey, caretOffset,
      } })) })
      hook.rerender({ contextKey: 'program' })
    }
    return { ...hook, element, pointer }
  }

  it('opens at the clicked middle UTF-16 offset instead of the end', async () => {
    const field = { ...fields[0]!, initialValue: 'Program 😀 title original' }
    h.runtime.world.authorSpots = () => [field]
    const owner = pointerOwner()
    const target = h.runtime.world.contentElement('a'); document.body.append(target)
    try {
      await owner.pointer(field, 11)
      const editor = render(owner.result.current.editor)
      const input = await editor.findByRole('textbox', { name: '编辑此处文字' })
      await waitFor(() => expect([document.getSelection()?.anchorOffset, document.getSelection()?.focusOffset]).toEqual([11, 11]))
      expect(input.contains(document.getSelection()!.anchorNode)).toBe(true)
      expect(document.getSelection()!.anchorOffset).toBeLessThan(input.textContent!.length)
      expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledWith('doc', field, 'surface')
    } finally { owner.element.remove(); target.remove() }
  })

  it.each([0, 999, -1, 1.5, Number.NaN])('bounds the plain caret %s to the accepted current field text', async offset => {
    const field = { ...fields[0]!, initialValue: 'A😀B' }
    h.runtime.world.authorSpots = () => [field]
    const owner = pointerOwner()
    try {
      await owner.pointer(field, offset)
      expect(owner.result.current.editor?.props.caretOffset).toBe(offset === 0 ? 0 : offset === 999 ? 4 : undefined)
    } finally { owner.element.remove() }
  })

  it('does not reuse the previous field or previous workspace context caret', async () => {
    const owner = pointerOwner()
    try {
      await owner.pointer(fields[0]!, 0)
      expect(owner.result.current.editor?.props.caretOffset).toBe(0)
      owner.rerender({ contextKey: 'other-program' })
      expect(owner.result.current.editor?.props.caretOffset).toBeUndefined()
      h.state.slideContentEdit = null
      await owner.pointer(fields[1]!)
      expect(owner.result.current.editor?.props.caretOffset).toBeUndefined()
      expect(h.state.beginSlideSpotEdit).toHaveBeenLastCalledWith(fields[1], expect.anything(), expect.any(Function))
    } finally { owner.element.remove() }
  })

  it('retires an old caret request while its previous input ACK waits across a workspace switch', async () => {
    const ack = deferred<void>(), owner = pointerOwner()
    h.state.slideContentEdit = { source: 'canvas', instanceId: 'b', authorSpot: fields[1],
      target: h.state.courseBridge.captureOwnedTarget() }
    h.state.commitSlideContentEdit.mockImplementation(() => ack.promise)
    try {
      let pending!: Promise<boolean>
      await act(async () => { pending = owner.result.current.beginRegisteredSpot('a', { x: 10, y: 10 }, 1, 'field-a', 0) })
      owner.rerender({ contextKey: 'other-program' })
      const nextDraft = { source: 'canvas', instanceId: 'b', authorSpot: fields[1], spotText: 'New context draft',
        target: h.state.courseBridge.captureOwnedTarget() }
      h.state.slideContentEdit = nextDraft
      await act(async () => { ack.resolve(); await pending })
      owner.rerender({ contextKey: 'other-program' })
      expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
      expect(h.state.slideContentEdit).toBe(nextDraft)
      expect(owner.result.current.editor?.props.caretOffset).toBeUndefined()
    } finally { owner.element.remove() }
  })
})
afterEach(cleanup)
const mount = () => renderHook(() => useComponentAuthorInteraction({ root: createRef<HTMLDivElement>(), documentId: 'doc', surfaceId: 'surface', enabled: true, report: vi.fn() }))

describe('registered content activation keeps the first semantic intent across asynchronous work', () => {
  it('does not let a slower old paint hit replace the newer field selection', async () => {
    const first = deferred<{ authorKey: string; painted: boolean }>()
    h.hit.mockImplementation((element: HTMLElement) => element.dataset.hitId === 'a' ? first.promise : Promise.resolve({ authorKey: 'field-b', painted: true }))
    const { result } = mount()
    let pending!: Promise<boolean>
    await act(async () => {
      pending = result.current.beginRegisteredSpot('a', { x: 10, y: 10 })
      await result.current.beginRegisteredSpot('b', { x: 20, y: 10 })
      first.resolve({ authorKey: 'field-a', painted: true }); await pending
    })
    expect(h.state.courseBridge.selectAuthorSpot.mock.calls.map((call: unknown[]) => (call[1] as ComponentAuthorSpot).instanceId)).toEqual(['b'])
    expect(h.state.beginSlideSpotEdit).toHaveBeenCalledTimes(1)
  })

  it('does not replay a captured native cell after a newer registered-field intent wins during ACK', async () => {
    const ack = deferred<void>(), capturedCell = vi.fn(() => true)
    h.state.slideContentEdit = { instanceId: 'old', authorSpot: spot('old'), target: { documentId: 'doc', epoch: 'epoch', surfaceId: 'surface', activeStateId: null } }
    h.state.commitSlideContentEdit.mockImplementation(() => ack.promise)
    const { result } = mount()
    await act(async () => {
      const native = result.current.beginNative('a', capturedCell)
      const field = result.current.activate(fields[1]!, true)
      ack.resolve(); await Promise.all([native, field])
    })
    expect(capturedCell).not.toHaveBeenCalled()
    expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled()
    expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledWith('doc', fields[1], 'surface')
  })

  it('keeps a native cell rich value as its exact field target', () => {
    const rich: ComponentAuthorSpot = { ...fields[0]!, authorKey: undefined, dataPath: ['rows', '0', 'cells', '0', 'content'],
      initialValue: { inlines: [{ type: 'text', text: 'Cell', style: { bold: true } }] } }
    const { result } = mount()
    act(() => { result.current.selectNativeField(rich) })
    expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledWith('doc', rich, 'surface')
    expect(h.view.interactionSelection.field.initialValue).toEqual(rich.initialValue)
  })

  it('lets a Nodes selection made during ACK retire the captured field activation', async () => {
    const ack = deferred<void>(), capturedCell = vi.fn(() => true)
    h.state.commitSlideContentEdit.mockImplementation(() => ack.promise)
    const { result } = mount()
    await act(async () => {
      const pending = result.current.beginNative('a', capturedCell)
      h.view = { ...h.view, interactionSelection: { kind: 'objects', instanceIds: ['b'] } }
      ack.resolve(); await pending
    })
    expect(capturedCell).not.toHaveBeenCalled()
    expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled()
  })

  it('does not reuse an identically named field draft from another document', async () => {
    h.state.slideContentEdit = { instanceId: 'b', authorSpot: fields[1], source: 'canvas',
      target: { documentId: 'other-doc', epoch: 'other-epoch', surfaceId: 'surface', activeStateId: null } }
    const { result } = mount()
    await act(async () => { await result.current.activate(fields[1]!, true) })
    expect(h.state.commitSlideContentEdit).toHaveBeenCalledOnce()
    expect(h.state.beginSlideSpotEdit).toHaveBeenCalledOnce()
  })

  it('selects a painted owning object when no field was hit, while a missing explicit field stays precise', async () => {
    h.hit.mockResolvedValue({ authorKey: null, painted: true })
    const { result } = mount()
    await act(async () => { await result.current.beginRegisteredSpot('a', { x: 10, y: 10 }) })
    expect(h.state.courseBridge.selectInstances).toHaveBeenCalledWith('doc', ['a'], 'surface')
    h.state.courseBridge.selectInstances.mockClear()
    await act(async () => { await result.current.beginRegisteredSpot('a', { x: 10, y: 10 }, 1, 'missing-field') })
    expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled()
    expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled()
  })

  it('keeps the precise selection when the captured native cell has disappeared', async () => {
    h.view = { ...h.view, interactionSelection: { kind: 'author-field', instanceId: 'a', field: fields[0] } }
    const { result } = mount()
    await act(async () => { await result.current.beginNative('a', () => false) })
    expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled()
    expect(h.view.interactionSelection.kind).toBe('author-field')
  })
})


describe('a registered field reserves its right pointer before the existing context-menu owner runs', () => {
  it('blocks the competing PM mouse gesture without selecting or editing before the real context menu', async () => {
    const field: ComponentAuthorSpot = { ...fields[0]!, kind: 'image', dataPath: ['assetId'], initialValue: 'asset-old' }
    h.runtime.world.authorSpots = () => [field]
    h.hit.mockResolvedValue({ authorKey: field.authorKey, painted: true })
    const element = document.createElement('main'), host = h.runtime.world.contentElement('a')
    host.dataset.componentInstance = 'a'; host.setAttribute('contenteditable', 'false')
    host.style.width = '200px'; host.style.height = '50px'
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 50, width: 200, height: 50 } as DOMRect)
    element.append(host); document.body.append(element)
    const root = createRef<HTMLElement>(); root.current = element
    const menu = vi.fn((event: Event) => event.preventDefault())
    element.addEventListener('course-object-context-menu', menu)
    const { result } = renderHook(() => useComponentAuthorInteraction({ root, documentId: 'doc', surfaceId: 'surface', enabled: true, report: vi.fn() }))
    const pointer = { button: 2, target: host, clientX: 10, clientY: 10, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    try {
      act(() => { expect(result.current.pointerFromElement(pointer as unknown as ReactPointerEvent<HTMLElement>)).toBe(true) })
      expect(pointer.preventDefault).toHaveBeenCalledOnce(); expect(pointer.stopPropagation).toHaveBeenCalledOnce()
      expect(h.hit).not.toHaveBeenCalled()
      expect(h.state.courseBridge.selectAuthorSpot).not.toHaveBeenCalled(); expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled()
      expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled(); expect(h.state.commitSlideContentEdit).not.toHaveBeenCalled()
      expect(h.view.interactionSelection).toBeUndefined()
      const context = { button: 2, target: host, clientX: 10, clientY: 10, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      await act(async () => { expect(result.current.contextMenuFromElement(context as unknown as ReactMouseEvent<HTMLElement>)).toBe(true) })
      await waitFor(() => expect(menu).toHaveBeenCalledOnce())
      expect(h.state.courseBridge.selectAuthorSpot).toHaveBeenCalledWith('doc', field, 'surface')
      expect(h.view.interactionSelection.kind).toBe('author-field')
      expect((menu.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({ itemIds: ['a'], selectionIdentity: authorFieldIdentity('a', field) })
      expect(h.state.beginSlideSpotEdit).not.toHaveBeenCalled(); expect(h.state.courseBridge.selectInstances).not.toHaveBeenCalled()
    } finally { element.removeEventListener('course-object-context-menu', menu); element.remove() }
  })
})
