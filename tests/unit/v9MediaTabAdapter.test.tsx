import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { COURSE_PROJECT_SCHEMA_VERSION } from '@/shared/courseProjectTypes'
import {
  createImageAssetImport,
  createMediaAssetImport,
} from '@/renderer/project/assetManager'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import { dedupeCourseMediaImports } from '@/renderer/project/v9AssetAdapter'
import {
  selectAudioSettings,
  selectMediaAssetFiles,
  selectMediaAssets,
  selectSlideBackendKind,
  selectSlideAuthoringDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { MediaTab } from '@/renderer/ui/MediaTab'

/**
 * Proves R3-Z MediaTab wiring against the R3-CUT default V9 candidate.
 * Does not prove a live Electron window.
 */
const NOW = '2026-08-17T15:00:00.000Z'

function v9EmptySlideFixture() {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r3z-media',
    revision: 1,
    title: 'R3-Z media',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {},
    componentPackages: {},
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
    locations: [{
      id: 'location-scene-1',
      label: '场景 1',
      kind: 'slide-scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
    }],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [],
        interactions: [],
      }],
    }],
  })
}

function injectCandidate() {
  const backend = createSlideAuthoringBackend(
    openSlideAuthoringSession(v9EmptySlideFixture()),
  )
  useEditorStore.getState().injectV9SlideCandidateBackend(backend)
  return backend
}

beforeEach(() => {
  useEditorStore.getState().clearV9SlideCandidateBackend()
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('V9 MediaTab adapter on the real V8 MediaTab', () => {
  it('defaults MediaTab to the V9 slide authoring backend', () => {
    expect(selectSlideBackendKind(useEditorStore.getState())).toBe('slide-authoring')
    const imported = createImageAssetImport(
      { name: 'v9-photo.png', mimeType: 'image/png', bytes: Uint8Array.from([1, 2, 3, 4]) },
      { dimensions: { width: 8, height: 8 } },
    )
    useEditorStore.getState().importAsset(imported.meta, imported.bytes)
    render(
      <MediaTab
        onImportImage={() => undefined}
        onImportAudio={() => undefined}
        onImportVideo={() => undefined}
      />,
    )
    expect(screen.getByTestId(`asset-entry-${imported.meta.id}`)).toBeTruthy()
    expect(selectMediaAssetFiles(useEditorStore.getState())[imported.meta.id]?.byteLength).toBe(4)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.assets[imported.meta.id]).toBeTruthy()
  })

  it('imports image and sound into the candidate sidecar, places on canvas, undoes sidecar, and round-trips archive', async () => {
    injectCandidate()
    const image = createImageAssetImport(
      { name: 'candidate-photo.png', mimeType: 'image/png', bytes: Uint8Array.from([11, 12, 13, 14]) },
      { dimensions: { width: 16, height: 12 } },
    )
    const sound = createMediaAssetImport(
      { name: 'candidate-voice.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([21, 22, 23, 24]) },
      'audio',
      { duration: 1.25 },
    )
    const document = selectSlideAuthoringDocument(useEditorStore.getState())!
    const sidecar = useEditorStore.getState().courseAssetSidecar!
    const imageDeduped = await dedupeCourseMediaImports(
      'image',
      document.assets,
      sidecar,
      [{ meta: image.meta, bytes: image.bytes }],
    )
    const soundDeduped = await dedupeCourseMediaImports(
      'audio',
      document.assets,
      sidecar,
      [{ meta: sound.meta, bytes: sound.bytes }],
    )
    const importedImage = useEditorStore.getState().importV9CandidateMedia({
      items: imageDeduped.additions,
      mode: 'library',
    })
    const importedSound = useEditorStore.getState().importV9CandidateMedia({
      items: soundDeduped.additions,
      nativeType: 'audio',
    })
    expect(importedImage.ok).toBe(true)
    expect(importedSound.ok).toBe(true)
    expect(importedImage.historyEntry).toBe(true)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.assets[image.meta.id]).toMatchObject({
      filename: 'candidate-photo.png',
      kind: 'image',
    })
    expect(selectMediaAssets(useEditorStore.getState())[image.meta.id]).toBeTruthy()
    expect(selectMediaAssetFiles(useEditorStore.getState())[image.meta.id]?.byteLength).toBe(4)
    expect(selectAudioSettings(useEditorStore.getState()).sounds).not.toEqual({})

    render(
      <MediaTab
        onImportImage={() => undefined}
        onImportAudio={() => undefined}
        onImportVideo={() => undefined}
      />,
    )
    expect(screen.getByTestId(`asset-entry-${image.meta.id}`)).toBeTruthy()
    const add = screen.getByRole('button', {
      name: `将图片“${image.meta.filename}”添加到画布`,
    }) as HTMLButtonElement
    expect(add.disabled).toBe(false)
    fireEvent.click(add)

    const placed = selectSlideAuthoringDocument(useEditorStore.getState())!
    const surface = placed.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    expect(surface.scenes[0]!.layerItems.some((item) => (
      item.kind === 'native' && item.content.nativeType === 'image'
    ))).toBe(true)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.assets[image.meta.id]).toBeTruthy()
    expect(selectMediaAssetFiles(useEditorStore.getState())[image.meta.id]?.byteLength).toBe(4)

    useEditorStore.getState().undo()
    const afterUndoPlace = selectSlideAuthoringDocument(useEditorStore.getState())!
    const undoSurface = afterUndoPlace.surfaces[0]
    if (!undoSurface || undoSurface.type !== 'slide') throw new Error('expected slide')
    expect(undoSurface.scenes[0]!.layerItems.some((item) => (
      item.kind === 'native' && item.content.nativeType === 'image'
    ))).toBe(false)
    expect(selectMediaAssetFiles(useEditorStore.getState())[image.meta.id]?.byteLength).toBe(4)

    const zip = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(zip).toBeTruthy()
    const reopened = useEditorStore.getState().reopenV9SlideCandidateArchive(zip!)
    expect(reopened).toBe(true)
    expect(selectMediaAssets(useEditorStore.getState())[image.meta.id]).toBeTruthy()
    expect(selectMediaAssetFiles(useEditorStore.getState())[image.meta.id]?.byteLength).toBe(4)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.schemaVersion).toBe(9)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.assets[image.meta.id]).toBeTruthy()
  })
})
