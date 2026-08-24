import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTeacherControllerNode } from '@/renderer/project/createProject'
import {
  constrainTeacherControllerOffset,
  logicalDragDelta,
  runtimeTeacherControllerButtons,
  teacherControllerGestureOutcome,
  teacherControllerHitBounds,
  teacherControllerLocalPointFromClient,
  teacherControllerStagePointerDelta,
  teacherControllerVisibleLocalRect,
} from '@/player/teacherControllerRuntimeSession'
import {
  applyTeacherControllerDomFootprint,
  TeacherControllerDom,
} from '@/player/teacherControllerDom'
import { createTeacherControllerLayout } from '@/shared/teacherControllerLayout'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import {
  clientToWorld,
  createStageViewportTransform,
  worldToClient,
} from '@/renderer/authoring/stageViewportTransform'
import {
  SLIDE_BACKEND_NOT_CANDIDATE,
  SLIDE_REJECT_WRONG_OWNER,
  commitTeacherControllerAuthoringFrame,
  createV9TeacherControllerAuthoringController,
  resolveTeacherControllerAuthoringKind,
} from '@/renderer/authoring/v9TeacherControllerAuthoring'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'

describe('teacher controller runtime session geometry', () => {
  it('distinguishes click, drag, and cancelled pointer completion', () => {
    expect(teacherControllerGestureOutcome(false, false)).toBe('activate')
    expect(teacherControllerGestureOutcome(true, false)).toBe('moved')
    expect(teacherControllerGestureOutcome(false, true)).toBe('cancelled')
  })

  it('converts screen-space pointer movement to the fixed logical canvas', () => {
    expect(logicalDragDelta(
      { x: 100, y: 80 },
      { x: 150, y: 120 },
      { width: 640, height: 360 },
      { width: 1280, height: 720 },
    )).toEqual({ dx: 100, dy: 80 })
  })

  it('keeps the expanded controller inside the canvas and snaps near edges', () => {
    const node = createTeacherControllerNode({ x: 200, y: 100 })
    const constrained = constrainTeacherControllerOffset(
      node,
      { dx: -195, dy: -94 },
      false,
      { width: 1280, height: 720 },
    )

    expect(constrained).toEqual({ dx: -200, dy: -100 })
  })

  it('lets the collapsed pill reach an edge without reserving the hidden panel', () => {
    const node = createTeacherControllerNode({ x: 200, y: 100 })
    const collapse = createTeacherControllerLayout(node, node.width, node.height).collapse
    if (!collapse) throw new Error('fixture controller must be collapsible')

    const constrained = constrainTeacherControllerOffset(
      node,
      { dx: -10_000, dy: 0 },
      true,
      { width: 1280, height: 720 },
    )

    expect(node.x + constrained.dx + collapse.x).toBeCloseTo(0)
  })

  it('shares the rotated visible pill between hit bounds and the DOM footprint', () => {
    const node = createTeacherControllerNode({ x: 200, y: 100 })
    node.rotation = 90
    const visible = teacherControllerVisibleLocalRect(node, true)
    const collapse = createTeacherControllerLayout(node, node.width, node.height).collapse
    expect(visible).toEqual(collapse)

    const bounds = teacherControllerHitBounds(node, { dx: 7, dy: -9 }, true)
    expect(bounds.left).toBeCloseTo(642)
    expect(bounds.top).toBeCloseTo(534.04)
    expect(bounds.right).toBeCloseTo(672)
    expect(bounds.bottom).toBeCloseTo(564.04)

    const footprint = document.createElement('div')
    footprint.style.pointerEvents = 'auto'
    applyTeacherControllerDomFootprint(footprint, node, true)
    expect(footprint.style.clipPath).toMatch(/^inset\(.+ round 999px\)$/)
    expect(footprint.style.pointerEvents).toBe('auto')

    applyTeacherControllerDomFootprint(footprint, node, false)
    expect(footprint.style.clipPath).toBe('none')
    expect(teacherControllerVisibleLocalRect(node, false)).toEqual({
      x: 0,
      y: 0,
      width: node.width,
      height: node.height,
    })
  })

  it('keeps keyboard focus visible inside the collapsed pill clip', () => {
    const node = createTeacherControllerNode({ x: 200, y: 100 })
    const footprint = document.createElement('div')
    const container = document.createElement('div')
    footprint.appendChild(container)
    document.body.appendChild(footprint)
    let session = { offset: { dx: 0, dy: 0 }, collapsed: true }
    const controller = new TeacherControllerDom({
      node,
      container,
      footprintElement: footprint,
      canvas: { width: 1280, height: 720 },
      getRenderedStageBounds: () => ({ width: 1280, height: 720, left: 0, top: 0 }),
      scenes: [],
      getCurrentSceneId: () => null,
      getStateLabel: () => null,
      getStatus: () => ({ muted: false, fullscreen: false }),
      getSession: () => session,
      onSessionChange: (next) => { session = next },
      onAction: () => undefined,
      getInteractive: () => true,
    })

    try {
      const collapse = container.querySelector<HTMLButtonElement>(
        '[data-teacher-controller-collapse="true"]',
      )
      if (!collapse) throw new Error('fixture controller must render a collapse pill')
      expect(footprint.style.clipPath).toMatch(/^inset\(.+ round 999px\)$/)
      expect(collapse.style.boxShadow).toBe('')
      expect(collapse.style.outline).toBe('')

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      collapse.focus()
      expect(document.activeElement).toBe(collapse)
      expect(collapse.matches(':focus-visible')).toBe(true)
      expect(collapse.style.boxShadow).toContain('inset')
      expect(collapse.style.outline).toBe('none')

      collapse.blur()
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      controller.rootElement.focus()
      expect(controller.rootElement.matches(':focus-visible')).toBe(false)
      expect(collapse.style.boxShadow).toBe('')
      expect(collapse.style.outline).toBe('')

      session = { ...session, collapsed: false }
      controller.update(node)
      const expandedCollapse = container.querySelector<HTMLButtonElement>(
        '[data-teacher-controller-collapse="true"]',
      )
      if (!expandedCollapse) throw new Error('expanded fixture must render a collapse button')
      expandedCollapse.focus()
      expect(footprint.style.clipPath).toBe('none')
      expect(expandedCollapse.style.boxShadow).toBe('')
      expect(expandedCollapse.style.outline).toBe('')
    } finally {
      controller.destroy()
      footprint.remove()
    }
  })

  it('constrains the rotated visible bounds instead of only the author frame', () => {
    const node = createTeacherControllerNode({ x: 0, y: 0 })
    node.rotation = 45
    const constrained = constrainTeacherControllerOffset(
      node,
      { dx: -1000, dy: -1000 },
      false,
      { width: 1280, height: 720 },
      false,
    )

    expect(constrained.dx).toBeGreaterThan(-1000)
    expect(constrained.dy).toBeGreaterThan(-1000)
  })

  it('maps pointer deltas from the stage CSS size, not the controller frame', () => {
    const stage = teacherControllerStagePointerDelta(
      { x: 100, y: 80 },
      { x: 140, y: 100 },
      { width: 640, height: 360 },
      { width: 1280, height: 720 },
    )
    const transform = createStageViewportTransform({
      viewport: { x: 0, y: 0, width: 640, height: 360 },
      zoom: 1,
      pan: { x: 0, y: 0 },
    })
    const world = clientDeltaToWorldViaScale(transform.scale, { x: 40, y: 20 })
    expect(stage).toEqual({ dx: 80, dy: 40 })
    expect(world).toEqual({ x: 80, y: 40 })
    const wrongControllerBox = logicalDragDelta(
      { x: 100, y: 80 },
      { x: 140, y: 100 },
      { width: 900, height: 64 },
      { width: 1280, height: 720 },
    )
    expect(wrongControllerBox.dx).not.toBeCloseTo(stage.dx)
  })

  it('converts CSS-scaled frame hits into layout-local coordinates', () => {
    const local = teacherControllerLocalPointFromClient(
      { x: 100, y: 40 },
      { left: 0, top: 0, width: 1800, height: 128 },
      { width: 900, height: 64, rotation: 0 },
    )
    expect(local.x).toBeCloseTo(50)
    expect(local.y).toBeCloseTo(20)
  })

  it('drops authoring-only 定位 and 试运行 buttons from the runtime console', () => {
    expect(runtimeTeacherControllerButtons([
      { id: 'previous', action: { type: 'scene.previous' as const }, label: '上一场景', visible: true },
      { id: 'locate', action: { type: 'scene.go' as const, sceneId: 'scene-1' }, label: '定位', visible: true },
      { id: 'trial', action: { type: 'scene.replay' as const }, label: '试运行', visible: true },
      { id: 'picker', action: { type: 'scene.open-picker' as const }, label: '场景目录', visible: true },
    ]).map((button) => button.id)).toEqual(['previous', 'picker'])
  })
})

