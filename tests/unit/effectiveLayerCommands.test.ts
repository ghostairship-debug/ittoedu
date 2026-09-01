import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import {
  getEffectiveCourseLayerOrder,
  isCourseLayerVisibleAtLocation,
  sceneNodeToCourseLayerItem,
} from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import { createTeacherControllerNode } from '@/renderer/project/createProject'
import {
  CONTROLLER_MOVE_REASON,
  CROSS_OWNER_REORDER_REASON,
  LAYER_REJECT_LOCKED,
  LAYER_REJECT_STALE_REVISION,
  SPATIAL_CROSS_COORDINATE_MOVE_REASON,
  deleteEffectiveLayerItem,
  duplicateEffectiveLayerItem,
  listEffectiveLayerCommandItems,
  locateCourseLayer,
  makeEffectiveLayerAuthoringAddress,
  moveEffectiveLayerOwner,
  patchEffectiveLayerItem,
  patchEffectiveLayerItems,
  reorderEffectiveLayerItems,
} from '@/renderer/course/effectiveLayerCommands'
import {
  allocateCourseLayerOrder,
  findGlobalTeacherController,
  isTeacherControllerLayerItem,
  makeGlobalLayerAuthoringAddress,
  restoreDefaultTeacherController,
  setGlobalLayerLocationVisibility,
  setGlobalLayerVisibleAtLocation,
  type EffectiveLayerCommandTarget,
} from '@/renderer/course/globalLayerCommands'
import { addCourseSpatialPage } from '@/renderer/course/courseLocationCommands'

/**
 * V9 command fixture. Proves global/effective layer commands.
 * Does not prove NodesTab, Workspace, MediaTab, Player, or default V8 App.
 */
const NOW = '2026-08-17T14:00:00.000Z'

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
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'visible'>> = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
    frame: { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
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

function v9LayerFixture(): CourseProjectDocument {
  const controller = sceneNodeToCourseLayerItem(
    createTeacherControllerNode({ id: 'teacher-controller-main' }),
    90,
  )
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r3a-layers',
    revision: 1,
    title: 'R3-A layers',
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
      scoped(nativeText('global-footer', 5, '全课页脚')),
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
    ],
    startLocationId: 'location-scene-1',
    surfaces: [
      {
        id: 'surface-slide',
        title: '演示',
        type: 'slide',
        canvas: { width: 1280, height: 720 },
        surfaceLayerItems: [
          scoped(nativeText('surface-shared', 10, '表面共享'), {
            mode: 'include',
            locationIds: ['location-scene-1'],
          }),
        ],
        scenes: [
          {
            id: 'scene-1',
            name: '场景 1',
            backgroundColor: '#ffffff',
            layerItems: [nativeText('slide-title', 20, '本页标题')],
            presentation: {
              initialStateId: 'state-initial',
              states: [
                { id: 'state-initial', name: '初始', layerItemOverrides: {} },
                { id: 'state-explain', name: '讲解', layerItemOverrides: {} },
              ],
            },
            interactions: [],
          },
          {
            id: 'scene-2',
            name: '场景 2',
            backgroundColor: '#ffffff',
            layerItems: [nativeText('slide-title-2', 20, '第二页标题')],
            interactions: [],
          },
        ],
      },
    ],
  })
}

function globalTarget(
  project: CourseProjectDocument,
  layerItemId: string,
  locationId = 'location-scene-1',
): EffectiveLayerCommandTarget {
  const located = locateCourseLayer(project, layerItemId)
  if (!located) throw new Error(`missing ${layerItemId}`)
  return {
    authoringAddress: makeEffectiveLayerAuthoringAddress(project.id, located),
    locationId,
  }
}

function sceneTarget(
  project: CourseProjectDocument,
  layerItemId: string,
  stateId: string | null = null,
): EffectiveLayerCommandTarget {
  return {
    ...globalTarget(project, layerItemId),
    stateId,
  }
}

