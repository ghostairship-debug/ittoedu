import { beforeEach, describe, expect, it } from 'vitest'
import type { AssetMeta } from '@/shared/projectTypes'
import type { SpatialSurfaceDocument } from '@/shared/courseProjectTypes'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { useEditorStore } from '@/renderer/store/editorStore'

beforeEach(() => useEditorStore.getState().createNewProject())

describe('Spatial addVideoNode with real session and asset', () => {
  it('inserts video node into blank spatial project with world layer, asset entry, and sidecar bytes', () => {
    useEditorStore.getState().loadCourseProject(
      createBlankSpatialCourseProject({ now: '2026-08-19T00:00:00.000Z' }),
      null,
    )
    const initialSession = useEditorStore.getState().spatialSession
    expect(initialSession).not.toBeNull()
    expect(initialSession?.scope).toBe('world')
    const beforeRevision = initialSession!.history.present.revision

    const asset: AssetMeta = {
      id: 'asset-q6-video',
      filename: 'clip.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
      path: 'assets/clip.mp4',
      byteLength: 4,
      width: 640,
      height: 360,
    }
    const bytes = new Uint8Array([0, 0, 0, 1])
    useEditorStore.getState().addVideoNode(asset, bytes)

    const state = useEditorStore.getState()
    expect(state.errorMessage).toBeNull()

    const spatialSurface = state.spatialSession?.history.present.surfaces.find(
      (s): s is SpatialSurfaceDocument => s.type === 'spatial-2d',
    )
    expect(spatialSurface).toBeDefined()

    const present = state.spatialSession!.history.present
    expect(present.assets['asset-q6-video']).toBeDefined()
    expect(present.assets['asset-q6-video']!.kind).toBe('video')

    const videoLayers = spatialSurface!.world.layerItems.filter(
      (item) => item.kind === 'native' && item.content.nativeType === 'video',
    )
    expect(videoLayers).toHaveLength(1)
    expect(videoLayers[0]!.kind === 'native' && videoLayers[0]!.content.nativeType === 'video' && videoLayers[0]!.content.data.assetId).toBe('asset-q6-video')

    expect(state.courseAssetSidecar).toBeDefined()
    expect([...(state.courseAssetSidecar!.files['asset-q6-video'] ?? [])]).toEqual([0, 0, 0, 1])

    expect(present.revision).toBe(beforeRevision + 1)
  })

  it('inserts a second video node with new id into existing spatial session', () => {
    useEditorStore.getState().loadCourseProject(
      createBlankSpatialCourseProject({ now: '2026-08-19T00:00:00.000Z' }),
      null,
    )
    const asset1: AssetMeta = {
      id: 'asset-q6-video-1',
      filename: 'clip1.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
      path: 'assets/clip1.mp4',
      byteLength: 4,
      width: 640,
      height: 360,
    }
    const bytes1 = new Uint8Array([1, 1, 1, 1])
    useEditorStore.getState().addVideoNode(asset1, bytes1)

    const revisionAfterFirst = useEditorStore.getState().spatialSession!.history.present.revision

    const asset2: AssetMeta = {
      id: 'asset-q6-video-2',
      filename: 'clip2.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
      path: 'assets/clip2.mp4',
      byteLength: 4,
      width: 640,
      height: 360,
    }
    const bytes2 = new Uint8Array([2, 2, 2, 2])
    useEditorStore.getState().addVideoNode(asset2, bytes2)

    const state = useEditorStore.getState()
    expect(state.errorMessage).toBeNull()

    const present = state.spatialSession!.history.present
    const spatialSurface = present.surfaces.find(
      (s): s is SpatialSurfaceDocument => s.type === 'spatial-2d',
    )
    expect(spatialSurface).toBeDefined()

    const videoLayers = spatialSurface!.world.layerItems.filter(
      (item) => item.kind === 'native' && item.content.nativeType === 'video',
    )
    expect(videoLayers).toHaveLength(2)

    expect(present.assets['asset-q6-video-1']).toBeDefined()
    expect(present.assets['asset-q6-video-2']).toBeDefined()

    expect([...(state.courseAssetSidecar!.files['asset-q6-video-1'] ?? [])]).toEqual([1, 1, 1, 1])
    expect([...(state.courseAssetSidecar!.files['asset-q6-video-2'] ?? [])]).toEqual([2, 2, 2, 2])

    expect(present.revision).toBe(revisionAfterFirst + 1)
  })
})
