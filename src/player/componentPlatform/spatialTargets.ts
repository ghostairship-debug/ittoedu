import { composeMatrices, IDENTITY_MATRIX, type AffineMatrix } from '../../core/components/geometry'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform'
import type { SpatialGeometryTarget } from '../surfaces/spatial/componentPlatform/graph'

/** Derived geometry for the live spatial graph; ownership remains in childIds. */
export function componentSurfaceGeometryTargets(project: CourseProjectV10, surfaceId: string): SpatialGeometryTarget[] {
  const targets: SpatialGeometryTarget[] = []
  const visit = (ids: readonly string[], parentToSurface: AffineMatrix) => {
    for (const id of ids) {
      const instance = project.instances[id]
      if (!instance) continue
      if (instance.frame) targets.push({ instanceId: id, frame: instance.frame, parentToSurface })
      visit(instance.childIds ?? [], instance.frame ? composeMatrices(parentToSurface, instance.frame.transform) : parentToSurface)
    }
  }
  visit(project.surfaces.find(surface => surface.id === surfaceId)?.childIds ?? [], IDENTITY_MATRIX)
  return targets
}
