import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type {
  CourseProjectDocument,
  FlowSurfaceDocument,
  SlideSurfaceDocument,
  SpatialSurfaceDocument,
} from '@/shared/courseProjectTypes'
import type {
  PublishedCourseV2Payload,
  PublishedFlowSurface,
  PublishedSlideSurface,
  PublishedSpatialSurface,
} from '@/shared/publishedCourseTypes'
import {
  buildPublishedCourseV2Payload,
  collectPublishedCourseAssetIds,
} from '@/renderer/export/course/buildPublishedCourse'
import { buildCoursePptx } from '@/renderer/export/course/buildCoursePptx'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import { renderPublishedSpatialFrameSvg } from '@/player/surfaces/spatial/publishedSpatialStaticRendering'
import { resolveEffectiveBackground } from '@/shared/effectiveBackground'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

const NOW = '2026-09-05T00:00:00.000Z'
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const ASSET_FILES: Record<string, Uint8Array> = {
  'course-bg-asset': PNG_BYTES,
  'slide-surface-bg-asset': PNG_BYTES,
  'scene-own-bg-asset': PNG_BYTES,
  'state-bg-asset': PNG_BYTES,
  'flow-own-bg-asset': PNG_BYTES,
}

function createMultiSurfaceProject(): CourseProjectDocument {
  const project = createBlankCourseProject({
    id: 'test-course-stage-c',
    title: 'Stage C 端到端测试课程',
    now: NOW,
  })

  // 1. Course-level background
  project.backgroundColor = '#1E293B'
  project.backgroundAssetId = 'course-bg-asset'
  project.assets['course-bg-asset'] = {
    id: 'course-bg-asset',
    filename: 'course-bg.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/course-bg.png',
    byteLength: PNG_BYTES.byteLength,
  }
  project.assets['slide-surface-bg-asset'] = {
    id: 'slide-surface-bg-asset',
    filename: 'slide-surface-bg.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/slide-surface-bg.png',
    byteLength: PNG_BYTES.byteLength,
  }
  project.assets['scene-own-bg-asset'] = {
    id: 'scene-own-bg-asset',
    filename: 'scene-own-bg.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/scene-own-bg.png',
    byteLength: PNG_BYTES.byteLength,
  }
  project.assets['state-bg-asset'] = {
    id: 'state-bg-asset',
    filename: 'state-bg.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/state-bg.png',
    byteLength: PNG_BYTES.byteLength,
  }
  project.assets['flow-own-bg-asset'] = {
    id: 'flow-own-bg-asset',
    filename: 'flow-own-bg.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/flow-own-bg.png',
    byteLength: PNG_BYTES.byteLength,
  }

  // Slide surface 1: inherit from Course
  const slideSurface1 = project.surfaces[0] as SlideSurfaceDocument
  slideSurface1.backgroundMode = 'inherit'
  const scene1 = slideSurface1.scenes[0]!
  scene1.backgroundMode = 'inherit'

  // Slide surface 2: own mode override
  const scene2A = {
    id: 'scene-2a',
    name: '幻灯片 2A',
    backgroundMode: 'inherit' as const,
    backgroundColor: '#FFFFFF',
    layerItems: [],
    interactions: [],
  }
  const scene2B = {
    id: 'scene-2b',
    name: '幻灯片 2B',
    backgroundMode: 'own' as const,
    backgroundColor: '#475569',
    backgroundAssetId: 'scene-own-bg-asset',
    layerItems: [],
    interactions: [],
    presentation: {
      initialStateId: 'state-initial',
      states: [
        {
          id: 'state-initial',
          name: '初始状态',
          layerItemOverrides: {},
        },
        {
          id: 'state-override-color',
          name: '仅覆写颜色',
          backgroundColor: '#0F172A',
          layerItemOverrides: {},
        },
        {
          id: 'state-clear-asset',
          name: '显式清除图片',
          backgroundAssetId: null,
          layerItemOverrides: {},
        },
        {
          id: 'state-both-override',
          name: '颜色与图片均覆写',
          backgroundColor: '#0284C7',
          backgroundAssetId: 'state-bg-asset',
          layerItemOverrides: {},
        },
      ],
    },
  }
  const slideSurface2: SlideSurfaceDocument = {
    id: 'surface-slide-2',
    type: 'slide',
    title: '幻灯片表面 2（Own 模式）',
    backgroundMode: 'own',
    backgroundColor: '#334155',
    backgroundAssetId: 'slide-surface-bg-asset',
    canvas: { width: 1280, height: 720 },
    scenes: [scene2A, scene2B],
    surfaceLayerItems: [],
  }

  // Flow surface: inherit from Course
  const flowSurface: FlowSurfaceDocument = {
    id: 'surface-flow-1',
    type: 'flow',
    title: '流式讲义（继承课程背景）',
    backgroundMode: 'inherit',
    layout: { readingWidth: 760, wideContentWidth: 960 },
    blocks: [
      {
        id: 'flow-p-1',
        type: 'paragraph',
        text: '流式讲义正文内容',
        runs: [],
      },
    ],
    surfaceLayerItems: [],
  }

  // Spatial surface: inherit from Course
  const spatialSurface: SpatialSurfaceDocument = {
    id: 'surface-spatial-1',
    type: 'spatial-2d',
    title: '空间画布（继承课程背景）',
    backgroundMode: 'inherit',
    world: {
      bounds: { mode: 'infinite' },
      layerItems: [],
      paths: [],
      relations: [],
    },
    camera: {
      home: { x: 0, y: 0, zoom: 1 },
      frames: [
        { id: 'frame-home', name: '全景视角', x: 0, y: 0, zoom: 1 },
      ],
    },
    semanticZoom: [],
    surfaceLayerItems: [],
  }

  project.surfaces.push(slideSurface2, flowSurface, spatialSurface)

  // Add locations
  project.locations.push(
    { id: 'loc-scene-2a', label: '幻灯片 2A', kind: 'slide-scene', surfaceId: 'surface-slide-2', sceneId: 'scene-2a' },
    { id: 'loc-scene-2b', label: '幻灯片 2B', kind: 'slide-scene', surfaceId: 'surface-slide-2', sceneId: 'scene-2b' },
    { id: 'loc-flow-1', label: '流式讲义段落', kind: 'flow-block', surfaceId: 'surface-flow-1', blockId: 'flow-p-1' },
    { id: 'loc-spatial-1', label: '空间视角', kind: 'spatial-camera', surfaceId: 'surface-spatial-1', cameraFrameId: 'frame-home' },
  )

  project.mixedPrintPlan = {
    pageSize: 'surface-native',
    orientation: 'auto',
    entries: [
      { id: 'print-slide-1', kind: 'slide-scenes', surfaceId: slideSurface1.id, sceneIds: [slideSurface1.scenes[0]!.id] },
      { id: 'print-slide-2', kind: 'slide-scenes', surfaceId: 'surface-slide-2', sceneIds: ['scene-2a', 'scene-2b'] },
      { id: 'print-flow', kind: 'flow-document', surfaceId: 'surface-flow-1' },
      { id: 'print-spatial', kind: 'spatial-frames', surfaceId: 'surface-spatial-1', cameraFrameIds: ['frame-home'] },
    ],
  }

  return project
}

