import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import {
  addSpatialCameraFrameFromSession,
  reorderSpatialCameraFramesInSession,
} from '@/renderer/course/spatialCameraCommands'
import {
  openSpatialAuthoringSession,
  spatialSurfaceIn,
  undoSpatialAuthoring,
  type SpatialAuthoringSession,
} from '@/renderer/course/spatialEditorCommands'
import { addSpatialPath, addSpatialPathInSession, deleteSpatialPath, deleteSpatialPathInSession, makeSpatialPathAuthoringTarget, setSpatialShowCameraFrames, updateSpatialPath, updateSpatialPathInSession } from '@/renderer/course/spatialPathCommands'
import { resolveSpatialPlaybackSchedule, spatialPathAuthoringAddress } from '../../src/core/tools/spatialPath'
import {
  addSpatialRelation,
  addSpatialRelationInSession,
  deleteSpatialRelation,
  makeSpatialRelationAuthoringTarget,
  updateSpatialRelation,
} from '@/renderer/course/spatialRelationCommands'

const NOW = '2026-08-17T18:00:00.000Z'
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
    id: 'r5c-spatial-path',
    revision: 1,
    title: 'R5-C Spatial path',
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
    sessionId: 'spatial-path-r5c',
  })
}

function pathIn(project: CourseProjectDocument, pathId: string) {
  return spatialSurfaceIn(project, SURFACE_ID).world.paths?.find((path) => path.id === pathId)
}

function relationIn(project: CourseProjectDocument, relationId: string) {
  return spatialSurfaceIn(project, SURFACE_ID).world.relations?.find((relation) => relation.id === relationId)
}

describe('Spatial path commands', () => {
  it('adds one path as one history entry with a stable authoring address and no hitId', () => {
    const session = openSession()
    const before = session.history.present
    const added = addSpatialPathInSession(session, {
      name: '巡逻路线',
      layerItemIds: ['world-a', 'world-b'],
      style: { color: '#112233', width: 3, dash: 'dashed' },
      id: 'path-1',
      now: NOW,
    })

    expect(added.ok).toBe(true)
    expect(added.historyEntry).toBe(true)
    expect(added.nextSession?.history.present.revision).toBe(before.revision + 1)
    expect(added.nextSession?.history.past).toEqual([before])
    expect(added.nextSession?.selection.selectionIds).toEqual([])
    expect(pathIn(added.nextSession!.history.present, 'path-1')).toMatchObject({
      id: 'path-1',
      name: '巡逻路线',
      layerItemIds: ['world-a', 'world-b'],
    })

    const target = makeSpatialPathAuthoringTarget(added.nextSession!, 'path-1')
    expect(target.authoringAddress).toBe(
      spatialPathAuthoringAddress('r5c-spatial-path', SURFACE_ID, 'path-1'),
    )
    expect(target.authoringAddress).toContain('courseware://authoring/')
    expect(target.authoringAddress).not.toMatch(/hitId/i)
    expect(target.layerItemId).toBe('path-1')
    expect(JSON.stringify(added.nextSession!.history.present)).not.toMatch(/hitId/i)

    const parsed = courseProjectDocumentSchema.parse(added.nextSession!.history.present)
    expect(pathIn(parsed, 'path-1')?.id).toBe('path-1')

    const undone = undoSpatialAuthoring(added.nextSession!)
    expect(pathIn(undone.nextSession!.history.present, 'path-1')).toBeUndefined()
    expect(courseProjectDocumentSchema.safeParse(undone.nextSession!.history.present).success).toBe(true)
  })

  it('rejects dangling, duplicate, empty, or stale path ids without writing history', () => {
    const session = openSession()
    const history = session.history

    expect(() => addSpatialPath(history, {
      surfaceId: SURFACE_ID,
      name: '悬空路径',
      layerItemIds: ['missing-layer'],
      now: NOW,
    })).toThrow('路径引用了不存在的世界图层')
    expect(() => addSpatialPath(history, {
      surfaceId: SURFACE_ID,
      name: '重复路径',
      layerItemIds: ['world-a', 'world-a'],
      now: NOW,
    })).toThrow('路径不能重复经过同一图层')
    expect(() => addSpatialPath(history, {
      surfaceId: SURFACE_ID,
      name: '空路径',
      layerItemIds: [],
      now: NOW,
    })).toThrow('路径至少需要经过一个世界图层')
    expect(() => updateSpatialPath(history, SURFACE_ID, 'missing-path', { name: '新名' }))
      .toThrow('找不到路径，请刷新后重试')
    expect(() => deleteSpatialPath(history, SURFACE_ID, 'missing-path', NOW))
      .toThrow('找不到路径，请刷新后重试')

    const stale = addSpatialPathInSession(session, {
      name: '陈旧',
      layerItemIds: ['world-a'],
      now: NOW,
    }, { expectedRevision: 99 })
    expect(stale.ok).toBe(false)
    expect(stale.reason).toBe('stale-revision')
    expect(stale.historyEntry).toBe(false)
    expect(history.present).toBe(session.history.present)
  })

  it('updates and deletes a path in one revision each; identity updates skip history', () => {
    let session = openSession()
    session = addSpatialPathInSession(session, {
      name: '旧路线',
      layerItemIds: ['world-a'],
      id: 'path-1',
      now: NOW,
    }).nextSession!
    const beforeUpdate = session.history.present
    const updated = updateSpatialPathInSession(session, 'path-1', {
      name: '新路线',
      layerItemIds: ['world-a', 'world-b'],
    }, { now: NOW })

    expect(updated.ok).toBe(true)
    expect(updated.historyEntry).toBe(true)
    expect(updated.nextSession?.history.present.revision).toBe(beforeUpdate.revision + 1)
    expect(pathIn(updated.nextSession!.history.present, 'path-1')).toMatchObject({
      name: '新路线',
      layerItemIds: ['world-a', 'world-b'],
    })

    const noop = updateSpatialPathInSession(updated.nextSession!, 'path-1', { name: '新路线' }, { now: NOW })
    expect(noop.historyEntry).toBe(false)
    expect(noop.nextSession?.history.present.revision).toBe(updated.nextSession!.history.present.revision)

    const emptied = updateSpatialPathInSession(updated.nextSession!, 'path-1', { layerItemIds: [] }, { now: NOW })
    expect(emptied.ok).toBe(false)
    expect(emptied.reason).toBe('路径至少需要经过一个世界图层')

    const deleted = deleteSpatialPathInSession(updated.nextSession!, 'path-1', { now: NOW })
    expect(deleted.historyEntry).toBe(true)
    expect(pathIn(deleted.nextSession!.history.present, 'path-1')).toBeUndefined()
  })
})

