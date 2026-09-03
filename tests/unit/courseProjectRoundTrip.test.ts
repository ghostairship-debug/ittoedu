import { describe, expect, it } from 'vitest'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  NativeLayerItem,
  ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import { resolveCourseSurfaceBackgroundColor } from '@/shared/courseProjectModel'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course'
import {
  createCourseProjectArchive,
  detectCourseProjectArchiveFormat,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import {
  COURSE_PROJECT_REJECTION_INPUTS,
  COURSE_PROJECT_REJECTION_KIND,
  COURSE_PROJECT_V9_FIXTURE_IDS,
  COURSE_PROJECT_V9_FIXTURE_MTIME,
  readCourseProjectV9FixtureArchive,
} from '../fixtures/course-project-v9'

const NOW = '2026-08-17T13:00:00.000Z'
const ASSET_BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

function textStyle() {
  return {
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: 24,
    color: '#172033',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    emphasis: false,
    highlightColor: null,
    align: 'left' as const,
    verticalAlign: 'top' as const,
    writingMode: 'horizontal' as const,
    lineSpacing: 1.3,
    letterSpacing: 0,
    padding: 4,
    overflow: 'fixed' as const,
    backgroundColor: '#ffffff',
    backgroundOpacity: 0,
    cornerRadius: 0,
  }
}

function nativeText(layerItemId: string, order: number, text: string): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function nativeImage(layerItemId: string, order: number, assetId: string): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 80, y: 160, width: 320, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'image',
      data: {
        assetId,
        preserveAspectRatio: true,
        fit: 'contain',
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        cropX: 0.5,
        cropY: 0.5,
        flipX: false,
        flipY: false,
        cornerRadius: 0,
        feather: { amount: 0, mode: 'rectangle' },
        safeAreas: [],
      },
    },
  }
}

function scoped(item: NativeLayerItem): ScopedLayerItem {
  return {
    item,
    visibility: { mode: 'all', locationIds: [] },
  }
}

function minimalV9Project(): CourseProjectDocument {
  return {
    schemaVersion: 9,
    id: 'r1z-round-trip',
    revision: 1,
    title: 'R1-Z 最小协议',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      badge: {
        id: 'badge',
        filename: 'badge.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/badge.bin',
        byteLength: ASSET_BYTES.byteLength,
        width: 2,
        height: 2,
      },
    },
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
    globalLayerItems: [scoped(nativeText('global-banner', 50, '全局条'))],
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
        layerItems: [
          nativeText('slide-title', 1, '可编辑标题'),
          nativeImage('slide-badge', 2, 'badge'),
        ],
        interactions: [],
      }],
    }],
  }
}

