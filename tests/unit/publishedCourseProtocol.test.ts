import { afterEach, describe, expect, it, vi } from 'vitest'
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
import {
  PLAYER_V2_ENTRY_CORRUPT_ERROR,
  PLAYER_V2_ENTRY_UNSUPPORTED_ERROR,
  bootstrapPlayer,
  parsePublishedCourseV2Entry,
  startPlayer,
} from '@/player/index'
import { CoursePlayer } from '@/player/surfaces/CoursePlayer'

const NOW = '2026-08-17T00:00:00.000Z'
const retiredPublishedPayload = {
  format: ['h5lesson', 'published'].join('-'),
  formatVersion: 1,
}

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

  it('owns the historical Published asset-key and layer-item ID boundaries directly', () => {
    const published = publish(flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ]))
    const assetIdAtLimit = 'a'.repeat(240)
    published.assets[assetIdAtLimit] = { mimeType: 'image/png', url: './asset.png' }
    expect(publishedCourseV2Schema.safeParse(published).success).toBe(true)

    const whitespaceAssetId = structuredClone(published)
    whitespaceAssetId.assets[' bad-id '] = { mimeType: 'image/png', url: './bad.png' }
    expect(publishedCourseV2Schema.safeParse(whitespaceAssetId).success).toBe(false)

    const longAssetId = structuredClone(published)
    longAssetId.assets['a'.repeat(241)] = { mimeType: 'image/png', url: './bad.png' }
    expect(publishedCourseV2Schema.safeParse(longAssetId).success).toBe(false)

    const layerIdAtLimit = 'l'.repeat(200)
    const layerProject = flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ])
    layerProject.globalLayerItems = [{
      item: nativeText(layerIdAtLimit, 10, '全局层'),
      visibility: { mode: 'all', locationIds: [] },
    }]
    const layerPayload = publish(layerProject)
    expect(publishedCourseV2Schema.safeParse(layerPayload).success).toBe(true)
    layerPayload.globalLayerItems[0]!.item.layerItemId = 'l'.repeat(201)
    expect(publishedCourseV2Schema.safeParse(layerPayload).success).toBe(false)
  })

  it('validates Slide presentation semantics without reconstructing an authoring scene', () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const surface = project.surfaces[0]
    if (surface?.type !== 'slide') throw new Error('expected slide surface')
    const scene = surface.scenes[0]!
    scene.layerItems = [nativeText('scene-item', 1, '正文')]
    scene.presentation = {
      initialStateId: 'state-1',
      states: [{ id: 'state-1', name: '状态 1', layerItemOverrides: {} }],
    }
    const published = publish(project)

    const missingOverrideTarget = structuredClone(published)
    const missingScene = missingOverrideTarget.surfaces[0]
    if (missingScene?.type !== 'slide') throw new Error('expected slide surface')
    missingScene.scenes[0]!.presentation!.states[0]!.layerItemOverrides.missing = { visible: false }
    expect(publishedCourseV2Schema.safeParse(missingOverrideTarget).success).toBe(false)

    const invalidOrder = structuredClone(published)
    const orderScene = invalidOrder.surfaces[0]
    if (orderScene?.type !== 'slide') throw new Error('expected slide surface')
    orderScene.scenes[0]!.presentation!.states[0]!.layerItemOrder = ['scene-item', 'scene-item']
    expect(publishedCourseV2Schema.safeParse(invalidOrder).success).toBe(false)

    const shadowedLayerField = structuredClone(published)
    const shadowScene = shadowedLayerField.surfaces[0]
    if (shadowScene?.type !== 'slide') throw new Error('expected slide surface')
    shadowScene.scenes[0]!.presentation!.states[0]!.layerItemOverrides['scene-item'] = {
      nativeData: { x: 10 },
    }
    expect(publishedCourseV2Schema.safeParse(shadowedLayerField).success).toBe(false)

    const duplicateScene = structuredClone(published)
    const duplicateSurface = duplicateScene.surfaces[0]
    if (duplicateSurface?.type !== 'slide') throw new Error('expected slide surface')
    duplicateSurface.scenes.push(structuredClone(duplicateSurface.scenes[0]!))
    expect(publishedCourseV2Schema.safeParse(duplicateScene).success).toBe(false)
  })

  it('validates Flow and Spatial local invariants directly on Published surfaces', () => {
    const flow = publish(flowProject([{
      id: 'section',
      type: 'section',
      title: '章节',
      collapsedByDefault: false,
      blocks: [{ id: 'paragraph', type: 'paragraph', text: '正文' }],
    }]))
    const duplicateBlock = structuredClone(flow)
    const duplicateFlow = duplicateBlock.surfaces[0]
    if (duplicateFlow?.type !== 'flow') throw new Error('expected flow surface')
    const section = duplicateFlow.blocks[0]
    if (section?.type !== 'section') throw new Error('expected section')
    section.blocks[0]!.id = 'section'
    expect(publishedCourseV2Schema.safeParse(duplicateBlock).success).toBe(false)

    const invalidLayout = structuredClone(flow)
    const layoutFlow = invalidLayout.surfaces[0]
    if (layoutFlow?.type !== 'flow') throw new Error('expected flow surface')
    layoutFlow.layout.wideContentWidth = layoutFlow.layout.readingWidth - 1
    expect(publishedCourseV2Schema.safeParse(invalidLayout).success).toBe(false)

    const spatial = publish(spatialProject([nativeText('world-item', 1, '空间项')]))
    const duplicateFrame = structuredClone(spatial)
    const frameSurface = duplicateFrame.surfaces[0]
    if (frameSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    frameSurface.camera.frames.push(structuredClone(frameSurface.camera.frames[0]!))
    expect(publishedCourseV2Schema.safeParse(duplicateFrame).success).toBe(false)

    const danglingZoom = structuredClone(spatial)
    const zoomSurface = danglingZoom.surfaces[0]
    if (zoomSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    zoomSurface.semanticZoom = [{
      id: 'zoom-1',
      layerItemIds: ['missing-item'],
      minZoom: 0.5,
      maxZoom: 1,
      visible: true,
    }]
    expect(publishedCourseV2Schema.safeParse(danglingZoom).success).toBe(false)
  })

  it('round-trips Unicode titles and package-relative asset URLs through the V2 entry parser', () => {
    const published = publish(flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '中文课件 🎓' },
    ]))
    const packaged = {
      ...published,
      title: '中文课件 🎓',
      assets: {
        ...published.assets,
        cover: {
          mimeType: 'image/png',
          url: './assets/000-cover.png',
        },
      },
    }
    expect(parsePublishedCourseV2Entry(JSON.stringify(packaged))).toEqual(
      publishedCourseV2Schema.parse(packaged),
    )
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

describe('Player bundle entry is Published V2 only', () => {
  afterEach(async () => {
    delete window.__H5_COURSE_PAYLOAD__
    delete window.__H5_LESSON_PAYLOAD__
    delete window.__H5_LESSON_PAYLOAD_FALLBACK__
    delete window.__H5_LESSON_PAYLOAD_URL__
    window.__H5_LESSON_PLAYER__?.destroy()
    await bootstrapPlayer()?.destroy()
    document.getElementById('course-root')?.remove()
    document.getElementById('lesson-root')?.remove()
  })

  it('strict-parses Published V2 and mounts CoursePlayer', async () => {
    const published = publish(flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ]))
    const root = document.createElement('div')
    root.id = 'course-root'
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 720 },
    })
    document.body.append(root)

    const session = startPlayer(published, root)
    expect(session.player).toBeInstanceOf(CoursePlayer)
    expect(parsePublishedCourseV2Entry(JSON.stringify(published)).courseId).toBe(published.courseId)

    await vi.waitFor(() => {
      expect(window.__H5_LESSON_PLAYER__?.session).toBe(session)
    })
    expect(window.__H5_LESSON_PLAYER__).not.toHaveProperty('game')
    expect(session.listCatalog().map((entry) => entry.kind)).toEqual(['flow'])
  })

  it('keeps a replacement Player mounted when the abandoned start settles late', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const published = publish(flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ]))
    const root = document.createElement('div')
    root.id = 'course-root'
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 720 },
    })
    document.body.append(root)

    const abandoned = startPlayer(published, root)
    const replacement = startPlayer(published, root)

    await vi.waitFor(() => {
      expect(window.__H5_LESSON_PLAYER__?.session).toBe(replacement)
    })
    expect(window.__H5_LESSON_PLAYER__?.session).not.toBe(abandoned)
    expect(root.querySelector('.course-player-error')).toBeNull()
    expect(root.querySelector('.flow-surface-host')).not.toBeNull()
  })

  it('fail-louds retired player envelopes, encoded payload, and corrupt V2', () => {
    expect(() => parsePublishedCourseV2Entry({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    })).toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)

    expect(() => parsePublishedCourseV2Entry(retiredPublishedPayload))
      .toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)

    expect(() => parsePublishedCourseV2Entry('AAAA')).toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)
    expect(() => startPlayer({
      project: { schemaVersion: 8, scenes: [{ id: 'scene-1' }] },
      assets: {},
      components: {},
    })).toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)

    const published = publish(flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ]))
    expect(() => parsePublishedCourseV2Entry({
      ...published,
      locations: [],
    })).toThrow(PLAYER_V2_ENTRY_CORRUPT_ERROR)
    expect(() => parsePublishedCourseV2Entry('{')).toThrow(PLAYER_V2_ENTRY_CORRUPT_ERROR)
  })

  it('shows an actionable error for leftover __H5_LESSON_PAYLOAD__ and does not mount a player', () => {
    const root = document.createElement('div')
    root.id = 'lesson-root'
    document.body.append(root)
    window.__H5_LESSON_PAYLOAD__ = {
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    }

    expect(bootstrapPlayer()).toBeNull()
    expect(root.textContent).toContain(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)
    expect(window.__H5_LESSON_PLAYER__).toBeUndefined()
    expect(root.querySelector('.lesson-player-error')).not.toBeNull()
  })

  it('bootstraps __H5_COURSE_PAYLOAD__ onto #course-root', async () => {
    const published = publish(flowProject([
      { id: 'heading', type: 'heading', level: 1, text: '标题' },
    ]))
    const root = document.createElement('div')
    root.id = 'course-root'
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 720 },
    })
    document.body.append(root)
    window.__H5_COURSE_PAYLOAD__ = published

    const session = bootstrapPlayer()
    expect(session?.player).toBeInstanceOf(CoursePlayer)
    await vi.waitFor(() => {
      expect(window.__H5_LESSON_PLAYER__?.session).toBe(session)
    })
  })

  describe('Table and Chart Published V2 validation (r12-000)', () => {
    it('accepts Published Slide scene with Table and Chart', () => {
      const baseProject: CourseProjectDocument = {
        ...courseShell(),
        id: 'published-table-slide',
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
          title: '幻灯片',
          type: 'slide',
          surfaceLayerItems: [],
          canvas: { width: 1280, height: 720 },
          scenes: [{
            id: 'scene-1',
            name: '场景 1',
            backgroundColor: '#ffffff',
            layerItems: [
              {
                layerItemId: 'layer-table',
                label: 'Table Layer',
                kind: 'native',
                content: {
                  nativeType: 'table',
                  data: {
                    columns: [{ id: 'c1', width: 100 }, { id: 'c2', width: 100 }],
                    rows: [{
                      id: 'r1',
                      height: 40,
                      cells: [
                        { id: 'cell-1', columnId: 'c1', text: 'A' },
                        { id: 'cell-2', columnId: 'c2', text: 'B' },
                      ],
                    }],
                    headerRowCount: 0,
                    style: {
                      fillColor: '#ffffff',
                      fillOpacity: 1,
                      borderColor: '#cccccc',
                      borderOpacity: 1,
                      borderWidth: 1,
                      lineStyle: 'solid',
                      textColor: '#000000',
                      fontFamily: 'sans-serif',
                      fontSize: 14,
                      horizontalAlign: 'left',
                      verticalAlign: 'middle',
                      cellPadding: 4,
                    },
                  },
                },
                frame: { mode: 'absolute', x: 10, y: 10, width: 200, height: 100 },
                order: 0,
                visible: true,
                locked: false,
                rotation: 0,
                opacity: 1,
                hitPolicy: 'auto',
                playbackInitialVisibility: 'inherit',
              },
              {
                layerItemId: 'layer-chart',
                label: 'Chart Layer',
                kind: 'native',
                content: {
                  nativeType: 'chart',
                  data: {
                    chartType: 'bar',
                    title: '图表',
                    categories: [{ id: 'cat1', label: 'C1' }],
                    series: [{
                      id: 's1',
                      name: 'S1',
                      color: '#ff0000',
                      points: [{ id: 'p1', categoryId: 'cat1', value: 10 }],
                    }],
                    style: {
                      backgroundColor: '#ffffff',
                      backgroundOpacity: 1,
                      fontFamily: 'sans-serif',
                      fontSize: 12,
                      textColor: '#000000',
                      showLegend: true,
                      legendPosition: 'top',
                      showDataLabels: false,
                      showCategoryAxis: true,
                      showValueAxis: true,
                      showGridLines: true,
                    },
                  },
                },
                frame: { mode: 'absolute', x: 250, y: 10, width: 300, height: 200 },
                order: 1,
                visible: true,
                locked: false,
                rotation: 0,
                opacity: 1,
                hitPolicy: 'auto',
                playbackInitialVisibility: 'inherit',
              },
            ],
            interactions: [],
          }],
        }],
      }

      const published = publish(baseProject)
      expect(publishedCourseV2Schema.safeParse(published).success).toBe(true)
    })

    it('rejects Published Flow and Global layers containing Table or Chart', () => {
      const baseProject: CourseProjectDocument = {
        ...courseShell(),
        id: 'published-invalid-flow',
        locations: [{
          id: 'location-flow',
          label: '正文',
          kind: 'flow-block',
          surfaceId: 'surface-flow',
          blockId: 'block-1',
        }],
        startLocationId: 'location-flow',
        surfaces: [{
          id: 'surface-flow',
          title: '讲义',
          type: 'flow',
          surfaceLayerItems: [],
          layout: { readingWidth: 760, wideContentWidth: 1120 },
          blocks: [{ id: 'block-1', type: 'paragraph', text: '内容' }],
        }],
      }

      const published = publish(baseProject)
      // Inject table into published flow surface layers
      const invalidFlowPublished = {
        ...published,
        surfaces: published.surfaces.map((s) => {
          if (s.type === 'flow') {
            return {
              ...s,
              surfaceLayerItems: [
                {
                  item: {
                    layerItemId: 'layer-flow-table',
                    frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 100 },
                    order: 0,
                    visible: true,
                    rotation: 0,
                    opacity: 1,
                    hitPolicy: 'auto',
                    playbackInitialVisibility: 'inherit',
                    kind: 'native',
                    content: {
                      nativeType: 'table',
                      data: {
                        columns: [{ id: 'c1', width: 100 }],
                        rows: [{ id: 'r1', height: 40, cells: [{ id: 'cell-1', columnId: 'c1', text: 'A' }] }],
                        headerRowCount: 0,
                        style: {
                          fillColor: '#ffffff', fillOpacity: 1, borderColor: '#cccccc', borderOpacity: 1,
                          borderWidth: 1, lineStyle: 'solid', textColor: '#000000', fontFamily: 'sans-serif',
                          fontSize: 14, horizontalAlign: 'left', verticalAlign: 'middle', cellPadding: 4,
                        },
                      },
                    },
                  },
                  visibility: { mode: 'all', locationIds: [] },
                },
              ],
            }
          }
          return s
        }),
      }
      expect(publishedCourseV2Schema.safeParse(invalidFlowPublished).success).toBe(false)
    })
  })
})
