// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { prepareDocumentWindowClose } from '../../src/main/workbench/documentCloseCoordinator'
import { useEditorStore, selectHasUnsavedCourseDocuments } from '../../src/renderer/store/editorStore'
import { useCourseProjectLifecycle, type CourseProjectLifecyclePorts } from '../../src/renderer/app/useCourseProjectLifecycle'
import { useMediaImport, type MediaImportPorts } from '../../src/renderer/app/useMediaImport'
import { encodeImageTransformPng } from '../../src/shared/imageTransform'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { SelectedFileBatch, SelectedImageBatchFile } from '../../src/shared/ipcTypes'

// Chromium's decoder is an external port in this Host check; use a known 2x1 PNG.
vi.mock('../../src/renderer/project/assetManager', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/renderer/project/assetManager')>(),
  readImageDimensions: async () => ({ width: 2, height: 1 }),
}))
const dom = new JSDOM('')
beforeAll(() => {
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterAll(() => { vi.unstubAllGlobals(); dom.window.close() })
const directories: string[] = []
afterEach(async () => {
  cleanup()
  if (useEditorStore.getState().courseView.project) useEditorStore.getState().cancelTextEdit()
  useEditorStore.getState().courseBridge.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('keeps delayed media in its captured document, saves after switching, and restores preserved unfinished input with Main history', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-a0-media-recovery-'))
  directories.push(directory)
  const recoveryPath = path.join(directory, 'recovery'), filename = path.join(directory, '带媒体的课程.h5lesson')
  const host = new DocumentHostService(recoveryPath)
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(),
    saveWithDialog: id => host.internalAPI.save(id, filename),
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) },
    closeWithDialog: async () => false,
    discardRecovery: async documentId => { await host.operate({ type: 'discard-recovery', documentId }) },
    subscribe: listener => host.subscribeEvents(listener) }
  const read = useEditorStore.getState
  await read().connectCourseDocuments(api)
  const firstDocumentId = read().courseView.activeDocumentId!, firstSurfaceId = read().courseView.surfaceId!
  let release!: (files: SelectedFileBatch<SelectedImageBatchFile>) => void
  const selected = new Promise<SelectedFileBatch<SelectedImageBatchFile>>(resolve => { release = resolve })
  const errors = vi.fn()
  const mediaPorts: MediaImportPorts = { kernel: read().courseKernel,
    capturePlacement: () => ({ x: 40, y: 60 }),
    selectImage: async () => null, selectImages: () => selected,
    selectAudios: async () => null, selectVideos: async () => null,
    async runBusy(work) { return await work() }, commitStatus: vi.fn(), reportError: errors }
  const media = renderHook(() => useMediaImport(mediaPorts))
  let pending!: Promise<void>
  act(() => { pending = media.result.current.selectAndImportImage('add') })
  await act(async () => { await read().createCourseDocument('slide') })
  const secondDocumentId = read().courseView.activeDocumentId!
  expect(secondDocumentId).not.toBe(firstDocumentId)
  const bytes = encodeImageTransformPng({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]) })
  await act(async () => {
    release({ selectedCount: 1, acceptedByteLength: bytes.byteLength, rejected: [], accepted: [{
      name: '课堂原图.png', path: path.join(directory, '课堂原图.png'), mimeType: 'image/png', bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }] })
    await pending
  })
  expect(errors).not.toHaveBeenCalled()
  expect(read().courseView.activeDocumentId).toBe(secondDocumentId)
  expect(read().courseView.project?.surfaces[0].childIds).toEqual([])
  expect(Object.keys(read().courseView.project!.assets)).toEqual([])
  const first = read().courseBridge.captureTarget(firstDocumentId)
  const imageId = first.project.surfaces.find(surface => surface.id === firstSurfaceId)!.childIds[0]
  expect(first.project.instances[imageId].frame?.transform).toEqual([1, 0, 0, 1, 40, 60])
  const asset = Object.values(first.project.assets)[0]
  expect(asset.filename).toBe('课堂原图.png')
  expect(first.resources.assets[asset.id]).toEqual(bytes)
  expect(selectHasUnsavedCourseDocuments(read())).toBe(true)
  await act(async () => { await read().activateCourseDocument(firstDocumentId); await read().saveCourseDocument() })
  const coldSaved = await new DocumentHostService(path.join(directory, 'cold-saved')).internalAPI.open(filename)
  if (coldSaved.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(coldSaved.model.project.instances[imageId]).toEqual(first.project.instances[imageId])
  expect(coldSaved.model.resources.assets[asset.id]).toEqual(bytes)

  await read().addTextNode()
  const textId = read().courseView.selectedInstanceId!
  read().beginTextEdit(textId, 'canvas')
  read().updateTextEditDraft(textId, '关闭时保留的中文输入', [])
  let preserve!: () => Promise<boolean>
  const ports: CourseProjectLifecyclePorts = {
    documents: { ready: () => read().connectCourseDocuments(api), snapshot: () => read().courseView.snapshot,
      create: (kind, canvas) => read().createCourseDocument(kind, canvas), open: file => read().openCourseDocument(file),
      save: saveAs => read().saveCourseDocument(saveAs), drain: () => read().drainCourseDocument() },
    captureIdentity() { const view = read().courseView; return { projectId: view.project!.id, revision: view.project!.revision,
      documentId: view.activeDocumentId!, epoch: view.snapshot!.epoch } },
    hasUnsavedChanges: () => selectHasUnsavedCourseDocuments(read()), projectPath: () => read().projectPath,
    async runBusy(work) { return await work() }, commitStatus: vi.fn(), reportError: errors, desktopAvailable: () => true,
    openProjectFile: async () => null, openRecentProjectFile: async () => { throw new Error('unused') },
    confirmProjectOpen: async () => undefined, listRecentProjects: async () => [], setWindowDirtyState: async () => undefined,
    subscribeSaveAndCloseRequest: () => () => undefined,
    subscribePreserveAndCloseRequest: handler => { preserve = handler; return () => undefined },
    preserveBeforeClose: async () => { await read().drainAllCourseDocuments(); return true },
  }
  renderHook(() => useCourseProjectLifecycle(ports, { dirty: true, projectTitle: '关闭恢复', projectPath: filename,
    documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null, slideDraftTrigger: null,
    spatialDraftTrigger: null, flowDraftTrigger: null, textEditTrigger: null }))
  const save = vi.fn(async (id: string) => host.internalAPI.save(id, filename))
  await act(async () => {
    expect(await prepareDocumentWindowClose({ list: () => host.registry.list(),
      drain: async () => { await read().courseBridge.drain() }, rendererDirty: async () => selectHasUnsavedCourseDocuments(read()),
      prepareRenderer: () => preserve(), confirm: () => 'preserve', save })).toBe(true)
  })
  expect(save).not.toHaveBeenCalled()
  expect(read().slideContentEdit).toBeNull()
  read().courseBridge.dispose()
  const coldHost = new DocumentHostService(recoveryPath)
  const recovered = await coldHost.internalAPI.recoverable()
  expect(recovered.some(document => document.documentId === firstDocumentId)).toBe(true)
  const restored = await coldHost.internalAPI.restore(firstDocumentId)
  if (restored.model.kind !== 'course-v10') throw new Error('Expected V10')
  const content = restored.model.project.instances[textId].data as { content: { inlines: { text?: string }[] } }
  expect(content.content.inlines.map(inline => inline.text ?? '').join('')).toBe('关闭时保留的中文输入')
  expect(restored.model.resources.assets[asset.id]).toEqual(bytes)
  expect(restored.undoDepth).toBeGreaterThan(0)
  expect(restored.dirty).toBe(true)
  await read().connectCourseDocuments({ ...api, ...coldHost.internalAPI, bootstrapCourse: async () => restored,
    subscribe: listener => coldHost.subscribeEvents(listener) })
  await read().courseBridge.undo(firstDocumentId)
  const undone = read().courseBridge.captureTarget(firstDocumentId)
  const undoneText = undone.project.instances[textId].data as { content: { inlines: { text?: string }[] } }
  expect(undoneText.content.inlines.map(inline => inline.text ?? '').join('')).toBe('双击编辑文字')
  expect(undone.resources.assets[asset.id]).toEqual(bytes)
  expect(errors).not.toHaveBeenCalled()
})
