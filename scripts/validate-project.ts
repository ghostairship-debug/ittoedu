import { unzipSync } from 'fflate'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { componentPackagesFromArchive } from '../src/renderer/components/componentPackageStore'
// Teaches the export builders where this host's font bytes are. Without it the
// headless validator would report export sizes a real export never produces.
import '../src/renderer/export/bundledFontEmbedSourceNode'
import {
  collectCoursePackageExportPreflight,
  type CoursePackagePreflightItem,
} from '../src/renderer/export/course/coursePackagePreflight'
import {
  adaptCoursePdfProducerFindings,
  adaptCoursePptxProducerFindings,
  coursePptxTargetApplicable,
  type CourseExportFormatFinding,
} from '../src/renderer/export/exportPreflight'
import {
  detectCourseProjectArchiveFormat,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '../src/renderer/project/courseProjectArchive'
import {
  COMPONENT_RUNTIME_API_VERSION,
  COMPONENT_SCHEMA_VERSION,
  RUNTIME_API_VERSION,
} from '../src/shared/constants'
import { courseProjectDocumentSchema } from '../src/shared/courseProjectSchema'
import { collectCourseProjectHealth } from '../src/shared/courseProjectHealth'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type LayerItem,
} from '../src/shared/courseProjectTypes'
import {
  resolveSchemaValidCourseProjectDiagnosticTarget,
  type CourseProjectValidationFatalCode,
  type CourseProjectValidationFindingCode,
  type DiagnosticTargetV1,
} from '../src/shared/courseProjectValidationDiagnostics'
import { UserFacingError } from '../src/shared/errors'
import { detectLayoutMeasurementMode } from '../src/shared/layoutMeasure'
import { PUBLISHED_COURSE_VERSION } from '../src/shared/publishedCourseTypes'
import { compareStableStrings } from '../src/shared/stableOrder'
import { SURFACE_RUNTIME_API_VERSION } from '../src/shared/surfaceRuntimeTypes'

export const COURSE_PROJECT_VALIDATION_REPORT_VERSION = 1 as const
export const INTERACTION_PROTOCOL_VERSION = 1 as const

const CURRENT_PROTOCOLS = {
  project: COURSE_PROJECT_SCHEMA_VERSION,
  publishedCourse: PUBLISHED_COURSE_VERSION,
  runtime: [RUNTIME_API_VERSION, SURFACE_RUNTIME_API_VERSION],
  component: COMPONENT_SCHEMA_VERSION,
  interaction: INTERACTION_PROTOCOL_VERSION,
} as const

const V8_ROOT_FIELDS = ['scenes', 'globalRuntime', 'globalNodes'] as const
const VALIDATION_PLAYER_BUNDLE = '/* validate:course-project */\n'
const USAGE =
  '用法：npm run --silent validate:course-project -- <project.h5lesson>'

export type CourseProjectValidationStatus = 'valid' | 'invalid' | 'unreadable'
export type CourseProjectExportTarget =
  | 'single-html'
  | 'web-package'
  | 'pdf'
  | 'pptx'

export interface CourseProjectValidationFatalError {
  code: CourseProjectValidationFatalCode
  title: string
  message: string
  suggestion?: string
}

export interface CourseProjectValidationSchemaIssue {
  path: Array<string | number>
  code: string
  message: string
}

export interface CourseProjectValidationFinding {
  severity: 'error' | 'warning' | 'info'
  code: CourseProjectValidationFindingCode
  message: string
  path?: Array<string | number>
  surfaceId?: string
  layerItemId?: string
  target?: DiagnosticTargetV1
}

export interface CourseProjectExportPreflightReport {
  reportVersion: 1
  projectId: string
  schemaVersion: typeof COURSE_PROJECT_SCHEMA_VERSION
  target: CourseProjectExportTarget
  items: CourseProjectValidationFinding[]
  summary: {
    error: number
    warning: number
    info: number
    total: number
    canExport: boolean
  }
}

