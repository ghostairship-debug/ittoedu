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
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const SLIDE_LOCATION_ID = 'location-slide'
const SPATIAL_LOCATION_ID = 'location-spatial'
const SLIDE_ITEM_ID = 'slide-title'
const SPATIAL_ITEM_ID = 'spatial-label'
const SLIDE_ORIGINAL_LABEL = 'slide-title'
const SPATIAL_ORIGINAL_LABEL = 'spatial-label'
const SLIDE_EDITED_LABEL = '跨表面后的演示标题'
const SPATIAL_EDITED_LABEL = '跨表面历史中的空间节点'

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

    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().setEditingScope('scene')
    const spatialBeforeCamera = useEditorStore.getState().spatialSession
    if (!spatialBeforeCamera) throw new Error('Expected Spatial session before camera movement')
    expect(spatialBeforeCamera.generation).toBeGreaterThan(0)

    const staleSpatialSession = spatialBeforeCamera
    const historyBeforeCamera = spatialBeforeCamera.history
    const sidecarPastBeforeCamera = useEditorStore.getState().slideCandidateSidecarPast
    const sidecarFutureBeforeCamera = useEditorStore.getState().slideCandidateSidecarFuture
    const componentPackagesPastBeforeCamera = (
      useEditorStore.getState().slideCandidateComponentPackagesPast
    )
    const componentPackagesFutureBeforeCamera = (
      useEditorStore.getState().slideCandidateComponentPackagesFuture
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
    expect(useEditorStore.getState().slideCandidateSidecarPast).toBe(sidecarPastBeforeCamera)
    expect(useEditorStore.getState().slideCandidateSidecarFuture).toBe(sidecarFutureBeforeCamera)
    expect(useEditorStore.getState().slideCandidateComponentPackagesPast)
      .toBe(componentPackagesPastBeforeCamera)
    expect(useEditorStore.getState().slideCandidateComponentPackagesFuture)
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
    expect(useEditorStore.getState().slideCandidateSidecarPast).toBe(sidecarPastBeforeCamera)
    expect(useEditorStore.getState().slideCandidateSidecarFuture).toBe(sidecarFutureBeforeCamera)
    expect(useEditorStore.getState().slideCandidateComponentPackagesPast)
      .toBe(componentPackagesPastBeforeCamera)
    expect(useEditorStore.getState().slideCandidateComponentPackagesFuture)
      .toBe(componentPackagesFutureBeforeCamera)

    useEditorStore.getState().selectNode(SLIDE_ITEM_ID)
    useEditorStore.getState().updateNode(SLIDE_ITEM_ID, { name: SLIDE_EDITED_LABEL })
    const slideAfterEdit = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!slideAfterEdit) throw new Error('Expected edited Slide authoring session')
    expect(slideAfterEdit.history.past).toHaveLength(2)
    expect(layerLabel(slideAfterEdit.history.present, SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(slideAfterEdit.history.present, SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    const canonicalHistory = slideAfterEdit.history
    const sidecarPastAfterBothEdits = useEditorStore.getState().slideCandidateSidecarPast
    const sidecarFutureAfterBothEdits = useEditorStore.getState().slideCandidateSidecarFuture
    const componentPackagesPastAfterBothEdits = (
      useEditorStore.getState().slideCandidateComponentPackagesPast
    )
    const componentPackagesFutureAfterBothEdits = (
      useEditorStore.getState().slideCandidateComponentPackagesFuture
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
    expect(useEditorStore.getState().slideCandidateSidecarPast).toBe(sidecarPastAfterBothEdits)
    expect(useEditorStore.getState().slideCandidateSidecarFuture).toBe(sidecarFutureAfterBothEdits)
    expect(useEditorStore.getState().slideCandidateComponentPackagesPast)
      .toBe(componentPackagesPastAfterBothEdits)
    expect(useEditorStore.getState().slideCandidateComponentPackagesFuture)
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

    useEditorStore.getState().undo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_ORIGINAL_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)

    useEditorStore.getState().redo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_ORIGINAL_LABEL)

    useEditorStore.getState().redo()
    expect(layerLabel(activeDocument(), SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(activeDocument(), SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)

    const archive = useEditorStore.getState().exportV9SlideCandidateArchive()
    if (!archive) throw new Error('Expected Course Project archive')
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(archive)).toBe(true)
    const reopenedSlide = selectSlideAuthoringBackend(useEditorStore.getState())?.getSession()
    if (!reopenedSlide) throw new Error('Expected reopened Slide authoring session')
    expect(reopenedSlide.history.past).toEqual([])
    expect(reopenedSlide.history.future).toEqual([])
    expect(layerLabel(reopenedSlide.history.present, SPATIAL_ITEM_ID)).toBe(SPATIAL_EDITED_LABEL)
    expect(layerLabel(reopenedSlide.history.present, SLIDE_ITEM_ID)).toBe(SLIDE_EDITED_LABEL)
    expect(useEditorStore.getState().slideCandidateSidecarPast).toEqual([])
    expect(useEditorStore.getState().slideCandidateSidecarFuture).toEqual([])
    expect(useEditorStore.getState().slideCandidateComponentPackagesPast).toEqual([])
    expect(useEditorStore.getState().slideCandidateComponentPackagesFuture).toEqual([])
  })
})
