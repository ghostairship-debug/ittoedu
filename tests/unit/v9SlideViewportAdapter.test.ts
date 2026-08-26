import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  createStageViewportTransform,
  resizeWorldFrameFromHandle,
  stageResizeHandleWorldPoint,
  worldToClient,
} from '@/renderer/authoring/stageViewportTransform'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  EditorPhaserBridge,
  adaptV9SlideLayerItemHit,
  editorPhaserPointerToWorld,
  hitTestV9SlideLayerItems,
} from '@/renderer/phaser/EditorPhaserBridge'
import {
  SLIDE_BACKEND_NOT_CANDIDATE,
  createSlideWorkspaceAuthoringController,
  mergeSlidePreviewIntoNodes,
  resolveSlideWorkspaceAuthoringKind,
} from '@/renderer/ui/workspaceSlideAuthoring'
import {
  selectEditingNodes,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_WRONG_OWNER,
} from '@/renderer/course/slideEditorCommands'
import { updateSlideNativeLayerContent } from '@/renderer/course/v9SlideContentCommands'

/**
 * V9 candidate fixture. Proves canvas hit / selection / transform / viewport.
 * Does not prove a real Workspace, MediaTab, Player, or a live Electron window.
 */
const NOW = '2026-08-17T14:20:00.000Z'
const VIEWPORT = { x: 0, y: 0, width: 1280, height: 720 }
const VIEW = { viewport: VIEWPORT, zoom: 1, pan: { x: 0, y: 0 } }

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
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'visible' | 'hitPolicy' | 'rotation'>> = {},
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
    hitPolicy: extra.hitPolicy ?? 'auto' as const,
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
      extra.frame ?? { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
      extra,
    ),
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function nativeImage(layerItemId: string, order: number, assetId: string): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 560, y: 100, width: 200, height: 120 }),
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
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 560, y: 280, width: 240, height: 140 }),
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
    ...layerBase('slide-component', 5, { mode: 'absolute', x: 80, y: 400, width: 200, height: 160 }),
    kind: 'component',
    component: { packageId: 'component.quiz', version: '4.0.0' },
    props: { prompt: '题' },
  }
}

function runtimeItem(): RuntimeLayerItem {
  return {
    ...layerBase('slide-runtime', 6, { mode: 'absolute', x: 900, y: 400, width: 280, height: 180 }),
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

function scoped(item: LayerItem): ScopedLayerItem {
  return { item, visibility: { mode: 'all', locationIds: [] } }
}

function teacherControllerItem(): NativeLayerItem {
  return {
    ...layerBase('teacher-ctrl', 99, { mode: 'absolute', x: 190, y: 638, width: 900, height: 64 }),
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
          { id: 'btn-next', action: { type: 'scene.next' }, label: '下一场景', visible: true },
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

function v9ViewportFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r2b-slide-viewport',
    revision: 1,
    title: 'R2-B viewport',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      photo: {
        id: 'photo',
        filename: 'photo.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/photo.bin',
        byteLength: 4,
        width: 2,
        height: 2,
      },
      clip: {
        id: 'clip',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'assets/clip.bin',
        byteLength: 8,
      },
    },
    componentPackages: {
      'component.quiz': {
        packageId: 'component.quiz',
        version: '4.0.0',
        name: 'Quiz',
        manifestPath: 'components/component.quiz/manifest.json',
        runtimePath: 'components/component.quiz/runtime.js',
        contentSha256: '1'.repeat(64),
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
      scoped(nativeText('global-banner', 50, '全局条')),
      scoped(teacherControllerItem()),
    ],
    globalInteractions: [],
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
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [
        scoped(nativeText('surface-shared', 25, '表面共享', {
          frame: { mode: 'absolute', x: 80, y: 200, width: 180, height: 60 },
        })),
      ],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [
          nativeText('slide-title', 1, '可编辑标题', {
            frame: { mode: 'absolute', x: 120, y: 120, width: 400, height: 80 },
          }),
          nativeText('slide-locked', 2, '锁定标题', {
            locked: true,
            frame: { mode: 'absolute', x: 120, y: 220, width: 400, height: 80 },
          }),
          nativeImage('slide-image', 3, 'photo'),
          nativeVideo('slide-video', 4, 'clip'),
          componentItem(),
          runtimeItem(),
        ],
        interactions: [],
      }],
    }],
  })
}

