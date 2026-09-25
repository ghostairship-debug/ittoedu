import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaImportIdentity, MediaImportPorts } from '../../src/renderer/app/useMediaImport'
import type { WorkspaceMediaDropRequest } from '../../src/renderer/lessonWorkspace/workspaceMediaDrop'

const metadataProbe = vi.hoisted(() => ({
  deferred: false,
  calls: 0,
  release: null as (() => void) | null,
}))

vi.mock('../../src/renderer/project/assetManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/project/assetManager')>()
  return {
    ...actual,
    readMediaMetadata: async () => {
      metadataProbe.calls += 1
      if (metadataProbe.deferred) await new Promise<void>(resolve => { metadataProbe.release = resolve })
      return { duration: 2 }
    },
  }
})

import { useMediaImport } from '../../src/renderer/app/useMediaImport'

function createHarness(surface: 'slide' | 'spatial' | 'flow' = 'slide') {
  const identity: MediaImportIdentity = {
    projectId: 'project-1', revision: 3, locationId: 'location-1', surfaceId: 'surface-1',
    sessionGeneration: 2, owner: 'scene', ownerKey: 'scene:surface-1:scene-1',
  }
  const current = { ...identity }
  const context = { documentId: 'document-1', surface }
  const errors: unknown[] = []
  const ports: MediaImportPorts = {
    captureIdentity: () => ({ ...current }),
    captureDocumentId: () => context.documentId,
    captureSurfaceKind: () => context.surface,
    captureLibraryTarget: () => null,
    captureImageReplacementTarget: () => null,
    readMediaLibrarySnapshot: () => ({ assets: {}, files: {} }),
    readCandidateMediaContext: () => null,
    replaceImageAtTarget: vi.fn(() => ({ ok: false })),
    importAssetsAtTarget: vi.fn(() => ({ ok: false })),
    placeImageNodes: vi.fn(() => []),
    placeVideoNodes: vi.fn(() => []),
    placeFlowMediaAt: vi.fn(() => ({ ok: true })),
    importSounds: vi.fn(() => ['sound-1']),
    commitCandidateMedia: vi.fn(),
    selectImage: vi.fn(async () => null),
    selectImages: vi.fn(async () => null),
    selectAudios: vi.fn(async () => null),
    selectVideos: vi.fn(async () => null),
    runBusy: (async <T,>(operation: () => Promise<T>) => {
      try { return await operation() }
      catch (error) { errors.push(error); return undefined }
    }) as MediaImportPorts['runBusy'],
    commitStatus: vi.fn(),
    reportError: vi.fn(),
  }
  const request: WorkspaceMediaDropRequest = {
    items: [{ workspaceId: 'workspace-1', entryId: 'entry-1', name: 'voice.mp3', mimeType: 'audio/mpeg',
      mediaKind: 'audio', bytes: new Uint8Array([0x49, 0x44, 0x33, 4]) }],
    placement: surface === 'flow' ? { surface: 'flow', afterBlockId: null } : { surface, x: 120, y: 80 },
    target: { documentId: context.documentId, projectId: current.projectId, revision: current.revision,
      locationId: current.locationId!, surfaceId: current.surfaceId!, sessionGeneration: current.sessionGeneration },
  }
  return { current, context, errors, ports, request }
}

afterEach(() => {
  metadataProbe.deferred = false
  metadataProbe.calls = 0
  metadataProbe.release = null
  vi.restoreAllMocks()
})

describe('workspace audio drop authoring', () => {
  for (const surface of ['slide', 'spatial'] as const) {
    it(`${surface} imports one audio as a sound definition without a canvas node`, async () => {
      const h = createHarness(surface)
      const { result } = renderHook(() => useMediaImport(h.ports))
      const placed = await result.current.importWorkspaceMedia(h.request)

      expect(placed).toMatchObject({ ok: true, soundId: 'sound-1', assetId: expect.any(String) })
      expect(h.ports.importSounds).toHaveBeenCalledOnce()
      expect(h.ports.importSounds).toHaveBeenCalledWith([
        expect.objectContaining({ meta: expect.objectContaining({ kind: 'audio', id: placed.assetId }) }),
      ])
      expect(h.ports.placeImageNodes).not.toHaveBeenCalled()
      expect(h.ports.placeVideoNodes).not.toHaveBeenCalled()
      expect(h.ports.placeFlowMediaAt).not.toHaveBeenCalled()
      expect(h.ports.commitStatus).not.toHaveBeenCalled()
    })
  }

  it('keeps Flow audio as a body media block', async () => {
    const h = createHarness('flow')
    const { result } = renderHook(() => useMediaImport(h.ports))
    expect(await result.current.importWorkspaceMedia(h.request)).toMatchObject({ ok: true })
    expect(h.ports.placeFlowMediaAt).toHaveBeenCalledOnce()
    expect(h.ports.importSounds).not.toHaveBeenCalled()
  })

  it('rejects multiple files before decoding or any partial commit', async () => {
    const h = createHarness()
    const { result } = renderHook(() => useMediaImport(h.ports))
    const response = await result.current.importWorkspaceMedia({ ...h.request, items: [...h.request.items, ...h.request.items] })
    expect(response).toMatchObject({ ok: false, reason: expect.stringContaining('多文件') })
    expect(metadataProbe.calls).toBe(0)
    expect(h.ports.importSounds).not.toHaveBeenCalled()
  })

  it('rejects a stale frozen document target after asynchronous media decode', async () => {
    const h = createHarness('spatial')
    metadataProbe.deferred = true
    const { result } = renderHook(() => useMediaImport(h.ports))
    const pending = result.current.importWorkspaceMedia(h.request)
    await vi.waitFor(() => expect(metadataProbe.calls).toBe(1))
    h.current.revision += 1
    metadataProbe.release?.()
    const response = await pending
    expect(response).toMatchObject({ ok: false, reason: expect.stringContaining('文档或插入位置已改变') })
    expect(h.ports.importSounds).not.toHaveBeenCalled()
  })
})
