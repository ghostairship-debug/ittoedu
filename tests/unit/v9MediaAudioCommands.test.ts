import { describe, expect, it } from 'vitest'
import { AudioManager } from '@/player/AudioManager'
import { CourseEventBus } from '@/player/CourseEventBus'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type LayerItem,
  type NativeLayerItem,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import {
  createImageAssetImport,
  createMediaAssetImport,
} from '@/renderer/project/assetManager'
import {
  layoutMediaBatchFrames,
  MEDIA_BATCH_CANVAS_LIMIT,
  planMediaBatchImport,
} from '@/renderer/project/mediaBatch'
import { addSlideImageLayer } from '@/renderer/course/v9SlideContentCommands'
import {
  addCourseLibraryMediaToCanvas,
  collectCoursePublishedAssetIds,
  courseMediaSidecarIsComplete,
  dedupeCourseMediaImports,
  deleteCourseAsset,
  deleteCourseSound,
  importAndPlaceCourseMedia,
  importCourseMediaAssets,
  importCourseSounds,
  nextCourseMediaSession,
  openCourseMediaSession,
  pruneCourseMediaSidecar,
  readCourseMediaLibrary,
  readCourseSoundPreview,
  replaceCourseLayerMedia,
  updateCourseAudioSettings,
  updateCourseMediaFitCrop,
  updateCourseSound,
} from '@/renderer/course/v9MediaAudioCommands'

/**
 * Proves V9 media/audio command + asset sidecar adapters.
 * Does not prove the real MediaTab, App, store, Workspace, or Player wiring.
 * Default product remains V8; these commands are the candidate backend only.
 */
const NOW = '2026-08-17T14:00:00.000Z'

function imageMeta(id: string, filename = `${id}.png`): AssetMeta {
  return {
    id,
    filename,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: 4,
    width: 800,
    height: 600,
  }
}

function videoMeta(id: string): AssetMeta {
  return {
    id,
    filename: `${id}.mp4`,
    mimeType: 'video/mp4',
    kind: 'video',
    path: `assets/${id}.mp4`,
    byteLength: 8,
    width: 1280,
    height: 720,
    duration: 12,
  }
}

function audioMeta(id: string, filename = `${id}.mp3`): AssetMeta {
  return {
    id,
    filename,
    mimeType: 'audio/mpeg',
    kind: 'audio',
    path: `assets/${id}.mp3`,
    byteLength: 6,
    duration: 4,
  }
}

