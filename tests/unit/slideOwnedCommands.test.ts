import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectSlideAuthoringDocument,
  selectSlideAuthoringSnapshot,
  useEditorStore,
} from '@/renderer/store/editorStore'
import type { SlideSceneDocument, SlideSurfaceDocument } from '@/shared/courseProjectTypes'

const NOW_BYTES = new Uint8Array([1, 2, 3, 4])

function activeSurface(): SlideSurfaceDocument {
  const document = selectSlideAuthoringDocument(useEditorStore.getState())
  const snapshot = selectSlideAuthoringSnapshot(useEditorStore.getState())
  if (!document || !snapshot) throw new Error('Expected an active Slide authoring session')
  const surface = document.surfaces.find((candidate) => candidate.id === snapshot.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('Expected an active Slide surface')
  return surface
}

function activeScene(): SlideSceneDocument {
  const surface = activeSurface()
  const snapshot = selectSlideAuthoringSnapshot(useEditorStore.getState())!
  const scene = surface.scenes.find((candidate) => candidate.id === snapshot.sceneId)
  if (!scene) throw new Error('Expected an active V9 Slide scene')
  return scene
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('slideOwnedCommands: updateSlideSurfaceBackground', () => {
  it('defaults to inherit mode with no owned color/asset on a fresh Slide surface', () => {
    const surface = activeSurface()
    expect(surface.backgroundMode).toBeUndefined()
    expect(surface.backgroundColor).toBeUndefined()
    expect(surface.backgroundAssetId).toBeUndefined()
  })

  it('writes backgroundMode/backgroundColor/backgroundAssetId in one commit each', () => {
    const surfaceId = activeSurface().id
    const store = useEditorStore.getState()

    const modeResult = store.updateSlideSurfaceBackground(surfaceId, { backgroundMode: 'own' })
    expect(modeResult.ok).toBe(true)
    expect(modeResult.historyEntry).toBe(true)
    expect(activeSurface().backgroundMode).toBe('own')
    // Switching mode alone never touches the dormant color/asset fields.
    expect(activeSurface().backgroundColor).toBeUndefined()
    expect(activeSurface().backgroundAssetId).toBeUndefined()

    const colorResult = useEditorStore.getState().updateSlideSurfaceBackground(surfaceId, {
      backgroundColor: '#223344',
    })
    expect(colorResult.ok).toBe(true)
    expect(activeSurface().backgroundColor).toBe('#223344')

    // The strict schema requires a referenced asset id to already exist, so
    // import one first (its own dedicated command) rather than fabricating an id.
    useEditorStore.getState().importSlideSurfaceBackgroundAsset(surfaceId, {
      name: 'surface-bg.png',
      mimeType: 'image/png',
      bytes: NOW_BYTES,
    })
    const importedAssetId = activeSurface().backgroundAssetId
    expect(typeof importedAssetId).toBe('string')

    const clearResult = useEditorStore.getState().updateSlideSurfaceBackground(surfaceId, {
      backgroundAssetId: null,
    })
    expect(clearResult.ok).toBe(true)
    expect(activeSurface().backgroundAssetId).toBeNull()

    const restoreResult = useEditorStore.getState().updateSlideSurfaceBackground(surfaceId, {
      backgroundAssetId: importedAssetId as string,
    })
    expect(restoreResult.ok).toBe(true)
    expect(activeSurface().backgroundAssetId).toBe(importedAssetId)
  })

  it('switching to inherit preserves the own color/asset for a later switch back', () => {
    const surfaceId = activeSurface().id
    const store = useEditorStore.getState()
    store.updateSlideSurfaceBackground(surfaceId, {
      backgroundMode: 'own',
      backgroundColor: '#efefef',
    })
    useEditorStore.getState().importSlideSurfaceBackgroundAsset(surfaceId, {
      name: 'dormant.png',
      mimeType: 'image/png',
      bytes: NOW_BYTES,
    })
    const dormantAssetId = activeSurface().backgroundAssetId

    useEditorStore.getState().updateSlideSurfaceBackground(surfaceId, { backgroundMode: 'inherit' })
    expect(activeSurface().backgroundMode).toBe('inherit')
    expect(activeSurface().backgroundColor).toBe('#efefef')
    expect(activeSurface().backgroundAssetId).toBe(dormantAssetId)

    useEditorStore.getState().updateSlideSurfaceBackground(surfaceId, { backgroundMode: 'own' })
    expect(activeSurface().backgroundMode).toBe('own')
    expect(activeSurface().backgroundColor).toBe('#efefef')
    expect(activeSurface().backgroundAssetId).toBe(dormantAssetId)
  })

  it('rejects an invalid color/mode and a stale revision without writing', () => {
    const surfaceId = activeSurface().id
    const store = useEditorStore.getState()

    const invalidColor = store.updateSlideSurfaceBackground(surfaceId, { backgroundColor: 'nope' })
    expect(invalidColor.ok).toBe(false)
    expect(activeSurface().backgroundColor).toBeUndefined()

    const invalidMode = store.updateSlideSurfaceBackground(surfaceId, {
      backgroundMode: 'invalid' as never,
    })
    expect(invalidMode.ok).toBe(false)

    const stale = store.updateSlideSurfaceBackground(surfaceId, { backgroundColor: '#112233' }, {
      expectedRevision: -1,
    })
    expect(stale.ok).toBe(false)
    expect(activeSurface().backgroundColor).toBeUndefined()
  })

  it('short-circuits a patch that changes nothing', () => {
    const surfaceId = activeSurface().id
    const store = useEditorStore.getState()
    store.updateSlideSurfaceBackground(surfaceId, { backgroundColor: '#112233' })
    const noop = useEditorStore.getState().updateSlideSurfaceBackground(surfaceId, {
      backgroundColor: '#112233',
    })
    expect(noop.ok).toBe(true)
    expect(noop.historyEntry).toBe(false)
  })

  it('imports a new background image and assigns it in one commit', () => {
    const surfaceId = activeSurface().id
    const store = useEditorStore.getState()
    const result = store.importSlideSurfaceBackgroundAsset(surfaceId, {
      name: 'surface-bg.png',
      mimeType: 'image/png',
      bytes: NOW_BYTES,
    })
    expect(result.ok).toBe(true)
    expect(result.historyEntry).toBe(true)
    const assetId = activeSurface().backgroundAssetId
    expect(typeof assetId).toBe('string')
    const document = selectSlideAuthoringDocument(useEditorStore.getState())!
    expect(document.assets[assetId as string]).toMatchObject({ filename: 'surface-bg.png' })

    useEditorStore.getState().undo()
    expect(activeSurface().backgroundAssetId).toBeUndefined()
  })
})

describe('slideOwnedCommands: updateSceneBackground', () => {
  it('defaults to own mode with the required color and no asset on a fresh scene', () => {
    const scene = activeScene()
    expect(scene.backgroundMode).toBeUndefined()
    expect(typeof scene.backgroundColor).toBe('string')
    expect(scene.backgroundAssetId).toBeNull()
  })

  it('writes backgroundMode/backgroundColor/backgroundAssetId in one commit each', () => {
    const sceneId = activeScene().id
    const store = useEditorStore.getState()

    const colorResult = store.updateSceneBackground(sceneId, { backgroundColor: '#334455' })
    expect(colorResult.ok).toBe(true)
    expect(colorResult.historyEntry).toBe(true)
    expect(activeScene().backgroundColor).toBe('#334455')

    const modeResult = useEditorStore.getState().updateSceneBackground(sceneId, { backgroundMode: 'inherit' })
    expect(modeResult.ok).toBe(true)
    // Switching mode alone never touches the dormant color/asset fields.
    expect(activeScene().backgroundColor).toBe('#334455')

    useEditorStore.getState().updateSceneBackground(sceneId, { backgroundMode: 'own' })
    const importResult = useEditorStore.getState().importSceneBackgroundAsset(sceneId, {
      name: 'scene-bg.png',
      mimeType: 'image/png',
      bytes: NOW_BYTES,
    })
    expect(importResult.ok).toBe(true)
    expect(typeof activeScene().backgroundAssetId).toBe('string')
  })

  it('rejects an invalid color and a stale revision without writing', () => {
    const sceneId = activeScene().id
    const before = activeScene().backgroundColor
    const store = useEditorStore.getState()

    const invalidColor = store.updateSceneBackground(sceneId, { backgroundColor: 'nope' })
    expect(invalidColor.ok).toBe(false)
    expect(activeScene().backgroundColor).toBe(before)

    const stale = store.updateSceneBackground(sceneId, { backgroundColor: '#112233' }, {
      expectedRevision: -1,
    })
    expect(stale.ok).toBe(false)
    expect(activeScene().backgroundColor).toBe(before)
  })

  it('short-circuits a patch that changes nothing', () => {
    const sceneId = activeScene().id
    const color = activeScene().backgroundColor
    const noop = useEditorStore.getState().updateSceneBackground(sceneId, { backgroundColor: color })
    expect(noop.ok).toBe(true)
    expect(noop.historyEntry).toBe(false)
  })

  it('imports a new background image and assigns it in one commit', () => {
    const sceneId = activeScene().id
    const store = useEditorStore.getState()
    const result = store.importSceneBackgroundAsset(sceneId, {
      name: 'scene-bg.png',
      mimeType: 'image/png',
      bytes: NOW_BYTES,
    })
    expect(result.ok).toBe(true)
    expect(result.historyEntry).toBe(true)
    const assetId = activeScene().backgroundAssetId
    expect(typeof assetId).toBe('string')
    const document = selectSlideAuthoringDocument(useEditorStore.getState())!
    expect(document.assets[assetId as string]).toMatchObject({ filename: 'scene-bg.png' })

    useEditorStore.getState().undo()
    expect(activeScene().backgroundAssetId).toBeNull()
  })

  it('keeps updateScene(name) working independently of background commands', () => {
    const sceneId = activeScene().id
    const store = useEditorStore.getState()
    store.updateSceneBackground(sceneId, { backgroundColor: '#556677' })
    useEditorStore.getState().updateScene(sceneId, { name: '练习场景' })
    expect(activeScene().name).toBe('练习场景')
    expect(activeScene().backgroundColor).toBe('#556677')
  })
})
