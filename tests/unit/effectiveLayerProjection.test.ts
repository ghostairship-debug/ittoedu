import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import {
  getEffectiveCourseLayerOrder,
  sceneNodeToCourseLayerItem,
} from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import { createTeacherControllerNode } from '@/renderer/project/nativeNodeFactories'
import {
  commandTargetFromRow,
  courseAuthoringScopeFromLocation,
  createEffectiveLayerItemActionInput,
  createEffectiveLayerReorderInput,
  describeLayerImpact,
  isFlowDocumentBlockId,
  isTeacherControllerLayerItem,
  makeLayerItemAuthoringAddress,
  projectEffectiveLayers,
  rowsForListKind,
  scopeTokenForSelectingRow,
  visualFrontToBackRows,
} from '@/renderer/course/effectiveLayerProjection'

/**
 * Proves the read-only effective-layer projection and authoring-scope token.
 * Does not prove NodesTab / Workspace / PropertiesTab / MediaTab wiring.
 * Default product backend remains V8.
 */
const NOW = '2026-08-17T06:54:00.000Z'

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
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'visible' | 'frame'>> = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
    frame: extra.frame ?? { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
    order,
    visible: extra.visible ?? true,
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

function scoped(
  item: NativeLayerItem,
  visibility: ScopedLayerItem['visibility'] = { mode: 'all', locationIds: [] },
): ScopedLayerItem {
  return { item, visibility }
}

function v9ProjectionFixture(): CourseProjectDocument {
  const controller = sceneNodeToCourseLayerItem(
    createTeacherControllerNode({ id: 'teacher-controller', name: '教师控制器' }),
    110,
  )
  if (controller.kind !== 'native') throw new Error('expected native controller')
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r3d-effective-layers',
    revision: 1,
    title: 'R3-D 有效图层投影',
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
    globalLayerItems: [
      { ...scoped(nativeText('global-banner', 100, '全局条')), plane: 'underlay' },
      {
        ...scoped(controller as NativeLayerItem, {
          mode: 'exclude',
          locationIds: ['location-scene-2'],
        }),
        plane: 'overlay',
      },
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
        id: 'location-flow',
        label: '讲义',
        kind: 'flow-block',
        surfaceId: 'surface-flow',
        blockId: 'flow-h1',
      },
      {
        id: 'location-spatial',
        label: '空间',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'camera-home',
      },
    ],
    startLocationId: 'location-scene-1',
    surfaces: [
      {
        id: 'surface-slide',
        title: '演示',
        type: 'slide',
        canvas: { width: 1280, height: 720 },
        surfaceLayerItems: [
          scoped(nativeText('surface-shared', 40, '表面水印'), {
            mode: 'include',
            locationIds: ['location-scene-1'],
          }),
        ],
        scenes: [
          {
            id: 'scene-1',
            name: '场景 1',
            backgroundColor: '#ffffff',
            layerItems: [
              nativeText('slide-title', 20, '本页标题'),
              nativeText('slide-note', 30, '本页注释'),
            ],
            presentation: {
              initialStateId: 'state-base',
              states: [
                { id: 'state-base', name: '基础', layerItemOverrides: {} },
                {
                  id: 'state-explain',
                  name: '讲解',
                  layerItemOverrides: {
                    'slide-title': { visible: false, label: '讲解标题' },
                  },
                  layerItemOrder: ['slide-note', 'slide-title'],
                },
              ],
            },
            interactions: [],
          },
          {
            id: 'scene-2',
            name: '场景 2',
            backgroundColor: '#ffffff',
            layerItems: [nativeText('slide-two', 20, '第二页标题')],
            interactions: [],
          },
        ],
      },
      {
        id: 'surface-flow',
        title: '讲义',
        type: 'flow',
        surfaceLayerItems: [],
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [
          { type: 'heading', id: 'flow-h1', level: 1, text: '讲义标题' },
          {
            type: 'section',
            id: 'flow-section',
            title: '小节',
            collapsedByDefault: false,
            blocks: [{ type: 'paragraph', id: 'flow-p1', text: '普通段落' }],
          },
        ],
      },
      {
        id: 'surface-spatial',
        title: '空间',
        type: 'spatial-2d',
        surfaceLayerItems: [],
        world: {
          bounds: { mode: 'infinite' },
          layerItems: [nativeText('world-landmark', 15, '世界地标')],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [{ id: 'camera-home', name: '主镜头', x: 0, y: 0, zoom: 1 }],
        },
        semanticZoom: [],
      },
    ],
    mixedPrintPlan: {
      pageSize: 'A4',
      orientation: 'auto',
      entries: [
        {
          id: 'print-slide',
          kind: 'slide-scenes',
          surfaceId: 'surface-slide',
          sceneIds: ['scene-1', 'scene-2'],
        },
        { id: 'print-flow', kind: 'flow-document', surfaceId: 'surface-flow' },
        {
          id: 'print-spatial',
          kind: 'spatial-frames',
          surfaceId: 'surface-spatial',
          cameraFrameIds: ['camera-home'],
        },
      ],
    },
  })
}

