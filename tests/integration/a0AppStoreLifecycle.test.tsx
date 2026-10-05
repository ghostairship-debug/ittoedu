// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { useEditorStore, selectHasUnsavedCourseDocuments } from '../../src/renderer/store/editorStore'
import { useCourseProjectLifecycle, type CourseProjectLifecyclePorts } from '../../src/renderer/app/useCourseProjectLifecycle'

const directories: string[] = []
afterEach(async () => {
  cleanup()
  if (useEditorStore.getState().courseView.project) useEditorStore.getState().cancelTextEdit()
  useEditorStore.getState().courseBridge.dispose()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function fixture(directory: string, filename: string) {
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const api: DocumentHostAPI = {
    ...host.internalAPI,
    bootstrapCourse: () => host.bootstrapCourse(),
    saveWithDialog: (id) => host.internalAPI.save(id, filename),
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) },
    closeWithDialog: async (documentId) => { await host.operate({ type: 'close', documentId }); return true },
    discardRecovery: async documentId => { await host.operate({ type: 'discard-recovery', documentId }) },
    subscribe: listener => host.subscribeEvents(listener),
  }
  await useEditorStore.getState().connectCourseDocuments(api)
  return { host, api }
}

function mountLifecycle(api: DocumentHostAPI) {
  const read = useEditorStore.getState
  const errors = vi.fn()
  const ports: CourseProjectLifecyclePorts = {
    documents: {
      ready: () => read().connectCourseDocuments(api),
      snapshot: () => read().courseView.snapshot,
      create: (kind, canvas) => read().createCourseDocument(kind, canvas),
      createFrom: content => read().createCourseDocumentFrom(content.project, content.resources),
      open: filename => read().openCourseDocument(filename),
      save: saveAs => read().saveCourseDocument(saveAs),
      drain: () => read().drainCourseDocument(),
    },
    captureIdentity() {
      const view = read().courseView
      return { projectId: view.project?.id ?? '', revision: view.project?.revision ?? 0,
        documentId: view.activeDocumentId ?? '', epoch: view.snapshot?.epoch ?? '' }
    },
    hasUnsavedChanges: () => selectHasUnsavedCourseDocuments(read()),
    projectPath: () => read().projectPath,
    async runBusy(work) { try { return await work() } catch (error) { errors(error); return undefined } },
    commitStatus: vi.fn(), reportError: errors, desktopAvailable: () => true,
    openProjectFile: async () => null,
    openRecentProjectFile: async () => { throw new Error('Main opens the selected file') },
    confirmProjectOpen: async () => undefined,
    listRecentProjects: async () => [],
    setWindowDirtyState: async () => undefined,
    subscribeSaveAndCloseRequest: () => () => undefined,
  }
  const hook = renderHook(() => useCourseProjectLifecycle(ports, { dirty: false, projectTitle: '首链', projectPath: null,
    documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null, slideDraftTrigger: null,
    spatialDraftTrigger: null, flowDraftTrigger: null, textEditTrigger: null }))
  return { ...hook, errors }
}

function textOf(id: string) {
  const data = useEditorStore.getState().courseView.project!.instances[id].data as { content: { inlines: { text?: string }[] } }
  return data.content.inlines.map(inline => inline.text ?? '').join('')
}

it('preserves the mature lifecycle through the V10 Store: draft save, independent Host reopen, continued editing and formal undo', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-a0-lifecycle-'))
  directories.push(directory)
  const filename = path.join(directory, '中文首链.h5lesson')
  const { api } = await fixture(directory, filename)
  const lifecycle = mountLifecycle(api)
  await act(async () => { expect(await lifecycle.result.current.newProject()).toBe(true) })
  const state = useEditorStore.getState()
  const documentId = state.courseView.activeDocumentId!
  await state.addTextNode()
  const textId = state.courseBridge.read().selectedInstanceId!
  expect(textId).toEqual(expect.any(String))
  await state.addShapeNode('rectangle')
  const shapeId = state.courseBridge.read().selectedInstanceId!
  expect(shapeId).toEqual(expect.any(String))
  expect(shapeId).not.toBe(textId)
  expect(state.courseBridge.read().selectedInstanceIds).toEqual([shapeId])
  const shape = state.courseBridge.read().project!.instances[shapeId]
  await state.courseKernel.edit([{ type: 'data.set', instanceId: shapeId, path: ['fillColor'], value: '#bb3344' }])
  await state.courseKernel.navigateHistory('undo')
  expect(state.courseBridge.read().project!.instances[shapeId].data).toEqual(shape.data)
  expect(state.courseBridge.read().project!.instances[shapeId].frame).toEqual(shape.frame)

  state.courseKernel.selectInstances([textId])
  state.beginTextEdit(textId, 'canvas')
  state.updateTextEditDraft(textId, '尚未退出编辑的中文', [])
  expect(selectHasUnsavedCourseDocuments(useEditorStore.getState())).toBe(true)
  await act(async () => { expect(await lifecycle.result.current.saveProject()).toBe(true) })
  expect(textOf(textId)).toBe('尚未退出编辑的中文')
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
  expect(useEditorStore.getState().courseView.snapshot?.dirty).toBe(false)
  await useEditorStore.getState().closeCourseDocument(documentId)
  lifecycle.unmount()

  // A new Main Host reads the disk archive and does not reuse the first registry or History.
  const restarted = await fixture(directory, filename)
  await useEditorStore.getState().openCourseDocument(filename)
  expect(textOf(textId)).toBe('尚未退出编辑的中文')
  expect(useEditorStore.getState().courseView.project!.instances[shapeId]).toEqual(shape)
  const reopened = useEditorStore.getState()
  reopened.beginTextEdit(textId, 'canvas')
  reopened.updateTextEditDraft(textId, '冷开后继续编辑', [])
  await reopened.commitTextEdit()
  expect(textOf(textId)).toBe('冷开后继续编辑')
  await reopened.courseKernel.navigateHistory('undo')
  expect(textOf(textId)).toBe('尚未退出编辑的中文')
  const snapshot = await restarted.host.internalAPI.read(reopened.courseView.activeDocumentId!)
  expect(snapshot.undoDepth).toBe(0)
  expect(snapshot.redoDepth).toBe(1)
})

it('refuses persistence while a text draft is composing and preserves that draft for completion', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-a0-composing-'))
  directories.push(directory)
  const filename = path.join(directory, '保留输入.h5lesson')
  const { api } = await fixture(directory, filename)
  await useEditorStore.getState().createCourseDocumentFrom(createBlankCourseProjectV10('保留输入'))
  const state = useEditorStore.getState()
  await state.addTextNode()
  const textId = state.courseBridge.read().selectedInstanceId!
  expect(textId).toEqual(expect.any(String))
  state.beginTextEdit(textId, 'canvas')
  state.updateTextEditDraft(textId, '仍在输入', [])
  state.setSlideTextEditComposing(true)
  await expect(state.saveCourseDocument()).rejects.toThrow('完成正在输入')
  expect(useEditorStore.getState().slideContentEdit).toMatchObject({ composing: true, instanceId: textId })
  expect(await fs.stat(filename).then(() => true, () => false)).toBe(false)
  state.setSlideTextEditComposing(false)
  await state.saveCourseDocument()
  expect(textOf(textId)).toBe('仍在输入')
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
})
