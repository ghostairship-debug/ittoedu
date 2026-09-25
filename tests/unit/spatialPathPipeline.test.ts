import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'

import {
  addSpatialCameraFrameFromSession,
} from '@/renderer/course/spatialCameraCommands'
import {
  addSpatialWorldTextLayer,
  deleteSpatialWorldLayersInSession,
  openSpatialAuthoringSession,
  selectSpatialLayers,
  spatialSurfaceIn,
  undoSpatialAuthoring,
  type SpatialAuthoringSession,
} from '@/renderer/course/spatialEditorCommands'
import { addSpatialPathInSession, deleteSpatialWorldLayersReportingReferences, setSpatialShowCameraFrames } from '@/renderer/course/spatialPathCommands'
import { resolveSpatialPlaybackSchedule, summarizeSpatialWorldReferenceCleanup } from '../../src/core/tools/spatialPath'
import { addCopiedSpatialRelationsInSession, addSpatialRelationInSession } from '@/renderer/course/spatialRelationCommands'
import { planSpatialGraphAfterWorldCopy } from '../../src/core/tools/spatialRelation'
import {
  addSpatialSemanticZoomRuleInSession,
  isSpatialItemSemanticallyVisible,
  spatialSemanticZoomKeepsSelection,
  spatialSemanticZoomWorldVisibility,
} from '@/renderer/course/spatialSemanticZoom'
import { SpatialCameraPanel } from '@/renderer/ui/SpatialCameraPanel'
import { SpatialPathEditor } from '@/renderer/ui/SpatialPathEditor'

const NOW = '2026-08-17T18:10:00.000Z'
const SURFACE_ID = 'surface-spatial'
const HOME_FRAME_ID = 'camera-home'
const LOCATION_ID = 'camera-home'

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

function nativeText(
  layerItemId: string,
  order: number,
  extra: Partial<Pick<NativeLayerItem, 'frame'>> = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: extra.frame ?? { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
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
      data: { text: layerItemId, runs: [], style: textStyle() },
    },
  }
}

function scoped(item: NativeLayerItem): ScopedLayerItem {
  return { item, visibility: { mode: 'all', locationIds: [] } }
}

function v9SpatialFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r5c-spatial-pipeline',
    revision: 1,
    title: 'R5-C Spatial pipeline',
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
    globalLayerItems: [scoped(nativeText('global-hud', 50))],
    globalInteractions: [],
    locations: [{
      id: LOCATION_ID,
      label: '空间探索 · 总览',
      kind: 'spatial-camera',
      surfaceId: SURFACE_ID,
      cameraFrameId: HOME_FRAME_ID,
    }],
    startLocationId: LOCATION_ID,
    surfaces: [{
      id: SURFACE_ID,
      title: '空间探索',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [
          nativeText('world-a', 1, {
            frame: { mode: 'absolute', x: -400, y: 2000, width: 220, height: 80 },
          }),
          nativeText('world-b', 2, {
            frame: { mode: 'absolute', x: 80, y: 120, width: 200, height: 60 },
          }),
        ],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: HOME_FRAME_ID, name: '总览', x: 0, y: 0, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  })
}

function openSession(project = v9SpatialFixture()): SpatialAuthoringSession {
  return openSpatialAuthoringSession(project, {
    locationId: LOCATION_ID,
    sessionId: 'spatial-pipeline-r5c',
  })
}

afterEach(cleanup)

