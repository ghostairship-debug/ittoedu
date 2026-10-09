import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentHostService } from '@/main/workbench/DocumentHostService'
import { useEditorStore } from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { flushPropertiesDrafts } from '@/renderer/ui/properties/PropertyControls'
import { defaultShapeData, SHAPE_DEFINITION } from '@/components/shape'
import type { CourseProjectV10 } from '@/shared/contracts/component-platform/project'
import type { DocumentHostAPI } from '@/shared/workbench/desktop'

const frame = { width: 384, height: 172, transform: [.8, .6, -.6, .8, 41, 67] as [number, number, number, number, number, number] }
async function host(selected = 'custom') {
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'r1-ack', title: '属性 ACK', revision: 0,
    definitions: { [SHAPE_DEFINITION.id]: SHAPE_DEFINITION, custom: { id: 'custom', role: 'content',
      implementation: { kind: 'source', language: 'javascript', source: 'export default {}' },
      dataSchema: { type: 'object', properties: { title: { type: 'string', title: '专业标题' },
        count: { type: 'number', title: '专业数量' }, payload: { type: 'array', title: '专业结构' } } } } },
    instances: { shape: { id: 'shape', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData(), frame },
      custom: { id: 'custom', definitionId: 'custom', data: { title: '人工标题', count: 3, payload: [1] },
        frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 20, 30] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '页面', childIds: ['shape', 'custom'] }],
    global: { underlay: [], overlay: [] }, assets: {} }
  const service = new DocumentHostService(await mkdtemp(join(tmpdir(), 'r1-properties-ack-')))
  const first = await service.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'ACK.h5lesson')
  const noDialog = async (): Promise<never> => { throw new Error('unit test has no native dialog') }
  const api: DocumentHostAPI = { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(),
    saveWithDialog: noDialog, close: noDialog, closeWithDialog: noDialog, discardRecovery: noDialog,
    subscribe: listener => service.subscribeEvents(listener) }
  await useEditorStore.getState().connectCourseDocuments(api)
  useEditorStore.getState().selectNode(selected)
  render(<PropertiesTab onReplaceImage={() => {}} />)
  return { service, first }
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useEditorStore.getState().courseBridge.dispose() })

for (const [label, draft, path, expected] of [
  ['专业标题', '保留人工输入', 'title', '保留人工输入'],
  ['专业数量', '9', 'count', 9],
  ['专业结构', '[1,2]', 'payload', [1, 2]],
] as const) it(`actual PropertiesTab ${label} waits for ACK, preserves rejected draft and retries the same formal owner`, async () => {
  const h = await host(), kernel = useEditorStore.getState().courseKernel
  const original = kernel.editCaptured.bind(kernel), gate = deferred()
  const submit = vi.spyOn(kernel, 'editCaptured').mockImplementationOnce(async (...args) => { await gate.promise; return original(...args) })
  const input = screen.getByLabelText(label)
  fireEvent.focus(input); fireEvent.change(input, { target: { value: draft } }); fireEvent.blur(input)
  let settled = false, flushing!: Promise<boolean>
  await act(async () => { flushing = flushPropertiesDrafts(); void flushing.then(() => { settled = true }); await Promise.resolve() })
  expect(submit).toHaveBeenCalledOnce(); expect(settled).toBe(false); expect(input).toHaveValue(draft)
  if (label === '专业数量') expect(input).toHaveAttribute('aria-valuenow', '9')
  const pending = await h.service.internalAPI.read(h.first.documentId)
  expect(pending.revision).toBe(0); expect(pending.undoDepth).toBe(0)
  await act(async () => { gate.reject(new Error('formal ACK rejected')); expect(await flushing).toBe(false) })
  expect(input).toHaveValue(draft)
  expect(useEditorStore.getState().errorMessage).toBe('formal ACK rejected')
  expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('formal ACK rejected'))).toBe(true)
  const retry = deferred()
  submit.mockImplementationOnce(async (...args) => { await retry.promise; return original(...args) })
  await act(async () => { flushing = flushPropertiesDrafts(); await Promise.resolve() })
  expect(submit).toHaveBeenCalledTimes(2)
  await act(async () => { retry.resolve(); expect(await flushing).toBe(true) })
  const saved = await h.service.internalAPI.read(h.first.documentId)
  expect(saved.model.kind === 'course-v10' && (saved.model.project.instances.custom.data as Record<string, unknown>)[path]).toEqual(expected)
  expect(saved.revision).toBe(1); expect(saved.undoDepth).toBe(1)
  expect(saved.model.kind === 'course-v10' && saved.model.project.instances.shape.frame).toEqual(frame)
  console.log('R1_PROPERTY_ACK_RAW', JSON.stringify({ label, pendingRevision: pending.revision, rejectedDraft: draft,
    retryRevision: saved.revision, undoDepth: saved.undoDepth, formalValue: expected }))
})

