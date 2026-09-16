import * as componentPackageStore from '@/renderer/components/componentPackageStore'
import * as componentPackages from '@/renderer/components/importComponentPackage'
import * as courseLocationCommands from '@/renderer/course/courseLocationCommands'
import * as courseLogicAuthoringCommands from '@/renderer/course/courseLogicAuthoringCommands'
import * as flowEditorCommands from '@/renderer/course/flowEditorCommands'
import * as flowSharedAuthoringAdapters from '@/renderer/course/flowSharedAuthoringAdapters'
import * as slideAuthoringBackend from '@/renderer/course/slideAuthoringBackend'
import * as slideEditorCommands from '@/renderer/course/slideEditorCommands'
import * as spatialEditorCommands from '@/renderer/course/spatialEditorCommands'
import * as tableContentOperations from '@/renderer/course/tableContentOperations'
import * as flowTableContentOperations from '@/renderer/course/flowTableContentOperations'
import * as slideTableCommands from '@/renderer/course/v9TableCommands'
import * as v9SlideContentCommands from '@/renderer/course/v9SlideContentCommands'
import * as flowProjectFactory from '@/renderer/project/createFlowCourseProject'
import * as slideProjectFactory from '@/renderer/project/createCourseProject'
import * as spatialProjectFactory from '@/renderer/project/createSpatialCourseProject'
import * as courseProjectArchive from '@/renderer/project/courseProjectArchive'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { RECIPE_CATALOG } from '@/renderer/recipes/recipeCatalog'
import { planRecipe } from '@/renderer/recipes/applyRecipe'
import type { AuthoringToolReceiptV1 } from '@/shared/authoringToolContract'
import generatedCapabilities from '@/shared/generated/courseAgentCapabilities.json'
import { queryCourseAgentCapabilities, readCourseAgentCapability, type CourseAgentCapabilityData,
  type CourseAgentCapabilityQuery, type CourseAgentCapabilityCardOptions } from '@/shared/courseAgentCapabilities'

export const COURSEWARE_CASE_BUILDER_API_VERSION = 1 as const

export interface CoursewareCaseBuildOutput {
  receipts?: AuthoringToolReceiptV1[]
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
    discover: (query: CourseAgentCapabilityQuery = {}) => queryCourseAgentCapabilities(generatedCapabilities as CourseAgentCapabilityData, query),
    readCapability: (id: string, options: CourseAgentCapabilityCardOptions = {}) => readCourseAgentCapability(generatedCapabilities as CourseAgentCapabilityData, id, options),
    project: Object.freeze({
      createBlankCourseProject: slideProjectFactory.createBlankCourseProject,
      createCourseProject: slideProjectFactory.createCourseProject,
      createBlankFlowCourseProject: flowProjectFactory.createBlankFlowCourseProject,
      courseProjectStartsAsFlow: flowProjectFactory.courseProjectStartsAsFlow,
      openFlowAuthoringSession: flowProjectFactory.openFlowAuthoringSession,
      createBlankSpatialCourseProject: spatialProjectFactory.createBlankSpatialCourseProject,
      courseProjectStartsAsSpatial: spatialProjectFactory.courseProjectStartsAsSpatial,
    }),
    courseLocations: courseLocationCommands,
    courseLogic: courseLogicAuthoringCommands,
    slideAuthoring: slideAuthoringBackend,
    slideEditor: slideEditorCommands,
    slideContent: v9SlideContentCommands,
    flowEditor: flowEditorCommands,
    flowShared: flowSharedAuthoringAdapters,
    spatialEditor: spatialEditorCommands,
    tableContent: tableContentOperations,
    flowTableContent: flowTableContentOperations,
    slideTable: slideTableCommands,
    recipes: Object.freeze({ catalog: RECIPE_CATALOG, planRecipe }),
    components: Object.freeze({
      importComponentPackage: componentPackages.importComponentPackage,
      parseComponentPackageFiles: componentPackages.parseComponentPackageFiles,
      validateComponentRuntimeSource: componentPackages.validateComponentRuntimeSource,
      ComponentPackageStore: componentPackageStore.ComponentPackageStore,
      componentPackagesFromArchive: componentPackageStore.componentPackagesFromArchive,
      componentPackagesToArchiveFiles: componentPackageStore.componentPackagesToArchiveFiles,
    }),
    archive: courseProjectArchive,
    schema: Object.freeze({ courseProjectDocumentSchema }),
  })
}

export type CoursewareCaseBuilderApi = ReturnType<typeof createCoursewareCaseBuilderApi>

export interface CoursewareCaseBuilderContext {
  apiVersion: typeof COURSEWARE_CASE_BUILDER_API_VERSION
  caseDir: string
  encodeBase64(value: Uint8Array | string): string
  documents: {
    teachingPlan: { path: string, content: string }
    presentationScript: { path: string, content: string }
  }
  capabilityIndex: unknown
  capabilityDiscovery?: unknown
  api: CoursewareCaseBuilderApi
}

export type CoursewareCaseBuilder = (
  context: CoursewareCaseBuilderContext,
) => CoursewareCaseBuildOutput | Promise<CoursewareCaseBuildOutput>
