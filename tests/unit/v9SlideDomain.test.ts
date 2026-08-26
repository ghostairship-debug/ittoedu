import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type ComponentLayerItem,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  activateSlidePresentationState,
  activateSlideScene,
  addSlidePresentationState,
  addSlideScene,
  buildSlideAuthoringSnapshot,
  buildSlideEditorView,
  createSlideAuthoringBackend,
  deleteSlidePresentationState,
  deleteSlideScene,
  duplicateSlidePresentationState,
  duplicateSlideScene,
  makeSlideAuthoringTarget,
  openSlideAuthoringSession,
  redoSlideAuthoring,
  renameSlidePresentationState,
  renameSlideScene,
  reorderSlidePresentationStates,
  reorderSlideScenes,
  selectSlideLayers,
  setSlideEditingScope,
  slideAuthoringGeneration,
  transformSlideNativeLayers,
  undoSlideAuthoring,
  type SlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'

/**
 * V9 fixture. Proves Slide domain (session / scene / state / selection / history).
 * Does not prove a real Workspace, MediaTab, Player, or default V8 App open/save.
 */
const NOW = '2026-08-17T13:00:00.000Z'

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

function scoped(item: NativeLayerItem, locationIds: string[] = []): ScopedLayerItem {
  return {
    item,
    visibility: locationIds.length === 0
      ? { mode: 'all', locationIds: [] }
      : { mode: 'include', locationIds },
  }
}

function sceneComponent(layerItemId: string, order: number): ComponentLayerItem {
  return {
    layerItemId,
    label: '积分器',
    frame: { mode: 'absolute', x: 400, y: 160, width: 240, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'component',
    component: { packageId: 'component.quiz', version: '4.0.0' },
    props: { title: '画布内积分器' },
  }
}

function teacherController(layerItemId: string, order: number, targetId: string): NativeLayerItem {
  return {
    layerItemId,
    label: '教师控制',
    frame: { mode: 'absolute', x: 40, y: 40, width: 260, height: 100 },
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
          label: '前往场景',
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

function v9SlideFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r2a-slide-domain',
    revision: 1,
    title: 'R2-A Slide domain',
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
    globalLayerItems: [scoped(nativeText('global-banner', 50, '全局条'))],
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
        id: 'location-flow',
        label: '讲义',
        kind: 'flow-block',
        surfaceId: 'surface-flow',
        blockId: 'flow-h1',
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
          scoped(nativeText('surface-shared', 25, '表面共享', {
            frame: { mode: 'absolute', x: 80, y: 200, width: 180, height: 60 },
          }), ['location-scene-1']),
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
          ],
          interactions: [],
        }],
      },
      {
        id: 'surface-flow',
        title: '讲义',
        type: 'flow',
        surfaceLayerItems: [],
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [{ type: 'heading', id: 'flow-h1', level: 1, text: '讲义' }],
      },
    ],
    mixedPrintPlan: {
      pageSize: 'A4',
      orientation: 'auto',
      entries: [
        { id: 'print-slide', kind: 'slide-scenes', surfaceId: 'surface-slide', sceneIds: ['scene-1'] },
        { id: 'print-flow', kind: 'flow-document', surfaceId: 'surface-flow' },
      ],
    },
  })
}

function requireSession(result: { ok: boolean; nextSession?: SlideAuthoringSession }) {
  if (!result.ok || !result.nextSession) throw new Error(result.ok ? 'missing session' : 'command failed')
  return result.nextSession
}

function slideSurface(project: CourseProjectDocument) {
  const surface = project.surfaces.find((candidate) => candidate.id === 'surface-slide')
  if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
  return surface
}

function activeSceneId(session: SlideAuthoringSession) {
  const location = session.history.present.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') throw new Error('expected Slide location')
  return location.sceneId
}

