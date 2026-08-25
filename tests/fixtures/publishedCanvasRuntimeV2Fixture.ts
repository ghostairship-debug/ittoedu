import {
  captureCourseAuthoringTarget,
  createSessionToken,
  type CurrentCourseAuthoringTargetIdentity,
} from '../../src/renderer/authoring/courseAuthoringSession'
import {
  makeLayerItemAuthoringAddress,
  ownerKeyFor,
} from '../../src/renderer/authoring/courseAuthoringScope'
import {
  addCourseFlowPage,
  addCourseScene,
  addCourseSpatialPage,
} from '../../src/renderer/course/courseLocationCommands'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import {
  planRuntimePropertyUpdate,
  retargetCourseRuntimeProperty,
} from '../../src/renderer/runtime/runtimePropertyAuthoringCommands'
import { planRuntimeSourceUpdate } from '../../src/renderer/runtime/runtimeSourceAuthoringCommands'
import {
  captureCourseRuntimeTemplateCreationTarget,
  planRuntimeTemplateCreation,
} from '../../src/renderer/runtime/runtimeTemplateAuthoringCommands'
import { COURSE_RUNTIME_SOURCE_AUTHORING_FIELD } from '../../src/renderer/runtime/runtimeSourceAuthoringView'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '../../src/shared/courseProjectTypes'
import type { RuntimeRenderMode } from '../../src/shared/runtimeTypes'

const NOW = '2026-08-26T02:00:00.000Z'

export interface AuthoredCanvasRuntimeSpec {
  readonly itemId: string
  readonly renderMode: RuntimeRenderMode
  readonly source: string
}

export interface PublishedCanvasRuntimeV2Fixture {
  readonly project: CourseProjectDocument
  readonly slideSurfaceId: string
  readonly slideLocationIds: readonly string[]
  readonly flowLocationId?: string
  readonly spatialLocationId?: string
  readonly itemIds: readonly string[]
}

function requirePlanned<T extends { readonly nextDocument: CourseProjectDocument }>(
  result: {
    readonly ok: boolean
    readonly status?: string
    readonly plan?: T | null
    readonly code?: string
    readonly reason?: string
  },
  operation: string,
): T {
  if (!result.ok || result.status !== 'planned' || !result.plan) {
    throw new Error(
      `${operation} failed: ${result.code ?? result.status ?? 'unknown'} ${result.reason ?? ''}`,
    )
  }
  return result.plan
}

function runtimeItem(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
  itemId: string,
): RuntimeLayerItem {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('expected authored Slide surface')
  const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
  const item = scene?.layerItems.find((candidate) => candidate.layerItemId === itemId)
  if (!item || item.kind !== 'runtime') throw new Error(`missing authored Runtime ${itemId}`)
  return item
}

function identity(
  project: CourseProjectDocument,
  locationId: string,
  surfaceId: string,
  ownerKey: string,
  generation: number,
): CurrentCourseAuthoringTargetIdentity {
  const sessionToken = createSessionToken({
    locationId,
    surfaceType: 'slide',
    revision: project.revision,
  }, generation)
  return {
    projectId: project.id,
    documentRevision: project.revision,
    sessionToken,
    surfaceId,
    stateId: null,
    owner: 'scene',
    ownerKey,
  }
}