const NOW = '2026-08-17T14:54:00.000Z'
const VIEW = {
  viewport: { x: 0, y: 0, width: 1280, height: 720 },
  zoom: 1,
  pan: { x: 0, y: 0 },
}

function clientDeltaToWorldViaScale(
  scale: number,
  delta: { x: number; y: number },
): { x: number; y: number } {
  return { x: delta.x / scale, y: delta.y / scale }
}

function controllerButtons() {
  return [
    { id: 'previous', action: { type: 'scene.previous' as const }, label: '上一场景', visible: true },
    { id: 'next', action: { type: 'scene.next' as const }, label: '下一场景', visible: true },
    { id: 'picker', action: { type: 'scene.open-picker' as const }, label: '场景目录', visible: true },
    { id: 'replay', action: { type: 'scene.replay' as const }, label: '重播', visible: true },
    { id: 'sound', action: { type: 'audio.toggle-mute' as const }, label: '声音', visible: true },
    { id: 'fullscreen', action: { type: 'player.fullscreen.toggle' as const }, label: '全屏', visible: true },
  ]
}

function globalController(
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'frame' | 'rotation'>> = {},
): NativeLayerItem {
  return {
    layerItemId: 'global-teacher-controller',
    label: '教师控制器',
    frame: extra.frame ?? { mode: 'absolute', x: 190, y: 638, width: 900, height: 64 },
    order: 80,
    visible: true,
    locked: extra.locked ?? false,
    rotation: extra.rotation ?? 0,
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
        buttons: controllerButtons(),
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

function scoped(item: NativeLayerItem): ScopedLayerItem {
  return { item, visibility: { mode: 'all', locationIds: [] } }
}

function nativeText(layerItemId: string, order: number): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
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
        text: layerItemId,
        runs: [],
        style: {
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
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

function v9ControllerFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r3c-controller',
    revision: 1,
    title: 'R3-C controller',
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
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [scoped(globalController())],
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
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [nativeText('slide-title', 1)],
        interactions: [],
      }],
    }],
  })
}

