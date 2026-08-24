import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { getEffectiveCourseLayerOrder } from '@/shared/courseProjectModel'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import {
  clientDeltaToWorld,
  createStageViewportTransform,
  stageSelectionOverlayGeometry,
  worldToClient,
} from '@/renderer/authoring/stageViewportTransform'
import {
  SPATIAL_REJECT_LOCKED,
  SPATIAL_REJECT_STALE_REVISION,
  SPATIAL_REJECT_WRONG_OWNER,
  addSpatialWorldComponentLayer,
  addSpatialWorldFormulaLayer,
  addSpatialWorldImageLayer,
  addSpatialWorldRuntimeLayer,
  addSpatialWorldShapeLayer,
  addSpatialWorldTextLayer,
  addSpatialWorldVideoLayer,
  buildSpatialAuthoringSnapshot,
  buildSpatialEditorView,
  createSpatialViewportOverlayTransform,
  createSpatialWorldViewTransform,
  deleteSpatialWorldLayersInSession,
  isSpatialViewportLayer,
  makeSpatialAuthoringTarget,
  openSpatialAuthoringSession,
  panSpatialSessionCamera,
  selectSpatialLayers,
  setSpatialEditingScope,
  zoomSpatialSessionCamera,
  spatialLayerCoordinateSpace,
  spatialWorldPointerDeltaToWorld,
  transformSpatialWorldLayersInSession,
  undoSpatialAuthoring,
  updateSpatialWorldText,
  worldLayerItem,
  type SpatialAuthoringSession,
} from '@/renderer/course/spatialEditorCommands'
import { addCourseSpatialPage } from '@/renderer/course/courseLocationCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

const NOW = '2026-08-17T17:00:00.000Z'
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
  text: string,
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'frame'>> = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
    frame: extra.frame ?? { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
    order,
    visible: true,
    locked: extra.locked ?? false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function globalController(): NativeLayerItem {
  return {
    layerItemId: 'global-teacher-controller',
    label: '教师控制器',
    frame: { mode: 'absolute', x: 190, y: 638, width: 900, height: 64 },
    order: 80,
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
        title: '教师控制台',
        showSceneProgress: true,
        compact: false,
        collapsible: true,
        defaultCollapsed: false,
        buttons: [
          { id: 'previous', action: { type: 'scene.previous' }, label: '上一场景', visible: true },
          { id: 'next', action: { type: 'scene.next' }, label: '下一场景', visible: true },
          { id: 'picker', action: { type: 'scene.open-picker' }, label: '场景目录', visible: true },
          { id: 'replay', action: { type: 'scene.replay' }, label: '重播', visible: true },
          { id: 'sound', action: { type: 'audio.toggle-mute' }, label: '声音', visible: true },
          { id: 'fullscreen', action: { type: 'player.fullscreen.toggle' }, label: '全屏', visible: true },
        ],
        style: {
          backgroundColor: '#172033',
          backgroundOpacity: 0.94,
          accentColor: '#e7b85c',
          textColor: '#f8fafc',
          cornerRadius: 16,
        },
        includeInStaticExports: false,
      },
    },
  }
}

function scoped(item: NativeLayerItem, locationIds: string[] = []): ScopedLayerItem {
  return {
    item,
    visibility: locationIds.length === 0
      ? { mode: 'all', locationIds: [] }
      : { mode: 'include', locationIds },
  }
}

