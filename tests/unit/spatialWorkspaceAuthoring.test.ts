import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type ComponentLayerItem,
  type CourseProjectDocument,
  type LayerItem,
  type NativeLayerItem,
  type RuntimeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import {
  resizeWorldFrameFromHandle,
  stageResizeHandleWorldPoint,
  stageRotateHandleWorldPoint,
  worldToClient,
} from '@/renderer/authoring/stageViewportTransform'
import {
  SPATIAL_REJECT_LOCKED,
  createSpatialWorldViewTransform,
  makeSpatialAuthoringTarget,
  openSpatialAuthoringSession,
  selectSpatialLayers,
  setSpatialEditingScope,
  worldLayerItem,
  type SpatialAuthoringSession,
} from '@/renderer/course/spatialEditorCommands'
import {
  SPATIAL_CONTENT_REJECT_INVALID_TARGET,
  beginSpatialWorldContentEdit,
  commitSpatialWorldContentEdit,
  commitSpatialWorldTextRunStyle,
  createSpatialWorldAuthoringController,
  hitTestSpatialDeferredOverlays,
  listSpatialWorldHitTargets,
  pointerToSpatialViewport,
  pointerToSpatialWorld,
  readSpatialWorldNativeContent,
  updateSpatialWorldContentFormulaDraft,
  updateSpatialWorldContentTextDraft,
  type SpatialWorldAuthoringHost,
} from '@/renderer/authoring/spatialWorldAuthoring'
import {
  adaptV9SpatialLayerHit,
  hitTestV9SpatialLayerItems,
} from '@/renderer/phaser/v9SpatialHitAdapter'
import {
  assertActiveSpatialEditorView,
  buildSpatialEditorView,
  isSpatialEditorLocationKind,
  SPATIAL_SESSIONLESS_ERROR,
} from '@/renderer/course/spatialEditorView'

/**
 * Proves Spatial world authoring adapter: hit order, transform, insert, double-click.
 * Does not prove Workspace, PropertiesTab, Phaser, or that the Spatial editor is usable.
 */
const NOW = '2026-08-17T17:30:00.000Z'
const VIEWPORT = { x: 0, y: 0, width: 1280, height: 720 }
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

function layerBase(
  layerItemId: string,
  order: number,
  frame: NativeLayerItem['frame'],
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'visible' | 'rotation'>> = {},
) {
  return {
    layerItemId,
    label: layerItemId,
    frame,
    order,
    visible: extra.visible ?? true,
    locked: extra.locked ?? false,
    rotation: extra.rotation ?? 0,
    opacity: 1,
    hitPolicy: 'auto' as const,
    playbackInitialVisibility: 'inherit' as const,
  }
}

function nativeText(
  layerItemId: string,
  order: number,
  text: string,
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'frame'>> = {},
): NativeLayerItem {
  return {
    ...layerBase(
      layerItemId,
      order,
      extra.frame ?? { mode: 'absolute', x: -200, y: 40, width: 220, height: 80 },
      extra,
    ),
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function nativeFormula(layerItemId: string, order: number): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 80, y: -40, width: 160, height: 80 }),
    kind: 'native',
    content: {
      nativeType: 'formula',
      data: {
        formulaId: 'formula-world',
        accessibleText: 'x',
        ast: { type: 'token', value: 'x' },
        style: { fontSize: 24, color: '#172033', align: 'left' },
      },
    },
  }
}

function nativeImage(layerItemId: string, order: number, assetId: string): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 200, y: 100, width: 200, height: 120 }),
    kind: 'native',
    content: {
      nativeType: 'image',
      data: {
        assetId,
        preserveAspectRatio: true,
        fit: 'contain',
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        cropX: 0.5,
        cropY: 0.5,
        flipX: false,
        flipY: false,
        cornerRadius: 0,
        feather: { amount: 0, mode: 'rectangle' },
        safeAreas: [],
      },
    },
  }
}

