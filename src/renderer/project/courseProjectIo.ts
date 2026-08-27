import { UserFacingError } from '@/shared/errors'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import {
  createCourseProjectArchive,
  createCourseProjectArchiveAsync,
  detectCourseProjectArchiveFormat,
  openCourseProjectArchive,
  openCourseProjectArchiveAsync,
  type CourseProjectArchiveData,
  type CreateCourseProjectArchiveOptions,
} from './courseProjectArchive'

function refuseUnsupportedOrCorrupt(
  kind: 'corrupted' | 'unsupported',
  reason: string,
  schemaVersion: number | null,
): never {
  if (kind === 'corrupted') {
    throw new UserFacingError(
      '课程工程文件损坏',
      reason,
      '请重新选择有效的课程工程，或从备份恢复。不要把损坏文件另存覆盖原件。',
    )
  }
  throw new UserFacingError(
    '课程工程版本不支持',
    reason,
    schemaVersion === null
      ? '请使用能打开该文件的编辑器版本，或从备份恢复。当前不会尝试转换旧版工程。'
      : `请使用支持格式版本 ${schemaVersion} 的编辑器打开。当前不会转换不受支持的工程。`,
  )
}

/**
 * Default product open: only Course Project V9 loads. Other integer versions
 * are unsupported; missing or damaged archives are corrupted.
 */
export function openDefaultCourseProject(
  bytes: Uint8Array,
): CourseProjectArchiveData {
  const probe = detectCourseProjectArchiveFormat(bytes)
  if (probe.kind === 'v9') {
    return openCourseProjectArchive(bytes)
  }
  refuseUnsupportedOrCorrupt(probe.kind, probe.reason, probe.identity.schemaVersion)
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
