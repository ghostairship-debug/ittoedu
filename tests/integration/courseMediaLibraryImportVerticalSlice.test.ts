import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { isFlowEditorTransactionFrame } from '@/renderer/course/flowEditorSlice'
import { isSlideAuthoringTransactionFrame } from '@/renderer/course/slideEditorCommands'
import { isSpatialAuthoringTransactionFrame } from '@/renderer/course/spatialAuthoringHistory'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '@/renderer/project/courseProjectArchive'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/projectTypes'

const FIXTURE_ROOT = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
)
const FIXED_TIME = '2026-08-24T05:00:00.000Z'

type FixtureId = 'slide-heavy' | 'flow-heavy' | 'mixed-spatial'

function fixture(id: FixtureId): CourseProjectArchiveData {
  return openCourseProjectArchive(new Uint8Array(readFileSync(
    join(FIXTURE_ROOT, `${id}.h5lesson`),
  )))
}

function loadFixture(id: FixtureId): CourseProjectArchiveData {
  const archive = fixture(id)
  useEditorStore.getState().loadCourseProject(
    archive.project,
    null,
    archive.assetFiles,
    componentPackagesFromArchive(archive.project, archive.componentFiles),
  )
  return archive
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function image(id: string, fill: number): { meta: AssetMeta; bytes: Uint8Array } {
  const bytes = Uint8Array.from([fill, fill + 1, fill + 2, fill + 3])
  return {
    meta: {
      id,
      filename: `${id}.png`,
      mimeType: 'image/png',
      kind: 'image',
      path: `assets/${id}.png`,
      byteLength: bytes.byteLength,
      width: 640,
      height: 360,
    },
    bytes,
  }
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([assetId, bytes]) => [assetId, [...bytes]]),
  )
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