function documentShell(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r3b-media-audio',
    revision: 1,
    title: 'R3-B media audio',
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

function requireMedia(
  result: ReturnType<typeof importCourseMediaAssets>,
): ReturnType<typeof nextCourseMediaSession> {
  expect(result.ok, result.reason).toBe(true)
  return nextCourseMediaSession(result)
}

function sceneItems(media: ReturnType<typeof openCourseMediaSession>) {
  const surface = media.session.history.present.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected slide')
  return surface.scenes[0]!.layerItems
}

function requireNativeLayer(item: LayerItem | undefined): NativeLayerItem {
  if (!item || item.kind !== 'native') throw new Error('expected native layer')
  return item
}

describe('V9 media/audio commands (MediaTab not wired)', () => {
  it('keeps the V8 assetManager factory as the default import path', () => {
    const imported = createImageAssetImport(
      { name: 'photo.png', mimeType: 'image/png', bytes: Uint8Array.from([1, 2, 3, 4]) },
      { id: 'asset_v8_default', dimensions: { width: 100, height: 50 } },
    )
    expect(imported.meta.path).toBe('assets/asset_v8_default.png')
    expect(imported.meta.kind).toBe('image')
    const audio = createMediaAssetImport(
      { name: 'voice.mp3', mimeType: 'audio/mpeg', bytes: Uint8Array.from([9, 8, 7]) },
      'audio',
      { duration: 1.5 },
      { id: 'asset_v8_audio' },
    )
    expect(audio.meta.path).toBe('assets/asset_v8_audio.mp3')
    expect(audio.meta.kind).toBe('audio')
  })

  it('imports image/video into the V9 library sidecar, reuses content hashes, and places via R2-D', async () => {
    const source = documentShell()
    let media = openCourseMediaSession(source)
    const firstBytes = Uint8Array.from([1, 2, 3, 4])
    const imported = importCourseMediaAssets(media, [
      { meta: imageMeta('asset-photo'), bytes: firstBytes },
      { meta: videoMeta('asset-clip'), bytes: Uint8Array.from([5, 6, 7, 8, 9, 10, 11, 12]) },
    ], { now: NOW })
    expect(imported.historyEntry).toBe(true)
    media = requireMedia(imported)
    expect(source.assets).toEqual({})
    expect(media.session.history.present.schemaVersion).toBe(9)
    expect(media.sidecar.files['asset-photo']).toEqual(firstBytes)
    expect(courseMediaSidecarIsComplete(media)).toBe(true)

    const library = readCourseMediaLibrary(media)
    expect(library.imageAssets.map((asset) => asset.id)).toEqual(['asset-photo'])
    expect(library.videoAssets.map((asset) => asset.id)).toEqual(['asset-clip'])

    const duplicate = await dedupeCourseMediaImports(
      'image',
      media.session.history.present.assets,
      media.sidecar,
      [{ meta: imageMeta('asset-photo-copy'), bytes: Uint8Array.from([1, 2, 3, 4]) }],
    )
    expect(duplicate.duplicateCount).toBe(1)
    expect(duplicate.placements[0]?.meta.id).toBe('asset-photo')
    const reused = importCourseMediaAssets(media, duplicate.placements, { now: NOW })
    expect(reused.historyEntry).toBe(false)
    expect(reused.reusedAssetIds).toEqual(['asset-photo'])
    expect(addSlideImageLayer(media.session, { assetId: 'asset-photo' }, { now: NOW }).ok).toBe(true)

    media = requireMedia(addCourseLibraryMediaToCanvas(media, 'asset-photo', {}, { now: NOW }))
    expect(requireNativeLayer(sceneItems(media)[0]).content).toMatchObject({
      nativeType: 'image',
      data: { assetId: 'asset-photo' },
    })
    const firstX = sceneItems(media)[0]!.frame.x
    media = requireMedia(addCourseLibraryMediaToCanvas(media, 'asset-photo', {}, { now: NOW }))
    expect(sceneItems(media)[1]?.frame.x).toBe(firstX + 20)
  })

  it('batch-places with the MediaTab grid, overflows to the library, and supports replace/crop/delete protection', () => {
    let media = openCourseMediaSession(documentShell())
    const batch = [0, 1, 2].map((index) => ({
      meta: imageMeta(`asset-batch-${index}`),
      bytes: Uint8Array.from([index, index + 1, index + 2, index + 3]),
    }))
    const placed = importAndPlaceCourseMedia(media, {
      items: batch,
      nativeType: 'image',
      mode: 'add',
    }, { now: NOW })
    expect(placed.ok).toBe(true)
    expect(placed.destination).toBe('canvas')
    expect(placed.historyEntry).toBe(true)
    expect(placed.placedLayerItemIds).toHaveLength(3)
    media = requireMedia(placed)
    expect(media.session.history.past).toHaveLength(1)
    const frames = sceneItems(media).map((item) => item.frame)
    expect(frames).toHaveLength(3)
    for (const frame of frames) {
      expect(frame.x).toBeGreaterThanOrEqual(0)
      expect(frame.y).toBeGreaterThanOrEqual(0)
      expect(frame.x + frame.width).toBeLessThanOrEqual(1280)
      expect(frame.y + frame.height).toBeLessThanOrEqual(720)
    }
    const laidOut = layoutMediaBatchFrames(batch.map((item) => ({
      width: 640,
      height: 480,
    })))
    expect(laidOut).toHaveLength(3)
    expect(planMediaBatchImport('add', MEDIA_BATCH_CANVAS_LIMIT + 1, MEDIA_BATCH_CANVAS_LIMIT))
      .toMatchObject({ destination: 'library', overflowToLibrary: true })

    const overflowItems = Array.from({ length: MEDIA_BATCH_CANVAS_LIMIT + 1 }, (_, index) => ({
      meta: imageMeta(`asset-overflow-${index}`),
      bytes: Uint8Array.from([index, 1, 2, 3]),
    }))
    const overflow = importAndPlaceCourseMedia(media, {
      items: overflowItems,
      nativeType: 'image',
      mode: 'add',
    }, { now: NOW })
    expect(overflow.destination).toBe('library')
    expect(overflow.libraryFallback).toBe('batch-size')
    expect(overflow.placedLayerItemIds).toEqual([])
    media = requireMedia(overflow)

    const layerId = placed.placedLayerItemIds![0]!
    media = requireMedia(replaceCourseLayerMedia(media, layerId, {
      meta: imageMeta('asset-replaced'),
      bytes: Uint8Array.from([9, 9, 9, 9]),
    }, { now: NOW }))
    expect(requireNativeLayer(sceneItems(media)[0]).content).toMatchObject({
      nativeType: 'image',
      data: { assetId: 'asset-replaced' },
    })
    media = requireMedia(updateCourseMediaFitCrop(media, layerId, {
      fit: 'cover',
      crop: { left: 0.1, top: 0.05, right: 0.08, bottom: 0.04 },
      cropX: 0.3,
      cropY: 0.7,
    }, { now: NOW }))
    expect(requireNativeLayer(sceneItems(media)[0]).content).toMatchObject({
      data: {
        fit: 'cover',
        crop: { left: 0.1, top: 0.05, right: 0.08, bottom: 0.04 },
      },
    })

    const blocked = deleteCourseAsset(media, 'asset-replaced')
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toContain('该素材仍被引用')
    expect(blocked.historyEntry).toBe(false)
    expect(media.session.history.present.assets['asset-overflow-0']).toBeTruthy()
    media = requireMedia(deleteCourseAsset(media, 'asset-overflow-0', { now: NOW }))
    expect(media.session.history.present.assets['asset-overflow-0']).toBeUndefined()
    expect(media.sidecar.files['asset-overflow-0']).toBeUndefined()
  })

  it('imports sounds with preview bytes, rename, volume/mute/channel/ducking, and interaction delete protection', () => {
    let media = openCourseMediaSession(documentShell())
    const imported = importCourseSounds(media, [{
      meta: audioMeta('asset-rain', 'rain.mp3'),
      bytes: Uint8Array.from([1, 2, 3, 4, 5, 6]),
    }], { now: NOW, sound: { name: '雨声', channel: 'sfx' } })
    expect(imported.ok).toBe(true)
    expect(imported.soundIds).toHaveLength(1)
    media = requireMedia(imported)
    const soundId = imported.soundIds![0]!
    const preview = readCourseSoundPreview(media, soundId)
    expect(preview?.asset?.filename).toBe('rain.mp3')
    expect(preview?.bytes).toEqual(Uint8Array.from([1, 2, 3, 4, 5, 6]))
    expect(readCourseMediaLibrary(media).sounds[0]?.sound.name).toBe('雨声')

    media = requireMedia(updateCourseSound(media, soundId, {
      name: '檐下雨声',
      channel: 'music',
      defaultVolume: 0.35,
      defaultLoop: true,
    }, { now: NOW }))
    expect(media.session.history.present.media.audio.sounds[soundId]).toMatchObject({
      name: '檐下雨声',
      channel: 'music',
      defaultVolume: 0.35,
      defaultLoop: true,
    })

    media = requireMedia(updateCourseAudioSettings(media, {
      defaultMuted: true,
      masterVolume: 0.72,
      channelVolumes: { music: 0.11, narration: 0.22, sfx: 0.33, ui: 0.44, video: 0.55 },
      narrationDucking: { enabled: false, musicVolume: 0.18 },
    }, { now: NOW }))
    expect(media.session.history.present.media.audio).toMatchObject({
      defaultMuted: true,
      masterVolume: 0.72,
      channelVolumes: {
        music: 0.11,
        narration: 0.22,
        sfx: 0.33,
        ui: 0.44,
        video: 0.55,
      },
      narrationDucking: { enabled: false, musicVolume: 0.18 },
    })

    const events = new CourseEventBus()
    const manager = new AudioManager(
      media.session.history.present,
      (assetId) => `data:audio/mock,${assetId}`,
      events,
    )
    expect(manager.muted()).toBe(true)
    expect(manager.masterVolume()).toBe(0.72)
    manager.destroy()

    const withRule = structuredClone(media.session.history.present)
    const surface = withRule.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    surface.scenes[0]!.interactions = [{
      id: 'rule-play-rain',
      name: '开场播放',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'action-play',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'audio.play', soundId },
      }],
    }]
    const referenced = openCourseMediaSession(withRule, media.sidecar)
    const blockedSound = deleteCourseSound(referenced, soundId)
    expect(blockedSound.ok).toBe(false)
    expect(blockedSound.reason).toContain('该声音仍被交互规则引用')
    expect(blockedSound.historyEntry).toBe(false)

    const blockedAsset = deleteCourseAsset(media, 'asset-rain')
    expect(blockedAsset.ok).toBe(false)
    expect(blockedAsset.reason).toContain('该素材仍被引用')

    media = requireMedia(deleteCourseSound(media, soundId, { now: NOW }))
    expect(media.session.history.present.media.audio.sounds[soundId]).toBeUndefined()
    expect(readCourseMediaLibrary(media).unusedAudioAssets.map((asset) => asset.id))
      .toEqual(['asset-rain'])
    media = requireMedia(deleteCourseAsset(media, 'asset-rain', { now: NOW }))
    expect(collectCoursePublishedAssetIds(media.session.history.present).size).toBe(0)
    const pruned = pruneCourseMediaSidecar(media)
    expect(pruned.historyEntry).toBe(false)
    expect(Object.keys(pruned.sidecar.files)).toEqual([])
  })
})
