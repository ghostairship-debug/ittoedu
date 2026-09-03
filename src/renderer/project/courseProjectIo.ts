import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import {
  createCourseProjectArchive,
  createCourseProjectArchiveAsync,
  openCourseProjectArchive,
  openCourseProjectArchiveAsync,
  type CourseProjectArchiveData,
  type CreateCourseProjectArchiveOptions,
} from './courseProjectArchive'

/**
 * Default product open: only Course Project V9 loads. Other integer versions
 * are unsupported; missing or damaged archives are corrupted.
 */
export function openDefaultCourseProject(
  bytes: Uint8Array,
): CourseProjectArchiveData {
  return openCourseProjectArchive(bytes)
}

export async function openDefaultCourseProjectAsync(
  bytes: Uint8Array,
  options: { signal?: AbortSignal } = {},
): Promise<CourseProjectArchiveData> {
  return openCourseProjectArchiveAsync(bytes, options)
}

export function saveCourseProjectDocument(
  data: CourseProjectArchiveData,
  options: CreateCourseProjectArchiveOptions = {},
): Uint8Array {
  return createCourseProjectArchive(data, options)
}

export async function saveCourseProjectDocumentAsync(
  data: CourseProjectArchiveData,
  options: CreateCourseProjectArchiveOptions = {},
): Promise<Uint8Array> {
  return createCourseProjectArchiveAsync(data, options)
}

export function courseProjectTitle(project: CourseProjectDocument): string {
  return project.title
}