function authorCanvasRuntime(
  sourceProject: CourseProjectDocument,
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'slide-scene' }>,
  spec: AuthoredCanvasRuntimeSpec,
  generation: number,
): CourseProjectDocument {
  const ownerKey = ownerKeyFor('scene', location.surfaceId, location.sceneId)
  const templateIdentity = identity(
    sourceProject,
    location.id,
    location.surfaceId,
    ownerKey,
    generation,
  )
  const templateTarget = captureCourseRuntimeTemplateCreationTarget({
    sessionToken: templateIdentity.sessionToken,
    projectId: sourceProject.id,
    surfaceId: location.surfaceId,
    stateId: null,
    owner: 'scene',
    sceneId: location.sceneId,
  })
  const templatePlan = requirePlanned(planRuntimeTemplateCreation({
    project: sourceProject,
    currentIdentity: templateIdentity,
    target: templateTarget,
    newItemId: spec.itemId,
    now: NOW,
  }), `template ${spec.itemId}`)

  let project = templatePlan.nextDocument
  const sourceIdentity = identity(
    project,
    location.id,
    location.surfaceId,
    ownerKey,
    generation + 1,
  )
  const sourceTarget = captureCourseAuthoringTarget({
    sessionToken: sourceIdentity.sessionToken,
    projectId: project.id,
    surfaceId: location.surfaceId,
    stateId: null,
    owner: 'scene',
    ownerKey,
    itemId: spec.itemId,
    authoringAddress: makeLayerItemAuthoringAddress({
      projectId: project.id,
      owner: 'scene',
      surfaceId: location.surfaceId,
      sceneId: location.sceneId,
      kind: 'runtime',
      layerItemId: spec.itemId,
      field: COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
    }),
  })
  project = requirePlanned(planRuntimeSourceUpdate({
    project,
    currentIdentity: sourceIdentity,
    target: sourceTarget,
    source: spec.source,
    now: NOW,
  }), `source ${spec.itemId}`).nextDocument

  if (spec.renderMode !== 'phaser') {
    const propertyIdentity = identity(
      project,
      location.id,
      location.surfaceId,
      ownerKey,
      generation + 2,
    )
    const propertySourceTarget = captureCourseAuthoringTarget({
      sessionToken: propertyIdentity.sessionToken,
      projectId: project.id,
      surfaceId: location.surfaceId,
      stateId: null,
      owner: 'scene',
      ownerKey,
      itemId: spec.itemId,
      authoringAddress: makeLayerItemAuthoringAddress({
        projectId: project.id,
        owner: 'scene',
        surfaceId: location.surfaceId,
        sceneId: location.sceneId,
        kind: 'runtime',
        layerItemId: spec.itemId,
        field: COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
      }),
    })
    const propertyTarget = retargetCourseRuntimeProperty(propertySourceTarget, {
      field: 'renderMode',
      initialValue: 'phaser',
    })
    project = requirePlanned(planRuntimePropertyUpdate({
      project,
      currentIdentity: propertyIdentity,
      target: propertyTarget,
      update: { field: 'renderMode', value: spec.renderMode },
      now: NOW,
    }), `renderMode ${spec.itemId}`).nextDocument
  }

  const authored = runtimeItem(project, location.surfaceId, location.sceneId, spec.itemId)
  if (
    authored.runtime.protocol !== 'canvas-runtime'
    || authored.runtime.runtimeApiVersion !== 2
    || authored.runtime.renderMode !== spec.renderMode
    || authored.runtime.source !== spec.source.trim()
  ) {
    throw new Error(`authoring command output mismatch for ${spec.itemId}`)
  }
  return project
}

export function createPublishedCanvasRuntimeV2Fixture(
  specs: readonly AuthoredCanvasRuntimeSpec[],
  options: { readonly includeFlow?: boolean; readonly includeSpatial?: boolean } = {},
): PublishedCanvasRuntimeV2Fixture {
  if (specs.length === 0) throw new Error('at least one Canvas Runtime spec is required')
  let id = 0
  let project = createBlankCourseProject({
    id: 'published-canvas-runtime-v2',
    title: 'Published Canvas Runtime V2',
    now: NOW,
    idFactory: () => `published-canvas-${++id}`,
  })
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected initial Slide surface')
  for (let index = 1; index < specs.length; index += 1) {
    const added = addCourseScene(project, {
      surfaceId: slide.id,
      title: `Runtime ${index + 1}`,
      now: NOW,
      expectedRevision: project.revision,
    })
    if (!added.ok) throw new Error(added.reason)
    project = added.project
  }
  if (options.includeFlow) {
    const added = addCourseFlowPage(project, {
      title: 'Flow pause target',
      now: NOW,
      expectedRevision: project.revision,
    })
    if (!added.ok) throw new Error(added.reason)
    project = added.project
  }
  if (options.includeSpatial) {
    const added = addCourseSpatialPage(project, {
      title: 'Spatial pause target',
      now: NOW,
      expectedRevision: project.revision,
    })
    if (!added.ok) throw new Error(added.reason)
    project = added.project
  }

  const locations = project.locations.filter((location): location is Extract<
    CourseProjectDocument['locations'][number],
    { kind: 'slide-scene' }
  > => location.kind === 'slide-scene' && location.surfaceId === slide.id)
  if (locations.length < specs.length) throw new Error('missing authored Slide locations')
  for (let index = 0; index < specs.length; index += 1) {
    project = authorCanvasRuntime(project, locations[index]!, specs[index]!, 10 + index * 3)
  }
  project = courseProjectDocumentSchema.parse(project)
  return {
    project,
    slideSurfaceId: slide.id,
    slideLocationIds: locations.slice(0, specs.length).map((location) => location.id),
    ...(options.includeFlow
      ? {
          flowLocationId: project.locations.find((location) => location.kind === 'flow-block')?.id,
        }
      : {}),
    ...(options.includeSpatial
      ? {
          spatialLocationId: project.locations.find(
            (location) => location.kind === 'spatial-camera',
          )?.id,
        }
      : {}),
    itemIds: specs.map((spec) => spec.itemId),
  }
}
