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
  activateSpatialCameraFrame,
  deleteSpatialCameraFrameInSession,
  fitSpatialSessionToHomeCamera,
  fitSpatialSessionToWorldContent,
  renameSpatialCameraFrameInSession,
  reorderSpatialCameraFramesInSession,
  setSpatialCameraHomeFromSession,
  spatialSessionCameraFittingWorldContent,
  updateActiveSpatialCameraFrameFromSession,
} from '@/renderer/course/spatialCameraCommands'
import {
  addSpatialWorldTextLayer,
  buildSpatialAuthoringSnapshot,
  openSpatialAuthoringSession,
  panSpatialSessionCamera,
  spatialSurfaceIn,
  worldLayerItem,
  zoomSpatialSessionCamera,
  type SpatialAuthoringSession,
} from '@/renderer/course/spatialEditorCommands'

const NOW = '2026-08-17T17:10:00.000Z'
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

function teacherController(layerItemId: string, order: number, targetId: string): NativeLayerItem {
  return {
    layerItemId,
    label: '教师控制',
    frame: { mode: 'absolute', x: 40, y: 140, width: 260, height: 100 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'teacher-controller',
      data: {
        title: '教师控制',
        showSceneProgress: true,
        compact: false,
        collapsible: true,
        defaultCollapsed: false,
        buttons: [{
          id: 'go-target',
          label: '前往镜头',
          visible: true,
          action: { type: 'scene.go', sceneId: targetId },
        }],
        style: {
          backgroundColor: '#ffffff',
          backgroundOpacity: 1,
          accentColor: '#2563eb',
          textColor: '#172033',
          cornerRadius: 8,
        },
        includeInStaticExports: false,
      },
    },
  }
}

function scoped(item: NativeLayerItem): ScopedLayerItem {
  return { item, visibility: { mode: 'all', locationIds: [] } }
}

