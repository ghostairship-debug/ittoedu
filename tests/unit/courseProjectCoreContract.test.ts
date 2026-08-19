import { describe, expect, it } from 'vitest'
import {
  collectCourseProjectReferences,
  decodeFlowTableCell,
  DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR,
  flowPlainTextFallback,
  flowRunsFallback,
  getEffectiveCourseLayerOrder,
  migrateProjectV8ToCourseProjectV9,
  normalizeFlowRichText,
  resolveCourseSurfaceBackgroundColor,
  visitCourseProject,
} from '@/shared/courseProjectModel'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import {
  courseProjectDocumentSchema,
  flowBlockSchema,
} from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type CourseRuntimeDefinition,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { createProject } from '@/renderer/project/createProject'

const NOW = '2026-08-17T00:00:00.000Z'

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'course-core',
    revision: 0,
    title: '最小合同',
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
        channelVolumes: {
          music: 1,
          narration: 1,
          sfx: 1,
          ui: 1,
          video: 1,
        },
        sounds: {},
        narrationDucking: {
          enabled: true,
          musicVolume: 0.3,
          fadeMs: 250,
        },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: {
        enabled: true,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
  }
}

function minimalSlideProject(): CourseProjectDocument {
  return {
    ...courseShell(),
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
  }
}

function spatialProject(backgroundColor?: string): CourseProjectDocument {
  return {
    ...courseShell(),
    id: 'course-spatial',
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
      ...(backgroundColor === undefined ? {} : { backgroundColor }),
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: 'camera-home', name: '全景', x: 0, y: 0, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  }
}

function flowProject(blocks: FlowBlock[], backgroundColor?: string): CourseProjectDocument {
  const start = blocks[0]
  if (!start) throw new Error('flow fixture needs at least one block')
  return {
    ...courseShell(),
    id: 'course-flow',
    locations: [{
      id: 'location-flow',
      label: start.type === 'heading' ? start.text : '正文',
      kind: 'flow-block',
      surfaceId: 'surface-flow',
      blockId: start.id,
    }],
    startLocationId: 'location-flow',
    surfaces: [{
      id: 'surface-flow',
      title: '讲义',
      type: 'flow',
      ...(backgroundColor === undefined ? {} : { backgroundColor }),
      surfaceLayerItems: [],
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      blocks,
    }],
  }
}