function v9SpatialFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r5a-spatial-domain',
    revision: 1,
    title: 'R5-A Spatial domain',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-image': {
        id: 'asset-image',
        filename: 'pixel.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/pixel.png',
        byteLength: 128,
        width: 640,
        height: 360,
      },
      'asset-video': {
        id: 'asset-video',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'assets/clip.mp4',
        byteLength: 256,
        width: 640,
        height: 360,
      },
    },
    componentPackages: {
      'pkg-1': {
        packageId: 'pkg-1',
        version: '1.0.0',
        name: '测试组件',
        manifestPath: 'components/pkg-1/manifest.json',
        runtimePath: 'components/pkg-1/runtime.js',
        contentSha256: 'a'.repeat(64),
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
    globalLayerItems: [
      scoped(nativeText('global-hud', 3, '全局条', {
        frame: { mode: 'absolute', x: 24, y: 16, width: 180, height: 40 },
      })),
      scoped(globalController()),
    ],
    globalInteractions: [],
    locations: [{
      id: LOCATION_ID,
      label: '池塘 · 总览',
      kind: 'spatial-camera',
      surfaceId: SURFACE_ID,
      cameraFrameId: HOME_FRAME_ID,
    }],
    startLocationId: LOCATION_ID,
    surfaces: [{
      id: SURFACE_ID,
      title: '池塘',
      type: 'spatial-2d',
      surfaceLayerItems: [
        scoped(nativeText('surface-shared', 25, '页面共享', {
          frame: { mode: 'absolute', x: -80, y: 900, width: 180, height: 60 },
        }), [LOCATION_ID]),
      ],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [
          nativeText('world-text', 1, '远景文字', {
            frame: { mode: 'absolute', x: -400, y: 2000, width: 220, height: 80 },
          }),
          nativeText('world-locked', 2, '锁定文字', {
            locked: true,
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
  return openSpatialAuthoringSession(project, { locationId: LOCATION_ID, sessionId: 'spatial-session-r5a' })
}

describe('Spatial world vs viewport coordinate contract', () => {
  it('tags world/surface as world space and global HUD plus controller as viewport', () => {
    const view = buildSpatialEditorView({
      project: v9SpatialFixture(),
      locationId: LOCATION_ID,
    })
    const world = view.layers.find((layer) => layer.selectionId === 'world-text')
    const surface = view.layers.find((layer) => layer.selectionId === 'surface-shared')
    const hud = view.layers.find((layer) => layer.selectionId === 'global-hud')
    const controller = view.layers.find((layer) => layer.selectionId === 'global-teacher-controller')
    expect(world?.source).toBe('world')
    expect(world?.coordinateSpace).toBe('world')
    expect(surface?.source).toBe('surface')
    expect(surface?.coordinateSpace).toBe('world')
    expect(hud?.source).toBe('global')
    expect(hud?.coordinateSpace).toBe('viewport')
    expect(controller?.coordinateSpace).toBe('viewport')
    expect(isSpatialViewportLayer(hud!)).toBe(true)
    expect(isSpatialViewportLayer(controller!)).toBe(true)
    expect(spatialLayerCoordinateSpace('world', world!.item)).toBe('world')
    expect(view.worldBounds).toEqual({ mode: 'infinite' })
    expect(view).not.toHaveProperty('paths')
    expect(view).not.toHaveProperty('relations')
    expect(view).not.toHaveProperty('semanticZoom')
  })

  it('reuses R2 worldToClient: session camera is the world view; overlay ignores world pan/zoom', () => {
    const session = openSession()
    const viewport = { x: 0, y: 0, width: 1280, height: 720 }
    const panned = panSpatialSessionCamera(session, { x: -400, y: 2000 })
    expect(panned.ok).toBe(true)
    expect(panned.historyEntry).toBe(false)
    expect(panned.nextSession?.history.present.revision).toBe(session.history.present.revision)
    expect(panned.nextSession?.sessionCamera).toEqual({ x: -400, y: 2000, zoom: 1 })

    const zoomed = zoomSpatialSessionCamera(panned.nextSession!, 2)
    expect(zoomed.historyEntry).toBe(false)
    const worldTransform = createSpatialWorldViewTransform(viewport, zoomed.nextSession!.sessionCamera)
    const overlay = createSpatialViewportOverlayTransform(viewport)
    const stage = createStageViewportTransform({ viewport, zoom: 1, pan: { x: 0, y: 0 } })

    expect(worldToClient(worldTransform, { x: -400, y: 2000 })).toEqual({ x: 640, y: 360 })
    expect(clientDeltaToWorld(worldTransform, { x: 40, y: 0 })).toEqual({ x: 20, y: 0 })
    expect(spatialWorldPointerDeltaToWorld(zoomed.nextSession!.sessionCamera, { x: 40, y: 0 })).toEqual({
      x: 20,
      y: 0,
    })

    const controllerScreen = worldToClient(overlay, { x: 190, y: 638 })
    const controllerOnStage = worldToClient(stage, { x: 190, y: 638 })
    expect(controllerScreen).toEqual(controllerOnStage)
    const homeWorld = createSpatialWorldViewTransform(viewport, session.sessionCamera)
    expect(worldToClient(overlay, { x: 190, y: 638 }))
      .toEqual(worldToClient(createSpatialViewportOverlayTransform(viewport), { x: 190, y: 638 }))
    expect(worldToClient(homeWorld, { x: 190, y: 638 }))
      .not.toEqual(worldToClient(worldTransform, { x: 190, y: 638 }))

    const overlayGeometry = stageSelectionOverlayGeometry(overlay, [{
      x: 190,
      y: 638,
      width: 900,
      height: 64,
    }])
    const overlayAtOtherZoom = stageSelectionOverlayGeometry(
      createSpatialViewportOverlayTransform(viewport),
      [{ x: 190, y: 638, width: 900, height: 64 }],
    )
    expect(overlayGeometry?.selectionBox).toEqual(overlayAtOtherZoom?.selectionBox)
  })
})

describe('Spatial authoring session, address, snapshot, insert/update/transform/delete', () => {
  it('opens from V9 document, snapshot has no path/relation, targets use makeAuthoringAddress', () => {
    const project = v9SpatialFixture()
    const session = openSession(project)
    const snapshot = buildSpatialAuthoringSnapshot(session)
    expect(snapshot.revision).toBe(1)
    expect(snapshot.activeCameraFrameId).toBe(HOME_FRAME_ID)
    expect(snapshot.sessionCamera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(snapshot.showCameraFrames).toBe(true)
    expect(snapshot.worldBoundsMode).toBe('infinite')
    expect(snapshot).not.toHaveProperty('paths')
    expect(snapshot).not.toHaveProperty('relations')
    expect(snapshot).not.toHaveProperty('hitId')

    const worldTarget = makeSpatialAuthoringTarget(session, 'world-text')
    expect(worldTarget.authoringAddress).toBe(makeAuthoringAddress({
      projectId: project.id,
      scope: 'surface',
      surfaceId: SURFACE_ID,
      carrier: 'native',
      layerItemId: 'world-text',
      field: 'content.data.text',
    }))
    expect(worldTarget.coordinateSpace).toBe('world')
    expect(worldTarget).not.toHaveProperty('hitId')

    const hudTarget = makeSpatialAuthoringTarget(session, 'global-hud')
    expect(hudTarget.authoringAddress).toContain('/global/')
    expect(hudTarget.coordinateSpace).toBe('viewport')
  })

  it('allocates unique effective orders for consecutive world kinds in a default Mixed project', () => {
    const blank = createBlankCourseProject({
      id: 'default-mixed-order',
      title: '默认 Mixed 顺序',
      now: NOW,
    })
    const appended = addCourseSpatialPage(blank, { title: '无限画布', now: NOW })
    expect(appended.ok).toBe(true)
    if (!appended.ok) throw new Error(appended.reason)

    const locationId = appended.activatedLocationId
    const location = appended.project.locations.find((candidate) => candidate.id === locationId)
    if (!location || location.kind !== 'spatial-camera') throw new Error('expected spatial location')
    const surfaceId = location.surfaceId
    const controllerOrder = appended.project.globalLayerItems[0]!.item.order
    const session = openSpatialAuthoringSession(appended.project, {
      locationId,
      sessionId: 'spatial-session-default-mixed-order',
    })

    const text = addSpatialWorldTextLayer(session, { id: 'mixed-world-text' }, { now: NOW })
    expect(text).toMatchObject({ ok: true, historyEntry: true })
    expect(text.nextSession?.history.present.revision).toBe(session.history.present.revision + 1)
    expect(text.nextSession?.history.past).toHaveLength(1)

    const shape = addSpatialWorldShapeLayer(
      text.nextSession!,
      { id: 'mixed-world-shape', shapeType: 'ellipse' },
      { now: NOW },
    )
    expect(shape).toMatchObject({ ok: true, historyEntry: true })
    expect(shape.nextSession?.history.present.revision).toBe(session.history.present.revision + 2)
    expect(shape.nextSession?.history.past).toHaveLength(2)

    const project = shape.nextSession!.history.present
    const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected spatial surface')
    expect(surface.world.layerItems.map((item) => [item.layerItemId, item.order])).toEqual([
      ['mixed-world-text', 0],
      ['mixed-world-shape', 2],
    ])
    expect(project.globalLayerItems[0]!.item.order).toBe(controllerOrder)

    const effectiveOrders = getEffectiveCourseLayerOrder({
      project,
      surfaceId,
      locationId,
    }).map((entry) => entry.item.order)
    expect(new Set(effectiveOrders).size).toBe(effectiveOrders.length)
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
  })

  it('inserts native/media/component/runtime near the session camera, not page-center, one revision each', () => {
    let session = openSession()
    session = panSpatialSessionCamera(session, { x: -1000, y: 2500 }).nextSession!
    const before = session.history.present.revision

    const text = addSpatialWorldTextLayer(session, { id: 'w-text' }, { now: NOW })
    expect(text.ok).toBe(true)
    expect(text.historyEntry).toBe(true)
    expect(text.nextSession?.history.present.revision).toBe(before + 1)
    const textItem = worldLayerItem(text.nextSession!.history.present, SURFACE_ID, 'w-text')
    expect(textItem.frame.x).toBe(-1000 - 200 + 40)
    expect(textItem.frame.y).toBe(2500 - 40)
    expect(textItem.frame.x).not.toBe(440)
    expect(textItem.frame.y).not.toBe(320)
    expect(textItem.frame.x).toBeLessThan(0)
    expect(textItem.frame.y).toBeGreaterThan(720)

    const shape = addSpatialWorldShapeLayer(text.nextSession!, {
      id: 'w-shape',
      shapeType: 'ellipse',
      x: -5000,
      y: 8000,
    }, { now: NOW })
    expect(worldLayerItem(shape.nextSession!.history.present, SURFACE_ID, 'w-shape').frame).toMatchObject({
      x: -5000,
      y: 8000,
    })

    const formula = addSpatialWorldFormulaLayer(shape.nextSession!, { id: 'w-formula', x: 10, y: 20 }, { now: NOW })
    const image = addSpatialWorldImageLayer(formula.nextSession!, {
      id: 'w-image',
      assetId: 'asset-image',
      x: 30,
      y: 40,
    }, { now: NOW })
    const video = addSpatialWorldVideoLayer(image.nextSession!, {
      id: 'w-video',
      assetId: 'asset-video',
      x: 50,
      y: 60,
    }, { now: NOW })
    const component = addSpatialWorldComponentLayer(video.nextSession!, {
      id: 'w-component',
      packageId: 'pkg-1',
      props: { a: 1 },
      x: 70,
      y: 80,
    }, { now: NOW })
    const runtime = addSpatialWorldRuntimeLayer(component.nextSession!, {
      id: 'w-runtime',
      x: 90,
      y: 100,
      width: 200,
      height: 120,
    }, { now: NOW })

    expect(runtime.nextSession?.history.present.revision).toBe(before + 7)
    expect(runtime.nextSession?.history.past).toHaveLength(7)
    expect(courseProjectDocumentSchema.parse(runtime.nextSession!.history.present).revision)
      .toBe(before + 7)
    const effectiveOrders = getEffectiveCourseLayerOrder({
      project: runtime.nextSession!.history.present,
      surfaceId: SURFACE_ID,
      locationId: LOCATION_ID,
    }).map((entry) => entry.item.order)
    expect(new Set(effectiveOrders).size).toBe(effectiveOrders.length)

    const globalScope = setSpatialEditingScope(session, 'global')
    const refused = addSpatialWorldTextLayer(globalScope.nextSession!, { id: 'nope' }, { now: NOW })
    expect(refused.ok).toBe(false)
    expect(refused.reason).toBe(SPATIAL_REJECT_WRONG_OWNER)
    expect(refused.historyEntry).toBe(false)
  })

  it('commits one world gesture as one revision, keeps negative coords, and does not write the session camera', () => {
    const session = openSession()
    const selected = selectSpatialLayers(session, { layerItemIds: ['world-text'] })
    expect(selected.ok).toBe(true)
    const moved = transformSpatialWorldLayersInSession(selected.nextSession!, {
      nodes: [{
        layerItemId: 'world-text',
        x: -5000,
        y: 8000,
        width: 300,
        height: 90,
        rotation: 12,
      }],
    }, { now: NOW, expectedRevision: 1 })

    expect(moved.ok).toBe(true)
    expect(moved.historyEntry).toBe(true)
    expect(moved.nextSession?.history.present.revision).toBe(2)
    expect(moved.nextSession?.history.past).toEqual([session.history.present])
    expect(moved.nextSession?.sessionCamera).toEqual(session.sessionCamera)
    const item = worldLayerItem(moved.nextSession!.history.present, SURFACE_ID, 'world-text')
    expect(item.frame).toMatchObject({ x: -5000, y: 8000, width: 300, height: 90 })
    expect(item.rotation).toBe(12)
    const surface = moved.nextSession!.history.present.surfaces.find((candidate) => candidate.id === SURFACE_ID)
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected spatial')
    const originalSurface = session.history.present.surfaces.find((candidate) => candidate.id === SURFACE_ID)
    if (!originalSurface || originalSurface.type !== 'spatial-2d') throw new Error('expected spatial')
    expect(surface.camera).toEqual(originalSurface.camera)
    expect(courseProjectDocumentSchema.parse(moved.nextSession!.history.present).revision).toBe(2)

    const undone = undoSpatialAuthoring(moved.nextSession!)
    expect(worldLayerItem(undone.nextSession!.history.present, SURFACE_ID, 'world-text').frame.x).toBe(-400)

    const noop = transformSpatialWorldLayersInSession(selected.nextSession!, {
      layers: [{
        layerItemId: 'world-text',
        x: -400,
        y: 2000,
        width: 220,
        height: 80,
        rotation: 0,
      }],
    }, { now: NOW })
    expect(noop.historyEntry).toBe(false)
    expect(noop.nextSession?.history.present).toBe(selected.nextSession?.history.present)

    const stale = transformSpatialWorldLayersInSession(selected.nextSession!, {
      nodes: [{
        layerItemId: 'world-text',
        x: 1,
        y: 2,
        width: 220,
        height: 80,
        rotation: 0,
      }],
    }, { expectedRevision: 99 })
    expect(stale.ok).toBe(false)
    expect(stale.reason).toBe(SPATIAL_REJECT_STALE_REVISION)

    const locked = selectSpatialLayers(session, { layerItemIds: ['world-locked'] })
    const lockedMove = transformSpatialWorldLayersInSession(locked.nextSession!, {
      nodes: [{
        layerItemId: 'world-locked',
        x: 1,
        y: 2,
        width: 200,
        height: 60,
        rotation: 0,
      }],
    }, { now: NOW })
    expect(lockedMove.ok).toBe(false)
    expect(lockedMove.reason).toBe(SPATIAL_REJECT_LOCKED)

    const surfaceSelected = setSpatialEditingScope(session, 'surface')
    const surfacePick = selectSpatialLayers(surfaceSelected.nextSession!, { layerItemIds: ['surface-shared'] })
    const surfaceMove = transformSpatialWorldLayersInSession(surfacePick.nextSession!, {
      nodes: [{
        layerItemId: 'surface-shared',
        x: 1,
        y: 2,
        width: 180,
        height: 60,
        rotation: 0,
      }],
    }, { now: NOW })
    expect(surfaceMove.ok).toBe(false)
    expect(surfaceMove.reason).toBe(SPATIAL_REJECT_WRONG_OWNER)

    const hudScope = setSpatialEditingScope(session, 'global')
    const hudPick = selectSpatialLayers(hudScope.nextSession!, { layerItemIds: ['global-hud'] })
    const hudMove = transformSpatialWorldLayersInSession(hudPick.nextSession!, {
      nodes: [{
        layerItemId: 'global-hud',
        x: 1,
        y: 2,
        width: 180,
        height: 40,
        rotation: 0,
      }],
    }, { now: NOW })
    expect(hudMove.ok).toBe(false)
    expect(hudMove.reason).toBe(SPATIAL_REJECT_WRONG_OWNER)
  })

  it('updates text and deletes a world item in one history entry each', () => {
    const session = openSession()
    const selected = selectSpatialLayers(session, { layerItemIds: ['world-text'] })
    const updated = updateSpatialWorldText(selected.nextSession!, '新的远景', { now: NOW })
    expect(updated.ok).toBe(true)
    expect(updated.historyEntry).toBe(true)
    expect(worldLayerItem(updated.nextSession!.history.present, SURFACE_ID, 'world-text').kind).toBe('native')
    const native = worldLayerItem(updated.nextSession!.history.present, SURFACE_ID, 'world-text')
    if (native.kind !== 'native' || native.content.nativeType !== 'text') throw new Error('expected text')
    expect(native.content.data.text).toBe('新的远景')

    const deleted = deleteSpatialWorldLayersInSession(updated.nextSession!, { now: NOW })
    expect(deleted.ok).toBe(true)
    expect(deleted.historyEntry).toBe(true)
    expect(deleted.nextSession?.selection.selectionIds).toEqual([])
    expect(() => worldLayerItem(deleted.nextSession!.history.present, SURFACE_ID, 'world-text'))
      .toThrow(/找不到世界元素/)
    expect(worldLayerItem(deleted.nextSession!.history.present, SURFACE_ID, 'world-locked').layerItemId)
      .toBe('world-locked')
  })
})
