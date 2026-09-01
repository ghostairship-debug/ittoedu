import * as componentPackageStore from '@/renderer/components/componentPackageStore'
import * as componentPackages from '@/renderer/components/importComponentPackage'
import * as courseLocationCommands from '@/renderer/course/courseLocationCommands'
import * as courseLogicAuthoringCommands from '@/renderer/course/courseLogicAuthoringCommands'
import * as flowEditorCommands from '@/renderer/course/flowEditorCommands'
import * as flowSharedAuthoringAdapters from '@/renderer/course/flowSharedAuthoringAdapters'
import * as slideAuthoringBackend from '@/renderer/course/slideAuthoringBackend'
import * as slideEditorCommands from '@/renderer/course/slideEditorCommands'
import * as spatialEditorCommands from '@/renderer/course/spatialEditorCommands'
import * as v9SlideContentCommands from '@/renderer/course/v9SlideContentCommands'
import * as flowProjectFactory from '@/renderer/project/createFlowCourseProject'
import * as slideProjectFactory from '@/renderer/project/createCourseProject'
import * as spatialProjectFactory from '@/renderer/project/createSpatialCourseProject'
import * as courseProjectArchive from '@/renderer/project/courseProjectArchive'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'

export const COURSEWARE_CASE_BUILDER_API_VERSION = 1 as const

export interface CoursewareCaseBuildOutput {
  project: CourseProjectDocument
  assetFiles?: Record<string, Uint8Array>
  componentFiles?: Record<string, Record<string, Uint8Array>>
}

/**
 * Stable entrypoint for trusted case-local builders. It exposes the product's
 * existing factories and authoring commands without making an external case
 * import renderer-internal paths or invent a second project language.
 */
export function createCoursewareCaseBuilderApi() {
  return Object.freeze({
    project: Object.freeze({
      ...slideProjectFactory,
      ...flowProjectFactory,
      ...spatialProjectFactory,
    }),
    courseLocations: courseLocationCommands,
    courseLogic: courseLogicAuthoringCommands,
    slideAuthoring: slideAuthoringBackend,
    slideEditor: slideEditorCommands,
    slideContent: v9SlideContentCommands,
    flowEditor: flowEditorCommands,
    flowShared: flowSharedAuthoringAdapters,
    spatialEditor: spatialEditorCommands,
    components: Object.freeze({
      ...componentPackages,
      ...componentPackageStore,
    }),
    archive: courseProjectArchive,
    schema: Object.freeze({ courseProjectDocumentSchema }),
  })
}

export type CoursewareCaseBuilderApi = ReturnType<typeof createCoursewareCaseBuilderApi>

export interface CoursewareCaseBuilderContext {
  apiVersion: typeof COURSEWARE_CASE_BUILDER_API_VERSION
  caseDir: string
  documents: {
    teachingPlan: { path: string, content: string }
    presentationScript: { path: string, content: string }
  }
  capabilityIndex: unknown
  api: CoursewareCaseBuilderApi
}

export type CoursewareCaseBuilder = (
  context: CoursewareCaseBuilderContext,
) => CoursewareCaseBuildOutput | Promise<CoursewareCaseBuildOutput>
