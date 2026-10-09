import { documentHostAPI } from '../helpers/documentHostAPI'
// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createCourseInputLifecycle } from '../../src/renderer/authoring/courseDraftLifecycle'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { AuthoringDraftRecovery, DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { closeDocumentFlow } from '../../src/main/workbench/documentCloseFlow'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { useEditorStore } from '../../src/renderer/store/editorStore'

const roots: string[] = [], bridges: CourseV10DocumentBridge[] = []
afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.dispose()
  useEditorStore.getState().courseBridge.dispose()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'course-input-lifecycle-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'recovery'), {}, { discardFlowRecovery: async () => {} })
  const project = createBlankCourseProjectV10(), instanceId = project.global.overlay[0]!
  project.instances[instanceId]!.data = { text: '原文' }
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'input.glx')
  const api: DocumentHostAPI = { ...documentHostAPI(host), bootstrapCourse: async () => snapshot }
  const bridge = new CourseV10DocumentBridge(); bridges.push(bridge); await bridge.connect(api)
  let records: AuthoringDraftRecovery = { advanced: [], properties: [] }
  const error = vi.fn(), drain = vi.fn(async () => { await bridge.drain([snapshot.documentId]) })
  const recovery = { preserveFlow: vi.fn(async () => true), suspendFlow: vi.fn(), resumeFlow: vi.fn() }
  const lifecycle = createCourseInputLifecycle(bridge, {
    capture(id) { return { snapshot: bridge.read().documents.find(value => value.documentId === id)!, records: structuredClone(records), flowDraft: null } },
    drain, restore: vi.fn(), suspend: ids => bridge.suspendForClose(ids), resume: ids => bridge.resumeAfterCloseCancelled(ids),
    error, status: vi.fn(),
  })
  lifecycle.connect(api, recovery)
  return { root, host, api, bridge, snapshot, instanceId, lifecycle, drain, recovery, error,
    setDraft() { records = { advanced: [{ kind: 'json', documentId: snapshot.documentId, epoch: snapshot.epoch, projectId: project.id, key: 'source', payload: '{未完成' }], properties: [] } } }
}

