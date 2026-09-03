import { zipSync } from 'fflate'
import { COURSE_PROJECT_V9_FIXTURE_MTIME } from './sources'

/**
 * Minimal raw bytes for r11-051/052 fail-loud paths. These are not authoring
 * fixtures: they only encode schemaVersion or a corruption class, and they must
 * never be parsed as a successful Course Project V9 / V8 document.
 */
export const COURSE_PROJECT_REJECTION_KIND = [
  'v8-unsupported',
  'future-unsupported',
  'corrupted-empty',
  'corrupted-not-zip',
  'corrupted-invalid-json',
  'corrupted-missing-json',
] as const

export type CourseProjectRejectionKind = typeof COURSE_PROJECT_REJECTION_KIND[number]

const ZIP_MTIME = new Date(COURSE_PROJECT_V9_FIXTURE_MTIME)

function zipProjectJson(value: string): Uint8Array {
  return zipSync(
    { 'project.json': new TextEncoder().encode(value) },
    { level: 6, mtime: ZIP_MTIME },
  )
}

export const COURSE_PROJECT_REJECTION_INPUTS: Record<CourseProjectRejectionKind, Uint8Array> = {
  'v8-unsupported': zipProjectJson(JSON.stringify({
    schemaVersion: 8,
    id: 'v8-rejection',
    title: 'V8 rejection input',
  })),
  'future-unsupported': zipProjectJson(JSON.stringify({
    schemaVersion: 10,
    id: 'v10-rejection',
    title: 'Future schema rejection',
  })),
  'corrupted-empty': new Uint8Array(),
  'corrupted-not-zip': Uint8Array.from([0x00, 0x01, 0x02, 0x03]),
  'corrupted-invalid-json': zipProjectJson('{not-json'),
  'corrupted-missing-json': zipSync(
    { 'readme.txt': new TextEncoder().encode('no project.json') },
    { level: 6, mtime: ZIP_MTIME },
  ),
}
