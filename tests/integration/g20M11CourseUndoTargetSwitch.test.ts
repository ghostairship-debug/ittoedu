// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseStoreHost } from '../helpers/courseStoreHost'

it('M11 rejects a recent-AI undo for A when B becomes active while A is draining', async () => {
  const host = await createCourseStoreHost()
  const store = () => useEditorStore.getState()
  const a = await host.open(createBlankCourseProject({ title: 'A', includeDefaultController: false, controls: 'none' }))
  const aiTitle = async (documentId: string, value: string, operationId: string) => {
    const before = host.registry.get(documentId).read()
    if (before.model.kind !== 'course-v9') throw new Error('Course fixture required')
    expect((await host.api.dispatch({ documentId, epoch: before.epoch, baseRevision: before.revision,
      actor: 'agent', operationId, mutation: { type: 'command', command: {
        type: 'course.replace', project: { ...before.model.project, title: value }, resources: before.model.resources,
      } } })).status).toBe('applied')
  }
  await aiTitle(a.documentId, 'AI A', 'ai-a')
  const b = await host.open(createBlankCourseProject({ title: 'B', includeDefaultController: false, controls: 'none' }))
  await aiTitle(b.documentId, 'AI B', 'ai-b')
  await store().openCourseDocument('course-store-1.h5lesson')
  await vi.waitFor(() => expect(store().courseDocument.snapshot?.undoHead)
    .toEqual({ operationId: 'ai-a', actor: 'agent' }))
  const beforeA = host.registry.get(a.documentId).read()
  const beforeB = host.registry.get(b.documentId).read()

  const read = host.api.read.bind(host.api)
  let signalRead!: () => void
  let releaseRead!: () => void
  const entered = new Promise<void>(resolve => { signalRead = resolve })
  const gate = new Promise<void>(resolve => { releaseRead = resolve })
  let held = false
  host.api.read = async documentId => {
    if (documentId === a.documentId && !held) {
      held = true
      signalRead()
      await gate
    }
    return read(documentId)
  }
  try {
    const undo = store().undoLatestAgentCourseDocument()
    await entered
    await store().openCourseDocument('course-store-2.h5lesson')
    expect(store().courseDocument.documentId).toBe(b.documentId)
    releaseRead()
    await expect(undo).rejects.toThrow('撤销目标文档已切换或变化')
    expect(host.registry.get(a.documentId).read()).toMatchObject({
      revision: beforeA.revision, undoDepth: beforeA.undoDepth, undoHead: beforeA.undoHead, model: beforeA.model,
    })
    expect(host.registry.get(b.documentId).read()).toMatchObject({
      revision: beforeB.revision, undoDepth: beforeB.undoDepth, undoHead: beforeB.undoHead, model: beforeB.model,
    })
  } finally {
    releaseRead()
    host.api.read = read
  }
})

it('M11 reports a rejected recent-AI undo receipt without showing success', async () => {
  const host = await createCourseStoreHost()
  const store = () => useEditorStore.getState()
  const opened = await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  const beforeAi = host.registry.get(opened.documentId).read()
  if (beforeAi.model.kind !== 'course-v9') throw new Error('Course fixture required')
  expect((await host.api.dispatch({ documentId: opened.documentId, epoch: beforeAi.epoch,
    baseRevision: beforeAi.revision, actor: 'agent', operationId: 'ai-a',
    mutation: { type: 'command', command: { type: 'course.replace',
      project: { ...beforeAi.model.project, title: 'AI A' }, resources: beforeAi.model.resources } } })).status).toBe('applied')
  await vi.waitFor(() => expect(store().courseDocument.snapshot?.undoHead)
    .toEqual({ operationId: 'ai-a', actor: 'agent' }))
  const beforeUndo = host.registry.get(opened.documentId).read()
  const dispatch = host.api.dispatch.bind(host.api)
  host.api.dispatch = async operation => operation.mutation.type === 'undo'
    ? { status: 'conflict', documentId: operation.documentId, operationId: operation.operationId,
      code: 'history-head-changed', message: '最近一次 AI 操作已变化', applied: false }
    : dispatch(operation)
  try {
    expect(await store().undoLatestAgentCourseDocument()).toBe(false)
    expect(store().errorMessage).toContain('最近一次 AI 操作已变化')
    expect(store().statusMessage).not.toBe('已撤销')
    expect(host.registry.get(opened.documentId).read()).toMatchObject({
      revision: beforeUndo.revision, undoDepth: beforeUndo.undoDepth, model: beforeUndo.model,
    })
  } finally {
    host.api.dispatch = dispatch
  }
})
