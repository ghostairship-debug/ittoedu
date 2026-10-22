import { useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/courseV10StoreHost'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { TABLE_DEFINITION, createTableData, parseTableData } from '../../src/components/table'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { ProfessionalContentEditor } from '../../src/renderer/ui/workspaces/ProfessionalContentEditor'
import { useSlideNativeTextEditor } from '../../src/renderer/ui/workspaces/useSlideNativeTextEditor'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'

const bounds = { width: 400, height: 120, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); geometry.forEach((key, index) => {
  if (descriptors[index]) Object.defineProperty(Range.prototype, key, descriptors[index]!)
  else Reflect.deleteProperty(Range.prototype, key)
}) })
function project(table = false): CourseProjectV10 {
  const data = table ? createTableData({ rows: 2, columns: 2 }) : createTextComponentData('keep text')
  if (table && 'rows' in data) {
    const { text: _text, ...cell } = data.rows[0].cells[0]
    data.rows[0].cells[0] = { ...cell, content: { inlines: [{ type: 'text', text: 'keep rich', style: { bold: true } },
      { type: 'math', formulaId: 'cell-formula', latex: 'x', accessibleText: 'x' }] } }
  }
  const definition = table ? TABLE_DEFINITION : TEXT_DEFINITION
  return createTestProjectFromLegacy({ schemaVersion: 10, id: 'gesture-project', revision: 0, title: '专业输入',
    definitions: { [definition.id]: definition }, instances: { item: { id: 'item', definitionId: definition.id, frame: bounds, data: data as unknown as JsonValue } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '页', childIds: ['item'] }], global: { underlay: [], overlay: [] }, assets: {} })
}
function target(project: CourseProjectV10): CapturedCourseTarget {
  return { documentId: 'document', epoch: 'epoch', project, editingProject: project, resources: { assets: {}, components: {} },
    surfaceId: 'slide', activeStateId: null, instanceId: 'item', instanceIds: ['item'] }
}
it('captures a stable cell before a flush and Enter moves without inserting a PM line break', async () => {
  const initial = project(true), original = parseTableData(initial.instances.item.data), selected = vi.fn(), completed = vi.fn(), changed = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
  const owner: { entry?: ReturnType<typeof useSlideNativeTextEditor>; reorder?(): void; properties?(): void } = {}
  function Harness() {
    const [current, setCurrent] = useState(initial), [edit, setEdit] = useState<SlideContentEdit | null>(null)
    owner.properties = () => setEdit(previous => previous && { ...previous, source: 'properties' })
    owner.reorder = () => setCurrent(previous => {
      const data = parseTableData(previous.instances.item.data)
      return { ...previous, instances: { ...previous.instances, item: { ...previous.instances.item, data: { ...data, rows: [...data.rows].reverse() } as unknown as JsonValue } } }
    })
    owner.entry = useSlideNativeTextEditor({ project: current, surfaceId: 'slide', edit, host: () => host,
      begin: instanceId => { const instance = current.instances[instanceId], data = structuredClone(instance.data)
        const next: SlideContentEdit = { instanceId, definitionId: instance.definitionId, target: target(current), data, originalData: data, composing: false, source: 'canvas' }
        setEdit(next); return next },
      update: data => { changed(data); setEdit(previous => previous && { ...previous, data: data as JsonValue }) },
      commit: async () => { completed(); setEdit(null) }, cancel: () => setEdit(null), onSelectField: selected,
      undo() {}, redo() {}, report: message => { throw new Error(message) },
    }, 'document:epoch:slide')
    return owner.entry.editor
  }
  const ui = render(<Harness />, { container: host })
  try {
    const activate = owner.entry!.capture('item', { x: 10, y: 10 }, { x: 10, y: 10 })!
    await act(async () => owner.reorder!())
    await act(async () => expect(activate()).toBe(true))
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ dataPath: ['rows', '1', 'cells', '0', 'content'] }), expect.any(Function), expect.any(Function))
    const body = host.querySelector<HTMLElement>('.ProseMirror')!
    expect(body.textContent).toContain('keep rich')
    await act(async () => fireEvent.keyDown(body, { key: 'Enter' }))
    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    const data = parseTableData(changed.mock.calls.at(-1)![0])
    expect(data.rows.find(row => row.id === original.rows[0].id)!.cells[0].content).toEqual(original.rows[0].cells[0].content)
    await act(async () => owner.properties!())
    expect(host.querySelector('[data-component-professional-editor]')).toBeNull()
  } finally { ui.unmount(); host.remove() }
})
it('Escape in the formula form cancels that form and keeps its surrounding text editor open', async () => {
  const p = project(), data = p.instances.item.data, commit = vi.fn(async () => {}), cancel = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  const draft: SlideContentEdit = { instanceId: 'item', definitionId: TEXT_DEFINITION.id, target: target(p), data, originalData: data, composing: false, source: 'canvas' }
  const ui = render(<ProfessionalContentEditor project={p} draft={draft} target={() => host} update={() => {}} updateSpot={() => {}}
    commit={commit} cancel={cancel} undo={() => {}} redo={() => {}} report={message => { throw new Error(message) }} />)
  try {
    fireEvent.click(await ui.findByRole('button', { name: '公式' }))
    const formula = ui.getByLabelText('公式 LaTeX')
    fireEvent.change(formula, { target: { value: 'x^2' } })
    await act(async () => fireEvent.keyDown(formula, { key: 'Escape' }))
    expect(ui.queryByLabelText('公式 LaTeX')).toBeNull()
    expect(host.querySelector('[data-component-professional-editor]')).not.toBeNull()
    expect(commit).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled()
  } finally { ui.unmount(); host.remove() }
})

