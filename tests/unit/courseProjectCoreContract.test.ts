import { describe, expect, it } from 'vitest'
import {
  collectCourseProjectReferences,
  decodeFlowTableCell,
  DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR,
  flowPlainTextFallback,
  flowRunsFallback,
  getEffectiveCourseLayerOrder,
  normalizeFlowRichText,
  resolveCourseSurfaceBackgroundColor,
  sceneNodeToCourseLayerItem,
  visitCourseProject,
} from '@/shared/courseProjectModel'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import {
  courseConnectOriginSchema,
  courseNetworkDeclarationSchema,
  courseProjectDocumentSchema,
  flowBlockSchema,
  flowSurfaceLayerEntrySchema,
  globalLayerEntrySchema,
  scopedLayerItemSchema,
} from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type CourseRuntimeDefinition,
  type FlowBlock,
  type NativeLayerItem,
} from '@/shared/courseProjectTypes'
import type {
  NativeChartContent,
  NativeInputContent,
  NativeTableContent,
} from '@/shared/contracts/native-v1/types'
import { createRectangleNode } from '@/renderer/project/nativeNodeFactories'

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

function domainProfileProject(): CourseProjectDocument {
  const project = minimalSlideProject()
  project.assets = {
    'asset-audio': {
      id: 'asset-audio',
      filename: 'narration.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      path: 'assets/narration.mp3',
      byteLength: 1_024,
      duration: 2.5,
      remote: { url: 'https://media.example.com/narration.mp3' },
    },
  }
  project.componentPackages = {
    'component.quiz': {
      packageId: 'component.quiz',
      version: '1.0.0',
      name: 'Quiz',
      manifestPath: 'components/component.quiz/manifest.json',
      runtimePath: 'components/component.quiz/runtime.js',
      contentSha256: 'ab'.repeat(32),
    },
  }
  project.media.audio.sounds = {
    'sound-1': {
      id: 'sound-1',
      name: 'Narration',
      assetId: 'asset-audio',
      channel: 'narration',
      defaultVolume: 1,
      defaultLoop: false,
    },
  }
  project.playback.presenter.additionalBindings = [{
    id: 'binding-1',
    command: 'next',
    key: 'F5',
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
  }]
  return project
}

function asMutableRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected mutable record fixture')
  }
  return value as Record<string, unknown>
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

  it('keeps all extracted domain fields required without injecting defaults', () => {
    for (const field of ['assets', 'componentPackages', 'designTokens', 'media', 'playback']) {
      const candidate = asMutableRecord(structuredClone(minimalSlideProject()))
      delete candidate[field]
      expect(courseProjectDocumentSchema.safeParse(candidate).success, field).toBe(false)
    }
  })

  it('rejects unknown fields at every extracted domain object layer', () => {
    const targets: Array<readonly [string, (project: CourseProjectDocument) => unknown]> = [
      ['asset', (project) => project.assets['asset-audio']],
      ['asset remote', (project) => project.assets['asset-audio']?.remote],
      ['component metadata', (project) => project.componentPackages['component.quiz']],
      ['design root', (project) => project.designTokens],
      ['design token', (project) => project.designTokens.fonts[0]],
      ['media root', (project) => project.media],
      ['audio settings', (project) => project.media.audio],
      ['channel volumes', (project) => project.media.audio.channelVolumes],
      ['sound definition', (project) => project.media.audio.sounds['sound-1']],
      ['narration ducking', (project) => project.media.audio.narrationDucking],
      ['playback root', (project) => project.playback],
      ['presenter settings', (project) => project.playback.presenter],
      ['presenter binding', (project) => project.playback.presenter.additionalBindings[0]],
    ]

    targets.forEach(([label, select]) => {
      const candidate = domainProfileProject()
      asMutableRecord(select(candidate)).unexpected = true
      expect(courseProjectDocumentSchema.safeParse(candidate).success, label).toBe(false)
    })
  })

  it('preserves Course Project V9 domain limits and parse-time policy', () => {
    const designAtLimit = domainProfileProject()
    designAtLimit.designTokens.fonts = Array.from({ length: 64 }, (_, index) => ({
      id: `font${index}`,
      label: `Font ${index}`,
      fontFamily: `Font ${index}`,
    }))
    designAtLimit.designTokens.colors = Array.from({ length: 256 }, (_, index) => ({
      id: `color${index}`,
      label: `Color ${index}`,
      color: '#123456',
    }))
    expect(courseProjectDocumentSchema.safeParse(designAtLimit).success).toBe(true)
    designAtLimit.designTokens.fonts.push({ id: 'overflow', label: 'Overflow', fontFamily: 'sans-serif' })
    expect(courseProjectDocumentSchema.safeParse(designAtLimit).success).toBe(false)

    const colorsOverLimit = domainProfileProject()
    colorsOverLimit.designTokens.colors = Array.from({ length: 257 }, (_, index) => ({
      id: `color${index}`,
      label: `Color ${index}`,
      color: '#123456',
    }))
    expect(courseProjectDocumentSchema.safeParse(colorsOverLimit).success).toBe(false)

    const duplicateDesignToken = domainProfileProject()
    duplicateDesignToken.designTokens.fonts = [
      { id: 'body', label: 'Body A', fontFamily: 'sans-serif' },
      { id: 'body', label: 'Body B', fontFamily: 'serif' },
    ]
    expect(courseProjectDocumentSchema.safeParse(duplicateDesignToken).success).toBe(true)
    duplicateDesignToken.designTokens.fonts[0]!.id = ' body '
    expect(courseProjectDocumentSchema.safeParse(duplicateDesignToken).success).toBe(false)

    const mediaAtLimit = domainProfileProject()
    mediaAtLimit.media.audio.sounds['sound-1']!.name = 'n'.repeat(200)
    mediaAtLimit.media.audio.sounds['sound-1']!.id = 's'.repeat(240)
    expect(courseProjectDocumentSchema.safeParse(mediaAtLimit).success).toBe(true)
    mediaAtLimit.media.audio.sounds['sound-1']!.name = 'n'.repeat(201)
    expect(courseProjectDocumentSchema.safeParse(mediaAtLimit).success).toBe(false)
    mediaAtLimit.media.audio.sounds['sound-1']!.name = 'Narration'
    mediaAtLimit.media.audio.sounds['sound-1']!.id = 's'.repeat(241)
    expect(courseProjectDocumentSchema.safeParse(mediaAtLimit).success).toBe(false)

    const playbackAtLimit = domainProfileProject()
    playbackAtLimit.playback.presenter.additionalBindings[0]!.id = 'b'.repeat(240)
    expect(courseProjectDocumentSchema.safeParse(playbackAtLimit).success).toBe(true)
    playbackAtLimit.playback.presenter.additionalBindings[0]!.id = 'b'.repeat(241)
    expect(courseProjectDocumentSchema.safeParse(playbackAtLimit).success).toBe(false)

    const thirtyTwoBindings = domainProfileProject()
    const repeatedBinding = {
      id: 'repeated',
      command: 'next' as const,
      key: 'PageDown',
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
    }
    thirtyTwoBindings.playback.presenter.additionalBindings = Array.from(
      { length: 32 },
      () => ({ ...repeatedBinding }),
    )
    expect(courseProjectDocumentSchema.safeParse(thirtyTwoBindings).success).toBe(true)
    thirtyTwoBindings.playback.presenter.additionalBindings.push({ ...repeatedBinding })
    expect(courseProjectDocumentSchema.safeParse(thirtyTwoBindings).success).toBe(false)
  })

  it('preserves component provenance, portable paths and string normalization', () => {
    const withoutProvenance = domainProfileProject()
    expect(courseProjectDocumentSchema.safeParse(withoutProvenance).success).toBe(true)

    const withProvenance = domainProfileProject()
    Object.assign(withProvenance.componentPackages['component.quiz']!, {
      sha256: 'cd'.repeat(32),
      importedAt: NOW,
      sourceLabel: 'Catalog',
    })
    expect(courseProjectDocumentSchema.safeParse(withProvenance).success).toBe(true)

    const partialProvenance = domainProfileProject()
    partialProvenance.componentPackages['component.quiz']!.sha256 = 'cd'.repeat(32)
    expect(courseProjectDocumentSchema.safeParse(partialProvenance).success).toBe(false)

    const absoluteComponentPath = domainProfileProject()
    absoluteComponentPath.componentPackages['component.quiz']!.manifestPath = 'C:\\component\\manifest.json'
    expect(courseProjectDocumentSchema.safeParse(absoluteComponentPath).success).toBe(false)

    const normalized = domainProfileProject()
    normalized.assets['asset-audio']!.id = ' asset-audio '
    normalized.assets['asset-audio']!.filename = ' narration.mp3 '
    normalized.assets['asset-audio']!.mimeType = ' audio/mpeg '
    normalized.componentPackages['component.quiz']!.packageId = ' component.quiz '
    normalized.componentPackages['component.quiz']!.name = ' Quiz '
    const parsed = courseProjectDocumentSchema.parse(normalized)
    expect(parsed.assets['asset-audio']).toMatchObject({
      id: 'asset-audio',
      filename: 'narration.mp3',
      mimeType: 'audio/mpeg',
    })
    expect(parsed.componentPackages['component.quiz']).toMatchObject({
      packageId: 'component.quiz',
      name: 'Quiz',
    })
  })

  it('rejects unknown native content fields and cross-discriminator nativeData overrides', () => {
    const project = minimalSlideProject()
    const slideSurface = project.surfaces[0]
    if (slideSurface?.type !== 'slide') throw new Error('expected slide surface')
    const item = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'shape-item',
      name: '矩形',
    }), 0)
    if (item.kind !== 'native' || item.content.nativeType !== 'shape') {
      throw new Error('expected shape native item')
    }
    slideSurface.scenes[0]!.layerItems = [item]
    slideSurface.scenes[0]!.presentation = {
      initialStateId: 'state_initial',
      states: [{
        id: 'state_initial',
        name: '初始',
        layerItemOverrides: {},
      }],
    }

    const parsed = courseProjectDocumentSchema.parse(project)
    expect(courseProjectDocumentSchema.parse(
      JSON.parse(JSON.stringify(parsed)) as unknown,
    )).toEqual(parsed)

    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{
        ...slideSurface,
        scenes: [{
          ...slideSurface.scenes[0]!,
          layerItems: [{
            ...item,
            content: {
              nativeType: 'shape',
              data: {
                ...item.content.data,
                extraField: true,
              },
            },
          }],
        }],
      }],
    }).success).toBe(false)

    slideSurface.scenes[0]!.presentation = {
      initialStateId: 'state_initial',
      states: [{
        id: 'state_initial',
        name: '初始',
        layerItemOverrides: {
          'shape-item': { nativeData: { text: 'not-a-shape' } },
        },
      }],
    }
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)

    slideSurface.scenes[0]!.presentation = {
      initialStateId: 'state_initial',
      states: [{
        id: 'state_initial',
        name: '初始',
        layerItemOverrides: {
          'shape-item': { nativeData: { style: { fillColor: '#ff0000' } } },
        },
      }],
    }
    const withOverride = courseProjectDocumentSchema.parse(project)
    expect(courseProjectDocumentSchema.parse(
      JSON.parse(JSON.stringify(withOverride)) as unknown,
    )).toEqual(withOverride)
  })

  it('keeps global and Flow body planes strict on their own entry contracts', () => {
    const project = createBlankCourseProject({ now: NOW })
    const controller = project.globalLayerItems[0]
    const surface = project.surfaces[0]
    if (!controller || surface?.type !== 'slide') {
      throw new Error('expected blank Slide controller')
    }
    expect(controller.plane).toBe('overlay')
    expect(globalLayerEntrySchema.parse(controller)).toEqual(controller)

    const legacy = structuredClone(controller)
    delete legacy.plane
    expect(globalLayerEntrySchema.parse(legacy).plane).toBeUndefined()
    expect(globalLayerEntrySchema.safeParse({ ...controller, plane: 'underlay' }).success)
      .toBe(false)

    const local = sceneNodeToCourseLayerItem(createRectangleNode({
      id: 'same-order-local',
      name: '同序本地项',
    }), controller.item.order)
    surface.scenes[0]!.layerItems.push(local)
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    expect(scopedLayerItemSchema.safeParse({
      item: local,
      visibility: { mode: 'all', locationIds: [] },
      plane: 'overlay',
    }).success).toBe(false)

    const flowEntry = {
      item: { ...local, layerItemId: 'flow-body-plane' },
      visibility: { mode: 'all' as const, locationIds: [] },
      bodyPlane: 'underlay' as const,
    }
    expect(flowSurfaceLayerEntrySchema.parse(flowEntry)).toEqual(flowEntry)
    expect(flowSurfaceLayerEntrySchema.safeParse({
      ...flowEntry,
      bodyPlane: 'middle',
    }).success).toBe(false)
    expect(scopedLayerItemSchema.safeParse(flowEntry).success).toBe(false)

    const flowProject = createBlankFlowCourseProject({ now: NOW })
    const flowSurface = flowProject.surfaces[0]
    if (flowSurface?.type !== 'flow') throw new Error('expected blank Flow surface')
    flowSurface.surfaceLayerItems.push(flowEntry)
    const parsedFlow = courseProjectDocumentSchema.parse(flowProject)
    const parsedFlowSurface = parsedFlow.surfaces[0]
    if (parsedFlowSurface?.type !== 'flow') throw new Error('expected parsed Flow surface')
    expect(parsedFlowSurface.surfaceLayerItems[0]?.bodyPlane).toBe('underlay')
  })

  it('validates declared course-state references in global and local interactions', () => {
    const key = 's'.repeat(240)
    const project = minimalSlideProject()
    project.courseState = [
      { key, valueType: 'number', defaultValue: 0 },
      { key: 'label', valueType: 'string', defaultValue: '' },
    ]
    project.globalInteractions = [{
      id: 'global-course-state',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{ type: 'course-state.exists', key, exists: true }],
      actions: [{
        id: 'set-global-score',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'course-state.set', key, value: 1 },
      }],
    }]
    const surface = project.surfaces[0]
    if (surface?.type !== 'slide') throw new Error('expected slide surface')
    surface.scenes[0]!.interactions = [{
      id: 'local-course-state',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{ type: 'course-state.compare', key, operator: 'gte', value: 1 }],
      actions: [{
        id: 'set-local-score',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'course-state.set', key, value: 2 },
      }],
    }]

    expect(courseProjectDocumentSchema.parse(project)).toEqual(project)
    expect(collectCourseProjectReferences(project).filter((reference) => (
      reference.kind === 'course-state' && reference.id === key
    ))).toHaveLength(4)

    const missing = structuredClone(project)
    missing.globalInteractions[0]!.actions[0]!.action = {
      type: 'course-state.set',
      key: 'missing',
      value: 1,
    }
    expect(courseProjectDocumentSchema.safeParse(missing).success).toBe(false)

    const wrongType = structuredClone(project)
    wrongType.globalInteractions[0]!.actions[0]!.action = {
      type: 'course-state.set',
      key,
      value: '1',
    }
    expect(courseProjectDocumentSchema.safeParse(wrongType).success).toBe(false)

    const invalidOrdering = structuredClone(project)
    const invalidSurface = invalidOrdering.surfaces[0]
    if (invalidSurface?.type !== 'slide') throw new Error('expected slide surface')
    invalidSurface.scenes[0]!.interactions[0]!.conditions = [{
      type: 'course-state.compare',
      key: 'label',
      operator: 'gt',
      value: 'a',
    }]
    expect(courseProjectDocumentSchema.safeParse(invalidOrdering).success).toBe(false)
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
    expect(flowBlockSchema.safeParse({
      id: 'unknown-run-style',
      type: 'paragraph',
      text: '严格',
      runs: [{
        start: 0,
        end: 2,
        style: { bold: true, unexpected: 'must-reject' },
      }],
    }).success).toBe(false)
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

  it('adds a Course-wide background that is optional, strict and asset-checked', () => {
    const project = minimalSlideProject()
    const parsedOmitted = courseProjectDocumentSchema.parse(project)
    expect(parsedOmitted.backgroundColor).toBeUndefined()
    expect(parsedOmitted.backgroundAssetId).toBeUndefined()
    expect('backgroundMode' in parsedOmitted).toBe(false)

    const withBackground: CourseProjectDocument = {
      ...project,
      assets: {
        'course-cover': {
          id: 'course-cover',
          filename: 'cover.png',
          mimeType: 'image/png',
          kind: 'image',
          path: 'assets/course-cover.bin',
          byteLength: 4,
        },
      },
      backgroundColor: '#0f172a',
      backgroundAssetId: 'course-cover',
    }
    const parsed = courseProjectDocumentSchema.parse(withBackground)
    expect(parsed.backgroundColor).toBe('#0f172a')
    expect(parsed.backgroundAssetId).toBe('course-cover')

    const parsedClearedAsset = courseProjectDocumentSchema.parse({ ...withBackground, backgroundAssetId: null })
    expect(parsedClearedAsset.backgroundAssetId).toBeNull()

    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      backgroundColor: '#0f172a80',
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      backgroundMode: 'inherit',
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      backgroundAssetId: 'missing-course-asset',
    }).success).toBe(false)
  })

  it('adds a Slide surface background that defaults to inherit mode and is strict', () => {
    const project = minimalSlideProject()
    const slideSurface = project.surfaces[0]
    if (slideSurface?.type !== 'slide') throw new Error('expected slide surface')

    const parsedOmitted = courseProjectDocumentSchema.parse(project)
    const omittedSurface = parsedOmitted.surfaces[0]
    if (omittedSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(omittedSurface.backgroundMode).toBeUndefined()
    expect(omittedSurface.backgroundColor).toBeUndefined()
    expect(omittedSurface.backgroundAssetId).toBeUndefined()

    const withOwn: CourseProjectDocument = {
      ...project,
      assets: {
        'surface-cover': {
          id: 'surface-cover',
          filename: 'surface.png',
          mimeType: 'image/png',
          kind: 'image',
          path: 'assets/surface-cover.bin',
          byteLength: 4,
        },
      },
      surfaces: [{
        ...slideSurface,
        backgroundMode: 'own',
        backgroundColor: '#1e293b',
        backgroundAssetId: 'surface-cover',
      }],
    }
    const parsedOwn = courseProjectDocumentSchema.parse(withOwn)
    const parsedOwnSurface = parsedOwn.surfaces[0]
    if (parsedOwnSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(parsedOwnSurface).toMatchObject({
      backgroundMode: 'own',
      backgroundColor: '#1e293b',
      backgroundAssetId: 'surface-cover',
    })

    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...slideSurface, backgroundMode: 'sometimes' }],
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...slideSurface, backgroundColor: 'red' }],
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...slideSurface, backgroundAssetId: 'missing-surface-asset' }],
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...slideSurface, unknownSurfaceField: true }],
    }).success).toBe(false)
  })

  it('adds a Slide scene backgroundMode that is strict and independent of the required color', () => {
    const project = minimalSlideProject()
    const slideSurface = project.surfaces[0]
    if (slideSurface?.type !== 'slide') throw new Error('expected slide surface')
    const scene = slideSurface.scenes[0]!

    const parsedDefault = courseProjectDocumentSchema.parse(project)
    const defaultSurface = parsedDefault.surfaces[0]
    if (defaultSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(defaultSurface.scenes[0]?.backgroundMode).toBeUndefined()
    expect(defaultSurface.scenes[0]?.backgroundColor).toBe('#ffffff')

    const withInherit: CourseProjectDocument = {
      ...project,
      surfaces: [{
        ...slideSurface,
        scenes: [{ ...scene, backgroundMode: 'inherit' }],
      }],
    }
    const parsedInherit = courseProjectDocumentSchema.parse(withInherit)
    const parsedInheritSurface = parsedInherit.surfaces[0]
    if (parsedInheritSurface?.type !== 'slide') throw new Error('expected slide surface')
    expect(parsedInheritSurface.scenes[0]?.backgroundMode).toBe('inherit')
    // The required scene color is stored and validated even while inherit mode leaves it dormant.
    expect(parsedInheritSurface.scenes[0]?.backgroundColor).toBe('#ffffff')

    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...slideSurface, scenes: [{ ...scene, backgroundMode: 'sometimes' }] }],
    }).success).toBe(false)
    // Omitting the required color must still fail, mode or no mode.
    const { backgroundColor: _omitted, ...sceneWithoutColor } = scene
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...slideSurface, scenes: [{ ...sceneWithoutColor, backgroundMode: 'own' }] }],
    }).success).toBe(false)
  })

  it('adds Flow surface backgroundMode/backgroundAssetId that default to own and are strict', () => {
    const project = flowProject([{ id: 'heading', type: 'heading', level: 1, text: '标题' }])
    const flowSurface = project.surfaces[0]
    if (flowSurface?.type !== 'flow') throw new Error('expected flow surface')

    const parsedDefault = courseProjectDocumentSchema.parse(project)
    const defaultSurface = parsedDefault.surfaces[0]
    if (defaultSurface?.type !== 'flow') throw new Error('expected flow surface')
    expect(defaultSurface.backgroundMode).toBeUndefined()
    expect(defaultSurface.backgroundAssetId).toBeUndefined()

    const withOwn: CourseProjectDocument = {
      ...project,
      assets: {
        'flow-cover': {
          id: 'flow-cover',
          filename: 'flow.png',
          mimeType: 'image/png',
          kind: 'image',
          path: 'assets/flow-cover.bin',
          byteLength: 4,
        },
      },
      surfaces: [{ ...flowSurface, backgroundMode: 'own', backgroundAssetId: 'flow-cover' }],
    }
    const parsedOwn = courseProjectDocumentSchema.parse(withOwn)
    const parsedOwnSurface = parsedOwn.surfaces[0]
    if (parsedOwnSurface?.type !== 'flow') throw new Error('expected flow surface')
    expect(parsedOwnSurface.backgroundMode).toBe('own')
    expect(parsedOwnSurface.backgroundAssetId).toBe('flow-cover')

    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...flowSurface, backgroundMode: 'always' }],
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...flowSurface, backgroundAssetId: 42 }],
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...flowSurface, backgroundAssetId: 'missing-flow-asset' }],
    }).success).toBe(false)
  })

  it('adds Spatial surface backgroundMode/backgroundAssetId that default to own and are strict', () => {
    const project = spatialProject()
    const spatialSurface = project.surfaces[0]
    if (spatialSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')

    const parsedDefault = courseProjectDocumentSchema.parse(project)
    const defaultSurface = parsedDefault.surfaces[0]
    if (defaultSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(defaultSurface.backgroundMode).toBeUndefined()
    expect(defaultSurface.backgroundAssetId).toBeUndefined()

    const withInheritButExplicitAsset: CourseProjectDocument = {
      ...project,
      assets: {
        'spatial-cover': {
          id: 'spatial-cover',
          filename: 'spatial.png',
          mimeType: 'image/png',
          kind: 'image',
          path: 'assets/spatial-cover.bin',
          byteLength: 4,
        },
      },
      surfaces: [{ ...spatialSurface, backgroundMode: 'inherit', backgroundAssetId: 'spatial-cover' }],
    }
    const parsed = courseProjectDocumentSchema.parse(withInheritButExplicitAsset)
    const parsedSurface = parsed.surfaces[0]
    if (parsedSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(parsedSurface.backgroundMode).toBe('inherit')
    // Explicit asset persists even though inherit mode leaves it dormant to the resolver.
    expect(parsedSurface.backgroundAssetId).toBe('spatial-cover')

    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...spatialSurface, backgroundMode: 'always' }],
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...spatialSurface, backgroundAssetId: 42 }],
    }).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...project,
      surfaces: [{ ...spatialSurface, backgroundAssetId: 'missing-spatial-asset' }],
    }).success).toBe(false)
  })

  it('keeps Named state free of a backgroundMode field; its inherit stays expressed by omitting both overrides', () => {
    const project = minimalSlideProject()
    const slideSurface = project.surfaces[0]
    if (slideSurface?.type !== 'slide') throw new Error('expected slide surface')
    const scene = slideSurface.scenes[0]!
    const withPresentation: CourseProjectDocument = {
      ...project,
      surfaces: [{
        ...slideSurface,
        scenes: [{
          ...scene,
          presentation: {
            initialStateId: 'state-1',
            states: [{ id: 'state-1', name: '状态 1', layerItemOverrides: {} }],
          },
        }],
      }],
    }
    expect(courseProjectDocumentSchema.safeParse(withPresentation).success).toBe(true)

    expect(courseProjectDocumentSchema.safeParse({
      ...withPresentation,
      surfaces: [{
        ...slideSurface,
        scenes: [{
          ...scene,
          presentation: {
            initialStateId: 'state-1',
            states: [{ id: 'state-1', name: '状态 1', layerItemOverrides: {}, backgroundMode: 'inherit' }],
          },
        }],
      }],
    }).success).toBe(false)
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
      protocol: ['legacy-runtime', '-v2'].join(''),
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

  it('keeps additive NET-01 fields undefined on a minimal project', () => {
    const parsed = courseProjectDocumentSchema.parse(minimalSlideProject())
    expect(parsed.network).toBeUndefined()
    Object.values(parsed.assets).forEach((asset) => {
      expect(asset.remote).toBeUndefined()
    })
  })

  it('round-trips asset remote delivery URL and course network connect origins', () => {
    const project = minimalSlideProject()
    project.assets = {
      'asset-video-1': {
        id: 'asset-video-1',
        filename: 'intro.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'assets/intro.mp4',
        byteLength: 2_048,
        remote: { url: 'https://media.example.com/courses/intro.mp4?token=abc' },
      },
    }
    project.network = {
      connectOrigins: ['https://api.example.com', 'wss://realtime.example.com:8443'],
    }

    const parsed = courseProjectDocumentSchema.parse(project)
    expect(parsed.assets['asset-video-1']?.remote?.url).toBe(
      'https://media.example.com/courses/intro.mp4?token=abc',
    )
    expect(parsed.assets['asset-video-1']?.path).toBe('assets/intro.mp4')
    expect(parsed.assets['asset-video-1']?.byteLength).toBe(2_048)
    expect(parsed.network?.connectOrigins).toEqual([
      'https://api.example.com',
      'wss://realtime.example.com:8443',
    ])
    expect(courseProjectDocumentSchema.parse(
      JSON.parse(JSON.stringify(parsed)) as unknown,
    )).toEqual(parsed)
  })

  it('rejects remote asset delivery URLs that are not credential-free https', () => {
    const asset = {
      id: 'asset-image-1',
      filename: 'img.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/img.png',
      byteLength: 1_024,
    }
    const withRemote = (remote: unknown): unknown => ({
      ...minimalSlideProject(),
      assets: { 'asset-image-1': { ...asset, ...(remote === undefined ? {} : { remote }) } },
    })

    expect(courseProjectDocumentSchema.safeParse(withRemote(undefined)).success).toBe(true)
    for (const url of [
      'http://media.example.com/img.png',
      'data:image/png;base64,AAAA',
      'https://user:secret@media.example.com/img.png',
      'not-a-url',
    ]) {
      expect(courseProjectDocumentSchema.safeParse(withRemote({ url })).success).toBe(false)
    }
    expect(courseProjectDocumentSchema.safeParse(
      withRemote({ url: 'https://media.example.com/img.png', sha256: 'ff'.repeat(32) }),
    ).success).toBe(false)
  })

  it('accepts only normalized exact https/wss connect origins', () => {
    const withOrigins = (connectOrigins: unknown): unknown => ({
      ...minimalSlideProject(),
      network: { connectOrigins },
    })

    for (const origin of [
      'https://*',
      'https://*.example.com',
      'http://api.example.com',
      'ws://api.example.com',
      'ftp://api.example.com',
      'https://user@api.example.com',
      'https://api.example.com/path',
      'https://api.example.com?query=1',
      'https://api.example.com#fragment',
      'https://api.example.com/',
      'https://API.example.com',
      'https://api.example.com:443',
      'wss://api.example.com:443',
      'not-a-url',
    ]) {
      expect(courseConnectOriginSchema.safeParse(origin).success).toBe(false)
      expect(courseProjectDocumentSchema.safeParse(withOrigins([origin])).success).toBe(false)
    }

    for (const origin of [
      'https://api.example.com',
      'wss://realtime.example.com:8443',
      'https://[2001:db8::1]:8443',
    ]) {
      expect(courseConnectOriginSchema.safeParse(origin).success).toBe(true)
      expect(courseProjectDocumentSchema.safeParse(withOrigins([origin])).success).toBe(true)
    }

    expect(courseProjectDocumentSchema.safeParse(
      withOrigins(['https://api.example.com', 'https://api.example.com']),
    ).success).toBe(false)
    expect(courseProjectDocumentSchema.safeParse({
      ...minimalSlideProject(),
      network: { connectOrigins: [], secretAccessToken: 'sk-1' },
    }).success).toBe(false)
    expect(courseNetworkDeclarationSchema.parse({})).toEqual({})
  })

  describe('Table and Chart strict Native contracts (r12-000)', () => {
    function sampleTableContent(): NativeTableContent {
      return {
        columns: [
          { id: 'col-1', width: 120 },
          { id: 'col-2', width: 160 },
        ],
        rows: [
          {
            id: 'row-1',
            height: 40,
            cells: [
              { id: 'cell-1-1', columnId: 'col-1', text: '表头 1', style: { bold: true } },
              { id: 'cell-1-2', columnId: 'col-2', text: '表头 2', style: { bold: true } },
            ],
          },
          {
            id: 'row-2',
            height: 36,
            cells: [
              { id: 'cell-2-1', columnId: 'col-1', text: '内容 A' },
              { id: 'cell-2-2', columnId: 'col-2', text: '内容 B' },
            ],
          },
        ],
        headerRowCount: 1,
        style: {
          fillColor: '#ffffff',
          fillOpacity: 1,
          borderColor: '#e5e7eb',
          borderOpacity: 1,
          borderWidth: 1,
          lineStyle: 'solid',
          textColor: '#111827',
          fontFamily: '"Microsoft YaHei", sans-serif',
          fontSize: 14,
          horizontalAlign: 'left',
          verticalAlign: 'middle',
          cellPadding: 8,
        },
      }
    }

    function sampleChartContent(chartType: 'bar' | 'line' | 'area' | 'pie' | 'donut'): NativeChartContent {
      const categories = [
        { id: 'cat-1', label: '一月' },
        { id: 'cat-2', label: '二月' },
      ]
      const commonStyle = {
        backgroundColor: '#ffffff',
        backgroundOpacity: 1,
        fontFamily: '"Microsoft YaHei", sans-serif',
        fontSize: 12,
        textColor: '#1f2937',
        showLegend: true,
        legendPosition: 'top' as const,
        showDataLabels: true,
      }
      if (chartType === 'pie') {
        return {
          chartType: 'pie',
          title: '饼图测试',
          categories,
          series: [
            {
              id: 'series-1',
              name: '占比',
              color: '#3b82f6',
              points: [
                { id: 'p-1', categoryId: 'cat-1', value: 40 },
                { id: 'p-2', categoryId: 'cat-2', value: 60 },
              ],
            },
          ],
          style: commonStyle,
        }
      }
      if (chartType === 'donut') {
        return {
          chartType: 'donut',
          title: '环形图测试',
          categories,
          series: [
            {
              id: 'series-1',
              name: '占比',
              color: '#3b82f6',
              points: [
                { id: 'p-1', categoryId: 'cat-1', value: 30 },
                { id: 'p-2', categoryId: 'cat-2', value: 70 },
              ],
            },
          ],
          style: { ...commonStyle, holeSize: 50 },
        }
      }
      return {
        chartType,
        title: `${chartType}测试`,
        categories,
        series: [
          {
            id: 'series-1',
            name: '系列 1',
            color: '#3b82f6',
            points: [
              { id: 'p-1', categoryId: 'cat-1', value: 10 },
              { id: 'p-2', categoryId: 'cat-2', value: 20 },
            ],
          },
        ],
        style: {
          ...commonStyle,
          showCategoryAxis: true,
          showValueAxis: true,
          showGridLines: true,
          valueMin: 0,
          valueMax: 100,
        },
      }
    }

    function slideProjectWithLayer(nativeContent: NativeLayerItem['content']): CourseProjectDocument {
      const base = minimalSlideProject()
      const slideSurface = base.surfaces.find((s) => s.type === 'slide')
      if (slideSurface && slideSurface.type === 'slide') {
        slideSurface.scenes[0]!.layerItems = [
          {
            layerItemId: 'layer-native-1',
            label: 'Native Layer',
            kind: 'native',
            content: nativeContent,
            frame: { mode: 'absolute', x: 50, y: 50, width: 400, height: 300 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
        ]
      }
      return base
    }

    it('accepts valid Table in Slide scene', () => {
      const project = slideProjectWithLayer({
        nativeType: 'table',
        data: sampleTableContent(),
      })
      const result = courseProjectDocumentSchema.safeParse(project)
      expect(result.success).toBe(true)
    })

    it('accepts valid Table in Slide surface surfaceLayerItems', () => {
      const base = minimalSlideProject()
      const slideSurface = base.surfaces.find((s) => s.type === 'slide')
      if (slideSurface && slideSurface.type === 'slide') {
        slideSurface.surfaceLayerItems = [
          {
            item: {
              layerItemId: 'layer-table-surface',
              label: 'Surface Table',
              kind: 'native',
              content: { nativeType: 'table', data: sampleTableContent() },
              frame: { mode: 'absolute', x: 20, y: 20, width: 300, height: 200 },
              order: 0,
              visible: true,
              locked: false,
              rotation: 0,
              opacity: 1,
              hitPolicy: 'auto',
              playbackInitialVisibility: 'inherit',
            },
            visibility: { mode: 'all', locationIds: [] },
          },
        ]
      }
      expect(courseProjectDocumentSchema.safeParse(base).success).toBe(true)
    })

    it('accepts all 5 Chart types in Slide scene', () => {
      for (const chartType of ['bar', 'line', 'area', 'pie', 'donut'] as const) {
        const project = slideProjectWithLayer({
          nativeType: 'chart',
          data: sampleChartContent(chartType),
        })
        const result = courseProjectDocumentSchema.safeParse(project)
        expect(result.success).toBe(true)
      }
    })

    it('rejects Table with invalid structure, duplicate IDs, or unknown fields', () => {
      // Duplicate column id
      const dupCol = sampleTableContent()
      dupCol.columns[1]!.id = 'col-1'
      dupCol.rows.forEach((r) => { r.cells[1]!.columnId = 'col-1' })
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'table', data: dupCol })).success).toBe(false)

      // Duplicate cell id across rows
      const dupCell = sampleTableContent()
      dupCell.rows[1]!.cells[0]!.id = 'cell-1-1'
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'table', data: dupCell })).success).toBe(false)

      // Cell columnId mismatch
      const mismatchCol = sampleTableContent()
      mismatchCol.rows[0]!.cells[0]!.columnId = 'wrong-col'
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'table', data: mismatchCol })).success).toBe(false)

      // Header row count > row count
      const badHeader = sampleTableContent()
      badHeader.headerRowCount = 5
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'table', data: badHeader })).success).toBe(false)

      // Extra unknown field on table content
      const extraField = { ...sampleTableContent(), extraKey: 'unknown' }
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'table', data: extraField as any })).success).toBe(false)
    })

    it('rejects Chart with invalid structure, duplicate IDs, or value constraints', () => {
      // Duplicate category id
      const dupCat = sampleChartContent('bar')
      dupCat.categories[1]!.id = 'cat-1'
      dupCat.series[0]!.points[1]!.categoryId = 'cat-1'
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'chart', data: dupCat })).success).toBe(false)

      // Duplicate point id
      const dupPoint = sampleChartContent('bar')
      dupPoint.series[0]!.points[1]!.id = 'p-1'
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'chart', data: dupPoint })).success).toBe(false)

      // Cartesian valueMin >= valueMax
      const badMinMax = sampleChartContent('bar')
      if ('style' in badMinMax && 'valueMin' in badMinMax.style) {
        badMinMax.style.valueMin = 100
        badMinMax.style.valueMax = 50
      }
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'chart', data: badMinMax })).success).toBe(false)

      // Pie chart negative value
      const negPie = sampleChartContent('pie')
      negPie.series[0].points[0]!.value = -10
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'chart', data: negPie })).success).toBe(false)

      // Pie chart all zero values
      const zeroPie = sampleChartContent('pie')
      zeroPie.series[0].points[0]!.value = 0
      zeroPie.series[0].points[1]!.value = 0
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'chart', data: zeroPie })).success).toBe(false)

      // Extra unknown field
      const extraField = { ...sampleChartContent('bar'), extraProp: true }
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithLayer({ nativeType: 'chart', data: extraField as any })).success).toBe(false)
    })

    it('strictly rejects Table and Chart in Flow, Global, and Spatial containers', () => {
      const tableContent = sampleTableContent()

      // 1. Flow surfaceLayerItems
      const flowProject = createBlankFlowCourseProject()
      const flowSurface = flowProject.surfaces.find((s) => s.type === 'flow')!
      flowSurface.surfaceLayerItems = [
        {
          item: {
            layerItemId: 'flow-table-1',
            label: 'Flow Table',
            kind: 'native',
            content: { nativeType: 'table', data: tableContent },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 200 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
          visibility: { mode: 'all', locationIds: [] },
        },
      ]
      const flowResult = courseProjectDocumentSchema.safeParse(flowProject)
      expect(flowResult.success).toBe(false)

      // 2. GlobalLayerItems
      const globalProject = minimalSlideProject()
      globalProject.globalLayerItems = [
        {
          item: {
            layerItemId: 'global-table-1',
            label: 'Global Table',
            kind: 'native',
            content: { nativeType: 'table', data: tableContent },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 200 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
          visibility: { mode: 'all', locationIds: [] },
          plane: 'overlay',
        },
      ]
      const globalResult = courseProjectDocumentSchema.safeParse(globalProject)
      expect(globalResult.success).toBe(false)

      // 3. Spatial surfaceLayerItems
      const spatialProject = createBlankSpatialCourseProject()
      const spatialSurface = spatialProject.surfaces.find((s) => s.type === 'spatial-2d')!
      spatialSurface.surfaceLayerItems = [
        {
          item: {
            layerItemId: 'spatial-table-1',
            label: 'Spatial Table',
            kind: 'native',
            content: { nativeType: 'table', data: tableContent },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 200 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
          visibility: { mode: 'all', locationIds: [] },
        },
      ]
      const spatialResult = courseProjectDocumentSchema.safeParse(spatialProject)
      expect(spatialResult.success).toBe(false)

      // 4. Spatial world.layerItems
      const spatialProject2 = createBlankSpatialCourseProject()
      const spatialSurface2 = spatialProject2.surfaces.find((s) => s.type === 'spatial-2d')!
      if ('world' in spatialSurface2) {
        spatialSurface2.world.layerItems = [
          {
            layerItemId: 'world-chart-1',
            label: 'World Chart',
            kind: 'native',
            content: { nativeType: 'chart', data: sampleChartContent('bar') },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 200 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
        ]
      }
      expect(courseProjectDocumentSchema.safeParse(spatialProject2).success).toBe(false)
    })
  })

  describe('Native Input Contract (r12-006)', () => {
    function sampleInputContent(overrides?: Partial<NativeInputContent>): NativeInputContent {
      return {
        answerType: 'text',
        placeholder: '请输入答案',
        stateKey: 'userAnswer',
        validityKey: 'isAnswerValid',
        ruleFamilyRuleIds: ['rule_submit_1'],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 16,
          textColor: '#1f2937',
          fillColor: '#ffffff',
          fillOpacity: 1,
          borderColor: '#d1d5db',
          borderOpacity: 1,
          borderWidth: 1,
          cornerRadius: 4,
          horizontalAlign: 'left',
          padding: 8,
        },
        ...overrides,
      }
    }

    function slideProjectWithInput(
      inputContent: NativeInputContent,
      options?: {
        nodeId?: string
        customCourseState?: CourseProjectDocument['courseState']
        customInteractions?: CourseProjectDocument['globalInteractions']
      },
    ): CourseProjectDocument {
      const base = minimalSlideProject()
      const nodeId = options?.nodeId ?? 'input_node_1'
      base.courseState = options?.customCourseState ?? [
        {
          key: inputContent.stateKey,
          valueType: inputContent.answerType === 'text' ? 'string' : 'number',
          defaultValue: (inputContent.answerType === 'text' ? '' : 0) as any,
        },
        {
          key: inputContent.validityKey,
          valueType: 'boolean',
          defaultValue: false,
        },
      ]
      const slideSurface = base.surfaces.find((s) => s.type === 'slide')
      if (slideSurface && slideSurface.type === 'slide') {
        slideSurface.scenes[0]!.layerItems = [
          {
            layerItemId: nodeId,
            label: 'Input Node',
            kind: 'native',
            content: { nativeType: 'input', data: inputContent },
            frame: { mode: 'absolute', x: 50, y: 50, width: 300, height: 44 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
        ]
        slideSurface.scenes[0]!.interactions = options?.customInteractions ?? [
          {
            id: 'rule_submit_1',
            name: '提交答案',
            enabled: true,
            trigger: { type: 'input.submit', nodeId },
            conditions: [],
            actions: [
              {
                id: 'action_1',
                start: 'after-previous',
                delayMs: 0,
                action: { type: 'scene.next' },
              },
            ],
          },
        ]
      }
      return base
    }

    it('accepts valid text Input in Slide scene with matching string state and boolean validity', () => {
      const project = slideProjectWithInput(sampleInputContent({ answerType: 'text' }))
      const result = courseProjectDocumentSchema.safeParse(project)
      expect(result.success).toBe(true)
    })

    it('accepts valid number Input in Slide scene with matching number state and boolean validity', () => {
      const project = slideProjectWithInput(sampleInputContent({
        answerType: 'number',
        stateKey: 'numAnswer',
        validityKey: 'numValid',
      }))
      const result = courseProjectDocumentSchema.safeParse(project)
      expect(result.success).toBe(true)
    })

    it('rejects Input if stateKey is missing from courseState', () => {
      const content = sampleInputContent()
      const project = slideProjectWithInput(content, {
        customCourseState: [
          { key: 'isAnswerValid', valueType: 'boolean', defaultValue: false },
        ],
      })
      const result = courseProjectDocumentSchema.safeParse(project)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('Missing course-state key: userAnswer'))).toBe(true)
      }
    })

    it('rejects Input if stateKey value type mismatches answerType', () => {
      // answerType is text, but stateKey is number
      const projectTextMismatch = slideProjectWithInput(sampleInputContent({ answerType: 'text' }), {
        customCourseState: [
          { key: 'userAnswer', valueType: 'number', defaultValue: 0 },
          { key: 'isAnswerValid', valueType: 'boolean', defaultValue: false },
        ],
      })
      expect(courseProjectDocumentSchema.safeParse(projectTextMismatch).success).toBe(false)

      // answerType is number, but stateKey is string
      const projectNumMismatch = slideProjectWithInput(sampleInputContent({ answerType: 'number' }), {
        customCourseState: [
          { key: 'userAnswer', valueType: 'string', defaultValue: '' },
          { key: 'isAnswerValid', valueType: 'boolean', defaultValue: false },
        ],
      })
      expect(courseProjectDocumentSchema.safeParse(projectNumMismatch).success).toBe(false)
    })

    it('rejects Input if validityKey is missing or not a boolean state', () => {
      // Missing validityKey
      const missingValidity = slideProjectWithInput(sampleInputContent(), {
        customCourseState: [
          { key: 'userAnswer', valueType: 'string', defaultValue: '' },
        ],
      })
      expect(courseProjectDocumentSchema.safeParse(missingValidity).success).toBe(false)

      // validityKey is string
      const stringValidity = slideProjectWithInput(sampleInputContent(), {
        customCourseState: [
          { key: 'userAnswer', valueType: 'string', defaultValue: '' },
          { key: 'isAnswerValid', valueType: 'string', defaultValue: '' },
        ],
      })
      expect(courseProjectDocumentSchema.safeParse(stringValidity).success).toBe(false)
    })

    it('rejects Input if stateKey === validityKey', () => {
      const project = slideProjectWithInput(sampleInputContent({
        stateKey: 'sharedKey',
        validityKey: 'sharedKey',
      }))
      expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)
    })

    it('rejects Input if ruleFamilyRuleIds exceeds 17 rules', () => {
      const ruleIds = Array.from({ length: 18 }, (_, i) => `rule_${i + 1}`)
      const project = slideProjectWithInput(sampleInputContent({
        ruleFamilyRuleIds: ruleIds,
      }))
      expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)
    })

    it('rejects Input if ruleFamilyRuleIds has duplicate rule IDs', () => {
      const project = slideProjectWithInput(sampleInputContent({
        ruleFamilyRuleIds: ['rule_1', 'rule_1'],
      }))
      expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)
    })

    it('rejects Input if ruleFamilyRuleIds references missing scene interaction', () => {
      const project = slideProjectWithInput(sampleInputContent({
        ruleFamilyRuleIds: ['non_existent_rule'],
      }))
      const result = courseProjectDocumentSchema.safeParse(project)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('Input rule family references missing interaction rule'))).toBe(true)
      }
    })

    it('rejects Input if ruleFamilyRuleIds rule targets a different nodeId or wrong trigger type', () => {
      // Target wrong node
      const projectWrongNode = slideProjectWithInput(sampleInputContent(), {
        customInteractions: [
          {
            id: 'rule_submit_1',
            name: '提交答案',
            enabled: true,
            trigger: { type: 'input.submit', nodeId: 'other_node' },
            conditions: [],
            actions: [
              {
                id: 'action_1',
                start: 'after-previous',
                delayMs: 0,
                action: { type: 'presentation.set', stateId: 'state-1' },
              },
            ],
          },
        ],
      })
      expect(courseProjectDocumentSchema.safeParse(projectWrongNode).success).toBe(false)

      // Trigger type is node.click instead of input.submit
      const projectWrongTrigger = slideProjectWithInput(sampleInputContent(), {
        customInteractions: [
          {
            id: 'rule_submit_1',
            name: '提交答案',
            enabled: true,
            trigger: { type: 'node.click', nodeId: 'input_node_1' },
            conditions: [],
            actions: [
              {
                id: 'action_1',
                start: 'after-previous',
                delayMs: 0,
                action: { type: 'presentation.set', stateId: 'state-1' },
              },
            ],
          },
        ],
      })
      expect(courseProjectDocumentSchema.safeParse(projectWrongTrigger).success).toBe(false)
    })

    it('rejects input.submit trigger in global interactions', () => {
      const project = minimalSlideProject()
      project.globalInteractions = [
        {
          id: 'global_rule_1',
          name: '全局提交',
          enabled: true,
          trigger: { type: 'input.submit', nodeId: 'any_node' },
          conditions: [],
          actions: [
            {
              id: 'a1',
              start: 'after-previous',
              delayMs: 0,
              action: { type: 'scene.next' },
            },
          ],
        },
      ]
      const result = courseProjectDocumentSchema.safeParse(project)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('Global interactions do not support input.submit trigger'))).toBe(true)
      }
    })

    it('rejects input.submit trigger targeting a non-input node or non-existent node', () => {
      const project = minimalSlideProject()
      const slideSurface = project.surfaces.find((s) => s.type === 'slide')!
      slideSurface.scenes[0]!.layerItems = [
        sceneNodeToCourseLayerItem(createRectangleNode({ id: 'rect_1', name: '矩形' }), 0),
      ]
      slideSurface.scenes[0]!.interactions = [
        {
          id: 'rule_bad_target',
          name: '指向矩形',
          enabled: true,
          trigger: { type: 'input.submit', nodeId: 'rect_1' },
          conditions: [],
          actions: [
            {
              id: 'a1',
              start: 'after-previous',
              delayMs: 0,
              action: { type: 'presentation.set', stateId: 'state-1' },
            },
          ],
        },
      ]
      const result = courseProjectDocumentSchema.safeParse(project)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('Input submit trigger must target a scene-local native input'))).toBe(true)
      }
    })

    it('strictly rejects Native Input in Flow, Global, Slide Surface, and Spatial containers', () => {
      const inputData = sampleInputContent()

      // 1. Flow surfaceLayerItems
      const flowProject = createBlankFlowCourseProject()
      const flowSurface = flowProject.surfaces.find((s) => s.type === 'flow')!
      flowSurface.surfaceLayerItems = [
        {
          item: {
            layerItemId: 'flow-input-1',
            label: 'Flow Input',
            kind: 'native',
            content: { nativeType: 'input', data: inputData },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 44 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
          visibility: { mode: 'all', locationIds: [] },
        },
      ]
      expect(courseProjectDocumentSchema.safeParse(flowProject).success).toBe(false)

      // 2. Slide surface-level surfaceLayerItems
      const slideBase = minimalSlideProject()
      const slideSurface = slideBase.surfaces.find((s) => s.type === 'slide')!
      slideSurface.surfaceLayerItems = [
        {
          item: {
            layerItemId: 'slide-surface-input-1',
            label: 'Slide Surface Input',
            kind: 'native',
            content: { nativeType: 'input', data: inputData },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 44 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
          visibility: { mode: 'all', locationIds: [] },
        },
      ]
      expect(courseProjectDocumentSchema.safeParse(slideBase).success).toBe(false)

      // 3. Global layer items
      const globalProject = minimalSlideProject()
      globalProject.globalLayerItems = [
        {
          item: {
            layerItemId: 'global-input-1',
            label: 'Global Input',
            kind: 'native',
            content: { nativeType: 'input', data: inputData },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 44 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
          visibility: { mode: 'all', locationIds: [] },
          plane: 'overlay',
        },
      ]
      expect(courseProjectDocumentSchema.safeParse(globalProject).success).toBe(false)

      // 4. Spatial surfaceLayerItems
      const spatialProject = createBlankSpatialCourseProject()
      const spatialSurface = spatialProject.surfaces.find((s) => s.type === 'spatial-2d')!
      spatialSurface.surfaceLayerItems = [
        {
          item: {
            layerItemId: 'spatial-input-1',
            label: 'Spatial Input',
            kind: 'native',
            content: { nativeType: 'input', data: inputData },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 44 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
          visibility: { mode: 'all', locationIds: [] },
        },
      ]
      expect(courseProjectDocumentSchema.safeParse(spatialProject).success).toBe(false)

      // 5. Spatial world.layerItems
      const spatialProject2 = createBlankSpatialCourseProject()
      const spatialSurface2 = spatialProject2.surfaces.find((s) => s.type === 'spatial-2d')!
      if ('world' in spatialSurface2) {
        spatialSurface2.world.layerItems = [
          {
            layerItemId: 'world-input-1',
            label: 'World Input',
            kind: 'native',
            content: { nativeType: 'input', data: inputData },
            frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 44 },
            order: 0,
            visible: true,
            locked: false,
            rotation: 0,
            opacity: 1,
            hitPolicy: 'auto',
            playbackInitialVisibility: 'inherit',
          },
        ]
      }
      expect(courseProjectDocumentSchema.safeParse(spatialProject2).success).toBe(false)
    })

    it('rejects Input with invalid style or content fields', () => {
      // Invalid fontSize (min is 6)
      const badFont = sampleInputContent({
        style: {
          ...sampleInputContent().style,
          fontSize: 0,
        },
      })
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithInput(badFont)).success).toBe(false)

      // Invalid fillOpacity (must be 0..1)
      const badOpacity = sampleInputContent({
        style: {
          ...sampleInputContent().style,
          fillOpacity: 1.5,
        },
      })
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithInput(badOpacity)).success).toBe(false)

      // Extra unknown property on input content
      const extraProp = { ...sampleInputContent(), extraField: 'invalid' }
      expect(courseProjectDocumentSchema.safeParse(slideProjectWithInput(extraProp as any)).success).toBe(false)
    })
  })
})