export interface CourseProjectValidationReport {
  reportVersion: typeof COURSE_PROJECT_VALIDATION_REPORT_VERSION
  status: CourseProjectValidationStatus
  input: { filename: string }
  measurement: {
    mode: ReturnType<typeof detectLayoutMeasurementMode>
    note: string
  }
  schema: {
    valid: boolean
    schemaVersion: number | null
    issues: CourseProjectValidationSchemaIssue[]
  }
  project: null | {
    id: string
    title: string
    locationCount: number
    surfaceCount: number
    assetCount: number
    componentPackageCount: number
  }
  projectHealth: null | {
    items: CourseProjectValidationFinding[]
    summary: {
      error: number
      warning: number
      info: number
      total: number
      canExport: boolean
    }
  }
  exportPreflight: null | Record<
    CourseProjectExportTarget,
    CourseProjectExportPreflightReport
  >
  protocols: typeof CURRENT_PROTOCOLS | null
  stableIds: null | { valid: boolean; issues: CourseProjectValidationFinding[] }
  migrationMarkers: null | {
    present: boolean
    items: CourseProjectValidationFinding[]
  }
  summary: {
    error: number
    warning: number
    info: number
    total: number
    canExport: boolean
  }
  fatal: CourseProjectValidationFatalError | null
}

interface ValidationCliIo {
  stdout(value: string): void
  stderr(value: string): void
  read(path: string): Promise<Uint8Array>
}

const defaultIo: ValidationCliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  read: async (filename) => readFile(filename),
}

const EMPTY_SUMMARY = {
  error: 0,
  warning: 0,
  info: 0,
  total: 0,
  canExport: false,
} as const

function measurement(): CourseProjectValidationReport['measurement'] {
  const mode = detectLayoutMeasurementMode()
  return {
    mode,
    note: mode === 'browser-canvas'
      ? '文本与公式布局使用浏览器 Canvas 字形测量。'
      : 'Node 环境使用确定性字宽后备；布局诊断适合自动筛查，最终像素结果仍需真实导出或人工验收。',
  }
}

export function unreadableCourseProjectValidationReport(
  filename: string,
  fatal: CourseProjectValidationFatalError,
  schema: CourseProjectValidationReport['schema'] = {
    valid: false,
    schemaVersion: null,
    issues: [],
  },
): CourseProjectValidationReport {
  return {
    reportVersion: COURSE_PROJECT_VALIDATION_REPORT_VERSION,
    status: 'unreadable',
    input: { filename },
    measurement: measurement(),
    schema,
    project: null,
    projectHealth: null,
    exportPreflight: null,
    protocols: null,
    stableIds: null,
    migrationMarkers: null,
    summary: { ...EMPTY_SUMMARY },
    fatal,
  }
}

function summarizeFindings(
  items: readonly CourseProjectValidationFinding[],
): {
  error: number
  warning: number
  info: number
  total: number
  canExport: boolean
} {
  const summary = {
    error: 0,
    warning: 0,
    info: 0,
    total: items.length,
    canExport: true,
  }
  for (const item of items) summary[item.severity] += 1
  summary.canExport = summary.error === 0
  return summary
}

function withDiagnosticTargets(
  project: CourseProjectDocument,
  items: readonly CourseProjectValidationFinding[],
): CourseProjectValidationFinding[] {
  return items.map((item) => ({
    ...item,
    target: item.target ?? resolveSchemaValidCourseProjectDiagnosticTarget(project, item),
  }))
}

function declaredSchemaVersion(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const version = Reflect.get(value, 'schemaVersion')
  return typeof version === 'number' && Number.isInteger(version) ? version : null
}

function peekProjectJson(bytes: Uint8Array): unknown | undefined {
  try {
    const files = unzipSync(bytes)
    const projectBytes = files['project.json']
    if (!projectBytes) return undefined
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(projectBytes)) as unknown
  } catch {
    return undefined
  }
}

function schemaIssuesFromValue(value: unknown): CourseProjectValidationSchemaIssue[] {
  const parsed = courseProjectDocumentSchema.safeParse(value)
  if (parsed.success) return []
  return parsed.error.issues.map((issue) => ({
    path: issue.path.map((segment) => (
      typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment)
    )),
    code: issue.code,
    message: issue.message,
  }))
}

