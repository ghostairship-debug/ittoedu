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
  collectCourseProjectRuntimeHealth,
} from './courseProjectHealth/runtime'
import {
  collectCourseProjectInteractionHealth,
} from './courseProjectHealth/interaction'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFinding,
} from './courseProjectHealth/types'
import type { CourseProjectDocument } from './courseProjectTypes'

export * from './courseProjectHealth/types'
export { collectCourseProjectComponentHealth } from './courseProjectHealth/component'
export { collectCourseProjectControllerMediaHealth } from './courseProjectHealth/controllerMedia'
export { collectCourseProjectInteractionHealth } from './courseProjectHealth/interaction'
export { collectCourseProjectRuntimeHealth } from './courseProjectHealth/runtime'

/**
 * V9-native, read-only semantic health collection for a schema-valid project
 * and the files returned by openCourseProjectArchive.
 */
export function collectCourseProjectHealth(
  project: CourseProjectDocument,
  archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFinding[] {
  return finalizeCourseProjectHealthFindings(project, [
    ...collectCourseProjectRuntimeHealth(project, archiveFiles),
    ...collectCourseProjectInteractionHealth(project, archiveFiles),
    ...collectCourseProjectComponentHealth(project, archiveFiles),
    ...collectCourseProjectControllerMediaHealth(project, archiveFiles),
  ])
}