describe('Course Project V9 core contract', () => {
  it('validates a strict schemaVersion 9 minimal project and rejects unknown fields', () => {
    const project = minimalSlideProject()
    const parsed = courseProjectDocumentSchema.parse(project)
    expect(parsed.schemaVersion).toBe(9)
    expect(parsed.locations[0]).toMatchObject({
      kind: 'slide-scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
    })
    expect(parsed.surfaces[0]).toMatchObject({ type: 'slide' })
    expect('projectMode' in parsed).toBe(false)

    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      staleRoot: true,
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      projectMode: 'flow',
    }).success).toBe(false)
    expect(flowBlockSchema.safeParse({
      id: 'bad',
      type: 'paragraph',
      text: 'x',
      level: 2,
    }).success).toBe(false)
  })

  it('reads legacy Flow plain-text JSON without runs', () => {
    const legacyBlocks = [
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
      { id: 'paragraph', type: 'paragraph', text: '正文' },
      {
        id: 'list',
        type: 'list',
        ordered: true,
        items: [{ id: 'item-1', text: '第一项' }],
      },
      { id: 'quote', type: 'quote', text: '引用', citation: '出处' },
      {
        id: 'table',
        type: 'table',
        columns: [{ id: 'c1', header: '列' }],
        rows: [{ id: 'r1', cells: { c1: '值' } }],
      },
    ] as const

    const parsedBlocks = legacyBlocks.map((block) => flowBlockSchema.parse(block))
    expect(parsedBlocks).toEqual(legacyBlocks)

    const project = courseProjectDocumentSchema.parse(flowProject([...parsedBlocks]))
    const surface = project.surfaces[0]
    if (surface?.type !== 'flow') throw new Error('expected flow surface')
    const heading = surface.blocks[0]
    const paragraph = surface.blocks[1]
    const list = surface.blocks[2]
    const quote = surface.blocks[3]
    const table = surface.blocks[4]
    if (heading?.type !== 'heading') throw new Error('expected heading')
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    if (list?.type !== 'list') throw new Error('expected list')
    if (quote?.type !== 'quote') throw new Error('expected quote')
    if (table?.type !== 'table') throw new Error('expected table')

    expect(heading.runs).toBeUndefined()
    expect(paragraph.runs).toBeUndefined()
    expect(list.items[0]?.runs).toBeUndefined()
    expect(quote.runs).toBeUndefined()
    expect(table.rows[0]?.cells.c1).toBe('值')

    expect(normalizeFlowRichText({ text: heading.text })).toEqual({
      text: '标题',
      runs: [{ start: 0, end: 2, style: {} }],
    })
    expect(decodeFlowTableCell(table.rows[0]!.cells.c1!)).toEqual({
      text: '值',
      runs: [{ start: 0, end: 1, style: {} }],
    })
  })

  it('round-trips Flow runs and keeps plain-text fallback consistent', () => {
    const richBlocks: FlowBlock[] = [
      {
        id: 'heading',
        type: 'heading',
        level: 1,
        text: '标题',
        runs: [{ start: 0, end: 2, style: { bold: true } }],
      },
      {
        id: 'paragraph',
        type: 'paragraph',
        text: '正文强调',
        runs: [{ start: 2, end: 4, style: { italic: true, color: '#2563eb' } }],
      },
      {
        id: 'list',
        type: 'list',
        ordered: false,
        items: [{
          id: 'item-1',
          text: '第一项',
          runs: [{ start: 0, end: 3, style: { underline: true } }],
        }],
      },
      {
        id: 'quote',
        type: 'quote',
        text: '引用',
        citation: '出处',
        runs: [{ start: 0, end: 2, style: { highlightColor: '#fde68a' } }],
      },
      {
        id: 'table',
        type: 'table',
        columns: [{ id: 'c1', header: '列' }],
        rows: [{
          id: 'r1',
          cells: {
            c1: {
              text: '值',
              runs: [{ start: 0, end: 1, style: { strike: true } }],
            },
          },
        }],
      },
    ]

    const parsed = richBlocks.map((block) => flowBlockSchema.parse(block))
    const reparsed = parsed.map((block) => flowBlockSchema.parse(
      JSON.parse(JSON.stringify(block)) as unknown,
    ))
    expect(reparsed).toEqual(parsed)

    const heading = parsed[0]
    const paragraph = parsed[1]
    const list = parsed[2]
    const quote = parsed[3]
    const table = parsed[4]
    if (heading?.type !== 'heading') throw new Error('expected heading')
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    if (list?.type !== 'list') throw new Error('expected list')
    if (quote?.type !== 'quote') throw new Error('expected quote')
    if (table?.type !== 'table') throw new Error('expected table')

    expect(flowPlainTextFallback(heading)).toBe('标题')
    expect(flowRunsFallback({ text: heading.text })).toEqual([
      { start: 0, end: 2, style: {} },
    ])
    expect(flowRunsFallback(heading)).toEqual(heading.runs)
    expect(flowPlainTextFallback({ runs: heading.runs })).toBe('')
    expect(decodeFlowTableCell(table.rows[0]!.cells.c1!)).toEqual({
      text: '值',
      runs: [{ start: 0, end: 1, style: { strike: true } }],
    })

    const project = courseProjectDocumentSchema.parse(flowProject(parsed))
    const surface = project.surfaces[0]
    if (surface?.type !== 'flow') throw new Error('expected flow surface')
    expect(surface.blocks).toEqual(parsed)
    expect(flowBlockSchema.safeParse({
      id: 'overflow',
      type: 'paragraph',
      text: '短',
      runs: [{ start: 0, end: 8, style: { bold: true } }],
    }).success).toBe(false)
  })

  it('migrates a minimal V8 document through the V9 model and round-trips schema', () => {
    const source = createProject({
      id: 'course-migrate',
      title: '迁移合同',
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const before = structuredClone(source)
    const migrated = migrateProjectV8ToCourseProjectV9(source)

    expect(source).toEqual(before)
    expect(migrated.schemaVersion).toBe(9)
    expect(courseProjectDocumentSchema.parse(structuredClone(migrated))).toEqual(migrated)
    expect(migrated.locations).toEqual([expect.objectContaining({
      id: source.scenes[0]!.id,
      kind: 'slide-scene',
      surfaceId: `slide:${source.id}`,
      sceneId: source.scenes[0]!.id,
    })])
    expect(migrated.surfaces).toEqual([expect.objectContaining({
      type: 'slide',
      scenes: [expect.objectContaining({ id: source.scenes[0]!.id })],
    })])

    const ordered = getEffectiveCourseLayerOrder({
      project: migrated,
      surfaceId: migrated.surfaces[0]!.id,
      locationId: migrated.startLocationId,
    })
    expect(ordered).toEqual([])

    const visited = { surfaces: 0, scenes: 0, locations: 0 }
    visitCourseProject(migrated, {
      surface: () => { visited.surfaces += 1 },
      scene: () => { visited.scenes += 1 },
      location: () => { visited.locations += 1 },
    })
    expect(visited).toEqual({ surfaces: 1, scenes: 1, locations: 1 })
    expect(collectCourseProjectReferences(migrated).some((entry) => (
      entry.kind === 'surface' && entry.id === migrated.surfaces[0]!.id
    ))).toBe(true)
  })

  it('treats omitted Spatial and Flow backgroundColor as white without injecting the field', () => {
    expect(DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR).toBe('#ffffff')
    expect(resolveCourseSurfaceBackgroundColor(undefined)).toBe('#ffffff')
    expect(resolveCourseSurfaceBackgroundColor('#f8fafc')).toBe('#f8fafc')

    const spatial = courseProjectDocumentSchema.parse(spatialProject())
    const spatialSurface = spatial.surfaces[0]
    if (spatialSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(spatialSurface.backgroundColor).toBeUndefined()
    expect(resolveCourseSurfaceBackgroundColor(spatialSurface.backgroundColor)).toBe('#ffffff')
    expect('projectMode' in spatial).toBe(false)

    const flow = courseProjectDocumentSchema.parse(flowProject([{
      id: 'heading',
      type: 'heading',
      level: 1,
      text: '标题',
    }]))
    const flowSurface = flow.surfaces[0]
    if (flowSurface?.type !== 'flow') throw new Error('expected flow surface')
    expect(flowSurface.backgroundColor).toBeUndefined()
    expect(resolveCourseSurfaceBackgroundColor(flowSurface.backgroundColor)).toBe('#ffffff')
  })

  it('round-trips an explicit Spatial/Flow backgroundColor and rejects invalid colors', () => {
    const spatial = courseProjectDocumentSchema.parse(spatialProject('#f8fafc'))
    const spatialSurface = spatial.surfaces[0]
    if (spatialSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(spatialSurface.backgroundColor).toBe('#f8fafc')
    expect(courseProjectDocumentSchema.parse(
      JSON.parse(JSON.stringify(spatial)) as unknown,
    )).toEqual(spatial)

    const flow = courseProjectDocumentSchema.parse(flowProject([{
      id: 'heading',
      type: 'heading',
      level: 1,
      text: '标题',
    }], '#ecfdf5'))
    const flowSurface = flow.surfaces[0]
    if (flowSurface?.type !== 'flow') throw new Error('expected flow surface')
    expect(flowSurface.backgroundColor).toBe('#ecfdf5')

    expect(courseProjectDocumentSchema.safeParse(spatialProject('#fff')).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse(flowProject([{
      id: 'heading',
      type: 'heading',
      level: 1,
      text: '标题',
    }], '#111318ff')).success).toBe(false)

    const slide = minimalSlideProject()
    const slideSurface = slide.surfaces[0]
    if (slideSurface?.type !== 'slide') throw new Error('expected slide surface')
    const { backgroundColor: _omitted, ...sceneWithoutColor } = slideSurface.scenes[0]!
    slideSurface.scenes[0] = sceneWithoutColor as typeof slideSurface.scenes[0]
    expect(courseProjectDocumentSchema.safeParse(slide).success).toBe(false)
  })

  it('writes white Spatial and Flow backgroundColor on new blank surfaces', () => {
    const spatial = createBlankSpatialCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const spatialSurface = spatial.surfaces[0]
    if (spatialSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(spatialSurface.backgroundColor).toBe('#ffffff')

    const flow = createBlankFlowCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const flowSurface = flow.surfaces[0]
    if (flowSurface?.type !== 'flow') throw new Error('expected flow surface')
    expect(flowSurface.backgroundColor).toBe('#ffffff')
  })

  it('validates runtime protocol discriminators and versions', () => {
    const makeRuntimeProject = (runtimeDef: CourseRuntimeDefinition) => {
      const project = minimalSlideProject()
      const slideSurface = project.surfaces[0] as Extract<CourseProjectDocument['surfaces'][0], { type: 'slide' }>
      slideSurface.scenes[0]!.layerItems = [{
        layerItemId: 'runtime-item',
        label: '运行时',
        frame: {
          mode: 'absolute',
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
        },
        order: 0,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'surface',
        playbackInitialVisibility: 'inherit',
        kind: 'runtime',
        runtime: runtimeDef,
      }]
      return project
    }

    const validCanvasRuntime = makeRuntimeProject({
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'phaser',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
      content: { values: { label: 'Canvas Runtime' } },
      assets: {},
    })
    expect(courseProjectDocumentSchema.safeParse(validCanvasRuntime).success).toBe(true)

    const validSurfaceRuntime = makeRuntimeProject({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
      content: { values: { label: 'Surface Runtime' } },
      assets: {},
    })
    expect(courseProjectDocumentSchema.safeParse(validSurfaceRuntime).success).toBe(true)

    const invalidCanvasRuntimeWithApi3 = makeRuntimeProject({
      protocol: 'canvas-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'phaser',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,create(){return {destroy(){}}}})',
      content: { values: { label: 'Bad Canvas Runtime' } },
      assets: {},
    } as unknown as CourseRuntimeDefinition)
    expect(courseProjectDocumentSchema.safeParse(invalidCanvasRuntimeWithApi3).success).toBe(false)

    const invalidSurfaceRuntimeWithPhaser = makeRuntimeProject({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'phaser',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
      content: { values: { label: 'Bad Surface Runtime' } },
      assets: {},
    } as unknown as CourseRuntimeDefinition)
    expect(courseProjectDocumentSchema.safeParse(invalidSurfaceRuntimeWithPhaser).success).toBe(false)

    const legacyRuntime = makeRuntimeProject({
      protocol: 'legacy-runtime-v2',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'phaser',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
      content: { values: { label: 'Legacy Runtime' } },
      assets: {},
    } as unknown as CourseRuntimeDefinition)
    expect(courseProjectDocumentSchema.safeParse(legacyRuntime).success).toBe(false)

    const legacySurfaceRuntime = makeRuntimeProject({
      protocol: 'surface-v1',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-v1",create(){return {destroy(){}}}})',
      content: { values: { label: 'Legacy Surface Runtime' } },
      assets: {},
    } as unknown as CourseRuntimeDefinition)
    expect(courseProjectDocumentSchema.safeParse(legacySurfaceRuntime).success).toBe(false)
  })

  it('keeps additive G2A optional fields undefined on blank Flow project', () => {
    const flow = createBlankFlowCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const parsed = courseProjectDocumentSchema.parse(flow)
    const surface = parsed.surfaces[0]
    if (surface?.type !== 'flow') throw new Error('expected flow surface')

    surface.blocks.forEach((block) => {
      if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') {
        expect(block.textAlign).toBeUndefined()
        expect(block.lineSpacing).toBeUndefined()
        block.runs?.forEach((run) => {
          expect(run.style.fontFamily).toBeUndefined()
          expect(run.style.fontSize).toBeUndefined()
        })
      }
      if (block.type === 'media' || block.type === 'component') {
        expect(block.wrap).toBeUndefined()
      }
    })

    parsed.globalLayerItems.forEach((entry) => {
      expect(entry.item.paperSpace).toBeUndefined()
    })
    surface.surfaceLayerItems.forEach((entry) => {
      expect(entry.item.paperSpace).toBeUndefined()
    })
  })

  it('round-trips additive G2A optional fields (wrap, paperSpace, textAlign, lineSpacing, fontFamily, fontSize)', () => {
    const project = flowProject([
      {
        id: 'heading-additive',
        type: 'heading',
        level: 2,
        text: '标题与自定义字体',
        textAlign: 'center',
        lineSpacing: 24,
        runs: [
          {
            start: 0,
            end: 2,
            style: {
              fontFamily: 'CustomFont, sans-serif',
              fontSize: 32,
            },
          },
        ],
      },
      {
        id: 'paragraph-additive',
        type: 'paragraph',
        text: '段落右对齐',
        textAlign: 'right',
        lineSpacing: 18,
      },
      {
        id: 'quote-additive',
        type: 'quote',
        text: '引用文本',
        citation: '出处',
        textAlign: 'left',
        lineSpacing: 16,
      },
      {
        id: 'media-wrap',
        type: 'media',
        assetId: 'asset-image-1',
        mediaKind: 'image',
        layout: 'content-width',
        wrap: 'left',
      },
      {
        id: 'comp-wrap',
        type: 'component',
        component: {
          packageId: 'pkg-interactive-1',
          version: '1.0.0',
        },
        props: { count: 1 },
        staticFallbackAssetId: 'asset-image-1',
        wrap: 'right',
      },
    ])

    project.assets = {
      'asset-image-1': {
        id: 'asset-image-1',
        filename: 'img.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/img.png',
        byteLength: 1024,
      },
    }
    project.componentPackages = {
      'pkg-interactive-1': {
        packageId: 'pkg-interactive-1',
        version: '1.0.0',
        name: '交互组件',
        manifestPath: 'components/pkg-interactive-1/manifest.json',
        runtimePath: 'components/pkg-interactive-1/runtime.js',
        contentSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    }

    const surface = project.surfaces[0] as Extract<CourseProjectDocument['surfaces'][0], { type: 'flow' }>
    surface.surfaceLayerItems = [
      {
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'surface-layer-1',
          label: '纸张图层',
          frame: {
            mode: 'absolute',
            x: 0,
            y: 0,
            width: 200,
            height: 100,
          },
          order: 0,
          visible: true,
          locked: false,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          paperSpace: 'paper',
          kind: 'native',
          content: {
            nativeType: 'shape',
            data: {
              shapeType: 'rectangle',
              style: {
                fillColor: '#ffffff',
                fillOpacity: 1,
                borderColor: '#000000',
                borderOpacity: 1,
                borderWidth: 1,
                lineStyle: 'solid',
                cornerRadius: 0,
                startArrow: 'none',
                endArrow: 'none',
              },
            },
          },
        },
      },
    ]

    const parsed = courseProjectDocumentSchema.parse(project)
    expect(courseProjectDocumentSchema.parse(
      JSON.parse(JSON.stringify(parsed)) as unknown,
    )).toEqual(parsed)

    const parsedSurface = parsed.surfaces[0] as Extract<CourseProjectDocument['surfaces'][0], { type: 'flow' }>
    expect(parsedSurface.surfaceLayerItems[0]?.item.paperSpace).toBe('paper')

    const mediaBlock = parsedSurface.blocks[3]
    if (mediaBlock?.type !== 'media') throw new Error('expected media block')
    expect(mediaBlock.wrap).toBe('left')

    const compBlock = parsedSurface.blocks[4]
    if (compBlock?.type !== 'component') throw new Error('expected component block')
    expect(compBlock.wrap).toBe('right')

    const headingBlock = parsedSurface.blocks[0]
    if (headingBlock?.type !== 'heading') throw new Error('expected heading block')
    expect(headingBlock.textAlign).toBe('center')
    expect(headingBlock.lineSpacing).toBe(24)
    expect(headingBlock.runs?.[0]?.style.fontFamily).toBe('CustomFont, sans-serif')
    expect(headingBlock.runs?.[0]?.style.fontSize).toBe(32)
  })
})