function visitLayerItems(
  project: CourseProjectDocument,
  visit: (item: LayerItem, path: Array<string | number>) => void,
): void {
  project.globalLayerItems.forEach((entry, index) => {
    visit(entry.item, ['globalLayerItems', index, 'item'])
  })
  project.surfaces.forEach((surface, surfaceIndex) => {
    surface.surfaceLayerItems.forEach((entry, index) => {
      visit(entry.item, ['surfaces', surfaceIndex, 'surfaceLayerItems', index, 'item'])
    })
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        scene.layerItems.forEach((item, index) => {
          visit(item, ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'layerItems', index])
        })
      })
    }
    if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item, index) => {
        visit(item, ['surfaces', surfaceIndex, 'world', 'layerItems', index])
      })
    }
  })
}

function collectMigrationMarkerIssues(
  project: CourseProjectDocument,
): CourseProjectValidationFinding[] {
  const retiredFrameMode = ['legacy', 'whole', 'canvas'].join('-')
  const retiredRuntimeProtocol = ['legacy', 'runtime', 'v2'].join('-')
  const issues: CourseProjectValidationFinding[] = []
  visitLayerItems(project, (item, path) => {
    const frameMode = item.frame.mode as string
    if (frameMode === retiredFrameMode) {
      issues.push({
        severity: 'error',
        code: 'migration-marker',
        message: `当前 Course Project V9 不得保留 ${retiredFrameMode} 迁移标记。`,
        path: [...path, 'frame', 'mode'],
        layerItemId: item.layerItemId,
      })
    }
    if (item.kind === 'runtime' && (item.runtime.protocol as string) === retiredRuntimeProtocol) {
      issues.push({
        severity: 'error',
        code: 'migration-marker',
        message: `当前 Course Project V9 不得保留 ${retiredRuntimeProtocol} 迁移标记。`,
        path: [...path, 'runtime', 'protocol'],
        layerItemId: item.layerItemId,
      })
    }
  })
  return issues
}

function collectV8FieldIssues(value: unknown): CourseProjectValidationFinding[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  return V8_ROOT_FIELDS.flatMap((field) => (
    Object.prototype.hasOwnProperty.call(record, field)
      ? [{
          severity: 'error' as const,
          code: 'v8-field',
          message: `当前 Course Project V9 不得包含 Project V8 字段 ${field}。`,
          path: [field],
        }]
      : []
  ))
}

function collectProtocolIssues(
  project: CourseProjectDocument,
  archive: CourseProjectArchiveData,
): CourseProjectValidationFinding[] {
  const issues: CourseProjectValidationFinding[] = []
  visitLayerItems(project, (item, path) => {
    if (item.kind !== 'runtime') return
    const currentSurface =
      item.runtime.protocol === 'surface-runtime' &&
      item.runtime.runtimeApiVersion === SURFACE_RUNTIME_API_VERSION
    const currentCanvas =
      item.runtime.protocol === 'canvas-runtime' &&
      item.runtime.runtimeApiVersion === RUNTIME_API_VERSION
    if (!currentSurface && !currentCanvas) {
      issues.push({
        severity: 'error',
        code: 'runtime-protocol',
        message: `Runtime 协议不受支持：${item.runtime.protocol} / API ${item.runtime.runtimeApiVersion}。`,
        path: [...path, 'runtime'],
        layerItemId: item.layerItemId,
      })
    }
  })
  for (const [recordKey, files] of Object.entries(archive.componentFiles)) {
    const manifestBytes = files['manifest.json']
    if (!manifestBytes) {
      issues.push({
        severity: 'error',
        code: 'component-protocol',
        message: `组件 ${recordKey} 缺少 manifest.json。`,
        path: ['componentPackages', recordKey],
      })
      continue
    }
    try {
      const manifest = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
      ) as { schemaVersion?: unknown; runtimeApiVersion?: unknown }
      if (manifest.schemaVersion !== COMPONENT_SCHEMA_VERSION) {
        issues.push({
          severity: 'error',
          code: 'component-protocol',
          message: `组件 ${recordKey} 的 Schema 不是 Component API ${COMPONENT_SCHEMA_VERSION}。`,
          path: ['componentPackages', recordKey, 'schemaVersion'],
        })
      }
      if (manifest.runtimeApiVersion !== COMPONENT_RUNTIME_API_VERSION) {
        issues.push({
          severity: 'error',
          code: 'component-protocol',
          message: `组件 ${recordKey} 的 Runtime 不是 Component Runtime API ${COMPONENT_RUNTIME_API_VERSION}。`,
          path: ['componentPackages', recordKey, 'runtimeApiVersion'],
        })
      }
    } catch {
      issues.push({
        severity: 'error',
        code: 'component-protocol',
        message: `组件 ${recordKey} 的 manifest.json 不可读。`,
        path: ['componentPackages', recordKey],
      })
    }
  }
  return issues
}