function v9SpatialFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r5a-spatial-camera',
    revision: 1,
    title: 'R5-A Spatial camera',
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
          nativeText('world-title', 1, {
            frame: { mode: 'absolute', x: -2000, y: 3000, width: 400, height: 80 },
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
  return openSpatialAuthoringSession(project, { locationId: LOCATION_ID, sessionId: 'spatial-camera-r5a' })
}

function surfaceOf(project: CourseProjectDocument) {
  return spatialSurfaceIn(project, SURFACE_ID)
}

describe('Spatial camera project data vs session pan/zoom', () => {
  it('adds a camera frame from the session pose in exactly one history entry', () => {
    let session = openSession()
    session = panSpatialSessionCamera(session, { x: 120, y: 240 }).nextSession!
    session = zoomSpatialSessionCamera(session, 1.5).nextSession!
    const before = session.history.present
    const added = addSpatialCameraFrameFromSession(session, { name: ' 特写 ', now: NOW })

    expect(added.ok).toBe(true)
    expect(added.historyEntry).toBe(true)
    expect(added.nextSession?.history.present.revision).toBe(before.revision + 1)
    expect(added.nextSession?.history.past).toEqual([before])
    expect(added.nextSession?.sessionCamera).toEqual({ x: 120, y: 240, zoom: 1.5 })

    const surface = surfaceOf(added.nextSession!.history.present)
    expect(surface.camera.frames).toHaveLength(2)
    const frame = surface.camera.frames.find((candidate) => candidate.name === '特写')
    expect(frame).toMatchObject({ x: 120, y: 240, zoom: 1.5 })
    const location = added.nextSession!.history.present.locations.find((candidate) =>
      candidate.kind === 'spatial-camera' && candidate.cameraFrameId === frame?.id,
    )
    expect(location?.label).toBe('空间探索 · 特写')
    expect(courseProjectDocumentSchema.parse(added.nextSession!.history.present).revision)
      .toBe(before.revision + 1)
  })

  it('renames, reorders, updates pose, sets home, and deletes with one revision each; no-ops skip history', () => {
    let session = openSession()
    session = addSpatialCameraFrameFromSession(session, {
      name: '近景',
      now: NOW,
    }).nextSession!
    session = panSpatialSessionCamera(session, { x: 80, y: 90 }).nextSession!
    session = zoomSpatialSessionCamera(session, 1.2).nextSession!
    session = addSpatialCameraFrameFromSession(session, { name: '远景', now: NOW }).nextSession!

    const closeUpId = surfaceOf(session.history.present).camera.frames.find((frame) => frame.name === '近景')!.id
    const farId = surfaceOf(session.history.present).camera.frames.find((frame) => frame.name === '远景')!.id

    const renamed = renameSpatialCameraFrameInSession(session, HOME_FRAME_ID, ' 全景总览 ', { now: NOW })
    expect(renamed.historyEntry).toBe(true)
    expect(surfaceOf(renamed.nextSession!.history.present).camera.frames[0]?.name).toBe('全景总览')
    const sameName = renameSpatialCameraFrameInSession(
      renamed.nextSession!,
      HOME_FRAME_ID,
      ' 全景总览 ',
      { now: NOW },
    )
    expect(sameName.historyEntry).toBe(false)
    expect(sameName.nextSession?.history.present).toBe(renamed.nextSession?.history.present)

    const moved = reorderSpatialCameraFramesInSession(renamed.nextSession!, farId, 0, { now: NOW })
    expect(moved.historyEntry).toBe(true)
    expect(surfaceOf(moved.nextSession!.history.present).camera.frames.map((frame) => frame.name)).toEqual([
      '远景',
      '全景总览',
      '近景',
    ])
    const sameOrder = reorderSpatialCameraFramesInSession(moved.nextSession!, farId, 0, { now: NOW })
    expect(sameOrder.historyEntry).toBe(false)

    const activated = activateSpatialCameraFrame(moved.nextSession!, closeUpId)
    expect(activated.historyEntry).toBe(false)
    expect(activated.nextSession?.history.present.revision).toBe(moved.nextSession?.history.present.revision)
    expect(activated.nextSession?.selection.locationId).toBe(closeUpId)
    expect(activated.nextSession?.sessionCamera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(activated.nextSession?.generation).toBeGreaterThan(moved.nextSession!.generation)

    const panned = panSpatialSessionCamera(activated.nextSession!, { x: 33, y: 44 }).nextSession!
    const zoomed = zoomSpatialSessionCamera(panned, 0.75).nextSession!
    const updated = updateActiveSpatialCameraFrameFromSession(zoomed, { now: NOW })
    expect(updated.historyEntry).toBe(true)
    const updatedFrame = surfaceOf(updated.nextSession!.history.present).camera.frames.find((frame) => frame.id === closeUpId)
    expect(updatedFrame).toMatchObject({ x: 33, y: 44, zoom: 0.75 })
    expect(surfaceOf(updated.nextSession!.history.present).camera.home).toEqual({ x: 0, y: 0, zoom: 1 })

    const home = setSpatialCameraHomeFromSession(updated.nextSession!, { now: NOW })
    expect(home.historyEntry).toBe(true)
    expect(surfaceOf(home.nextSession!.history.present).camera.home).toEqual({ x: 33, y: 44, zoom: 0.75 })
    const sameHome = setSpatialCameraHomeFromSession(home.nextSession!, { now: NOW })
    expect(sameHome.historyEntry).toBe(false)

    const deleted = deleteSpatialCameraFrameInSession(home.nextSession!, farId, { now: NOW })
    expect(deleted.historyEntry).toBe(true)
    expect(surfaceOf(deleted.nextSession!.history.present).camera.frames.map((frame) => frame.name))
      .toEqual(['全景总览', '近景'])
    expect(deleted.nextSession!.history.present.locations.some((location) =>
      location.kind === 'spatial-camera' && location.cameraFrameId === farId,
    )).toBe(false)
    expect(courseProjectDocumentSchema.parse(deleted.nextSession!.history.present).revision)
      .toBe(deleted.nextSession!.history.present.revision)

    const lastHome = deleteSpatialCameraFrameInSession(deleted.nextSession!, HOME_FRAME_ID, { now: NOW })
    const lastClose = deleteSpatialCameraFrameInSession(lastHome.nextSession!, closeUpId, { now: NOW })
    expect(lastClose.ok).toBe(false)
    expect(lastClose.reason).toMatch(/至少需要一个镜头画面/)
  })

  it('repairs location guards, scoped visibility, and controller aliases when deleting a frame', () => {
    let session = openSession()
    session = addSpatialCameraFrameFromSession(session, {
      id: 'camera-remove',
      name: '待删镜头',
      now: NOW,
    }).nextSession!
    const project = structuredClone(session.history.present)
    project.courseState = [{ key: 'ready', valueType: 'boolean', defaultValue: false }]
    project.navigationGuards = [{
      id: 'guard-from-camera-remove',
      effect: 'block',
      fromLocationIds: ['camera-remove'],
      toLocationIds: [HOME_FRAME_ID],
      match: 'all',
      conditions: [{ type: 'compare', key: 'ready', operator: 'eq', value: false }],
      message: '请先完成',
    }]
    project.globalLayerItems.push(
      scoped(teacherController('camera-controller', 60, 'camera-remove')),
      {
        item: nativeText('camera-only-note', 70),
        visibility: { mode: 'include', locationIds: ['camera-remove'] },
      },
    )
    session = openSpatialAuthoringSession(courseProjectDocumentSchema.parse(project), {
      locationId: HOME_FRAME_ID,
      sessionId: 'spatial-camera-reference-cleanup',
    })

    const deleted = deleteSpatialCameraFrameInSession(session, 'camera-remove', { now: NOW })
    const next = deleted.nextSession!.history.present

    expect(deleted.ok).toBe(true)
    expect(next.navigationGuards).toEqual([])
    expect(next.globalLayerItems.map((entry) => entry.item.layerItemId))
      .not.toContain('camera-only-note')
    const controller = next.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'camera-controller',
    )?.item
    expect(controller?.kind === 'native' && controller.content.nativeType === 'teacher-controller'
      ? controller.content.data.buttons.map((button) => button.action.type)
      : []).toEqual(['scene.next'])
    expect(courseProjectDocumentSchema.parse(next)).toEqual(next)
  })

  it('G2: fit-to-window restores home camera; AABB fit is a separate session command', () => {
    let session = openSession()
    const revision = session.history.present.revision
    session = panSpatialSessionCamera(session, { x: 900, y: -400 }).nextSession!
    session = zoomSpatialSessionCamera(session, 2).nextSession!

    const fittedHome = fitSpatialSessionToHomeCamera(session)
    expect(fittedHome.ok).toBe(true)
    expect(fittedHome.historyEntry).toBe(false)
    expect(fittedHome.nextSession?.sessionCamera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(fittedHome.nextSession?.history.present.revision).toBe(revision)
    expect(surfaceOf(fittedHome.nextSession!.history.present).camera.home).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(surfaceOf(fittedHome.nextSession!.history.present).camera.frames[0]).toMatchObject({
      x: 0,
      y: 0,
      zoom: 1,
    })

    const aabbPose = spatialSessionCameraFittingWorldContent(session, {
      viewportWidth: 1280,
      viewportHeight: 720,
    })
    expect(aabbPose.x).toBeCloseTo(-2000 + 200)
    expect(aabbPose.y).toBeCloseTo(3000 + 40)
    expect(aabbPose).not.toEqual(fittedHome.nextSession?.sessionCamera)

    const fittedContent = fitSpatialSessionToWorldContent(session, {
      viewportWidth: 1280,
      viewportHeight: 720,
    })
    expect(fittedContent.historyEntry).toBe(false)
    expect(fittedContent.nextSession?.sessionCamera).toEqual(aabbPose)
    expect(fittedContent.nextSession?.history.present.revision).toBe(revision)
    expect(worldLayerItem(fittedContent.nextSession!.history.present, SURFACE_ID, 'world-title').frame.x)
      .toBe(-2000)

    const snapshot = buildSpatialAuthoringSnapshot(fittedContent.nextSession!)
    expect(snapshot.sessionCamera).toEqual(aabbPose)
    expect(snapshot).not.toHaveProperty('paths')
    expect(snapshot).not.toHaveProperty('relations')
  })

  it('survives JSON save/reopen after camera edits; session pan is not in the document', () => {
    let session = openSession()
    session = addSpatialWorldTextLayer(session, {
      id: 'extra',
      x: 10,
      y: 20,
    }, { now: NOW }).nextSession!
    session = panSpatialSessionCamera(session, { x: 10, y: 20 }).nextSession!
    session = addSpatialCameraFrameFromSession(session, { name: '近景', now: NOW }).nextSession!
    session = setSpatialCameraHomeFromSession(session, { now: NOW }).nextSession!
    session = renameSpatialCameraFrameInSession(session, HOME_FRAME_ID, '重开总览', { now: NOW }).nextSession!

    const reopened = JSON.parse(JSON.stringify(session.history.present)) as CourseProjectDocument
    const parsed = courseProjectDocumentSchema.parse(reopened)
    expect(parsed).toEqual(reopened)
    const surface = surfaceOf(parsed)
    expect(surface.camera.home).toEqual({ x: 10, y: 20, zoom: 1 })
    expect(surface.camera.frames.some((frame) => frame.name === '重开总览')).toBe(true)
    expect(surface.camera.frames.some((frame) => frame.name === '近景')).toBe(true)
    expect(JSON.stringify(parsed)).not.toContain('sessionCamera')
  })
})
