import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type ComponentLayerItem,
  type CourseProjectDocument,
  type NativeLayerItem,
  type RuntimeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createFormulaNode, createTeacherControllerNode } from '@/renderer/project/createProject'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import { openSpatialAuthoringSession } from '@/renderer/course/spatialEditorCommands'
import {
  CONTROLLER_MOVE_REASON,
  SPATIAL_CROSS_COORDINATE_MOVE_REASON,
} from '@/renderer/course/effectiveLayerCommands'
import { CROSS_GLOBAL_PLANE_REORDER_REASON } from '@/renderer/course/globalLayerCommands'
import { SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON } from '@/renderer/course/v9SlideActionCommands'
import {
  rowsForListKind,
} from '@/renderer/course/effectiveLayerProjection'
import {
  createV9TeacherControllerAuthoringController,
  teacherControllerPropertiesPreview,
} from '@/renderer/authoring/v9TeacherControllerAuthoring'
import {
  clientToWorld,
  createStageViewportTransform,
  worldToClient,
} from '@/renderer/authoring/stageViewportTransform'
import {
  selectEffectiveLayerProjection,
  selectSlideBackendKind,
  selectSlideAuthoringBackend,
  selectSlideAuthoringDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import type { EffectiveLayerProjectionRow } from '@/renderer/course/effectiveLayerProjection'
import {
  groupedVisualRows,
  isCrossGlobalPlaneDrop,
  isForeignTeacherControllerDrop,
  isRejectedSpatialOwnerDrop,
  NodesTab,
} from '@/renderer/ui/NodesTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { createSlideWorkspaceAuthoringController } from '@/renderer/ui/workspaceSlideAuthoring'

/**
 * Proves R3-Z wiring of effective-layer display/write and controller authoring
 * on the real V8 NodesTab / PropertiesTab. Does not prove a live Electron window.
 */
const NOW = '2026-08-17T15:00:00.000Z'
const VIEW = {
  viewport: { x: 0, y: 0, width: 1280, height: 720 },
  zoom: 1,
  pan: { x: 0, y: 0 },
}

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
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
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
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function globalRuntime(
  layerItemId: string,
  order: number,
  bindTo: string,
): RuntimeLayerItem {
  return {
    layerItemId,
    label: '全课 Runtime',
    frame: { mode: 'absolute', x: 360, y: 80, width: 320, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 0.85,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'hidden',
    kind: 'runtime',
    runtime: {
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
      content: { values: { label: 'canonical-only' } },
      assets: {},
      nodeBindings: { target: bindTo },
    },
  }
}

function globalComponent(layerItemId: string, order: number): ComponentLayerItem {
  return {
    layerItemId,
    label: '全课组件',
    frame: { mode: 'absolute', x: 720, y: 80, width: 260, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 0.9,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'component',
    component: { packageId: 'component.quiz', version: '4.0.0' },
    props: { prompt: 'canonical component', nested: { answer: 42 } },
  }
}

function scoped(
  item: NativeLayerItem,
  visibility: ScopedLayerItem['visibility'] = { mode: 'all', locationIds: [] },
): ScopedLayerItem {
  return { item, visibility }
}

function v9ThreeLocationFixture(): CourseProjectDocument {
  const controller = sceneNodeToCourseLayerItem(
    createTeacherControllerNode({ id: 'teacher-controller-main' }),
    90,
  )
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r3z-layers',
    revision: 1,
    title: 'R3-Z layers',
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
    globalLayerItems: [
      scoped(nativeText('global-banner', 0, '全课横幅')),
      scoped(controller as NativeLayerItem),
    ],
    globalInteractions: [],
    locations: [
      {
        id: 'location-scene-1',
        label: '场景 1',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
      },
      {
        id: 'location-scene-2',
        label: '场景 2',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-2',
      },
      {
        id: 'location-scene-3',
        label: '场景 3',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-3',
      },
    ],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [
        {
          id: 'scene-1',
          name: '场景 1',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title', 20, '本页标题')],
          interactions: [],
        },
        {
          id: 'scene-2',
          name: '场景 2',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title-2', 20, '第二页标题')],
          interactions: [],
        },
        {
          id: 'scene-3',
          name: '场景 3',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title-3', 20, '第三页标题')],
          interactions: [],
        },
      ],
    }],
  })
}

function injectCandidate(project = v9ThreeLocationFixture()) {
  const backend = createSlideAuthoringBackend(openSlideAuthoringSession(project))
  useEditorStore.getState().injectV9SlideCandidateBackend(backend)
  return backend
}

function visualRow(
  id: string,
  owner: EffectiveLayerProjectionRow['owner'],
  options: {
    isTeacherController?: boolean
    ownerKey?: string
    globalPlane?: 'underlay' | 'overlay'
  } = {},
): EffectiveLayerProjectionRow {
  const ownerKey = options.ownerKey ?? owner
  const globalPlane = owner === 'global' ? options.globalPlane ?? 'overlay' : null
  return {
    id,
    owner,
    ownerKey,
    reorderGroupKey: globalPlane ? `${ownerKey}:${globalPlane}` : ownerKey,
    globalPlane,
    stackOrder: 0,
    isTeacherController: Boolean(options.isTeacherController),
    item: nativeText(id, 0, id),
  } as EffectiveLayerProjectionRow
}

function injectSpatialOwnerFixture(): {
  globalId: string
  surfaceId: string
  surfaceItemId: string
  worldItemIds: readonly [string, string]
} {
  useEditorStore.getState().createNewSpatialProject()
  const initial = useEditorStore.getState().spatialSession
  if (!initial) throw new Error('expected Spatial session')
  const project = structuredClone(initial.history.present)
  const surface = project.surfaces.find(
    (candidate) => candidate.id === initial.selection.surfaceId,
  )
  if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
  const globalId = 'spatial-global-text'
  const surfaceItemId = 'spatial-surface-text'
  const worldItemIds = ['spatial-world-a', 'spatial-world-b'] as const
  project.globalLayerItems.push(scoped(nativeText(globalId, 100_001, '视口说明')))
  surface.surfaceLayerItems.push(scoped(nativeText(surfaceItemId, 100_002, '本页说明')))
  surface.world.layerItems.push(
    nativeText(worldItemIds[0], 100_003, '世界 A'),
    nativeText(worldItemIds[1], 100_004, '世界 B'),
  )
  useEditorStore.getState().applySpatialAuthoringSession(openSpatialAuthoringSession(project, {
    locationId: initial.selection.locationId,
  }))
  return { globalId, surfaceId: surface.id, surfaceItemId, worldItemIds }
}

