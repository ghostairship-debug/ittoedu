import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  FlowBlock,
  LayerItem,
  NativeLayerItem,
} from '@/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'
import type { PublishedCourseV2Payload } from '@/shared/publishedCourseTypes'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

const NOW = '2026-08-17T00:00:00.000Z'

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: 9,
    id: 'published-protocol',
    revision: 0,
    title: '协议课件',
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
  }
}

function nativeText(layerItemId: string, order: number, text: string): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 40, y: 60, width: 220, height: 100 },
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
      data: {
        text,
        runs: [],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 24,
          color: '#172033',
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
          align: 'left',
          verticalAlign: 'top',
          writingMode: 'horizontal',
          lineSpacing: 1.3,
          letterSpacing: 0,
          padding: 4,
          overflow: 'fixed',
          backgroundColor: '#ffffff',
          backgroundOpacity: 0,
          cornerRadius: 0,
        },
      },
    },
  }
}

function publish(project: CourseProjectDocument): PublishedCourseV2Payload {
  return buildPublishedCourseV2Payload({
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: {},
    components: {},
  })
}

function flowProject(blocks: FlowBlock[]): CourseProjectDocument {
  const start = blocks[0]
  if (!start) throw new Error('flow fixture needs a block')
  return {
    ...courseShell(),
    id: 'published-flow',
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
      surfaceLayerItems: [],
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      blocks,
    }],
  }
}

