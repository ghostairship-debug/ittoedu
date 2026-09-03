import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COURSE_PROJECT_V9_FIXTURE_IDS,
  type CourseProjectV9FixtureId,
} from './sources'

const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url))

export {
  COURSE_PROJECT_V9_FIXTURE_IDS,
  COURSE_PROJECT_V9_FIXTURE_MTIME,
  listCourseProjectV9Fixtures,
  type CourseProjectV9FixtureId,
  type CourseProjectV9FixtureSpec,
} from './sources'
export {
  COURSE_PROJECT_REJECTION_INPUTS,
  COURSE_PROJECT_REJECTION_KIND,
  type CourseProjectRejectionKind,
} from './rejection'

export function courseProjectV9FixtureRoot(): string {
  return FIXTURE_ROOT
}

export function courseProjectV9FixturePath(id: CourseProjectV9FixtureId): string {
  return join(FIXTURE_ROOT, `${id}.h5lesson`)
}

export function readCourseProjectV9FixtureArchive(id: CourseProjectV9FixtureId): Uint8Array {
  const bytes = readFileSync(courseProjectV9FixturePath(id))
  if (bytes.byteLength === 0) {
    throw new Error(`Course Project V9 fixture is empty: ${id}`)
  }
  return new Uint8Array(bytes)
}

export function listCourseProjectV9FixtureArchiveIds(): readonly CourseProjectV9FixtureId[] {
  return COURSE_PROJECT_V9_FIXTURE_IDS
}
