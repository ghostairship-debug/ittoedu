import type { ComponentSpatialPose, CourseProjectV10 } from '../../../../shared/contracts/component-platform'
import { frameCorners } from '../../../../core/components/geometry'
import { spatialWorldTargets } from './targets'
import { isComponentVisibleAtSurface } from '../../../../shared/contracts/component-platform/project'
import { spatialSemanticVisible } from '../../../../player/surfaces/spatial/componentPlatform/graph'
export function fitSpatialComponentWorld(project: CourseProjectV10, surfaceId: string, viewport: { width: number; height: number },
  options: { scope?: 'visible' | 'all'; zoom?: number } = {}): ComponentSpatialPose {
  const spatial = project.surfaces.find(value => value.id === surfaceId)?.spatial
  const targets = spatialWorldTargets(project, surfaceId).filter(target => options.scope === 'all'
    || [...target.ancestors, target.instanceId].every(id => isComponentVisibleAtSurface(project.instances[id], surfaceId)
      && spatialSemanticVisible(spatial, id, options.zoom ?? 1)))
  const points = targets.flatMap(target => [...frameCorners(target.frame, target.parentToSurface)])
  if (!points.length) return spatial?.home ?? { x: 0, y: 0, zoom: 1 }
  const left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x))
  const top = Math.min(...points.map(point => point.y)), bottom = Math.max(...points.map(point => point.y))
  return { x: (left + right) / 2, y: (top + bottom) / 2, zoom: Math.min(viewport.width / Math.max(1, right - left), viewport.height / Math.max(1, bottom - top)) * 0.9 }
}