function selectionSnapshot() {
  const state = useEditorStore.getState()
  return {
    locationId: selectActiveCourseLocationId(state),
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

function topologyWithoutAssetMetadata(project: CourseProjectDocument) {
  const clone = structuredClone(project)
  clone.assets = {}
  clone.revision = 0
  clone.updatedAt = ''
  return clone
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

function transactionAssetIds() {
  const active = activeHistory()
  const entry = active.history.past.at(-1)
  const transaction = active.kind === 'slide'
    ? Boolean(entry && isSlideAuthoringTransactionFrame(entry))
    : active.kind === 'flow'
      ? Boolean(entry && isFlowEditorTransactionFrame(entry))
      : Boolean(entry && isSpatialAuthoringTransactionFrame(entry))
  expect(transaction).toBe(true)
  if (!entry || !('kind' in entry) || entry.kind !== 'editor-transaction') {
    throw new Error('Expected an editor transaction history frame')
  }
  return entry.resourceChanges.assetFileChanges?.map((change) => change.assetId) ?? []
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
    sidecarPast: state.slideCandidateSidecarPast.map((sidecar) => byteMap(sidecar.files)),
    sidecarFuture: state.slideCandidateSidecarFuture.map((sidecar) => byteMap(sidecar.files)),
    componentPackages: structuredClone(state.componentPackages),
    componentPast: structuredClone(state.slideCandidateComponentPackagesPast),
    componentFuture: structuredClone(state.slideCandidateComponentPackagesFuture),
    selection: selectionSnapshot(),
    courseAuthoringSession: structuredClone(state.courseAuthoringSession),
    dirty: state.dirty,
    statusMessage: state.statusMessage,
    errorMessage: state.errorMessage,
  }
}

function prepareSurface(id: FixtureId) {
  loadFixture(id)
  if (id === 'slide-heavy') {
    useEditorStore.getState().activateCourseLocation('slide-location-intro')
    useEditorStore.getState().selectNode('slide-intro-title')
    return useEditorStore.getState().captureMediaLibraryImportTarget()
  }
  if (id === 'flow-heavy') {
    useEditorStore.getState().activateCourseLocation('flow-location-start')
    return useEditorStore.getState().captureMediaLibraryImportTarget()
  }

  // A media-library target is project-scoped: switching only the location is
  // permitted. The commit must join the history of the Surface active when the
  // asynchronous result returns.
  const target = useEditorStore.getState().captureMediaLibraryImportTarget()
  useEditorStore.getState().activateCourseLocation('mixed-location-spatial-detail')
  useEditorStore.getState().selectNode('mixed-spatial-node-a')
  return target
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('ARCH-2 project-scoped media-library import vertical slice', () => {
  it.each([
    ['slide-heavy', 'slide'] as const,
    ['flow-heavy', 'flow'] as const,
    ['mixed-spatial', 'spatial'] as const,
  ])('commits one two-asset transaction on %s without placement or full resource snapshots', (fixtureId, expectedKind) => {
    const target = prepareSurface(fixtureId)
    if (!target) throw new Error('Expected a captured media-library target')
    expect(activeHistory().kind).toBe(expectedKind)

    const items = [
      image(`arch2-${fixtureId}-asset-a`, 11),
      image(`arch2-${fixtureId}-asset-b`, 21),
    ]
    const beforeProject = structuredClone(activeProject())
    const beforeFiles = byteMap(selectMediaAssetFiles(useEditorStore.getState()))
    const beforeHistoryDepth = activeHistory().history.past.length
    const beforeStoreHistoryDepth = useEditorStore.getState().history.past.length
    const beforeResourceDepths = resourceSnapshotDepths()
    const beforeSelection = selectionSnapshot()
    const beforeSession = structuredClone(useEditorStore.getState().courseAuthoringSession)
    if (!beforeSession) throw new Error('Expected a Course authoring session')

    const result = useEditorStore.getState().importAssetsAtTarget(target, items)
    expect(result).toMatchObject({
      ok: true,
      status: 'imported',
      feedback: {
        kind: 'media-library-imported',
        importedAssetIds: items.map((item) => item.meta.id),
        addedAssetIds: items.map((item) => item.meta.id),
      },
    })

    const afterProject = structuredClone(activeProject())
    expect(afterProject.revision).toBe(beforeProject.revision + 1)
    expect(activeHistory().history.past).toHaveLength(beforeHistoryDepth + 1)
    expect(useEditorStore.getState().history.past).toHaveLength(beforeStoreHistoryDepth + 1)
    expect(transactionAssetIds()).toEqual(items.map((item) => item.meta.id))
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    expect(selectionSnapshot()).toEqual(beforeSelection)
    const committedSession = useEditorStore.getState().courseAuthoringSession
    if (!committedSession) throw new Error('Expected the committed authoring session')
    expect(committedSession.token.revision).toBe(afterProject.revision)
    expect(committedSession.token.generation).toBe(beforeSession.token.generation)
    expect(committedSession.itemIds).toEqual(beforeSession.itemIds)
    expect(Object.isFrozen(committedSession)).toBe(true)
    expect(Object.isFrozen(committedSession.itemIds)).toBe(true)
    expect(topologyWithoutAssetMetadata(afterProject))
      .toEqual(topologyWithoutAssetMetadata(beforeProject))
    for (const item of items) {
      expect(afterProject.assets[item.meta.id]).toEqual(item.meta)
      expect(selectMediaAssetFiles(useEditorStore.getState())[item.meta.id])
        .toEqual(item.bytes)
    }

    useEditorStore.getState().undo()
    expect(activeProject()).toEqual(beforeProject)
    expect(byteMap(selectMediaAssetFiles(useEditorStore.getState()))).toEqual(beforeFiles)
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    const undoneSession = useEditorStore.getState().courseAuthoringSession
    if (!undoneSession) throw new Error('Expected the undone authoring session')
    expect(undoneSession.token.revision).toBe(beforeProject.revision)
    expect(undoneSession.token.generation).toBeGreaterThan(
      committedSession.token.generation,
    )
    expect(undoneSession.itemIds).toEqual(beforeSession.itemIds)
    expect(Object.isFrozen(undoneSession)).toBe(true)
    expect(Object.isFrozen(undoneSession.itemIds)).toBe(true)

    useEditorStore.getState().redo()
    expect(activeProject()).toEqual(afterProject)
    for (const item of items) {
      expect(selectMediaAssetFiles(useEditorStore.getState())[item.meta.id])
        .toEqual(item.bytes)
    }
    expect(resourceSnapshotDepths()).toEqual(beforeResourceDepths)
    const redoneSession = useEditorStore.getState().courseAuthoringSession
    if (!redoneSession) throw new Error('Expected the redone authoring session')
    expect(redoneSession.token.revision).toBe(afterProject.revision)
    expect(redoneSession.token.generation).toBeGreaterThan(
      undoneSession.token.generation,
    )
    expect(redoneSession.itemIds).toEqual(beforeSession.itemIds)
    expect(Object.isFrozen(redoneSession)).toBe(true)
    expect(Object.isFrozen(redoneSession.itemIds)).toBe(true)
  })

  it('rejects stale revision, project mismatch and conflict, while exact reuse is a zero-write no-op', () => {
    loadFixture('slide-heavy')
    useEditorStore.getState().activateCourseLocation('slide-location-intro')

    const exactId = 'slide-hero'
    const exactMeta = structuredClone(activeProject().assets[exactId])
    const exactBytes = selectMediaAssetFiles(useEditorStore.getState())[exactId]?.slice()
    if (!exactMeta || !exactBytes) throw new Error('Fixture asset is incomplete')

    const target = useEditorStore.getState().captureMediaLibraryImportTarget()
    if (!target) throw new Error('Expected a captured media-library target')
    let before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget(target, [{
      meta: exactMeta,
      bytes: exactBytes,
    }])).toMatchObject({
      ok: true,
      status: 'unchanged',
      feedback: { reusedAssetIds: [exactId], importedAssetIds: [] },
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget(target, [{
      meta: { ...exactMeta, filename: 'same-id-conflict.png' },
      bytes: exactBytes,
    }])).toMatchObject({ ok: false, code: 'asset-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget({
      projectId: 'another-course-project',
      documentRevision: target.documentRevision,
    }, [image('arch2-wrong-project', 31)])).toMatchObject({
      ok: false,
      code: 'project-mismatch',
    })
    expect(authoritativeWriteSnapshot()).toEqual(before)

    useEditorStore.getState().renameProject('ARCH-2 intervening edit')
    before = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().importAssetsAtTarget(
      target,
      [image('arch2-stale-revision', 41)],
    )).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(authoritativeWriteSnapshot()).toEqual(before)
  })

  it('keeps legacy snapshot stacks aligned around a delta frame', () => {
    loadFixture('slide-heavy')
    useEditorStore.getState().activateCourseLocation('slide-location-intro')
    const originalTitle = activeProject().title

    useEditorStore.getState().renameProject('ARCH-2 legacy before delta')
    expect(resourceSnapshotDepths()).toEqual({
      sidecarPast: 1,
      sidecarFuture: 0,
      componentPast: 1,
      componentFuture: 0,
    })

    const target = useEditorStore.getState().captureMediaLibraryImportTarget()
    if (!target) throw new Error('Expected a captured media-library target')
    const imported = image('arch2-legacy-delta-asset', 51)
    expect(useEditorStore.getState().importAssetsAtTarget(target, [imported]))
      .toMatchObject({ ok: true, status: 'imported' })
    expect(resourceSnapshotDepths()).toEqual({
      sidecarPast: 1,
      sidecarFuture: 0,
      componentPast: 1,
      componentFuture: 0,
    })

    useEditorStore.getState().renameProject('ARCH-2 legacy after delta')
    expect(resourceSnapshotDepths()).toEqual({
      sidecarPast: 2,
      sidecarFuture: 0,
      componentPast: 2,
      componentFuture: 0,
    })

    useEditorStore.getState().undo()
    expect(activeProject().title).toBe('ARCH-2 legacy before delta')
    expect(activeProject().assets[imported.meta.id]).toEqual(imported.meta)
    expect(resourceSnapshotDepths()).toEqual({
      sidecarPast: 1,
      sidecarFuture: 1,
      componentPast: 1,
      componentFuture: 1,
    })

    useEditorStore.getState().undo()
    expect(activeProject().title).toBe('ARCH-2 legacy before delta')
    expect(activeProject().assets[imported.meta.id]).toBeUndefined()
    expect(selectMediaAssetFiles(useEditorStore.getState())[imported.meta.id]).toBeUndefined()
    expect(resourceSnapshotDepths()).toEqual({
      sidecarPast: 1,
      sidecarFuture: 1,
      componentPast: 1,
      componentFuture: 1,
    })

    useEditorStore.getState().undo()
    expect(activeProject().title).toBe(originalTitle)
    expect(resourceSnapshotDepths()).toEqual({
      sidecarPast: 0,
      sidecarFuture: 2,
      componentPast: 0,
      componentFuture: 2,
    })

    useEditorStore.getState().redo()
    useEditorStore.getState().redo()
    expect(activeProject().assets[imported.meta.id]).toEqual(imported.meta)
    expect(selectMediaAssetFiles(useEditorStore.getState())[imported.meta.id])
      .toEqual(imported.bytes)
    useEditorStore.getState().redo()
    expect(activeProject().title).toBe('ARCH-2 legacy after delta')
    expect(resourceSnapshotDepths()).toEqual({
      sidecarPast: 2,
      sidecarFuture: 0,
      componentPast: 2,
      componentFuture: 0,
    })
  })

  it('applies and reverses a prototype-looking asset ID as an own resource key', () => {
    loadFixture('slide-heavy')
    const target = useEditorStore.getState().captureMediaLibraryImportTarget()
    if (!target) throw new Error('Expected a captured media-library target')
    const item = image('__proto__', 61)

    expect(useEditorStore.getState().importAssetsAtTarget(target, [item]))
      .toMatchObject({ ok: true, status: 'imported' })
    expect(Object.hasOwn(activeProject().assets, item.meta.id)).toBe(true)
    const committedFiles = selectMediaAssetFiles(useEditorStore.getState())
    expect(Object.hasOwn(committedFiles, item.meta.id)).toBe(true)
    expect(Object.getPrototypeOf(committedFiles)).toBe(Object.prototype)
    expect(committedFiles[item.meta.id]).toEqual(item.bytes)

    useEditorStore.getState().undo()
    expect(Object.hasOwn(activeProject().assets, item.meta.id)).toBe(false)
    expect(Object.hasOwn(
      selectMediaAssetFiles(useEditorStore.getState()),
      item.meta.id,
    )).toBe(false)

    useEditorStore.getState().redo()
    expect(Object.hasOwn(activeProject().assets, item.meta.id)).toBe(true)
    expect(selectMediaAssetFiles(useEditorStore.getState())[item.meta.id])
      .toEqual(item.bytes)
  })

  it('repairs referenced missing bytes, survives archive reopen, and leaves Published reads side-effect free', () => {
    const source = fixture('slide-heavy')
    const referencedAssetId = 'slide-hero'
    const referencedMeta = structuredClone(source.project.assets[referencedAssetId])
    const referencedBytes = source.assetFiles[referencedAssetId]?.slice()
    if (!referencedMeta || !referencedBytes) throw new Error('Fixture asset is incomplete')
    const filesWithoutReferencedAsset = Object.fromEntries(
      Object.entries(source.assetFiles)
        .filter(([assetId]) => assetId !== referencedAssetId)
        .map(([assetId, bytes]) => [assetId, bytes.slice()]),
    )
    useEditorStore.getState().loadCourseProject(
      source.project,
      null,
      filesWithoutReferencedAsset,
      componentPackagesFromArchive(source.project, source.componentFiles),
    )
    useEditorStore.getState().activateCourseLocation('slide-location-intro')
    const target = useEditorStore.getState().captureMediaLibraryImportTarget()
    if (!target) throw new Error('Expected a captured media-library target')

    expect(selectMediaAssetFiles(useEditorStore.getState())[referencedAssetId]).toBeUndefined()
    expect(useEditorStore.getState().importAssetsAtTarget(target, [{
      meta: referencedMeta,
      bytes: referencedBytes,
    }])).toMatchObject({
      ok: true,
      status: 'imported',
      feedback: {
        repairedAssetIds: [referencedAssetId],
        addedAssetIds: [],
      },
    })
    expect(transactionAssetIds()).toEqual([referencedAssetId])

    const beforeReadEndpoints = authoritativeWriteSnapshot()
    const state = useEditorStore.getState()
    const archiveBytes = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(state),
      componentFiles: source.componentFiles,
    }, { mtime: FIXED_TIME })
    const reopened = openCourseProjectArchive(archiveBytes)
    expect(reopened.project.assets[referencedAssetId]).toEqual(referencedMeta)
    expect(reopened.assetFiles[referencedAssetId]).toEqual(referencedBytes)

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: componentPackagesFromArchive(reopened.project, reopened.componentFiles),
    })
    expect(published.assets[referencedAssetId]?.url)
      .toMatch(/^data:image\/png;base64,/)
    expect(authoritativeWriteSnapshot()).toEqual(beforeReadEndpoints)
  })
})