function v9WithMisplacedControllerCopies(): CourseProjectDocument {
  const project = structuredClone(v9ThreeLocationFixture())
  const controller = project.globalLayerItems.find(
    (entry) => entry.item.layerItemId === 'teacher-controller-main',
  )?.item
  if (!controller || controller.kind !== 'native') throw new Error('missing global controller')
  const slide = project.surfaces[0]
  if (!slide || slide.type !== 'slide') throw new Error('expected slide')
  slide.surfaceLayerItems = [
    scoped(nativeText('page-shared', 4, '本页共享')),
    scoped({
      ...structuredClone(controller),
      layerItemId: 'teacher-controller-surface-copy',
      label: '本页控制器副本',
      order: 5,
    }),
  ]
  slide.scenes[0] = {
    ...slide.scenes[0]!,
    layerItems: [
      ...slide.scenes[0]!.layerItems,
      {
        ...structuredClone(controller),
        layerItemId: 'teacher-controller-scene-copy',
        label: '场景控制器副本',
        order: 21,
      },
    ],
  }
  return courseProjectDocumentSchema.parse(project)
}

function layerGroupNodeIds(
  groupId: 'global-overlay' | 'global-underlay' | 'surface' | 'scene' | 'world',
): string[] {
  return [...screen.getByTestId(`nodes-layer-group-${groupId}`)
    .querySelectorAll('[data-testid^="node-item-"]')]
    .flatMap((element) => {
      const id = element.getAttribute('data-testid')
      return id ? [id.replace('node-item-', '')] : []
    })
}

function controllerFrame() {
  const document = selectSlideAuthoringDocument(useEditorStore.getState())
  const item = document?.globalLayerItems.find(
    (entry) => entry.item.layerItemId === 'teacher-controller-main',
  )?.item
  if (!item || item.kind !== 'native') throw new Error('missing global controller')
  return { ...item.frame, rotation: item.rotation, revision: document!.revision }
}

