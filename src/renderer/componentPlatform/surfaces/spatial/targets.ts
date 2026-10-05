import { freeSurfaceTargets, type FreeObjectTarget } from '../slide/targets'
import type { CourseProjectV10 } from '../../../../shared/contracts/component-platform'

/** Global planes belong to the root's viewport projection, never the world camera. */
export function spatialWorldTargets(project: CourseProjectV10, surfaceId: string): FreeObjectTarget[] {
  const roots = new Set(project.surfaces.find(surface => surface.id === surfaceId)?.childIds ?? [])
  return freeSurfaceTargets(project, surfaceId).filter(target => roots.has(target.ancestors[0] ?? target.instanceId))
}
