import { beforeEach, describe, expect, it } from 'vitest'
import { decodePublishedCode } from '@/player/decodePublishedExecutableCode'
import { makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import type { CourseAuthoringTarget } from '@/renderer/authoring/courseAuthoringSession'
import { isFlowEditorTransactionFrame } from '@/renderer/course/flowEditorSlice'
import { isSlideAuthoringTransactionFrame } from '@/renderer/course/slideEditorCommands'
import { isSpatialAuthoringTransactionFrame } from '@/renderer/course/spatialAuthoringHistory'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import {
  COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
  selectRuntimeSourceAuthoringView,
} from '@/renderer/runtime/runtimeSourceAuthoringView'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
  selectCandidateGlobalLayerItems,
  selectSlideSceneList,
} from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

import { courseLayerItemToEditorCanvasNode } from '@/renderer/store/slideEditorProjection'

function projectedGlobalLayer(state: Parameters<typeof selectCandidateGlobalLayerItems>[0]) {
  return (selectCandidateGlobalLayerItems(state) ?? []).map((entry) => ({
    ...entry,
    layer: entry.plane ?? 'overlay',
    visibility: {
      mode: entry.visibility.mode,
      sceneIds: entry.visibility.locationIds,
    },
    node: courseLayerItemToEditorCanvasNode(entry.item)!,
  }))
}


const CREATED_AT = '2026-08-24T00:00:00.000Z'
const ARCHIVE_TIME = '2026-08-24T12:00:00.000Z'
const TYPE_DECOY_ID = 'runtime-source-native-type-decoy'

type FixtureKind =
  | 'slide-scene'
  | 'slide-global'
  | 'flow-surface'
  | 'flow-global'
  | 'spatial-world'
  | 'spatial-global'

type ActiveHistoryKind = 'slide' | 'flow' | 'spatial'

interface RuntimeSourceFixture {
  readonly kind: FixtureKind
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly surfaceId: string
  readonly itemId: string
  readonly owner: 'global' | 'scene' | 'surface' | 'world'
  readonly historyKind: ActiveHistoryKind
  readonly originalSource: string
  readonly updatedSource: string
  readonly protocol: 'canvas-runtime' | 'surface-runtime'
  readonly runtimeApiVersion: 2 | 3
}

function sourceFor(
  runtimeApiVersion: 2 | 3,
  marker: string,
): string {
  return runtimeApiVersion === 2
    ? `CoursewareRuntime.define({runtimeApiVersion:2,create(){return{marker:"${marker}",destroy(){}}}})`
    : `CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return{marker:"${marker}",destroy(){}}}})`
}

function runtimeLayer(
  id: string,
  runtimeApiVersion: 2 | 3,
  source: string,
  locked: boolean,
): RuntimeLayerItem {
  return {
    kind: 'runtime',
    layerItemId: id,
    label: `Runtime ${id}`,
    frame: { mode: 'absolute', x: 120, y: 80, width: 640, height: 360 },
    order: 1,
    visible: true,
    locked,
    rotation: 0,
    opacity: 0.9,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    runtime: runtimeApiVersion === 2
      ? {
          protocol: 'canvas-runtime',
          runtimeApiVersion,
          enabled: true,
          renderMode: 'hybrid',
          source,
          content: {
            values: { title: id, preserved: 'api-2-content' },
            metadata: { title: { label: 'Title', maxLength: 120 } },
          },
          assets: {},
          nodeBindings: { root: 'runtime-bound-node' },
        }
      : {
          protocol: 'surface-runtime',
          runtimeApiVersion,
          enabled: true,
          renderMode: 'dom',
          source,
          content: {
            values: { title: id, preserved: 'api-3-content' },
            metadata: { title: { label: 'Title', multiline: true } },
          },
          assets: {},
          nodeBindings: { root: 'runtime-bound-node' },
        },
  }
}