it('actual common width waits for ACK and keeps the captured shape after selection changes', async () => {
  const h = await host('shape'), kernel = useEditorStore.getState().courseKernel
  const original = kernel.editCaptured.bind(kernel), gate = deferred()
  const submit = vi.spyOn(kernel, 'editCaptured').mockImplementationOnce(async (...args) => { await gate.promise; return original(...args) })
  const input = screen.getByLabelText('宽')
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '410' } }); fireEvent.blur(input)
  let settled = false, flushing!: Promise<boolean>
  await act(async () => { flushing = flushPropertiesDrafts(); void flushing.then(() => { settled = true }); await Promise.resolve() })
  expect(settled).toBe(false); expect(submit).toHaveBeenCalledOnce()
  act(() => useEditorStore.getState().selectNode('custom'))
  await act(async () => { gate.resolve(); expect(await flushing).toBe(true) })
  const saved = await h.service.internalAPI.read(h.first.documentId)
  expect(saved.model.kind === 'course-v10' && saved.model.project.instances.shape.frame?.width).toBe(410)
  expect(saved.model.kind === 'course-v10' && saved.model.project.instances.custom.frame?.width).toBe(300)
  expect(saved.undoDepth).toBe(1)
  console.log('R1_CAPTURED_ACK_RAW', JSON.stringify({ shapeWidth: 410, neighborWidth: 300, undoDepth: saved.undoDepth }))
})

for (const [label, first, newer, path] of [
  ['专业标题', '已提交输入', '等待期间的新输入', 'title'],
  ['专业数量', '9', '12', 'count'],
] as const) it(`${label} waits for a second ACK when input changes during the first ACK`, async () => {
  const h = await host(), kernel = useEditorStore.getState().courseKernel
  const original = kernel.editCaptured.bind(kernel), gate = deferred(), newerGate = deferred()
  const submit = vi.spyOn(kernel, 'editCaptured')
    .mockImplementationOnce(async (...args) => { await gate.promise; return original(...args) })
    .mockImplementationOnce(async (...args) => { await newerGate.promise; return original(...args) })
  const input = screen.getByLabelText(label)
  fireEvent.focus(input); fireEvent.change(input, { target: { value: first } }); fireEvent.blur(input)
  let settled = false, flushing!: Promise<boolean>
  await act(async () => { flushing = flushPropertiesDrafts(); void flushing.then(() => { settled = true }); await Promise.resolve() })
  fireEvent.change(input, { target: { value: newer } })
  await act(async () => { gate.resolve(); await Promise.resolve() })
  await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  expect(settled).toBe(false)
  expect(input).toHaveValue(newer)
  const earlier = await h.service.internalAPI.read(h.first.documentId)
  expect(earlier.undoDepth).toBe(1)
  expect(earlier.model.kind === 'course-v10' && (earlier.model.project.instances.custom.data as Record<string, unknown>)[path])
    .toEqual(label === '专业数量' ? Number(first) : first)
  await act(async () => { newerGate.resolve(); expect(await flushing).toBe(true) })
  await act(async () => { expect(await flushPropertiesDrafts()).toBe(true) })
  expect(submit).toHaveBeenCalledTimes(2)
  const saved = await h.service.internalAPI.read(h.first.documentId)
  expect(saved.model.kind === 'course-v10' && (saved.model.project.instances.custom.data as Record<string, unknown>)[path])
    .toEqual(label === '专业数量' ? Number(newer) : newer)
  expect(saved.undoDepth).toBe(2)
  console.log('R1_PENDING_INPUT_RAW', JSON.stringify({ label, firstACKFlushComplete: false, latestACKFlushComplete: true, newerInput: newer, undoDepth: saved.undoDepth }))
})

for (const [label, first, composed, path] of [
  ['专业标题', '已提交输入', '下一次中文输入', 'title'],
  ['专业数量', '9', '12', 'count'],
] as const) it(`${label} retains the next composition phase when the earlier ACK arrives before its first change`, async () => {
  const h = await host(), kernel = useEditorStore.getState().courseKernel
  const original = kernel.editCaptured.bind(kernel), gate = deferred()
  vi.spyOn(kernel, 'editCaptured').mockImplementationOnce(async (...args) => { await gate.promise; return original(...args) })
  const input = screen.getByLabelText(label)
  fireEvent.focus(input); fireEvent.change(input, { target: { value: first } }); fireEvent.blur(input)
  let flushing!: Promise<boolean>
  await act(async () => { flushing = flushPropertiesDrafts(); await Promise.resolve() })
  fireEvent.focus(input); fireEvent.compositionStart(input)
  await act(async () => { gate.resolve(); expect(await flushing).toBe(false); expect(await flushPropertiesDrafts()).toBe(false) })
  fireEvent.change(input, { target: { value: composed } }); fireEvent.compositionEnd(input)
  await act(async () => { expect(await flushPropertiesDrafts()).toBe(true) })
  const saved = await h.service.internalAPI.read(h.first.documentId)
  expect(saved.model.kind === 'course-v10' && (saved.model.project.instances.custom.data as Record<string, unknown>)[path])
    .toEqual(label === '专业数量' ? Number(composed) : composed)
  expect(saved.undoDepth).toBe(2)
  console.log('R1_PENDING_IME_RAW', JSON.stringify({ label, earlierACKCompositionFlushComplete: false, composed, undoDepth: saved.undoDepth }))
})