beforeEach(() => {
  useEditorStore.getState().clearV9SlideCandidateBackend()
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('V9 global layer UI adapter on the real V8 Nodes/Properties', () => {
  it('defaults the store backend to V9 and paints candidate source labels', () => {
    expect(selectSlideBackendKind(useEditorStore.getState())).toBe('slide-authoring')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).not.toBeNull()
    useEditorStore.getState().setEditingScope('global')
    render(<NodesTab />)
    expect(screen.getByTestId('nodes-tab')).toBeTruthy()
    expect(screen.getByText('有效图层')).toBeTruthy()
    expect(
      [...document.querySelectorAll('[data-testid^="node-source-"]')]
        .some((element) => element.textContent?.includes('全课')),
    ).toBe(true)
  })

  it('shows unified effective-layer source labels and keeps scene-only free of a fake controller', () => {
    injectCandidate()
    const projection = selectEffectiveLayerProjection(useEditorStore.getState())
    expect(projection).not.toBeNull()
    expect(rowsForListKind(projection!, 'scene-only').some((row) => row.isTeacherController)).toBe(false)
    expect(projection!.unifiedRows.some((row) => row.id === 'teacher-controller-main' && row.source === 'global')).toBe(true)

    const { rerender } = render(<NodesTab />)
    expect(screen.getByText('有效图层')).toBeTruthy()
    // Under default scene scope, teacher-controller is filtered out of the rendered layer tree
    expect(screen.queryByTestId('node-item-teacher-controller-main')).toBeNull()
    expect(screen.queryByTestId('node-source-teacher-controller-main')).toBeNull()
    // Legacy banner resolves below the controller and remains visible in Underlay.
    expect(screen.getByTestId('nodes-layer-group-global-underlay')).toBeTruthy()
    expect(layerGroupNodeIds('global-underlay')).toEqual(['global-banner'])
    expect(screen.getByTestId('nodes-layer-group-scene')).toBeTruthy()
    expect(layerGroupNodeIds('scene')).toEqual(['slide-title'])
    expect(
      screen.getByTestId('nodes-layer-group-scene')
        .querySelector('.node-type-icon[title="teacher-controller"]'),
    ).toBeNull()
    expect(screen.getByTestId('node-source-slide-title').textContent).toContain('本页')
    expect(screen.getByTestId('node-source-global-banner').textContent).toContain('全课')

    // After switching to global scope, the controller is visible only in Overlay.
    useEditorStore.getState().setEditingScope('global')
    rerender(<NodesTab />)
    expect(screen.getByTestId('nodes-layer-group-global-overlay')).toBeTruthy()
    expect(layerGroupNodeIds('global-overlay')).toEqual(['teacher-controller-main'])
    expect(layerGroupNodeIds('global-underlay')).toEqual(['global-banner'])
    expect(screen.getByTestId('node-source-teacher-controller-main').textContent).toContain('全课')
    expect(screen.getByTestId('node-source-teacher-controller-main').textContent).toContain('不可下沉')
    expect(document.querySelectorAll('.node-type-icon[title="teacher-controller"]')).toHaveLength(1)
  })

  it('selects and edits a Slide surface row through its own stable owner scope', () => {
    const project = structuredClone(v9ThreeLocationFixture())
    const surface = project.surfaces.find((candidate) => candidate.id === 'surface-slide')
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
    const surfaceItemId = 'slide-surface-note'
    surface.surfaceLayerItems.push(scoped(nativeText(surfaceItemId, 30, '表面说明')))
    injectCandidate(project)

    const before = selectEffectiveLayerProjection(useEditorStore.getState())!
    const row = before.unifiedRows.find((candidate) => candidate.id === surfaceItemId)!
    expect(row).toMatchObject({ owner: 'surface', ownerKey: 'surface:surface-slide' })
    const address = row.authoringAddress

    useEditorStore.getState().selectNode(surfaceItemId)

    const selectedBackend = selectSlideAuthoringBackend(useEditorStore.getState())!
    expect(selectedBackend.getSession().scope).toBe('surface')
    expect(selectedBackend.getSession().selection.selectionIds).toEqual([surfaceItemId])
    const canvasSelection = createSlideWorkspaceAuthoringController()
      .selectFromLayerIds([surfaceItemId], VIEW)
    if (canvasSelection.kind !== 'slide-authoring') throw new Error('expected V9 canvas')
    expect(canvasSelection.targets?.[0]?.authoringAddress).toBe(address)

    const beforeEdit = selectedBackend.getSession()
    useEditorStore.getState().updateNode(surfaceItemId, { name: '更新后的表面说明' })
    const afterEdit = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(afterEdit.history.past).toHaveLength(beforeEdit.history.past.length + 1)
    expect(afterEdit.history.present.surfaces.find((candidate) => candidate.id === 'surface-slide'))
      .toMatchObject({
        surfaceLayerItems: [expect.objectContaining({
          item: expect.objectContaining({
            layerItemId: surfaceItemId,
            label: '更新后的表面说明',
          }),
        })],
      })

    useEditorStore.getState().undo()
    expect(selectSlideAuthoringBackend(useEditorStore.getState())!.getSession().history.present.surfaces
      .find((candidate) => candidate.id === 'surface-slide'))
      .toMatchObject({
        surfaceLayerItems: [expect.objectContaining({
          item: expect.objectContaining({
            layerItemId: surfaceItemId,
            label: '表面说明',
          }),
        })],
      })
  })

  it('writes a surface row base item under a named state with one undoable commit', () => {
    const project = structuredClone(v9ThreeLocationFixture())
    const surface = project.surfaces.find((candidate) => candidate.id === 'surface-slide')
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
    const surfaceItemId = 'slide-surface-note'
    surface.surfaceLayerItems.push(scoped(nativeText(surfaceItemId, 30, '表面说明')))
    const scene = surface.scenes.find((candidate) => candidate.id === 'scene-1')!
    scene.presentation = {
      initialStateId: 'state-initial',
      states: [
        { id: 'state-initial', name: '初始', layerItemOverrides: {} },
        { id: 'state-explain', name: '讲解', layerItemOverrides: {} },
      ],
    }
    injectCandidate(project)

    useEditorStore.getState().setActivePresentationState('state-explain')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())!.getSession().selection.stateId)
      .toBe('state-explain')

    const row = selectEffectiveLayerProjection(useEditorStore.getState())!
      .unifiedRows.find((candidate) => candidate.id === surfaceItemId)!
    expect(row).toMatchObject({ owner: 'surface', ownerKey: 'surface:surface-slide' })
    expect(row.scopeToken.stateId).toBe('state-explain')
    const address = row.authoringAddress

    useEditorStore.getState().selectNode(surfaceItemId)
    const selectedBackend = selectSlideAuthoringBackend(useEditorStore.getState())!
    expect(selectedBackend.getSession().scope).toBe('surface')
    expect(selectedBackend.getSession().selection.stateId).toBe('state-explain')
    const canvasSelection = createSlideWorkspaceAuthoringController()
      .selectFromLayerIds([surfaceItemId], VIEW)
    if (canvasSelection.kind !== 'slide-authoring') throw new Error('expected V9 canvas')
    expect(canvasSelection.targets?.[0]?.authoringAddress).toBe(address)
    expect(selectEffectiveLayerProjection(useEditorStore.getState())!.scope.owner).toBe('surface')

    const beforeEdit = selectedBackend.getSession()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.queryByText('状态：讲解')).toBeNull()
    expect(screen.getByTestId('slide-surface-base-editing-notice').textContent)
      .toContain('不会创建命名状态覆盖')
    expect(screen.queryByTestId('simple-entrance-animation')).toBeNull()
    const nameInput = screen.getByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: '命名状态下的表面说明' } })
    fireEvent.blur(nameInput)
    const afterEdit = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(afterEdit.history.past).toHaveLength(beforeEdit.history.past.length + 1)
    const editedSurface = afterEdit.history.present.surfaces
      .find((candidate) => candidate.id === 'surface-slide')
    if (!editedSurface || editedSurface.type !== 'slide') throw new Error('expected Slide surface')
    expect(editedSurface.surfaceLayerItems[0]!.item).toMatchObject({
      layerItemId: surfaceItemId,
      label: '命名状态下的表面说明',
      frame: expect.objectContaining({ x: 40 }),
    })
    // No named-state override is materialized for a surface-owned item.
    const editedScene = editedSurface.scenes.find((candidate) => candidate.id === 'scene-1')!
    expect(editedScene.presentation?.states.every(
      (state) => !('slide-surface-note' in state.layerItemOverrides),
    )).toBe(true)
    expect(editedScene.layerItems.find((item) => item.layerItemId === 'slide-title'))
      .toMatchObject({ label: '本页标题' })
    expect(afterEdit.history.present.globalLayerItems.map((entry) => entry.item.layerItemId))
      .toEqual(['global-banner', 'teacher-controller-main'])

    useEditorStore.getState().undo()
    const undone = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(undone.scope).toBe('surface')
    expect(undone.selection.stateId).toBe('state-explain')
    const undoneSurface = undone.history.present.surfaces
      .find((candidate) => candidate.id === 'surface-slide')
    if (!undoneSurface || undoneSurface.type !== 'slide') throw new Error('expected Slide surface')
    expect(undoneSurface.surfaceLayerItems[0]!.item).toMatchObject({
      layerItemId: surfaceItemId,
      label: '表面说明',
      frame: expect.objectContaining({ x: 40 }),
    })

    useEditorStore.getState().redo()
    const redone = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    const redoneSurface = redone.history.present.surfaces
      .find((candidate) => candidate.id === 'surface-slide')
    if (!redoneSurface || redoneSurface.type !== 'slide') throw new Error('expected Slide surface')
    expect(redoneSurface.surfaceLayerItems[0]!.item).toMatchObject({
      layerItemId: surfaceItemId,
      label: '命名状态下的表面说明',
    })

    act(() => useEditorStore.getState().selectNode(null))
    expect(screen.getByTestId('slide-surface-properties-context')).toBeTruthy()
    expect(screen.queryByLabelText('场景名称')).toBeNull()
  })

  it('commits visible surface Formula content controls to the base item', () => {
    const project = structuredClone(v9ThreeLocationFixture())
    const surface = project.surfaces.find((candidate) => candidate.id === 'surface-slide')
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
    const surfaceItemId = 'slide-surface-formula'
    surface.surfaceLayerItems.push(scoped(sceneNodeToCourseLayerItem(createFormulaNode({
      id: surfaceItemId,
      name: '共享公式',
      accessibleText: '原始描述',
    }), 31) as NativeLayerItem))
    const scene = surface.scenes.find((candidate) => candidate.id === 'scene-1')!
    scene.presentation = {
      initialStateId: 'state-initial',
      states: [
        { id: 'state-initial', name: '初始', layerItemOverrides: {} },
        { id: 'state-explain', name: '讲解', layerItemOverrides: {} },
      ],
    }
    injectCandidate(project)
    useEditorStore.getState().setActivePresentationState('state-explain')
    useEditorStore.getState().selectNode(surfaceItemId)

    const beforeEdit = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.getByTestId('formula-properties')).toBeTruthy()
    expect(screen.queryByText('状态：讲解')).toBeNull()
    expect(screen.getByTestId('slide-surface-base-editing-notice')).toBeTruthy()
    const accessibleText = screen.getByLabelText('无障碍描述')
    fireEvent.change(accessibleText, { target: { value: '命名状态下更新的共享公式' } })
    fireEvent.blur(accessibleText)

    const afterEdit = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(afterEdit.history.past).toHaveLength(beforeEdit.history.past.length + 1)
    const editedSurface = afterEdit.history.present.surfaces
      .find((candidate) => candidate.id === 'surface-slide')
    if (!editedSurface || editedSurface.type !== 'slide') throw new Error('expected Slide surface')
    const edited = editedSurface.surfaceLayerItems
      .find((entry) => entry.item.layerItemId === surfaceItemId)?.item
    expect(edited?.kind).toBe('native')
    if (!edited || edited.kind !== 'native' || edited.content.nativeType !== 'formula') {
      throw new Error('expected surface Formula')
    }
    expect(edited.content.data.accessibleText).toBe('命名状态下更新的共享公式')
    expect(editedSurface.scenes.find((candidate) => candidate.id === 'scene-1')
      ?.presentation?.states.every((state) => !(surfaceItemId in state.layerItemOverrides)))
      .toBe(true)

    useEditorStore.getState().undo()
    const undoneSurface = selectSlideAuthoringBackend(useEditorStore.getState())!
      .getSession().history.present.surfaces
      .find((candidate) => candidate.id === 'surface-slide')
    if (!undoneSurface || undoneSurface.type !== 'slide') throw new Error('expected Slide surface')
    const undone = undoneSurface.surfaceLayerItems
      .find((entry) => entry.item.layerItemId === surfaceItemId)?.item
    if (!undone || undone.kind !== 'native' || undone.content.nativeType !== 'formula') {
      throw new Error('expected surface Formula')
    }
    expect(undone.content.data.accessibleText).toBe('原始描述')

    useEditorStore.getState().redo()
    const redoneSurface = selectSlideAuthoringBackend(useEditorStore.getState())!
      .getSession().history.present.surfaces
      .find((candidate) => candidate.id === 'surface-slide')
    if (!redoneSurface || redoneSurface.type !== 'slide') throw new Error('expected Slide surface')
    const redone = redoneSurface.surfaceLayerItems
      .find((entry) => entry.item.layerItemId === surfaceItemId)?.item
    if (!redone || redone.kind !== 'native' || redone.content.nativeType !== 'formula') {
      throw new Error('expected surface Formula')
    }
    expect(redone.content.data.accessibleText).toBe('命名状态下更新的共享公式')
  })

  it('groupedVisualRows splits global planes and keeps one controller only in Overlay', () => {
    const globalController = visualRow('teacher-controller-main', 'global', {
      isTeacherController: true,
      ownerKey: 'global',
    })
    const groups = groupedVisualRows([
      visualRow('slide-title', 'scene', { ownerKey: 'scene:scene-1' }),
      visualRow('teacher-controller-scene-copy', 'scene', {
        isTeacherController: true,
        ownerKey: 'scene:scene-1',
      }),
      visualRow('page-shared', 'surface', { ownerKey: 'surface:surface-slide' }),
      visualRow('teacher-controller-surface-copy', 'surface', {
        isTeacherController: true,
        ownerKey: 'surface:surface-slide',
      }),
      visualRow('world-shape', 'world', { ownerKey: 'world:surface-spatial' }),
      visualRow('teacher-controller-world-copy', 'world', {
        isTeacherController: true,
        ownerKey: 'world:surface-spatial',
      }),
      visualRow('global-banner', 'global', { ownerKey: 'global' }),
      visualRow('global-background', 'global', {
        ownerKey: 'global',
        globalPlane: 'underlay',
      }),
      globalController,
    ])
    expect(groups.map((group) => group.id)).toEqual([
      'global-overlay',
      'surface',
      'scene',
      'world',
      'global-underlay',
    ])
    expect(groups.find((group) => group.id === 'global-overlay')?.rows.map((row) => row.id))
      .toEqual(['global-banner', 'teacher-controller-main'])
    expect(groups.find((group) => group.id === 'global-underlay')?.rows.map((row) => row.id))
      .toEqual(['global-background'])
    expect(groups.find((group) => group.id === 'surface')?.rows.map((row) => row.id))
      .toEqual(['page-shared'])
    expect(groups.find((group) => group.id === 'scene')?.rows.map((row) => row.id))
      .toEqual(['slide-title'])
    expect(groups.find((group) => group.id === 'world')?.rows.map((row) => row.id))
      .toEqual(['world-shape'])
    expect(groups.flatMap((group) => group.rows).filter((row) => row.isTeacherController))
      .toEqual([globalController])
  })

  it('groupedVisualRows can list a stray world controller only under global Overlay', () => {
    const groups = groupedVisualRows([
      visualRow('world-shape', 'world', { ownerKey: 'world:surface-spatial' }),
      visualRow('teacher-controller-main', 'world', {
        isTeacherController: true,
        ownerKey: 'world:surface-spatial',
      }),
    ])
    expect(groups.find((group) => group.id === 'world')?.rows.map((row) => row.id))
      .toEqual(['world-shape'])
    expect(groups.find((group) => group.id === 'global-overlay')?.rows.map((row) => row.id))
      .toEqual(['teacher-controller-main'])
  })

  it('isForeignTeacherControllerDrop refuses any non-global owner', () => {
    const controller = {
      ...visualRow('teacher-controller-main', 'global', {
        isTeacherController: true,
        ownerKey: 'global',
      }),
      item: sceneNodeToCourseLayerItem(
        createTeacherControllerNode({ id: 'teacher-controller-main' }),
        100_000,
      ),
    }
    const banner = visualRow('global-banner', 'global', { ownerKey: 'global' })
    const scene = visualRow('slide-title', 'scene', { ownerKey: 'scene:scene-1' })
    const sceneController = visualRow('teacher-controller-scene-copy', 'scene', {
      isTeacherController: true,
      ownerKey: 'scene:scene-1',
    })
    expect(isForeignTeacherControllerDrop(controller, banner)).toBe(false)
    expect(isForeignTeacherControllerDrop(banner, controller)).toBe(false)
    expect(isForeignTeacherControllerDrop(controller, scene)).toBe(true)
    expect(isForeignTeacherControllerDrop(scene, controller)).toBe(true)
    expect(isForeignTeacherControllerDrop(sceneController, scene)).toBe(true)
    expect(isForeignTeacherControllerDrop(scene, banner)).toBe(false)
    const underlay = visualRow('global-underlay', 'global', {
      ownerKey: 'global',
      globalPlane: 'underlay',
    })
    expect(isCrossGlobalPlaneDrop(controller, underlay)).toBe(true)
    expect(isCrossGlobalPlaneDrop(banner, controller)).toBe(false)
    expect(isCrossGlobalPlaneDrop(scene, underlay)).toBe(false)
  })

  it('classifies only unsafe Spatial owner drops while retaining safe owner operations', () => {
    const global = visualRow('global-note', 'global', { ownerKey: 'global' })
    const surface = visualRow('surface-note', 'surface', {
      ownerKey: 'surface:surface-spatial',
    })
    const world = visualRow('world-note', 'world', {
      ownerKey: 'world:surface-spatial',
    })
    const controller = visualRow('teacher-controller-main', 'global', {
      isTeacherController: true,
      ownerKey: 'global',
    })
    expect(isRejectedSpatialOwnerDrop('spatial-2d', global, world)).toBe(true)
    expect(isRejectedSpatialOwnerDrop('spatial-2d', world, global)).toBe(true)
    expect(isRejectedSpatialOwnerDrop('spatial-2d', controller, world)).toBe(true)
    expect(isRejectedSpatialOwnerDrop('spatial-2d', surface, world)).toBe(false)
    expect(isRejectedSpatialOwnerDrop('spatial-2d', world, world)).toBe(false)
    expect(isRejectedSpatialOwnerDrop('slide', global, world)).toBe(false)
  })

  it('shows the Spatial move boundary, keeps rejected drops at zero writes, and preserves safe history', () => {
    const { globalId, surfaceId, surfaceItemId, worldItemIds } = injectSpatialOwnerFixture()
    render(<NodesTab />)
    expect(screen.getByTestId('spatial-layer-move-note').textContent)
      .toContain(SPATIAL_CROSS_COORDINATE_MOVE_REASON)

    useEditorStore.getState().selectNode(globalId)
    const beforeGlobalMove = useEditorStore.getState().spatialSession!
    const beforeGlobalDocument = JSON.stringify(beforeGlobalMove.history.present)
    useEditorStore.getState().moveCandidateLayerOwner(globalId, worldItemIds[0])
    const afterGlobalMove = useEditorStore.getState()
    expect(afterGlobalMove.errorMessage).toBe('操作未完成。请重新选择目标后再试。')
    expect(afterGlobalMove.statusMessage).toBeNull()
    expect(afterGlobalMove.spatialSession).toBe(beforeGlobalMove)
    expect(JSON.stringify(afterGlobalMove.spatialSession!.history.present)).toBe(beforeGlobalDocument)
    expect(afterGlobalMove.spatialSession!.history.past).toHaveLength(beforeGlobalMove.history.past.length)
    expect(afterGlobalMove.spatialSession!.selection).toEqual(beforeGlobalMove.selection)

    useEditorStore.getState().selectNode(worldItemIds[0])
    const beforeWorldMove = useEditorStore.getState().spatialSession!
    useEditorStore.getState().moveCandidateLayerOwner(worldItemIds[0], globalId)
    const afterWorldMove = useEditorStore.getState()
    expect(afterWorldMove.errorMessage).toBe('操作未完成。请重新选择目标后再试。')
    expect(afterWorldMove.spatialSession).toBe(beforeWorldMove)
    expect(afterWorldMove.spatialSession!.history.present.revision)
      .toBe(beforeWorldMove.history.present.revision)
    expect(afterWorldMove.spatialSession!.history.past).toHaveLength(beforeWorldMove.history.past.length)
    expect(afterWorldMove.spatialSession!.selection).toEqual(beforeWorldMove.selection)

    useEditorStore.getState().selectNode(surfaceItemId)
    const beforeSafeMove = useEditorStore.getState().spatialSession!
    useEditorStore.getState().moveCandidateLayerOwner(surfaceItemId, worldItemIds[0])
    const afterSafeMove = useEditorStore.getState().spatialSession!
    expect(afterSafeMove.history.present.revision).toBe(beforeSafeMove.history.present.revision + 1)
    expect(afterSafeMove.history.past).toHaveLength(beforeSafeMove.history.past.length + 1)
    const movedSurface = afterSafeMove.history.present.surfaces.find(
      (candidate) => candidate.id === surfaceId,
    )
    if (!movedSurface || movedSurface.type !== 'spatial-2d') {
      throw new Error('expected Spatial surface after owner move')
    }
    expect(movedSurface.surfaceLayerItems.some((entry) => entry.item.layerItemId === surfaceItemId))
      .toBe(false)
    expect(movedSurface.world.layerItems.some((item) => item.layerItemId === surfaceItemId))
      .toBe(true)

    const beforeReorder = useEditorStore.getState().spatialSession!
    const worldIds = movedSurface.world.layerItems.map((item) => item.layerItemId)
    useEditorStore.getState().reorderNodes([...worldIds].reverse())
    const afterReorder = useEditorStore.getState().spatialSession!
    expect(afterReorder.history.present.revision).toBe(beforeReorder.history.present.revision + 1)
    expect(afterReorder.history.past).toHaveLength(beforeReorder.history.past.length + 1)
    const reorderedSurface = afterReorder.history.present.surfaces.find(
      (candidate) => candidate.id === surfaceId,
    )
    if (!reorderedSurface || reorderedSurface.type !== 'spatial-2d') {
      throw new Error('expected reordered Spatial surface')
    }
    expect(reorderedSurface.world.layerItems.map((item) => item.layerItemId))
      .toEqual([...worldIds].reverse())
  })

  it('hides misplaced teacher-controller copies without rewriting globalLayerItems', () => {
    injectCandidate(v9WithMisplacedControllerCopies())
    const before = selectSlideAuthoringDocument(useEditorStore.getState())!
    const globalBefore = JSON.stringify(before.globalLayerItems)
    useEditorStore.getState().setEditingScope('global')
    render(<NodesTab />)
    expect(screen.queryByTestId('node-item-teacher-controller-scene-copy')).toBeNull()
    expect(screen.queryByTestId('node-item-teacher-controller-surface-copy')).toBeNull()
    expect(layerGroupNodeIds('scene')).toEqual(['slide-title'])
    expect(layerGroupNodeIds('surface')).toEqual(['page-shared'])
    expect(layerGroupNodeIds('global-overlay')).toContain('teacher-controller-main')
    expect(layerGroupNodeIds('global-overlay')).not.toContain('teacher-controller-scene-copy')
    expect(document.querySelectorAll('.node-type-icon[title="teacher-controller"]')).toHaveLength(1)
    expect(screen.getByTestId('node-source-teacher-controller-main').textContent)
      .toContain('全课 Overlay、不可下沉')

    const after = selectSlideAuthoringDocument(useEditorStore.getState())!
    expect(JSON.stringify(after.globalLayerItems)).toBe(globalBefore)
    const slide = after.surfaces[0]
    if (!slide || slide.type !== 'slide') throw new Error('expected slide')
    expect(slide.scenes[0]!.layerItems.some((item) => item.layerItemId === 'teacher-controller-scene-copy')).toBe(true)
    expect(slide.surfaceLayerItems.some((entry) => entry.item.layerItemId === 'teacher-controller-surface-copy')).toBe(true)
    expect(slide.scenes[0]!.layerItems.some((item) => item.layerItemId === 'teacher-controller-main')).toBe(false)
  })

  it('reorders inside one owner with one history entry and refuses moving the controller onto a scene', () => {
    const project = v9ThreeLocationFixture()
    project.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )!.plane = 'overlay'
    injectCandidate(project)
    useEditorStore.getState().setEditingScope('global')
    render(<NodesTab />)
    const before = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession().history.past.length
    const globals = selectEffectiveLayerProjection(useEditorStore.getState())!
      .unifiedRows
      .filter((row) => row.owner === 'global')
      .map((row) => row.id)
    expect(globals).toEqual(['global-banner', 'teacher-controller-main'])
    useEditorStore.getState().reorderNodes(['teacher-controller-main', 'global-banner'])
    const after = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(after.history.past.length).toBe(before + 1)
    expect(after.history.present.globalLayerItems.map((entry) => entry.item.layerItemId))
      .toEqual(['teacher-controller-main', 'global-banner'])
    expect(after.history.present.globalLayerItems.map((entry) => entry.plane))
      .toEqual(['overlay', 'overlay'])
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.schemaVersion).toBe(9)

    useEditorStore.getState().undo()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems
      .map((entry) => entry.item.layerItemId))
      .toEqual(['global-banner', 'teacher-controller-main'])
    useEditorStore.getState().redo()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems
      .map((entry) => entry.item.layerItemId))
      .toEqual(['teacher-controller-main', 'global-banner'])

    useEditorStore.getState().moveCandidateLayerOwner(
      'teacher-controller-main',
      'slide-title',
    )
    expect(useEditorStore.getState().errorMessage).toBe(CONTROLLER_MOVE_REASON)
    const scene = selectSlideAuthoringDocument(useEditorStore.getState())!
      .surfaces[0]
    if (!scene || scene.type !== 'slide') throw new Error('expected slide')
    expect(scene.scenes[0]!.layerItems.some((item) => item.layerItemId === 'teacher-controller-main')).toBe(false)
  })

  it('rejects a direct reorder that mixes global Underlay and Overlay with zero history', () => {
    injectCandidate()
    useEditorStore.getState().setEditingScope('global')
    render(<NodesTab />)
    expect(layerGroupNodeIds('global-overlay')).toEqual(['teacher-controller-main'])
    expect(layerGroupNodeIds('global-underlay')).toEqual(['global-banner'])
    const before = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    const beforeDocument = JSON.stringify(before.history.present)

    useEditorStore.getState().reorderNodes(['teacher-controller-main', 'global-banner'])

    const after = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(useEditorStore.getState().errorMessage).toBe(CROSS_GLOBAL_PLANE_REORDER_REASON)
    expect(after).toBe(before)
    expect(after.history.past).toHaveLength(before.history.past.length)
    expect(JSON.stringify(after.history.present)).toBe(beforeDocument)
  })

  it('preserves effective global planes, visibility, references, and history across clipboard paste', () => {
    const project = v9ThreeLocationFixture()
    project.componentPackages['component.quiz'] = {
      packageId: 'component.quiz',
      version: '4.0.0',
      name: 'Quiz',
      manifestPath: 'components/component.quiz/manifest.json',
      runtimePath: 'components/component.quiz/runtime.js',
      contentSha256: '1'.repeat(64),
    }
    const legacyUnderlay = project.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )!
    legacyUnderlay.visibility = {
      mode: 'include',
      locationIds: ['location-scene-1'],
    }
    project.globalLayerItems.splice(1, 0, {
      item: globalRuntime('global-runtime', 40, 'global-banner'),
      visibility: { mode: 'exclude', locationIds: ['location-scene-3'] },
      plane: 'overlay',
    })
    project.globalLayerItems.splice(2, 0, {
      item: globalComponent('global-component', 60),
      visibility: { mode: 'all', locationIds: [] },
      plane: 'underlay',
    })
    project.globalInteractions.push(
      {
        id: 'global-copy-link',
        enabled: true,
        trigger: { type: 'node.click', nodeId: 'global-banner' },
        conditions: [],
        actions: [{
          id: 'global-copy-link-enter',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: 'global-runtime',
            effect: 'fade',
            durationMs: 200,
            easing: 'ease-out',
          },
        }],
      },
      {
        id: 'global-copy-follower',
        enabled: true,
        trigger: { type: 'animation.completed', actionId: 'global-copy-link-enter' },
        conditions: [],
        actions: [{
          id: 'global-copy-follower-next',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
    )
    injectCandidate(courseProjectDocumentSchema.parse(project))
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().selectNodes([
      'global-component',
      'global-runtime',
      'global-banner',
    ])
    const beforeCopy = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()

    useEditorStore.getState().copySelectedNodes()

    const copiedState = useEditorStore.getState()
    expect(selectSlideAuthoringBackend(copiedState)!.getSession()).toBe(beforeCopy)
    expect(copiedState.clipboardGlobalItems).toEqual([])
    const clipboard = copiedState.slideCandidateClipboard
    expect(clipboard?.sourceScope).toBe('global')
    if (!clipboard || clipboard.sourceScope !== 'global') {
      throw new Error('expected canonical global clipboard')
    }
    expect(clipboard.items.map(({ entry }) => ({
      id: entry.item.layerItemId,
      plane: entry.plane,
      visibility: entry.visibility,
    }))).toEqual([
      {
        id: 'global-component',
        plane: 'underlay',
        visibility: { mode: 'all', locationIds: [] },
      },
      {
        id: 'global-runtime',
        plane: 'overlay',
        visibility: { mode: 'exclude', locationIds: ['location-scene-3'] },
      },
      {
        id: 'global-banner',
        plane: 'underlay',
        visibility: { mode: 'include', locationIds: ['location-scene-1'] },
      },
    ])
    expect(clipboard.items[1]?.entry.item).toMatchObject({
      kind: 'runtime',
      hitPolicy: 'surface',
      playbackInitialVisibility: 'hidden',
      runtime: {
        content: { values: { label: 'canonical-only' } },
        nodeBindings: { target: 'global-banner' },
      },
    })
    expect(clipboard.items[0]?.entry.item).toMatchObject({
      kind: 'component',
      component: { packageId: 'component.quiz', version: '4.0.0' },
      props: { prompt: 'canonical component', nested: { answer: 42 } },
    })

    useEditorStore.getState().selectNode('teacher-controller-main')
    useEditorStore.getState().copySelectedNodes()
    expect(useEditorStore.getState().errorMessage).toBe(
      SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON,
    )
    expect(useEditorStore.getState().slideCandidateClipboard).toBe(clipboard)

    useEditorStore.getState().pasteNodes()

    const pasted = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    const [pastedComponentId, pastedOverlayId, pastedUnderlayId] = pasted.selection.selectionIds
    expect(pastedComponentId).toBeTruthy()
    expect(pastedOverlayId).toBeTruthy()
    expect(pastedUnderlayId).toBeTruthy()
    expect(pasted.history.past).toHaveLength(beforeCopy.history.past.length + 1)
    expect(pasted.history.present.revision).toBe(beforeCopy.history.present.revision + 1)
    expect(pasted.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )?.plane).toBeUndefined()
    expect(pasted.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedUnderlayId,
    )).toMatchObject({
      plane: 'underlay',
      visibility: { mode: 'include', locationIds: ['location-scene-1'] },
    })
    const pastedRuntimeEntry = pasted.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedOverlayId,
    )
    expect(pastedRuntimeEntry).toMatchObject({
      plane: 'overlay',
      visibility: { mode: 'exclude', locationIds: ['location-scene-3'] },
      item: {
        kind: 'runtime',
        hitPolicy: 'surface',
        playbackInitialVisibility: 'hidden',
      },
    })
    if (pastedRuntimeEntry?.item.kind !== 'runtime') {
      throw new Error('expected pasted canonical Runtime')
    }
    expect(pastedRuntimeEntry.item.runtime.nodeBindings).toEqual({
      target: pastedUnderlayId,
    })
    expect(pasted.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedComponentId,
    )).toMatchObject({
      plane: 'underlay',
      item: {
        kind: 'component',
        component: { packageId: 'component.quiz', version: '4.0.0' },
        props: { prompt: 'canonical component', nested: { answer: 42 } },
      },
    })
    const pastedBannerOrder = pasted.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedUnderlayId,
    )?.item.order
    const pastedComponentOrder = pasted.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedComponentId,
    )?.item.order
    expect(pastedBannerOrder).toBeLessThan(pastedComponentOrder!)
    const pastedRootRule = pasted.history.present.globalInteractions.find(
      (rule) => rule.trigger.type === 'node.click'
        && rule.trigger.nodeId === pastedUnderlayId,
    )
    expect(pastedRootRule).toEqual(expect.objectContaining({
      trigger: { type: 'node.click', nodeId: pastedUnderlayId },
      actions: [expect.objectContaining({
        action: expect.objectContaining({
          type: 'node.enter',
          nodeId: pastedOverlayId,
        }),
      })],
    }))
    const pastedActionId = pastedRootRule?.actions[0]?.id
    expect(pastedActionId).toBeTruthy()
    expect(pasted.history.present.globalInteractions).toContainEqual(expect.objectContaining({
      trigger: { type: 'animation.completed', actionId: pastedActionId },
    }))

    useEditorStore.getState().undo()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems.some(
      (entry) => entry.item.layerItemId === pastedUnderlayId,
    )).toBe(false)
    useEditorStore.getState().redo()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedUnderlayId,
    )?.plane).toBe('underlay')

    const beforeRepeat = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    useEditorStore.getState().pasteNodes()
    const repeated = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(repeated.history.past).toHaveLength(beforeRepeat.history.past.length + 1)
    for (const [index, id] of repeated.selection.selectionIds.entries()) {
      const expectedPlane = index === 1 ? 'overlay' : 'underlay'
      expect(repeated.history.present.globalLayerItems.find(
        (entry) => entry.item.layerItemId === id,
      )?.plane).toBe(expectedPlane)
    }

    const reopened = courseProjectDocumentSchema.parse(structuredClone(repeated.history.present))
    injectCandidate(reopened)
    const reopenedDocument = selectSlideAuthoringDocument(useEditorStore.getState())!
    expect(reopenedDocument.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedUnderlayId,
    )?.plane).toBe('underlay')
    expect(reopenedDocument.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedOverlayId,
    )?.plane).toBe('overlay')
    expect(reopenedDocument.globalLayerItems.find(
      (entry) => entry.item.layerItemId === pastedComponentId,
    )?.plane).toBe('underlay')
  })

  it('routes a visible global row through the effective command while scene scope is active', () => {
    const project = v9ThreeLocationFixture()
    project.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )!.plane = 'overlay'
    injectCandidate(project)
    render(<NodesTab />)
    expect(useEditorStore.getState().editingScope).toBe('scene')
    expect(layerGroupNodeIds('global-overlay')).toEqual(['global-banner'])
    expect(screen.queryByTestId('node-item-teacher-controller-main')).toBeNull()
    const before = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()

    useEditorStore.getState().reorderNodes(['teacher-controller-main', 'global-banner'])

    const after = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    expect(after.history.present.globalLayerItems.map((entry) => entry.item.layerItemId))
      .toEqual(['teacher-controller-main', 'global-banner'])
    useEditorStore.getState().undo()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems
      .map((entry) => entry.item.layerItemId))
      .toEqual(['global-banner', 'teacher-controller-main'])
  })

  it('writes per-location visibility without changing startLocationId or location order', () => {
    injectCandidate()
    useEditorStore.getState().selectNode('teacher-controller-main')
    const before = selectSlideAuthoringDocument(useEditorStore.getState())!
    const order = before.locations.map((location) => location.id)
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.getByLabelText('图层位置')).toBeDisabled()
    expect(screen.getByLabelText('图层位置')).toHaveValue('overlay')
    fireEvent.change(screen.getByLabelText('场景可见范围'), {
      target: { value: 'include' },
    })
    fireEvent.click(screen.getByTestId('location-visibility-location-scene-1'))
    fireEvent.click(screen.getByLabelText('当前页显示'))
    const after = selectSlideAuthoringDocument(useEditorStore.getState())!
    expect(after.startLocationId).toBe(before.startLocationId)
    expect(after.locations.map((location) => location.id)).toEqual(order)
    expect(after.globalLayerItems.find((entry) => entry.item.layerItemId === 'teacher-controller-main')?.visibility)
      .toMatchObject({ mode: expect.stringMatching(/include|exclude|all/) })
    expect(JSON.stringify(after.globalLayerItems)).not.toContain('sceneIds')
    expect(useEditorStore.getState().slideCandidateSnapshot?.locationId).toBe('location-scene-1')
  })

  it('uses the same controller layout in Properties as the canvas frame, and west-resizes on pointerup', () => {
    injectCandidate()
    useEditorStore.getState().selectNode('teacher-controller-main')
    const item = selectSlideAuthoringDocument(useEditorStore.getState())!
      .globalLayerItems
      .find((entry) => entry.item.layerItemId === 'teacher-controller-main')
      ?.item
    if (!item || item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') {
      throw new Error('missing controller')
    }
    const layout = teacherControllerPropertiesPreview(item.content.data, item.frame)
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const preview = screen.getByTestId('teacher-controller-layout-preview')
    expect(preview.textContent).toContain(`${layout.width} × ${layout.height}`)
    expect(preview.textContent).toContain(layout.buttons[0]!.label)

    // With scope === 'scene', pointerDown on teacher controller returns no target or preview
    useEditorStore.getState().setEditingScope('scene')
    const controller = createV9TeacherControllerAuthoringController()
    const transform = createStageViewportTransform(VIEW)
    const west = worldToClient(transform, { x: 190, y: 670 })
    const sceneDown = controller.pointerDown({ x: west.x, y: west.y }, VIEW)
    expect(sceneDown.kind).toBe('v9-controller-candidate')
    if (sceneDown.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(sceneDown.target).toBeUndefined()
    expect(sceneDown.preview).toBeUndefined()

    // Switch scope to 'global', pointerDown on teacher controller activates authoring target and preview
    useEditorStore.getState().setEditingScope('global')
    const down = controller.pointerDown({ x: west.x, y: west.y }, VIEW)
    expect(down.kind).toBe('v9-controller-candidate')
    if (down.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(down.overlay).toBeTruthy()
    expect(down.target?.layerItemId).toBe('teacher-controller-main')
    const dragged = { x: west.x - 40, y: west.y }
    expect(clientToWorld(transform, dragged).x).toBeCloseTo(150)
    const previewMove = controller.pointerMove(dragged, VIEW)
    if (previewMove.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(previewMove.preview).toEqual({ x: 150, y: 638, width: 940, height: 64 })
    expect(controllerFrame().revision).toBe(1)
    const committed = controller.pointerUp(dragged, VIEW)
    if (committed.kind !== 'v9-controller-candidate') throw new Error('expected candidate')
    expect(committed.command?.historyEntry).toBe(true)
    expect(controllerFrame()).toMatchObject({
      x: 150,
      y: 638,
      width: 940,
      height: 64,
      revision: 2,
    })
  })
})