function mapPackagePreflightItems(
  items: readonly CoursePackagePreflightItem[],
): CourseProjectValidationFinding[] {
  return items
    .filter((item) => item.code !== 'player-bundle-empty')
    .map((item) => ({
      severity: item.severity,
      code: item.code,
      message: item.message,
      ...(item.path ? { path: [...item.path] } : {}),
    }))
}

function mapStaticFormatItems(
  items: readonly CourseExportFormatFinding[],
): CourseProjectValidationFinding[] {
  return items.map((item) => ({
    severity: item.severity,
    code: item.code as CourseProjectValidationFinding['code'],
    message: item.message,
    ...(item.path ? { path: [...item.path] } : {}),
    ...(item.diagnosticTarget ? { target: item.diagnosticTarget } : {}),
  }))
}

function collectExportReports(
  archive: CourseProjectArchiveData,
): Record<CourseProjectExportTarget, CourseProjectExportPreflightReport> {
  let components: ReturnType<typeof componentPackagesFromArchive> = {}
  try {
    components = componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '组件包无法用于导出预检。'
    const items = withDiagnosticTargets(archive.project, [{
      severity: 'error',
      code: 'component-bytes-missing',
      message,
    }])
    const toReport = (
      target: CourseProjectExportTarget,
    ): CourseProjectExportPreflightReport => ({
      reportVersion: 1,
      projectId: archive.project.id,
      schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
      target,
      items,
      summary: summarizeFindings(items),
    })
    return {
      'single-html': toReport('single-html'),
      'web-package': toReport('web-package'),
      pdf: toReport('pdf'),
      pptx: toReport('pptx'),
    }
  }
  const resources = {
    assetFiles: archive.assetFiles,
    components,
  }
  const now = new Date(archive.project.updatedAt)
  const generatedAt = Number.isNaN(now.valueOf()) ? new Date(0) : now
  const htmlItems = mapPackagePreflightItems(
    collectCoursePackageExportPreflight(
      archive.project,
      'standalone-html',
      resources,
      VALIDATION_PLAYER_BUNDLE,
      generatedAt,
    ).items,
  )
  const webItems = mapPackagePreflightItems(
    collectCoursePackageExportPreflight(
      archive.project,
      'web-package',
      resources,
      VALIDATION_PLAYER_BUNDLE,
      generatedAt,
    ).items,
  )
  const htmlProducerItems = htmlItems.map((item): CourseExportFormatFinding => ({
    severity: item.severity,
    code: item.code as CourseExportFormatFinding['code'],
    message: item.message,
    ...(item.path ? { path: item.path } : {}),
  }))
  const pdfItems = mapStaticFormatItems(adaptCoursePdfProducerFindings(
    archive.project,
    resources,
    htmlProducerItems,
  ))
  const pptxItems = mapStaticFormatItems(adaptCoursePptxProducerFindings(
    archive.project,
    resources,
    htmlProducerItems,
  ))

  const toReport = (
    target: CourseProjectExportTarget,
    items: CourseProjectValidationFinding[],
  ): CourseProjectExportPreflightReport => {
    const targetedItems = withDiagnosticTargets(archive.project, items)
    return {
      reportVersion: 1,
      projectId: archive.project.id,
      schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
      target,
      items: targetedItems,
      summary: summarizeFindings(targetedItems),
    }
  }

  return {
    'single-html': toReport('single-html', htmlItems),
    'web-package': toReport('web-package', webItems),
    pdf: toReport('pdf', pdfItems),
    pptx: toReport('pptx', pptxItems),
  }
}

