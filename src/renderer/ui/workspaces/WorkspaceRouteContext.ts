import type { CourseAuthoringSurfaceType } from '../../authoring/courseAuthoringSession'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '../../store/editorStore'

export const WORKSPACE_ROUTE_CONFLICT_ERROR =
  '编辑表面状态冲突，请重新选择当前页面'

export type WorkspaceSurfaceRoute =
  | { readonly kind: 'slide' }
  | { readonly kind: 'flow' }
  | { readonly kind: 'spatial' }
  | { readonly kind: 'conflict'; readonly message: string }

export interface WorkspaceRouteSignals {
  readonly hasSlideSession: boolean
  readonly hasFlowSession: boolean
  readonly hasSpatialSession: boolean
  readonly expectedSurfaceType: CourseAuthoringSurfaceType | null
  readonly locationSurfaceType: CourseAuthoringSurfaceType | null
}

type WorkspaceRouteStore = {
  readonly flowSession: unknown | null
  readonly spatialSession: unknown | null
  readonly courseAuthoringSession: {
    readonly token: { readonly surfaceType: CourseAuthoringSurfaceType }
  } | null
}

function selectHasFlowSession(state: WorkspaceRouteStore): boolean {
  return state.flowSession !== null
}

function selectHasSpatialSession(state: WorkspaceRouteStore): boolean {
  return state.spatialSession !== null
}

function selectExpectedSurfaceType(
  state: WorkspaceRouteStore,
): CourseAuthoringSurfaceType | null {
  return state.courseAuthoringSession?.token.surfaceType ?? null
}

export function resolveWorkspaceRoute(
  signals: WorkspaceRouteSignals,
): WorkspaceSurfaceRoute {
  const activeSessionCount = Number(signals.hasSlideSession)
    + Number(signals.hasFlowSession)
    + Number(signals.hasSpatialSession)
  if (activeSessionCount > 1) {
    return { kind: 'conflict', message: WORKSPACE_ROUTE_CONFLICT_ERROR }
  }
  if (signals.hasFlowSession) {
    if (signals.expectedSurfaceType && signals.expectedSurfaceType !== 'flow') {
      return { kind: 'conflict', message: WORKSPACE_ROUTE_CONFLICT_ERROR }
    }
    return { kind: 'flow' }
  }
  if (signals.hasSpatialSession) {
    if (signals.expectedSurfaceType && signals.expectedSurfaceType !== 'spatial-2d') {
      return { kind: 'conflict', message: WORKSPACE_ROUTE_CONFLICT_ERROR }
    }
    return { kind: 'spatial' }
  }
  if (signals.hasSlideSession) {
    if (signals.expectedSurfaceType && signals.expectedSurfaceType !== 'slide') {
      return { kind: 'conflict', message: WORKSPACE_ROUTE_CONFLICT_ERROR }
    }
    return { kind: 'slide' }
  }
  if (
    signals.expectedSurfaceType
    && signals.locationSurfaceType
    && signals.expectedSurfaceType !== signals.locationSurfaceType
  ) {
    return { kind: 'conflict', message: WORKSPACE_ROUTE_CONFLICT_ERROR }
  }
  const surfaceType = signals.expectedSurfaceType ?? signals.locationSurfaceType ?? 'slide'
  return surfaceType === 'flow'
    ? { kind: 'flow' }
    : surfaceType === 'spatial-2d'
      ? { kind: 'spatial' }
      : { kind: 'slide' }
}

export function useWorkspaceRoute(): WorkspaceSurfaceRoute {
  const slideBackend = useEditorStore(selectSlideAuthoringBackend)
  const hasFlowSession = useEditorStore(selectHasFlowSession)
  const hasSpatialSession = useEditorStore(selectHasSpatialSession)
  const expectedSurfaceType = useEditorStore(selectExpectedSurfaceType)
  const project = useEditorStore(selectActiveCourseProjectDocument)
  const locationId = useEditorStore(selectActiveCourseLocationId)
  const location = project?.locations.find((candidate) => candidate.id === locationId)
  const surface = location
    ? project?.surfaces.find((candidate) => candidate.id === location.surfaceId)
    : null
  const locationSurfaceType = surface && (
    surface.type === 'slide'
    || surface.type === 'flow'
    || surface.type === 'spatial-2d'
  )
    ? surface.type
    : null
  return resolveWorkspaceRoute({
    hasSlideSession: slideBackend !== null,
    hasFlowSession,
    hasSpatialSession,
    expectedSurfaceType,
    locationSurfaceType,
  })
}
