import type { CourseProjectHealthFinding } from '../../shared/courseProjectHealth'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DiagnosticTargetV1 } from '../../shared/courseProjectValidationDiagnostics'
import type { EditingScope, SidebarTab } from '../store/editorStore'

export interface ProjectHealthRoute {
  scope: EditingScope
  tab: SidebarTab
  locationId?: string
  sceneId?: string
  stateId?: string | null
  nodeId?: string
  layerItemId?: string
}

function firstLocationForSurface(
  project: CourseProjectDocument,
  surfaceId: string,
): string | undefined {
  return project.locations.find((location) => location.surfaceId === surfaceId)?.id
}

function globalLayerLocation(
  project: CourseProjectDocument,
  layerItemId: string,
): string | undefined {
  const scoped = project.globalLayerItems.find(
    ({ item }) => item.layerItemId === layerItemId,
  )
  if (!scoped) return project.startLocationId
  const knownIds = new Set(project.locations.map(({ id }) => id))
  if (scoped.visibility.mode === 'include') {
    return scoped.visibility.locationIds.find((id) => knownIds.has(id))
      ?? project.startLocationId
  }
  if (scoped.visibility.mode === 'exclude') {
    const excluded = new Set(scoped.visibility.locationIds)
    return project.locations.find(({ id }) => !excluded.has(id))?.id
      ?? project.startLocationId
  }
  return project.startLocationId
}

function courseFindingTab(target: DiagnosticTargetV1, code: string): SidebarTab {
  if (target.kind === 'asset') return 'elements'
  if (target.kind === 'component-package') return 'components'
  if (
    code.startsWith('interaction-')
    || code.startsWith('project-health:interaction-')
    || code.startsWith('information-release-')
    || code.startsWith('project-health:information-release-')
    || code.startsWith('published-interaction-')
    || code.startsWith('project-health:published-interaction-')
    || code.endsWith('global-interaction-state-target-partial')
    || code.endsWith('looping-video-ended-unreachable')
    || code.endsWith('video-click-interaction-conflict')
  ) {
    return 'automation'
  }
  return 'properties'
}

/** Resolve only stable Course Project V9 diagnostic target identities. */
export function resolveCourseProjectHealthRoute(
  project: CourseProjectDocument,
  finding: CourseProjectHealthFinding,
): ProjectHealthRoute {
  return resolveCourseProjectDiagnosticTargetRoute(
    project,
    finding.target,
    finding.code,
    finding.path,
  )
}

export function resolveCourseProjectDiagnosticTargetRoute(
  project: CourseProjectDocument,
  target: DiagnosticTargetV1,
  code = '',
  path: ReadonlyArray<string | number> = [],
): ProjectHealthRoute {
  const base: ProjectHealthRoute = {
    scope: (
      target.kind === 'layer-item' && target.owner === 'global'
    ) || path[0] === 'globalInteractions'
      ? 'global'
      : 'scene',
    tab: courseFindingTab(target, code),
  }
  if (target.projectId !== project.id) return base

  if (target.kind === 'location') {
    return { ...base, locationId: target.locationId }
  }
  if (target.kind === 'surface') {
    const locationId = firstLocationForSurface(project, target.surfaceId)
    return {
      ...base,
      ...(locationId ? { locationId } : {}),
    }
  }
  if (target.kind === 'scene') {
    const location = project.locations.find((candidate) => (
      candidate.kind === 'slide-scene'
      && candidate.surfaceId === target.surfaceId
      && candidate.sceneId === target.sceneId
    ))
    return {
      ...base,
      ...(location ? { locationId: location.id } : {}),
    }
  }
  if (target.kind === 'flow-block') {
    const location = project.locations.find((candidate) => (
      candidate.kind === 'flow-block'
      && candidate.surfaceId === target.surfaceId
      && candidate.blockId === target.blockId
    ))
    const locationId = location?.id ?? firstLocationForSurface(project, target.surfaceId)
    return {
      ...base,
      ...(locationId ? { locationId } : {}),
    }
  }
  if (target.kind !== 'layer-item') return base

  if (target.owner === 'global') {
    const locationId = globalLayerLocation(project, target.layerItemId)
    return {
      ...base,
      ...(locationId ? { locationId } : {}),
      layerItemId: target.layerItemId,
    }
  }
  if (target.owner === 'scene') {
    const location = project.locations.find((candidate) => (
      candidate.kind === 'slide-scene'
      && candidate.surfaceId === target.surfaceId
      && candidate.sceneId === target.sceneId
    ))
    return {
      ...base,
      ...(location ? { locationId: location.id } : {}),
      layerItemId: target.layerItemId,
    }
  }
  const locationId = firstLocationForSurface(project, target.surfaceId)
  return {
    ...base,
    ...(locationId ? { locationId } : {}),
    layerItemId: target.layerItemId,
  }
}