describe('Spatial path/relation document pipeline', () => {
  it('round-trips camera schedule and path playback order through schema, undo, and Published V2', () => {
    let session = openSession()
    session = addSpatialCameraFrameFromSession(session, { name: '近景', id: 'camera-close', now: NOW }).nextSession!
    session = addSpatialPathInSession(session, {
      name: '探索路线',
      layerItemIds: ['world-a', 'world-b'],
      style: { color: '#112233', width: 3, dash: 'dashed' },
      id: 'path-1',
      now: NOW,
    }).nextSession!
    session = addSpatialRelationInSession(session, {
      sourceLayerItemId: 'world-a',
      targetLayerItemId: 'world-b',
      kind: 'arrow',
      label: '从甲到乙',
      id: 'relation-1',
      now: NOW,
    }).nextSession!

    const authored = courseProjectDocumentSchema.parse(structuredClone(session.history.present))
    const surface = spatialSurfaceIn(authored, SURFACE_ID)
    expect(surface.camera.frames.map((frame) => frame.id)).toEqual([HOME_FRAME_ID, 'camera-close'])
    expect(surface.world.paths).toMatchObject([{
      id: 'path-1',
      layerItemIds: ['world-a', 'world-b'],
    }])
    expect(resolveSpatialPlaybackSchedule(authored, SURFACE_ID, 'path-1').map((stop) => (
      stop.kind === 'path-waypoint' ? stop.layerItemId : stop.frameId
    ))).toEqual(['world-a', 'world-b'])

    const published = buildPublishedCourseV2Payload({
      project: authored,
      assetFiles: {},
      components: {},
    })
    const publishedSurface = publishedCourseV2Schema.parse(published).surfaces.find(
      (candidate) => candidate.type === 'spatial-2d',
    )
    expect(publishedSurface).toMatchObject({
      type: 'spatial-2d',
      world: {
        paths: [{ id: 'path-1', name: '探索路线', layerItemIds: ['world-a', 'world-b'] }],
        relations: [{ id: 'relation-1', kind: 'arrow' }],
      },
    })

    const undone = undoSpatialAuthoring(session)
    expect(spatialSurfaceIn(undone.nextSession!.history.present, SURFACE_ID).world.relations).toEqual([])
    expect(courseProjectDocumentSchema.safeParse(undone.nextSession!.history.present).success).toBe(true)
  })

  it('cleans path/relation refs after world delete, or reports the cleanup; copy remaps both-end relations', () => {
    let session = openSession()
    session = addSpatialPathInSession(session, {
      name: '探索',
      layerItemIds: ['world-a', 'world-b'],
      id: 'path-1',
      now: NOW,
    }).nextSession!
    session = addSpatialRelationInSession(session, {
      sourceLayerItemId: 'world-a',
      targetLayerItemId: 'world-b',
      kind: 'line',
      id: 'relation-1',
      now: NOW,
    }).nextSession!

    const summary = summarizeSpatialWorldReferenceCleanup(
      spatialSurfaceIn(session.history.present, SURFACE_ID),
      ['world-a'],
    )
    expect(summary).toContain('将从路径「探索」中去掉已删图层')
    expect(summary).toContain('将删除 1 条关系连线')

    session = selectSpatialLayers(session, { layerItemIds: ['world-a'] }).nextSession!
    const deleted = deleteSpatialWorldLayersReportingReferences(session, { now: NOW })
    expect(deleted.ok).toBe(true)
    expect(deleted.historyEntry).toBe(true)
    expect(deleted.cleanupSummary).toBe(summary)
    const afterDelete = spatialSurfaceIn(deleted.nextSession!.history.present, SURFACE_ID)
    expect(afterDelete.world.layerItems.map((item) => item.layerItemId)).toEqual(['world-b'])
    expect(afterDelete.world.paths).toEqual([
      expect.objectContaining({ id: 'path-1', layerItemIds: ['world-b'] }),
    ])
    expect(afterDelete.world.relations).toEqual([])
    expect(courseProjectDocumentSchema.safeParse(deleted.nextSession!.history.present).success).toBe(true)

    const cascade = deleteSpatialWorldLayersInSession(
      selectSpatialLayers(openSession(), { layerItemIds: ['world-b'] }).nextSession!,
      { now: NOW },
    )
    expect(cascade.ok).toBe(true)

    let copySession = openSession()
    copySession = addSpatialRelationInSession(copySession, {
      sourceLayerItemId: 'world-a',
      targetLayerItemId: 'world-b',
      kind: 'arrow',
      id: 'relation-src',
      now: NOW,
    }).nextSession!
    copySession = addSpatialWorldTextLayer(copySession, { id: 'world-a-copy', text: '甲副本' }, { now: NOW }).nextSession!
    copySession = addSpatialWorldTextLayer(copySession, { id: 'world-b-copy', text: '乙副本' }, { now: NOW }).nextSession!
    const copiedIdMap = new Map([
      ['world-a', 'world-a-copy'],
      ['world-b', 'world-b-copy'],
    ])
    const plan = planSpatialGraphAfterWorldCopy(
      spatialSurfaceIn(copySession.history.present, SURFACE_ID),
      copiedIdMap,
    )
    expect(plan.relationsToAdd).toHaveLength(1)
    expect(plan.relationsToAdd[0]).toMatchObject({
      sourceLayerItemId: 'world-a-copy',
      targetLayerItemId: 'world-b-copy',
      kind: 'arrow',
    })
    const copied = addCopiedSpatialRelationsInSession(copySession, copiedIdMap, { now: NOW })
    expect(copied.ok).toBe(true)
    expect(copied.historyEntry).toBe(true)
    const relations = spatialSurfaceIn(copied.nextSession!.history.present, SURFACE_ID).world.relations ?? []
    expect(relations).toHaveLength(2)
    expect(relations.some((relation) => relation.id === 'relation-src')).toBe(true)
    expect(copied.nextSession?.selection.selectionIds).toEqual(['world-b-copy'])
  })

  it('applies semantic zoom as visibility only and does not rewrite data or selection', () => {
    let session = openSession()
    session = selectSpatialLayers(session, { layerItemIds: ['world-a'] }).nextSession!
    const selected = session.selection.selectionIds
    session = addSpatialSemanticZoomRuleInSession(session, {
      layerItemIds: ['world-a'],
      minZoom: 0,
      maxZoom: 1,
      visible: false,
      id: 'rule-1',
      now: NOW,
    }).nextSession!

    expect(session.selection.selectionIds).toEqual(selected)
    expect(spatialSemanticZoomKeepsSelection(selected)).toEqual(selected)
    const surface = spatialSurfaceIn(session.history.present, SURFACE_ID)
    expect(surface.world.layerItems.map((item) => item.layerItemId)).toEqual(['world-a', 'world-b'])
    expect(isSpatialItemSemanticallyVisible('world-a', 0.5, surface.semanticZoom)).toBe(false)
    expect(isSpatialItemSemanticallyVisible('world-a', 1, surface.semanticZoom)).toBe(true)
    expect(isSpatialItemSemanticallyVisible('world-b', 0.5, surface.semanticZoom)).toBe(true)
    const visibility = spatialSemanticZoomWorldVisibility(surface.world.layerItems, 0.5, surface.semanticZoom)
    expect(visibility.get('world-a')).toBe(false)
    expect(visibility.get('world-b')).toBe(true)
    expect(courseProjectDocumentSchema.parse(session.history.present).id).toBe('r5c-spatial-pipeline')
  })
})