function combinedSummary(
  health: ReturnType<typeof summarizeFindings>,
  reports: Record<CourseProjectExportTarget, CourseProjectExportPreflightReport>,
  applicableTargets: readonly CourseProjectExportTarget[],
): CourseProjectValidationReport['summary'] {
  const summary = {
    error: health.error,
    warning: health.warning,
    info: health.info,
    total: health.total,
    canExport: true,
  }
  // A format that does not apply to this course (PPTX for a Flow-only course,
  // which exports as DOCX) keeps its own blocking report but must not make
  // the course itself invalid.
  for (const target of applicableTargets) {
    for (const item of reports[target].items) {
      summary[item.severity] += 1
      summary.total += 1
    }
  }
  summary.canExport = summary.error === 0
  return summary
}

function unsupportedVersionFatal(
  schemaVersion: number | null,
): CourseProjectValidationFatalError {
  if (schemaVersion === 8) {
    return {
      code: 'unsupported-project-version',
      title: '工程版本不受支持',
      message: '该文件是 Project V8，不是当前 Course Project V9 工程格式。',
      suggestion: '请使用 Course Project V9 .h5lesson。无界面校验不再把 Project V8 当作当前格式。',
    }
  }
  return {
    code: 'unsupported-project-version',
    title: '工程版本不受支持',
    message: `该文件的格式版本为 ${schemaVersion ?? '未声明'}，当前无界面校验只接受 Course Project V9。`,
  }
}

export function validateCourseProjectArchiveBytes(
  bytes: Uint8Array,
  filename: string,
): CourseProjectValidationReport {
  const rawProject = peekProjectJson(bytes)
  const declaredVersion = declaredSchemaVersion(rawProject)
  const probe = detectCourseProjectArchiveFormat(bytes)

  if (probe.kind === 'unsupported') {
    return unreadableCourseProjectValidationReport(filename, unsupportedVersionFatal(
      probe.identity.schemaVersion ?? declaredVersion,
    ), {
      valid: false,
      schemaVersion: probe.identity.schemaVersion ?? declaredVersion,
      issues: [],
    })
  }
  if (probe.kind === 'corrupted') {
    return unreadableCourseProjectValidationReport(filename, {
      code: 'archive-invalid',
      title: '课程工程文件损坏',
      message: probe.reason,
    }, {
      valid: false,
      schemaVersion: declaredVersion,
      issues: [],
    })
  }

  let archive: CourseProjectArchiveData
  try {
    archive = openCourseProjectArchive(bytes)
  } catch (error) {
    const issues = rawProject === undefined ? [] : schemaIssuesFromValue(rawProject)
    const schemaInvalid = issues.length > 0
    const fatal: CourseProjectValidationFatalError = error instanceof UserFacingError
      ? {
          code: schemaInvalid ? 'schema-invalid' : 'archive-invalid',
          title: error.title,
          message: error.message,
          suggestion: error.suggestion,
        }
      : {
          code: 'validation-failed',
          title: '工程校验失败',
          message: error instanceof Error ? error.message : '发生未知错误。',
        }
    return unreadableCourseProjectValidationReport(filename, fatal, {
      valid: false,
      schemaVersion: declaredVersion,
      issues,
    })
  }

  const v8Fields = withDiagnosticTargets(
    archive.project,
    collectV8FieldIssues(rawProject),
  )
  const migrationMarkers = withDiagnosticTargets(
    archive.project,
    collectMigrationMarkerIssues(archive.project),
  )
  const protocolIssues = withDiagnosticTargets(
    archive.project,
    collectProtocolIssues(archive.project, archive),
  )
  const v9ProjectHealth = collectCourseProjectHealth(archive.project, archive)
  const stableIdIssues = v9ProjectHealth.filter((item) => item.code === 'duplicate-stable-id')
  const healthItems = [
    ...v8Fields,
    ...migrationMarkers,
    ...protocolIssues,
    ...v9ProjectHealth,
  ]
  const healthSummary = summarizeFindings(healthItems)
  const exportPreflight = collectExportReports(archive)
  const applicableTargets: CourseProjectExportTarget[] = [
    'single-html',
    'web-package',
    'pdf',
    ...(coursePptxTargetApplicable(archive.project) ? ['pptx' as const] : []),
  ]
  const summary = combinedSummary(healthSummary, exportPreflight, applicableTargets)

  return {
    reportVersion: COURSE_PROJECT_VALIDATION_REPORT_VERSION,
    status: summary.canExport ? 'valid' : 'invalid',
    input: { filename },
    measurement: measurement(),
    schema: {
      valid: true,
      schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
      issues: [],
    },
    project: {
      id: archive.project.id,
      title: archive.project.title,
      locationCount: archive.project.locations.length,
      surfaceCount: archive.project.surfaces.length,
      assetCount: Object.keys(archive.project.assets).length,
      componentPackageCount: Object.keys(archive.project.componentPackages).length,
    },
    projectHealth: { items: healthItems, summary: healthSummary },
    exportPreflight,
    protocols: CURRENT_PROTOCOLS,
    stableIds: {
      valid: stableIdIssues.length === 0,
      issues: stableIdIssues,
    },
    migrationMarkers: {
      present: migrationMarkers.length > 0,
      items: migrationMarkers,
    },
    summary,
    fatal: null,
  }
}

