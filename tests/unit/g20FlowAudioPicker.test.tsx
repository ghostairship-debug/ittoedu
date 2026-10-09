import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { audioDataSchema } from '../../src/components/media'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { MediaImportPorts } from '../../src/renderer/app/useMediaImport'

vi.mock('../../src/renderer/project/assetManager', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/renderer/project/assetManager')>(),
  readMediaMetadata: vi.fn(async () => ({ duration: 3 })),
}))
import { useMediaImport } from '../../src/renderer/app/useMediaImport'

const disposals: (() => Promise<void>)[] = []
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const dispose of disposals.splice(0).reverse()) await dispose() })

async function harness() {
  // Main's recovery serializes Node byte arrays across the renderer test realm.
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-flow-audio-'))
  disposals.push(() => rm(directory, { recursive: true, force: true }))
  const service = new DocumentHostService(path.join(directory, 'recovery'))
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'audio-course', revision: 0, title: '讲义',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
    instances: { body: { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('原正文'))) } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['body'] }], global: { underlay: [], overlay: [] }, assets: {} }
  const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
  const original = await service.internalAPI.create(model, '讲义')
  const other = await service.internalAPI.create({ ...model, project: { ...project, id: 'other-course' } }, '另一讲义')
  const unavailable = async (): Promise<never> => { throw new Error('no dialogs') }
  const api: DocumentHostAPI = { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(), saveWithDialog: unavailable,
    close: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable, subscribe: listener => service.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge(); await bridge.connect(api); await bridge.activate(original.documentId)
  disposals.push(async () => bridge.dispose())
  const kernel = createEditorStoreKernel({ bridge, commit: () => {} }), errors: string[] = []
  let choose!: (batch: Awaited<ReturnType<MediaImportPorts['selectAudios']>>) => void
  const ports: MediaImportPorts = { kernel, capturePlacement: () => ({ destination: 'document', afterInstanceId: null }),
    selectImage: async () => null, selectImages: async () => null, selectVideos: async () => null,
    selectAudios: () => new Promise(resolve => { choose = resolve }),
    runBusy: async operation => { try { return await operation() } catch (error) { errors.push(String(error)); return undefined } },
    commitStatus: vi.fn(), reportError: message => errors.push(message) }
  const selected = { selectedCount: 2, acceptedByteLength: 8, rejected: [], accepted: ['a', 'b'].map(name => ({
    name: `${name}.mp3`, path: `${name}.mp3`, mimeType: 'audio/mpeg', bytes: Uint8Array.from([1, 2, 3, 4]), sha256: `hash-${name}` })) }
  return { service, bridge, kernel, ports, original, other, errors, selected, choose: () => choose, directory }
}

it('keeps a pending Flow audio picker on its original document, with one body/resource history entry and save/reopen', async () => {
  const h = await harness(), hook = renderHook(() => useMediaImport(h.ports))
  const pending = hook.result.current.selectAndInsertFlowAudio()
  await h.bridge.activate(h.other.documentId)
  await act(async () => { h.choose()(h.selected); await pending })
  const saved = await h.service.internalAPI.read(h.original.documentId)
  if (saved.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(saved.undoDepth).toBe(1)
  const roots = saved.model.project.surfaces[0].childIds
  expect(roots.at(-1)).toBe('body'); expect(roots).toHaveLength(3)
  for (const id of roots.slice(0, 2)) {
    const data = audioDataSchema.parse(saved.model.project.instances[id].data)
    expect(saved.model.resources.assets[data.assetId]).toEqual(Uint8Array.from([1, 2, 3, 4]))
    expect(saved.model.project.assets[data.assetId]).toMatchObject({ kind: 'audio', duration: 3 })
  }
  expect((await h.service.internalAPI.read(h.other.documentId)).undoDepth).toBe(0)
  expect(h.bridge.read().activeDocumentId).toBe(h.other.documentId)
  expect(h.errors).toEqual([])
  await h.bridge.undo(h.original.documentId)
  const undone = await h.service.internalAPI.read(h.original.documentId)
  expect(undone.model.kind === 'course-v10' && undone.model.project.surfaces[0].childIds).toEqual(['body'])
  expect(undone.model.kind === 'course-v10' && undone.model.resources.assets).toEqual({})
  await h.bridge.redo(h.original.documentId)
  const filename = path.join(h.directory, 'audio.h5lesson'); await h.service.internalAPI.save(h.original.documentId, filename)
  const reopened = await new DocumentHostService(path.join(h.directory, 'cold')).internalAPI.open(filename)
  expect(reopened.model).toEqual((await h.service.internalAPI.read(h.original.documentId)).model)
})

it('rejects a changed Flow placement, retains decoded audio in its original library and refuses a forged workspace target', async () => {
  const h = await harness(), hook = renderHook(() => useMediaImport(h.ports)), original = h.kernel.captureTarget()
  const pending = hook.result.current.selectAndInsertFlowAudio()
  await h.kernel.edit([{ type: 'instance.insert', container: { kind: 'surface', surfaceId: 'flow' }, index: 0,
    instances: [{ id: 'new-body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('新插入正文'))) }], rootIds: ['new-body'] }])
  const before = await h.service.internalAPI.read(h.original.documentId)
  await act(async () => { h.choose()(h.selected); await pending })
  expect(h.errors.join(' ')).toMatch(/版本|revision|陈旧|已变化|已改变/)
  const retained = await h.service.internalAPI.read(h.original.documentId)
  if (before.model.kind !== 'course-v10' || retained.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(retained.model.project.instances).toEqual(before.model.project.instances)
  expect(retained.model.project.surfaces).toEqual(before.model.project.surfaces)
  expect(Object.keys(retained.model.resources.assets)).toHaveLength(2)
  expect(retained.undoDepth).toBe(before.undoDepth + 1)
  expect((await h.service.internalAPI.read(h.other.documentId)).undoDepth).toBe(0)
  const request = { items: [{ workspaceId: 'workspace', entryId: 'audio', name: 'lesson.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([1, 2, 3, 4]), mediaKind: 'audio' as const }],
    placement: { surface: 'flow' as const, afterBlockId: null }, target: { captured: original, documentId: 'wrong-document', projectId: original.project.id,
      revision: original.project.revision, locationId: 'flow', surfaceId: 'flow', sessionGeneration: 1 } }
  expect(await hook.result.current.importWorkspaceMedia(request)).toMatchObject({ ok: false })
  const after = await h.service.internalAPI.read(h.original.documentId)
  expect(after.revision).toBe(retained.revision); expect(after.undoDepth).toBe(retained.undoDepth)
  expect(after.model).toEqual(retained.model)
})