describe('Stage C Background Authoring & Publishing Full-Loop End-to-End', () => {
  it('publishes all background fields and collects background asset ids correctly', () => {
    const project = createMultiSurfaceProject()
    const collectedAssetIds = collectPublishedCourseAssetIds({
      project,
      components: {},
    })
    expect(collectedAssetIds).toContain('course-bg-asset')
    expect(collectedAssetIds).toContain('slide-surface-bg-asset')
    expect(collectedAssetIds).toContain('scene-own-bg-asset')
    expect(collectedAssetIds).toContain('state-bg-asset')

    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: ASSET_FILES,
      components: {},
    })

    // Course background
    expect(published.backgroundColor).toBe('#1E293B')
    expect(published.backgroundAssetId).toBe('course-bg-asset')

    // Surfaces
    const pSlide1 = published.surfaces.find((s) => s.id === project.surfaces[0]!.id) as PublishedSlideSurface
    expect(pSlide1.backgroundMode).toBe('inherit')
    expect(pSlide1.scenes[0]!.backgroundMode).toBe('inherit')

    const pSlide2 = published.surfaces.find((s) => s.id === 'surface-slide-2') as PublishedSlideSurface
    expect(pSlide2.backgroundMode).toBe('own')
    expect(pSlide2.backgroundColor).toBe('#334155')
    expect(pSlide2.backgroundAssetId).toBe('slide-surface-bg-asset')
    expect(pSlide2.scenes[0]!.backgroundMode).toBe('inherit')
    expect(pSlide2.scenes[1]!.backgroundMode).toBe('own')
    expect(pSlide2.scenes[1]!.backgroundColor).toBe('#475569')
    expect(pSlide2.scenes[1]!.backgroundAssetId).toBe('scene-own-bg-asset')

    const pFlow = published.surfaces.find((s) => s.id === 'surface-flow-1') as PublishedFlowSurface
    expect(pFlow.backgroundMode).toBe('inherit')

    const pSpatial = published.surfaces.find((s) => s.id === 'surface-spatial-1') as PublishedSpatialSurface
    expect(pSpatial.backgroundMode).toBe('inherit')
  })

  it('resolves background precedence across all 6 owners with complete fidelity', () => {
    const project = createMultiSurfaceProject()
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: ASSET_FILES,
      components: {},
    })

    const pSlide1 = published.surfaces.find((s) => s.id === project.surfaces[0]!.id) as PublishedSlideSurface
    const pSlide2 = published.surfaces.find((s) => s.id === 'surface-slide-2') as PublishedSlideSurface
    const pFlow = published.surfaces.find((s) => s.id === 'surface-flow-1') as PublishedFlowSurface
    const pSpatial = published.surfaces.find((s) => s.id === 'surface-spatial-1') as PublishedSpatialSurface

    // 1. Course owner
    const bgCourse = resolveEffectiveBackground({
      owner: 'course',
      course: published,
    })
    expect(bgCourse).toEqual({
      color: '#1E293B',
      assetId: 'course-bg-asset',
      sourceOwner: 'course',
    })

    // 2. Slide surface 1 (inherit)
    const bgSlide1 = resolveEffectiveBackground({
      owner: 'slide-surface',
      course: published,
      surface: pSlide1,
    })
    expect(bgSlide1).toEqual({
      color: '#1E293B',
      assetId: 'course-bg-asset',
      sourceOwner: 'course',
    })

    // 3. Slide scene 1 (inherit -> inherit)
    const bgScene1 = resolveEffectiveBackground({
      owner: 'slide-scene',
      course: published,
      surface: pSlide1,
      scene: pSlide1.scenes[0]!,
    })
    expect(bgScene1).toEqual({
      color: '#1E293B',
      assetId: 'course-bg-asset',
      sourceOwner: 'course',
    })

    // 4. Slide surface 2 (own mode)
    const bgSlide2 = resolveEffectiveBackground({
      owner: 'slide-surface',
      course: published,
      surface: pSlide2,
    })
    expect(bgSlide2).toEqual({
      color: '#334155',
      assetId: 'slide-surface-bg-asset',
      sourceOwner: 'slide-surface',
    })

    // 5. Slide scene 2A (inherit from surface 2)
    const bgScene2A = resolveEffectiveBackground({
      owner: 'slide-scene',
      course: published,
      surface: pSlide2,
      scene: pSlide2.scenes[0]!,
    })
    expect(bgScene2A).toEqual({
      color: '#334155',
      assetId: 'slide-surface-bg-asset',
      sourceOwner: 'slide-surface',
    })

    // 6. Slide scene 2B (own mode)
    const bgScene2B = resolveEffectiveBackground({
      owner: 'slide-scene',
      course: published,
      surface: pSlide2,
      scene: pSlide2.scenes[1]!,
    })
    expect(bgScene2B).toEqual({
      color: '#475569',
      assetId: 'scene-own-bg-asset',
      sourceOwner: 'slide-scene',
    })

    // 7. Slide Named state overrides on Scene 2B
    const states = (project.surfaces[1] as SlideSurfaceDocument).scenes[1]!.presentation!.states
    // State 1: only overrides color -> inherits scene asset
    const state1 = states.find((s) => s.id === 'state-override-color')!
    const bgState1 = resolveEffectiveBackground({
      owner: 'slide-state',
      course: published,
      surface: pSlide2,
      scene: pSlide2.scenes[1]!,
      state: state1,
    })
    expect(bgState1).toEqual({
      color: '#0F172A',
      assetId: 'scene-own-bg-asset',
      sourceOwner: 'slide-state',
    })

    // State 2: explicitly clears asset (backgroundAssetId: null) -> inherits scene color
    const state2 = states.find((s) => s.id === 'state-clear-asset')!
    const bgState2 = resolveEffectiveBackground({
      owner: 'slide-state',
      course: published,
      surface: pSlide2,
      scene: pSlide2.scenes[1]!,
      state: state2,
    })
    expect(bgState2).toEqual({
      color: '#475569',
      assetId: null,
      sourceOwner: 'slide-state',
    })

    // State 3: overrides both color and asset
    const state3 = states.find((s) => s.id === 'state-both-override')!
    const bgState3 = resolveEffectiveBackground({
      owner: 'slide-state',
      course: published,
      surface: pSlide2,
      scene: pSlide2.scenes[1]!,
      state: state3,
    })
    expect(bgState3).toEqual({
      color: '#0284C7',
      assetId: 'state-bg-asset',
      sourceOwner: 'slide-state',
    })

    // 8. Flow surface (inherit from Course)
    const bgFlow = resolveEffectiveBackground({
      owner: 'flow-surface',
      course: published,
      surface: pFlow,
    })
    expect(bgFlow).toEqual({
      color: '#1E293B',
      assetId: 'course-bg-asset',
      sourceOwner: 'course',
    })

    // 9. Spatial surface (inherit from Course)
    const bgSpatial = resolveEffectiveBackground({
      owner: 'spatial-surface',
      course: published,
      surface: pSpatial,
    })
    expect(bgSpatial).toEqual({
      color: '#1E293B',
      assetId: 'course-bg-asset',
      sourceOwner: 'course',
    })
  })

  it('exports PPTX with full slide background color and full-page background image', async () => {
    const project = createMultiSurfaceProject()
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: ASSET_FILES,
      components: {},
    })

    const pptxResult = await buildCoursePptx(published)

    const unzipped = unzipSync(pptxResult.bytes)
    const slideXmls = Object.entries(unzipped)
      .filter(([name]) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .map(([, b]) => strFromU8(b))

    expect(slideXmls.length).toBeGreaterThan(0)

    // Verify background tag in PPTX slide
    const hasSolidFill = slideXmls.some((xml) => xml.includes('<p:bg><p:bgPr><a:solidFill>'))
    const hasBgImage = slideXmls.some((xml) => xml.includes('背景图片'))
    expect(hasSolidFill).toBe(true)
    expect(hasBgImage).toBe(true)

    // Verify background image file in ppt/media
    const mediaFiles = Object.keys(unzipped).filter((name) => name.startsWith('ppt/media/'))
    expect(mediaFiles.length).toBeGreaterThan(0)
  })

  it('exports Flow continuous DOCX with full-page header background image and background color', () => {
    const project = createMultiSurfaceProject()
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: ASSET_FILES,
      components: {},
    })

    const docxResult = buildFlowDocx(published, 'surface-flow-1', {
      resolveAsset: (id) => (id === 'course-bg-asset' ? { bytes: PNG_BYTES, mimeType: 'image/png' } : undefined),
    })

    expect(docxResult.layerReport.some((r) => r.reasonCode === 'surface-background-image' && r.disposition === 'preserved')).toBe(true)

    const unzipped = unzipSync(docxResult.bytes)

    // header1.xml exists and has behindDoc="1", relativeHeight="0", relativeFrom="page"
    expect(unzipped['word/header1.xml']).toBeDefined()
    const headerXml = strFromU8(unzipped['word/header1.xml']!)
    expect(headerXml).toContain('behindDoc="1"')
    expect(headerXml).toContain('relativeHeight="0"')
    expect(headerXml).toContain('relativeFrom="page"')
    expect(headerXml).toContain('<a:blip r:embed="rId1"')

    // header1.xml.rels links to background image
    expect(unzipped['word/_rels/header1.xml.rels']).toBeDefined()
    const headerRels = strFromU8(unzipped['word/_rels/header1.xml.rels']!)
    expect(headerRels).toContain('Target="media/bgimage.png"')

    // media file in package
    expect(unzipped['word/media/bgimage.png']).toBeDefined()

    // document.xml references header1 and sets background color
    const docXml = strFromU8(unzipped['word/document.xml']!)
    expect(docXml).toContain('<w:headerReference w:type="default"')
    expect(docXml).toContain('<w:background w:color="1E293B"/>')

    // document.xml.rels references header1.xml
    const docRels = strFromU8(unzipped['word/_rels/document.xml.rels']!)
    expect(docRels).toContain('Target="header1.xml"')

    // [Content_Types].xml overrides header1.xml
    const contentTypes = strFromU8(unzipped['[Content_Types].xml']!)
    expect(contentTypes).toContain('PartName="/word/header1.xml"')
  })

  it('renders Spatial static SVG with effective inherited background color', () => {
    const project = createMultiSurfaceProject()
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: ASSET_FILES,
      components: {},
    })
    const pSpatial = published.surfaces.find((s) => s.id === 'surface-spatial-1') as PublishedSpatialSurface

    const { svg } = renderPublishedSpatialFrameSvg(
      pSpatial,
      'frame-home',
      () => undefined,
      { published, locationId: 'loc-spatial-1' },
    )

    // Spatial SVG background rect fills with inherited Course color '#1E293B'
    expect(svg).toContain('<rect width="100%" height="100%" fill="#1E293B"/>')
  })

  it('handles missing background assets with warnings and preserves background colors across all pipelines', async () => {
    const project = createMultiSurfaceProject()
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: ASSET_FILES,
      components: {},
    })
    // Delete published assets to simulate missing assets at export time
    delete published.assets['course-bg-asset']
    delete published.assets['scene-own-bg-asset']

    // 1. PPTX missing asset handling
    const pptxResult = await buildCoursePptx(published)
    // Warnings recorded for missing background assets
    expect(pptxResult.warnings.some((w) => w.includes('背景素材缺失'))).toBe(true)
    const pptxUnzipped = unzipSync(pptxResult.bytes)
    const slideXmls = Object.entries(pptxUnzipped)
      .filter(([name]) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .map(([, b]) => strFromU8(b))
    // Solid fill color is still present
    expect(slideXmls.some((xml) => xml.includes('<p:bg><p:bgPr><a:solidFill>'))).toBe(true)

    // 2. Flow DOCX missing asset handling
    const docxResult = buildFlowDocx(published, 'surface-flow-1', {
      resolveAsset: () => undefined, // missing
    })
    expect(docxResult.warnings.some((w) => w.includes('course-bg-asset'))).toBe(true)
    expect(docxResult.layerReport.some((r) => r.reasonCode === 'surface-background-asset-missing' && r.disposition === 'static-fallback')).toBe(true)
    const docxUnzipped = unzipSync(docxResult.bytes)
    // header1.xml omitted when asset is missing
    expect(docxUnzipped['word/header1.xml']).toBeUndefined()
    // Document background color is still preserved
    const docXml = strFromU8(docxUnzipped['word/document.xml']!)
    expect(docXml).toContain('<w:background w:color="1E293B"/>')
  })
})
