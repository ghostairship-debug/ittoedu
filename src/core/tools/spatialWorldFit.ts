import type { CourseProjectDocument, SpatialCameraPose } from '../../shared/courseProjectTypes'
import { composeCourseProjectLocation } from '../../shared/courseLayerComposition'
import { spatialSurfaceIn } from './spatialInsertion'
import { spatialLayerCoordinateSpace } from './spatialCoordinates'
export interface SpatialWorldContentFitInput {
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly padding?: number
}


function spatialWorldContentLayers(project: CourseProjectDocument, locationId: string) {
  const composition = composeCourseProjectLocation({ project, locationId, stateId: null })
  spatialSurfaceIn(project, composition.surfaceId)
  return composition.entries.filter(entry => entry.mounted && entry.source !== 'scene' && spatialLayerCoordinateSpace(entry.source, entry.item) === 'world')
}
export function spatialHasWorldContent(project: CourseProjectDocument, locationId: string): boolean {
  return spatialWorldContentLayers(project, locationId).length > 0
}
export function spatialCameraFittingWorldContent(
  project: CourseProjectDocument,
  locationId: string,
  input: SpatialWorldContentFitInput,
): SpatialCameraPose {
  if (!(input.viewportWidth > 0) || !(input.viewportHeight > 0)) {
    throw new Error('适配视口尺寸必须大于零')
  }
  const worldItems = spatialWorldContentLayers(project, locationId)
  if (worldItems.length === 0) {
    const composition = composeCourseProjectLocation({ project, locationId, stateId: null })
    const surface = spatialSurfaceIn(project, composition.surfaceId)
    return { ...surface.camera.home }
  }
  const minX = Math.min(...worldItems.map((layer) => layer.item.frame.x))
  const minY = Math.min(...worldItems.map((layer) => layer.item.frame.y))
  const maxX = Math.max(...worldItems.map((layer) => layer.item.frame.x + layer.item.frame.width))
  const maxY = Math.max(...worldItems.map((layer) => layer.item.frame.y + layer.item.frame.height))
  const padding = input.padding ?? 40
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const zoom = Math.min(
    1_000,
    input.viewportWidth / (width + padding * 2),
    input.viewportHeight / (height + padding * 2),
  )
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    zoom: Math.min(1_000, Math.max(zoom, 0.000_001)),
  }
}