function nativeVideo(layerItemId: string, order: number, assetId: string): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 200, y: 280, width: 240, height: 140 }),
    kind: 'native',
    content: {
      nativeType: 'video',
      data: {
        assetId,
        fit: 'contain',
        autoplay: false,
        loop: false,
        muted: false,
        volume: 1,
        playbackRate: 1,
        showControls: true,
        clickToToggle: true,
        startTime: 0,
        endTime: null,
        poster: { mode: 'video-frame', time: 0 },
        backgroundAudioMode: 'duck',
      },
    },
  }
}

function componentItem(): ComponentLayerItem {
  return {
    ...layerBase('world-component', 7, { mode: 'absolute', x: -80, y: 400, width: 200, height: 160 }),
    kind: 'component',
    component: { packageId: 'pkg-1', version: '1.0.0' },
    props: { prompt: '题' },
  }
}

function runtimeItem(): RuntimeLayerItem {
  return {
    ...layerBase('world-runtime', 8, { mode: 'absolute', x: 400, y: 400, width: 280, height: 180 }),
    kind: 'runtime',
    runtime: {
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
      content: { values: { label: 'Runtime' } },
      assets: {},
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

function fixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r5b-spatial-world',
    revision: 1,
    title: 'R5-B world authoring',
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
      scoped(nativeText('global-hud', 50, '全局条', {
        frame: { mode: 'absolute', x: 440, y: 400, width: 220, height: 80 },
      })),
      scoped(globalController()),
    ],
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
      surfaceLayerItems: [
        scoped(nativeText('surface-shared', 25, '页面共享', {
          frame: { mode: 'absolute', x: 900, y: 20, width: 180, height: 60 },
        })),
      ],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [
          nativeText('world-text', 1, '春⭐风', {
            frame: { mode: 'absolute', x: -200, y: 40, width: 220, height: 80 },
          }),
          nativeText('world-locked', 2, '锁定', {
            locked: true,
            frame: { mode: 'absolute', x: -200, y: 160, width: 200, height: 60 },
          }),
          nativeText('world-overlap', 3, '重叠', {
            frame: { mode: 'absolute', x: -450, y: 278, width: 100, height: 80 },
          }),
          nativeFormula('world-formula', 4),
          nativeImage('world-image', 5, 'asset-image'),
          nativeVideo('world-video', 6, 'asset-video'),
          componentItem(),
          runtimeItem(),
        ],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [
          { id: 'camera-home', name: '总览', x: 0, y: 0, zoom: 1 },
          { id: 'camera-near', name: '近景', x: 800, y: 900, zoom: 2 },
        ],
      },
      semanticZoom: [],
    }],
  })
}

function hostOf(session: SpatialAuthoringSession = openSpatialAuthoringSession(fixture(), {
  locationId: LOCATION_ID,
  sessionId: 'spatial-session-r5b',
})) {
  let current = session
  const host: SpatialWorldAuthoringHost & { session: () => SpatialAuthoringSession } = {
    getSession: () => current,
    setSession: (next) => {
      current = next
    },
    session: () => current,
  }
  return host
}

function enterGlobal(host: SpatialWorldAuthoringHost) {
  const result = setSpatialEditingScope(host.getSession(), 'global')
  if (!result.ok || !result.nextSession) throw new Error(result.reason ?? 'expected global scope')
  host.setSession(result.nextSession)
}

function worldClient(session: SpatialAuthoringSession, point: { x: number; y: number }) {
  return worldToClient(createSpatialWorldViewTransform(VIEWPORT, session.sessionCamera), point)
}

function nativeWorldFrame(session: SpatialAuthoringSession, id: string) {
  const item = worldLayerItem(session.history.present, SURFACE_ID, id)
  return { ...item.frame, rotation: item.rotation }
}