function injectCandidate() {
  const backend = createSlideAuthoringBackend(openSlideAuthoringSession(v9ViewportFixture()))
  useEditorStore.getState().injectV9SlideCandidateBackend(backend)
  return backend
}

function nativeFrame(id: string) {
  const document = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession().history.present
  const surface = document?.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('expected slide surface')
  const item = surface.scenes[0]?.layerItems.find((candidate) => candidate.layerItemId === id)
  if (!item || item.kind !== 'native') throw new Error(`expected native ${id}`)
  return { ...item.frame, rotation: item.rotation }
}

beforeEach(() => {
  useEditorStore.getState().clearV9SlideCandidateBackend()
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('V9 Slide viewport adapter', () => {
  it('defaults the Workspace authoring path to the V9 slide candidate', () => {
    const controller = createSlideWorkspaceAuthoringController()
    expect(resolveSlideWorkspaceAuthoringKind()).toBe('slide-authoring')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())?.kind).toBe('slide-authoring')
    const down = controller.pointerDown({ x: 200, y: 150 }, VIEW)
    const move = controller.pointerMove({ x: 220, y: 160 }, VIEW)
    const up = controller.pointerUp({ x: 220, y: 160 }, VIEW)
    expect(down.kind).toBe('slide-authoring')
    expect(move.kind).toBe('slide-authoring')
    expect(up.kind).toBe('slide-authoring')
    expect(down).not.toEqual({ kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE })
  })

  it('returns the V8 Workspace path when no slide backend is available', () => {
    useEditorStore.setState({ slideBackend: undefined as any })
    const controller = createSlideWorkspaceAuthoringController()
    expect(resolveSlideWorkspaceAuthoringKind()).toBe('v8')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).toBeNull()
    const down = controller.pointerDown({ x: 200, y: 150 }, VIEW)
    const move = controller.pointerMove({ x: 220, y: 160 }, VIEW)
    const up = controller.pointerUp({ x: 220, y: 160 }, VIEW)
    expect(down).toEqual({ kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE })
    expect(move).toEqual({ kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE })
    expect(up).toEqual({ kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE })
    expect(down).not.toMatchObject({ kind: 'slide-authoring' })
    expect('command' in down ? down.command?.ok : false).toBe(false)
  })

  it('maps single, additive, marquee and layer selection to the same SlideAuthoringTarget', () => {
    injectCandidate()
    const controller = createSlideWorkspaceAuthoringController()
    const canvas = controller.pointerDown({ x: 200, y: 150 }, VIEW)
    if (canvas.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(canvas.command?.ok).toBe(true)
    expect(canvas.hit?.layerItemId).toBe('slide-title')
    const canvasTarget = canvas.targets?.[0]
    expect(canvasTarget?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r2b-slide-viewport',
      scope: 'scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      carrier: 'native',
      layerItemId: 'slide-title',
      field: 'item',
    }))
    expect(canvasTarget?.authoringAddress).not.toMatch(/hit/i)
    expect(JSON.stringify(canvasTarget)).not.toMatch(/hitId/)

    controller.pointerUp({ x: 200, y: 150 }, VIEW)
    const additive = controller.pointerDown({ x: 200, y: 250, additive: true }, VIEW)
    if (additive.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(additive.command?.ok).toBe(true)
    expect(additive.targets?.map((target) => target.layerItemId).sort()).toEqual([
      'slide-locked',
      'slide-title',
    ])
    expect(additive.targets?.every((target) => !JSON.stringify(target).includes('hitId'))).toBe(true)

    controller.pointerUp({ x: 200, y: 250, additive: true }, VIEW)
    const marqueeStart = controller.pointerDown({ x: 100, y: 90 }, VIEW)
    expect(marqueeStart.kind).toBe('slide-authoring')
    controller.pointerMove({ x: 700, y: 210 }, VIEW)
    const marqueeEnd = controller.pointerUp({ x: 700, y: 210 }, VIEW)
    if (marqueeEnd.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(marqueeEnd.command?.ok).toBe(true)
    expect(marqueeEnd.targets?.map((target) => target.layerItemId).sort()).toEqual([
      'slide-image',
      'slide-title',
    ])

    const fromLayer = controller.selectFromLayerIds(['slide-title'], VIEW)
    if (fromLayer.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(fromLayer.targets?.[0]?.authoringAddress).toBe(canvasTarget?.authoringAddress)
    expect(fromLayer.targets?.[0]?.layerItemId).toBe('slide-title')
  })

  it('keeps object, selection box, rotate handle and eight handles on one viewport transform', () => {
    injectCandidate()
    const controller = createSlideWorkspaceAuthoringController()
    controller.selectFromLayerIds(['slide-title'], VIEW)
    const overlay = controller.overlayGeometry(VIEW)
    const westWorld = stageResizeHandleWorldPoint(
      { x: 120, y: 120, width: 400, height: 80 },
      'w',
    )
    expect(overlay?.handles.w).toEqual(worldToClient(createStageViewportTransform(VIEW), westWorld))
    expect(overlay?.handles.e.x).toBeGreaterThan(overlay!.handles.w.x)
    expect(overlay?.handles.s.y).toBeGreaterThan(overlay!.handles.n.y)
    expect(overlay?.rotationHandle.y).toBeLessThan(overlay!.handles.n.y)
    expect(overlay?.selectionBox).toMatchObject({ x: 120, y: 120, width: 400, height: 80 })
    expect(Object.keys(overlay?.handles ?? {})).toEqual([
      'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
    ])

    const zoomed = { viewport: VIEWPORT, zoom: 2, pan: { x: 0, y: 0 } }
    const zoomedOverlay = controller.overlayGeometry(zoomed)
    const zoomedTransform = createStageViewportTransform(zoomed)
    expect(zoomedOverlay?.handles.w).toEqual(worldToClient(zoomedTransform, westWorld))
    expect(zoomedOverlay?.rotationHandle).toEqual(
      worldToClient(zoomedTransform, {
        x: 320,
        y: 120 - 34,
      }),
    )
  })

  it('previews west/north resize on pointermove and commits transformSlideNativeLayers once on pointerup', () => {
    injectCandidate()
    const controller = createSlideWorkspaceAuthoringController()
    controller.selectFromLayerIds(['slide-title'], VIEW)
    const west = stageResizeHandleWorldPoint(
      { x: 120, y: 120, width: 400, height: 80 },
      'w',
    )
    const down = controller.pointerDown({ x: west.x, y: west.y }, VIEW)
    expect(down.kind).toBe('slide-authoring')
    const revisionAfterDown = selectSlideAuthoringBackend(useEditorStore.getState())?.getSnapshot().revision
    const moved = controller.pointerMove({ x: west.x - 40, y: west.y }, VIEW)
    if (moved.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(moved.preview?.[0]).toMatchObject({ x: 80, y: 120, width: 440, height: 80 })
    expect(selectSlideAuthoringBackend(useEditorStore.getState())?.getSnapshot().revision)
      .toBe(revisionAfterDown)
    expect(nativeFrame('slide-title')).toMatchObject({ x: 120, y: 120, width: 400, height: 80 })

    const up = controller.pointerUp({ x: west.x - 40, y: west.y }, VIEW)
    if (up.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(up.command?.ok).toBe(true)
    expect(up.command?.historyEntry).toBe(true)
    expect(nativeFrame('slide-title')).toEqual({
      mode: 'absolute',
      x: 80,
      y: 120,
      width: 440,
      height: 80,
      rotation: 0,
    })
    expect(resizeWorldFrameFromHandle(
      { x: 120, y: 120, width: 400, height: 80 },
      'w',
      { x: 80, y: 160 },
    )).toMatchObject({ x: 80, width: 440 })

    controller.selectFromLayerIds(['slide-title'], VIEW)
    const north = stageResizeHandleWorldPoint(
      { x: 80, y: 120, width: 440, height: 80 },
      'n',
    )
    controller.pointerDown({ x: north.x, y: north.y }, VIEW)
    const northMove = controller.pointerMove({ x: north.x, y: north.y - 30 }, VIEW)
    if (northMove.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(northMove.preview?.[0]).toMatchObject({ x: 80, y: 90, width: 440, height: 110 })
    const northUp = controller.pointerUp({ x: north.x, y: north.y - 30 }, VIEW)
    if (northUp.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(northUp.command?.historyEntry).toBe(true)
    expect(nativeFrame('slide-title')).toMatchObject({ x: 80, y: 90, width: 440, height: 110 })

    const zoomed = { viewport: VIEWPORT, zoom: 2, pan: { x: 0, y: 0 } }
    controller.selectFromLayerIds(['slide-image'], zoomed)
    const imageWestWorld = stageResizeHandleWorldPoint(
      { x: 560, y: 100, width: 200, height: 120 },
      'w',
    )
    const imageWestClient = worldToClient(createStageViewportTransform(zoomed), imageWestWorld)
    controller.pointerDown({ x: imageWestClient.x, y: imageWestClient.y }, zoomed)
    const imageMove = controller.pointerMove({
      x: imageWestClient.x - 40,
      y: imageWestClient.y,
    }, zoomed)
    if (imageMove.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(imageMove.preview?.[0]?.x).toBeCloseTo(540)
    expect(imageMove.preview?.[0]?.y).toBeCloseTo(94)
    expect(imageMove.preview?.[0]?.width).toBeCloseTo(220)
    expect(imageMove.preview?.[0]?.height).toBeCloseTo(132)
    const imageUp = controller.pointerUp({
      x: imageWestClient.x - 40,
      y: imageWestClient.y,
    }, zoomed)
    if (imageUp.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(imageUp.command?.ok).toBe(true)
    expect(nativeFrame('slide-image')?.x).toBeCloseTo(540)
    expect(nativeFrame('slide-image')?.y).toBeCloseTo(94)
    expect(nativeFrame('slide-image')?.width).toBeCloseTo(220)
    expect(nativeFrame('slide-image')?.height).toBeCloseTo(132)
  })

  it('hits image, video, Component and Runtime through the Phaser adapter without a game loop', () => {
    const backend = injectCandidate()
    const session = backend.getSession()
    const surface = session.history.present.surfaces.find((candidate) => candidate.type === 'slide')
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const items = surface.scenes[0]!.layerItems
    const adapted = items.map((item) => adaptV9SlideLayerItemHit(item, item.visible, 'scene'))
    expect(adapted.filter((target) => target.hittable).map((target) => target.layerItemId)).toEqual([
      'slide-title',
      'slide-locked',
      'slide-image',
      'slide-video',
      'slide-component',
      'slide-runtime',
    ])
    expect(adapted.find((target) => target.layerItemId === 'slide-image')?.nativeType).toBe('image')
    expect(adapted.find((target) => target.layerItemId === 'slide-video')?.nativeType).toBe('video')
    expect(adapted.find((target) => target.layerItemId === 'slide-component')?.kind).toBe('component')
    expect(adapted.find((target) => target.layerItemId === 'slide-runtime')?.kind).toBe('runtime')

    expect(hitTestV9SlideLayerItems(adapted, { x: 640, y: 140 })?.layerItemId).toBe('slide-image')
    expect(hitTestV9SlideLayerItems(adapted, { x: 640, y: 320 })?.layerItemId).toBe('slide-video')
    expect(hitTestV9SlideLayerItems(adapted, { x: 120, y: 460 })?.layerItemId).toBe('slide-component')
    expect(hitTestV9SlideLayerItems(adapted, { x: 1000, y: 480 })?.layerItemId).toBe('slide-runtime')

    const controller = createSlideWorkspaceAuthoringController()
    expect(controller.pointerDown({ x: 640, y: 140 }, VIEW)).toMatchObject({
      kind: 'slide-authoring',
      hit: { layerItemId: 'slide-image', nativeType: 'image' },
    })
    controller.pointerUp({ x: 640, y: 140 }, VIEW)
    expect(controller.pointerDown({ x: 640, y: 320 }, VIEW)).toMatchObject({
      kind: 'slide-authoring',
      hit: { layerItemId: 'slide-video' },
    })
    controller.pointerUp({ x: 640, y: 320 }, VIEW)
    expect(controller.pointerDown({ x: 120, y: 460 }, VIEW)).toMatchObject({
      kind: 'slide-authoring',
      hit: { layerItemId: 'slide-component', kind: 'component' },
    })
    controller.pointerUp({ x: 120, y: 460 }, VIEW)
    expect(controller.pointerDown({ x: 1000, y: 480 }, VIEW)).toMatchObject({
      kind: 'slide-authoring',
      hit: { layerItemId: 'slide-runtime', kind: 'runtime' },
    })

    const bridge = new EditorPhaserBridge()
    expect(bridge.pointerToSlideWorld({ worldX: 640, worldY: 140 })).toEqual({ x: 640, y: 140 })
    expect(editorPhaserPointerToWorld({ worldX: 12.5, worldY: -3 })).toEqual({ x: 12.5, y: -3 })
  })

  it('lets locked items be selected but rejects transform writes', () => {
    injectCandidate()
    const controller = createSlideWorkspaceAuthoringController()
    const selected = controller.pointerDown({ x: 200, y: 250 }, VIEW)
    if (selected.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(selected.command?.ok).toBe(true)
    expect(selected.targets?.[0]?.layerItemId).toBe('slide-locked')
    expect(selected.hit?.locked).toBe(true)
    expect(selected.hit?.writable).toBe(false)
    controller.pointerUp({ x: 200, y: 250 }, VIEW)

    const written = controller.transformSelection([{
      nodeId: 'slide-locked',
      x: 200,
      y: 240,
      width: 400,
      height: 80,
      rotation: 0,
    }], VIEW)
    if (written.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(written.command?.ok).toBe(false)
    expect(written.command?.reason).toBe(SLIDE_REJECT_LOCKED)
    expect(written.command?.historyEntry).toBe(false)
    expect(nativeFrame('slide-locked')).toMatchObject({ x: 120, y: 220, width: 400, height: 80 })
  })

  it('paints pointermove preview onto SceneNodes without committing the native frame', () => {
    injectCandidate()
    const controller = createSlideWorkspaceAuthoringController()
    controller.pointerDown({ x: 200, y: 150 }, VIEW)
    const moved = controller.pointerMove({ x: 260, y: 190 }, VIEW)
    if (moved.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(moved.preview?.[0]).toMatchObject({
      nodeId: 'slide-title',
      x: 180,
      y: 160,
    })
    const nodes = selectEditingNodes(useEditorStore.getState())
    const painted = mergeSlidePreviewIntoNodes(nodes, moved.preview)
    expect(painted).toHaveLength(1)
    expect(painted[0]).toMatchObject({ id: 'slide-title', x: 180, y: 160 })
    expect(nativeFrame('slide-title')).toMatchObject({ x: 120, y: 120, width: 400, height: 80 })
    expect(mergeSlidePreviewIntoNodes(nodes, undefined)).toEqual([])
  })

  it('transforms global Native layers on global scope without touching scene layerItems and refuses teacher-controller', () => {
    const backend = injectCandidate()
    const controller = createSlideWorkspaceAuthoringController()

    // Switch to global scope
    const scopeResult = backend.setScope('global')
    expect(scopeResult.ok).toBe(true)

    // Select global-banner
    const selectBanner = controller.selectFromLayerIds(['global-banner'], VIEW)
    if (selectBanner.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(selectBanner.command?.ok).toBe(true)
    expect(selectBanner.targets?.[0]?.scope).toBe('global')

    // Initial frames: global-banner is at { x: 40, y: 40, width: 220, height: 80 }
    const initialSceneTitle = nativeFrame('slide-title')

    // Drag global-banner by 20px
    const down = controller.pointerDown({ x: 150, y: 80 }, VIEW)
    expect(down.kind).toBe('slide-authoring')
    const move = controller.pointerMove({ x: 170, y: 100 }, VIEW)
    if (move.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(move.preview?.[0]).toMatchObject({ x: 60, y: 60, width: 220, height: 80 })

    const up = controller.pointerUp({ x: 170, y: 100 }, VIEW)
    if (up.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(up.command?.ok).toBe(true)
    expect(up.command?.historyEntry).toBe(true)

    // Verify globalLayerItems is updated
    const sessionAfterDrag = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    const globalBannerAfterDrag = sessionAfterDrag.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )
    expect(globalBannerAfterDrag?.item.frame).toMatchObject({
      x: 60,
      y: 60,
      width: 220,
      height: 80,
    })

    // Verify scene layerItems are unchanged
    expect(nativeFrame('slide-title')).toEqual(initialSceneTitle)

    // Resize global-banner from east handle
    const east = stageResizeHandleWorldPoint(
      { x: 60, y: 60, width: 220, height: 80 },
      'e',
    )
    controller.pointerDown({ x: east.x, y: east.y }, VIEW)
    controller.pointerMove({ x: east.x + 30, y: east.y }, VIEW)
    const resizeUp = controller.pointerUp({ x: east.x + 30, y: east.y }, VIEW)
    if (resizeUp.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(resizeUp.command?.ok).toBe(true)

    const sessionAfterResize = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    const globalBannerAfterResize = sessionAfterResize.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )
    expect(globalBannerAfterResize?.item.frame).toMatchObject({
      x: 60,
      y: 60,
      width: 250,
      height: 80,
    })

    // Direct transform on teacher-controller must fail wrong-owner
    controller.selectFromLayerIds(['teacher-ctrl'], VIEW)
    const transformController = controller.transformSelection([{
      nodeId: 'teacher-ctrl',
      x: 190,
      y: 600,
      width: 900,
      height: 64,
      rotation: 0,
    }], VIEW)
    if (transformController.kind !== 'slide-authoring') throw new Error('expected V9')
    expect(transformController.command?.ok).toBe(false)
    expect(transformController.command?.reason).toBe(SLIDE_REJECT_WRONG_OWNER)

    // Content update on global text
    const currentBackend = selectSlideAuthoringBackend(useEditorStore.getState())!
    const contentPatchResult = updateSlideNativeLayerContent(
      currentBackend.getSession(),
      'global-banner',
      {
        nativeData: {
          style: {
            bold: true,
          },
        },
      },
    )
    expect(contentPatchResult.ok).toBe(true)
    const sessionAfterContent = contentPatchResult.nextSession!
    const globalBannerAfterContent = sessionAfterContent.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )
    const bannerItem = globalBannerAfterContent?.item
    if (bannerItem?.kind !== 'native' || bannerItem.content.nativeType !== 'text') {
      throw new Error('expected global text banner')
    }
    expect(bannerItem.content.data.style.bold).toBe(true)

    const slideSurface = sessionAfterContent.history.present.surfaces[0]
    if (slideSurface?.type !== 'slide') throw new Error('expected slide surface')
    const sceneText = slideSurface.scenes[0]?.layerItems.find(
      (item) => item.layerItemId === 'slide-title',
    )
    if (sceneText?.kind !== 'native' || sceneText.content.nativeType !== 'text') {
      throw new Error('expected scene text')
    }
    expect(sceneText.content.data.style.bold).toBe(false)
  })
})