describe('V9 Slide domain', () => {
  it('opens a proven Course Project V9 document and exposes snapshot/target without hitId', () => {
    const project = v9SlideFixture()
    const session = openSlideAuthoringSession(project)
    const snapshot = buildSlideAuthoringSnapshot(session)
    const target = makeSlideAuthoringTarget(session, 'slide-title')

    expect(snapshot).toMatchObject({
      sessionId: session.sessionId,
      locationId: 'location-scene-1',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      stateId: null,
      scope: 'scene',
      revision: 1,
      selection: { locationId: 'location-scene-1', stateId: null, selectionIds: [] },
    })
    expect(session.history.present).toEqual(courseProjectDocumentSchema.parse(project))
    expect(target.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r2a-slide-domain',
      scope: 'scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      carrier: 'native',
      layerItemId: 'slide-title',
      field: 'content.data.text',
    }))
    expect(target.authoringAddress).not.toMatch(/hit/i)
    expect(JSON.stringify(target)).not.toMatch(/hitId/)
  })

  it('adds a scene on the current Slide surface without hiding old content or other locations', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const flowBefore = session.history.present.locations.find((location) => location.id === 'location-flow')
    const added = addSlideScene(session, { now: NOW, expectedRevision: 1 })
    const next = requireSession(added)

    expect(added.ok).toBe(true)
    expect(added.historyEntry).toBe(true)
    expect(next.history.present.revision).toBe(2)
    expect(next.history.past).toEqual([session.history.present])
    expect(next.history.present.surfaces.filter((surface) => surface.type === 'slide')).toHaveLength(1)
    expect(slideSurface(next.history.present).scenes.map((scene) => scene.id)).toEqual([
      'scene-1',
      activeSceneId(next),
    ])
    expect(slideSurface(next.history.present).scenes[0]?.layerItems.map((item) => item.layerItemId))
      .toEqual(['slide-title', 'slide-locked'])
    expect(next.history.present.locations.find((location) => location.id === 'location-flow'))
      .toEqual(flowBefore)
    expect(next.history.present.locations.filter((location) => location.kind === 'flow-block'))
      .toHaveLength(1)
    expect(next.selection.selectionIds).toEqual([])
    expect(next.scope).toBe('scene')
    expect(courseProjectDocumentSchema.parse(next.history.present)).toEqual(next.history.present)
  })

  it('commits each scene mutation once and clears selection when switching scene/scope', () => {
    const initial = openSlideAuthoringSession(v9SlideFixture())
    const selected = requireSession(selectSlideLayers(initial, { nodeIds: ['slide-title'] }))
    expect(selected.selection.selectionIds).toEqual(['slide-title'])
    expect(selected.history).toBe(initial.history)

    const scoped = requireSession(setSlideEditingScope(selected, 'global'))
    expect(scoped.history.present).toBe(initial.history.present)
    expect(scoped.scope).toBe('global')
    expect(scoped.selection.selectionIds).toEqual([])
    expect(scoped.generation).toBeGreaterThan(selected.generation)
    expect(slideAuthoringGeneration(scoped.sessionId)).toBe(scoped.generation)

    const activated = requireSession(activateSlideScene(scoped, 'scene-1'))
    expect(activated.scope).toBe('scene')
    expect(activated.selection).toMatchObject({ stateId: null, selectionIds: [] })
    expect(activated.history.present).toBe(initial.history.present)

    const added = requireSession(addSlideScene(activated, { now: NOW }))
    const addedId = activeSceneId(added)
    const renamed = requireSession(renameSlideScene(added, addedId, '新场景', { now: NOW }))
    expect(renamed.history.present.revision).toBe(added.history.present.revision + 1)
    const duplicated = requireSession(duplicateSlideScene(renamed, addedId, { now: NOW }))
    const duplicateId = activeSceneId(duplicated)
    expect(duplicateId).not.toBe(addedId)
    expect(duplicated.history.present.revision).toBe(renamed.history.present.revision + 1)

    const reorderedIds = [...slideSurface(duplicated.history.present).scenes.map((scene) => scene.id)].reverse()
    const reordered = requireSession(reorderSlideScenes(duplicated, reorderedIds, { now: NOW }))
    expect(slideSurface(reordered.history.present).scenes.map((scene) => scene.id)).toEqual(reorderedIds)
    expect(reordered.history.present.revision).toBe(duplicated.history.present.revision + 1)

    const deleted = requireSession(deleteSlideScene(reordered, duplicateId, { now: NOW }))
    expect(slideSurface(deleted.history.present).scenes.map((scene) => scene.id)).not.toContain(duplicateId)
    expect(deleted.history.present.revision).toBe(reordered.history.present.revision + 1)
    expect(courseProjectDocumentSchema.parse(deleted.history.present)).toEqual(deleted.history.present)

    const undone = requireSession(undoSlideAuthoring(deleted))
    expect(slideSurface(undone.history.present).scenes.map((scene) => scene.id)).toContain(duplicateId)
    const redone = requireSession(redoSlideAuthoring(undone))
    expect(slideSurface(redone.history.present).scenes.map((scene) => scene.id)).not.toContain(duplicateId)
    expect(renameSlideScene(initial, 'scene-1', '   ').historyEntry).toBe(false)
    expect(renameSlideScene(initial, 'scene-1', '场景 1').nextSession?.history.present)
      .toBe(initial.history.present)
  })

  it('separates deleted Slide scene, controller alias, and layer-item reference domains', () => {
    const initial = openSlideAuthoringSession(v9SlideFixture())
    const added = requireSession(addSlideScene(initial, { now: NOW }))
    const removedSceneId = activeSceneId(added)
    const project = structuredClone(added.history.present)
    const slide = slideSurface(project)
    const removedScene = slide.scenes.find((scene) => scene.id === removedSceneId)
    const keptScene = slide.scenes.find((scene) => scene.id !== removedSceneId)
    const flow = project.surfaces.find((surface) => surface.id === 'surface-flow')
    const flowLocation = project.locations.find((location) => location.id === 'location-flow')
    if (!removedScene || !keptScene || !flow || flow.type !== 'flow') {
      throw new Error('expected mixed Slide/Flow fixture')
    }
    if (!flowLocation || flowLocation.kind !== 'flow-block') {
      throw new Error('expected Flow location')
    }
    const flowHeading = flow.blocks[0]
    if (!flowHeading || flowHeading.type !== 'heading') throw new Error('expected Flow heading')
    flowHeading.id = removedSceneId
    flowLocation.blockId = removedSceneId
    removedScene.layerItems.push(
      nativeText('removed-node', 1, '待删元素'),
      nativeText('same-layer-id', 2, '同名元素'),
    )
    keptScene.layerItems.push(nativeText('same-layer-id', 3, '保留的同名元素'))
    project.globalLayerItems.push(scoped(teacherController(
      'controller-kept-by-flow-alias',
      60,
      removedSceneId,
    )))
    project.globalInteractions = [
      {
        id: 'drop-slide-scene-reference',
        enabled: true,
        trigger: { type: 'presenter.command', command: 'next' },
        conditions: [{ type: 'scene.in', sceneIds: [removedSceneId] }],
        actions: [{
          id: 'drop-slide-scene-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'drop-removed-layer-reference',
        enabled: true,
        trigger: { type: 'node.click', nodeId: 'removed-node' },
        conditions: [],
        actions: [{
          id: 'drop-removed-layer-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'keep-same-layer-id',
        enabled: true,
        trigger: { type: 'node.click', nodeId: 'same-layer-id' },
        conditions: [],
        actions: [{
          id: 'keep-same-layer-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
    ]
    const session = openSlideAuthoringSession(courseProjectDocumentSchema.parse(project))

    const deleted = requireSession(deleteSlideScene(session, removedSceneId, { now: NOW }))

    expect(deleted.history.present.globalInteractions.map((rule) => rule.id))
      .toEqual(['keep-same-layer-id'])
    const controller = deleted.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'controller-kept-by-flow-alias',
    )?.item
    expect(controller?.kind === 'native' && controller.content.nativeType === 'teacher-controller'
      ? controller.content.data.buttons[0]?.action
      : undefined).toEqual({ type: 'scene.go', sceneId: removedSceneId })
    expect(courseProjectDocumentSchema.parse(deleted.history.present))
      .toEqual(deleted.history.present)
  })

  it('keeps base state distinct from named-state overrides and commits state commands once', () => {
    const initial = openSlideAuthoringSession(v9SlideFixture())
    const selected = requireSession(selectSlideLayers(initial, { nodeIds: ['slide-title'] }))
    const base = requireSession(activateSlidePresentationState(selected, null))
    expect(base.history.present).toBe(initial.history.present)
    expect(base.selection).toMatchObject({ stateId: null, selectionIds: [] })

    const added = requireSession(addSlidePresentationState(base, '展开', { now: NOW }))
    const addedId = added.selection.stateId
    expect(addedId).toBeTruthy()
    expect(added.history.present.revision).toBe(2)
    const duplicated = requireSession(duplicateSlidePresentationState(added, addedId!, { now: NOW }))
    const duplicateId = duplicated.selection.stateId!
    expect(duplicateId).not.toBe(addedId)
    const renamed = requireSession(
      renameSlidePresentationState(duplicated, duplicateId, '讲解', { now: NOW }),
    )
    const reordered = requireSession(reorderSlidePresentationStates(
      renamed,
      [duplicateId, addedId!],
      { now: NOW },
    ))
    expect(slideSurface(reordered.history.present).scenes[0]!.presentation!.states.map((state) => state.id))
      .toEqual([duplicateId, addedId])

    const selectedText = requireSession(selectSlideLayers(reordered, { nodeIds: ['slide-title'] }))
    const moved = requireSession(transformSlideNativeLayers(selectedText, {
      nodes: [{
        nodeId: 'slide-title',
        x: 330,
        y: 100,
        width: 400,
        height: 80,
        rotation: 12,
      }],
    }, { now: NOW }))
    const scene = slideSurface(moved.history.present).scenes[0]!
    const baseTitle = scene.layerItems.find((item) => item.layerItemId === 'slide-title')!
    const override = scene.presentation!.states.find((state) => state.id === duplicateId)!
      .layerItemOverrides['slide-title']
    expect(baseTitle.frame).toMatchObject({ x: 120, y: 120, width: 400 })
    expect(baseTitle.rotation).toBe(0)
    expect(override).toMatchObject({ frame: { x: 330, y: 100 }, rotation: 12 })

    const namedView = buildSlideEditorView({
      project: moved.history.present,
      locationId: moved.selection.locationId,
      stateId: duplicateId,
    })
    const baseView = buildSlideEditorView({
      project: moved.history.present,
      locationId: moved.selection.locationId,
      stateId: null,
    })
    expect(namedView.layers.find((layer) => layer.selectionId === 'slide-title')?.item.frame.x).toBe(330)
    expect(baseView.layers.find((layer) => layer.selectionId === 'slide-title')?.item.frame.x).toBe(120)

    const deleted = requireSession(deleteSlidePresentationState(moved, duplicateId, { now: NOW }))
    expect(deleted.selection.stateId).toBe(slideSurface(deleted.history.present).scenes[0]!.presentation!.initialStateId)
    expect(deleted.history.present.revision).toBe(moved.history.present.revision + 1)
    expect(courseProjectDocumentSchema.safeParse(deleted.history.present).success).toBe(true)
  })

  it('rejects locked writes, stale revision and global/surface owner edits with unified reasons', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const lockedSelected = requireSession(selectSlideLayers(session, { nodeIds: ['slide-locked'] }))
    const locked = transformSlideNativeLayers(lockedSelected, {
      nodes: [{
        nodeId: 'slide-locked',
        x: 200,
        y: 220,
        width: 400,
        height: 80,
        rotation: 0,
      }],
    }, { now: NOW, expectedRevision: 1 })
    expect(locked).toMatchObject({
      ok: false,
      reason: SLIDE_REJECT_LOCKED,
      historyEntry: false,
    })
    expect(locked.nextSession?.history.present).toBe(session.history.present)

    const stale = addSlideScene(session, { now: NOW, expectedRevision: 0 })
    expect(stale).toMatchObject({
      ok: false,
      reason: SLIDE_REJECT_STALE_REVISION,
      historyEntry: false,
    })

    const surfaceScope = requireSession(setSlideEditingScope(session, 'surface'))
    const surfaceSelected = requireSession(
      selectSlideLayers(surfaceScope, { nodeIds: ['surface-shared'] }),
    )
    const wrongOwner = transformSlideNativeLayers(surfaceSelected, {
      nodes: [{
        nodeId: 'surface-shared',
        x: 90,
        y: 200,
        width: 180,
        height: 60,
        rotation: 0,
      }],
    }, { now: NOW })
    expect(wrongOwner).toMatchObject({
      ok: false,
      reason: SLIDE_REJECT_WRONG_OWNER,
      historyEntry: false,
    })
    expect(selectSlideLayers(session, { nodeIds: ['surface-shared'] }).ok).toBe(false)
    expect(deleteSlidePresentationState(session, 'missing-state').ok).toBe(false)
  })

  it('writes scene component frames through transformSlideNativeLayers', () => {
    const project = courseProjectDocumentSchema.parse({
      ...v9SlideFixture(),
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
    })
    const scene = slideSurface(project).scenes[0]!
    scene.layerItems.push(sceneComponent('slide-component', 3))
    const session = openSlideAuthoringSession(courseProjectDocumentSchema.parse(project))
    const selected = requireSession(selectSlideLayers(session, { nodeIds: ['slide-component'] }))
    const moved = requireSession(transformSlideNativeLayers(selected, {
      nodes: [{
        nodeId: 'slide-component',
        x: 480,
        y: 260,
        width: 320,
        height: 220,
        rotation: 8,
      }],
    }, { now: NOW }))
    const item = slideSurface(moved.history.present).scenes[0]!.layerItems.find(
      (candidate) => candidate.layerItemId === 'slide-component',
    )!
    expect(item.kind).toBe('component')
    expect(item.frame).toMatchObject({ x: 480, y: 260, width: 320, height: 220 })
    expect(item.rotation).toBe(8)
    expect(moved.history.present.revision).toBe(2)
  })

  it('exposes an injectable candidate backend without touching store or V8 project', () => {
    const project = v9SlideFixture()
    const backend = createSlideAuthoringBackend(openSlideAuthoringSession(project))
    expect(backend.kind).toBe('slide-authoring')
    const added = backend.addScene({ now: NOW, expectedRevision: backend.getSnapshot().revision })
    expect(added.ok).toBe(true)
    expect(backend.getSnapshot().sceneId).not.toBe('scene-1')
    expect(backend.getSnapshot().revision).toBe(2)
    expect(project.revision).toBe(1)
    expect(slideSurface(project).scenes).toHaveLength(1)
  })
})
