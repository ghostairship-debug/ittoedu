import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { getEffectiveCourseLayerOrder } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTextNode } from '@/renderer/project/createProject'
import { isFlowDocumentBlockId } from '@/renderer/course/effectiveLayerProjection'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import { isFlowZOrderLayerBlock } from '@/renderer/course/flowEditorSlice'
import { buildFlowEditorView, listFlowCourseTreePages } from '@/renderer/course/flowEditorView'

const NOW = '2026-08-17T09:10:00.000Z'

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'course-flow-view',
    revision: 4,
    title: 'Flow 投影测试',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-image': {
        id: 'asset-image',
        filename: 'cover.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/cover.png',
        byteLength: 1024,
        width: 640,
        height: 360,
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
    globalLayerItems: [],
    globalInteractions: [],
  }
}

function flowBlocksFixture(): FlowBlock[] {
  return [
    { id: 'block-h1', type: 'heading', level: 1, text: '第一章 开始' },
    { id: 'block-paragraph', type: 'paragraph', text: '正文段落' },
    {
      id: 'block-list',
      type: 'list',
      ordered: true,
      items: [
        { id: 'list-item-1', text: '项目一' },
        { id: 'list-item-2', text: '项目二' },
      ],
    },
    { id: 'block-quote', type: 'quote', text: '引用文字', citation: '出处' },
    {
      id: 'block-media',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      altText: '示意图',
      caption: '封面图',
      layout: 'content-width',
    },
    {
      id: 'block-section',
      type: 'section',
      title: '章节 A',
      collapsedByDefault: true,
      blocks: [
        { id: 'block-h2', type: 'heading', level: 2, text: '小节 1' },
        { id: 'block-section-p', type: 'paragraph', text: '节内正文' },
      ],
    },
  ]
}

function flowFixture(): {
  project: CourseProjectDocument
  locationId: string
  surfaceId: string
} {
  const overlay = sceneNodeToCourseLayerItem(createTextNode({
    id: 'surface-shared',
    name: '表面共享层',
    text: '浮层',
  }), 20)
  const hiddenOverlay = sceneNodeToCourseLayerItem(createTextNode({
    id: 'surface-hidden',
    name: '表面隐藏层',
    text: '隐藏',
    visible: false,
  }), 30)
  const globalVisible = sceneNodeToCourseLayerItem(createTextNode({
    id: 'global-banner',
    name: '全局横幅',
    text: '全局',
  }), 50)
  const globalHidden = sceneNodeToCourseLayerItem(createTextNode({
    id: 'global-hidden',
    name: '作用域外全局层',
    text: '隐藏全局',
  }), 10)
  const globalOverlay = sceneNodeToCourseLayerItem(createTextNode({
    id: 'global-overlay',
    name: '全局前景',
    text: '前景',
  }), 60)

  const project: CourseProjectDocument = {
    ...courseShell(),
    locations: [{
      id: 'block-h1',
      label: '第一章 开始',
      kind: 'flow-block',
      surfaceId: 'flow-surface',
      blockId: 'block-h1',
    }],
    startLocationId: 'block-h1',
    globalLayerItems: [
      {
        item: globalHidden,
        visibility: { mode: 'exclude', locationIds: ['block-h1'] },
      },
      {
        item: globalVisible,
        plane: 'underlay',
        visibility: { mode: 'all', locationIds: [] },
      },
      {
        item: globalOverlay,
        plane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
      },
    ],
    surfaces: [{
      id: 'flow-surface',
      type: 'flow',
      title: '流式讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      surfaceLayerItems: [
        { item: overlay, visibility: { mode: 'include', locationIds: ['block-h1'] } },
        { item: hiddenOverlay, visibility: { mode: 'all', locationIds: [] } },
      ],
      blocks: flowBlocksFixture(),
    }],
  }
  syncFlowCourseLocations(project, 'flow-surface')
  return {
    project: courseProjectDocumentSchema.parse(project),
    locationId: 'block-h1',
    surfaceId: 'flow-surface',
  }
}

