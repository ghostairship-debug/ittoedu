import { beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeTargetEditSession } from '@/renderer/authoring/runtimeTargetEditSession'
import { isFlowEditorTransactionFrame } from '@/renderer/course/flowEditorSlice'
import { isSlideAuthoringTransactionFrame } from '@/renderer/course/slideEditorCommands'
import { isSpatialAuthoringTransactionFrame } from '@/renderer/course/spatialAuthoringHistory'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  captureCourseRuntimeAssetReplacementTarget,
  type CourseRuntimeAssetReplacementTarget,
} from '@/renderer/runtime/courseRuntimeTransactions'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/projectTypes'

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const ARCHIVE_TIME = '2026-08-24T12:00:00.000Z'
const BINDING_KEY = 'hero'
const OLD_ASSET_ID = 'runtime-original-image'
const SECOND_ASSET_ID = 'runtime-secondary-image'

type FixtureKind =
  | 'slide-scene'
  | 'slide-surface'
  | 'global'
  | 'flow-surface'
  | 'flow-global'
  | 'spatial-surface'
  | 'spatial-world'
  | 'spatial-global'
type ActiveHistoryKind = 'slide' | 'flow' | 'spatial'

interface ImageInput {
  readonly meta: AssetMeta
  readonly bytes: Uint8Array
}

interface RuntimeStoreFixture {
  readonly kind: FixtureKind
  readonly project: CourseProjectDocument
  readonly assetFiles: Record<string, Uint8Array>
  readonly locationId: string
  readonly surfaceId: string
  readonly sceneId: string | null
  readonly owner: 'global' | 'scene' | 'surface' | 'world'
  readonly itemId: string
  readonly secondaryItemId: string | null
}

function image(
  id: string,
  values: ArrayLike<number> = [1, 2, 3, 4],
  patch: Partial<AssetMeta> = {},
): ImageInput {
  const bytes = Uint8Array.from(values)
  return {
    meta: {
      id,
      filename: `${id}.png`,
      mimeType: 'image/png',
      kind: 'image',
      path: `assets/${id}.png`,
      byteLength: bytes.byteLength,
      width: 800,
      height: 600,
      ...patch,
    },
    bytes,
  }
}

