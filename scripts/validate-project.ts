import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { CourseV10Driver } from '../src/core/drivers/CourseV10Driver'
import { courseProjectV10Schema } from '../src/shared/contracts/component-platform/schema'

export const COURSE_PROJECT_VALIDATION_REPORT_VERSION = 2 as const
export type CourseProjectValidationStatus = 'valid' | 'invalid' | 'unreadable'
export interface CourseProjectValidationReport {
  reportVersion: 2
  status: CourseProjectValidationStatus
  input: { filename: string }
  schema: { valid: boolean; schemaVersion: number | null; issues: Array<{ path: Array<string | number>; code: string; message: string }> }
  project: null | { id: string; title: string; revision: number; surfaceCount: number; instanceCount: number; assetCount: number; componentPackageCount: number }
  protocols: { project: 10; publishedCourse: 3; component: 5 }
  summary: { error: number; warning: number; info: number; total: number; canOpen: boolean }
  fatal: null | { code: string; title: string; message: string }
}
interface ValidationCliIo {
  stdout(value: string): void
  stderr(value: string): void
  read(filename: string): Promise<Uint8Array>
}
const defaultIo: ValidationCliIo = {
  stdout: value => process.stdout.write(value), stderr: value => process.stderr.write(value), read: readFile,
}
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Read-only validation shares the archive and professional parsers used by production save. */
export function validateCourseProjectArchiveBytes(bytes: Uint8Array, filename: string): CourseProjectValidationReport {
  const report: CourseProjectValidationReport = {
    reportVersion: 2, status: 'unreadable', input: { filename },
    schema: { valid: false, schemaVersion: null, issues: [] }, project: null,
    protocols: { project: 10, publishedCourse: 3, component: 5 },
    summary: { error: 1, warning: 0, info: 0, total: 1, canOpen: false }, fatal: null,
  }
  let raw: unknown
  try {
    const files = unzipSync(bytes)
    if (!files['project.json']) throw new Error('工程包缺少 project.json')
    raw = JSON.parse(strFromU8(files['project.json']))
  } catch (error) {
    report.fatal = { code: 'unreadable-project', title: '无法读取工程', message: messageOf(error) }
    return report
  }
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw && typeof raw.schemaVersion === 'number') report.schema.schemaVersion = raw.schemaVersion
  if (report.schema.schemaVersion !== 10) {
    report.status = 'invalid'
    report.fatal = { code: 'unsupported-project-version', title: '工程版本不受支持', message: '此入口仅支持独立 Project V10；旧工程原件未改变。' }
    return report
  }
  const parsed = courseProjectV10Schema.safeParse(raw)
  if (!parsed.success) {
    report.status = 'invalid'
    report.schema.issues = parsed.error.issues.map(issue => ({
      path: issue.path.map(segment => typeof segment === 'number' ? segment : String(segment)), code: issue.code, message: issue.message,
    }))
    report.summary.error = report.summary.total = report.schema.issues.length
    return report
  }
  report.schema.valid = true
  try {
    const driver = new CourseV10Driver()
    const model = driver.load(bytes)
    driver.validate(model)
    if (model.kind !== 'course-v10') throw new Error('工程类型不正确')
    report.project = { id: model.project.id, title: model.project.title, revision: model.project.revision,
      surfaceCount: model.project.surfaces.length, instanceCount: Object.keys(model.project.instances).length,
      assetCount: Object.keys(model.project.assets).length, componentPackageCount: Object.keys(model.resources.components).length }
    report.status = 'valid'
    report.summary = { error: 0, warning: 0, info: 0, total: 0, canOpen: true }
  } catch (error) {
    report.status = 'invalid'
    report.fatal = { code: 'invalid-project-content', title: '工程内容无效', message: messageOf(error) }
  }
  return report
}
export function courseProjectValidationExitCode(report: CourseProjectValidationReport): number {
  return report.status === 'valid' ? 0 : report.status === 'invalid' ? 1 : 2
}
export function serializeCourseProjectValidationReport(report: CourseProjectValidationReport): string { return `${JSON.stringify(report, null, 2)}\n` }
export async function runValidateProjectCli(argv: readonly string[], io: ValidationCliIo = defaultIo): Promise<number> {
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    io.stderr('用法：npm run --silent validate:project -- <project.h5lesson>\n')
    return 2
  }
  const filename = path.resolve(argv[0])
  let bytes: Uint8Array
  try { bytes = await io.read(filename) } catch (error) {
    io.stderr(`无法读取工程：${messageOf(error)}\n`)
    return 2
  }
  const report = validateCourseProjectArchiveBytes(bytes, filename)
  io.stdout(serializeCourseProjectValidationReport(report))
  return courseProjectValidationExitCode(report)
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void runValidateProjectCli(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    process.stderr.write(`${messageOf(error)}\n`); process.exitCode = 2
  })
}
