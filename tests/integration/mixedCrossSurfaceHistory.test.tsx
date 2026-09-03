import { beforeEach, describe, expect, it } from 'vitest'
import {
  panSpatialSessionCamera,
  updateSpatialSurfaceBackgroundColor,
  zoomSpatialSessionCamera,
} from '@/renderer/course/spatialEditorCommands'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

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

function activeDocument(): CourseProjectDocument {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('Expected active Course Project V9 document')
  return document
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

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.getState().loadCourseProject(mixedProject(), null)
})

describe('Mixed cross-surface history continuity', () => {
  it('keeps one canonical history while every target Surface session stays fresh', () => {
    useEditorStore.getState().activateCourseLocation(SPATIAL_LOCATION_ID)
    useEditorStore.getState().selectNode(SPATIAL_ITEM_ID)
    const spatialBeforeEdit = useEditorStore.getState().spatialSession
    if (!spatialBeforeEdit) throw new Error('Expected Spatial authoring session')
    expect(spatialBeforeEdit.history.past).toEqual([])

    useEditorStore.getState().updateNode(SPATIAL_ITEM_ID, { name: SPATIAL_EDITED_LABEL })
    const spatialAfterEdit = useEditorStore.getState().spatialSession
    if (!spatialAfterEdit) throw new Error('Expected edited Spatial authoring session')
    expect(spatialAfterEdit.history.past).toHaveLength(1)
    expect(layerLabel(spatialAfterEdit.history.present, SPATIAL_ITEM_ID))
      .toBe(SPATIAL_EDITED_LABEL)

    const spatialPackage = componentPackage(SPATIAL_PACKAGE_ID, 17)
    useEditorStore.getState().importComponentPackage(spatialPackage)
    const spatialAfterImport = useEditorStore.getState().spatialSession
    if (!spatialAfterImport) throw new Error('Expected Spatial session after component import')
    expect(spatialAfterImport.history.past).toHaveLength(2)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(2)
    expectComponentPackagePresent(spatialPackage)

    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().setEditingScope('scene')
    const spatialBeforeCamera = useEditorStore.getState().spatialSession
    if (!spatialBeforeCamera) throw new Error('Expected Spatial session before camera movement')
    expect(spatialBeforeCamera.generation).toBeGreaterThan(0)

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
    expect(afterCamera.history).toBe(historyBeforeCamera)
    expect(afterCamera.history.present).toBe(historyBeforeCamera.present)
    expect(afterCamera.history.present.revision).toBe(spatialBeforeCamera.history.present.revision)
    expect(afterCamera.history.past).toBe(historyBeforeCamera.past)
    expect(afterCamera.history.future).toBe(historyBeforeCamera.future)
    expect(useEditorStore.getState().courseAssetSidecarPast).toBe(sidecarPastBeforeCamera)
    expect(useEditorStore.getState().courseAssetSidecarFuture).toBe(sidecarFutureBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toBe(componentPackagesPastBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toBe(componentPackagesFutureBeforeCamera)
    expect(openCourseProjectArchive(
      useEditorStore.getState().exportV9SlideCandidateArchive()!,
    ).project).toEqual(savedBeforeCamera)

    const firstSpatialSessionId = afterCamera.sessionId
    useEditorStore.getState().activateCourseLocation(SLIDE_LOCATION_ID)
    const freshSlide = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!freshSlide) throw new Error('Expected fresh Slide authoring session')
    expect(freshSlide.history).toBe(historyBeforeCamera)
    expect(freshSlide.generation).toBe(0)
    expect(freshSlide.selection.locationId).toBe(SLIDE_LOCATION_ID)
    expect(freshSlide.selection.selectionIds).toEqual([])
    expect(useEditorStore.getState().courseAssetSidecarPast).toBe(sidecarPastBeforeCamera)
    expect(useEditorStore.getState().courseAssetSidecarFuture).toBe(sidecarFutureBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toBe(componentPackagesPastBeforeCamera)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toBe(componentPackagesFutureBeforeCamera)

    useEditorStore.getState().undo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)
    expect(selectSlideAuthoringBackend(useEditorStore.getState())?.getSession().history.past)
      .toHaveLength(1)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(1)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(1)

    useEditorStore.getState().redo()
    expectComponentPackagePresent(spatialPackage)
    expect(useEditorStore.getState().componentPackages[SPATIAL_PACKAGE_ID]).toBe(spatialPackage)
    expect(selectSlideAuthoringBackend(useEditorStore.getState())?.getSession().history.past)
      .toHaveLength(2)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(2)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(0)

    useEditorStore.getState().selectNode(SLIDE_ITEM_ID)
    useEditorStore.getState().updateNode(SLIDE_ITEM_ID, { name: SLIDE_EDITED_LABEL })
    const slideAfterEdit = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!slideAfterEdit) throw new Error('Expected edited Slide authoring session')
    expect(slideAfterEdit.history.past).toHaveLength(3)
    expect(layerLabel(slideAfterEdit.history.present, SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(slideAfterEdit.history.present, SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    const canonicalHistory = slideAfterEdit.history
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
    expect(returnedSpatial.history).toBe(canonicalHistory)
    expect(returnedSpatial.selection.locationId).toBe(SPATIAL_LOCATION_ID)
    expect(returnedSpatial.selection.selectionIds).toEqual([])
    expect(returnedSpatial.sessionCamera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(useEditorStore.getState().courseAssetSidecarPast).toBe(sidecarPastAfterBothEdits)
    expect(useEditorStore.getState().courseAssetSidecarFuture).toBe(sidecarFutureAfterBothEdits)
    expect(useEditorStore.getState().courseComponentPackagesPast)
      .toBe(componentPackagesPastAfterBothEdits)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toBe(componentPackagesFutureAfterBothEdits)

    const beforeStaleDocument = returnedSpatial.history.present
    const beforeStalePast = returnedSpatial.history.past
    const beforeStaleFuture = returnedSpatial.history.future
    const dirtyBeforeStale = useEditorStore.getState().dirty
    const staleCommand = updateSpatialSurfaceBackgroundColor(
      staleSpatialSession,
      '#ffeecc',
      { expectedRevision: staleSpatialSession.history.present.revision },
    )
    expect(staleCommand.nextSession?.history.present.revision)
      .toBe(beforeStaleDocument.revision)
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

    useEditorStore.getState().undo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackagePresent(spatialPackage)

    useEditorStore.getState().undo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)

    useEditorStore.getState().undo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_ORIGINAL_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)

    useEditorStore.getState().redo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackageAbsent(SPATIAL_PACKAGE_ID)

    useEditorStore.getState().redo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)
    expectComponentPackagePresent(spatialPackage)

    useEditorStore.getState().redo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    expectComponentPackagePresent(spatialPackage)

    const archive = useEditorStore.getState().exportV9SlideCandidateArchive()
    if (!archive) throw new Error('Expected Course Project archive')
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(archive)).toBe(true)
    const reopenedSlide = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!reopenedSlide) throw new Error('Expected reopened Slide authoring session')
    expect(reopenedSlide.history.past).toEqual([])
    expect(reopenedSlide.history.future).toEqual([])
    expect(layerLabel(reopenedSlide.history.present, SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(reopenedSlide.history.present, SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    expectComponentPackagePresent(spatialPackage)
    expect(useEditorStore.getState().courseAssetSidecarPast).toEqual([])
    expect(useEditorStore.getState().courseAssetSidecarFuture).toEqual([])
    expect(useEditorStore.getState().courseComponentPackagesPast).toEqual([])
    expect(useEditorStore.getState().courseComponentPackagesFuture).toEqual([])
  })

  it('moves Flow legacy component payloads with metadata and preserves no-op stack identity', () => {
    useEditorStore.getState().activateCourseLocation(FLOW_LOCATION_ID)
    const flowPackage = componentPackage(FLOW_PACKAGE_ID, 41)

    useEditorStore.getState().importComponentPackage(flowPackage)
    const flowAfterImport = useEditorStore.getState().flowSession
    if (!flowAfterImport) throw new Error('Expected Flow session after component import')
    expect(flowAfterImport.history.past).toHaveLength(1)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(1)
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
      .toBe(packagePastBeforeSelection)
    expect(useEditorStore.getState().courseComponentPackagesFuture)
      .toBe(packageFutureBeforeSelection)

    useEditorStore.getState().undo()
    expectComponentPackageAbsent(FLOW_PACKAGE_ID)
    expect(useEditorStore.getState().flowSession?.history.past).toHaveLength(0)
    expect(useEditorStore.getState().flowSession?.history.future).toHaveLength(1)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(0)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(1)

    useEditorStore.getState().redo()
    expectComponentPackagePresent(flowPackage)
    expect(useEditorStore.getState().componentPackages[FLOW_PACKAGE_ID]).toBe(flowPackage)
    expect(useEditorStore.getState().flowSession?.history.past).toHaveLength(1)
    expect(useEditorStore.getState().flowSession?.history.future).toHaveLength(0)
    expect(useEditorStore.getState().courseComponentPackagesPast).toHaveLength(1)
    expect(useEditorStore.getState().courseComponentPackagesFuture).toHaveLength(0)
  })
})