describe('effective layer projection', () => {
  it('merges global/surface/scene with source and location impact, and never disguises the controller as a scene row', () => {
    const project = v9ProjectionFixture()
    const projection = projectEffectiveLayers({
      project,
      locationId: 'location-scene-1',
      selectedIds: ['slide-title'],
    })
    const byId = Object.fromEntries(projection.unifiedRows.map((row) => [row.id, row]))

    expect(projection.unifiedRows.map((row) => row.id)).toEqual([
      'global-banner',
      'slide-title',
      'slide-note',
      'surface-shared',
      'teacher-controller',
    ])
    expect(byId['global-banner']).toMatchObject({
      source: 'global',
      sourceLabel: '全课',
      owner: 'global',
      ownerKey: 'global',
      reorderGroupKey: 'global:underlay',
      globalPlane: 'underlay',
      stackOrder: 0,
      impact: { kind: 'location', mode: 'all', locationIds: [] },
    })
    expect(describeLayerImpact(byId['global-banner']!.impact)).toBe('全部页面')
    expect(byId['surface-shared']).toMatchObject({
      source: 'surface',
      owner: 'surface',
      ownerKey: 'surface:surface-slide',
      impact: { kind: 'location', mode: 'include', locationIds: ['location-scene-1'] },
      visibleAtLocation: true,
    })
    expect(byId['slide-title']).toMatchObject({
      source: 'scene',
      owner: 'scene',
      ownerKey: 'scene:scene-1',
      selected: true,
      impact: { kind: 'scene', mode: 'owner' },
      hitPolicy: 'auto',
      contentSummary: { kind: 'native', nativeType: 'text' },
    })
    expect(byId['slide-title']?.frame).toEqual(byId['slide-title']?.item.frame)
    expect(byId['teacher-controller']).toMatchObject({
      contentSummary: { kind: 'native', nativeType: 'teacher-controller' },
    })
    expect('schemaVersion' in byId['slide-title']!).toBe(false)
    expect(byId['teacher-controller']).toMatchObject({
      source: 'global',
      owner: 'global',
      isTeacherController: true,
      reorderGroupKey: 'global:overlay',
      globalPlane: 'overlay',
      stackOrder: 4,
      impact: { kind: 'location', mode: 'exclude', locationIds: ['location-scene-2'] },
    })
    expect(isTeacherControllerLayerItem(byId['teacher-controller']!.item)).toBe(true)

    const engine = getEffectiveCourseLayerOrder({
      project,
      surfaceId: 'surface-slide',
      locationId: 'location-scene-1',
    })
    expect(engine.find((entry) => entry.item.layerItemId === 'teacher-controller')?.source)
      .toBe('global')
    expect(projection.compositedRows.map((row) => row.id)).toEqual(
      engine.map((entry) => entry.item.layerItemId),
    )

    const sceneOnly = rowsForListKind(projection, 'scene-only')
    expect(sceneOnly.map((row) => row.id)).toEqual(['slide-title', 'slide-note'])
    expect(sceneOnly.some((row) => row.isTeacherController)).toBe(false)
    expect(sceneOnly.some((row) => row.owner === 'global')).toBe(false)

    const hiddenLocation = projectEffectiveLayers({
      project,
      locationId: 'location-scene-2',
    })
    expect(hiddenLocation.unifiedRows.find((row) => row.id === 'teacher-controller'))
      .toMatchObject({ owner: 'global', visibleAtLocation: false })
    expect(hiddenLocation.unifiedRows.find((row) => row.id === 'surface-shared'))
      .toMatchObject({ visibleAtLocation: false })
    expect(hiddenLocation.compositedRows.map((row) => row.id)).not.toContain('teacher-controller')
    expect(hiddenLocation.sceneOnlyRows.map((row) => row.id)).toEqual(['slide-two'])
  })

  it('selecting a global row switches authoring scope and keeps canvas/layer/property identity on makeAuthoringAddress', () => {
    const project = v9ProjectionFixture()
    const viewing = courseAuthoringScopeFromLocation({
      project,
      locationId: 'location-scene-1',
    })
    expect(viewing).toMatchObject({
      owner: 'scene',
      ownerKey: 'scene:scene-1',
      locationId: 'location-scene-1',
    })

    const projection = projectEffectiveLayers({
      project,
      locationId: 'location-scene-1',
      owner: viewing.owner,
    })
    const controller = projection.unifiedRows.find((row) => row.id === 'teacher-controller')!
    const title = projection.unifiedRows.find((row) => row.id === 'slide-title')!
    const nextScope = scopeTokenForSelectingRow(viewing, controller)

    expect(nextScope.owner).toBe('global')
    expect(nextScope.ownerKey).toBe('global')
    expect(nextScope.locationId).toBe('location-scene-1')
    expect(JSON.stringify(nextScope)).not.toMatch(/hitId/)

    const expectedControllerAddress = makeAuthoringAddress({
      projectId: project.id,
      scope: 'global',
      carrier: 'native',
      layerItemId: 'teacher-controller',
      field: 'item',
    })
    const expectedTitleAddress = makeLayerItemAuthoringAddress({
      projectId: project.id,
      owner: 'scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      kind: 'native',
      layerItemId: 'slide-title',
    })
    expect(controller.authoringAddress).toBe(expectedControllerAddress)
    expect(title.authoringAddress).toBe(expectedTitleAddress)
    expect(controller.authoringAddress).not.toMatch(/hit/i)
    expect(title.authoringAddress).not.toMatch(/hit/i)

    const canvasIdentity = commandTargetFromRow(controller)
    const layerIdentity = commandTargetFromRow(controller)
    const propertyIdentity = commandTargetFromRow(controller)
    expect(canvasIdentity).toEqual(layerIdentity)
    expect(propertyIdentity).toEqual({
      authoringAddress: expectedControllerAddress,
      owner: 'global',
      ownerKey: 'global',
      layerItemId: 'teacher-controller',
      locationId: 'location-scene-1',
      stateId: null,
    })
  })

  it('applies named-state overrides, keeps Flow blocks out of the generic adapter, and exposes owner-aware UI inputs', () => {
    const project = v9ProjectionFixture()
    const crossPlaneProjection = projectEffectiveLayers({
      project,
      locationId: 'location-scene-1',
      stateId: null,
    })
    const crossPlaneReorder = createEffectiveLayerReorderInput({
      unifiedRows: crossPlaneProjection.unifiedRows,
      fromId: 'global-banner',
      toId: 'teacher-controller',
      placement: 'after',
    })
    expect(crossPlaneReorder).toMatchObject({
      sameOwner: true,
      sameReorderGroup: false,
      fromReorderGroupKey: 'global:underlay',
      toReorderGroupKey: 'global:overlay',
      owner: null,
      ownerKey: null,
      orderedLayerItemIds: [],
    })
    project.globalLayerItems[0]!.plane = 'overlay'
    project.globalLayerItems[0]!.item.order = 10
    const named = projectEffectiveLayers({
      project,
      locationId: 'location-scene-1',
      stateId: 'state-explain',
    })
    const base = projectEffectiveLayers({
      project,
      locationId: 'location-scene-1',
      stateId: null,
    })
    const namedTitle = named.unifiedRows.find((row) => row.id === 'slide-title')!
    const baseTitle = base.unifiedRows.find((row) => row.id === 'slide-title')!
    expect(baseTitle).toMatchObject({
      name: '本页标题',
      hidden: false,
      source: 'scene',
      stateOverrideApplied: false,
    })
    expect(namedTitle).toMatchObject({
      name: '讲解标题',
      hidden: true,
      source: 'state',
      sourceLabel: '当前状态',
      owner: 'scene',
      stateOverrideApplied: true,
    })
    const namedSceneOrder = named.sceneOnlyRows.map((row) => row.id)
    expect(namedSceneOrder).toEqual(['slide-note', 'slide-title'])
    expect(base.sceneOnlyRows.map((row) => row.id)).toEqual(['slide-title', 'slide-note'])
    expect(named.unifiedRows.find((row) => row.id === 'slide-note')!.item.order)
      .toBeLessThan(namedTitle.item.order)

    const flow = projectEffectiveLayers({
      project,
      locationId: 'location-flow',
    })
    expect(flow.unifiedRows.map((row) => row.id)).toEqual([
      'global-banner',
      'teacher-controller',
    ])
    expect(flow.sceneOnlyRows).toEqual([])
    expect(flow.unifiedRows.some((row) => row.id === 'flow-h1' || row.id === 'flow-p1')).toBe(false)
    expect(isFlowDocumentBlockId(project, 'flow-h1')).toBe(true)
    expect(isFlowDocumentBlockId(project, 'flow-p1')).toBe(true)
    expect(isFlowDocumentBlockId(project, 'global-banner')).toBe(false)

    const spatial = projectEffectiveLayers({
      project,
      locationId: 'location-spatial',
    })
    expect(spatial.scope.owner).toBe('world')
    expect(spatial.unifiedRows.find((row) => row.id === 'world-landmark')).toMatchObject({
      source: 'world',
      owner: 'world',
      ownerKey: 'world:surface-spatial',
      impact: { kind: 'world', mode: 'owner' },
    })
    expect(spatial.sceneOnlyRows).toEqual([])

    const sameOwnerReorder = createEffectiveLayerReorderInput({
      unifiedRows: named.unifiedRows,
      fromId: 'global-banner',
      toId: 'teacher-controller',
      placement: 'after',
    })
    expect(sameOwnerReorder).toMatchObject({
      action: 'reorder',
      sameOwner: true,
      sameReorderGroup: true,
      owner: 'global',
      ownerKey: 'global',
      fromReorderGroupKey: 'global:overlay',
      toReorderGroupKey: 'global:overlay',
      orderedLayerItemIds: ['teacher-controller', 'global-banner'],
    })
    const crossOwnerReorder = createEffectiveLayerReorderInput({
      unifiedRows: named.unifiedRows,
      fromId: 'teacher-controller',
      toId: 'slide-title',
      placement: 'before',
    })
    expect(crossOwnerReorder.sameOwner).toBe(false)
    expect(crossOwnerReorder.sameReorderGroup).toBe(false)
    expect(crossOwnerReorder.orderedLayerItemIds).toEqual([])
    expect(crossOwnerReorder.fromOwner).toBe('global')
    expect(crossOwnerReorder.toOwner).toBe('scene')

    const hideInState = createEffectiveLayerItemActionInput(namedTitle, 'delete')
    expect(hideInState).toMatchObject({
      action: 'delete',
      deleteMode: 'hide-in-state',
      writeBlockedReason: null,
      target: {
        owner: 'scene',
        layerItemId: 'slide-title',
        stateId: 'state-explain',
      },
    })
    const lock = createEffectiveLayerItemActionInput(
      named.unifiedRows.find((row) => row.id === 'slide-note')!,
      'lock',
    )
    expect(lock.action).toBe('lock')
    expect(lock.target.authoringAddress).toContain('/scene/')
    const duplicate = createEffectiveLayerItemActionInput(
      named.unifiedRows.find((row) => row.id === 'teacher-controller')!,
      'duplicate',
    )
    expect(duplicate.target.owner).toBe('global')
    expect(visualFrontToBackRows(named.sceneOnlyRows).map((row) => row.id))
      .toEqual(['slide-title', 'slide-note'])
  })
})
