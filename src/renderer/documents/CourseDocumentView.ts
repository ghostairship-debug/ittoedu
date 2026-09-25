import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DocumentModel } from '../../shared/workbench/document'
import { componentPackagesFromArchive, componentPackagesToArchiveFiles } from '../components/componentPackageStore'
import { createSlideAuthoringBackend, openSlideAuthoringSession, selectSlideEditorLayers, type SlideAuthoringBackend, type SlideAuthoringSession } from '../course/slideAuthoringBackend'
import { openSpatialAuthoringSession, selectSpatialEditorLayers } from '../course/spatialEditorCommands'
import { selectFlowEditorBlock } from '../course/flowEditorSlice'
import { reconcileFlowSelection } from '../store/slices/flowAuthoringSlice'
import { freezeCourseAssetSidecar } from '../project/v9AssetAdapter'
import { buildCourseAuthoringSessionForProject, updateCourseAuthoringSessionRevision } from '../authoring/courseAuthoringSession'
import type { CourseAuthoringSession } from '../authoring/courseAuthoringSession'
import type { SlideOwnedState } from '../store/slices/slideAuthoringSlice'
import type { FlowOwnedState } from '../store/slices/flowAuthoringSlice'
import type { SpatialOwnedState } from '../store/slices/spatialAuthoringSlice'
import type { CourseResourceState } from '../store/courseResourceState'

export type CourseDocumentView = SlideOwnedState & FlowOwnedState & SpatialOwnedState & CourseResourceState & {
  courseAuthoringSession: CourseAuthoringSession | null
  canvasMode: 'edit' | 'run'
  editingTextNodeId: string | null
}
const cursor = (present: CourseProjectDocument) => ({ present, past: [], future: [] })

/** The donor backend is a one-call planner. It can never mutate the stored view. */
export function createCoursePlannerBackend(input: SlideAuthoringSession): SlideAuthoringBackend {
  const session = { ...input, history: cursor(input.history.present) }
  const sample = createSlideAuthoringBackend(session)
  return Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, typeof value === 'function'
    ? (...args: unknown[]) => {
      const temporary = createSlideAuthoringBackend(session)
      return (temporary[key as keyof SlideAuthoringBackend] as (...values: unknown[]) => unknown)(...args)
    } : value])) as unknown as SlideAuthoringBackend
}

/** Donor command results may carry temporary history; none enters the renderer Store. */
export function courseViewPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...patch }
  const slide = patch.slideBackend as SlideAuthoringBackend | null | undefined
  if (slide) {
    next.slideBackend = createCoursePlannerBackend(slide.getSession())
    next.slideCandidateSnapshot = (next.slideBackend as SlideAuthoringBackend).getSnapshot()
  }
  for (const key of ['flowSession', 'spatialSession'] as const) {
    const session = patch[key] as CourseDocumentView[typeof key]
    if (session) next[key] = { ...session, history: cursor(session.history.present) }
  }
  for (const key of ['courseAssetSidecarPast', 'courseAssetSidecarFuture', 'courseComponentPackagesPast', 'courseComponentPackagesFuture']) {
    if (key in next) next[key] = []
  }
  return next
}

export function courseViewDocument(view: Pick<CourseDocumentView, 'spatialSession' | 'flowSession' | 'slideBackend'>): CourseProjectDocument | null {
  return view.spatialSession?.history.present ?? view.flowSession?.history.present ?? view.slideBackend?.getSession().history.present ?? null
}

export function courseViewModel(view: Pick<CourseDocumentView, 'courseAssetSidecar' | 'componentPackages'>, project: CourseProjectDocument): Extract<DocumentModel, { kind: 'course-v9' }> {
  return { kind: 'course-v9', project, resources: { assets: view.courseAssetSidecar?.files ?? {}, components: componentPackagesToArchiveFiles(view.componentPackages) } }
}

/** Reconcile content without resetting the currently browsed location, camera or editing state. */
export function projectCourseDocument(model: Extract<DocumentModel, { kind: 'course-v9' }>, view: CourseDocumentView): Record<string, unknown> {
  const project = model.project
  const oldId = view.spatialSession?.selection.locationId ?? view.flowSession?.selection.locationId ?? view.slideCandidateSnapshot?.locationId
  const location = project.locations.find(value => value.id === oldId)
    ?? project.locations.find(value => value.id === project.startLocationId) ?? project.locations[0]!
  const patch: Record<string, unknown> = {
    slideBackend: null, slideCandidateSnapshot: null, flowSession: null, spatialSession: null,
    courseAssetSidecar: freezeCourseAssetSidecar(model.resources.assets),
    componentPackages: componentPackagesFromArchive(project, model.resources.components),
    courseAssetSidecarPast: [], courseAssetSidecarFuture: [], courseComponentPackagesPast: [], courseComponentPackagesFuture: [],
  }
  let selected: readonly string[] = []
  if (location.kind === 'slide-scene') {
    const old = view.slideBackend?.getSession()
    const fresh = old && old.selection.locationId === location.id ? old : openSlideAuthoringSession(project, { locationId: location.id })
    let selection
    try { selection = selectSlideEditorLayers({ project, locationId: location.id, stateId: fresh.selection.stateId, selectionIds: fresh.selection.selectionIds }) }
    catch { selection = selectSlideEditorLayers({ project, locationId: location.id, selectionIds: [] }) }
    const backend = createCoursePlannerBackend({ ...fresh, history: cursor(project), selection })
    patch.slideBackend = backend; patch.slideCandidateSnapshot = backend.getSnapshot(); selected = selection.selectionIds
  } else if (location.kind === 'flow-block') {
    const old = view.flowSession
    const fresh = old && old.selection.locationId === location.id ? old : { history: cursor(project), selection: selectFlowEditorBlock(project, location.id, location.blockId) }
    const selection = reconcileFlowSelection(project, { ...fresh.selection, locationId: location.id })
    patch.flowSession = { ...fresh, history: cursor(project), selection }
    selected = selection.selectedOverlayIds.length ? selection.selectedOverlayIds : selection.selectedBlockIds
  } else {
    const old = view.spatialSession
    const fresh = old && old.selection.surfaceId === location.surfaceId ? old : openSpatialAuthoringSession(project, { locationId: location.id })
    let selection
    try { selection = selectSpatialEditorLayers({ project, locationId: location.id, selectionIds: fresh.selection.selectionIds }) }
    catch { selection = selectSpatialEditorLayers({ project, locationId: location.id, selectionIds: [] }) }
    patch.spatialSession = { ...fresh, history: cursor(project), selection }; selected = selection.selectionIds
  }
  const session = view.courseAuthoringSession
  patch.courseAuthoringSession = session?.token.locationId === location.id
    ? { ...updateCourseAuthoringSessionRevision(session, project.revision), itemIds: selected }
    : buildCourseAuthoringSessionForProject(project, location.id, selected)
  return patch
}
