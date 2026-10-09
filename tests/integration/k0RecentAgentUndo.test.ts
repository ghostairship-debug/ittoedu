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
import type { DocumentOperationResult, DocumentSnapshot } from '../../src/shared/workbench/document'

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
    close: async (id, discardDirty) => { await host.operate({ type: 'close', documentId: id, discardDirty }) },
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
  await state.courseKernel.navigateHistory('redo')
  const humanHead = await host.internalAPI.read(documentId)
  await expect(state.undoLatestAgentCourseDocument()).resolves.toBe(false)
  expect(await host.internalAPI.read(documentId)).toEqual(humanHead)
  await state.courseKernel.navigateHistory('undo')
  expect(await state.undoLatestAgentCourseDocument()).toBe(true)
  expect(state.courseBridge.read().project!.title).toBe('原始标题')
  await state.courseKernel.navigateHistory('redo')
  expect(state.courseBridge.read().snapshot?.undoHead?.actor).toBe('agent')
  expect(state.courseBridge.read().project!.title).toBe('AI 标题')
  expect(await state.undoLatestAgentCourseDocument()).toBe(true)
  expect(state.courseBridge.read().project!.title).toBe('原始标题')
})

it('rejects a captured AI undo when the user switches documents during the local drain', async () => {
  const { state, documentId, host, api } = await fixture()
  await state.createCourseDocumentFrom(createBlankCourseProjectV10('文档 B'))
  const documentB = state.courseBridge.read().activeDocumentId!
  await state.addTextNode()
  const selectedB = state.courseBridge.read().selectedInstanceId!
  const initialB = await host.internalAPI.read(documentB)
  if (initialB.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect((await host.internalAPI.dispatch({ documentId: documentB, epoch: initialB.epoch, baseRevision: initialB.revision,
    actor: 'agent', operationId: 'agent-b', mutation: { type: 'command', command: captureComponentOperation(initialB.model.project,
      [{ type: 'project.title.set', title: 'AI B' }]) } })).status).toBe('applied')
  await vi.waitFor(() => expect(state.courseBridge.read().snapshot?.undoHead?.operationId).toBe('agent-b'))
  await state.courseBridge.activate(documentId)
  const beforeA = await host.internalAPI.read(documentId), beforeB = await host.internalAPI.read(documentB)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const read = api.read.bind(api); let held = false
  api.read = async id => { if (id === documentId && !held) { held = true; entered(); await gate }; return read(id) }
  const undo = state.undoLatestAgentCourseDocument()
  await started; await state.courseBridge.activate(documentB); release()
  await expect(undo).rejects.toThrow('已切换文档')
  expect(await host.internalAPI.read(documentId)).toEqual(beforeA)
  expect(await host.internalAPI.read(documentB)).toEqual(beforeB)
  expect(state.courseBridge.read().activeDocumentId).toBe(documentB)
  expect(state.courseBridge.read().selectedInstanceIds).toEqual([selectedB])
})

it('refuses an AI undo overtaken by a real human commit, keeps that History intact and allows a later normal undo', async () => {
  const { state, api, host, documentId } = await fixture()
  const before = await host.internalAPI.read(documentId), dispatch = api.dispatch.bind(api)
  let interrupted = false, concurrent: DocumentSnapshot | undefined, receipt: DocumentOperationResult | undefined
  api.dispatch = async operation => {
    if (operation.mutation.type === 'undo' && !interrupted) {
      interrupted = true
      const current = await host.internalAPI.read(documentId)
      if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
      expect((await dispatch({ documentId, epoch: current.epoch, baseRevision: current.revision, actor: 'human', operationId: 'concurrent-human',
        mutation: { type: 'command', command: captureComponentOperation(current.model.project, [{ type: 'project.title.set', title: '正式人工改稿' }]) } })).status).toBe('applied')
      concurrent = await host.internalAPI.read(documentId)
    }
    const result = await dispatch(operation)
    if (operation.mutation.type === 'undo') receipt = result
    return result
  }
  await expect(state.undoLatestAgentCourseDocument()).rejects.toThrow(/版本|revision|已变化|已改变/)
  expect(receipt).toMatchObject({ status: 'conflict', code: 'stale-revision', applied: false })
  expect(await host.internalAPI.read(documentId)).toEqual(concurrent)
  expect(concurrent?.revision).toBe(before.revision + 1); expect(concurrent?.undoDepth).toBe(before.undoDepth + 1)
  expect(state.courseBridge.read().project!.title).toBe('正式人工改稿')
  expect(useEditorStore.getState().statusMessage).not.toBe('已撤销')
  await state.courseKernel.navigateHistory('undo')
  expect(state.courseBridge.read().project!.title).toBe('AI 标题')
  expect(await state.undoLatestAgentCourseDocument()).toBe(true)
  expect(state.courseBridge.read().project!.title).toBe('原始标题')
})
