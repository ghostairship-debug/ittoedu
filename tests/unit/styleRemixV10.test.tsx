import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { TEXT_DEFINITION, createTextComponentData, textComponentDataSchema, textDataEdit } from '../../src/components/text'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createDesignProductionActions } from '../../src/renderer/composition/designProductionActions'
import { applyStyleRemix, previewStyleRemix } from '../../src/renderer/authoring/productivity/styleRemix'
import type { DesignProductionStep } from '../../src/renderer/authoring/productivity'
import { ProductivityDialog } from '../../src/renderer/ui/productivity/ProductivityDialog'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

const dispose: Array<() => Promise<void>> = []
afterEach(async () => {
  cleanup()
  for (const action of dispose.splice(0).reverse()) await action()
  vi.unstubAllGlobals()
})
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function authoredContent(project: CourseProjectV10) {
  const { revision: _revision, ...content } = project
  return content
}

async function fixture(mixedFormula = false) {
  // The real Main journal owns bytes in the Node realm; jsdom supplies the UI.
  vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor)
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-r4-remix-'))
  dispose.push(() => rm(directory, { recursive: true, force: true }))
  let serial = 0
  const project = createBlankCourseProjectV10('样板改写', () => `remix-${++serial}`)
  const surface = project.surfaces[0]!
  surface.title = '格式化参考页'
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, name: '课题',
    data: JSON.parse(JSON.stringify(createTextComponentData({ inlines: [
      { type: 'text', text: '旧头' }, { type: 'text', text: '强调', style: { bold: true } },
      { type: 'text', text: '保留', style: { italic: true } }, { type: 'text', text: '旧尾' },
    ] }))), frame: { width: 300, height: 70, transform: [1, .2, .3, 1, 35, 42] } }
  surface.childIds.push('text')
  if (mixedFormula) {
    project.instances.mixed = { id: 'mixed', definitionId: TEXT_DEFINITION.id, name: '混合公式',
      data: JSON.parse(JSON.stringify(createTextComponentData({ inlines: [
        { type: 'text', text: '保留公式' }, { type: 'math', formulaId: 'math-a', latex: 'x^{2}', accessibleText: 'x平方' },
      ] }))), frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 400, 42] } }
    surface.childIds.push('mixed')
  }
  project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义不作样板', childIds: [] })
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '样板.h5lesson')
  const unavailable = async (): Promise<never> => { throw new Error('This fixture has no native dialogs') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(),
    saveWithDialog: unavailable, close: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
    subscribe: listener => host.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge()
  dispose.push(async () => { bridge.dispose() })
  await bridge.connect(api)
  const kernel = createEditorStoreKernel({ bridge, commit: vi.fn() })
  const actions = createDesignProductionActions({ kernel })
  const context = actions.readDesignProductionContext(initial.documentId)
  if (!context) throw new Error('Expected captured V10 context')
  return { project, surface, host, bridge, kernel, actions, context, documentId: initial.documentId }
}

function fillRemix(surfaceId: string, replacement = '新头强调保留新尾') {
  fireEvent.change(screen.getByLabelText('生产力操作'), { target: { value: 'remix' } })
  expect(screen.queryByRole('option', { name: '讲义不作样板' })).toBeNull()
  fireEvent.change(screen.getByLabelText('样板来源'), { target: { value: surfaceId } })
  expect(screen.getByLabelText('替换槽位 课题')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('替换槽位 课题'), { target: { value: replacement } })
  fireEvent.click(screen.getByRole('button', { name: '预览样板改写' }))
}

