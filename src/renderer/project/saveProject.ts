import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import {
  createCourseProjectArchive,
  createCourseProjectArchiveAsync,
  type CourseProjectArchiveData,
} from './courseProjectArchive'

export interface SavedProjectArchive {
  project: CourseProjectDocument
  bytes: Uint8Array
}

export function saveProject(
  data: CourseProjectArchiveData,
  now: string | Date = new Date(),
): SavedProjectArchive {
  const updatedAt = typeof now === 'string' ? now : now.toISOString()
  const project: CourseProjectDocument = {
    ...structuredClone(data.project),
    updatedAt,
  }
  return {
    project,
    bytes: createCourseProjectArchive({
      project,
      assetFiles: data.assetFiles,
      componentFiles: data.componentFiles,
    }),
  }
}

export async function saveProjectAsync(
  data: CourseProjectArchiveData,
  now: string | Date = new Date(),
  options: { signal?: AbortSignal } = {},
): Promise<SavedProjectArchive> {
  const updatedAt = typeof now === 'string' ? now : now.toISOString()
  const project: CourseProjectDocument = {
    ...structuredClone(data.project),
    updatedAt,
  }
  return {
    project,
    bytes: await createCourseProjectArchiveAsync({
      project,
      assetFiles: data.assetFiles,
      componentFiles: data.componentFiles,
    }, options),
  }
}

export { createCourseProjectArchive as serializeProjectArchive }