describe('Flow editor read projection', () => {
  it('builds a frozen document view with makeAuthoringAddress and does not mutate the project', () => {
    const fixture = flowFixture()
    const before = structuredClone(fixture.project)
    const view = buildFlowEditorView({
      project: fixture.project,
      locationId: fixture.locationId,
    })

    expect(view).toMatchObject({
      projectId: 'course-flow-view',
      revision: fixture.project.revision,
      locationId: fixture.locationId,
      surfaceId: 'flow-surface',
      surfaceTitle: '流式讲义',
      activeBlockId: 'block-h1',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
    })
    expect(view.blocks[0]).toMatchObject({
      blockId: 'block-h1',
      parentId: null,
      navigable: true,
      layerKind: 'document-block',
      authoringAddress: makeAuthoringAddress({
        projectId: fixture.project.id,
        scope: 'surface',
        surfaceId: 'flow-surface',
        carrier: 'native',
        layerItemId: 'block-h1',
        field: 'block',
      }),
    })
    expect(view.blocks.find((block) => block.blockId === 'block-paragraph')).toMatchObject({
      navigable: false,
      layerKind: 'document-block',
    })
    expect(view.blocks.map((block) => ({
      blockId: block.blockId,
      parentId: block.parentId,
      depth: block.depth,
      index: block.index,
    }))).toEqual([
      { blockId: 'block-h1', parentId: null, depth: 0, index: 0 },
      { blockId: 'block-paragraph', parentId: null, depth: 0, index: 1 },
      { blockId: 'block-list', parentId: null, depth: 0, index: 2 },
      { blockId: 'block-quote', parentId: null, depth: 0, index: 3 },
      { blockId: 'block-media', parentId: null, depth: 0, index: 4 },
      { blockId: 'block-section', parentId: null, depth: 0, index: 5 },
      { blockId: 'block-h2', parentId: 'block-section', depth: 1, index: 0 },
      { blockId: 'block-section-p', parentId: 'block-section', depth: 1, index: 1 },
    ])
    expect(fixture.project).toEqual(before)
    expect(Object.isFrozen(view)).toBe(true)
    expect(view.blocks[0]?.authoringAddress).not.toContain('hitId')
  })

  it('puts only heading/section on the course tree and never treats paragraphs as locations', () => {
    const fixture = flowFixture()
    const view = buildFlowEditorView({
      project: fixture.project,
      locationId: fixture.locationId,
    })
    expect(view.outline.map((entry) => [entry.blockId, entry.kind])).toEqual([
      ['block-h1', 'heading'],
      ['block-section', 'section'],
      ['block-h2', 'heading'],
    ])
    expect(view.outline.some((entry) => entry.blockId === 'block-paragraph')).toBe(false)
    expect(view.courseTree.headings.map((entry) => entry.blockId)).toEqual([
      'block-h1',
      'block-section',
      'block-h2',
    ])
    expect(listFlowCourseTreePages(fixture.project)[0]?.headings.some((entry) =>
      entry.blockId === 'block-paragraph',
    )).toBe(false)
    expect(fixture.project.locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === 'block-paragraph',
    )).toBe(false)
    expect(fixture.project.locations.every((location) =>
      location.kind === 'flow-block' && ['block-h1', 'block-section', 'block-h2'].includes(location.blockId),
    )).toBe(true)
  })

  it('lists only overlay layers in z-order and keeps document blocks off the layer list', () => {
    const fixture = flowFixture()
    const view = buildFlowEditorView({
      project: fixture.project,
      locationId: fixture.locationId,
    })
    expect(view.overlayLayers.map((layer) => [
      layer.source,
      layer.selectionId,
      layer.globalPlane,
      layer.stackOrder,
    ])).toEqual([
      ['global', 'global-banner', 'underlay', 0],
      ['surface', 'surface-shared', null, 1],
      ['surface', 'surface-hidden', null, 2],
      ['global', 'global-overlay', 'overlay', 4],
    ])
    expect(view.overlayLayers.some((layer) => layer.selectionId === 'block-paragraph')).toBe(false)
    expect(view.overlayLayers.some((layer) => layer.selectionId === 'block-h1')).toBe(false)
    expect(view.overlayLayers.some((layer) => layer.selectionId === 'block-media')).toBe(false)
    expect(view.blocks.every((block) => isFlowZOrderLayerBlock(block.block as FlowBlock) === false)).toBe(true)
    expect(isFlowDocumentBlockId(fixture.project, 'block-paragraph')).toBe(true)
    expect(getEffectiveCourseLayerOrder({
      project: fixture.project,
      surfaceId: fixture.surfaceId,
      locationId: fixture.locationId,
    }).map((entry) => entry.item.layerItemId)).toEqual([
      'global-banner',
      'surface-shared',
      'surface-hidden',
      'global-overlay',
    ])
    expect(view.overlayLayers.find((layer) => layer.selectionId === 'surface-shared')?.authoringAddress).toBe(
      makeAuthoringAddress({
        projectId: fixture.project.id,
        scope: 'surface',
        surfaceId: 'flow-surface',
        carrier: 'native',
        layerItemId: 'surface-shared',
        field: 'item',
      }),
    )
  })

  it('rejects unknown locations and non-Flow locations', () => {
    const fixture = flowFixture()
    expect(() => buildFlowEditorView({
      project: fixture.project,
      locationId: 'missing-location',
    })).toThrow('找不到课程位置：missing-location')
  })
})