it('selects a V10 formatted reference, awaits its captured ACK and creates one editable, undoable archive copy', async () => {
  const current = await fixture(true), before = structuredClone(current.context.document), ack = deferred<boolean>()
  const onClose = vi.fn()
  const onCommit = vi.fn(async (step: DesignProductionStep) => await ack.promise && current.actions.commitDesignProduction(step))
  render(<ProductivityDialog getContext={() => current.context} getAssetFiles={() => ({})} onCommit={onCommit} onClose={onClose} />)
  fillRemix(current.surface.id)
  expect(screen.getByText('混合公式：保留公式混排，请在原页局部精修')).toBeVisible()
  const commit = screen.getByRole('button', { name: '确认新增改写页' })
  expect(commit).toBeEnabled()
  fireEvent.click(commit)
  fireEvent.click(commit)
  expect(onCommit).toHaveBeenCalledOnce()
  expect(commit).toBeDisabled()
  expect(screen.getByLabelText('生产力操作')).toBeDisabled()
  const cancel = screen.getByRole('button', { name: '取消' })
  expect(cancel).toBeDisabled()
  fireEvent.click(cancel)
  expect(onClose).not.toHaveBeenCalled()
  expect(current.host.registry.get(current.documentId).read()).toMatchObject({ revision: before.revision, undoDepth: 0 })
  // A later browsing focus does not retarget the submitted operation or ACK.
  await act(async () => { await current.bridge.create() })
  const otherDocumentId = current.bridge.read().activeDocumentId
  await act(async () => { ack.resolve(true); await onCommit.mock.results[0]!.value })
  expect(onClose).toHaveBeenCalledOnce()
  expect(current.bridge.read().activeDocumentId).toBe(otherDocumentId)
  expect(onCommit.mock.calls[0]![0]).toMatchObject({ documentId: current.documentId, epoch: current.context.target.epoch })
  const snapshot = current.host.registry.get(current.documentId).read()
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  const next = snapshot.model.project, copySurface = next.surfaces[1]!, copy = next.instances[copySurface.childIds[0]!]!
  expect(copy.id).not.toBe('text')
  expect(copy.frame).toEqual(before.instances.text!.frame)
  expect(textComponentDataSchema.parse(copy.data).content.inlines).toEqual([
    { type: 'text', text: '新头' }, { type: 'text', text: '强调', style: { bold: true } },
    { type: 'text', text: '保留', style: { italic: true } }, { type: 'text', text: '新尾' },
  ])
  expect(next.surfaces[0]).toEqual(before.surfaces[0])
  expect(next.instances.text).toEqual(before.instances.text)
  expect(next.instances[copySurface.childIds[1]!]!.data).toEqual(before.instances.mixed!.data)
  expect(snapshot).toMatchObject({ revision: before.revision + 1, undoDepth: 1 })
  const driver = new CourseV10Driver()
  expect(driver.load(driver.serialize(snapshot.model))).toEqual(snapshot.model)
  await current.bridge.undo(current.documentId)
  const undone = current.host.registry.get(current.documentId).read()
  if (undone.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(authoredContent(undone.model.project)).toEqual(authoredContent(before))
  expect(undone.undoDepth).toBe(0)
  await current.bridge.redo(current.documentId)
  const data = createTextComponentData('副本继续编辑')
  await current.kernel.editCaptured(current.kernel.capture([textDataEdit(copy.id, data)], current.kernel.captureTarget(current.documentId)))
  const edited = current.host.registry.get(current.documentId).read()
  if (edited.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(textComponentDataSchema.parse(edited.model.project.instances[copy.id]!.data)).toEqual(data)
  expect(edited.model.project.instances.text).toEqual(before.instances.text)
  expect(current.context.document).toEqual(before)
})

it.each(['false', 'reject'])('retains the reference, replacement and preview after a deferred %s ACK', async outcome => {
  const current = await fixture(), ack = deferred<boolean>(), onClose = vi.fn(), onCommit = vi.fn(() => ack.promise)
  render(<ProductivityDialog getContext={() => current.context} getAssetFiles={() => ({})} onCommit={onCommit} onClose={onClose} />)
  fillRemix(current.surface.id)
  const commit = screen.getByRole('button', { name: '确认新增改写页' })
  fireEvent.click(commit); fireEvent.click(commit)
  expect(onCommit).toHaveBeenCalledOnce()
  expect(commit).toBeDisabled()
  expect(screen.getByLabelText('样板来源')).toBeDisabled()
  expect(screen.getByLabelText('替换槽位 课题')).toBeDisabled()
  expect(screen.getByLabelText('生产力操作')).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { if (outcome === 'false') ack.resolve(false); else ack.reject(new Error('正式提交失败')) })
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('样板来源')).toHaveValue(current.surface.id)
  expect(screen.getByLabelText('替换槽位 课题')).toHaveValue('新头强调保留新尾')
  expect(screen.getByText('骨架来源：格式化参考页')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent(outcome === 'false' ? '未能提交' : '正式提交失败')
  expect(commit).toBeEnabled()
  expect(screen.getByLabelText('生产力操作')).toBeEnabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
  expect(current.host.registry.get(current.documentId).read()).toMatchObject({ revision: current.context.document.revision, undoDepth: 0 })
})

it('keeps the source unchanged for missing or stale slots and allows long replacement content with the original frame', async () => {
  const { context, surface } = await fixture(), before = structuredClone(context.document)
  const empty = previewStyleRemix(context, surface.id, {})
  expect(empty.slots[0]!.issue).toBe('请填写此槽位')
  expect(applyStyleRemix(context, empty).ok).toBe(false)
  expect(() => previewStyleRemix(context, surface.id, { removed: '不存在' })).toThrow('已不存在')
  const slot = empty.slots[0]!
  expect(slot).toMatchObject({ instanceId: 'text', dataPath: ['content'], original: '旧头强调保留旧尾' })
  const preview = previewStyleRemix(context, surface.id, { [slot.id]: '新头强调保留新尾' })
  expect(preview.issues).toEqual([])
  expect(preview.slots[0]!.issue).toBeUndefined()
  expect(applyStyleRemix({ ...context, target: { ...context.target, epoch: 'retired-epoch' } }, preview).ok).toBe(false)
  const changed = structuredClone(context)
  changed.document.instances.text!.data = JSON.parse(JSON.stringify(createTextComponentData('已人工修改')))
  expect(applyStyleRemix(changed, preview).ok).toBe(false)
  const long = previewStyleRemix(context, surface.id, { [slot.id]: '新'.repeat(150) + '头强调保留旧尾' })
  const result = applyStyleRemix(context, long)
  if (!result.ok || !result.step) throw new Error(result.ok ? 'Expected clone step' : result.reason)
  const inserted = result.step.edits.find(edit => edit.type === 'instance.insert')
  if (inserted?.type !== 'instance.insert') throw new Error('Expected editable instances')
  expect(inserted.instances[0]!.frame).toEqual(before.instances.text!.frame)
  expect(context.document).toEqual(before)
})
