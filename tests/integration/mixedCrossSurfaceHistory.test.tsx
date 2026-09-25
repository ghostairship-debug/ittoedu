import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  panSpatialSessionCamera,
  updateSpatialSurfaceBackgroundColor,
  zoomSpatialSessionCamera,
} from '@/renderer/course/spatialEditorCommands'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectEffectiveLayerProjection,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import {
  bootTriageCourseHost,
  formalCourse,
  projectBody,
  projectCourse,
  redoCourse,
  settleCourse,
  undoCourse,
  type TriageCourseHost,
} from '../helpers/triage-t7-courseHost'

const SLIDE_LOCATION_ID = 'location-slide'
const FLOW_LOCATION_ID = 'location-flow'
const SPATIAL_LOCATION_ID = 'location-spatial'
const SLIDE_ITEM_ID = 'slide-title'
const SPATIAL_ITEM_ID = 'spatial-label'
const SLIDE_ORIGINAL_LABEL = 'slide-title'
const SPATIAL_ORIGINAL_LABEL = 'spatial-label'
const SLIDE_EDITED_LABEL = '跨表面后的演示标题'
const SPATIAL_EDITED_LABEL = '跨表面历史中的空间节点'
const SPATIAL_PACKAGE_ID = 'com.example.mixed-spatial-history'
const FLOW_PACKAGE_ID = 'com.example.mixed-flow-history'

function componentPackage(packageId: string, marker: number): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: packageId,
    name: `${packageId} package`,
    version: '1.0.0',
    entry: 'runtime.js',
    defaultSize: { width: 320, height: 180 },
    minSize: { width: 80, height: 45 },
    preserveAspectRatio: true,
    assets: { marker: 'assets/marker.bin' },
    defaultProps: { marker },
    supportedScopes: ['scene'],
    renderMode: 'dom',
  }
  const runtimeSource = [
    'window.CoursewareComponent.define({',
    `id:'${packageId}',`,
    'runtimeApiVersion:4,',
    'create:function(){return{destroy:function(){}}}',
    '})',
  ].join('')
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
    'assets/marker.bin': new Uint8Array([marker, marker + 1, marker + 2]),
  }
  return {
    manifest,
    runtimeSource,
    files,
    contentSha256: componentContentSha256(files),
  }
}

function mixedProject(): CourseProjectDocument {
  const fixture = listCourseProjectV9Fixtures().find((candidate) => candidate.id === 'mixed')
  if (!fixture) throw new Error('Missing mixed Course Project V9 fixture')
  return structuredClone(fixture.data.project)
}

let host: TriageCourseHost

async function loadMixed() {
  const fixture = listCourseProjectV9Fixtures().find(candidate => candidate.id === 'mixed')!.data
  await projectCourse(host, mixedProject(), fixture.assetFiles, componentPackagesFromArchive(fixture.project, fixture.componentFiles))
}

function activeDocument(): CourseProjectDocument {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('Expected active Course Project V9 document')
  return document
}

/** DocumentSession owns the one canonical history; renderer sessions are projections. */
function canonicalDepths(): { past: number; future: number } {
  const snapshot = formalCourse(host)
  return { past: snapshot.undoDepth, future: snapshot.redoDepth }
}

function layerLabel(document: CourseProjectDocument, layerItemId: string): string | undefined {
  return locateCourseLayer(document, layerItemId)?.item.label
}

function packageBytes(files: Readonly<Record<string, Uint8Array>>): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => [path, [...bytes]]),
  )
}

function expectComponentPackagePresent(packageData: ComponentPackageData): void {
  expect(activeDocument().componentPackages[packageData.manifest.id]).toMatchObject({
    packageId: packageData.manifest.id,
    version: packageData.manifest.version,
    contentSha256: packageData.contentSha256,
  })
  const payload = useEditorStore.getState().componentPackages[packageData.manifest.id]
  expect(payload?.manifest).toEqual(packageData.manifest)
  expect(payload?.runtimeSource).toBe(packageData.runtimeSource)
  expect(packageBytes(payload?.files ?? {})).toEqual(packageBytes(packageData.files))
  expect(payload?.contentSha256).toBe(packageData.contentSha256)
}

