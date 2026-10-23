import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ComponentSourceEditor } from '../../src/renderer/components/ComponentSourceEditor'
import { CodeDocumentEditor, componentObjectJsonEdits } from '../../src/renderer/ui/DeveloperTab'
import { CourseComponentUnknownError, CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { courseDraftLifecycle } from '../../src/renderer/authoring/courseDraftLifecycle'
import type { DocumentEvent } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const bridges: CourseV10DocumentBridge[] = []
afterEach(() => { cleanup(); bridges.splice(0).forEach(bridge => bridge.dispose()); vi.restoreAllMocks() })

async function fixture() {
  let serial = 0
  const registry = new DocumentRegistry({ drivers: [new CourseV10Driver()], createId: () => `advanced-continuation-${++serial}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No disk save in this owner fixture') } } })
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'advanced-work', revision: 0, title: 'Work',
    definitions: { custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { value: 1 };' } } },
    instances: { a: { id: 'a', definitionId: 'custom', name: 'A', data: { label: 'A' } }, b: { id: 'b', definitionId: 'custom', name: 'B', data: { label: 'B' } } },
    surfaces: [{ id: 'page', title: 'Page', kind: 'slide', childIds: ['a', 'b'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'draft.glx')
  const listeners = new Set<(event: DocumentEvent) => void>()
  session.subscribe(event => listeners.forEach(listener => listener(event)))
  const api = { bootstrapCourse: async () => session.read(), list: async () => registry.list(), read: async (id: string) => registry.get(id).read(),
    dispatch: (operation: Parameters<DocumentHostAPI['dispatch']>[0]) => registry.get(operation.documentId).execute(operation),
    lookup: async (id: string, operationId: string) => registry.get(id).lookupOperation(operationId),
    subscribe: (listener: (event: DocumentEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } } as DocumentHostAPI
  const bridge = new CourseV10DocumentBridge(); bridges.push(bridge)
  await bridge.connect(api); bridge.selectInstances(session.documentId, ['a'], 'page')
  return { bridge, session, lifecycle: courseDraftLifecycle(bridge) }
}

function Source({ bridge, scope = 'definition' }: { bridge: CourseV10DocumentBridge; scope?: 'definition' | 'instance' }) {
  const view = useSyncExternalStore(bridge.subscribe, bridge.read), instance = view.project!.instances[view.selectedInstanceId!]
  const implementation = scope === 'definition' ? view.project!.definitions[instance.definitionId].implementation
    : instance.implementationOverride ?? view.project!.definitions[instance.definitionId].implementation
  return <ComponentSourceEditor instance={instance} implementation={implementation}
    scope={scope} bridge={bridge} documentId={view.activeDocumentId!} report={() => {}} />
}
function Json({ bridge }: { bridge: CourseV10DocumentBridge }) {
  const view = useSyncExternalStore(bridge.subscribe, bridge.read), instance = view.project!.instances[view.selectedInstanceId!]
  return <CodeDocumentEditor title="Object JSON" description="" value={JSON.stringify(instance)}
    bindingKey={JSON.stringify([view.activeDocumentId, view.snapshot!.epoch, { kind: 'object', instanceId: instance.id }, null])} draftOwner={bridge}
    capture={() => {
      const target = bridge.captureTarget(), current = target.project.instances[instance.id]
      return Object.assign(async (raw: string) => bridge.editCaptured(bridge.capture(componentObjectJsonEdits(target.project,
        { surfaceId: target.surfaceId, stateId: target.activeStateId, instanceId: current.id }, current, JSON.parse(raw)), target)),
      { target, context: { kind: 'object' as const, instanceId: current.id }, baseline: JSON.stringify(current) })
    }} />
}

it.each(['source', 'json'] as const)('consumes already-applied %s recovery without recreating a conflict or a pending draft', async kind => {
  const h = await fixture(), show = () => render(kind === 'source' ? <Source bridge={h.bridge} /> : <Json bridge={h.bridge} />)
  let editor = show()
  const next = kind === 'source' ? 'export default { value: 2 };' : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Edited' } })
  fireEvent.change(screen.getByRole('textbox', { name: kind === 'source' ? '组件实现源码' : 'Object JSON' }), { target: { value: next } })
  const records = h.lifecycle.preserve(h.session.documentId)
  expect(records).toHaveLength(1)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: kind === 'source' ? '保存实现' : '校验并应用' }))
  })
  await waitFor(() => expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(0))
  editor.unmount(); h.lifecycle.release(h.session.documentId); editor = show()
  const revision = h.session.read().revision
  await act(async () => expect(h.lifecycle.restore(h.session.documentId, records)).toMatchObject({ adopted: records, issues: [] }))
  expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] })
  expect(h.lifecycle.preserve(h.session.documentId)).toEqual([])
  expect(h.session.read().revision).toBe(revision)
  editor.unmount()
})

it('parks an incomplete JSON draft without applying it or blocking another target', async () => {
  const h = await fixture()
  render(<Json bridge={h.bridge} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Object JSON' }), { target: { value: '{"data":' } })
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId)).toMatchObject({ ready: false, issues: [expect.objectContaining({ documentId: h.session.documentId })] }))
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId, 'preserve')).toEqual({ ready: true, issues: [] }))
  expect(h.lifecycle.preserve(h.session.documentId)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ raw: '{"data":' }) })])
  const revision = h.session.read().revision
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['b'], 'page'))
  expect(screen.getByRole('textbox', { name: 'Object JSON' })).toHaveValue(JSON.stringify(h.bridge.read().project!.instances.b))
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] }))
  expect(h.session.read().revision).toBe(revision)
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
})

it('parks an unfinished source file path while retaining ordinary mounted active source preparation', async () => {
  const h = await fixture(), editor = render(<Source bridge={h.bridge} />)
  fireEvent.change(screen.getByRole('textbox', { name: '新增组件源码文件路径' }), { target: { value: 'unfinished.js' } })
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId, 'preserve')).toEqual({ ready: true, issues: [] }))
  expect(h.lifecycle.preserve(h.session.documentId)[0]?.payload).toMatchObject({ newPath: 'unfinished.js' })
  editor.unmount()
  expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] })
  h.lifecycle.release(h.session.documentId)
  const resumed = render(<Source bridge={h.bridge} />)
  fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export default { value: 3 };' } })
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] }))
  expect(h.session.read().undoDepth).toBe(1)
  expect(h.lifecycle.preserve(h.session.documentId)).toEqual([])
  resumed.unmount()
})

it('keeps a failed source draft with its original target while another target is editable', async () => {
  const h = await fixture()
  render(<Source bridge={h.bridge} scope="instance" />)
  const raw = 'export default { value: 19 };'
  fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: raw } })
  fireEvent.change(screen.getByRole('textbox', { name: '新增组件源码文件路径' }), { target: { value: 'pending.js' } })
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId, 'preserve')).toEqual({ ready: true, issues: [] }))
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['b'], 'page'))
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue('export default { value: 1 };')
  expect(h.lifecycle.preserve(h.session.documentId)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ instanceId: 'a', newPath: 'pending.js' }) })])
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['a'], 'page'))
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue(raw)
  expect(screen.getByRole('textbox', { name: '新增组件源码文件路径' })).toHaveValue('pending.js')
  expect(h.session.read().undoDepth).toBe(0)
})

it('preserves a genuinely different JSON recovery as parked input without replacing current content', async () => {
  const h = await fixture(), first = render(<Json bridge={h.bridge} />)
  const instance = h.bridge.read().project!.instances.a
  fireEvent.change(screen.getByRole('textbox', { name: 'Object JSON' }), { target: { value: JSON.stringify({ ...instance, data: { label: 'Old draft' } }) } })
  const records = h.lifecycle.preserve(h.session.documentId)
  first.unmount(); h.lifecycle.release(h.session.documentId)
  const target = h.bridge.captureTarget()
  await h.bridge.editCaptured(h.bridge.capture([{ type: 'data.set', instanceId: 'a', path: ['label'], value: 'Other writer' }], target))
  render(<Json bridge={h.bridge} />)
  const revision = h.session.read().revision
  await act(async () => h.lifecycle.restore(h.session.documentId, records))
  expect(screen.getByRole('textbox', { name: 'Object JSON' })).toHaveValue(JSON.stringify({ ...instance, data: { label: 'Old draft' } }))
  expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] })
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
  expect(h.bridge.captureTarget().project.instances.a.data).toEqual({ label: 'Other writer' })
  expect(h.session.read().revision).toBe(revision)
})

it.each(['source', 'json'] as const)('keeps %s input on unknown cancellation and releases it only after the exact resolver settles', async kind => {
  const h = await fixture()
  render(kind === 'source' ? <Source bridge={h.bridge} /> : <Json bridge={h.bridge} />)
  const raw = kind === 'source' ? 'export default { value: 7 };' : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Draft' } })
  let outcome: 'pending' | 'ready' = 'pending'
  const resolver = vi.fn(async () => outcome)
  vi.spyOn(h.bridge, 'editCaptured').mockRejectedValueOnce(new CourseComponentUnknownError('ACK unavailable', 'original-operation', resolver))
  fireEvent.change(screen.getByRole('textbox', { name: kind === 'source' ? '组件实现源码' : 'Object JSON' }), { target: { value: raw } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: kind === 'source' ? '保存实现' : '校验并应用' })))
  await waitFor(() => expect(resolver).toHaveBeenCalledWith('cancel'))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '放弃草稿' })))
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: kind === 'source' ? '组件实现源码' : 'Object JSON' })).toHaveValue(raw)
  outcome = 'ready'
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '放弃草稿' })))
  await waitFor(() => expect(h.lifecycle.preserve(h.session.documentId)).toEqual([]))
  expect(h.session.read().undoDepth).toBe(0)
})

it.each(['source', 'json'] as const)('reports an already-applied %s operation as applied after receipt resolution without replay', async kind => {
  const h = await fixture()
  render(kind === 'source' ? <Source bridge={h.bridge} /> : <Json bridge={h.bridge} />)
  const raw = kind === 'source' ? 'export default { value: 11 };' : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Applied' } })
  const apply = h.bridge.editCaptured.bind(h.bridge)
  const dispatch = vi.spyOn(h.bridge, 'editCaptured').mockImplementationOnce(async command => {
    const result = await apply(command)
    throw new CourseComponentUnknownError('ACK unavailable', result.operationId, async () => 'applied')
  })
  fireEvent.change(screen.getByRole('textbox', { name: kind === 'source' ? '组件实现源码' : 'Object JSON' }), { target: { value: raw } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: kind === 'source' ? '保存实现' : '校验并应用' })))
  await waitFor(() => expect(h.lifecycle.preserve(h.session.documentId)).toEqual([]))
  expect(screen.queryByText(/未应用：ACK unavailable/)).not.toBeInTheDocument()
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(h.session.read().undoDepth).toBe(1)
})

it.each(['source', 'json'] as const)('allows B %s editing while A awaits ACK and keeps both targets after the late result', async kind => {
  const h = await fixture()
  render(kind === 'source' ? <Source bridge={h.bridge} scope="instance" /> : <Json bridge={h.bridge} />)
  const target = h.bridge.captureTarget(), apply = h.bridge.editCaptured.bind(h.bridge)
  let release!: () => void, entered!: () => void
  const held = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  const dispatch = vi.spyOn(h.bridge, 'editCaptured').mockImplementationOnce(async command => { entered(); await held; return apply(command) })
  const label = kind === 'source' ? '组件实现源码' : 'Object JSON', saveLabel = kind === 'source' ? '保存实现' : '校验并应用'
  const aRaw = kind === 'source' ? 'export default { value: 21 };'
    : JSON.stringify({ ...target.project.instances.a, data: { label: 'A edited' } })
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: aRaw } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: saveLabel })))
  await started
  expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('readonly')
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['b'], 'page'))
  expect(screen.getByRole('textbox', { name: label })).not.toHaveAttribute('readonly')
  expect(screen.getByRole('button', { name: saveLabel })).not.toBeDisabled()
  const bRaw = kind === 'source' ? 'export default { value: 22 };'
    : JSON.stringify({ ...h.bridge.read().project!.instances.b, data: { label: 'B edited' } })
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: bRaw } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: saveLabel })))
  await waitFor(() => {
    const b = h.bridge.captureTarget().project.instances.b
    if (kind === 'source') expect(b.implementationOverride).toMatchObject({ kind: 'source', source: bRaw })
    else expect(b.data).toEqual({ label: 'B edited' })
  })
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
  await act(async () => { release(); await held })
  await waitFor(() => expect(h.lifecycle.preserve(h.session.documentId)).toEqual([]))
  expect(dispatch.mock.calls[0][0]).toMatchObject({ documentId: target.documentId, epoch: target.epoch })
  expect(h.bridge.read().selectedInstanceId).toBe('b')
  const project = h.bridge.captureTarget().project
  if (kind === 'source') {
    expect(project.instances.a.implementationOverride).toMatchObject({ kind: 'source', source: aRaw })
    expect(project.instances.b.implementationOverride).toMatchObject({ kind: 'source', source: bRaw })
    expect(screen.getByRole('textbox', { name: label })).toHaveValue(bRaw)
  } else {
    expect(project.instances.a.data).toEqual({ label: 'A edited' })
    expect(project.instances.b.data).toEqual({ label: 'B edited' })
    expect(JSON.parse((screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement).value).data).toEqual({ label: 'B edited' })
  }
})

it.each(['source', 'json'] as const)('parks valid unapplied A %s on target exit instead of applying it during B preparation', async kind => {
  const h = await fixture()
  render(kind === 'source' ? <Source bridge={h.bridge} scope="instance" /> : <Json bridge={h.bridge} />)
  const label = kind === 'source' ? '组件实现源码' : 'Object JSON'
  const raw = kind === 'source' ? 'export default { value: 31 };'
    : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Unapplied A' } })
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: raw } })
  const revision = h.session.read().revision
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['b'], 'page'))
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] }))
  expect(h.session.read().revision).toBe(revision)
  expect(h.session.read().undoDepth).toBe(0)
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['a'], 'page'))
  expect(screen.getByRole('textbox', { name: label })).toHaveValue(raw)
})

it.each(['source', 'json'] as const)('preserves %s composition on actual unmount without later applying its retired DOM timer', async kind => {
  const h = await fixture(), show = () => render(kind === 'source' ? <Source bridge={h.bridge} /> : <Json bridge={h.bridge} />)
  const editor = show(), label = kind === 'source' ? '组件实现源码' : 'Object JSON'
  const raw = kind === 'source' ? 'export default { value: 32 };'
    : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Composition raw' } })
  fireEvent.compositionStart(screen.getByRole('textbox', { name: label }))
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: raw } })
  expect(await h.lifecycle.prepare(h.session.documentId)).toMatchObject({ ready: false })
  expect(h.session.read().undoDepth).toBe(0)
  fireEvent.compositionEnd(screen.getByRole('textbox', { name: label }))
  editor.unmount()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)) })
  expect(await h.lifecycle.prepare(h.session.documentId, 'preserve')).toEqual({ ready: true, issues: [] })
  expect(h.lifecycle.preserve(h.session.documentId)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ composing: true }) })])
  expect(h.session.read().undoDepth).toBe(0)
  show()
  expect(screen.getByRole('textbox', { name: label })).toHaveValue(raw)
  expect(screen.getByRole('button', { name: kind === 'source' ? '保存实现' : '校验并应用' })).not.toBeDisabled()
  expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] })
  expect(h.session.read().undoDepth).toBe(0)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: kind === 'source' ? '保存实现' : '校验并应用' })))
  await waitFor(() => expect(h.lifecycle.preserve(h.session.documentId)).toEqual([]))
  expect(h.session.read().undoDepth).toBe(1)
})

it.each(['source', 'json'] as const)('parks hidden %s input even when its panel remains mounted', async kind => {
  const h = await fixture(), content = kind === 'source' ? <Source bridge={h.bridge} /> : <Json bridge={h.bridge} />
  const editor = render(<div>{content}</div>), label = kind === 'source' ? '组件实现源码' : 'Object JSON'
  const raw = kind === 'source' ? 'export default { value: 41 };'
    : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Hidden draft' } })
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: raw } })
  editor.rerender(<div hidden>{content}</div>)
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] }))
  expect(h.session.read().undoDepth).toBe(0)
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
  editor.rerender(<div>{content}</div>)
  expect(screen.getByRole('textbox', { name: label })).toHaveValue(raw)
})

it('keeps a late A baseline refresh parked after its source panel has moved to B', async () => {
  const h = await fixture()
  render(<Source bridge={h.bridge} scope="instance" />)
  const raw = 'export default { value: 42 };'
  let count = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const resolver = vi.fn(async () => { if (++count === 1) return 'pending' as const; await held; return 'ready' as const })
  vi.spyOn(h.bridge, 'editCaptured').mockRejectedValueOnce(new CourseComponentUnknownError('ACK unavailable', 'original-operation', resolver))
  fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: raw } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存实现' })))
  await waitFor(() => expect(resolver).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '载入当前基线并保留草稿' }))
  await waitFor(() => expect(resolver).toHaveBeenCalledTimes(2))
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['b'], 'page'))
  await act(async () => { release(); await held })
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue('export default { value: 1 };')
  await act(async () => expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] }))
  expect(h.session.read().undoDepth).toBe(0)
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['a'], 'page'))
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue(raw)
})

it.each(['source', 'json'] as const)('keeps the live A %s composition DOM until its real end after the target changes to B', async kind => {
  const h = await fixture()
  render(kind === 'source' ? <Source bridge={h.bridge} scope="instance" /> : <Json bridge={h.bridge} />)
  const label = kind === 'source' ? '组件实现源码' : 'Object JSON', area = screen.getByRole('textbox', { name: label })
  const raw = kind === 'source' ? 'export default { value: 51 };'
    : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Live composition' } })
  fireEvent.compositionStart(area)
  fireEvent.change(area, { target: { value: raw } })
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['b'], 'page'))
  expect(screen.getByRole('textbox', { name: label })).toBe(area)
  expect(area).toHaveValue(raw)
  expect(await h.lifecycle.prepare(h.session.documentId, 'preserve')).toMatchObject({ ready: false })
  expect(h.session.read().undoDepth).toBe(0)
  fireEvent.compositionEnd(area)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)) })
  expect(h.bridge.read().selectedInstanceId).toBe('b')
  expect(await h.lifecycle.prepare(h.session.documentId)).toEqual({ ready: true, issues: [] })
  expect(h.session.read().undoDepth).toBe(0)
  expect(h.lifecycle.preserve(h.session.documentId)).toHaveLength(1)
  await act(async () => h.bridge.selectInstances(h.session.documentId, ['a'], 'page'))
  expect(screen.getByRole('textbox', { name: label })).toHaveValue(raw)
})

it('executes the current restore request after resolving an earlier source save as applied', async () => {
  const h = await fixture()
  render(<Source bridge={h.bridge} scope="instance" />)
  const originalApply = h.bridge.editCaptured.bind(h.bridge)
  let queried = false
  const resolver = vi.fn(async () => { if (!queried) { queried = true; return 'pending' as const }; return 'applied' as const })
  const dispatch = vi.spyOn(h.bridge, 'editCaptured').mockImplementationOnce(async command => {
    const result = await originalApply(command)
    throw new CourseComponentUnknownError('ACK unavailable', result.operationId, resolver)
  })
  fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export default { value: 61 };' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存实现' })))
  await waitFor(() => expect(resolver).toHaveBeenCalledTimes(1))
  expect(h.bridge.captureTarget().project.instances.a.implementationOverride).toMatchObject({ kind: 'source', source: 'export default { value: 61 };' })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '恢复默认实现' })))
  await waitFor(() => expect(h.bridge.captureTarget().project.instances.a.implementationOverride).toBeUndefined())
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue('export default { value: 1 };')
  expect(h.bridge.captureTarget().project.instances.b.implementationOverride).toBeUndefined()
  expect(h.session.read().undoDepth).toBe(2)
  expect(dispatch).toHaveBeenCalledTimes(2)
})

it('accepts a proved applied restore without replaying it or treating the removed override as pending source', async () => {
  const h = await fixture()
  render(<Source bridge={h.bridge} scope="instance" />)
  fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export default { value: 71 };' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存实现' })))
  await waitFor(() => expect(h.bridge.captureTarget().project.instances.a.implementationOverride).toBeDefined())
  const originalApply = h.bridge.editCaptured.bind(h.bridge)
  const dispatch = vi.spyOn(h.bridge, 'editCaptured').mockImplementationOnce(async command => {
    const result = await originalApply(command)
    throw new CourseComponentUnknownError('restore ACK unavailable', result.operationId, async () => 'applied')
  })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '恢复默认实现' })))
  await waitFor(() => expect(h.lifecycle.preserve(h.session.documentId)).toEqual([]))
  expect(h.bridge.captureTarget().project.instances.a.implementationOverride).toBeUndefined()
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue('export default { value: 1 };')
  expect(screen.queryByText(/未应用：restore ACK/)).not.toBeInTheDocument()
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(h.session.read().undoDepth).toBe(2)
})

it('consumes a proved applied dependency COW edit by its stable source path without changing the shared module or B', async () => {
  const h = await fixture(), bytes = (text: string) => new TextEncoder().encode(text)
  const original = 'export const value = 81;', changed = 'export const value = 82; // 原稿字节'
  await h.bridge.edit([
    { type: 'component.files.set', ownerId: 'dependency-code', expectedFiles: null,
      files: { 'main.js': bytes(original), 'opaque.bin': new Uint8Array([0, 255, 128]) } },
    { type: 'definition.set', definition: { id: 'dependency', title: 'Shared dependency', role: 'mixed', implementation: {
      kind: 'source', language: 'javascript', workspace: { ownerId: 'dependency-code', entry: 'main.js' } } } },
    { type: 'definition.set', definition: { ...h.bridge.captureTarget().project.definitions.custom,
      implementation: { kind: 'source', language: 'javascript', source: "import { value } from './dependency'; export default { value };",
        moduleBindings: { './dependency': 'dependency' } } } },
  ])
  const baseline = h.bridge.captureTarget(), undoDepth = h.session.read().undoDepth
  render(<Source bridge={h.bridge} scope="instance" />)
  fireEvent.change(screen.getByRole('combobox', { name: '组件源码模块' }), { target: { value: 'dependency' } })
  await waitFor(() => expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue(original))
  const apply = h.bridge.editCaptured.bind(h.bridge)
  const dispatch = vi.spyOn(h.bridge, 'editCaptured').mockImplementationOnce(async command => {
    const result = await apply(command)
    throw new CourseComponentUnknownError('dependency ACK unavailable', result.operationId, async () => 'applied')
  })
  fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: changed } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存实现' })))
  await waitFor(() => expect(h.lifecycle.preserve(h.session.documentId)).toEqual([]))
  const current = h.bridge.captureTarget(), implementation = current.project.instances.a.implementationOverride
  if (implementation?.kind !== 'source') throw new Error('Expected the private author root')
  const moduleId = implementation.moduleBindings!['./dependency']
  expect(moduleId).not.toBe('dependency')
  const dependency = current.project.definitions[moduleId].implementation
  if (dependency.kind !== 'source' || !dependency.workspace) throw new Error('Expected the private dependency workspace')
  expect(current.resources.components[dependency.workspace.ownerId]['main.js']).toEqual(bytes(changed))
  expect(Array.from(current.resources.components[dependency.workspace.ownerId]['opaque.bin'])).toEqual([0, 255, 128])
  expect(current.resources.components['dependency-code']['main.js']).toEqual(bytes(original))
  expect(current.project.definitions.custom).toEqual(baseline.project.definitions.custom)
  expect(current.project.definitions.dependency).toEqual(baseline.project.definitions.dependency)
  expect(current.project.instances.b).toEqual(baseline.project.instances.b)
  expect(screen.getByRole('combobox', { name: '组件源码模块' })).toHaveValue(moduleId)
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue(changed)
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(h.session.read().undoDepth).toBe(undoDepth + 1)
})