describe('Spatial world authoring adapter', () => {
  it('selects an existing surface owner through its stable address without document or history writes', () => {
    const initial = openSpatialAuthoringSession(fixture(), { locationId: LOCATION_ID })
    const present = initial.history.present
    const past = initial.history.past
    const future = initial.history.future
    const scoped = setSpatialEditingScope(initial, 'surface')
    expect(scoped.ok).toBe(true)
    expect(scoped.historyEntry).toBe(false)
    const surfaceSession = scoped.nextSession!
    const selected = selectSpatialLayers(surfaceSession, {
      layerItemIds: ['surface-shared'],
    }, { expectedRevision: present.revision })
    expect(selected.ok).toBe(true)
    expect(selected.historyEntry).toBe(false)
    expect(selected.nextSession?.scope).toBe('surface')
    expect(selected.nextSession?.selection.selectionIds).toEqual(['surface-shared'])
    expect(selected.nextSession?.history.present).toBe(present)
    expect(selected.nextSession?.history.past).toBe(past)
    expect(selected.nextSession?.history.future).toBe(future)

    const target = makeSpatialAuthoringTarget(selected.nextSession!, 'surface-shared', 'item')
    expect(target.scope).toBe('surface')
    expect(target.coordinateSpace).toBe('world')
    expect(target.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r5b-spatial-world',
      scope: 'surface',
      surfaceId: SURFACE_ID,
      carrier: 'native',
      layerItemId: 'surface-shared',
      field: 'item',
    }))
    expect(JSON.stringify(target)).not.toMatch(/hitId/)
  })

  it('hits viewport/global before world, and camera-frame overlay does not steal world items', () => {
    const host = hostOf()
    const controller = createSpatialWorldAuthoringController(host)
    const overlap = worldClient(host.session(), { x: -440, y: 290 })
    const viewportPoint = pointerToSpatialViewport(overlap, VIEWPORT)
    const worldPoint = pointerToSpatialWorld(overlap, VIEWPORT, host.session().sessionCamera)
    expect(viewportPoint).toEqual({ x: overlap.x, y: overlap.y })
    expect(worldPoint.x).toBeCloseTo(-440)
    expect(worldPoint.y).toBeCloseTo(290)

    const hitProject = structuredClone(host.session().history.present)
    hitProject.globalLayerItems.push({
      ...scoped(nativeText('global-overlay', 70, '全局前景', {
        frame: { mode: 'absolute', x: 440, y: 400, width: 220, height: 80 },
      })),
      plane: 'overlay',
    })
    const composed = buildSpatialEditorView({
      project: hitProject,
      locationId: LOCATION_ID,
      sessionCamera: host.session().sessionCamera,
    })
    const targets = composed.layers.map(adaptV9SpatialLayerHit)
    const sharedPoint = {
      viewport: { x: 550, y: 440 },
      world: { x: -90, y: 80 },
    }
    expect(targets.find((target) => target.layerItemId === 'global-hud')).toMatchObject({
      globalPlane: 'underlay',
    })
    expect(targets.find((target) => target.layerItemId === 'global-overlay')).toMatchObject({
      globalPlane: 'overlay',
    })
    expect(hitTestV9SpatialLayerItems(
      targets.filter((target) => target.layerItemId !== 'global-overlay'),
      sharedPoint,
    )?.layerItemId).toBe('world-text')
    expect(hitTestV9SpatialLayerItems(targets, sharedPoint)?.layerItemId).toBe('global-overlay')
    expect(hitTestV9SpatialLayerItems(targets, {
      viewport: sharedPoint.viewport,
      world: { x: 10_000, y: 10_000 },
    })?.layerItemId).toBe('global-overlay')
    const passThroughProject = structuredClone(hitProject)
    passThroughProject.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-overlay',
    )!.item.hitPolicy = 'pass-through'
    const passThroughTargets = buildSpatialEditorView({
      project: passThroughProject,
      locationId: LOCATION_ID,
      sessionCamera: host.session().sessionCamera,
    }).layers.map(adaptV9SpatialLayerHit)
    expect(hitTestV9SpatialLayerItems(passThroughTargets, sharedPoint)?.layerItemId)
      .toBe('world-text')
    expect(hitTestV9SpatialLayerItems(
      passThroughTargets,
      { viewport: sharedPoint.viewport, world: { x: 10_000, y: 10_000 } },
    )?.layerItemId).toBe('global-hud')

    const inertDown = controller.pointerDown({ x: overlap.x, y: overlap.y }, VIEWPORT)
    expect(host.session().scope).toBe('world')
    expect(inertDown.hit?.nativeType).not.toBe('teacher-controller')
    controller.pointerUp({ x: overlap.x, y: overlap.y }, VIEWPORT)

    enterGlobal(host)
    const down = controller.pointerDown({ x: overlap.x, y: overlap.y }, VIEWPORT)
    expect(down.hit?.layerItemId).toBe('global-teacher-controller')
    expect(down.hit?.coordinateSpace).toBe('viewport')
    expect(down.hit?.nativeType).toBe('teacher-controller')
    expect(down.targets?.[0]?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r5b-spatial-world',
      scope: 'global',
      carrier: 'native',
      layerItemId: 'global-teacher-controller',
      field: 'item',
    }))
    expect(JSON.stringify(down.targets?.[0])).not.toMatch(/hitId/)
    controller.pointerUp({ x: overlap.x, y: overlap.y }, VIEWPORT)

    const text = worldClient(host.session(), { x: -90, y: 80 })
    const worldDown = controller.pointerDown({ x: text.x, y: text.y }, VIEWPORT)
    expect(worldDown.hit?.layerItemId).toBe('world-text')
    expect(worldDown.hit?.coordinateSpace).toBe('world')
    const deferredOnWorld = hitTestSpatialDeferredOverlays(
      host.session(),
      VIEWPORT,
      pointerToSpatialWorld(text, VIEWPORT, host.session().sessionCamera),
    )
    expect(worldDown.hit?.layerItemId).not.toBe('camera-home')
    expect(deferredOnWorld?.overlay === 'camera-frame' || deferredOnWorld === null).toBe(true)

    const empty = { x: 640, y: 360 }
    const blank = controller.pointerDown(empty, VIEWPORT)
    expect(blank.hit).toBeFalsy()
    expect(blank.deferredOverlay).toEqual({
      kind: 'unimplemented',
      overlay: 'camera-frame',
      reason: 'handed-to-R5-C',
    })
    expect(blank.deferredOverlay?.overlay).not.toBe('path')
    expect(blank.deferredOverlay?.overlay).not.toBe('relation')
    controller.pointerUp(empty, VIEWPORT)
  })

  it('inserts image/video/component/runtime via R5-A, then hits and selects the same Spatial target', () => {
    const host = hostOf()
    const controller = createSpatialWorldAuthoringController(host)
    const image = controller.insertWorldImage({
      id: 'inserted-image',
      assetId: 'asset-image',
      x: -3000,
      y: 4000,
      width: 120,
      height: 80,
    }, VIEWPORT, { now: NOW })
    expect(image.command?.ok).toBe(true)
    expect(image.command?.historyEntry).toBe(true)
    expect(worldLayerItem(host.session().history.present, SURFACE_ID, 'inserted-image').frame).toMatchObject({
      x: -3000,
      y: 4000,
    })

    const video = controller.insertWorldVideo({
      id: 'inserted-video',
      assetId: 'asset-video',
      x: -2800,
      y: 4000,
    }, VIEWPORT, { now: NOW })
    const component = controller.insertWorldComponent({
      id: 'inserted-component',
      packageId: 'pkg-1',
      x: -2600,
      y: 4000,
    }, VIEWPORT, { now: NOW })
    const runtime = controller.insertWorldRuntime({
      id: 'inserted-runtime',
      x: -2400,
      y: 4000,
      width: 160,
      height: 100,
    }, VIEWPORT, { now: NOW })
    expect(runtime.command?.ok).toBe(true)
    expect(host.session().history.present.revision).toBe(5)

    const view = buildSpatialEditorView({
      project: host.session().history.present,
      locationId: LOCATION_ID,
      sessionCamera: host.session().sessionCamera,
    })
    const hits = view.layers.map(adaptV9SpatialLayerHit)
    expect(hitTestV9SpatialLayerItems(hits, {
      viewport: { x: 0, y: 0 },
      world: { x: -2940, y: 4040 },
    })?.layerItemId).toBe('inserted-image')
    expect(hitTestV9SpatialLayerItems(hits, {
      viewport: { x: 0, y: 0 },
      world: { x: -2700, y: 4100 },
    })?.kind).toBe('native')
    expect(hitTestV9SpatialLayerItems(hits, {
      viewport: { x: 0, y: 0 },
      world: { x: -2500, y: 4100 },
    })?.kind).toBe('component')
    expect(hitTestV9SpatialLayerItems(hits, {
      viewport: { x: 0, y: 0 },
      world: { x: -2320, y: 4050 },
    })?.kind).toBe('runtime')

    const client = worldClient(host.session(), { x: -2940, y: 4040 })
    const selected = controller.pointerDown({ x: client.x, y: client.y }, VIEWPORT)
    expect(selected.hit?.layerItemId).toBe('inserted-image')
    expect(selected.targets?.[0]?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r5b-spatial-world',
      scope: 'surface',
      surfaceId: SURFACE_ID,
      carrier: 'native',
      layerItemId: 'inserted-image',
      field: 'content.data.assetId',
    }))
    expect(selected.targets?.[0]?.coordinateSpace).toBe('world')
    expect(JSON.stringify(selected)).not.toMatch(/hitId/)
    controller.pointerUp({ x: client.x, y: client.y }, VIEWPORT)

    const fromLayer = controller.selectFromLayerIds(['inserted-component'], VIEWPORT)
    expect(fromLayer.targets?.[0]?.layerItemId).toBe('inserted-component')
    expect(fromLayer.targets?.[0]?.authoringAddress).toContain('/component/')

    expect(video.command?.ok).toBe(true)
    expect(component.command?.ok).toBe(true)
    expect(listSpatialWorldHitTargets(host.session()).some((hit) => hit.layerItemId === 'world-image')).toBe(true)
  })

  it('previews west resize on pointermove and commits once on pointerup; zoom 2 maps 40 CSS px to 20 world', () => {
    const host = hostOf()
    const controller = createSpatialWorldAuthoringController(host)
    controller.selectFromLayerIds(['world-text'], VIEWPORT)
    const west = stageResizeHandleWorldPoint(
      { x: -200, y: 40, width: 220, height: 80 },
      'w',
    )
    const westClient = worldClient(host.session(), west)
    controller.pointerDown({ x: westClient.x, y: westClient.y }, VIEWPORT)
    const revision = host.session().history.present.revision
    const moved = controller.pointerMove({ x: westClient.x - 40, y: westClient.y }, VIEWPORT)
    expect(moved.preview?.[0]).toMatchObject({ x: -240, y: 40, width: 260, height: 80 })
    expect(host.session().history.present.revision).toBe(revision)
    expect(nativeWorldFrame(host.session(), 'world-text')).toMatchObject({ x: -200, width: 220 })

    const up = controller.pointerUp({ x: westClient.x - 40, y: westClient.y }, VIEWPORT)
    expect(up.command?.ok).toBe(true)
    expect(up.command?.historyEntry).toBe(true)
    expect(nativeWorldFrame(host.session(), 'world-text')).toMatchObject({
      x: -240,
      y: 40,
      width: 260,
      height: 80,
    })
    expect(resizeWorldFrameFromHandle(
      { x: -200, y: 40, width: 220, height: 80 },
      'w',
      { x: -240, y: 80 },
    )).toMatchObject({ x: -240, width: 260 })

    const zoomed = controller.zoomSession(2, VIEWPORT)
    expect(zoomed.command?.historyEntry).toBe(false)
    controller.selectFromLayerIds(['world-image'], VIEWPORT)
    const imageWest = stageResizeHandleWorldPoint(
      { x: 200, y: 100, width: 200, height: 120 },
      'w',
    )
    const imageWestClient = worldClient(host.session(), imageWest)
    controller.pointerDown({ x: imageWestClient.x, y: imageWestClient.y }, VIEWPORT)
    const imageMove = controller.pointerMove({
      x: imageWestClient.x - 40,
      y: imageWestClient.y,
    }, VIEWPORT)
    expect(imageMove.preview?.[0]).toMatchObject({ x: 180, y: 100, width: 220, height: 120 })
    const imageUp = controller.pointerUp({
      x: imageWestClient.x - 40,
      y: imageWestClient.y,
    }, VIEWPORT)
    expect(imageUp.command?.historyEntry).toBe(true)
    expect(nativeWorldFrame(host.session(), 'world-image')).toMatchObject({ x: 180, width: 220 })
  })

  it('rotates on pointerup, pans empty canvas without revision, and rejects locked writes', () => {
    const host = hostOf()
    const controller = createSpatialWorldAuthoringController(host)
    controller.selectFromLayerIds(['world-text'], VIEWPORT)
    const box = { x: -200, y: 40, width: 220, height: 80 }
    const rotate = stageRotateHandleWorldPoint(box, 0)
    const rotateClient = worldClient(host.session(), rotate)
    controller.pointerDown({ x: rotateClient.x, y: rotateClient.y }, VIEWPORT)
    const rotated = controller.pointerMove({ x: rotateClient.x + 40, y: rotateClient.y }, VIEWPORT)
    expect(rotated.preview?.[0]?.rotation).not.toBe(0)
    const rotateUp = controller.pointerUp({ x: rotateClient.x + 40, y: rotateClient.y }, VIEWPORT)
    expect(rotateUp.command?.historyEntry).toBe(true)
    expect(nativeWorldFrame(host.session(), 'world-text').rotation).not.toBe(0)

    const revision = host.session().history.present.revision
    const camera = host.session().sessionCamera
    controller.pointerDown({ x: 20, y: 20 }, VIEWPORT)
    controller.pointerMove({ x: 60, y: 20 }, VIEWPORT)
    const pan = controller.pointerUp({ x: 60, y: 20 }, VIEWPORT)
    expect(pan.command?.ok).toBe(true)
    expect(pan.command?.historyEntry).toBe(false)
    expect(host.session().history.present.revision).toBe(revision)
    expect(host.session().sessionCamera.x).toBe(camera.x - 40)
    expect(host.session().sessionCamera.zoom).toBe(1)

    const lockedClient = worldClient(host.session(), { x: -100, y: 190 })
    const locked = controller.pointerDown({ x: lockedClient.x, y: lockedClient.y }, VIEWPORT)
    expect(locked.hit?.layerItemId).toBe('world-locked')
    expect(locked.hit?.locked).toBe(true)
    controller.pointerUp({ x: lockedClient.x, y: lockedClient.y }, VIEWPORT)
    const written = controller.transformSelection([{
      layerItemId: 'world-locked',
      x: 1,
      y: 2,
      width: 200,
      height: 60,
      rotation: 0,
    }], VIEWPORT)
    expect(written.command?.ok).toBe(false)
    expect(written.command?.reason).toBe(SPATIAL_REJECT_LOCKED)
    expect(nativeWorldFrame(host.session(), 'world-locked')).toMatchObject({ x: -200, y: 160 })
  })

  it('double-clicks world text/formula into a Spatial content session and ignores camera, blank, and image', () => {
    const host = hostOf()
    const controller = createSpatialWorldAuthoringController(host)
    const textClient = worldClient(host.session(), { x: -90, y: 80 })
    const begun = controller.doubleClick({ x: textClient.x, y: textClient.y }, VIEWPORT)
    expect(begun.contentEdit?.ok).toBe(true)
    if (!begun.contentEdit?.ok) throw new Error('expected text edit')
    expect(begun.contentEdit.edit.target.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r5b-spatial-world',
      scope: 'surface',
      surfaceId: SURFACE_ID,
      carrier: 'native',
      layerItemId: 'world-text',
      field: 'content.data.text',
    }))
    expect(begun.contentEdit.edit.target.coordinateSpace).toBe('world')
    expect(JSON.stringify(begun.contentEdit.edit.target)).not.toMatch(/hitId/)

    const drafted = updateSpatialWorldContentTextDraft(begun.contentEdit.edit, {
      text: '新的远景',
      runs: [],
    })
    const committed = commitSpatialWorldContentEdit(host.session(), drafted, { now: NOW })
    expect(committed.ok).toBe(true)
    expect(committed.historyEntry).toBe(true)
    host.setSession(committed.nextSession!)
    const native = readSpatialWorldNativeContent(host.session(), 'world-text')
    if (!native || native.content.nativeType !== 'text') throw new Error('expected text')
    expect(native.content.data.text).toBe('新的远景')

    const styled = commitSpatialWorldTextRunStyle(host.session(), {
      layerItemId: 'world-text',
      selectionStart: 0,
      selectionEnd: 1,
      patch: { bold: true },
      source: 'properties',
    }, { now: NOW })
    expect(styled.ok).toBe(true)
    host.setSession(styled.nextSession!)

    const formulaClient = worldClient(host.session(), { x: 160, y: 0 })
    const formula = controller.doubleClick({ x: formulaClient.x, y: formulaClient.y }, VIEWPORT)
    expect(formula.contentEdit?.ok).toBe(true)
    if (!formula.contentEdit?.ok) throw new Error('expected formula')
    const formulaDraft = updateSpatialWorldContentFormulaDraft(formula.contentEdit.edit, {
      ast: { type: 'token', value: 'y' },
    })
    const formulaCommit = commitSpatialWorldContentEdit(host.session(), formulaDraft, { now: NOW })
    expect(formulaCommit.ok).toBe(true)
    host.setSession(formulaCommit.nextSession!)
    const formulaItem = readSpatialWorldNativeContent(host.session(), 'world-formula')
    if (!formulaItem || formulaItem.content.nativeType !== 'formula') throw new Error('expected formula')
    expect(formulaItem.content.data.ast).toEqual({ type: 'token', value: 'y' })

    const imageClient = worldClient(host.session(), { x: 300, y: 160 })
    const image = controller.doubleClick({ x: imageClient.x, y: imageClient.y }, VIEWPORT)
    const imageEdit = image.contentEdit
    expect(imageEdit?.ok).toBe(false)
    if (!imageEdit || imageEdit.ok) throw new Error('expected image content edit to be refused')
    expect(imageEdit.reason).toBe(SPATIAL_CONTENT_REJECT_INVALID_TARGET)

    const blank = controller.doubleClick({ x: 640, y: 360 }, VIEWPORT)
    expect(blank.contentEdit?.ok).toBe(false)
    expect(blank.deferredOverlay?.overlay).toBe('camera-frame')

    const refused = beginSpatialWorldContentEdit({
      session: host.session(),
      layerItemId: 'world-image',
    })
    expect(refused.ok).toBe(false)
  })
})