describe('Spatial relation commands', () => {
  it('adds, updates and deletes relations with one history entry and a stable address', () => {
    const session = openSession()
    const added = addSpatialRelationInSession(session, {
      sourceLayerItemId: 'world-a',
      targetLayerItemId: 'world-b',
      kind: 'arrow',
      label: '从甲到乙',
      id: 'relation-1',
      now: NOW,
    })
    expect(added.ok).toBe(true)
    expect(added.historyEntry).toBe(true)
    expect(relationIn(added.nextSession!.history.present, 'relation-1')).toMatchObject({
      id: 'relation-1',
      kind: 'arrow',
      label: '从甲到乙',
    })
    const target = makeSpatialRelationAuthoringTarget(added.nextSession!, 'relation-1')
    expect(target.authoringAddress).not.toMatch(/hitId/i)
    expect(target.layerItemId).toBe('relation-1')

    const updated = updateSpatialRelation(
      added.nextSession!.history,
      SURFACE_ID,
      'relation-1',
      { kind: 'bidirectional' },
      NOW,
    )
    expect(relationIn(updated.present, 'relation-1')?.kind).toBe('bidirectional')
    expect(updated.present.revision).toBe(added.nextSession!.history.present.revision + 1)

    const deleted = deleteSpatialRelation(updated, SURFACE_ID, 'relation-1', NOW)
    expect(relationIn(deleted.present, 'relation-1')).toBeUndefined()
  })

  it('rejects dangling or same endpoints without writing history', () => {
    const history = openSession().history
    expect(() => addSpatialRelation(history, {
      surfaceId: SURFACE_ID,
      sourceLayerItemId: 'world-a',
      targetLayerItemId: 'missing-layer',
      kind: 'line',
      now: NOW,
    })).toThrow('关系连线引用了不存在的世界图层')
    expect(() => addSpatialRelation(history, {
      surfaceId: SURFACE_ID,
      sourceLayerItemId: 'world-a',
      targetLayerItemId: 'world-a',
      kind: 'line',
      now: NOW,
    })).toThrow('关系连线的起点和终点不能是同一个图层')
    expect(history.past).toEqual([])
  })
})

describe('Spatial camera frame overlay and playback order', () => {
  it('toggles showCameraFrames without a revision, and path waypoint order is the playback schedule', () => {
    let session = openSession()
    const hidden = setSpatialShowCameraFrames(session, false)
    expect(hidden.ok).toBe(true)
    expect(hidden.historyEntry).toBe(false)
    expect(hidden.nextSession?.showCameraFrames).toBe(false)
    expect(hidden.nextSession?.history.present.revision).toBe(session.history.present.revision)
    expect(hidden.nextSession?.history.present).toBe(session.history.present)

    session = addSpatialPathInSession(session, {
      name: '探索',
      layerItemIds: ['world-a', 'world-b'],
      id: 'path-1',
      now: NOW,
    }).nextSession!
    session = addSpatialCameraFrameFromSession(session, { name: '近景', now: NOW }).nextSession!
    const extraFrame = spatialSurfaceIn(session.history.present, SURFACE_ID).camera.frames[1]!
    session = reorderSpatialCameraFramesInSession(session, extraFrame.id, 0, { now: NOW }).nextSession!

    const cameraOrder = resolveSpatialPlaybackSchedule(session.history.present, SURFACE_ID, null)
    expect(cameraOrder.map((stop) => stop.kind)).toEqual(['camera-frame', 'camera-frame'])
    expect(cameraOrder[0]).toMatchObject({ frameId: extraFrame.id })

    session = updateSpatialPathInSession(session, 'path-1', {
      layerItemIds: ['world-b', 'world-a'],
    }, { now: NOW }).nextSession!
    const pathOrder = resolveSpatialPlaybackSchedule(session.history.present, SURFACE_ID, 'path-1')
    expect(pathOrder).toEqual([
      expect.objectContaining({ kind: 'path-waypoint', layerItemId: 'world-b', pathId: 'path-1' }),
      expect.objectContaining({ kind: 'path-waypoint', layerItemId: 'world-a', pathId: 'path-1' }),
    ])
    expect(pathOrder[0]?.authoringAddress).not.toMatch(/hitId/i)
  })
})