function runtimeLayer(
  id: string,
  assetId: string,
  order: number,
  protocol: 'canvas-runtime' | 'surface-runtime',
): RuntimeLayerItem {
  return {
    kind: 'runtime',
    layerItemId: id,
    label: `Runtime ${id}`,
    frame: { mode: 'absolute', x: 120, y: 80, width: 640, height: 360 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    runtime: protocol === 'canvas-runtime'
      ? {
          protocol,
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'phaser',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
          content: { values: { title: id } },
          assets: { [BINDING_KEY]: { assetId } },
        }
      : {
          protocol,
          runtimeApiVersion: 3,
          enabled: true,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
          content: { values: { title: id } },
          assets: { [BINDING_KEY]: { assetId } },
        },
  }
}

function runtimeFixture(
  kind: FixtureKind,
  options: {
    readonly multiple?: boolean
    readonly stateLocks?: 'a-unlocked-b-locked' | 'a-locked-b-unlocked'
  } = {},
): RuntimeStoreFixture {
  let sequence = 0
  const base = createBlankCourseProject({
    id: `arch2-runtime-${kind}`,
    title: `ARCH-2 Runtime ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => `fixture-${++sequence}`,
  })
  const old = image(OLD_ASSET_ID, [9, 8, 7, 6])
  const secondary = image(SECOND_ASSET_ID, [5, 4, 3, 2])
  const itemId = `runtime-${kind}-primary`
  const secondaryItemId = options.multiple ? `runtime-${kind}-secondary` : null
  const protocol = kind.startsWith('flow-') || kind.startsWith('spatial-')
    ? 'surface-runtime'
    : 'canvas-runtime'
  // V9 carrier arrays are stored in strictly increasing canonical order.
  const primary = runtimeLayer(itemId, old.meta.id, 1, protocol)
  const layerItems = [
    primary,
    ...(secondaryItemId
      ? [runtimeLayer(secondaryItemId, secondary.meta.id, 900, protocol)]
      : []),
  ]
  const assets = {
    [old.meta.id]: old.meta,
    ...(secondaryItemId ? { [secondary.meta.id]: secondary.meta } : {}),
  }
  const assetFiles = {
    [old.meta.id]: old.bytes,
    ...(secondaryItemId ? { [secondary.meta.id]: secondary.bytes } : {}),
  }

  if (kind === 'slide-scene' || kind === 'slide-surface' || kind === 'global') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected the blank Slide surface')
    const scene = structuredClone(surface.scenes[0]!)
    if (options.stateLocks) {
      primary.locked = true
      const aLocked = options.stateLocks === 'a-locked-b-unlocked'
      scene.presentation = {
        initialStateId: 'state-a',
        thumbnailStateId: 'state-a',
        states: [
          {
            id: 'state-a',
            name: 'State A',
            layerItemOverrides: { [itemId]: { locked: aLocked } },
          },
          {
            id: 'state-b',
            name: 'State B',
            layerItemOverrides: { [itemId]: { locked: !aLocked } },
          },
        ],
      }
    }
    if (kind === 'slide-scene') scene.layerItems = layerItems
    const project = courseProjectDocumentSchema.parse({
      ...base,
      assets,
      globalLayerItems: kind === 'global'
        ? layerItems.map((item) => ({
            item,
            visibility: { mode: 'all' as const, locationIds: [] },
          }))
        : [],
      surfaces: [{
        ...surface,
        surfaceLayerItems: kind === 'slide-surface'
          ? layerItems.map((item) => ({
              item,
              visibility: { mode: 'all' as const, locationIds: [] },
            }))
          : [],
        scenes: [scene],
      }],
    })
    return {
      kind,
      project,
      assetFiles,
      locationId: project.locations[0]!.id,
      surfaceId: surface.id,
      sceneId: kind === 'slide-scene' ? scene.id : null,
      owner: kind === 'global'
        ? 'global'
        : kind === 'slide-surface'
          ? 'surface'
          : 'scene',
      itemId,
      secondaryItemId,
    }
  }

  if (kind === 'flow-surface' || kind === 'flow-global') {
    const surfaceId = 'runtime-flow-surface'
    const locationId = 'runtime-flow-location'
    const blockId = 'runtime-flow-heading'
    const project = courseProjectDocumentSchema.parse({
      ...base,
      assets,
      globalLayerItems: kind === 'flow-global'
        ? layerItems.map((item) => ({
            item,
            visibility: { mode: 'all' as const, locationIds: [] },
          }))
        : [],
      locations: [{
        id: locationId,
        label: 'Runtime Flow',
        kind: 'flow-block',
        surfaceId,
        blockId,
      }],
      startLocationId: locationId,
      surfaces: [{
        id: surfaceId,
        title: 'Runtime Flow',
        type: 'flow',
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        surfaceLayerItems: kind === 'flow-surface'
          ? layerItems.map((item) => ({
              item,
              visibility: { mode: 'all' as const, locationIds: [] },
            }))
          : [],
        blocks: [{ id: blockId, type: 'heading', level: 1, text: 'Runtime Flow' }],
      }],
    })
    return {
      kind,
      project,
      assetFiles,
      locationId,
      surfaceId,
      sceneId: null,
      owner: kind === 'flow-global' ? 'global' : 'surface',
      itemId,
      secondaryItemId,
    }
  }

  const surfaceId = 'runtime-spatial-surface'
  const locationId = 'runtime-spatial-location'
  const cameraFrameId = 'runtime-spatial-home'
  const project = courseProjectDocumentSchema.parse({
    ...base,
    assets,
    globalLayerItems: kind === 'spatial-global'
      ? layerItems.map((item) => ({
          item,
          visibility: { mode: 'all' as const, locationIds: [] },
        }))
      : [],
    locations: [{
      id: locationId,
      label: 'Runtime Spatial',
      kind: 'spatial-camera',
      surfaceId,
      cameraFrameId,
    }],
    startLocationId: locationId,
    surfaces: [{
      id: surfaceId,
      title: 'Runtime Spatial',
      type: 'spatial-2d',
      surfaceLayerItems: kind === 'spatial-surface'
        ? layerItems.map((item) => ({
            item,
            visibility: { mode: 'all' as const, locationIds: [] },
          }))
        : [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: kind === 'spatial-world' ? layerItems : [],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: cameraFrameId, name: 'Home', x: 0, y: 0, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  })
  return {
    kind,
    project,
    assetFiles,
    locationId,
    surfaceId,
    sceneId: null,
    owner: kind === 'spatial-global'
      ? 'global'
      : kind === 'spatial-surface'
        ? 'surface'
        : 'world',
    itemId,
    secondaryItemId,
  }
}

function loadRuntimeFixture(
  kind: FixtureKind,
  options?: Parameters<typeof runtimeFixture>[1],
): RuntimeStoreFixture {
  const source = runtimeFixture(kind, options)
  useEditorStore.getState().loadCourseProject(source.project, null, source.assetFiles, {})
  useEditorStore.getState().activateCourseLocation(source.locationId)
  if (source.owner === 'global') useEditorStore.getState().setEditingScope('global')
  return source
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function activeHistory() {
  const state = useEditorStore.getState()
  if (state.spatialSession) {
    return { kind: 'spatial' as const, history: state.spatialSession.history }
  }
  if (state.flowSession) {
    return { kind: 'flow' as const, history: state.flowSession.history }
  }
  if (state.slideBackend?.kind === 'slide-authoring') {
    return { kind: 'slide' as const, history: state.slideBackend.getSession().history }
  }
  throw new Error('Expected an active V9 authoring history')
}

function activeTransactionAssetIds(): string[] {
  const active = activeHistory()
  const frame = active.history.past.at(-1)
  const isTransaction = active.kind === 'slide'
    ? Boolean(frame && isSlideAuthoringTransactionFrame(frame))
    : active.kind === 'flow'
      ? Boolean(frame && isFlowEditorTransactionFrame(frame))
      : Boolean(frame && isSpatialAuthoringTransactionFrame(frame))
  expect(isTransaction).toBe(true)
  if (!frame || !('kind' in frame) || frame.kind !== 'editor-transaction') {
    throw new Error('Expected the newest history entry to be an editor transaction')
  }
  return frame.resourceChanges.assetFileChanges?.map((change) => change.assetId) ?? []
}

function resourceSnapshotDepths() {
  const state = useEditorStore.getState()
  return {
    sidecarPast: state.slideCandidateSidecarPast.length,
    sidecarFuture: state.slideCandidateSidecarFuture.length,
    componentPast: state.slideCandidateComponentPackagesPast.length,
    componentFuture: state.slideCandidateComponentPackagesFuture.length,
  }
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([assetId, bytes]) => [assetId, [...bytes]]),
  )
}

function runtimeItem(project: CourseProjectDocument, itemId: string): RuntimeLayerItem {
  const global = project.globalLayerItems.find(
    (entry) => entry.item.layerItemId === itemId,
  )?.item
  if (global?.kind === 'runtime') return global
  for (const surface of project.surfaces) {
    const shared = surface.surfaceLayerItems.find(
      (entry) => entry.item.layerItemId === itemId,
    )?.item
    if (shared?.kind === 'runtime') return shared
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        const item = scene.layerItems.find((candidate) => candidate.layerItemId === itemId)
        if (item?.kind === 'runtime') return item
      }
    }
    if (surface.type === 'spatial-2d') {
      const item = surface.world.layerItems.find(
        (candidate) => candidate.layerItemId === itemId,
      )
      if (item?.kind === 'runtime') return item
    }
  }
  throw new Error(`Missing Runtime layer ${itemId}`)
}

function runtimeAssetId(project: CourseProjectDocument, itemId: string): string {
  return runtimeItem(project, itemId).runtime.assets[BINDING_KEY]!.assetId
}

function discoverySession(
  source: RuntimeStoreFixture,
  targetId = `runtime:${source.kind}:host-discovery-token`,
): RuntimeTargetEditSession {
  const state = useEditorStore.getState()
  return {
    projectId: activeProject().id,
    scope: source.owner === 'global' ? 'global' : 'scene',
    sceneId: state.activeSceneId,
    targetId,
    nodeId: source.itemId,
    kind: 'asset',
    key: BINDING_KEY,
  }
}

function captureProjectedRuntimeTarget(
  source: RuntimeStoreFixture,
  targetId?: string,
): CourseRuntimeAssetReplacementTarget {
  const target = useEditorStore.getState().captureRuntimeAssetReplacementTarget(
    discoverySession(source, targetId),
  )
  if (!target) throw new Error('Expected a projected Slide Runtime target')
  return target
}

function captureDirectCarrierTarget(
  source: RuntimeStoreFixture,
): CourseRuntimeAssetReplacementTarget {
  const state = useEditorStore.getState()
  const session = state.courseAuthoringSession
  if (!session) throw new Error('Expected a Course authoring session')
  return captureCourseRuntimeAssetReplacementTarget({
    sessionToken: session.token,
    projectId: activeProject().id,
    surfaceId: source.surfaceId,
    stateId: state.activePresentationStateId,
    owner: source.owner,
    sceneId: source.sceneId,
    itemId: source.itemId,
    bindingKey: BINDING_KEY,
  })
}

function targetForStore(source: RuntimeStoreFixture): CourseRuntimeAssetReplacementTarget {
  return source.kind === 'slide-scene' || source.kind === 'global'
    ? captureProjectedRuntimeTarget(source)
    : captureDirectCarrierTarget(source)
}

function selectionSnapshot() {
  const state = useEditorStore.getState()
  return {
    activeSceneId: state.activeSceneId,
    activePresentationStateId: state.activePresentationStateId,
    selectedNodeId: state.selectedNodeId,
    selectedNodeIds: [...state.selectedNodeIds],
    editingScope: state.editingScope,
    slide: state.slideBackend?.kind === 'slide-authoring'
      ? structuredClone(state.slideBackend.getSession().selection)
      : null,
    flow: state.flowSession ? structuredClone(state.flowSession.selection) : null,
    spatial: state.spatialSession ? structuredClone(state.spatialSession.selection) : null,
  }
}

function authoritativeWriteSnapshot() {
  const state = useEditorStore.getState()
  const active = activeHistory()
  return {
    project: structuredClone(activeProject()),
    derivedProject: structuredClone(state.project),
    files: byteMap(selectMediaAssetFiles(state)),
    activeHistory: structuredClone(active.history),
    storeHistory: structuredClone(state.history),
    sidecarPast: state.slideCandidateSidecarPast.map(
      (sidecar) => byteMap(sidecar.files),
    ),
    sidecarFuture: state.slideCandidateSidecarFuture.map(
      (sidecar) => byteMap(sidecar.files),
    ),
    componentPackages: structuredClone(state.componentPackages),
    componentPast: structuredClone(state.slideCandidateComponentPackagesPast),
    componentFuture: structuredClone(state.slideCandidateComponentPackagesFuture),
    courseAuthoringSession: structuredClone(state.courseAuthoringSession),
    selection: selectionSnapshot(),
    dirty: state.dirty,
    statusMessage: state.statusMessage,
    errorMessage: state.errorMessage,
  }
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('ARCH-2 Runtime asset replacement Store vertical slice', () => {
  it.each([
    ['slide-scene', 'slide'] as const,
    ['slide-surface', 'slide'] as const,
    ['global', 'slide'] as const,
    ['flow-surface', 'flow'] as const,
    ['flow-global', 'flow'] as const,
    ['spatial-surface', 'spatial'] as const,
    ['spatial-world', 'spatial'] as const,
    ['spatial-global', 'spatial'] as const,
  ])('commits one atomic asset delta for %s through the current %s history', (
    fixtureKind,
    expectedHistoryKind: ActiveHistoryKind,
  ) => {
    const source = loadRuntimeFixture(fixtureKind)
    const target = targetForStore(source)
    const replacement = image(`runtime-${fixtureKind}-replacement`, [11, 12, 13, 14])
    const beforeProject = structuredClone(activeProject())
    const beforeFiles = byteMap(selectMediaAssetFiles(useEditorStore.getState()))
    const beforeHistoryDepth = activeHistory().history.past.length
    const beforeStoreHistoryDepth = useEditorStore.getState().history.past.length
    const beforeSnapshotDepths = resourceSnapshotDepths()
    const beforeSelection = selectionSnapshot()

    expect(activeHistory().kind).toBe(expectedHistoryKind)
    expect(target.courseTarget.itemId).toBe(source.itemId)
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      replacement.meta,
      replacement.bytes,
    )).toMatchObject({
      ok: true,
      status: 'replaced',
      feedback: {
        kind: 'runtime-asset-replaced',
        itemId: source.itemId,
        bindingKey: BINDING_KEY,
        previousAssetId: OLD_ASSET_ID,
        assetId: replacement.meta.id,
        assetDisposition: 'added',
      },
    })

    const committedProject = structuredClone(activeProject())
    const committedFiles = selectMediaAssetFiles(useEditorStore.getState())
    expect(committedProject.revision).toBe(beforeProject.revision + 1)
    expect(runtimeAssetId(committedProject, source.itemId)).toBe(replacement.meta.id)
    expect(committedProject.assets[replacement.meta.id]).toEqual(replacement.meta)
    expect(committedFiles[replacement.meta.id]).toEqual(replacement.bytes)
    expect(committedProject.assets[OLD_ASSET_ID]).toEqual(beforeProject.assets[OLD_ASSET_ID])
    expect(committedFiles[OLD_ASSET_ID]).toEqual(source.assetFiles[OLD_ASSET_ID])
    expect(activeHistory().history.past).toHaveLength(beforeHistoryDepth + 1)
    expect(useEditorStore.getState().history.past).toHaveLength(
      beforeStoreHistoryDepth + 1,
    )
    expect(activeTransactionAssetIds()).toEqual([replacement.meta.id])
    expect(resourceSnapshotDepths()).toEqual(beforeSnapshotDepths)
    expect(selectionSnapshot()).toEqual(beforeSelection)

    useEditorStore.getState().undo()
    expect(activeProject()).toEqual(beforeProject)
    expect(runtimeAssetId(activeProject(), source.itemId)).toBe(OLD_ASSET_ID)
    expect(activeProject().assets[replacement.meta.id]).toBeUndefined()
    expect(selectMediaAssetFiles(useEditorStore.getState())[replacement.meta.id])
      .toBeUndefined()
    expect(byteMap(selectMediaAssetFiles(useEditorStore.getState()))).toEqual(beforeFiles)
    expect(resourceSnapshotDepths()).toEqual(beforeSnapshotDepths)

    useEditorStore.getState().redo()
    expect(activeProject()).toEqual(committedProject)
    expect(runtimeAssetId(activeProject(), source.itemId)).toBe(replacement.meta.id)
    expect(selectMediaAssetFiles(useEditorStore.getState())[replacement.meta.id])
      .toEqual(replacement.bytes)
    expect(resourceSnapshotDepths()).toEqual(beforeSnapshotDepths)
  })

  it.each([
    'slide-surface',
    'flow-surface',
    'flow-global',
    'spatial-surface',
    'spatial-world',
    'spatial-global',
  ] as const)('does not claim a visual Runtime capture target for %s', (fixtureKind) => {
    const source = loadRuntimeFixture(fixtureKind)
    expect(useEditorStore.getState().captureRuntimeAssetReplacementTarget(
      discoverySession(source),
    )).toBeNull()
  })

  it.each([
    'slide-scene',
    'global',
  ] as const)('maps %s discovery to the canonical first carrier Runtime and ignores host targetId', (fixtureKind) => {
    const source = loadRuntimeFixture(fixtureKind, { multiple: true })
    if (!source.secondaryItemId) throw new Error('Expected the secondary Runtime')
    const secondaryBefore = structuredClone(runtimeItem(
      activeProject(),
      source.secondaryItemId,
    ))
    const primaryBefore = structuredClone(runtimeItem(activeProject(), source.itemId))
    // The V9 Schema requires this carrier order to agree with unified order;
    // host targetId remains discovery-only and cannot retarget the second row.
    expect(primaryBefore.order).toBeLessThan(secondaryBefore.order)

    const target = captureProjectedRuntimeTarget(
      source,
      `runtime:${fixtureKind}:host-token-for-secondary`,
    )
    expect(target.courseTarget.itemId).toBe(source.itemId)
    const replacement = image(`runtime-${fixtureKind}-only-target`, [21, 22, 23])
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      replacement.meta,
      replacement.bytes,
    )).toMatchObject({ ok: true, status: 'replaced' })

    const after = activeProject()
    expect(runtimeItem(after, source.secondaryItemId)).toEqual(secondaryBefore)
    expect(runtimeAssetId(after, source.itemId)).toBe(replacement.meta.id)
    expect(runtimeItem(after, source.itemId)).toEqual({
      ...primaryBefore,
      runtime: {
        ...primaryBefore.runtime,
        assets: {
          ...primaryBefore.runtime.assets,
          [BINDING_KEY]: { assetId: replacement.meta.id },
        },
      },
    })
  })

  it('allows a state switch while enforcing the effective lock of the captured state', () => {
    const source = loadRuntimeFixture('slide-scene', {
      stateLocks: 'a-unlocked-b-locked',
    })
    useEditorStore.getState().setActivePresentationState('state-a')
    const target = captureProjectedRuntimeTarget(source)
    expect(target.courseTarget.stateId).toBe('state-a')
    const revisionAtCapture = activeProject().revision

    useEditorStore.getState().setActivePresentationState('state-b')
    expect(useEditorStore.getState().activePresentationStateId).toBe('state-b')
    expect(activeProject().revision).toBe(revisionAtCapture)
    expect(useEditorStore.getState().captureRuntimeAssetReplacementTarget(
      discoverySession(source),
    )).toBeNull()
    const replacement = image('runtime-state-shared-replacement', [31, 32, 33])
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      replacement.meta,
      replacement.bytes,
    )).toMatchObject({ ok: true, status: 'replaced' })
    expect(runtimeAssetId(activeProject(), source.itemId)).toBe(replacement.meta.id)

    const lockedSource = loadRuntimeFixture('slide-scene', {
      stateLocks: 'a-locked-b-unlocked',
    })
    useEditorStore.getState().setActivePresentationState('state-a')
    expect(useEditorStore.getState().captureRuntimeAssetReplacementTarget(
      discoverySession(lockedSource),
    )).toBeNull()
  })

  it('keeps no-op, conflict, project mismatch, stale revision and item deletion at zero writes', () => {
    let source = loadRuntimeFixture('slide-scene')
    let target = captureProjectedRuntimeTarget(source)
    const oldMeta = structuredClone(activeProject().assets[OLD_ASSET_ID])
    const oldBytes = selectMediaAssetFiles(useEditorStore.getState())[OLD_ASSET_ID]?.slice()
    if (!oldMeta || !oldBytes) throw new Error('Expected complete original Runtime asset')

    let before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      oldMeta,
      oldBytes,
    )).toMatchObject({
      ok: true,
      status: 'unchanged',
      feedback: { assetDisposition: 'unchanged' },
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      { ...oldMeta, filename: 'same-id-conflict.png' },
      oldBytes,
    )).toMatchObject({ ok: false, code: 'asset-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget({
      ...target,
      courseTarget: {
        ...target.courseTarget,
        projectId: 'another-course-project',
      },
    }, image('runtime-wrong-project').meta, image('runtime-wrong-project').bytes))
      .toMatchObject({ ok: false, code: 'project-mismatch' })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    useEditorStore.getState().renameProject('Runtime intervening edit')
    before = authoritativeWriteSnapshot()
    const staleReplacement = image('runtime-stale-revision', [41, 42, 43])
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      staleReplacement.meta,
      staleReplacement.bytes,
    )).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    source = loadRuntimeFixture('slide-scene')
    useEditorStore.getState().setActivePresentationState(null)
    target = captureProjectedRuntimeTarget(source)
    useEditorStore.getState().deleteNode(source.itemId)
    expect(() => runtimeItem(activeProject(), source.itemId)).toThrow(/Missing Runtime/)
    before = authoritativeWriteSnapshot()
    const deletedReplacement = image('runtime-deleted-item', [51, 52, 53])
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      deletedReplacement.meta,
      deletedReplacement.bytes,
    )).toMatchObject({ ok: false, code: 'item-missing' })
    expect(authoritativeWriteSnapshot()).toEqual(before)
  })

  it('survives archive reopen and keeps Published V2 reads side-effect free', () => {
    const source = loadRuntimeFixture('spatial-world')
    const target = captureDirectCarrierTarget(source)
    const replacement = image('runtime-archive-replacement', [61, 62, 63, 64])
    expect(useEditorStore.getState().replaceRuntimeAssetAtTarget(
      target,
      replacement.meta,
      replacement.bytes,
    )).toMatchObject({ ok: true, status: 'replaced' })

    const beforeReadEndpoints = authoritativeWriteSnapshot()
    const archive = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(useEditorStore.getState()),
      componentFiles: {},
    }, { mtime: ARCHIVE_TIME })
    const reopened = openCourseProjectArchive(archive)
    expect(runtimeAssetId(reopened.project, source.itemId)).toBe(replacement.meta.id)
    expect(reopened.project.assets[replacement.meta.id]).toEqual(replacement.meta)
    expect(reopened.assetFiles[replacement.meta.id]).toEqual(replacement.bytes)

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: {},
    })
    const spatial = published.surfaces.find(
      (surface) => surface.id === source.surfaceId,
    )
    if (!spatial || spatial.type !== 'spatial-2d') {
      throw new Error('Expected the published Spatial surface')
    }
    const runtime = spatial.world.layerItems.find(
      (item) => item.layerItemId === source.itemId,
    )
    expect(runtime).toMatchObject({
      kind: 'runtime',
      runtime: {
        assets: { [BINDING_KEY]: { assetId: replacement.meta.id } },
      },
    })
    expect(published.assets[replacement.meta.id]?.url)
      .toMatch(/^data:image\/png;base64,/)
    expect(authoritativeWriteSnapshot()).toEqual(beforeReadEndpoints)
  })
})