it('does not reclaim the next cell after another precise selection wins during the ACK', async () => {
  const p = project(true), gate = deferred(), began = vi.fn(), started = vi.fn()
  let fieldCurrent = true
  const host = document.createElement('div'); document.body.append(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
  const owner: { entry?: ReturnType<typeof useSlideNativeTextEditor> } = {}
  function Harness() {
    const [edit, setEdit] = useState<SlideContentEdit | null>(null)
    owner.entry = useSlideNativeTextEditor({ project: p, surfaceId: 'slide', edit, host: () => host,
      begin: instanceId => { began(); const data = structuredClone(p.instances[instanceId].data)
        const draft: SlideContentEdit = { instanceId, definitionId: TABLE_DEFINITION.id, target: target(p), data, originalData: data, composing: false, source: 'canvas' }
        setEdit(draft); return draft },
      update: data => setEdit(previous => previous && { ...previous, data: data as JsonValue }),
      commit: async () => { started(); await gate.promise; setEdit(null) }, cancel: () => setEdit(null),
      fieldIsCurrent: () => fieldCurrent, onSelectField() {}, undo() {}, redo() {}, report: message => { throw new Error(message) },
    }, 'document:epoch:slide')
    return owner.entry.editor
  }
  const ui = render(<Harness />, { container: host })
  try {
    await act(async () => expect(owner.entry!.begin('item', { x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true))
    fireEvent.keyDown(host.querySelector<HTMLElement>('.ProseMirror')!, { key: 'Enter' })
    await waitFor(() => expect(started).toHaveBeenCalledOnce())
    fieldCurrent = false
    await act(async () => { gate.resolve(); await gate.promise })
    await waitFor(() => expect(host.querySelector('[data-component-professional-editor]')).toBeNull())
    expect(began).toHaveBeenCalledOnce()
  } finally { ui.unmount(); host.remove() }
})

it.each([{ key: 'Escape', keyCode: 27, which: 27 }, { key: 'Enter', keyCode: 13, which: 13, ctrlKey: true }])('professional text completion $key reaches the existing shell with browser keyCode', async key => {
  const p = project(), data = p.instances.item.data, commit = vi.fn(async () => {}), cancel = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  const draft: SlideContentEdit = { instanceId: 'item', definitionId: TEXT_DEFINITION.id, target: target(p), data, originalData: data, composing: false, source: 'canvas' }
  const ui = render(<ProfessionalContentEditor project={p} draft={draft} target={() => host} update={() => {}} updateSpot={() => {}}
    commit={commit} cancel={cancel} undo={() => {}} redo={() => {}} report={message => { throw new Error(message) }} />)
  try {
    await act(async () => fireEvent.keyDown(host.querySelector<HTMLElement>('.ProseMirror')!, key))
    await waitFor(() => expect(commit).toHaveBeenCalledOnce())
    expect(cancel).not.toHaveBeenCalled()
    expect(p.instances.item.data).toEqual(data)
  } finally { ui.unmount(); host.remove() }
})