function injectCandidate(project = v9ControllerFixture()) {
  const session = openSlideAuthoringSession(project)
  const backend = createSlideAuthoringBackend(session)
  useEditorStore.getState().injectV9SlideCandidateBackend(backend)
  return backend
}

function controllerFrame() {
  const document = selectSlideAuthoringBackend(useEditorStore.getState())
    ?.getSession().history.present
  const item = document?.globalLayerItems.find(
    (entry) => entry.item.layerItemId === 'global-teacher-controller',
  )?.item
  if (!item || item.kind !== 'native') throw new Error('missing global controller')
  return { ...item.frame, rotation: item.rotation, revision: document!.revision }
}

describe('v9 teacher controller authoring bridge', () => {
  beforeEach(() => {
    useEditorStore.getState().clearV9SlideCandidateBackend()
  })

  afterEach(() => {
    useEditorStore.getState().clearV9SlideCandidateBackend()
  })

  it('leaves the default V8 path when no candidate is injected', () => {
    useEditorStore.setState({ slideBackend: undefined as any })
    const controller = createV9TeacherControllerAuthoringController()
    expect(resolveTeacherControllerAuthoringKind()).toBe('v8')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).toBeNull()
    const down = controller.pointerDown({ x: 640, y: 670 }, VIEW)
    const move = controller.pointerMove({ x: 700, y: 680 }, VIEW)
    const up = controller.pointerUp({ x: 700, y: 680 }, VIEW)
    expect(down).toEqual({ kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE })
    expect(move).toEqual({ kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE })
    expect(up).toEqual({ kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE })
    expect('command' in down ? down.command?.ok : false).toBe(false)
  })

  it('previews move/resize on pointermove and commits one history entry on pointerup', () => {
    injectCandidate()
    useEditorStore.getState().setEditingScope('global')
    const controller = createV9TeacherControllerAuthoringController()
    const start = controller.pointerDown({ x: 640, y: 670 }, VIEW)
    if (start.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(start.inert).toBe(true)
    expect(start.source).toBe('global')
    expect(start.command).toBeUndefined()
    expect(start.target?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r3c-controller',
      scope: 'global',
      carrier: 'native',
      layerItemId: 'global-teacher-controller',
      field: 'item',
    }))
    expect(start.target?.authoringAddress).not.toMatch(/hit/i)
    expect(JSON.stringify(start.target)).not.toMatch(/hitId/)

    const moved = controller.pointerMove({ x: 700, y: 690 }, VIEW)
    if (moved.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(moved.preview).toEqual({ x: 250, y: 658, width: 900, height: 64 })
    expect(moved.overlay?.selectionBox).toEqual({
      x: 250,
      y: 658,
      width: 900,
      height: 64,
    })
    expect(controllerFrame().revision).toBe(1)
    expect(controllerFrame()).toMatchObject({ x: 190, y: 638, width: 900, height: 64 })

    const committed = controller.pointerUp({ x: 700, y: 690 }, VIEW)
    if (committed.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(committed.command?.ok).toBe(true)
    expect(committed.command?.historyEntry).toBe(true)
    expect(controllerFrame()).toMatchObject({
      x: 250,
      y: 658,
      width: 900,
      height: 64,
      revision: 2,
    })
  })

  it('resizes west by moving origin through the same viewport transform', () => {
    injectCandidate()
    useEditorStore.getState().setEditingScope('global')
    const controller = createV9TeacherControllerAuthoringController()
    const transform = createStageViewportTransform(VIEW)
    const west = worldToClient(transform, { x: 190, y: 670 })
    controller.pointerDown({ x: west.x, y: west.y }, VIEW)
    const dragged = { x: west.x - 40, y: west.y }
    expect(clientToWorld(transform, dragged).x).toBeCloseTo(150)
    const preview = controller.pointerMove(dragged, VIEW)
    if (preview.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(preview.preview).toEqual({ x: 150, y: 638, width: 940, height: 64 })
    expect(controllerFrame().revision).toBe(1)
    const committed = controller.pointerUp(dragged, VIEW)
    if (committed.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(committed.command?.historyEntry).toBe(true)
    expect(controllerFrame()).toMatchObject({ x: 150, y: 638, width: 940, height: 64 })
  })

  it('ignores pointerDown when editing scope is scene', () => {
    injectCandidate()
    useEditorStore.getState().setEditingScope('scene')
    const controller = createV9TeacherControllerAuthoringController()
    const start = controller.pointerDown({ x: 640, y: 670 }, VIEW)
    if (start.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(start.target).toBeUndefined()
    expect(start.preview).toBeUndefined()

    // Move and up should be no-ops
    const moved = controller.pointerMove({ x: 700, y: 690 }, VIEW)
    if (moved.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(moved.preview).toBeUndefined()
    expect(controllerFrame().revision).toBe(1)

    const up = controller.pointerUp({ x: 700, y: 690 }, VIEW)
    if (up.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(up.command).toBeUndefined()
    expect(controllerFrame().revision).toBe(1)
  })

  it('refuses to treat a scene-owned controller as a transform target', () => {
    const project = v9ControllerFixture()
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const sceneController = globalController({
      frame: { mode: 'absolute', x: 10, y: 10, width: 200, height: 40 },
    })
    sceneController.layerItemId = 'scene-teacher-controller'
    sceneController.order = 3
    surface.scenes[0]!.layerItems.push(sceneController)
    const session = openSlideAuthoringSession(project)
    const result = commitTeacherControllerAuthoringFrame(session, {
      layerItemId: 'scene-teacher-controller',
      frame: { x: 10, y: 10, width: 200, height: 40 },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe(SLIDE_REJECT_WRONG_OWNER)
    expect(result.historyEntry).toBe(false)
    expect(session.history.present.revision).toBe(1)
  })
})
