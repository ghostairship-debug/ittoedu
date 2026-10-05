// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const directories: string[] = []
afterEach(async () => {
  useEditorStore.getState().cancelTextEdit()
  useEditorStore.getState().courseBridge.dispose()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'k0-agent-undo-')); directories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(),
    saveWithDialog: id => host.internalAPI.save(id, path.join(directory, 'course.h5lesson')),
    closeWithDialog: async id => { await host.operate({ type: 'close', documentId: id }); return true },
    discardRecovery: async id => { await host.operate({ type: 'discard-recovery', documentId: id }) },
    subscribe: listener => host.subscribeEvents(listener) }
  await useEditorStore.getState().connectCourseDocuments(api)
  await useEditorStore.getState().createCourseDocumentFrom(createBlankCourseProjectV10('原始标题'))
  const state = useEditorStore.getState(), documentId = state.courseView.activeDocumentId!
  await state.addTextNode()
  const textId = state.courseBridge.read().selectedInstanceId!
  const before = await host.internalAPI.read(documentId)
  if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
  await host.internalAPI.dispatch({ documentId, epoch: before.epoch, baseRevision: before.revision, actor: 'agent', operationId: 'agent-title',
    mutation: { type: 'command', command: captureComponentOperation(before.model.project, [{ type: 'project.title.set', title: 'AI 标题' }]) } })
  await vi.waitFor(() => expect(state.courseBridge.read().snapshot?.undoHead?.operationId).toBe('agent-title'))
  return { host, api, state, documentId, textId }
}

it('flushes human input and refuses to cross its new History head when undoing the captured AI edit', async () => {
  const { state, documentId, textId, host } = await fixture()
  const original = structuredClone(state.courseBridge.read().project!.instances[textId].data)
  state.beginTextEdit(textId, 'canvas'); state.updateTextEditDraft(textId, '必须保全的输入', [])
  await expect(state.undoLatestAgentCourseDocument()).rejects.toThrow('最近一次操作不是 AI 修改')
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
  expect(state.courseBridge.read().project!.instances[textId].data).toMatchObject({ content: { inlines: [{ text: '必须保全的输入' }] } })
  expect((await host.internalAPI.read(documentId)).undoHead?.actor).toBe('human')
  expect(state.courseBridge.read().project!.title).toBe('AI 标题')
  await state.courseKernel.navigateHistory('undo')
  expect(state.courseBridge.read().project!.instances[textId].data).toEqual(original)
  await state.courseKernel.navigateHistory('undo')
  expect(state.courseBridge.read().project!.title).toBe('原始标题')
})

it('rejects a captured AI undo when the user switches documents during the local drain', async () => {
  const { state, documentId, host, api } = await fixture()
  await state.createCourseDocumentFrom(createBlankCourseProjectV10('文档 B'))
  const documentB = state.courseBridge.read().activeDocumentId!
  await state.courseBridge.activate(documentId)
  const beforeA = await host.internalAPI.read(documentId), beforeB = await host.internalAPI.read(documentB)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const read = api.read.bind(api); let held = false
  api.read = async id => { if (id === documentId && !held) { held = true; entered(); await gate }; return read(id) }
  const undo = state.undoLatestAgentCourseDocument()
  await started; await state.courseBridge.activate(documentB); release()
  await expect(undo).rejects.toThrow('已切换文档')
  expect((await host.internalAPI.read(documentId)).revision).toBe(beforeA.revision)
  expect((await host.internalAPI.read(documentB)).revision).toBe(beforeB.revision)
})

it('reports a rejected formal AI undo receipt instead of returning success', async () => {
  const { state, api, host, documentId } = await fixture()
  const before = await host.internalAPI.read(documentId), dispatch = api.dispatch.bind(api)
  api.dispatch = async operation => operation.mutation.type === 'undo'
    ? { status: 'conflict', documentId, operationId: operation.operationId, code: 'history-head-changed', message: '最近一次 AI 操作已变化', applied: false }
    : dispatch(operation)
  await expect(state.undoLatestAgentCourseDocument()).rejects.toThrow('最近一次 AI 操作已变化')
  expect((await host.internalAPI.read(documentId)).revision).toBe(before.revision)
})
