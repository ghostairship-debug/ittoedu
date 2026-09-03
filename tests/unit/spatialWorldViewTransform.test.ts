import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type LayerItem,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import {
  createStageViewportTransform,
  rotateWorldPoint,
  STAGE_VIEWPORT_HEIGHT,
  STAGE_VIEWPORT_WIDTH,
  stageResizeHandleWorldPoint,
  worldRectCenter,
  worldToClient,
} from '@/renderer/authoring/stageViewportTransform'
import {
  buildSpatialEditorView,
  createSpatialViewportOverlayTransform,
  createSpatialWorldViewTransform,
  openSpatialAuthoringSession,
  setSpatialEditingScope,
  type SpatialAuthoringSession,
} from '@/renderer/course/spatialEditorCommands'
import {
  createSpatialWorldAuthoringController,
  spatialViewportHudOverlay,
  spatialViewportOverlayTransform,
  spatialWorldSelectionOverlay,
  spatialWorldViewTransform,
  type SpatialWorldAuthoringHost,
} from '@/renderer/authoring/spatialWorldAuthoring'

/**
 * Proves Spatial world vs viewport matrices used by the R5-B adapter.
 * Does not prove Workspace chrome, Phaser, or a usable Spatial editor.
 */
const NOW = '2026-08-17T17:30:00.000Z'
const VIEWPORT = { x: 0, y: 0, width: 1280, height: 720 }
const ODD_VIEWPORT = { x: 0, y: 0, width: 800, height: 500 }
const SURFACE_ID = 'surface-spatial'
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
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'frame' | 'rotation'>> = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
    frame: extra.frame ?? { mode: 'absolute', x: -200, y: 40, width: 220, height: 80 },
    order,
    visible: true,
    locked: extra.locked ?? false,
    rotation: extra.rotation ?? 0,
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

function scoped(item: LayerItem): ScopedLayerItem {
  return { item, visibility: { mode: 'all', locationIds: [] } }
}

function fixture(worldRotation = 0): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r5b-spatial-transform',
    revision: 1,
    title: 'R5-B transform',
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
    globalLayerItems: [scoped(globalController())],
    globalInteractions: [],
    locations: [{
      id: LOCATION_ID,
      label: '总览',
      kind: 'spatial-camera',
      surfaceId: SURFACE_ID,
      cameraFrameId: 'camera-home',
    }],
    startLocationId: LOCATION_ID,
    surfaces: [{
      id: SURFACE_ID,
      title: '池塘',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [
          nativeText('world-text', 1, '远景', {
            frame: { mode: 'absolute', x: -200, y: 40, width: 220, height: 80 },
            rotation: worldRotation,
          }),
        ],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: 'camera-home', name: '总览', x: 0, y: 0, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  })
}

function hostOf(session: SpatialAuthoringSession): SpatialWorldAuthoringHost & {
  session(): SpatialAuthoringSession
} {
  let current = session
  return {
    getSession: () => current,
    setSession: (next) => {
      current = next
    },
    session: () => current,
  }
}

function enterGlobal(host: SpatialWorldAuthoringHost) {
  const result = setSpatialEditingScope(host.getSession(), 'global')
  if (!result.ok || !result.nextSession) throw new Error(result.reason ?? 'expected global scope')
  host.setSession(result.nextSession)
}