function runtimeFixture(
  kind: FixtureKind,
  options: { readonly locked?: boolean; readonly includeTypeDecoy?: boolean } = {},
): RuntimeSourceFixture {
  let sequence = 0
  const base = createBlankCourseProject({
    id: `arch2-runtime-source-${kind}`,
    title: `ARCH-2 Runtime source ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => `runtime-source-fixture-${++sequence}`,
  })
  const runtimeApiVersion = kind.startsWith('slide-') ? 2 as const : 3 as const
  const protocol = runtimeApiVersion === 2
    ? 'canvas-runtime' as const
    : 'surface-runtime' as const
  const originalSource = sourceFor(runtimeApiVersion, `${kind}-original`)
  const updatedSource = sourceFor(runtimeApiVersion, `${kind}-updated`)
  const itemId = `runtime-source-${kind}`
  const runtime = runtimeLayer(
    itemId,
    runtimeApiVersion,
    originalSource,
    options.locked ?? false,
  )
  const scopedRuntime = {
    item: runtime,
    visibility: { mode: 'all' as const, locationIds: [] },
  }

  if (kind === 'slide-scene' || kind === 'slide-global') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected the blank Slide surface')
    const scene = structuredClone(surface.scenes[0]!)
    const typeDecoy = options.includeTypeDecoy
      ? sceneNodeToCourseLayerItem(createTextNode({
          id: TYPE_DECOY_ID,
          name: 'Runtime type decoy',
        }), 2)
      : null
    scene.layerItems = kind === 'slide-scene'
      ? [runtime, ...(typeDecoy ? [typeDecoy] : [])]
      : typeDecoy
        ? [typeDecoy]
        : []
    const project = courseProjectDocumentSchema.parse({
      ...base,
      globalLayerItems: kind === 'slide-global' ? [scopedRuntime] : [],
      surfaces: [{ ...surface, scenes: [scene] }],
    })
    return {
      kind,
      project,
      locationId: project.locations[0]!.id,
      surfaceId: surface.id,
      itemId,
      owner: kind === 'slide-global' ? 'global' : 'scene',
      historyKind: 'slide',
      originalSource,
      updatedSource,
      protocol,
      runtimeApiVersion,
    }
  }

  if (kind === 'flow-surface' || kind === 'flow-global') {
    const surfaceId = 'runtime-source-flow-surface'
    const locationId = 'runtime-source-flow-location'
    const blockId = 'runtime-source-flow-heading'
    const project = courseProjectDocumentSchema.parse({
      ...base,
      globalLayerItems: kind === 'flow-global' ? [scopedRuntime] : [],
      locations: [{
        id: locationId,
        label: 'Runtime source Flow',
        kind: 'flow-block',
        surfaceId,
        blockId,
      }],
      startLocationId: locationId,
      surfaces: [{
        id: surfaceId,
        title: 'Runtime source Flow',
        type: 'flow',
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        surfaceLayerItems: kind === 'flow-surface' ? [scopedRuntime] : [],
        blocks: [{
          id: blockId,
          type: 'heading',
          level: 1,
          text: 'Runtime source Flow',
        }],
      }],
    })
    return {
      kind,
      project,
      locationId,
      surfaceId,
      itemId,
      owner: kind === 'flow-global' ? 'global' : 'surface',
      historyKind: 'flow',
      originalSource,
      updatedSource,
      protocol,
      runtimeApiVersion,
    }
  }

  const surfaceId = 'runtime-source-spatial-surface'
  const locationId = 'runtime-source-spatial-location'
  const cameraFrameId = 'runtime-source-spatial-home'
  const project = courseProjectDocumentSchema.parse({
    ...base,
    globalLayerItems: kind === 'spatial-global' ? [scopedRuntime] : [],
    locations: [{
      id: locationId,
      label: 'Runtime source Spatial',
      kind: 'spatial-camera',
      surfaceId,
      cameraFrameId,
    }],
    startLocationId: locationId,
    surfaces: [{
      id: surfaceId,
      title: 'Runtime source Spatial',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: kind === 'spatial-world' ? [runtime] : [],
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
    locationId,
    surfaceId,
    itemId,
    owner: kind === 'spatial-global' ? 'global' : 'world',
    historyKind: 'spatial',
    originalSource,
    updatedSource,
    protocol,
    runtimeApiVersion,
  }
}

function loadRuntimeFixture(
  kind: FixtureKind,
  options?: Parameters<typeof runtimeFixture>[1],
): RuntimeSourceFixture {
  const fixture = runtimeFixture(kind, options)
  useEditorStore.getState().loadCourseProject(fixture.project, null, {}, {})
  useEditorStore.getState().activateCourseLocation(fixture.locationId)
  if (fixture.owner === 'global') {
    useEditorStore.getState().setEditingScope('global')
  }
  return fixture
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
  throw new Error('Expected an active V9 Surface history')
}

function activeTransactionResourceChanges() {
  const active = activeHistory()
  const frame = active.history.past.at(-1)
  const isTransaction = active.kind === 'slide'
    ? Boolean(frame && isSlideAuthoringTransactionFrame(frame))
    : active.kind === 'flow'
      ? Boolean(frame && isFlowEditorTransactionFrame(frame))
      : Boolean(frame && isSpatialAuthoringTransactionFrame(frame))
  expect(isTransaction).toBe(true)
  if (!frame || !('kind' in frame) || frame.kind !== 'editor-transaction') {
    throw new Error('Expected the newest Surface history entry to be an editor transaction')
  }
  return frame.resourceChanges
}

function compatibilitySnapshotDepths() {
  const state = useEditorStore.getState()
  return {
    sidecarPast: state.courseAssetSidecarPast.length,
    sidecarFuture: state.courseAssetSidecarFuture.length,
    componentPast: state.courseComponentPackagesPast.length,
    componentFuture: state.courseComponentPackagesFuture.length,
  }
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => [path, [...bytes]]),
  )
}

function authoritativeWriteSnapshot() {
  const state = useEditorStore.getState()
  return {
    project: structuredClone(activeProject()),
    derivedProject: structuredClone(selectActiveCourseProjectDocument(state)!),
    activeHistory: structuredClone(activeHistory().history),
    mediaFiles: byteMap(selectMediaAssetFiles(state)),
    componentPackages: structuredClone(state.componentPackages),
    sidecarPast: structuredClone(state.courseAssetSidecarPast),
    sidecarFuture: structuredClone(state.courseAssetSidecarFuture),
    componentPast: structuredClone(state.courseComponentPackagesPast),
    componentFuture: structuredClone(state.courseComponentPackagesFuture),
    courseAuthoringSession: structuredClone(state.courseAuthoringSession),
    dirty: state.dirty,
  }
}

function runtimeItem(
  project: CourseProjectDocument,
  itemId: string,
): RuntimeLayerItem {
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
        const item = scene.layerItems.find(
          (candidate) => candidate.layerItemId === itemId,
        )
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

function captureRuntimeSourceTarget(
  fixture: RuntimeSourceFixture,
): CourseAuthoringTarget {
  const state = useEditorStore.getState()
  const session = state.courseAuthoringSession
  if (!session) throw new Error('Expected a Course authoring session')
  const view = selectRuntimeSourceAuthoringView({
    project: activeProject(),
    locationId: fixture.locationId,
    editingScope: fixture.owner === 'global' ? 'global' : 'scene',
    activeStateId: state.activePresentationStateId,
    sessionToken: session.token,
  })
  expect(view.availability).toBe('available')
  if (view.availability !== 'available') {
    throw new Error(`Expected Runtime source authoring, received ${view.reason}`)
  }
  expect(view.target.itemId).toBe(fixture.itemId)
  expect(view.runtime.protocol).toBe(fixture.protocol)
  expect(view.runtime.runtimeApiVersion).toBe(fixture.runtimeApiVersion)
  return view.target
}

function expectRejectedWithoutAuthoritativeWrite(
  target: CourseAuthoringTarget,
  source: string,
  code: string,
): void {
  const before = authoritativeWriteSnapshot()
  expect(useEditorStore.getState().updateRuntimeSourceAtTarget(target, source))
    .toMatchObject({ ok: false, code })
  expect(authoritativeWriteSnapshot()).toEqual(before)
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('ARCH-2 canonical Runtime source Store vertical slice', () => {
  it.each([
    ['slide-scene', 'slide'] as const,
    ['slide-global', 'slide'] as const,
    ['flow-surface', 'flow'] as const,
    ['flow-global', 'flow'] as const,
    ['spatial-world', 'spatial'] as const,
    ['spatial-global', 'spatial'] as const,
  ])('commits %s source through exactly one current %s transaction and preserves its Runtime contract', (
    fixtureKind,
    expectedHistoryKind: ActiveHistoryKind,
  ) => {
    const fixture = loadRuntimeFixture(fixtureKind)
    const target = captureRuntimeSourceTarget(fixture)
    const beforeProject = structuredClone(activeProject())
    const beforeRuntime = structuredClone(runtimeItem(beforeProject, fixture.itemId).runtime)
    const beforeHistoryDepth = activeHistory().history.past.length
    const beforeCompatibilityDepths = compatibilitySnapshotDepths()

    expect(activeHistory().kind).toBe(expectedHistoryKind)
    expect(useEditorStore.getState().updateRuntimeSourceAtTarget(
      target,
      fixture.updatedSource,
    )).toMatchObject({
      ok: true,
      status: 'committed',
      feedback: {
        kind: 'runtime-source-updated',
        itemId: fixture.itemId,
        protocol: fixture.protocol,
        runtimeApiVersion: fixture.runtimeApiVersion,
      },
    })

    const committedProject = structuredClone(activeProject())
    expect(committedProject.revision).toBe(beforeProject.revision + 1)
    expect(runtimeItem(committedProject, fixture.itemId).runtime).toEqual({
      ...beforeRuntime,
      source: fixture.updatedSource,
    })
    expect(activeHistory().history.past).toHaveLength(beforeHistoryDepth + 1)
    expect(activeTransactionResourceChanges()).toEqual({})
    expect(compatibilitySnapshotDepths()).toEqual(beforeCompatibilityDepths)

    useEditorStore.getState().undo()
    expect(activeProject()).toEqual(beforeProject)
    expect(runtimeItem(activeProject(), fixture.itemId).runtime.source)
      .toBe(fixture.originalSource)
    expect(compatibilitySnapshotDepths()).toEqual(beforeCompatibilityDepths)

    useEditorStore.getState().redo()
    expect(activeProject()).toEqual(committedProject)
    expect(runtimeItem(activeProject(), fixture.itemId).runtime.source)
      .toBe(fixture.updatedSource)
    expect(compatibilitySnapshotDepths()).toEqual(beforeCompatibilityDepths)
  })

  it('keeps same-source, stale, locked, wrong-type, owner, location and revision failures at zero authoritative writes', () => {
    let fixture = loadRuntimeFixture('slide-scene')
    let target = captureRuntimeSourceTarget(fixture)
    let before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().updateRuntimeSourceAtTarget(
      target,
      fixture.originalSource,
    )).toMatchObject({
      ok: true,
      status: 'unchanged',
      feedback: { kind: 'runtime-source-unchanged' },
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    expectRejectedWithoutAuthoritativeWrite(
      { ...target, sessionGeneration: target.sessionGeneration + 1 },
      fixture.updatedSource,
      'session-stale',
    )

    fixture = loadRuntimeFixture('slide-scene', { locked: true })
    target = captureRuntimeSourceTarget(fixture)
    expectRejectedWithoutAuthoritativeWrite(
      target,
      fixture.updatedSource,
      'target-locked',
    )

    fixture = loadRuntimeFixture('slide-scene', { includeTypeDecoy: true })
    target = captureRuntimeSourceTarget(fixture)
    expectRejectedWithoutAuthoritativeWrite({
      ...target,
      itemId: TYPE_DECOY_ID,
      authoringAddress: makeLayerItemAuthoringAddress({
        projectId: target.projectId,
        owner: 'scene',
        surfaceId: target.surfaceId,
        sceneId: target.ownerKey.slice('scene:'.length),
        kind: 'runtime',
        layerItemId: TYPE_DECOY_ID,
        field: COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
      }),
    }, fixture.updatedSource, 'invalid-target')

    fixture = loadRuntimeFixture('slide-scene')
    target = captureRuntimeSourceTarget(fixture)
    useEditorStore.getState().setEditingScope('global')
    expectRejectedWithoutAuthoritativeWrite(
      target,
      fixture.updatedSource,
      'owner-mismatch',
    )

    fixture = loadRuntimeFixture('flow-surface')
    target = captureRuntimeSourceTarget(fixture)
    expectRejectedWithoutAuthoritativeWrite(
      { ...target, locationId: 'runtime-source-other-location' },
      fixture.updatedSource,
      'surface-or-location',
    )

    fixture = loadRuntimeFixture('slide-scene')
    target = captureRuntimeSourceTarget(fixture)
    useEditorStore.getState().renameProject('Runtime source intervening edit')
    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().updateRuntimeSourceAtTarget(
      target,
      fixture.updatedSource,
    )).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)
  })

  it('survives archive reopen and preserves API 3 source metadata in the Published V2 read model', () => {
    const fixture = loadRuntimeFixture('spatial-world')
    const target = captureRuntimeSourceTarget(fixture)
    expect(useEditorStore.getState().updateRuntimeSourceAtTarget(
      target,
      fixture.updatedSource,
    )).toMatchObject({ ok: true, status: 'committed' })

    const beforeReadEndpoints = authoritativeWriteSnapshot()
    const archive = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(useEditorStore.getState()),
      componentFiles: {},
    }, { mtime: ARCHIVE_TIME })
    const reopened = openCourseProjectArchive(archive)
    const reopenedRuntime = runtimeItem(reopened.project, fixture.itemId).runtime
    expect(reopenedRuntime).toMatchObject({
      source: fixture.updatedSource,
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      renderMode: 'dom',
    })

    // This verifies the Published V2 producer/read contract only. It does not
    // claim that an API 3 Runtime was executed by a Player host.
    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: {},
    })
    const spatial = published.surfaces.find(
      (surface) => surface.id === fixture.surfaceId,
    )
    if (!spatial || spatial.type !== 'spatial-2d') {
      throw new Error('Expected the published Spatial surface')
    }
    const publishedRuntime = spatial.world.layerItems.find(
      (item) => item.layerItemId === fixture.itemId,
    )
    expect(publishedRuntime).toMatchObject({
      kind: 'runtime',
      runtime: {
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        renderMode: 'dom',
      },
    })
    if (!publishedRuntime || publishedRuntime.kind !== 'runtime') {
      throw new Error('Expected the published Spatial Runtime')
    }
    expect(decodePublishedCode(publishedRuntime.runtime.code))
      .toBe(fixture.updatedSource)
    expect(authoritativeWriteSnapshot()).toEqual(beforeReadEndpoints)
  })
})
