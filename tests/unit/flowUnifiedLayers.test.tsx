import { describe, expect, it } from 'vitest'
import { getEffectiveCourseLayerOrder } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTeacherControllerNode, createTextNode } from '@/renderer/project/createProject'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import {
  flowBlockLayerMembership,
  listFlowGlobalAuthoringItems,
  projectFlowUnifiedOverlays,
  teacherControllerOverlayPlacement,
} from '@/renderer/course/flowOverlayProjection'

const NOW = '2026-08-17T17:00:00.000Z'
const PACKAGE_SHA = 'ab'.repeat(32)

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-unified-layers',
    revision: 2,
    title: 'Flow 图层投影',
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
      'asset-fallback': {
        id: 'asset-fallback',
        filename: 'fallback.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/fallback.png',
        byteLength: 64,
        width: 120,
        height: 80,
      },
    },
    componentPackages: {
      'com.example.flow': {
        packageId: 'com.example.flow',
        version: '1.0.0',
        name: 'Flow 组件',
        manifestPath: 'components/com.example.flow/manifest.json',
        runtimePath: 'components/com.example.flow/runtime.js',
        contentSha256: PACKAGE_SHA,
      },
    },
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
    globalLayerItems: [{
      item: sceneNodeToCourseLayerItem(createTeacherControllerNode({
        id: 'teacher-controller-main',
      }), 90),
      visibility: { mode: 'all', locationIds: [] },
    }],
    globalInteractions: [],
  }
}

function createFlowProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, text: '标题一' },
    { id: 'p-body', type: 'paragraph', text: '普通段落' },
    {
      id: 'media-inline',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      caption: '文中图',
      layout: 'content-width',
    },
    {
      id: 'component-inline',
      type: 'component',
      component: { packageId: 'com.example.flow', version: '1.0.0' },
      props: { title: '文中组件' },
      staticFallbackAssetId: 'asset-fallback',
    },
    { id: 'h2', type: 'heading', level: 2, text: '标题二' },
  ]
  const project: CourseProjectDocument = {
    ...courseShell(),
    locations: [{
      id: 'h1',
      label: '标题一',
      kind: 'flow-block',
      surfaceId: 'flow',
      blockId: 'h1',
    }],
    startLocationId: 'h1',
    surfaces: [{
      id: 'flow',
      type: 'flow',
      title: '讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      surfaceLayerItems: [{
        item: sceneNodeToCourseLayerItem(createTextNode({
          id: 'overlay-text',
          name: '浮层文字',
          text: '浮层',
        }), 20),
        visibility: { mode: 'all', locationIds: [] },
      }],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

describe('Flow unified overlay projection', () => {
  it('excludes paragraph, heading and in-document media/component from z-order layers', () => {
    const project = createFlowProject()
    const projection = projectFlowUnifiedOverlays(project, 'h1')
    const ownedIds = projection.documentOwned.map((entry) => entry.blockId)
    expect(ownedIds).toEqual(expect.arrayContaining([
      'h1', 'p-body', 'media-inline', 'component-inline', 'h2',
    ]))
    expect(projection.documentOwned.every((entry) => entry.membership === 'document-block')).toBe(true)
    expect(projection.documentOwned.every((entry) => entry.inUnifiedLayers === false)).toBe(true)
    expect(flowBlockLayerMembership({ id: 'p-body', type: 'paragraph', text: '普通段落' }))
      .toBe('document-block')

    expect(projection.nodesTabIds).not.toContain('h1')
    expect(projection.nodesTabIds).not.toContain('p-body')
    expect(projection.nodesTabIds).not.toContain('media-inline')
    expect(projection.nodesTabIds).not.toContain('component-inline')
    expect(projection.overlayRows.map((row) => row.layerItemId)).toEqual(
      expect.arrayContaining(['overlay-text', 'teacher-controller-main']),
    )
    expect(projection.overlayRows.every((row) => row.membership === 'viewport-overlay')).toBe(true)
    expect(projection.overlayRows.every((row) => row.placement === 'viewport-overlay')).toBe(true)
    expect(projection.overlayRows.find((row) => row.layerItemId === 'overlay-text')?.bodyPlane)
      .toBe('overlay')
    expect(projection.teacherController?.bodyPlane).toBeNull()

    const engineIds = getEffectiveCourseLayerOrder({
      project,
      surfaceId: 'flow',
      locationId: 'h1',
    }).map((entry) => entry.item.layerItemId)
    expect(engineIds).toEqual(expect.arrayContaining(['overlay-text', 'teacher-controller-main']))
    expect(engineIds).not.toContain('p-body')
    expect(engineIds).not.toContain('media-inline')
    expect(engineIds).not.toContain('component-inline')
    expect(engineIds).not.toContain('h1')
    expect(projection.effectiveOrderIds).toEqual(engineIds)
    expect(projection.nodesTabIds).toEqual(projection.overlayRows.map((row) => row.layerItemId))
  })

  it('treats the teacher controller as a viewport overlay, not a document footer', () => {
    const project = createFlowProject()
    const projection = projectFlowUnifiedOverlays(project, 'h1')
    expect(projection.teacherController).not.toBeNull()
    expect(projection.teacherController?.source).toBe('global')
    expect(projection.teacherController?.placement).toBe('viewport-overlay')
    expect(projection.teacherController?.isTeacherController).toBe(true)
    const controller = project.globalLayerItems[0]!.item
    expect(teacherControllerOverlayPlacement(controller)).toBe('viewport-overlay')
    const heading = projection.documentOwned.find((entry) => entry.blockId === 'h1')
    expect(heading?.inCourseTree).toBe(true)
    const paragraph = projection.documentOwned.find((entry) => entry.blockId === 'p-body')
    expect(paragraph?.inCourseTree).toBe(false)
  })

  it('lists every global item when entering global authoring, including hidden-at-page ones', () => {
    const project = createFlowProject()
    const hidden = structuredClone(project)
    hidden.globalLayerItems[0]!.visibility = { mode: 'exclude', locationIds: ['h1'] }
    const parsed = courseProjectDocumentSchema.parse(hidden)
    const page = projectFlowUnifiedOverlays(parsed, 'h1')
    expect(page.nodesTabIds).not.toContain('teacher-controller-main')
    expect(page.teacherController).toBeNull()
    const globalItems = listFlowGlobalAuthoringItems(parsed, 'h1')
    expect(globalItems.map((row) => row.layerItemId)).toContain('teacher-controller-main')
    expect(globalItems[0]?.isTeacherController).toBe(true)
    expect(globalItems[0]?.scopedVisible).toBe(false)
    expect(getEffectiveCourseLayerOrder({
      project: parsed,
      surfaceId: 'flow',
      locationId: 'h1',
    }).map((entry) => entry.item.layerItemId)).not.toContain('teacher-controller-main')
  })
})