describe('Spatial world vs viewport view transforms', () => {
  it('uses sessionCamera as the world view and does not stack a 1280×720 page fit', () => {
    const host = hostOf(openSpatialAuthoringSession(fixture(), {
      locationId: LOCATION_ID,
      sessionId: 'spatial-session-r5b-tf',
    }))
    const controller = createSpatialWorldAuthoringController(host)
    const zoomed = controller.zoomSession(2, VIEWPORT)
    expect(zoomed.command?.ok).toBe(true)
    expect(zoomed.command?.historyEntry).toBe(false)
    expect(host.session().history.present.revision).toBe(1)

    const world = spatialWorldViewTransform(VIEWPORT, host.session().sessionCamera)
    expect(world).toEqual(createSpatialWorldViewTransform(VIEWPORT, host.session().sessionCamera))
    expect(world.fitScale).toBe(1)
    expect(world.scale).toBe(2)

    const oddWorld = spatialWorldViewTransform(ODD_VIEWPORT, { x: 0, y: 0, zoom: 2 })
    const stackedPage = createStageViewportTransform({
      viewport: ODD_VIEWPORT,
      zoom: 2,
      pan: { x: 0, y: 0 },
    })
    expect(oddWorld.fitScale).toBe(1)
    expect(oddWorld.scale).toBe(2)
    expect(stackedPage.fitScale).toBe(
      Math.min(ODD_VIEWPORT.width / STAGE_VIEWPORT_WIDTH, ODD_VIEWPORT.height / STAGE_VIEWPORT_HEIGHT),
    )
    expect(oddWorld.scale).not.toBe(stackedPage.scale)
    expect(oddWorld.fitScale).not.toBe(stackedPage.fitScale)

    controller.selectFromLayerIds(['world-text'], VIEWPORT)
    const geometry = controller.overlayGeometry(VIEWPORT)
    const shared = spatialWorldSelectionOverlay(VIEWPORT, host.session())
    expect(geometry?.selectionBox).toEqual(shared?.selectionBox)
    const origin = worldToClient(world, { x: -200, y: 40 })
    expect(geometry?.selectionBox).toEqual({
      x: origin.x,
      y: origin.y,
      width: 220 * 2,
      height: 80 * 2,
    })
    expect(geometry?.handles.w).toEqual(worldToClient(world, { x: -200, y: 80 }))
    expect(Object.keys(geometry?.handles ?? {})).toEqual([
      'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
    ])
    expect(geometry?.rotationHandle.y).toBeLessThan(geometry!.handles.n.y)
    expect(geometry?.rotation).toBe(0)
  })

  it('rotates the world selection overlay with a single selected item', () => {
    const host = hostOf(openSpatialAuthoringSession(fixture(90), {
      locationId: LOCATION_ID,
      sessionId: 'spatial-session-r5b-tf-rotate',
    }))
    const controller = createSpatialWorldAuthoringController(host)
    const zoomed = controller.zoomSession(2, VIEWPORT)
    expect(zoomed.command?.ok).toBe(true)
    controller.selectFromLayerIds(['world-text'], VIEWPORT)

    const world = spatialWorldViewTransform(VIEWPORT, host.session().sessionCamera)
    const geometry = controller.overlayGeometry(VIEWPORT)
    const shared = spatialWorldSelectionOverlay(VIEWPORT, host.session())
    const worldBox = { x: -200, y: 40, width: 220, height: 80 }
    const origin = worldToClient(world, worldBox)
    const center = worldRectCenter(worldBox)

    expect(geometry?.rotation).toBe(90)
    expect(shared?.rotation).toBe(90)
    expect(geometry?.selectionBox).toEqual({
      x: origin.x,
      y: origin.y,
      width: 220 * 2,
      height: 80 * 2,
    })
    expect(geometry?.handles.w).toEqual(
      worldToClient(world, rotateWorldPoint({ x: -200, y: 80 }, center, 90)),
    )
    expect(geometry?.handles.n).toEqual(
      worldToClient(world, stageResizeHandleWorldPoint(worldBox, 'n', 90)),
    )
    expect(geometry?.rotationHandle).toEqual(shared?.rotationHandle)
  })

  it('keeps teacher-controller overlay on the viewport matrix and ignores world pan/zoom', () => {
    const host = hostOf(openSpatialAuthoringSession(fixture(), {
      locationId: LOCATION_ID,
      sessionId: 'spatial-session-r5b-hud',
    }))
    enterGlobal(host)
    const controller = createSpatialWorldAuthoringController(host)
    const overlay = createSpatialViewportOverlayTransform(VIEWPORT)
    expect(spatialViewportOverlayTransform(VIEWPORT)).toEqual(overlay)
    const controllerClient = worldToClient(overlay, { x: 190, y: 638 })
    const hit = controller.pointerDown({
      x: controllerClient.x + 10,
      y: controllerClient.y + 8,
    }, VIEWPORT)
    expect(hit.hit?.layerItemId).toBe('global-teacher-controller')
    expect(hit.hit?.coordinateSpace).toBe('viewport')
    expect(hit.viewportTransform).toEqual(overlay)

    const beforeBox = hit.viewportOverlay?.selectionBox
    controller.pointerUp({
      x: controllerClient.x + 10,
      y: controllerClient.y + 8,
    }, VIEWPORT)
    expect(controller.zoomSession(2, VIEWPORT).command?.historyEntry).toBe(false)
    controller.pointerDown({ x: 10, y: 10 }, VIEWPORT)
    controller.pointerMove({ x: 90, y: 50 }, VIEWPORT)
    const panUp = controller.pointerUp({ x: 90, y: 50 }, VIEWPORT)
    expect(panUp.command?.historyEntry).toBe(false)
    expect(host.session().sessionCamera.zoom).toBe(2)
    expect(host.session().sessionCamera.x).not.toBe(0)

    controller.selectFromLayerIds(['global-teacher-controller'], VIEWPORT)
    const still = spatialViewportHudOverlay(VIEWPORT, host.session())
    expect(still?.selectionBox).toEqual(beforeBox)
    expect(spatialWorldSelectionOverlay(VIEWPORT, host.session())).toBeNull()
    expect(controller.worldTransform(VIEWPORT).scale).toBe(2)
    expect(controller.viewportTransform(VIEWPORT).scale).not.toBe(2)
    expect(controller.viewportTransform(VIEWPORT).scale).toBe(overlay.scale)
  })

  it('previews viewport controller move then writes the global frame on pointerup', () => {
    const host = hostOf(openSpatialAuthoringSession(fixture(), {
      locationId: LOCATION_ID,
      sessionId: 'spatial-session-r5b-hud-move',
    }))
    enterGlobal(host)
    const controller = createSpatialWorldAuthoringController(host)
    const overlay = createSpatialViewportOverlayTransform(VIEWPORT)
    const start = worldToClient(overlay, { x: 200, y: 650 })
    const moved = worldToClient(overlay, { x: 240, y: 680 })
    const down = controller.pointerDown({ x: start.x, y: start.y }, VIEWPORT)
    expect(down.hit?.layerItemId).toBe('global-teacher-controller')
    expect(down.command?.historyEntry).toBe(false)
    const preview = controller.pointerMove({ x: moved.x, y: moved.y }, VIEWPORT)
    expect(preview.preview?.[0]).toMatchObject({
      layerItemId: 'global-teacher-controller',
      x: 230,
      y: 668,
    })
    expect(host.session().history.present.revision).toBe(1)
    const up = controller.pointerUp({ x: moved.x, y: moved.y }, VIEWPORT)
    expect(up.command?.ok).toBe(true)
    expect(up.command?.historyEntry).toBe(true)
    const item = host.session().history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-teacher-controller',
    )!.item
    expect(item.frame).toMatchObject({ x: 230, y: 668, width: 900, height: 64 })
    expect(item.frame.x).not.toBe(-440)
  })

  it('builds world transform from typed view sessionCamera without writing the document', () => {
    const project = fixture()
    const view = buildSpatialEditorView({
      project,
      locationId: LOCATION_ID,
      sessionCamera: { x: -400, y: 2000, zoom: 2 },
    })
    expect(view.sessionCamera).toEqual({ x: -400, y: 2000, zoom: 2 })
    const transform = createSpatialWorldViewTransform(VIEWPORT, view.sessionCamera!)
    expect(worldToClient(transform, { x: -400, y: 2000 })).toEqual({ x: 640, y: 360 })
    const surface = project.surfaces.find((candidate) => candidate.type === 'spatial-2d')
    expect(surface?.camera.home).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(view).not.toHaveProperty('paths')
    expect(view.worldGraph.paths).toEqual([])
    expect(view.visibilityRules).toEqual([])
  })
})
