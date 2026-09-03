import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createVideoNode } from '@/renderer/project/nativeNodeFactories'
import { mountSpatialLocationTryRun } from '@/renderer/ui/spatialLocationTryRun'

const NOW = '2026-08-18T22:00:00.000Z'
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 1, 2, 3])

function spatialVideoProject(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'spatial-try-run-video',
    revision: 1,
    title: '空间视频试运行',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-video': {
        id: 'asset-video',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'media/clip.mp4',
        byteLength: MP4.byteLength,
        width: 320,
        height: 180,
      },
    },
    componentPackages: {},
    designTokens: {
      fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }],
      colors: [{ id: 'text', label: '正文', color: '#172033' }],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: false, musicVolume: 0.3, fadeMs: 0 },
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
      id: 'camera-home',
      label: '全景',
      kind: 'spatial-camera',
      surfaceId: 'surface-spatial',
      cameraFrameId: 'camera-home',
    }],
    startLocationId: 'camera-home',
    surfaces: [{
      id: 'surface-spatial',
      title: '无限画布',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [
          sceneNodeToCourseLayerItem(createVideoNode({
            id: 'world-video',
            name: '讲解视频',
            assetId: 'asset-video',
            width: 320,
            height: 180,
            x: 40,
            y: 40,
          }), 1),
        ],
        paths: [],
        relations: [],
      },
      camera: {
        home: { x: 200, y: 130, zoom: 1 },
        frames: [{ id: 'camera-home', name: '全景', x: 200, y: 130, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  })
}

describe('mountSpatialLocationTryRun world video', () => {
  it('mounts an HTML video from published asset URLs outside SVG foreignObject', async () => {
    const container = document.createElement('div')
    Object.assign(container.style, { width: '400px', height: '240px' })
    document.body.appendChild(container)
    const host = await mountSpatialLocationTryRun({
      container,
      project: spatialVideoProject(),
      assetFiles: { 'asset-video': MP4 },
      locationId: 'camera-home',
      width: 400,
      height: 240,
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toMatch(/^data:video\/mp4/)
    expect(video?.closest('foreignObject')).toBeNull()
    expect(container.querySelector('[data-testid="spatial-world-html"] video')).toBe(video)
    expect(container.querySelector('[data-spatial-world] video')).toBeNull()

    await host.destroy()
    container.remove()
  })

  it('defaults try-run to the 1280×720 logical stage', async () => {
    const container = document.createElement('div')
    Object.assign(container.style, { width: '400px', height: '240px' })
    document.body.appendChild(container)
    const host = await mountSpatialLocationTryRun({
      container,
      project: spatialVideoProject(),
      assetFiles: { 'asset-video': MP4 },
      locationId: 'camera-home',
    })

    const root = container.querySelector<HTMLElement>('.spatial-surface')
    expect(root?.style.width).toBe('1280px')
    expect(root?.style.height).toBe('720px')
    expect(host.camera).toMatchObject({ viewportWidth: 1280, viewportHeight: 720 })

    await host.destroy()
    container.remove()
  })
})