function expectComponentPackageAbsent(packageId: string): void {
  expect(activeDocument().componentPackages[packageId]).toBeUndefined()
  expect(useEditorStore.getState().componentPackages[packageId]).toBeUndefined()
}

/**
 * DocumentSession round-trips packages through the project archive, so the Store payload is
 * rebuilt from bytes; compare the package content instead of the imported object identity.
 */
function expectPackageContent(packageId: string, expected: ComponentPackageData): void {
  const payload = useEditorStore.getState().componentPackages[packageId]
  if (!payload) throw new Error(`Expected component package ${packageId}`)
  const { key: _key, metadata: _metadata, ...content } = payload as ComponentPackageData & {
    key?: string
    metadata?: unknown
  }
  expect({ ...content, files: packageBytes(content.files) })
    .toEqual({ ...expected, files: packageBytes(expected.files) })
}

beforeEach(async () => {
  host = await bootTriageCourseHost()
  await loadMixed()
})

describe('Mixed cross-surface history continuity', () => {
  it('applies a mixed CLI candidate through the real store kernel and restores it with one Undo', async () => {
    const projectPath = '/fixtures/ai-mixed.h5lesson'
    const state = useEditorStore.getState(), document = activeDocument()
    const request = captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: projectPath },
      sessionToken: state.courseAuthoringSession!.token, projection: selectEffectiveLayerProjection(state)!, selectedIds: [], scope: 'course', componentPackages: state.componentPackages,
      instruction: '修改 Flow 与 Spatial 内容', purpose: 'local-edit' })
    const flow = request.destinations.find(destination => destination.kind === 'create' && destination.scope.surfaceType === 'flow' && destination.scope.parent.kind === 'flow-body')!
    const spatial = request.destinations.find(destination => destination.kind === 'create' && destination.scope.surfaceType === 'spatial-2d' && destination.scope.owner === 'world')!
    const candidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '增加两处讲解', steps: [
      { id: 'flow', tool: 'flow.content', carrier: 'native', destination: flow, input: { operation: 'insert', block: { type: 'paragraph', content: { inlines: [{ type: 'text', text: '新增 Flow 讲解' }] } } } },
      { id: 'spatial', tool: 'native.content', carrier: 'native', destination: spatial, input: { operation: 'insert', template: { nativeType: 'text', text: '新增 Spatial 讲解' } } },
    ] }
    const preview = await state.prepareGenerationCandidate(request, candidate)
    expect(activeDocument()).toEqual(document)
    expect((await useEditorStore.getState().applyGenerationCandidate(preview.previewId)).status).toBe('committed')
    expect(JSON.stringify(activeDocument())).toContain('新增 Flow 讲解')
    expect(JSON.stringify(activeDocument())).toContain('新增 Spatial 讲解')
    await undoCourse(host)
    expect(projectBody(activeDocument())).toEqual(projectBody(document))
    const generation = useEditorStore.getState().courseAuthoringSession!.token.generation
    // DocumentSession keeps advancing its revision on undo, so a fresh request must cite it.
    const revision = activeDocument().revision
    const fresh = { ...request, requestId: crypto.randomUUID(), documentRevision: revision,
      sessionGeneration: generation,
      taskFacts: { ...request.taskFacts!, documentRevision: revision, sessionGeneration: generation }, destinations: request.destinations.map(destination => destination.kind === 'create'
      ? { ...destination, scope: { ...destination.scope, documentRevision: revision, sessionGeneration: generation } } : { ...destination, target: { ...destination.target, documentRevision: revision, sessionGeneration: generation } }) }
    const freshCandidate = { ...candidate, requestId: fresh.requestId, steps: candidate.steps.map(step => ({ ...step, destination: step.destination.kind === 'create'
      ? { ...step.destination, scope: { ...step.destination.scope, documentRevision: revision, sessionGeneration: generation } } : { ...step.destination, target: { ...step.destination.target, documentRevision: revision, sessionGeneration: generation } } })) }
    const second = await useEditorStore.getState().prepareGenerationCandidate(fresh, freshCandidate)
    useEditorStore.getState().stopGenerationCandidate()
    expect(useEditorStore.getState().courseAuthoringSession!.token.generation).toBe(generation + 1)
    expect((await useEditorStore.getState().applyGenerationCandidate(second.previewId)).status).toBe('stale')
    expect(projectBody(activeDocument())).toEqual(projectBody(document))
  })
  it('keeps one canonical history while every target Surface session stays fresh', async () => {
    useEditorStore.getState().activateCourseLocation(SPATIAL_LOCATION_ID)
    useEditorStore.getState().selectNode(SPATIAL_ITEM_ID)
    const spatialBeforeEdit = useEditorStore.getState().spatialSession
    if (!spatialBeforeEdit) throw new Error('Expected Spatial authoring session')
    expect(spatialBeforeEdit.history.past).toEqual([])

    useEditorStore.getState().updateNode(SPATIAL_ITEM_ID, { name: SPATIAL_EDITED_LABEL })
    await settleCourse()
    const spatialAfterEdit = useEditorStore.getState().spatialSession
    if (!spatialAfterEdit) throw new Error('Expected edited Spatial authoring session')
    expect(canonicalDepths().past).toBe(1)
    expect(layerLabel(spatialAfterEdit.history.present, SPATIAL_ITEM_ID))
      .toBe(SPATIAL_EDITED_LABEL)

    const spatialPackage = componentPackage(SPATIAL_PACKAGE_ID, 17)
    useEditorStore.getState().importComponentPackage(spatialPackage)
    await settleCourse()
    const spatialAfterImport = useEditorStore.getState().spatialSession
    if (!spatialAfterImport) throw new Error('Expected Spatial session after component import')
    expect(canonicalDepths().past).toBe(2)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(0)
    expectComponentPackagePresent(spatialPackage)

    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().setEditingScope('scene')
    const spatialBeforeCamera = useEditorStore.getState().spatialSession
    if (!spatialBeforeCamera) throw new Error('Expected Spatial session before camera movement')
    expect(spatialBeforeCamera.generation).toBeGreaterThan(0)
    const canonicalDepthsBeforeCamera = canonicalDepths()

    const staleSpatialSession = spatialBeforeCamera
    const historyBeforeCamera = spatialBeforeCamera.history
    const sidecarPastBeforeCamera = useEditorStore.getState().courseAssetSidecarPast
    const sidecarFutureBeforeCamera = useEditorStore.getState().courseAssetSidecarFuture
    const componentPackagesPastBeforeCamera = (
      useEditorStore.getState().courseComponentPackagesPast
    )
    const componentPackagesFutureBeforeCamera = (
      useEditorStore.getState().courseComponentPackagesFuture
    )
    const savedBeforeCamera = openCourseProjectArchive(
      useEditorStore.getState().exportV9SlideCandidateArchive()!,
    ).project

    useEditorStore.getState().runSpatialCommand((session) => (
      panSpatialSessionCamera(session, { x: 125, y: -40 })
    ))
    useEditorStore.getState().runSpatialCommand((session) => zoomSpatialSessionCamera(session, 2.25))
    const afterCamera = useEditorStore.getState().spatialSession
    if (!afterCamera) throw new Error('Expected Spatial session after camera movement')
    expect(afterCamera.sessionCamera).toEqual({ x: 125, y: -40, zoom: 2.25 })
    expect(afterCamera.history.present).toBe(historyBeforeCamera.present)
    expect(afterCamera.history.present.revision).toBe(spatialBeforeCamera.history.present.revision)
    expect(canonicalDepths()).toEqual(canonicalDepthsBeforeCamera)
    expect(useEditorStore.getState().courseAssetSidecarPast).toEqual(sidecarPastBeforeCamera)
    expect(useEditorStore.getState().courseAssetSidecarFuture).toEqual(sidecarFutureBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toEqual(componentPackagesPastBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toEqual(componentPackagesFutureBeforeCamera)
    expect(openCourseProjectArchive(
      useEditorStore.getState().exportV9SlideCandidateArchive()!,
    ).project).toEqual(savedBeforeCamera)

    const firstSpatialSessionId = afterCamera.sessionId
    useEditorStore.getState().activateCourseLocation(SLIDE_LOCATION_ID)
    const freshSlide = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!freshSlide) throw new Error('Expected fresh Slide authoring session')
    expect(freshSlide.generation).toBe(0)
    expect(freshSlide.selection.locationId).toBe(SLIDE_LOCATION_ID)
    expect(freshSlide.selection.selectionIds).toEqual([])
    // 1.x asserted the fresh Slide session shared the Spatial session's history object; in 2.0
    // the renderer session is only a projection, so the equivalent fact is that switching
    // location does not add or drop a canonical DocumentSession history step.
    expect(canonicalDepths()).toEqual(canonicalDepthsBeforeCamera)
    expect(useEditorStore.getState().courseAssetSidecarPast).toEqual(sidecarPastBeforeCamera)
    expect(useEditorStore.getState().courseAssetSidecarFuture).toEqual(sidecarFutureBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toEqual(componentPackagesPastBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toEqual(componentPackagesFutureBeforeCamera)

    await undoCourse(host)
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)
    expect(canonicalDepths().past).toBe(1)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(0)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(0)

    await redoCourse(host)
    expectComponentPackagePresent(spatialPackage)
    expectPackageContent(SPATIAL_PACKAGE_ID, spatialPackage)
    expect(canonicalDepths().past).toBe(2)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(0)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(0)

    useEditorStore.getState().selectNode(SLIDE_ITEM_ID)
    useEditorStore.getState().updateNode(SLIDE_ITEM_ID, { name: SLIDE_EDITED_LABEL })
    await settleCourse()
    const slideAfterEdit = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!slideAfterEdit) throw new Error('Expected edited Slide authoring session')
    expect(canonicalDepths().past).toBe(3)
    expect(layerLabel(slideAfterEdit.history.present, SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(slideAfterEdit.history.present, SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    const canonicalHistory = slideAfterEdit.history
    const canonicalDepthsAfterBothEdits = canonicalDepths()
    const sidecarPastAfterBothEdits = useEditorStore.getState().courseAssetSidecarPast
    const sidecarFutureAfterBothEdits = useEditorStore.getState().courseAssetSidecarFuture
    const componentPackagesPastAfterBothEdits = (
      useEditorStore.getState().courseComponentPackagesPast
    )
    const componentPackagesFutureAfterBothEdits = (
      useEditorStore.getState().courseComponentPackagesFuture
    )

    useEditorStore.getState().activateCourseLocation(SPATIAL_LOCATION_ID)
    const returnedSpatial = useEditorStore.getState().spatialSession
    if (!returnedSpatial) throw new Error('Expected returned Spatial authoring session')
    expect(returnedSpatial.sessionId).not.toBe(firstSpatialSessionId)
    expect(returnedSpatial.generation).toBe(0)
    expect(returnedSpatial.generation).not.toBe(afterCamera.generation)
    expect(returnedSpatial.history.present).toBe(canonicalHistory.present)
    expect(canonicalDepths()).toEqual(canonicalDepthsAfterBothEdits)
    expect(returnedSpatial.selection.locationId).toBe(SPATIAL_LOCATION_ID)
    expect(returnedSpatial.selection.selectionIds).toEqual([])
    expect(returnedSpatial.sessionCamera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(useEditorStore.getState().courseAssetSidecarPast).toEqual(sidecarPastAfterBothEdits)
    expect(useEditorStore.getState().courseAssetSidecarFuture).toEqual(sidecarFutureAfterBothEdits)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toEqual(componentPackagesPastAfterBothEdits)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toEqual(componentPackagesFutureAfterBothEdits)

    const beforeStaleDocument = returnedSpatial.history.present
    const beforeStalePast = returnedSpatial.history.past
    const beforeStaleFuture = returnedSpatial.history.future
    const dirtyBeforeStale = useEditorStore.getState().dirty
    const staleCommand = updateSpatialSurfaceBackgroundColor(
      staleSpatialSession,
      '#ffeecc',
      { expectedRevision: staleSpatialSession.history.present.revision },
    )
    // The captured session is behind the live document, so its command advances only its own
    // copy; that outdated revision is exactly what the commit must reject.
    expect(staleSpatialSession.history.present.revision).toBeLessThan(beforeStaleDocument.revision)
    expect(staleCommand.nextSession?.history.present.revision)
      .toBe(staleSpatialSession.history.present.revision + 1)
    const staleResult = useEditorStore.getState().applySpatialAuthoringSession(
      staleCommand.nextSession!,
      { historyEntry: staleCommand.historyEntry },
    )
    expect(staleResult).toMatchObject({ ok: false, reason: 'stale-revision', historyEntry: false })
    const afterStale = useEditorStore.getState().spatialSession
    expect(afterStale).toBe(returnedSpatial)
    expect(afterStale?.history.present).toBe(beforeStaleDocument)
    expect(afterStale?.history.past).toBe(beforeStalePast)
    expect(afterStale?.history.future).toBe(beforeStaleFuture)
    expect(useEditorStore.getState().dirty).toBe(dirtyBeforeStale)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)

    await undoCourse(host)
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackagePresent(spatialPackage)

    await undoCourse(host)
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)

    await undoCourse(host)
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_ORIGINAL_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)

    await redoCourse(host)
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)

    await redoCourse(host)
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackagePresent(spatialPackage)

    await redoCourse(host)
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    expectComponentPackagePresent(spatialPackage)

    const archive = useEditorStore.getState().exportV9SlideCandidateArchive()
    if (!archive) throw new Error('Expected Course Project archive')
    expect(await useEditorStore.getState().reopenV9SlideCandidateArchive(archive)).toBe(true)
    await settleCourse()
    const reopenedSlide = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!reopenedSlide) throw new Error('Expected reopened Slide authoring session')
    expect(reopenedSlide.history.past).toEqual([])
    expect(reopenedSlide.history.future).toEqual([])
    expect(canonicalDepths()).toEqual({ past: 0, future: 0 })
    expect(layerLabel(reopenedSlide.history.present, SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(reopenedSlide.history.present, SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    expectComponentPackagePresent(spatialPackage)
    expect(useEditorStore.getState().courseAssetSidecarPast).toEqual([])
    expect(useEditorStore.getState().courseAssetSidecarFuture).toEqual([])
    expect(useEditorStore.getState().courseComponentPackagesPast).toEqual([])
    expect(useEditorStore.getState().courseComponentPackagesFuture).toEqual([])
  })

  it('moves Flow legacy component payloads with metadata and preserves no-op stack identity', async () => {
    useEditorStore.getState().activateCourseLocation(FLOW_LOCATION_ID)
    const flowPackage = componentPackage(FLOW_PACKAGE_ID, 41)

    useEditorStore.getState().importComponentPackage(flowPackage)
    await settleCourse()
    const flowAfterImport = useEditorStore.getState().flowSession
    if (!flowAfterImport) throw new Error('Expected Flow session after component import')
    expect(canonicalDepths().past).toBe(1)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(0)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(0)
    expectComponentPackagePresent(flowPackage)

    const packagePastBeforeSelection = (
      useEditorStore.getState().courseComponentPackagesPast
    )
    const packageFutureBeforeSelection = (
      useEditorStore.getState().courseComponentPackagesFuture
    )
    useEditorStore.getState().applyFlowSelection(flowAfterImport.selection)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toEqual(packagePastBeforeSelection)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toEqual(packageFutureBeforeSelection)
    expect(canonicalDepths().past).toBe(1)

    await undoCourse(host)
    expectComponentPackageAbsent(FLOW_PACKAGE_ID)
    expect(canonicalDepths()).toEqual({ past: 0, future: 1 })
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(0)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(0)

    await redoCourse(host)
    expectComponentPackagePresent(flowPackage)
    expectPackageContent(FLOW_PACKAGE_ID, flowPackage)
    expect(canonicalDepths()).toEqual({ past: 1, future: 0 })
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(0)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(0)
  })
})