export function courseProjectValidationExitCode(
  report: CourseProjectValidationReport,
): 0 | 1 | 2 {
  if (report.status === 'unreadable') return 2
  return report.summary.canExport ? 0 : 1
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => compareStableStrings(left, right))
      .map(([key, nested]) => [key, normalizeJson(nested)]),
  )
}

export function serializeCourseProjectValidationReport(
  report: CourseProjectValidationReport,
): string {
  return `${JSON.stringify(normalizeJson(report))}\n`
}

function fatal(
  filename: string,
  error: CourseProjectValidationFatalError,
  io: ValidationCliIo,
): 2 {
  const report = unreadableCourseProjectValidationReport(filename, error)
  io.stdout(serializeCourseProjectValidationReport(report))
  io.stderr(`${error.title}：${error.message}\n`)
  return 2
}

export async function runValidateProjectCli(
  argv: readonly string[],
  io: ValidationCliIo = defaultIo,
): Promise<0 | 1 | 2> {
  if (argv.length !== 1 || argv[0]?.startsWith('-')) {
    return fatal('', {
      code: 'usage-error',
      title: '参数错误',
      message: USAGE,
    }, io)
  }

  const inputPath = path.resolve(argv[0])
  const filename = path.basename(inputPath)
  if (path.extname(inputPath).toLowerCase() !== '.h5lesson') {
    return fatal(filename, {
      code: 'usage-error',
      title: '文件类型不支持',
      message: '无界面工程校验只接受当前 Course Project V9 .h5lesson 文件。',
    }, io)
  }

  let bytes: Uint8Array
  try {
    bytes = await io.read(inputPath)
  } catch (error) {
    return fatal(filename, {
      code: 'input-unreadable',
      title: '工程文件不可读',
      message: error instanceof Error ? error.message : '无法读取指定文件。',
    }, io)
  }

  const report = validateCourseProjectArchiveBytes(bytes, filename)
  io.stdout(serializeCourseProjectValidationReport(report))
  if (report.fatal) {
    io.stderr(`${report.fatal.title}：${report.fatal.message}\n`)
  }
  return courseProjectValidationExitCode(report)
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  void runValidateProjectCli(process.argv.slice(2))
    .then((exitCode) => { process.exitCode = exitCode })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '发生未知错误。'
      const report = unreadableCourseProjectValidationReport('', {
        code: 'validation-failed',
        title: '工程校验失败',
        message,
      })
      process.stdout.write(serializeCourseProjectValidationReport(report))
      process.stderr.write(`工程校验失败：${message}\n`)
      process.exitCode = 2
    })
}