function spatialLayerFixture(): {
  project: CourseProjectDocument
  locationId: string
  surfaceId: string
} {
  const appended = addCourseSpatialPage(v9LayerFixture(), {
    title: '空间图层移动',
    now: NOW,
  })
  if (!appended.ok) throw new Error(appended.reason)
  const location = appended.project.locations.find(
    (candidate) => candidate.id === appended.activatedLocationId,
  )
  if (!location || location.kind !== 'spatial-camera') throw new Error('expected spatial location')
  const project = structuredClone(appended.project)
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'spatial-2d') throw new Error('expected spatial surface')
  surface.surfaceLayerItems.push(scoped(nativeText('spatial-surface', 101, '空间本页')))
  surface.world.layerItems.push(
    nativeText('spatial-world-a', 102, '世界元素 A'),
    nativeText('spatial-world-b', 103, '世界元素 B'),
  )
  return {
    project: courseProjectDocumentSchema.parse(project),
    locationId: location.id,
    surfaceId: surface.id,
  }
}

describe('V9 effective / global layer commands', () => {
  it('allocates from one course-wide order set without rewriting existing owner order', () => {
    const appended = addCourseSpatialPage(v9LayerFixture(), {
      title: '空间顺序',
      now: NOW,
    })
    expect(appended.ok).toBe(true)
    if (!appended.ok) throw new Error(appended.reason)
    const location = appended.project.locations.find(
      (candidate) => candidate.id === appended.activatedLocationId,
    )
    if (!location || location.kind !== 'spatial-camera') throw new Error('expected spatial location')
    const surface = appended.project.surfaces.find((candidate) => candidate.id === location.surfaceId)
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected spatial surface')
    surface.surfaceLayerItems.push(scoped(nativeText('spatial-shared-order', 1, '空间共享')))
    surface.world.layerItems.push(nativeText('spatial-world-order', 2, '世界元素'))
    const project = courseProjectDocumentSchema.parse(appended.project)
    const before = JSON.stringify(project)
    const beforeEffectiveIds = getEffectiveCourseLayerOrder({
      project,
      surfaceId: surface.id,
      locationId: location.id,
    }).map((entry) => entry.item.layerItemId)

    expect(allocateCourseLayerOrder(project, 0)).toBe(3)
    expect(JSON.stringify(project)).toBe(before)
    expect(getEffectiveCourseLayerOrder({
      project,
      surfaceId: surface.id,
      locationId: location.id,
    }).map((entry) => entry.item.layerItemId)).toEqual(beforeEffectiveIds)
  })

  it('lists unified effective layers with stable owner addresses and no hitId', () => {
    const project = v9LayerFixture()
    const items = listEffectiveLayerCommandItems({
      project,
      locationId: 'location-scene-1',
    })
    expect(items.map((item) => item.id)).toEqual([
      'global-banner',
      'global-footer',
      'surface-shared',
      'slide-title',
      'teacher-controller-main',
    ])
    expect(items.map((item) => item.source)).toEqual([
      'global',
      'global',
      'surface',
      'scene',
      'global',
    ])
    expect(items.every((item) => item.authoringAddress.startsWith('courseware://authoring/'))).toBe(true)
    expect(items.every((item) => !item.authoringAddress.includes('hitId'))).toBe(true)
    expect(items.find((item) => item.id === 'slide-title')?.authoringAddress).toBe(
      makeAuthoringAddress({
        projectId: 'r3a-layers',
        scope: 'scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
        carrier: 'native',
        layerItemId: 'slide-title',
        field: 'item',
      }),
    )
    expect(items.find((item) => item.id === 'global-banner')?.authoringAddress).toBe(
      makeGlobalLayerAuthoringAddress('r3a-layers', 'global-banner'),
    )
    expect(JSON.stringify(project)).not.toContain('hitId')
    expect(getEffectiveCourseLayerOrder({
      project,
      surfaceId: 'surface-slide',
      locationId: 'location-scene-1',
    }).map((entry) => entry.source)).toEqual(items.map((item) => item.source))
  })

  it('reorders inside one owner, fails mixed-owner lists, and never succeeds with 暂不能调整顺序', () => {
    const project = v9LayerFixture()
    const controller = findGlobalTeacherController(project)!
    const reordered = reorderEffectiveLayerItems(
      project,
      globalTarget(project, 'global-banner'),
      ['global-footer', 'global-banner', controller.item.layerItemId],
      { expectedRevision: 1, now: NOW },
    )
    expect(reordered).toMatchObject({ ok: true, historyEntry: true })
    expect(reordered.nextDocument?.revision).toBe(2)
    expect(reordered.nextDocument?.globalLayerItems.map((entry) => entry.item.layerItemId))
      .toEqual(['global-footer', 'global-banner', 'teacher-controller-main'])
    expect(reordered.reason).not.toContain('暂不能调整顺序')

    const mixed = reorderEffectiveLayerItems(
      project,
      globalTarget(project, 'global-banner'),
      ['global-banner', 'slide-title'],
      { expectedRevision: 1, now: NOW },
    )
    expect(mixed).toMatchObject({ ok: false, historyEntry: false })
    expect(mixed.reason).toBe(CROSS_OWNER_REORDER_REASON)
    expect(mixed.reason).not.toContain('暂不能调整顺序')
    expect(mixed.nextDocument).toBeUndefined()
    expect(project.revision).toBe(1)
  })

  it('rejects Spatial viewport/world owner changes before writes while preserving safe moves and reorder', () => {
    const { project, locationId, surfaceId } = spatialLayerFixture()
    const before = structuredClone(project)

    const globalToWorld = moveEffectiveLayerOwner(
      project,
      globalTarget(project, 'global-banner', locationId),
      { source: 'world', surfaceId },
      { expectedRevision: project.revision, now: NOW },
    )
    expect(globalToWorld).toEqual({
      ok: false,
      reason: SPATIAL_CROSS_COORDINATE_MOVE_REASON,
      historyEntry: false,
    })

    const globalToSurface = moveEffectiveLayerOwner(
      project,
      globalTarget(project, 'global-footer', locationId),
      { source: 'surface', surfaceId },
      { expectedRevision: project.revision, now: NOW },
    )
    expect(globalToSurface).toEqual({
      ok: false,
      reason: SPATIAL_CROSS_COORDINATE_MOVE_REASON,
      historyEntry: false,
    })

    const worldToGlobal = moveEffectiveLayerOwner(
      project,
      globalTarget(project, 'spatial-world-a', locationId),
      { source: 'global' },
      { expectedRevision: project.revision, now: NOW },
    )
    expect(worldToGlobal).toEqual({
      ok: false,
      reason: SPATIAL_CROSS_COORDINATE_MOVE_REASON,
      historyEntry: false,
    })

    const surfaceToGlobal = moveEffectiveLayerOwner(
      project,
      globalTarget(project, 'spatial-surface', locationId),
      { source: 'global' },
      { expectedRevision: project.revision, now: NOW },
    )
    expect(surfaceToGlobal).toEqual({
      ok: false,
      reason: SPATIAL_CROSS_COORDINATE_MOVE_REASON,
      historyEntry: false,
    })
    expect(project).toEqual(before)
    expect(project.revision).toBe(before.revision)
    expect(globalToWorld.nextDocument).toBeUndefined()
    expect(globalToSurface.nextDocument).toBeUndefined()
    expect(worldToGlobal.nextDocument).toBeUndefined()
    expect(surfaceToGlobal.nextDocument).toBeUndefined()

    const surfaceFrame = structuredClone(locateCourseLayer(project, 'spatial-surface')!.item.frame)
    const surfaceToWorld = moveEffectiveLayerOwner(
      project,
      globalTarget(project, 'spatial-surface', locationId),
      { source: 'world', surfaceId },
      { expectedRevision: project.revision, now: NOW },
    )
    expect(surfaceToWorld).toMatchObject({ ok: true, historyEntry: true })
    expect(surfaceToWorld.nextDocument?.revision).toBe(project.revision + 1)
    expect(locateCourseLayer(surfaceToWorld.nextDocument!, 'spatial-surface')?.source).toBe('world')
    expect(locateCourseLayer(surfaceToWorld.nextDocument!, 'spatial-surface')?.item.frame)
      .toEqual(surfaceFrame)

    const worldFrame = structuredClone(locateCourseLayer(project, 'spatial-world-a')!.item.frame)
    const worldToSurface = moveEffectiveLayerOwner(
      project,
      globalTarget(project, 'spatial-world-a', locationId),
      { source: 'surface', surfaceId },
      { expectedRevision: project.revision, now: NOW },
    )
    expect(worldToSurface).toMatchObject({ ok: true, historyEntry: true })
    expect(locateCourseLayer(worldToSurface.nextDocument!, 'spatial-world-a')?.source).toBe('surface')
    expect(locateCourseLayer(worldToSurface.nextDocument!, 'spatial-world-a')?.item.frame)
      .toEqual(worldFrame)

    const reordered = reorderEffectiveLayerItems(
      project,
      globalTarget(project, 'spatial-world-a', locationId),
      ['spatial-world-b', 'spatial-world-a'],
      { expectedRevision: project.revision, now: NOW },
    )
    expect(reordered).toMatchObject({ ok: true, historyEntry: true })
    expect(reordered.nextDocument?.revision).toBe(project.revision + 1)
    const reorderedSurface = reordered.nextDocument?.surfaces.find(
      (candidate) => candidate.id === surfaceId,
    )
    if (!reorderedSurface || reorderedSurface.type !== 'spatial-2d') {
      throw new Error('expected reordered spatial surface')
    }
    expect(reorderedSurface.world.layerItems.map((item) => item.layerItemId))
      .toEqual(['spatial-world-b', 'spatial-world-a'])
  })

  it('keeps the teacher controller global and refuses moving it onto a scene', () => {
    const project = v9LayerFixture()
    const moved = moveEffectiveLayerOwner(
      project,
      globalTarget(project, 'teacher-controller-main'),
      { source: 'scene', surfaceId: 'surface-slide', sceneId: 'scene-1' },
      { expectedRevision: 1, now: NOW },
    )
    expect(moved).toMatchObject({ ok: false, reason: CONTROLLER_MOVE_REASON, historyEntry: false })
    expect(locateCourseLayer(project, 'teacher-controller-main')?.source).toBe('global')
    expect(isTeacherControllerLayerItem(findGlobalTeacherController(project)?.item)).toBe(true)

    const duplicated = duplicateEffectiveLayerItem(
      project,
      globalTarget(project, 'teacher-controller-main'),
      { expectedRevision: 1, now: NOW },
    )
    expect(duplicated.ok).toBe(false)
    expect(duplicated.historyEntry).toBe(false)
    expect(duplicated.reason).toContain('教师控制器不能重复')
  })

  it('toggles current-location visibility without changing active location or course order', () => {
    const project = v9LayerFixture()
    const locationOrder = project.locations.map((location) => location.id)
    const hidden = setGlobalLayerVisibleAtLocation(
      project,
      globalTarget(project, 'global-banner', 'location-scene-2'),
      false,
      { expectedRevision: 1, now: NOW },
    )
    expect(hidden).toMatchObject({ ok: true, historyEntry: true })
    const next = hidden.nextDocument!
    expect(next.startLocationId).toBe('location-scene-1')
    expect(next.locations.map((location) => location.id)).toEqual(locationOrder)
    const banner = next.globalLayerItems.find((entry) => entry.item.layerItemId === 'global-banner')!
    expect(banner.visibility).toEqual({
      mode: 'exclude',
      locationIds: ['location-scene-2'],
    })
    expect(isCourseLayerVisibleAtLocation(banner, 'location-scene-1')).toBe(true)
    expect(isCourseLayerVisibleAtLocation(banner, 'location-scene-2')).toBe(false)
    expect(listEffectiveLayerCommandItems({
      project: next,
      locationId: 'location-scene-2',
    }).some((item) => item.id === 'global-banner')).toBe(false)
    expect(listEffectiveLayerCommandItems({
      project: next,
      locationId: 'location-scene-1',
    }).some((item) => item.id === 'global-banner')).toBe(true)

    const shown = setGlobalLayerVisibleAtLocation(
      next,
      globalTarget(next, 'global-banner', 'location-scene-2'),
      true,
      { expectedRevision: next.revision, now: NOW },
    )
    expect(shown.ok).toBe(true)
    const restored = shown.nextDocument!.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )!
    expect(restored.visibility).toEqual({ mode: 'all', locationIds: [] })

    const includeOnly = setGlobalLayerLocationVisibility(
      project,
      globalTarget(project, 'global-footer'),
      { mode: 'include', locationIds: ['location-scene-2'] },
      { expectedRevision: 1, now: NOW },
    )
    expect(includeOnly.ok).toBe(true)
    expect(includeOnly.nextDocument?.startLocationId).toBe(project.startLocationId)
    expect(includeOnly.nextDocument?.locations.map((location) => location.id)).toEqual(locationOrder)
  })

  it('locks, duplicates, deletes and state-hides with one history entry each', () => {
    const project = v9LayerFixture()
    const locked = patchEffectiveLayerItem(
      project,
      globalTarget(project, 'global-banner'),
      { locked: true },
      { expectedRevision: 1, now: NOW },
    )
    expect(locked).toMatchObject({ ok: true, historyEntry: true })
    expect(patchEffectiveLayerItem(
      locked.nextDocument!,
      globalTarget(locked.nextDocument!, 'global-banner'),
      { visible: false },
      { expectedRevision: locked.nextDocument!.revision, now: NOW },
    )).toMatchObject({ ok: false, reason: LAYER_REJECT_LOCKED, historyEntry: false })

    const unlocked = patchEffectiveLayerItem(
      locked.nextDocument!,
      globalTarget(locked.nextDocument!, 'global-banner'),
      { locked: false },
      { expectedRevision: locked.nextDocument!.revision, now: NOW },
    )
    expect(unlocked.ok).toBe(true)

    const duplicated = duplicateEffectiveLayerItem(
      unlocked.nextDocument!,
      globalTarget(unlocked.nextDocument!, 'global-banner'),
      { expectedRevision: unlocked.nextDocument!.revision, now: NOW },
    )
    expect(duplicated).toMatchObject({ ok: true, historyEntry: true })
    expect(duplicated.createdLayerItemId).toBeTruthy()
    expect(duplicated.createdLayerItemId).not.toBe('global-banner')
    expect(duplicated.nextDocument?.globalLayerItems.some(
      (entry) => entry.item.layerItemId === duplicated.createdLayerItemId,
    )).toBe(true)

    const deleted = deleteEffectiveLayerItem(
      duplicated.nextDocument!,
      globalTarget(duplicated.nextDocument!, duplicated.createdLayerItemId!),
      { expectedRevision: duplicated.nextDocument!.revision, now: NOW },
    )
    expect(deleted).toMatchObject({ ok: true, historyEntry: true })
    expect(deleted.reason).toContain('全课横幅 副本')

    const hiddenInState = deleteEffectiveLayerItem(
      project,
      sceneTarget(project, 'slide-title', 'state-explain'),
      { expectedRevision: 1, now: NOW },
    )
    expect(hiddenInState).toMatchObject({ ok: true, historyEntry: true })
    expect(hiddenInState.reason).toContain('当前状态隐藏')
    const scene = hiddenInState.nextDocument?.surfaces[0]
    if (!scene || scene.type !== 'slide') throw new Error('expected slide')
    expect(scene.scenes[0]!.layerItems.some((item) => item.layerItemId === 'slide-title')).toBe(true)
    expect(scene.scenes[0]!.presentation?.states.find((state) => state.id === 'state-explain')
      ?.layerItemOverrides['slide-title']).toMatchObject({ visible: false })
    expect(courseProjectDocumentSchema.safeParse(hiddenInState.nextDocument).success).toBe(true)
  })

  it('writes the surface base item under a named state and still rejects scene named-state atomic writes', () => {
    const project = v9LayerFixture()
    const surfaceTarget: EffectiveLayerCommandTarget = {
      ...globalTarget(project, 'surface-shared'),
      stateId: 'state-explain',
    }
    const renamed = patchEffectiveLayerItems(project, [
      { target: surfaceTarget, patch: { label: '表面共享（已更新）', opacity: 0.5 } },
    ], { expectedRevision: 1, now: NOW })
    expect(renamed).toMatchObject({ ok: true, historyEntry: true })
    const surface = renamed.nextDocument?.surfaces.find(
      (candidate) => candidate.id === 'surface-slide',
    )
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    expect(surface.surfaceLayerItems[0]!.item).toMatchObject({
      layerItemId: 'surface-shared',
      label: '表面共享（已更新）',
      opacity: 0.5,
    })
    const scene = surface.scenes.find((candidate) => candidate.id === 'scene-1')!
    expect(scene.presentation?.states.every(
      (state) => !('surface-shared' in state.layerItemOverrides),
    )).toBe(true)
    expect(courseProjectDocumentSchema.safeParse(renamed.nextDocument).success).toBe(true)

    const sceneWrite = patchEffectiveLayerItems(project, [
      { target: sceneTarget(project, 'slide-title', 'state-explain'), patch: { label: '不应写入' } },
    ], { expectedRevision: 1, now: NOW })
    expect(sceneWrite).toMatchObject({ ok: false, historyEntry: false })
    expect(sceneWrite.reason).toContain('命名状态')
    expect(locateCourseLayer(project, 'slide-title')?.item.label).toBe('本页标题')
  })

  it('rejects stale revision and restores a missing controller as a global item', () => {
    const project = v9LayerFixture()
    expect(reorderEffectiveLayerItems(
      project,
      globalTarget(project, 'global-banner'),
      ['global-banner', 'global-footer', 'teacher-controller-main'],
      { expectedRevision: 99, now: NOW },
    )).toMatchObject({ ok: false, reason: LAYER_REJECT_STALE_REVISION })

    const withoutController = deleteEffectiveLayerItem(
      project,
      globalTarget(project, 'teacher-controller-main'),
      { expectedRevision: 1, now: NOW },
    )
    expect(withoutController.ok).toBe(true)
    expect(findGlobalTeacherController(withoutController.nextDocument!)).toBeUndefined()
    expect(withoutController.nextDocument?.playback.controls).toBe('none')
    expect(courseProjectDocumentSchema.safeParse(withoutController.nextDocument).success).toBe(true)

    const restored = restoreDefaultTeacherController(withoutController.nextDocument!, {
      expectedRevision: withoutController.nextDocument!.revision,
      now: NOW,
    })
    expect(restored).toMatchObject({ ok: true, historyEntry: true })
    const controller = findGlobalTeacherController(restored.nextDocument!)
    expect(controller).toBeDefined()
    expect(locateCourseLayer(restored.nextDocument!, controller!.item.layerItemId)?.source).toBe('global')
    expect(controller?.item.kind === 'native' &&
      controller.item.content.nativeType === 'teacher-controller' &&
      controller.item.content.data.defaultCollapsed).toBe(true)
    expect(restored.nextDocument?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === controller?.item.layerItemId,
    )?.plane).toBe('overlay')
    expect(restored.nextDocument?.playback.controls).toBe('canvas')
    expect(courseProjectDocumentSchema.safeParse(restored.nextDocument).success).toBe(true)
  })

  it.each([true, false])(
    'preserves an existing explicit defaultCollapsed=%s during a no-op restore',
    (defaultCollapsed) => {
      const project = v9LayerFixture()
      const controller = findGlobalTeacherController(project)
      if (!controller || !isTeacherControllerLayerItem(controller.item)) {
        throw new Error('expected teacher controller')
      }
      controller.item.content.data.defaultCollapsed = defaultCollapsed
      const beforeRestore = structuredClone(project)

      const restored = restoreDefaultTeacherController(project, {
        expectedRevision: project.revision,
        now: NOW,
      })

      expect(restored).toMatchObject({ ok: true, historyEntry: false })
      expect(restored.nextDocument).toBe(project)
      expect(project).toEqual(beforeRestore)
      expect(controller.item.content.data.defaultCollapsed).toBe(defaultCollapsed)
      expect(project.revision).toBe(beforeRestore.revision)
    },
  )
})
