import { nanoid } from 'nanoid'
import { DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { createBlankCourseProject, type CreateProjectOptions } from './createCourseProject'

export function courseProjectStartsAsSpatial(
  project: CourseProjectDocument,
): boolean {
  const start = project.locations.find((location) => location.id === project.startLocationId)
  return start?.kind === 'spatial-camera'
}

/**
 * Blank infinite Spatial Course Project V9. Default `createBlankCourseProject`
 * remains Slide; callers must opt into this factory.
 */
export function createBlankSpatialCourseProject(
  options: CreateProjectOptions = {},
): CourseProjectDocument {
  const slide = createBlankCourseProject(options)
  const idFactory = options.idFactory ?? nanoid
  const surfaceId = `surface-spatial-${idFactory()}`
  const frameId = `camera-home-${idFactory()}`
  const pose = { x: 0, y: 0, zoom: 1 }
  return courseProjectDocumentSchema.parse({
    ...slide,
    locations: [{
      id: frameId,
      label: `${slide.title} · 全景`,
      kind: 'spatial-camera',
      surfaceId,
      cameraFrameId: frameId,
    }],
    startLocationId: frameId,
    surfaces: [{
      id: surfaceId,
      title: '无限画布',
      type: 'spatial-2d',
      backgroundColor: DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR,
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [],
        paths: [],
        relations: [],
      },
      camera: {
        home: pose,
        frames: [{ id: frameId, name: '全景', ...pose }],
      },
      semanticZoom: [],
    }],
  })
}
