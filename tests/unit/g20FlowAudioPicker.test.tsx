import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyCourseAssetSidecar } from '../../src/renderer/project/v9AssetAdapter'
import type { MediaImportIdentity, MediaImportItem, MediaImportPorts } from '../../src/renderer/app/useMediaImport'

vi.mock('../../src/renderer/project/assetManager', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/project/assetManager')>()
  return { ...actual, readMediaMetadata: vi.fn(async () => ({ duration: 3 })) }
})

import { useMediaImport } from '../../src/renderer/app/useMediaImport'

afterEach(() => vi.restoreAllMocks())

function harness() {
  let current: MediaImportIdentity | null = {
    projectId: 'project-1', revision: 1, locationId: 'flow-1', sessionGeneration: 1,
    surfaceId: 'surface-1', owner: 'page', ownerKey: 'flow-1',
  }
  let choose: ((batch: Awaited<ReturnType<MediaImportPorts['selectAudios']>>) => void) | null = null
  const errors: string[] = []
  const placed = vi.fn(async (_items: readonly MediaImportItem[]) => ({ completedCount: 1, issues: [] }))
  const dropped = vi.fn((_item: MediaImportItem, _afterBlockId: string | null) => ({ ok: true, blockId: 'created-block' }))
  const ports: MediaImportPorts = {
    captureIdentity: () => current,
    captureDocumentId: () => 'document-1',
    captureSurfaceKind: () => 'flow',
    captureFlowAudioTarget: () => current,
    captureLibraryTarget: () => ({ projectId: 'project-1', documentRevision: 1 }),
    captureImageReplacementTarget: () => null,
    readMediaLibrarySnapshot: () => ({ assets: {}, files: {} }),
    readCandidateMediaContext: () => ({ assets: {}, sidecar: emptyCourseAssetSidecar() }),
    replaceImageAtTarget: () => ({ ok: false }),
    importAssetsAtTarget: () => ({ ok: false }),
    placeImageNodes: () => [], placeVideoNodes: () => [], placeFlowAudioNodes: placed, placeFlowMediaAt: dropped,
    importSounds: vi.fn(() => []), commitCandidateMedia: vi.fn(),
    selectImage: async () => null, selectImages: async () => null,
    selectAudios: () => new Promise(resolve => { choose = resolve }),
    selectVideos: async () => null,
    runBusy: async operation => { try { return await operation() } catch (error) { errors.push(String(error)); return undefined } },
    commitStatus: vi.fn(), reportError: vi.fn(),
  }
  const selected = {
    selectedCount: 1, acceptedByteLength: 4,
    accepted: [{ name: 'lesson.mp3', path: 'lesson.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([1, 2, 3, 4]), sha256: 'hash-1' }],
    rejected: [],
  }
  return { ports, placed, dropped, errors, selected, choose: () => choose, invalidate: () => { current = null } }
}

it('routes a selected Flow audio file through the formal body placement port', async () => {
  const h = harness()
  const { result } = renderHook(() => useMediaImport(h.ports))
  const pending = result.current.selectAndInsertFlowAudio()
  h.choose()?.(h.selected)
  await pending
  expect(h.placed).toHaveBeenCalledOnce()
  expect(h.placed.mock.calls[0]?.[0]?.[0]?.meta).toMatchObject({ kind: 'audio', mimeType: 'audio/mpeg' })
  expect(h.ports.commitStatus).toHaveBeenCalledWith(expect.stringContaining('已完成 1 项'))
  expect(h.errors).toEqual([])
})

it('rejects a Flow audio picker result after its document or authoring scope changes', async () => {
  const h = harness()
  const { result } = renderHook(() => useMediaImport(h.ports))
  const pending = result.current.selectAndInsertFlowAudio()
  h.invalidate()
  h.choose()?.(h.selected)
  await pending
  expect(h.placed).not.toHaveBeenCalled()
  expect(h.errors.join(' ')).toContain('工程已发生变化')
})

it('accepts one workspace audio at its frozen Flow body anchor and rejects a stale target', async () => {
  const h = harness()
  const { result } = renderHook(() => useMediaImport(h.ports))
  const request = {
    items: [{ workspaceId: 'workspace-1', entryId: 'entry-1', name: 'lesson.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([1, 2, 3, 4]), mediaKind: 'audio' as const }],
    placement: { surface: 'flow' as const, afterBlockId: null },
    target: { documentId: 'document-1', projectId: 'project-1', revision: 1, locationId: 'flow-1', surfaceId: 'surface-1', sessionGeneration: 1 },
  }
  expect((await result.current.importWorkspaceMedia(request)).ok).toBe(true)
  expect(h.dropped).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ kind: 'audio' }) }), null)
  h.invalidate()
  expect(await result.current.importWorkspaceMedia(request)).toMatchObject({ ok: false, reason: expect.stringContaining('文档或插入位置') })
  expect(h.dropped).toHaveBeenCalledOnce()
})

it('rejects a mismatched surface target and multi-file drops before any placement', async () => {
  const h = harness()
  const { result } = renderHook(() => useMediaImport(h.ports))
  const file = { workspaceId: 'workspace-1', entryId: 'entry-1', name: 'lesson.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([1, 2, 3, 4]), mediaKind: 'audio' as const }
  const target = { documentId: 'document-1', projectId: 'project-1', revision: 1, locationId: 'flow-1', surfaceId: 'surface-1', sessionGeneration: 1 }
  expect(await result.current.importWorkspaceMedia({ items: [file], placement: { surface: 'slide', x: 30, y: 40 }, target }))
    .toMatchObject({ ok: false, reason: expect.stringContaining('文档或插入位置已改变') })
  expect(await result.current.importWorkspaceMedia({ items: [file, file], placement: { surface: 'flow', afterBlockId: null }, target }))
    .toMatchObject({ ok: false, reason: expect.stringContaining('一次拖入一个') })
  expect(h.dropped).not.toHaveBeenCalled()
  expect(h.ports.importSounds).not.toHaveBeenCalled()
})
