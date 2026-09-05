import {
  collectCourseProjectComponentHealth,
} from './courseProjectHealth/component'
import {
  collectCourseProjectControllerMediaHealth,
} from './courseProjectHealth/controllerMedia'
import {
  finalizeCourseProjectHealthFindings,
} from './courseProjectHealth/internal'
import {
  collectCourseProjectNativeHealth,
} from './courseProjectHealth/native'
import {
  collectCourseProjectRuntimeHealth,
} from './courseProjectHealth/runtime'
import {
  collectCourseProjectInteractionHealth,
} from './courseProjectHealth/interaction'
import {
  collectCourseProjectStableIdHealth,
} from './courseProjectHealth/stableIds'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFinding,
  CourseProjectHealthSeverity,
} from './courseProjectHealth/types'
import type { CourseProjectDocument } from './courseProjectTypes'

export * from './courseProjectHealth/types'
export {
  COURSE_PROJECT_FORMAT_PREFLIGHT_ADAPTERS,
  COURSE_PROJECT_HEALTH_FINDING_CATALOG,
} from './courseProjectHealth/catalog'
export { collectCourseProjectComponentHealth } from './courseProjectHealth/component'
export { collectCourseProjectControllerMediaHealth } from './courseProjectHealth/controllerMedia'
export { collectCourseProjectInteractionHealth } from './courseProjectHealth/interaction'
export { collectCourseProjectNativeHealth } from './courseProjectHealth/native'
export { collectCourseProjectRuntimeHealth } from './courseProjectHealth/runtime'
export { collectCourseProjectStableIdHealth } from './courseProjectHealth/stableIds'

/**
 * V9-native, read-only semantic health collection for a schema-valid project
 * and the files returned by openCourseProjectArchive.
 */
export function collectCourseProjectHealth(
  project: CourseProjectDocument,
  archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFinding[] {
  return finalizeCourseProjectHealthFindings(project, [
    ...collectCourseProjectStableIdHealth(project, archiveFiles),
    ...collectCourseProjectRuntimeHealth(project, archiveFiles),
    ...collectCourseProjectInteractionHealth(project, archiveFiles),
    ...collectCourseProjectComponentHealth(project, archiveFiles),
    ...collectCourseProjectControllerMediaHealth(project, archiveFiles),
    ...collectCourseProjectNativeHealth(project, archiveFiles),
  ])
}

export interface CourseProjectHealthSummary {
  error: number
  warning: number
  info: number
  total: number
  canExport: boolean
}

export function summarizeCourseProjectHealth(
  findings: readonly Pick<CourseProjectHealthFinding, 'severity'>[],
): CourseProjectHealthSummary {
  const summary: Record<CourseProjectHealthSeverity, number> & {
    total: number
    canExport: boolean
  } = {
    error: 0,
    warning: 0,
    info: 0,
    total: findings.length,
    canExport: true,
  }
  findings.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return summary
}
