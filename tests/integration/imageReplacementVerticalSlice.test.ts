import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { buildPublishedCourseStandaloneHtml } from '@/renderer/export/course/buildCoursePackages'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '@/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/projectTypes'

const FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
  'slide-heavy.h5lesson',
)
const LOCATION_ID = 'slide-location-intro'
const IMAGE_A = 'slide-intro-hero'
const SELECTION_B = 'slide-intro-title'
const REPLACEMENT_ASSET_ID = 'vs05-image-replacement'
const FIXED_TIME = '2026-08-24T04:00:00.000Z'
const REPLACEMENT_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function replacementMeta(
  id = REPLACEMENT_ASSET_ID,
  bytes = REPLACEMENT_BYTES,
): AssetMeta {
  return {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: bytes.byteLength,
    width: 640,
    height: 360,
  }
}

function fixtureArchive(): CourseProjectArchiveData {
  const source = openCourseProjectArchive(new Uint8Array(readFileSync(FIXTURE_PATH)))
  const project = structuredClone(source.project)
  const intro = project.locations.find((location) => location.id === LOCATION_ID)
  if (!intro || intro.kind !== 'slide-scene') throw new Error('Missing intro location')
  delete intro.stateId
  return {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: source.assetFiles,
    componentFiles: source.componentFiles,
  }
}

function loadFixture(): CourseProjectArchiveData {
  const archive = fixtureArchive()
  useEditorStore.getState().loadCourseProject(
    archive.project,
    null,
    archive.assetFiles,
    componentPackagesFromArchive(archive.project, archive.componentFiles),
  )
  useEditorStore.getState().activateCourseLocation(LOCATION_ID)
  useEditorStore.getState().selectNode(IMAGE_A)
  return archive
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Missing active Course Project V9')
  return project
}

function sceneItem(project: CourseProjectDocument, itemId: string): LayerItem {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => candidate.layerItemId === itemId)
      if (item) return item
    }
  }
  throw new Error(`Missing layer item ${itemId}`)
}

function imageAssetId(project: CourseProjectDocument, itemId = IMAGE_A): string {
  const item = sceneItem(project, itemId)
  if (item.kind !== 'native' || item.content.nativeType !== 'image') {
    throw new Error(`Layer item is not an image: ${itemId}`)
  }
  return item.content.data.assetId
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, bytes]) => [id, [...bytes]]),
  )
}

function sidecarStack(stack: readonly { readonly files: Readonly<Record<string, Uint8Array>> }[]) {
  return stack.map((sidecar) => byteMap(sidecar.files))
}

/**
 * All Store-owned state that a rejected target-based commit is forbidden to
 * alter. Store methods and the backend object itself are intentionally omitted;
 * their canonical serializable state is represented below.
 */
function authoritativeSnapshot() {
  const state = useEditorStore.getState()
  const project = selectActiveCourseProjectDocument(state)
  if (!project) throw new Error('Missing active Course Project V9')
  const backend = state.slideBackend
  const backendHistory = backend?.kind === 'slide-authoring'
    ? backend.getSession().history
    : null
  return {
    project: structuredClone(project),
    derivedProject: structuredClone(state.project),
    assetFiles: byteMap(selectMediaAssetFiles(state)),
    history: structuredClone(state.history),
    backendHistory: backendHistory
      ? {
          present: structuredClone(backendHistory.present),
          past: structuredClone(backendHistory.past),
          future: structuredClone(backendHistory.future),
        }
      : null,
    sidecarPast: sidecarStack(state.slideCandidateSidecarPast),
    sidecarFuture: sidecarStack(state.slideCandidateSidecarFuture),
    componentPackages: structuredClone(state.componentPackages),
    componentPackagesPast: structuredClone(state.slideCandidateComponentPackagesPast),
    componentPackagesFuture: structuredClone(state.slideCandidateComponentPackagesFuture),
    courseAuthoringSession: structuredClone(state.courseAuthoringSession),
    activeSceneId: state.activeSceneId,
    activePresentationStateId: state.activePresentationStateId,
    selectedNodeId: state.selectedNodeId,
    selectedNodeIds: [...state.selectedNodeIds],
    editingScope: state.editingScope,
    dirty: state.dirty,
    errorMessage: state.errorMessage,
    statusMessage: state.statusMessage,
  }
}

