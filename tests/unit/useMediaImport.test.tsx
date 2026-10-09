import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { MediaImportPorts } from '../../src/renderer/app/useMediaImport'
import { audioDataSchema } from '../../src/components/media'

const decode = vi.hoisted(() => ({ calls: 0, gate: null as Promise<void> | null }))
vi.mock('../../src/renderer/project/assetManager', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/renderer/project/assetManager')>(),
  readImageDimensions: vi.fn(async () => { decode.calls++; await decode.gate; return { width: 20, height: 10 } }),
  readMediaMetadata: vi.fn(async () => { decode.calls++; await decode.gate; return { duration: 3 } }),
}))
import { useMediaImport } from '../../src/renderer/app/useMediaImport'

const dispose: (() => void)[] = []
beforeEach(() => { vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor) })
afterEach(() => { cleanup(); for (const action of dispose.splice(0)) action(); decode.calls = 0; decode.gate = null; vi.unstubAllGlobals() })

async function harness() {
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'media-original', revision: 0, title: '原工程', definitions: {}, instances: {},
    surfaces: [{ id: 'slide', kind: 'slide', title: '第一页', childIds: [], designSize: { width: 1280, height: 720 } }],
    global: { underlay: [], overlay: [] }, assets: {} }
  const host = await createV10StoreHost(project)
  dispose.push(() => host.bridge.dispose())
  await host.bridge.create({ kind: 'course-v10', project: { ...project, id: 'media-other' }, resources: { assets: {}, components: {} } })
  const other = host.bridge.read().snapshot!
  await host.bridge.activate(host.first.documentId)
  const selected = { name: 'voice.mp3', path: 'voice.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([1, 2, 3, 4]) }
  const ports: MediaImportPorts = { kernel: host.kernel, selectImage: async () => null, selectImages: async () => null,
    selectAudio: async () => selected, selectAudios: async () => null, selectVideos: async () => null,
    runBusy: async operation => operation(), commitStatus: vi.fn(), reportError: vi.fn() }
  return { ...host, other, selected, ports }
}

it('cancels picker and absent targets without decoding, resources, selection or History writes', async () => {
  const h = await harness(), hook = renderHook(() => useMediaImport(h.ports)), before = h.first.read()
  await hook.result.current.selectAndImportImage('add')
  expect(await hook.result.current.selectTargetMedia({ kind: 'image', captureTarget: () => h.kernel.captureTarget(), isTargetCurrent: () => true })).toBeNull()
  const capture = vi.fn(() => null)
  expect(await hook.result.current.selectTargetMedia({ kind: 'audio', captureTarget: capture, isTargetCurrent: () => true })).toBeNull()
  expect(capture).toHaveBeenCalledOnce(); expect(decode.calls).toBe(0)
  expect(h.first.read()).toEqual(before); expect(h.operations).toEqual([])
  expect(h.kernel.readView().selectedInstanceIds).toEqual([])
})

it('captures before a busy queue, rejects a document closed during decode, and rechecks a prepared selection before use', async () => {
  const h = await harness(), queue = deferred(), decoding = deferred()
  h.ports.runBusy = async operation => { await queue.promise; return operation() }
  decode.gate = decoding.promise
  const hook = renderHook(() => useMediaImport(h.ports))
  const captureTarget = vi.fn(() => h.kernel.captureTarget())
  const input = { kind: 'audio' as const, captureTarget,
    isTargetCurrent: (target: ReturnType<typeof captureTarget>) => h.kernel.readView().documents.some(doc => doc.documentId === target.documentId && doc.epoch === target.epoch) }
  const pending = hook.result.current.selectTargetMedia(input)
  expect(captureTarget).toHaveBeenCalledOnce()
  expect(captureTarget.mock.results[0].value.documentId).toBe(h.first.documentId)
  await h.bridge.activate(h.other.documentId)
  queue.resolve(); await vi.waitFor(() => expect(decode.calls).toBe(1))
  expect(await h.bridge.close(h.first.documentId)).toBe(true)
  decoding.resolve()
  await expect(pending).rejects.toThrow('捕获的原媒体目标已失效')
  expect(h.registry.get(h.other.documentId).read().undoDepth).toBe(0)
  decode.gate = null
  const prepared = await hook.result.current.selectTargetMedia(input)
  expect(prepared?.source.kind).toBe('new'); expect(prepared?.bytes).toEqual(h.selected.bytes)
  expect(() => prepared?.assertCurrent()).not.toThrow()
  expect(await h.bridge.close(h.other.documentId)).toBe(true)
  expect(() => prepared?.assertCurrent()).toThrow('捕获的原媒体目标已失效')
  expect(h.operations).toEqual([])
})

it('drops an audio batch into the frozen original document after switching tabs, with one resource/body History entry and Undo', async () => {
  const h = await harness(), decoding = deferred(), target = h.kernel.captureTarget()
  decode.gate = decoding.promise
  const hook = renderHook(() => useMediaImport(h.ports))
  const pending = hook.result.current.importWorkspaceMedia({
    items: ['a', 'b'].map(name => ({ ...h.selected, name: `${name}.mp3`, workspaceId: 'workspace', entryId: name, mediaKind: 'audio' as const })),
    placement: { surface: 'slide', x: 120, y: 80 },
    target: { captured: target, documentId: target.documentId, projectId: target.project.id, revision: target.project.revision,
      surfaceId: target.surfaceId!, locationId: target.surfaceId!, sessionGeneration: 1 },
  })
  await vi.waitFor(() => expect(decode.calls).toBe(1))
  await h.bridge.activate(h.other.documentId)
  const otherBefore = h.registry.get(h.other.documentId).read()
  await act(async () => { decoding.resolve(); expect(await pending).toMatchObject({ ok: true }) })
  const snapshot = h.first.read()
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(snapshot.undoDepth).toBe(1)
  const roots = snapshot.model.project.surfaces[0].childIds
  expect(roots).toHaveLength(2)
  roots.forEach((id, index) => {
    const instance = snapshot.model.kind === 'course-v10' ? snapshot.model.project.instances[id] : undefined
    const data = audioDataSchema.parse(instance?.data)
    expect(instance?.frame?.transform.slice(4)).toEqual([120 + index * 20, 80 + index * 20])
    expect(snapshot.model.kind === 'course-v10' && snapshot.model.resources.assets[data.assetId]).toEqual(h.selected.bytes)
  })
  expect(h.registry.get(h.other.documentId).read()).toEqual(otherBefore)
  expect(h.bridge.read().activeDocumentId).toBe(h.other.documentId)
  expect(h.bridge.read().selectedInstanceIds).toEqual([])
  await h.bridge.undo(h.first.documentId)
  const undone = h.first.read()
  expect(undone.undoDepth).toBe(0)
  expect(undone.model.kind === 'course-v10' && undone.model.project.instances).toEqual({})
  expect(undone.model.kind === 'course-v10' && undone.model.resources.assets).toEqual({})
})
