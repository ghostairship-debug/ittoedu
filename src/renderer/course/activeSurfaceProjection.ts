import type { FlowAuthoringSession } from '../project/createFlowCourseProject'
import type { SpatialAuthoringSession } from './spatialEditorCommands'
import type { SlideAuthoringBackend } from './slideAuthoringBackend'
import {
  projectEffectiveLayers,
  type EffectiveLayerProjection,
} from './effectiveLayerProjection'

export type ActiveSurfaceProjectionInput = {
  readonly slideBackend: SlideAuthoringBackend | null
  readonly spatialSession: SpatialAuthoringSession | null
  readonly flowSession: FlowAuthoringSession | null
}

export function spatialEffectiveLayers(
  session: SpatialAuthoringSession,
): EffectiveLayerProjection {
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: null,
    selectedIds: session.selection.selectionIds,
    owner: session.scope,
  })
}

export function flowEffectiveLayers(
  session: FlowAuthoringSession,
): EffectiveLayerProjection {
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: null,
    selectedIds: [...session.selection.selectedOverlayIds],
    owner: session.selection.authoringScope === 'global' ? 'global' : 'surface',
  })
}

export function buildCandidateEffectiveLayers(
  state: ActiveSurfaceProjectionInput,
): EffectiveLayerProjection | null {
  if (state.spatialSession) {
    return spatialEffectiveLayers(state.spatialSession)
  }
  if (state.flowSession) {
    return flowEffectiveLayers(state.flowSession)
  }
  const backend = state.slideBackend?.kind === 'slide-authoring' ? state.slideBackend : null
  if (!backend) return null
  const session = backend.getSession()
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
    selectedIds: session.selection.selectionIds,
    owner: session.scope,
  })
}