describe('Course Project V9 protocol round-trip', () => {
  it('validates, archives, reopens and publishes a minimal Slide project', () => {
    const project = courseProjectDocumentSchema.parse(minimalV9Project())
    expect(project.schemaVersion).toBe(9)
    expect(project.surfaces).toHaveLength(1)
    expect(project.locations).toHaveLength(1)
    expect(project.globalLayerItems[0]?.item.layerItemId).toBe('global-banner')
    expect(project.assets.badge?.id).toBe('badge')

    const archiveBytes = createCourseProjectArchive({
      project,
      assetFiles: { badge: ASSET_BYTES },
      componentFiles: {},
    }, { mtime: NOW })
    expect(detectCourseProjectArchiveFormat(archiveBytes)).toMatchObject({
      kind: 'v9',
      identity: { schemaVersion: 9, projectId: 'r1z-round-trip', title: 'R1-Z 最小协议' },
    })

    const reopened = openCourseProjectArchive(archiveBytes)
    const reparsed = courseProjectDocumentSchema.parse(reopened.project)
    expect(reparsed).toEqual(project)
    expect([...reopened.assetFiles.badge!]).toEqual([...ASSET_BYTES])

    const titleAddress = makeAuthoringAddress({
      projectId: reparsed.id,
      scope: 'scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      carrier: 'native',
      layerItemId: 'slide-title',
      field: 'content.data.text',
    })
    expect(titleAddress).toBe(
      'courseware://authoring/r1z-round-trip/scene/surface-slide/scene-1/native/slide-title?field=content.data.text',
    )
    expect(titleAddress).not.toMatch(/hit/i)

    const published = buildPublishedCourseV2Payload({
      project: reparsed,
      assetFiles: reopened.assetFiles,
      components: {},
    })
    expect(publishedCourseV2Schema.parse(published)).toEqual(published)
    expect(published.format).toBe('h5course-published')
    expect(published.formatVersion).toBe(2)
    expect(published.sourceSchemaVersion).toBe(9)
    expect(published.courseId).toBe('r1z-round-trip')
    expect(published.locations.map((location) => location.id)).toEqual(['location-scene-1'])
    expect(published.globalLayerItems.map((entry) => entry.item.layerItemId)).toEqual(['global-banner'])
    const slide = published.surfaces[0]
    if (slide?.type !== 'slide') throw new Error('expected slide surface')
    expect(slide.scenes[0]?.layerItems.map((item) => item.layerItemId)).toEqual([
      'slide-title',
      'slide-badge',
    ])
    expect(Object.keys(published.assets)).toEqual(['badge'])
    expect(published.assets.badge?.mimeType).toBe('image/png')
    expect(published.assets.badge?.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it.each([...COURSE_PROJECT_V9_FIXTURE_IDS])(
    'opens, re-archives and publishes committed V9 fixture %s',
    (fixtureId) => {
      const archiveBytes = readCourseProjectV9FixtureArchive(fixtureId)
      expect(archiveBytes.byteLength).toBeGreaterThan(0)
      expect(detectCourseProjectArchiveFormat(archiveBytes)).toMatchObject({
        kind: 'v9',
        identity: { schemaVersion: 9 },
      })

      const opened = openCourseProjectArchive(archiveBytes)
      const parsed = courseProjectDocumentSchema.parse(opened.project)
      expect(parsed.schemaVersion).toBe(9)

      const rebuilt = createCourseProjectArchive(opened, { mtime: COURSE_PROJECT_V9_FIXTURE_MTIME })
      const reopened = openCourseProjectArchive(rebuilt)
      expect(courseProjectDocumentSchema.parse(reopened.project)).toEqual(parsed)
      expect(Object.keys(reopened.assetFiles).sort()).toEqual(Object.keys(opened.assetFiles).sort())
      for (const [assetId, bytes] of Object.entries(opened.assetFiles)) {
        expect([...reopened.assetFiles[assetId]!]).toEqual([...bytes])
      }

      const components = Object.fromEntries(
        Object.values(opened.componentFiles).map((files) => {
          const pkg = parseComponentPackageFiles(files)
          return [pkg.manifest.id, pkg]
        }),
      )
      const published = buildPublishedCourseV2Payload({
        project: parsed,
        assetFiles: opened.assetFiles,
        components,
      })
      expect(publishedCourseV2Schema.parse(published)).toEqual(published)
      expect(published.sourceSchemaVersion).toBe(9)
      expect(published.courseId).toBe(parsed.id)
    },
  )

  it('covers the T0 V9 fixture matrix from committed archives', () => {
    const projects = Object.fromEntries(
      COURSE_PROJECT_V9_FIXTURE_IDS.map((id) => {
        const opened = openCourseProjectArchive(readCourseProjectV9FixtureArchive(id))
        return [id, courseProjectDocumentSchema.parse(opened.project)]
      }),
    )

    const slideNative = projects['slide-native']!
    const slideNativeSurface = slideNative.surfaces[0]
    if (slideNativeSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(slideNativeSurface.scenes[0]?.layerItems.map((item) => item.kind)).toEqual([
      'native',
      'native',
      'native',
      'native',
    ])
    expect(slideNativeSurface.scenes[0]?.layerItems.map((item) => (
      item.kind === 'native' ? item.content.nativeType : item.kind
    ))).toEqual(['text', 'formula', 'image', 'shape'])

    const presentation = projects['slide-presentation-state']!
    const presentationSurface = presentation.surfaces[0]
    if (presentationSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(presentationSurface.scenes[0]?.presentation?.states.map((state) => state.id))
      .toEqual(['state-hidden', 'state-success'])
    expect(presentation.locations.some((location) => location.kind === 'slide-scene' && location.stateId))
      .toBe(true)

    const globalLayer = projects['global-layer-teacher-controller']!
    expect(globalLayer.globalLayerItems.map((entry) => (
      entry.item.kind === 'native' ? entry.item.content.nativeType : entry.item.kind
    ))).toEqual(['text', 'teacher-controller'])
    expect(globalLayer.surfaces[0]?.type === 'slide'
      && globalLayer.surfaces[0].scenes.some((scene) => (
        scene.layerItems.some((item) => (
          item.kind === 'native' && item.content.nativeType === 'teacher-controller'
        ))
      ))).toBe(false)

    const canvas = projects['canvas-runtime']!
    const canvasRuntime = canvas.surfaces[0]?.type === 'slide'
      ? canvas.surfaces[0].scenes[0]?.layerItems.find((item) => item.kind === 'runtime')
      : undefined
    if (canvasRuntime?.kind !== 'runtime') throw new Error('expected canvas runtime')
    expect(canvasRuntime.runtime).toMatchObject({
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
    })
    expect(canvasRuntime.frame.mode).toBe('absolute')

    const surface = projects['surface-runtime']!
    const surfaceRuntime = surface.surfaces[0]?.type === 'slide'
      ? surface.surfaces[0].scenes[0]?.layerItems.find((item) => item.kind === 'runtime')
      : undefined
    if (surfaceRuntime?.kind !== 'runtime') throw new Error('expected surface runtime')
    expect(surfaceRuntime.runtime).toMatchObject({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      renderMode: 'dom',
    })
    expect(surfaceRuntime.frame.mode).toBe('absolute')

    const component = projects.component!
    expect(Object.keys(component.componentPackages)).toEqual(['com.example.v9-quiz'])
    const componentSurface = component.surfaces[0]
    if (componentSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(componentSurface.scenes[0]?.layerItems.some((item) => item.kind === 'component')).toBe(true)

    const flow = projects.flow!
    expect(flow.surfaces[0]?.type).toBe('flow')
    expect(flow.locations[0]?.kind).toBe('flow-block')

    const spatial = projects.spatial!
    expect(spatial.surfaces[0]?.type).toBe('spatial-2d')
    expect(spatial.locations.map((location) => location.kind)).toEqual([
      'spatial-camera',
      'spatial-camera',
    ])

    const mixed = projects.mixed!
    expect(mixed.surfaces.map((entry) => entry.type)).toEqual(['slide', 'flow', 'spatial-2d'])
    expect(mixed.mixedPrintPlan?.entries.map((entry) => entry.kind)).toEqual([
      'slide-scenes',
      'flow-document',
      'spatial-frames',
    ])

    const multiAsset = projects['multi-asset']!
    expect(Object.values(multiAsset.assets).map((asset) => asset.kind).sort()).toEqual([
      'audio',
      'image',
      'image',
      'video',
    ])
  })

  it('archives a Spatial project without injecting omitted backgroundColor, and keeps an explicit color', () => {
    const omittedColor: CourseProjectDocument = {
      ...minimalV9Project(),
      id: 'r1z-spatial-white',
      locations: [{
        id: 'camera-home',
        label: '全景',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'camera-home',
      }],
      startLocationId: 'camera-home',
      globalLayerItems: [],
      surfaces: [{
        id: 'surface-spatial',
        title: '无限画布',
        type: 'spatial-2d',
        surfaceLayerItems: [],
        world: {
          bounds: { mode: 'infinite' },
          layerItems: [nativeText('world-note', 1, '便签')],
          paths: [],
          relations: [],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [{ id: 'camera-home', name: '全景', x: 0, y: 0, zoom: 1 }],
        },
        semanticZoom: [],
      }],
    }

    const parsedOmitted = courseProjectDocumentSchema.parse(omittedColor)
    const omittedSurface = parsedOmitted.surfaces[0]
    if (omittedSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(omittedSurface.backgroundColor).toBeUndefined()
    expect(resolveCourseSurfaceBackgroundColor(omittedSurface.backgroundColor)).toBe('#ffffff')

    const omittedArchive = createCourseProjectArchive({
      project: parsedOmitted,
      assetFiles: { badge: ASSET_BYTES },
      componentFiles: {},
    }, { mtime: NOW })
    const reopenedOmitted = openCourseProjectArchive(omittedArchive)
    const reparsedOmitted = courseProjectDocumentSchema.parse(reopenedOmitted.project)
    expect(reparsedOmitted).toEqual(parsedOmitted)
    const reopenedSurface = reparsedOmitted.surfaces[0]
    if (reopenedSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(reopenedSurface.backgroundColor).toBeUndefined()

    const withColor = structuredClone(parsedOmitted)
    const coloredSurface = withColor.surfaces[0]
    if (coloredSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    coloredSurface.backgroundColor = '#f1f5f9'
    withColor.id = 'r1z-spatial-color'
    const parsedColor = courseProjectDocumentSchema.parse(withColor)
    const colorArchive = createCourseProjectArchive({
      project: parsedColor,
      assetFiles: { badge: ASSET_BYTES },
      componentFiles: {},
    }, { mtime: NOW })
    const reopenedColor = openCourseProjectArchive(colorArchive)
    expect(courseProjectDocumentSchema.parse(reopenedColor.project)).toEqual(parsedColor)
    const kept = reopenedColor.project.surfaces[0]
    if (kept?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(kept.backgroundColor).toBe('#f1f5f9')
  })

  it('archives a Flow project with optional paper backgroundColor', () => {
    const project: CourseProjectDocument = {
      ...minimalV9Project(),
      id: 'r1z-flow-paper',
      locations: [{
        id: 'heading-1',
        label: '标题',
        kind: 'flow-block',
        surfaceId: 'surface-flow',
        blockId: 'heading-1',
      }],
      startLocationId: 'heading-1',
      globalLayerItems: [],
      surfaces: [{
        id: 'surface-flow',
        title: '讲义',
        type: 'flow',
        backgroundColor: '#fffbeb',
        surfaceLayerItems: [],
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [
          { id: 'heading-1', type: 'heading', level: 1, text: '标题' },
          { id: 'paragraph-1', type: 'paragraph', text: '正文' },
        ],
      }],
    }

    const parsed = courseProjectDocumentSchema.parse(project)
    const archiveBytes = createCourseProjectArchive({
      project: parsed,
      assetFiles: { badge: ASSET_BYTES },
      componentFiles: {},
    }, { mtime: NOW })
    const reopened = openCourseProjectArchive(archiveBytes)
    const reparsed = courseProjectDocumentSchema.parse(reopened.project)
    expect(reparsed).toEqual(parsed)
    const surface = reparsed.surfaces[0]
    if (surface?.type !== 'flow') throw new Error('expected flow surface')
    expect(surface.backgroundColor).toBe('#fffbeb')
  })

  it.each([...COURSE_PROJECT_REJECTION_KIND])(
    'rejects %s bytes as unsupported or corrupted and never round-trips them as V9',
    (kind) => {
      const bytes = COURSE_PROJECT_REJECTION_INPUTS[kind]
      const probe = detectCourseProjectArchiveFormat(bytes)
      expect(probe.kind).not.toBe('v9')
      if (kind === 'v8-unsupported') {
        expect(probe).toMatchObject({ kind: 'unsupported', identity: { schemaVersion: 8 } })
      } else if (kind === 'future-unsupported') {
        expect(probe).toMatchObject({ kind: 'unsupported', identity: { schemaVersion: 10 } })
      } else {
        expect(probe.kind).toBe('corrupted')
      }
      expect(() => openCourseProjectArchive(bytes)).toThrow()
    },
  )
})