describe('Spatial dedicated controls stay unmounted by default', () => {
  it('hides path fields until a path or relation is selected, and camera-frame toggle is session-only', () => {
    const session = openSession()
    const surface = spatialSurfaceIn(session.history.present, SURFACE_ID)
    const noop = {
      onAddPath: () => undefined,
      onRenamePath: () => undefined,
      onUpdatePathStyle: () => undefined,
      onDeletePath: () => undefined,
      onAddRelation: () => undefined,
      onUpdateRelationLabel: () => undefined,
      onUpdateRelationKind: () => undefined,
      onDeleteRelation: () => undefined,
    }

    const hidden = render(createElement(SpatialPathEditor, {
      surfaceTitle: surface.title,
      worldLayerItems: surface.world.layerItems,
      paths: [],
      relations: [],
      ...noop,
    }))
    expect(hidden.container).toBeEmptyDOMElement()
    expect(hidden.queryByText('文本')).toBeNull()
    expect(hidden.queryByText('通用')).toBeNull()
    hidden.unmount()

    const pathSession = addSpatialPathInSession(session, {
      name: '探索路线',
      layerItemIds: ['world-a', 'world-b'],
      id: 'path-1',
      now: NOW,
    }).nextSession!
    const pathSurface = spatialSurfaceIn(pathSession.history.present, SURFACE_ID)
    render(createElement(SpatialPathEditor, {
      surfaceTitle: pathSurface.title,
      worldLayerItems: pathSurface.world.layerItems,
      paths: pathSurface.world.paths ?? [],
      relations: pathSurface.world.relations ?? [],
      selectedPathId: 'path-1',
      ...noop,
    }))
    expect(screen.getByLabelText('重命名路径 探索路线')).toBeTruthy()
    expect(screen.queryByText('文本')).toBeNull()

    const toggled: boolean[] = []
    render(createElement(SpatialCameraPanel, {
      surfaceTitle: surface.title,
      frames: surface.camera.frames,
      home: surface.camera.home,
      sessionCamera: session.sessionCamera,
      activeCameraFrameId: HOME_FRAME_ID,
      showCameraFrames: session.showCameraFrames,
      worldLayerItems: surface.world.layerItems,
      semanticZoomRules: surface.semanticZoom,
      onShowCameraFramesChange: (show) => toggled.push(show),
      onAddFrame: () => undefined,
      onRenameFrame: () => undefined,
      onReorderFrame: () => undefined,
      onDeleteFrame: () => undefined,
      onSetHome: () => undefined,
      onActivateFrame: () => undefined,
      onAddSemanticZoomRule: () => undefined,
      onUpdateSemanticZoomRule: () => undefined,
      onDeleteSemanticZoomRule: () => undefined,
    }))
    fireEvent.click(screen.getByLabelText('显示镜头框'))
    expect(toggled).toEqual([false])
    const next = setSpatialShowCameraFrames(session, false)
    expect(next.historyEntry).toBe(false)
    expect(next.nextSession?.history.present.revision).toBe(session.history.present.revision)
  })
})
