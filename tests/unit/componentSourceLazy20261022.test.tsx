import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CourseV10DocumentBridge, CourseV10ViewState } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

const builtin = vi.hoisted(() => ({ ready: false, attempts: 0, finish: undefined as (() => void) | undefined }))
vi.mock('../../src/core/components/source/builtinSources', () => ({
  hasBuiltinComponentSource: () => builtin.ready,
  getBuiltinComponentSource: () => {
    if (!builtin.ready) throw new Error('尚未准备源码')
    return { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' }
  },
  loadBuiltinComponentSource: async () => {
    builtin.attempts++
    if (builtin.attempts === 1) throw new Error('temporary source error')
    await new Promise<void>(resolve => { builtin.finish = () => { builtin.ready = true; resolve() } })
    return { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' }
  },
}))
import { ComponentSourceEditor } from '../../src/renderer/components/ComponentSourceEditor'
import { courseDraftLifecycle } from '../../src/renderer/authoring/courseDraftLifecycle'

afterEach(() => { cleanup(); builtin.ready = false; builtin.attempts = 0; builtin.finish = undefined })

it('keeps an unprepared builtin source read-only, reports loading failure, and displays the real author entry after retry', async () => {
  const project: CourseProjectV10 = { schemaVersion: 11, id: 'work', title: 'Work', revision: 0,
    rootIds: ['text'], definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
    instances: { text: { id: 'text', definitionId: 'text', data: { text: '原文' } } }, assets: {}, global: { underlay: [], overlay: [] } }
  const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
  const view = { activeDocumentId: 'document', documents: [{ documentId: 'document', epoch: 'epoch', model }],
    views: [{ documentId: 'document', model }] } as unknown as CourseV10ViewState
  const bridge = { read: () => view, subscribe: () => () => {}, captureTarget: vi.fn() } as unknown as CourseV10DocumentBridge
  render(<ComponentSourceEditor bridge={bridge} instance={project.instances.text} implementation={project.definitions.text.implementation} report={vi.fn()} />)
  await screen.findByText(/源码加载未完成：temporary source error/)
  expect(screen.getByLabelText('组件实现源码')).toHaveAttribute('readonly')
  fireEvent.click(screen.getByRole('button', { name: '重试加载' }))
  await waitFor(() => expect(builtin.finish).toBeTypeOf('function'))
  expect(screen.getByText(/正在加载 guoling.text 的完整源码/)).toBeInTheDocument()
  await act(async () => { builtin.finish!(); await Promise.resolve() })
  await waitFor(() => expect(screen.getByLabelText('组件实现源码')).not.toHaveAttribute('readonly'))
  expect((screen.getByLabelText('组件实现源码') as HTMLTextAreaElement).value).toContain("import implementation from './implementation'")
  expect(bridge.captureTarget).not.toHaveBeenCalled()
})

it('shows preserved pending input when its builtin became ready while the source panel was closed', async () => {
  builtin.ready = true
  const project: CourseProjectV10 = { schemaVersion: 11, id: 'recovery-work', title: 'Work', revision: 0,
    rootIds: ['text'], definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
    instances: { text: { id: 'text', definitionId: 'text', data: { text: '原文' } } }, assets: {}, global: { underlay: [], overlay: [] } }
  const resources = { assets: {}, components: {} }, model = { kind: 'course-v10' as const, project, resources }
  const view = { activeDocumentId: 'recovery-document', documents: [{ documentId: 'recovery-document', epoch: 'epoch', model }],
    views: [{ documentId: 'recovery-document', model }] } as unknown as CourseV10ViewState
  const capture = () => ({ documentId: 'recovery-document', epoch: 'epoch', project, editingProject: project, resources,
    surfaceId: null, activeStateId: null, instanceIds: ['text'], instanceId: 'text' })
  const bridge = { read: () => view, subscribe: () => () => {}, captureTarget: capture, captureOwnedTarget: capture } as unknown as CourseV10DocumentBridge
  const show = () => render(<ComponentSourceEditor bridge={bridge} instance={project.instances.text} implementation={project.definitions.text.implementation} report={vi.fn()} />)
  const first = show()
  fireEvent.change(screen.getByLabelText('组件实现源码'), { target: { value: 'export default { marker: "preserved-input" }' } })
  const lifecycle = courseDraftLifecycle(bridge), records = lifecycle.preserve('recovery-document')
  expect(records).toHaveLength(1)
  first.unmount()
  lifecycle.release('recovery-document')
  builtin.ready = false
  lifecycle.restore('recovery-document', records)
  expect(lifecycle.hasDirty('recovery-document')).toBe(true)
  builtin.ready = true
  show()
  await waitFor(() => expect((screen.getByLabelText('组件实现源码') as HTMLTextAreaElement).value).toBe('export default { marker: "preserved-input" }'))
  expect(screen.getByText('已恢复源码原输入；尚未自动应用。')).toBeInTheDocument()
})
