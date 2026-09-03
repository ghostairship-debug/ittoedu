import { beforeEach, describe, expect, it } from 'vitest'
import { decodePublishedCode } from '@/player/decodePublishedExecutableCode'
import { isSlideAuthoringTransactionFrame } from '@/renderer/course/slideEditorCommands'
import { isSpatialAuthoringTransactionFrame } from '@/renderer/course/spatialAuthoringHistory'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { selectRuntimeInspectorAuthoringView } from '@/renderer/runtime/runtimeInspectorAuthoringView'
import type {
  CourseRuntimePropertyTarget,
  CourseRuntimePropertyUpdate,
  RuntimePropertyAuthoringField,
} from '@/renderer/runtime/runtimePropertyAuthoringCommands'
import {
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
  selectMediaAssetFiles,
  useEditorStore,
  selectCandidateGlobalLayerItems,
  selectSlideSceneList,
} from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
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

type FixtureKind = 'slide-scene' | 'slide-global' | 'spatial-world'
type HistoryKind = 'slide' | 'spatial'

interface RuntimePropertyFixture {
  readonly kind: FixtureKind
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly surfaceId: string
  readonly owner: 'scene' | 'global' | 'world'
  readonly itemId: string
  readonly historyKind: HistoryKind
}

type PropertyCommitCase =
  | {
      readonly fixtureKind: FixtureKind
      readonly historyKind: HistoryKind
      readonly field: 'enabled'
      readonly value: boolean
    }
  | {
      readonly fixtureKind: FixtureKind
      readonly historyKind: HistoryKind
      readonly field: 'renderMode'
      readonly value: 'dom'
    }

const PROPERTY_COMMIT_CASES: readonly PropertyCommitCase[] = [
  {
    fixtureKind: 'slide-scene',
    historyKind: 'slide',
    field: 'enabled',
    value: false,
  },
  {
    fixtureKind: 'slide-global',
    historyKind: 'slide',
    field: 'renderMode',
    value: 'dom',
  },
  {
    fixtureKind: 'spatial-world',
    historyKind: 'spatial',
    field: 'enabled',
    value: true,
  },
]

function runtimeLayer(input: {
  readonly id: string
  readonly api: 2 | 3
  readonly locked?: boolean
}): RuntimeLayerItem {
  const common = {
    kind: 'runtime' as const,
    layerItemId: input.id,
    label: `Runtime ${input.id}`,
    frame: { mode: 'absolute' as const, x: 120, y: 80, width: 640, height: 360 },
    order: 7,
    visible: false,
    locked: input.locked ?? false,
    rotation: 8,
    opacity: 0.82,
    hitPolicy: 'surface' as const,
    playbackInitialVisibility: 'hidden' as const,
  }
  const content = {
    values: { title: `${input.id} title`, preserved: 'untouched-content' },
    metadata: {
      title: { label: 'Title', multiline: false, maxLength: 120 },
      preserved: { label: 'Preserved', multiline: true },
    },
  }
  return input.api === 2
    ? {
        ...common,
        runtime: {
          protocol: 'canvas-runtime',
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'hybrid',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})',
          content,
          assets: {},
          nodeBindings: { root: 'api-2-bound-node' },
        },
      }
    : {
        ...common,
        runtime: {
          protocol: 'surface-runtime',
          runtimeApiVersion: 3,
          enabled: false,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return{destroy(){}}}})',
          content,
          assets: {},
          nodeBindings: { root: 'api-3-bound-node' },
        },
      }
}