describe('SpatialEditorView identities and Workspace Spatial reads', () => {
  it('exposes owner, camera, path, relation and visibility identities without R5-A top-level keys', () => {
    const project = structuredClone(fixture())
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected spatial surface')
    surface.world.paths = [{
      id: 'path-explore',
      name: '探索',
      layerItemIds: ['world-text', 'world-image'],
    }]
    surface.world.relations = [{
      id: 'rel-text-image',
      sourceLayerItemId: 'world-text',
      targetLayerItemId: 'world-image',
      kind: 'arrow',
    }]
    surface.semanticZoom = [{
      id: 'zoom-text',
      layerItemIds: ['world-text'],
      minZoom: 0,
      maxZoom: 2,
      visible: true,
    }]
    const parsed = courseProjectDocumentSchema.parse(project)
    const view = buildSpatialEditorView({
      project: parsed,
      locationId: LOCATION_ID,
      sessionCamera: { x: 12, y: -8, zoom: 1.5 },
    })

    expect(view).not.toHaveProperty('paths')
    expect(view).not.toHaveProperty('relations')
    expect(view).not.toHaveProperty('semanticZoom')
    expect(view.worldGraph.paths.map((entry) => entry.pathId)).toEqual(['path-explore'])
    expect(view.worldGraph.relations.map((entry) => entry.relationId)).toEqual(['rel-text-image'])
    expect(view.visibilityRules.map((rule) => rule.id)).toEqual(['zoom-text'])
    expect(view.camera.activeFrame.id).toBe('camera-home')
    expect(view.activeLocation.cameraFrameId).toBe('camera-home')
    expect(view.sessionCamera).toEqual({ x: 12, y: -8, zoom: 1.5 })
    expect(parsed.surfaces[0] && parsed.surfaces[0].type === 'spatial-2d'
      ? parsed.surfaces[0].camera.home
      : null).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(Object.isFrozen(view)).toBe(true)

    const world = view.layers.find((layer) => layer.selectionId === 'world-text')
    const surfaceLayer = view.layers.find((layer) => layer.selectionId === 'surface-shared')
    const hud = view.layers.find((layer) => layer.selectionId === 'global-hud')
    expect(world).toMatchObject({
      owner: 'world',
      ownerKey: `world:${SURFACE_ID}`,
      coordinateSpace: 'world',
      locked: false,
    })
    expect(world?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: parsed.id,
      scope: 'surface',
      surfaceId: SURFACE_ID,
      carrier: 'native',
      layerItemId: 'world-text',
      field: 'content.data.text',
    }))
    expect(surfaceLayer?.owner).toBe('surface')
    expect(hud?.owner).toBe('global')
    expect(hud?.ownerKey).toBe('global')
    expect(JSON.stringify(view)).not.toMatch(/hitId/)

    expect(() => assertActiveSpatialEditorView({
      ...view,
      locationId: '',
      activeLocation: { ...view.activeLocation, locationId: '' },
    })).toThrow(SPATIAL_SESSIONLESS_ERROR)
    expect(isSpatialEditorLocationKind('spatial-camera')).toBe(true)
    expect(isSpatialEditorLocationKind('spatial-frames')).toBe(false)
    expect(isSpatialEditorLocationKind('flow-block')).toBe(false)
    expect(isSpatialEditorLocationKind('slide-scene')).toBe(false)
  })

  it('Spatial Workspace branch no longer projects SceneNode or old editing nodes', () => {
    const shell = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx'),
      'utf8',
    )
    const connector = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaces/SpatialWorkspaceConnector.tsx'),
      'utf8',
    )
    const route = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaces/WorkspaceRouteContext.ts'),
      'utf8',
    )
    expect(shell).not.toMatch(/courseLayerItemToSceneNode/)
    expect(shell).not.toMatch(/selectEditingNodes/)
    expect(shell).not.toMatch(/selectSelectedNode/)
    expect(shell).not.toMatch(/useEditorStore/)
    expect(shell).not.toMatch(/from ['"][^'"]*editorStore['"]/)
    expect(shell).toMatch(/createSpatialWorldTargetAuthoringController/)
    expect(shell).not.toMatch(/createSpatialWorldAuthoringController/)
    expect(shell).not.toMatch(/SpatialWorldAuthoringHost|authoringHost/)
    expect(shell).not.toMatch(/\bgetSession\b|\bsetSession\b/)
    expect(shell).not.toMatch(/runSpatialCommand|applySpatialAuthoringSession/)
    expect(shell).toMatch(/materializeNativeLayerItem/)
    expect(shell).not.toMatch(/SPATIAL_SESSIONLESS_ERROR/)
    expect(shell).not.toMatch(/spatial-workspace-sessionless/)
    expect(route).toMatch(/expectedSurfaceType !== 'spatial-2d'/)
    expect(connector).toMatch(/SPATIAL_SESSIONLESS_ERROR/)
    expect(connector).toMatch(/spatial-workspace-sessionless/)
    expect(route).toMatch(/locationSurfaceType/)
    expect(connector).not.toMatch(/hitTestV9SpatialLayerItems/)
    expect(connector).not.toMatch(/function SpatialSelectionOverlay/)
    expect(connector).not.toMatch(/createSpatialWorldViewTransform/)
  })
})