function sidecarDepths() {
  const state = useEditorStore.getState()
  return {
    past: state.slideCandidateSidecarPast.length,
    future: state.slideCandidateSidecarFuture.length,
  }
}

beforeEach(() => {
  loadFixture()
})

describe('ARCH-1 VS-05 target-based image replacement vertical slice', () => {
  it('commits captured image A after selecting B and keeps document plus bytes in one undoable step', () => {
    const source = fixtureArchive()
    const stateAtCapture = useEditorStore.getState()
    const target = stateAtCapture.captureImageReplacementTarget()
    if (!target) throw new Error('Expected a captured image replacement target')
    expect(target.itemId).toBe(IMAGE_A)

    const beforeProject = structuredClone(activeProject())
    const beforeImageAssetId = imageAssetId(beforeProject)
    const beforeSelectionB = structuredClone(sceneItem(beforeProject, SELECTION_B))
    const beforeHistoryDepth = stateAtCapture.history.past.length
    const beforeSidecarDepths = sidecarDepths()
    const beforeComponentDepths = {
      past: stateAtCapture.slideCandidateComponentPackagesPast.length,
      future: stateAtCapture.slideCandidateComponentPackagesFuture.length,
    }
    expect(selectMediaAssetFiles(stateAtCapture)[REPLACEMENT_ASSET_ID]).toBeUndefined()

    useEditorStore.getState().selectNode(SELECTION_B)
    expect(useEditorStore.getState().selectedNodeId).toBe(SELECTION_B)
    expect(activeProject().revision).toBe(beforeProject.revision)

    const result = useEditorStore.getState().replaceImageAssetAtTarget(
      target,
      replacementMeta(),
      REPLACEMENT_BYTES,
    )
    expect(result).toMatchObject({
      ok: true,
      status: 'replaced',
      feedback: {
        kind: 'image-replaced',
        assetId: REPLACEMENT_ASSET_ID,
        assetDisposition: 'added',
      },
    })

    const after = useEditorStore.getState()
    const afterProject = activeProject()
    expect(after.selectedNodeId).toBe(SELECTION_B)
    expect(after.selectedNodeIds).toEqual([SELECTION_B])
    expect(afterProject.revision).toBe(beforeProject.revision + 1)
    expect(imageAssetId(afterProject)).toBe(REPLACEMENT_ASSET_ID)
    expect(sceneItem(afterProject, SELECTION_B)).toEqual(beforeSelectionB)
    expect(afterProject.assets[REPLACEMENT_ASSET_ID]).toEqual(replacementMeta())
    expect(selectMediaAssetFiles(after)[REPLACEMENT_ASSET_ID]).toEqual(REPLACEMENT_BYTES)
    expect(after.history.past).toHaveLength(beforeHistoryDepth + 1)
    expect(sidecarDepths()).toEqual(beforeSidecarDepths)
    expect({
      past: after.slideCandidateComponentPackagesPast.length,
      future: after.slideCandidateComponentPackagesFuture.length,
    }).toEqual(beforeComponentDepths)
    expect(after.dirty).toBe(true)
    const afterBackend = after.slideBackend
    if (!afterBackend || afterBackend.kind !== 'slide-authoring') {
      throw new Error('Expected Slide authoring backend')
    }
    expect(afterBackend.getSession().history.past).toHaveLength(beforeHistoryDepth + 1)
    expect(afterBackend.getSession().history.past.at(-1)).toMatchObject({
      kind: 'editor-transaction',
      resourceChanges: {
        assetFileChanges: [expect.objectContaining({ assetId: REPLACEMENT_ASSET_ID })],
      },
    })

    after.undo()
    const undone = useEditorStore.getState()
    expect(activeProject()).toEqual(beforeProject)
    expect(imageAssetId(activeProject())).toBe(beforeImageAssetId)
    expect(activeProject().assets[REPLACEMENT_ASSET_ID]).toBeUndefined()
    expect(selectMediaAssetFiles(undone)[REPLACEMENT_ASSET_ID]).toBeUndefined()
    expect(sidecarDepths()).toEqual(beforeSidecarDepths)

    undone.redo()
    const redone = useEditorStore.getState()
    const redoneProject = activeProject()
    expect(redoneProject).toEqual(afterProject)
    expect(imageAssetId(redoneProject)).toBe(REPLACEMENT_ASSET_ID)
    expect(selectMediaAssetFiles(redone)[REPLACEMENT_ASSET_ID]).toEqual(REPLACEMENT_BYTES)
    expect(sidecarDepths()).toEqual(beforeSidecarDepths)

    const beforeReadEndpoints = authoritativeSnapshot()
    const archiveBytes = createCourseProjectArchive({
      project: redoneProject,
      assetFiles: selectMediaAssetFiles(redone),
      componentFiles: source.componentFiles,
    }, { mtime: FIXED_TIME })
    const reopened = openCourseProjectArchive(archiveBytes)
    expect(imageAssetId(reopened.project)).toBe(REPLACEMENT_ASSET_ID)
    expect(reopened.assetFiles[REPLACEMENT_ASSET_ID]).toEqual(REPLACEMENT_BYTES)

    const components = componentPackagesFromArchive(
      reopened.project,
      reopened.componentFiles,
    )
    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components,
    })
    expect(published.assets[REPLACEMENT_ASSET_ID]?.url)
      .toMatch(/^data:image\/png;base64,/)
    const html = buildPublishedCourseStandaloneHtml({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components,
    }, '/* VS-05 read-only Player endpoint */')
    expect(html).toContain(published.assets[REPLACEMENT_ASSET_ID]!.url)
    expect(authoritativeSnapshot()).toEqual(beforeReadEndpoints)
  })

  it('rejects an exact-revision-stale target without changing any Store-owned state', () => {
    const target = useEditorStore.getState().captureImageReplacementTarget()
    if (!target) throw new Error('Expected a captured image replacement target')

    useEditorStore.getState().renameProject('VS-05 intervening edit')
    expect(activeProject().revision).toBe(target.documentRevision + 1)
    const beforeRejectedCommit = authoritativeSnapshot()

    const result = useEditorStore.getState().replaceImageAssetAtTarget(
      target,
      replacementMeta(),
      REPLACEMENT_BYTES,
    )
    expect(result).toMatchObject({
      ok: false,
      code: 'revision-conflict',
    })
    if (result.ok) throw new Error('Expected a stale replacement rejection')
    expect(result.reason).toMatch(/改变|重新选择|再试/)
    expect(authoritativeSnapshot()).toEqual(beforeRejectedCommit)
  })

  it('preserves stable rejection codes for owner and named-state drift', () => {
    const cases = [
      {
        code: 'owner-mismatch',
        drift: () => useEditorStore.getState().setEditingScope('global'),
      },
      {
        code: 'surface-or-location',
        drift: () => useEditorStore.getState().setActivePresentationState('slide-state-evidence'),
      },
    ] as const
    for (const staleCase of cases) {
      loadFixture()
      const target = useEditorStore.getState().captureImageReplacementTarget()
      if (!target) throw new Error('Expected a captured image replacement target')
      staleCase.drift()
      const beforeRejectedCommit = authoritativeSnapshot()
      const result = useEditorStore.getState().replaceImageAssetAtTarget(
        target,
        replacementMeta(),
        REPLACEMENT_BYTES,
      )
      expect(result).toMatchObject({ ok: false, code: staleCase.code })
      expect(authoritativeSnapshot()).toEqual(beforeRejectedCommit)
    }
  })

  it('invalidates an old target when undo returns to the same document revision', () => {
    const target = useEditorStore.getState().captureImageReplacementTarget()
    if (!target) throw new Error('Expected a captured image replacement target')
    expect(useEditorStore.getState().replaceImageAssetAtTarget(
      target,
      replacementMeta(),
      REPLACEMENT_BYTES,
    )).toMatchObject({ ok: true, status: 'replaced' })
    useEditorStore.getState().undo()
    expect(activeProject().revision).toBe(target.documentRevision)
    const beforeRejectedCommit = authoritativeSnapshot()
    const result = useEditorStore.getState().replaceImageAssetAtTarget(
      target,
      replacementMeta('vs05-aba-replacement'),
      REPLACEMENT_BYTES,
    )
    expect(result).toMatchObject({ ok: false, code: 'session-stale' })
    expect(authoritativeSnapshot()).toEqual(beforeRejectedCommit)
  })

  it('keeps legacy snapshots aligned around a resource frame and clears future on a branch', () => {
    const originalTitle = activeProject().title
    useEditorStore.getState().renameProject('VS-05 legacy step before delta')
    expect(sidecarDepths()).toEqual({ past: 1, future: 0 })
    const target = useEditorStore.getState().captureImageReplacementTarget()
    if (!target) throw new Error('Expected a captured image replacement target')
    expect(useEditorStore.getState().replaceImageAssetAtTarget(
      target,
      replacementMeta(),
      REPLACEMENT_BYTES,
    )).toMatchObject({ ok: true, status: 'replaced' })
    expect(sidecarDepths()).toEqual({ past: 1, future: 0 })

    useEditorStore.getState().renameProject('VS-05 legacy step after delta')
    expect(activeProject().title).toBe('VS-05 legacy step after delta')
    expect(sidecarDepths()).toEqual({ past: 2, future: 0 })

    useEditorStore.getState().undo()
    expect(activeProject().title).toBe('VS-05 legacy step before delta')
    expect(imageAssetId(activeProject())).toBe(REPLACEMENT_ASSET_ID)
    expect(sidecarDepths()).toEqual({ past: 1, future: 1 })

    useEditorStore.getState().undo()
    expect(activeProject().title).toBe('VS-05 legacy step before delta')
    expect(imageAssetId(activeProject())).not.toBe(REPLACEMENT_ASSET_ID)
    expect(selectMediaAssetFiles(useEditorStore.getState())[REPLACEMENT_ASSET_ID])
      .toBeUndefined()
    expect(sidecarDepths()).toEqual({ past: 1, future: 1 })

    useEditorStore.getState().redo()
    expect(imageAssetId(activeProject())).toBe(REPLACEMENT_ASSET_ID)
    expect(selectMediaAssetFiles(useEditorStore.getState())[REPLACEMENT_ASSET_ID])
      .toEqual(REPLACEMENT_BYTES)
    expect(sidecarDepths()).toEqual({ past: 1, future: 1 })

    useEditorStore.getState().redo()
    expect(activeProject().title).toBe('VS-05 legacy step after delta')
    expect(sidecarDepths()).toEqual({ past: 2, future: 0 })

    useEditorStore.getState().undo()
    useEditorStore.getState().undo()
    expect(sidecarDepths()).toEqual({ past: 1, future: 1 })
    useEditorStore.getState().selectNode(IMAGE_A)
    const branchTarget = useEditorStore.getState().captureImageReplacementTarget()
    if (!branchTarget) throw new Error('Expected a branch replacement target')
    const branchBytes = REPLACEMENT_BYTES.slice()
    const branchAsset = replacementMeta('vs05-image-branch', branchBytes)
    expect(useEditorStore.getState().replaceImageAssetAtTarget(
      branchTarget,
      branchAsset,
      branchBytes,
    )).toMatchObject({ ok: true, status: 'replaced' })
    const branched = useEditorStore.getState()
    expect(imageAssetId(activeProject())).toBe(branchAsset.id)
    expect(selectMediaAssetFiles(branched)[branchAsset.id]).toEqual(branchBytes)
    expect(branched.history.future).toHaveLength(0)
    expect(sidecarDepths()).toEqual({ past: 1, future: 0 })
    expect(branched.slideCandidateComponentPackagesFuture).toHaveLength(0)
    expect(activeProject().title).not.toBe(originalTitle)
  })

  it('rejects same-ID metadata or byte conflicts instead of overwriting an existing asset', () => {
    const target = useEditorStore.getState().captureImageReplacementTarget()
    if (!target) throw new Error('Expected a captured image replacement target')
    const project = activeProject()
    const currentAssetId = imageAssetId(project)
    const currentMeta = project.assets[currentAssetId]
    const currentBytes = selectMediaAssetFiles(useEditorStore.getState())[currentAssetId]
    if (!currentMeta || !currentBytes) throw new Error('Fixture image payload is missing')

    const beforeConflict = authoritativeSnapshot()
    const result = useEditorStore.getState().replaceImageAssetAtTarget(
      target,
      { ...structuredClone(currentMeta), filename: 'same-id-different.png' },
      currentBytes.slice(),
    )
    expect(result).toMatchObject({ ok: false, code: 'asset-conflict' })
    expect(authoritativeSnapshot()).toEqual(beforeConflict)
  })
})