function spatialProject(worldItems: LayerItem[]): CourseProjectDocument {
  return {
    ...courseShell(),
    id: 'published-spatial',
    locations: [{
      id: 'location-spatial',
      label: '总览',
      kind: 'spatial-camera',
      surfaceId: 'surface-spatial',
      cameraFrameId: 'frame-1',
    }],
    startLocationId: 'location-spatial',
    surfaces: [{
      id: 'surface-spatial',
      title: '空间',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'finite', x: 0, y: 0, width: 1000, height: 600 },
        layerItems: worldItems,
        paths: [{
          id: 'path-1',
          name: '探索路线',
          layerItemIds: worldItems.map((item) => item.layerItemId),
          style: { color: '#112233', width: 3, dash: 'dashed' },
        }],
        relations: worldItems.length >= 2
          ? [{
              id: 'relation-1',
              sourceLayerItemId: worldItems[0]!.layerItemId,
              targetLayerItemId: worldItems[1]!.layerItemId,
              label: '从甲到乙',
              kind: 'arrow',
            }]
          : [],
      },
      camera: {
        home: { x: 400, y: 240, zoom: 1 },
        frames: [{ id: 'frame-1', name: '总览', x: 400, y: 240, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  }
}

describe('Published Course V2 protocol', () => {
  it('is a strict one-way payload: schema accepts producer output and rejects author-only fields', () => {
    const published = publish(flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ]))
    expect(publishedCourseV2Schema.parse(published)).toEqual(published)
    expect(publishedCourseV2Schema.safeParse({
      ...published,
      createdAt: 'author-only',
    }).success).toBe(false)
    expect(publishedCourseV2Schema.safeParse({
      ...published,
      revision: 1,
    }).success).toBe(false)
    expect(published).not.toHaveProperty('createdAt')
    expect(published).not.toHaveProperty('updatedAt')
    expect(published).not.toHaveProperty('componentPackages')
  })

  it('accepts an optional plane only on global entries and rejects an Underlay controller', () => {
    const project = flowProject([{ id: 'heading', type: 'heading', level: 1, text: '标题' }])
    project.globalLayerItems = [{
      item: nativeText('global-underlay', 10, '底层'),
      visibility: { mode: 'all', locationIds: [] },
    }]
    const published = publish(project)
    published.globalLayerItems[0]!.plane = 'underlay'
    expect(publishedCourseV2Schema.parse(published)).toEqual(published)

    const invalidSurfacePlane = structuredClone(published)
    const invalidEntry = structuredClone(invalidSurfacePlane.globalLayerItems[0]!)
    invalidEntry.plane = 'overlay'
    invalidSurfacePlane.globalLayerItems = []
    invalidSurfacePlane.surfaces[0]!.surfaceLayerItems.push(invalidEntry)
    expect(publishedCourseV2Schema.safeParse(invalidSurfacePlane).success).toBe(false)

    const controllerPayload = buildPublishedCourseV2Payload({
      project: createBlankCourseProject({ now: NOW }),
      assetFiles: {},
      components: {},
    })
    controllerPayload.globalLayerItems[0]!.plane = 'underlay'
    expect(publishedCourseV2Schema.safeParse(controllerPayload).success).toBe(false)
  })

  it('preserves declarative course-state interactions and closes their Published references', () => {
    const project = flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ])
    project.courseState = [{
      key: 'ready',
      valueType: 'boolean',
      defaultValue: false,
    }]
    project.globalLayerItems = [{
      item: nativeText('state-trigger', 10, '完成'),
      visibility: { mode: 'all', locationIds: [] },
    }]
    project.globalInteractions = [{
      id: 'set-ready',
      enabled: true,
      trigger: { type: 'node.click', nodeId: 'state-trigger' },
      conditions: [{
        type: 'course-state.compare',
        key: 'ready',
        operator: 'eq',
        value: false,
      }],
      actions: [{
        id: 'write-ready',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'course-state.set', key: 'ready', value: true },
      }],
    }]

    const published = publish(project)
    expect(published.globalInteractions).toEqual(project.globalInteractions)

    const invalid = publishedCourseV2Schema.safeParse({
      ...published,
      courseState: [],
    })
    expect(invalid.success).toBe(false)
    if (!invalid.success) {
      const missingStatePaths = invalid.error.issues
        .filter((issue) => issue.message.includes('Missing course-state key: ready'))
        .map((issue) => issue.path.join('.'))
      expect(missingStatePaths).toEqual(expect.arrayContaining([
        'globalInteractions.0.conditions.0.key',
        'globalInteractions.0.actions.0.action.key',
      ]))
    }
  })

  it('keeps Flow rich-text runs inside published blocks', () => {
    const published = publish(flowProject([
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
        id: 'table',
        type: 'table',
        columns: [{ id: 'c1', header: '列' }],
        rows: [{
          id: 'r1',
          cells: {
            c1: { text: '值', runs: [{ start: 0, end: 1, style: { strike: true } }] },
          },
        }],
      },
    ]))
    const flow = published.surfaces[0]
    if (flow?.type !== 'flow') throw new Error('expected flow surface')
    expect(flow.blocks).toEqual([
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
        id: 'table',
        type: 'table',
        columns: [{ id: 'c1', header: '列' }],
        rows: [{
          id: 'r1',
          cells: {
            c1: { text: '值', runs: [{ start: 0, end: 1, style: { strike: true } }] },
          },
        }],
      },
    ])
  })

  it('copies Spatial paths and relations and keeps published schema validation', () => {
    const published = publish(spatialProject([
      nativeText('layer-a', 10, '甲'),
      nativeText('layer-b', 20, '乙'),
    ]))
    const surface = published.surfaces[0]
    if (surface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(surface.world.paths).toEqual([{
      id: 'path-1',
      name: '探索路线',
      layerItemIds: ['layer-a', 'layer-b'],
      style: { color: '#112233', width: 3, dash: 'dashed' },
    }])
    expect(surface.world.relations).toEqual([{
      id: 'relation-1',
      sourceLayerItemId: 'layer-a',
      targetLayerItemId: 'layer-b',
      label: '从甲到乙',
      kind: 'arrow',
    }])
    expect(publishedCourseV2Schema.parse(published)).toEqual(published)

    const duplicate = structuredClone(published)
    const duplicateSurface = duplicate.surfaces[0]
    if (duplicateSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    duplicateSurface.world.paths = [
      { id: 'path-dup', name: '重复一', layerItemIds: ['layer-a'] },
      { id: 'path-dup', name: '重复二', layerItemIds: ['layer-b'] },
    ]
    expect(publishedCourseV2Schema.safeParse(duplicate).success).toBe(false)

    const dangling = structuredClone(published)
    const danglingSurface = dangling.surfaces[0]
    if (danglingSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    danglingSurface.world.paths = [{
      id: 'path-dangling',
      name: '悬空路径',
      layerItemIds: ['missing-layer'],
    }]
    expect(publishedCourseV2Schema.safeParse(dangling).success).toBe(false)

    const legacy = structuredClone(published) as {
      surfaces: Array<{ type: string; world?: { paths?: unknown; relations?: unknown } }>
    }
    const legacySurface = legacy.surfaces[0]
    if (!legacySurface?.world) throw new Error('expected spatial surface')
    delete legacySurface.world.paths
    delete legacySurface.world.relations
    const parsedLegacy = publishedCourseV2Schema.parse(legacy)
    const parsedSurface = parsedLegacy.surfaces[0]
    if (parsedSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(parsedSurface.world.paths).toEqual([])
    expect(parsedSurface.world.relations).toEqual([])
  })
})