describe('document input owner and Main close boundary', () => {
  it('connects recovery before publishing the first document view', async () => {
    const f = await fixture(), store = useEditorStore.getState(), reads = vi.spyOn(f.api, 'readAuthoringDrafts')
    const restores: Promise<void>[] = []
    const stop = store.courseBridge.subscribe(() => {
      if (store.courseBridge.read().activeDocumentId === f.snapshot.documentId)
        restores.push(store.courseInputs.restore(f.snapshot.documentId))
    })
    try {
      await store.connectCourseDocuments(f.api)
      expect(restores.length).toBeGreaterThan(0)
      await Promise.all(restores)
      expect(reads).toHaveBeenCalledWith(f.snapshot.documentId)
    } finally { stop() }
  })
  it('preserves a refused input for its document epoch and refuses Save without moving History', async () => {
    const f = await fixture(); f.setDraft()
    f.drain.mockRejectedValue(new Error('正文提交已拒绝'))
    const ready = await f.lifecycle.prepare([f.snapshot.documentId], 'preserve')
    expect(f.error.mock.calls).toEqual([])
    expect(ready).toBe(true)
    expect(await f.host.readAuthoringDrafts(f.snapshot.documentId)).toMatchObject({ advanced: [{ epoch: f.snapshot.epoch, payload: '{未完成' }] })
    expect(await f.lifecycle.prepare([f.snapshot.documentId], 'save')).toBe(false)
    expect(f.error).toHaveBeenLastCalledWith('正文提交已拒绝')
    expect((await f.host.internalAPI.read(f.snapshot.documentId)).undoDepth).toBe(0)
  })

  it('keeps IME dirty before ACK and resumes the same input owner after cancelled discard', async () => {
    const f = await fixture()
    await f.host.saveToPath(f.snapshot.documentId, path.join(f.root, 'saved.h5lesson'))
    f.bridge.beginComposition(f.instanceId, ['text'])
    await f.bridge.updateComposition('中文输入')
    expect(f.bridge.read().documents[0]!.dirty).toBe(true)
    expect(f.bridge.read().pending).toBe(1)
    expect((await f.host.internalAPI.read(f.snapshot.documentId)).dirty).toBe(false)
    await f.lifecycle.suspend([f.snapshot.documentId])
    await f.bridge.updateComposition('中文完成')
    await f.bridge.endComposition()
    expect((await f.host.internalAPI.read(f.snapshot.documentId)).undoDepth).toBe(0)
    f.lifecycle.resume([f.snapshot.documentId])
    const [current] = await f.bridge.drain([f.snapshot.documentId])
    expect(current.undoDepth).toBe(1)
    expect(current.model).toMatchObject({ project: { instances: { [f.instanceId]: { data: { text: '中文完成' } } } } })
    expect(f.recovery.resumeFlow).toHaveBeenCalledExactlyOnceWith([f.snapshot.epoch])
  })

  it('Main does not save or close after failed preservation, and suspends only the chosen discard', async () => {
    const f = await fixture(), close = vi.fn(async () => {}), save = vi.fn(async () => f.snapshot)
    const prepare = vi.fn(async () => false)
    const ports = { read: async () => f.snapshot, hasWritableTasks: async () => false, confirmStop: async () => true,
      stopWritableTasks: async () => {}, chooseDirty: async () => 'discard' as const, save,
      withBarrier: async <T>(operation: () => Promise<T>) => operation(), close, prepareRenderer: prepare }
    expect(await closeDocumentFlow(ports)).toBe(false)
    expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
    prepare.mockResolvedValue(true)
    expect(await closeDocumentFlow({ ...ports, discardOnly: true })).toBe(true)
    expect(prepare.mock.calls.at(-1)).toEqual(['discard'])
    expect(close).toHaveBeenCalledExactlyOnceWith(f.snapshot, true)
  })

  it('offers ordinary Discard for an unfinished property draft while strict Save remains refused', async () => {
    const f = await fixture()
    await f.host.saveToPath(f.snapshot.documentId, path.join(f.root, 'clean.h5lesson'))
    f.setDraft(); f.drain.mockRejectedValue(new Error('正文提交已拒绝'))
    const choose = vi.fn(async () => 'save' as 'save' | 'discard'), save = vi.fn(async () => null)
    const close = vi.fn(async (snapshot: typeof f.snapshot, discardDirty: boolean) => {
      await f.host.operate({ type: 'close', documentId: snapshot.documentId, discardDirty,
        expected: { epoch: snapshot.epoch, revision: snapshot.revision } })
    })
    const ports = { read: () => f.host.internalAPI.read(f.snapshot.documentId), hasWritableTasks: async () => false,
      confirmStop: async () => true, stopWritableTasks: async () => {}, chooseDirty: choose, save, close,
      rendererDirty: () => f.lifecycle.hasDirty([f.snapshot.documentId]),
      prepareRenderer: async (mode: 'save' | 'preserve' | 'discard') => {
        if (mode === 'discard') { await f.lifecycle.suspend([f.snapshot.documentId]); return true }
        return f.lifecycle.prepare([f.snapshot.documentId], mode)
      }, withBarrier: async <T>(operation: () => Promise<T>) => operation() }
    expect(await closeDocumentFlow(ports)).toBe(false)
    expect(choose).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
    expect((await ports.read()).undoDepth).toBe(0)
    choose.mockResolvedValue('discard')
    expect(await closeDocumentFlow(ports)).toBe(true)
    expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled()
    expect(f.host.registry.list()).toEqual([])
  })

  it('saves the captured revision, keeps later input dirty, and cold opens the saved content', async () => {
    const f = await fixture()
    await f.bridge.edit([{ type: 'data.set', instanceId: f.instanceId, path: ['text'], value: '保存前正文' }])
    const [captured] = await f.bridge.drain([f.snapshot.documentId])
    const filename = path.join(f.root, 'lesson.h5lesson')
    let laterInput: Promise<unknown> | undefined, savedRevision: number | undefined
    await f.host.saveToPath(f.snapshot.documentId, filename, false, progress => {
      if (progress.status === 'saving') laterInput = f.bridge.edit([{ type: 'data.set', instanceId: f.instanceId, path: ['text'], value: '保存时的新输入' }])
      if (progress.status === 'saved') savedRevision = progress.savedRevision
    })
    await laterInput
    expect(savedRevision).toBe(captured.revision)
    const [current] = await f.bridge.drain([f.snapshot.documentId])
    expect(current.revision).toBe(captured.revision + 1)
    expect(current.dirty).toBe(true)
    const reopened = await new DocumentHostService(path.join(f.root, 'reopened')).open(filename)
    expect(reopened.model).toMatchObject({ project: { instances: { [f.instanceId]: { data: { text: '保存前正文' } } } } })
    expect(reopened.dirty).toBe(false)
    expect(f.bridge.read().pending).toBe(0)
  })

  it('retains the original projection epoch when a formal close arrives before IME ACK', async () => {
    const f = await fixture()
    f.bridge.beginComposition(f.instanceId, ['text'])
    await f.bridge.updateComposition('未确认的原目标输入')
    await f.host.operate({ type: 'close', documentId: f.snapshot.documentId, discardDirty: true })
    await Promise.resolve()
    expect(f.bridge.read().documents).toHaveLength(1)
    expect(f.bridge.read().documents[0]).toMatchObject({ documentId: f.snapshot.documentId, epoch: f.snapshot.epoch, dirty: true })
    expect(f.bridge.read().project).toMatchObject({ instances: { [f.instanceId]: { data: { text: '未确认的原目标输入' } } } })
    expect(f.bridge.read().error).toContain('未确认输入仍保留')
  })

  it('the projection release owner retains a closed precommit even after its gate is released', async () => {
    const f = await fixture(), projection = await DocumentProjection.attach(f.api, f.snapshot.documentId, new CourseV10Driver())
    const release = projection.reservePrecommit()
    try {
      expect(projection.canRelease()).toBe(false)
      await f.host.operate({ type: 'close', documentId: f.snapshot.documentId, discardDirty: true })
      expect(projection.read()).toMatchObject({ pending: [], draft: null, error: { kind: 'closed' } })
      release()
      expect(projection.canRelease()).toBe(false)
    } finally { release(); projection.dispose() }
  })

  it('a refused host replacement leaves recovery writes with the original document input owner', async () => {
    const f = await fixture(), state = useEditorStore.getState()
    await state.connectCourseDocuments(f.api)
    state.courseBridge.beginComposition(f.instanceId, ['text'])
    await state.courseBridge.updateComposition('未确认输入')
    const wrongWriter = vi.fn(async () => {})
    const replacement = { ...f.api, writeAuthoringDrafts: wrongWriter, clearAuthoringDrafts: wrongWriter }
    await expect(state.connectCourseDocuments(replacement)).rejects.toThrow('已保留原连接与输入')
    await state.courseInputs.persist()
    expect(wrongWriter).not.toHaveBeenCalled()
    expect(state.courseBridge.read().documents[0]!.epoch).toBe(f.snapshot.epoch)
    expect(state.courseBridge.read().project).toMatchObject({ instances: { [f.instanceId]: { data: { text: '未确认输入' } } } })
  })
})