function fixture(
  kind: FixtureKind,
  options: { readonly locked?: boolean } = {},
): RuntimePropertyFixture {
  let sequence = 0
  const base = createBlankCourseProject({
    id: `runtime-property-${kind}`,
    title: `Runtime property ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => `runtime-property-fixture-${++sequence}`,
  })
  const itemId = `runtime-property-${kind}`

  if (kind === 'slide-scene' || kind === 'slide-global') {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected blank Slide surface')
    const scene = structuredClone(surface.scenes[0]!)
    const item = runtimeLayer({ id: itemId, api: 2, locked: options.locked })
    scene.layerItems = kind === 'slide-scene' ? [item] : []
    const project = courseProjectDocumentSchema.parse({
      ...base,
      globalLayerItems: kind === 'slide-global'
        ? [{ item, visibility: { mode: 'all', locationIds: [] } }]
        : [],
      surfaces: [{ ...surface, scenes: [scene] }],
    })
    return {
      kind,
      project,
      locationId: project.locations[0]!.id,
      surfaceId: surface.id,
      owner: kind === 'slide-global' ? 'global' : 'scene',
      itemId,
      historyKind: 'slide',
    }
  }

  const surfaceId = 'runtime-property-spatial-surface'
  const locationId = 'runtime-property-spatial-location'
  const cameraFrameId = 'runtime-property-spatial-home'
  const item = runtimeLayer({ id: itemId, api: 3, locked: options.locked })
  const project = courseProjectDocumentSchema.parse({
    ...base,
    locations: [{
      id: locationId,
      label: 'Runtime property Spatial',
      kind: 'spatial-camera',
      surfaceId,
      cameraFrameId,
    }],
    startLocationId: locationId,
    surfaces: [{
      id: surfaceId,
      title: 'Runtime property Spatial',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [item],
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
    owner: 'world',
    itemId,
    historyKind: 'spatial',
  }
}

function loadFixture(
  kind: FixtureKind,
  options?: Parameters<typeof fixture>[1],
): RuntimePropertyFixture {
  const source = fixture(kind, options)
  useEditorStore.getState().loadCourseProject(source.project, null, {}, {})
  useEditorStore.getState().activateCourseLocation(source.locationId)
  if (source.owner === 'global') useEditorStore.getState().setEditingScope('global')
  return source
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected active Course Project V9')
  return project
}

function activeHistory() {
  const state = useEditorStore.getState()
  if (state.spatialSession) {
    return { kind: 'spatial' as const, history: state.spatialSession.history }
  }
  if (state.slideBackend?.kind === 'slide-authoring') {
    return { kind: 'slide' as const, history: state.slideBackend.getSession().history }
  }
  throw new Error('Expected active Slide or Spatial history')
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
  throw new Error(`Missing Runtime ${itemId}`)
}

function captureTarget(
  source: RuntimePropertyFixture,
  field: RuntimePropertyAuthoringField,
): CourseRuntimePropertyTarget {
  const state = useEditorStore.getState()
  const session = state.courseAuthoringSession
  if (!session) throw new Error('Expected Course authoring session')
  const view = selectRuntimeInspectorAuthoringView({
    project: activeProject(),
    locationId: source.locationId,
    editingScope: source.owner === 'global' ? 'global' : 'scene',
    activeStateId: selectActivePresentationStateId(state),
    sessionToken: session.token,
  })
  expect(view.availability).toBe('available')
  if (view.availability !== 'available') {
    throw new Error(`Expected Runtime inspector authoring, received ${view.reason}`)
  }
  expect(view.enabledTarget.courseTarget.itemId).toBe(source.itemId)
  return field === 'enabled' ? view.enabledTarget : view.renderModeTarget
}

function transactionResourceChanges() {
  const active = activeHistory()
  const frame = active.history.past.at(-1)
  const isTransaction = active.kind === 'slide'
    ? Boolean(frame && isSlideAuthoringTransactionFrame(frame))
    : Boolean(frame && isSpatialAuthoringTransactionFrame(frame))
  expect(isTransaction).toBe(true)
  if (!frame || !('kind' in frame) || frame.kind !== 'editor-transaction') {
    throw new Error('Expected newest Surface history frame to be one editor transaction')
  }
  return frame.resourceChanges
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files).map(([id, bytes]) => [id, [...bytes]]),
  )
}

function authoritativeSnapshot() {
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

function expectRejectedWithoutWrite(
  target: CourseRuntimePropertyTarget,
  update: CourseRuntimePropertyUpdate,
  code: string,
): void {
  const before = authoritativeSnapshot()
  expect(useEditorStore.getState().updateRuntimePropertyAtTarget(target, update))
    .toMatchObject({ ok: false, code })
  expect(authoritativeSnapshot()).toEqual(before)
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('ARCH-2 canonical Runtime property Store vertical slice', () => {
  it.each(PROPERTY_COMMIT_CASES)(
    'commits $fixtureKind $field through one $historyKind transaction and changes only that Runtime scalar',
    ({ fixtureKind, historyKind, field, value }) => {
      const source = loadFixture(fixtureKind)
      const target = captureTarget(source, field)
      const update = field === 'enabled'
        ? { field, value: value as boolean } as const
        : { field, value: value as 'dom' } as const
      const beforeProject = structuredClone(activeProject())
      const beforeItem = structuredClone(runtimeItem(beforeProject, source.itemId))
      const beforeHistoryDepth = activeHistory().history.past.length

      expect(activeHistory().kind).toBe(historyKind)
      expect(useEditorStore.getState().updateRuntimePropertyAtTarget(target, update))
        .toMatchObject({
          ok: true,
          status: 'updated',
          feedback: {
            kind: 'runtime-property-updated',
            itemId: source.itemId,
            field,
            value,
          },
        })

      const committed = structuredClone(activeProject())
      const expectedItem = structuredClone(beforeItem)
      if (field === 'enabled') expectedItem.runtime.enabled = value as boolean
      else expectedItem.runtime.renderMode = value as 'dom'
      expect(committed.revision).toBe(beforeProject.revision + 1)
      expect(runtimeItem(committed, source.itemId)).toEqual(expectedItem)
      expect(runtimeItem(committed, source.itemId)).toMatchObject({
        visible: beforeItem.visible,
        playbackInitialVisibility: beforeItem.playbackInitialVisibility,
      })
      expect(activeHistory().history.past).toHaveLength(beforeHistoryDepth + 1)
      expect(transactionResourceChanges()).toEqual({})

      useEditorStore.getState().undo()
      expect(activeProject()).toEqual(beforeProject)
      useEditorStore.getState().redo()
      expect(activeProject()).toEqual(committed)
    },
  )

  it('keeps no-op, stale, locked, scope and API 3 invalid-mode paths at zero authoritative writes', () => {
    let source = loadFixture('slide-scene')
    let target = captureTarget(source, 'enabled')
    let before = authoritativeSnapshot()
    expect(useEditorStore.getState().updateRuntimePropertyAtTarget(
      target,
      { field: 'enabled', value: true },
    )).toMatchObject({
      ok: true,
      status: 'unchanged',
      feedback: { kind: 'runtime-property-unchanged' },
    })
    expect(authoritativeSnapshot()).toEqual(before)

    expectRejectedWithoutWrite({
      ...target,
      courseTarget: {
        ...target.courseTarget,
        sessionGeneration: target.courseTarget.sessionGeneration + 1,
      },
    }, { field: 'enabled', value: false }, 'session-stale')

    source = loadFixture('slide-scene', { locked: true })
    target = captureTarget(source, 'enabled')
    expectRejectedWithoutWrite(
      target,
      { field: 'enabled', value: false },
      'target-locked',
    )

    source = loadFixture('slide-scene')
    target = captureTarget(source, 'enabled')
    useEditorStore.getState().setEditingScope('global')
    expectRejectedWithoutWrite(
      target,
      { field: 'enabled', value: false },
      'owner-mismatch',
    )

    source = loadFixture('spatial-world')
    target = captureTarget(source, 'renderMode')
    expectRejectedWithoutWrite(
      target,
      { field: 'renderMode', value: 'hybrid' },
      'invalid-value',
    )
  })

  it('preserves the committed API 3 property through archive reopen and Published V2 reads', () => {
    const source = loadFixture('spatial-world')
    const target = captureTarget(source, 'enabled')
    const beforeItem = structuredClone(runtimeItem(activeProject(), source.itemId))
    expect(useEditorStore.getState().updateRuntimePropertyAtTarget(
      target,
      { field: 'enabled', value: true },
    )).toMatchObject({ ok: true, status: 'updated' })

    const expectedItem = structuredClone(beforeItem)
    expectedItem.runtime.enabled = true
    const beforeReads = authoritativeSnapshot()
    const archive = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(useEditorStore.getState()),
      componentFiles: {},
    }, { mtime: ARCHIVE_TIME })
    const reopened = openCourseProjectArchive(archive)
    const reopenedItem = runtimeItem(reopened.project, source.itemId)
    expect(reopenedItem).toEqual(expectedItem)
    expect(reopenedItem.runtime).toMatchObject({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      renderMode: 'dom',
      enabled: true,
    })

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: {},
    })
    const spatial = published.surfaces.find(
      (surface) => surface.id === source.surfaceId,
    )
    if (!spatial || spatial.type !== 'spatial-2d') {
      throw new Error('Expected Published Spatial surface')
    }
    const publishedItem = spatial.world.layerItems.find(
      (item) => item.layerItemId === source.itemId,
    )
    expect(publishedItem).toMatchObject({
      kind: 'runtime',
      visible: false,
      playbackInitialVisibility: 'hidden',
      runtime: {
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        renderMode: 'dom',
        enabled: true,
        content: beforeItem.runtime.content,
        assets: beforeItem.runtime.assets,
        nodeBindings: beforeItem.runtime.nodeBindings,
      },
    })
    if (!publishedItem || publishedItem.kind !== 'runtime') {
      throw new Error('Expected Published Spatial Runtime')
    }
    expect(decodePublishedCode(publishedItem.runtime.code))
      .toBe(beforeItem.runtime.source)
    expect(authoritativeSnapshot()).toEqual(beforeReads)
  })
})
