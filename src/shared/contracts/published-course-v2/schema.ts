import { z } from 'zod'
import {
  addCanonicalLayerOrderIssues,
  courseDesignTokensSchema,
  courseLocationSchema,
  courseMediaSchema,
  courseNavigationGuardSchema,
  coursePlaybackSchema,
  courseProjectDocumentSchema,
  courseStateDeclarationSchema,
  flowBodyLayerPlaneSchema,
  flowBlockSchema,
  globalLayerPlaneSchema,
  layerFrameSchema,
  layerItemOverrideSchema,
  locationVisibilitySchema,
  mixedPrintPlanSchema,
  nativeElementContentSchema,
  runtimeContentSchema,
  spatialCameraFrameSchema,
  spatialCameraPoseSchema,
  spatialPathDocumentSchema,
  spatialRelationDocumentSchema,
  strictCourseInteractionsSchema,
} from '../course-project-v9/schema'
import type {
  AssetMeta,
} from '../../projectTypes'
import type {
  CourseProjectDocument,
  FlowSurfaceLayerEntry,
  GlobalLayerEntry,
  LayerItem,
  ScopedLayerItem,
} from '../course-project-v9/types'
import {
  PUBLISHED_COURSE_FORMAT,
  PUBLISHED_COURSE_VERSION,
  type PublishedCourseSurface,
  type PublishedCourseV2Payload,
  type PublishedFlowSurfaceLayerEntry,
  type PublishedGlobalLayerEntry,
  type PublishedLayerItem,
  type PublishedScopedLayerItem,
} from './types'

const finiteNumber = z.number().finite()
const unitInterval = finiteNumber.min(0).max(1)
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const stableIdSchema = z.string().trim().min(1).max(240)

export const publishedCourseExecutableCodeSchema = z.object({
  encoding: z.literal('base64-utf16le'),
  data: z.string().min(1).max(8 * 1024 * 1024),
}).strict()

const publishedAssetSchema = z.object({
  mimeType: z.string().trim().min(1).max(200),
  url: z.string().min(1).max(100 * 1024 * 1024),
}).strict()

const publishedComponentSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(100),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  apiVersion: z.literal(4),
  scopes: z.array(z.enum(['scene', 'global'])).min(1).max(2),
  renderMode: z.enum(['dom', 'phaser', 'hybrid']),
  code: publishedCourseExecutableCodeSchema,
  assets: z.record(z.string(), publishedAssetSchema),
}).strict()

const publishedLayerBaseFields = {
  layerItemId: stableIdSchema,
  frame: layerFrameSchema,
  order: z.number().int().nonnegative(),
  visible: z.boolean(),
  rotation: finiteNumber.min(-36_000).max(36_000),
  opacity: unitInterval,
  hitPolicy: z.enum(['auto', 'surface', 'pass-through']),
  playbackInitialVisibility: z.enum(['inherit', 'hidden']),
  paperSpace: z.enum(['viewport', 'paper']).optional(),
} as const

const publishedRuntimeSchema = z.object({
  protocol: z.enum(['canvas-runtime', 'surface-runtime']),
  runtimeApiVersion: z.union([z.literal(2), z.literal(3)]),
  enabled: z.boolean(),
  renderMode: z.enum(['phaser', 'dom', 'hybrid']),
  code: publishedCourseExecutableCodeSchema,
  content: runtimeContentSchema,
  assets: z.record(z.string(), z.object({ assetId: stableIdSchema }).strict()),
  nodeBindings: z.record(z.string(), stableIdSchema).optional(),
  staticFallback: z.object({
    assetId: stableIdSchema,
    coverage: z.enum(['surface', 'scene']),
  }).strict().optional(),
}).strict().superRefine((runtime, context) => {
  const validPair =
    (runtime.protocol === 'canvas-runtime' && runtime.runtimeApiVersion === 2) ||
    (runtime.protocol === 'surface-runtime' && runtime.runtimeApiVersion === 3)
  if (!validPair) {
    context.addIssue({
      code: 'custom',
      path: ['runtimeApiVersion'],
      message: 'Runtime protocol and API version do not match',
    })
  }
  if (runtime.protocol === 'surface-runtime' && runtime.renderMode !== 'dom') {
    context.addIssue({
      code: 'custom',
      path: ['renderMode'],
      message: 'Surface Runtime V1 currently supports DOM rendering only',
    })
  }
})

export const publishedLayerItemSchema: z.ZodType<PublishedLayerItem> = z.discriminatedUnion('kind', [
  z.object({
    ...publishedLayerBaseFields,
    kind: z.literal('native'),
    content: nativeElementContentSchema,
  }).strict(),
  z.object({
    ...publishedLayerBaseFields,
    kind: z.literal('component'),
    component: z.object({
      packageId: stableIdSchema,
      version: z.string().trim().min(1).max(100),
    }).strict(),
    props: z.record(z.string(), z.unknown()),
    staticFallbackAssetId: stableIdSchema.optional(),
  }).strict(),
  z.object({
    ...publishedLayerBaseFields,
    kind: z.literal('runtime'),
    runtime: publishedRuntimeSchema,
  }).strict(),
])

const publishedLayerListSchema = z.array(publishedLayerItemSchema).max(20_000)
  .superRefine(addCanonicalLayerOrderIssues)

const publishedScopedLayerItemSchema: z.ZodType<PublishedScopedLayerItem> = z.object({
  item: publishedLayerItemSchema,
  visibility: locationVisibilitySchema,
}).strict()

const publishedScopedLayerListSchema = z.array(publishedScopedLayerItemSchema).max(20_000)
  .superRefine((entries, context) => {
    addCanonicalLayerOrderIssues(entries.map((entry) => entry.item), context)
  })

const publishedFlowSurfaceLayerEntrySchema: z.ZodType<PublishedFlowSurfaceLayerEntry> = z.object({
  item: publishedLayerItemSchema,
  visibility: locationVisibilitySchema,
  bodyPlane: flowBodyLayerPlaneSchema.optional(),
}).strict()

const publishedFlowSurfaceLayerEntryListSchema = z.array(publishedFlowSurfaceLayerEntrySchema).max(20_000)
  .superRefine((entries, context) => {
    addCanonicalLayerOrderIssues(entries.map((entry) => entry.item), context)
  })

const publishedGlobalLayerEntrySchema: z.ZodType<PublishedGlobalLayerEntry> = z.object({
  item: publishedLayerItemSchema,
  visibility: locationVisibilitySchema,
  plane: globalLayerPlaneSchema.optional(),
}).strict().superRefine((entry, context) => {
  if (
    entry.plane === 'underlay'
    && entry.item.kind === 'native'
    && entry.item.content.nativeType === 'teacher-controller'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['plane'],
      message: 'Teacher controller must stay in the global Overlay plane',
    })
  }
})

const publishedGlobalLayerEntryListSchema = z.array(publishedGlobalLayerEntrySchema).max(20_000)
  .superRefine((entries, context) => {
    addCanonicalLayerOrderIssues(entries.map((entry) => entry.item), context)
  })

const publishedPresentationSchema = z.object({
  initialStateId: stableIdSchema,
  states: z.array(z.object({
    id: stableIdSchema,
    name: z.string().trim().min(1).max(120),
    backgroundColor: colorSchema.optional(),
    backgroundAssetId: stableIdSchema.nullable().optional(),
    layerItemOverrides: z.record(z.string(), layerItemOverrideSchema),
    layerItemOrder: z.array(stableIdSchema).max(20_000).optional(),
  }).strict()).min(1).max(1_000),
}).strict().superRefine((presentation, context) => {
  const ids = presentation.states.map((state) => state.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['states'], message: 'State ids must be unique' })
  }
  if (!ids.includes(presentation.initialStateId)) {
    context.addIssue({ code: 'custom', path: ['initialStateId'], message: 'Initial state does not exist' })
  }
})

const publishedSlideSceneSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(200),
  backgroundColor: colorSchema,
  backgroundAssetId: stableIdSchema.nullable().optional(),
  layerItems: publishedLayerListSchema,
  presentation: publishedPresentationSchema.optional(),
  interactions: strictCourseInteractionsSchema,
}).strict()

const publishedSurfaceBaseFields = {
  id: stableIdSchema,
  title: z.string().trim().min(1).max(500),
  surfaceLayerItems: publishedScopedLayerListSchema,
} as const

const publishedSlideSurfaceSchema = z.object({
  ...publishedSurfaceBaseFields,
  type: z.literal('slide'),
  canvas: z.object({ width: z.literal(1280), height: z.literal(720) }).strict(),
  scenes: z.array(publishedSlideSceneSchema).min(1).max(10_000),
}).strict()

const publishedFlowSurfaceSchema = z.object({
  id: publishedSurfaceBaseFields.id,
  title: publishedSurfaceBaseFields.title,
  surfaceLayerItems: publishedFlowSurfaceLayerEntryListSchema,
  type: z.literal('flow'),
  backgroundColor: colorSchema.optional(),
  layout: z.object({
    readingWidth: finiteNumber.min(320).max(2_400),
    wideContentWidth: finiteNumber.min(320).max(4_000),
  }).strict(),
  blocks: z.array(flowBlockSchema).max(100_000),
}).strict()

const semanticZoomSchema = z.object({
  id: stableIdSchema,
  layerItemIds: z.array(stableIdSchema).min(1).max(20_000),
  minZoom: finiteNumber.nonnegative(),
  maxZoom: finiteNumber.positive(),
  visible: z.boolean(),
}).strict()

const publishedSpatialSurfaceSchema = z.object({
  ...publishedSurfaceBaseFields,
  type: z.literal('spatial-2d'),
  backgroundColor: colorSchema.optional(),
  world: z.object({
    bounds: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('infinite') }).strict(),
      z.object({
        mode: z.literal('finite'),
        x: finiteNumber,
        y: finiteNumber,
        width: finiteNumber.positive(),
        height: finiteNumber.positive(),
      }).strict(),
    ]),
    layerItems: publishedLayerListSchema,
    paths: z.array(spatialPathDocumentSchema).max(10_000).default([]),
    relations: z.array(spatialRelationDocumentSchema).max(10_000).default([]),
  }).strict(),
  camera: z.object({
    home: spatialCameraPoseSchema,
    frames: z.array(spatialCameraFrameSchema).max(10_000),
  }).strict(),
  semanticZoom: z.array(semanticZoomSchema).max(10_000),
}).strict().superRefine((surface, context) => {
  const itemIds = new Set(surface.world.layerItems.map((item) => item.layerItemId))
  const pathIds = new Set<string>()
  surface.world.paths.forEach((path, index) => {
    if (pathIds.has(path.id)) {
      context.addIssue({
        code: 'custom',
        path: ['world', 'paths', index, 'id'],
        message: `Spatial path ids must be unique: ${path.id}`,
      })
    }
    pathIds.add(path.id)
    if (new Set(path.layerItemIds).size !== path.layerItemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['world', 'paths', index, 'layerItemIds'],
        message: 'Spatial path item ids must be unique',
      })
    }
    path.layerItemIds.forEach((itemId) => {
      if (!itemIds.has(itemId)) {
        context.addIssue({
          code: 'custom',
          path: ['world', 'paths', index, 'layerItemIds'],
          message: `Spatial path references missing world item: ${itemId}`,
        })
      }
    })
  })
  const relationIds = new Set<string>()
  surface.world.relations.forEach((relation, index) => {
    if (relationIds.has(relation.id)) {
      context.addIssue({
        code: 'custom',
        path: ['world', 'relations', index, 'id'],
        message: `Spatial relation ids must be unique: ${relation.id}`,
      })
    }
    relationIds.add(relation.id)
    if (!itemIds.has(relation.sourceLayerItemId)) {
      context.addIssue({
        code: 'custom',
        path: ['world', 'relations', index, 'sourceLayerItemId'],
        message: `Spatial relation references missing world item: ${relation.sourceLayerItemId}`,
      })
    }
    if (!itemIds.has(relation.targetLayerItemId)) {
      context.addIssue({
        code: 'custom',
        path: ['world', 'relations', index, 'targetLayerItemId'],
        message: `Spatial relation references missing world item: ${relation.targetLayerItemId}`,
      })
    }
    if (relation.sourceLayerItemId === relation.targetLayerItemId) {
      context.addIssue({
        code: 'custom',
        path: ['world', 'relations', index],
        message: 'Spatial relation source and target must be different world items',
      })
    }
  })
})

export const publishedCourseSurfaceSchema: z.ZodType<PublishedCourseSurface> = z.discriminatedUnion('type', [
  publishedSlideSurfaceSchema,
  publishedFlowSurfaceSchema,
  publishedSpatialSurfaceSchema,
])

function hydrateLayer(item: PublishedLayerItem): LayerItem {
  if (item.kind === 'native') {
    return { ...item, label: item.layerItemId, locked: false }
  }
  if (item.kind === 'component') {
    return { ...item, label: item.layerItemId, locked: false }
  }
  const { code: _code, ...runtime } = item.runtime
  return {
    ...item,
    label: item.layerItemId,
    locked: false,
    runtime: {
      ...runtime,
      source: '/* published executable */',
    },
  }
}

function hydrateScoped(entry: PublishedScopedLayerItem): ScopedLayerItem {
  return { item: hydrateLayer(entry.item), visibility: entry.visibility }
}

function hydrateFlowScoped(entry: PublishedFlowSurfaceLayerEntry): FlowSurfaceLayerEntry {
  return {
    item: hydrateLayer(entry.item),
    visibility: entry.visibility,
    ...(entry.bodyPlane === undefined ? {} : { bodyPlane: entry.bodyPlane }),
  }
}

function hydrateGlobal(entry: PublishedGlobalLayerEntry): GlobalLayerEntry {
  return {
    item: hydrateLayer(entry.item),
    visibility: entry.visibility,
    ...(entry.plane === undefined ? {} : { plane: entry.plane }),
  }
}

function hydrateSurface(surface: PublishedCourseSurface): CourseProjectDocument['surfaces'][number] {
  const base = {
    id: surface.id,
    title: surface.title,
    surfaceLayerItems: surface.surfaceLayerItems.map(hydrateScoped),
  }
  if (surface.type === 'slide') {
    return {
      ...base,
      type: 'slide',
      canvas: surface.canvas,
      scenes: surface.scenes.map((scene) => ({
        ...scene,
        layerItems: scene.layerItems.map(hydrateLayer),
        presentation: scene.presentation
          ? {
              initialStateId: scene.presentation.initialStateId,
              states: scene.presentation.states,
            }
          : undefined,
      })),
    }
  }
  if (surface.type === 'flow') {
    return { ...surface, surfaceLayerItems: surface.surfaceLayerItems.map(hydrateFlowScoped) }
  }
  return {
    ...surface,
    surfaceLayerItems: base.surfaceLayerItems,
    world: { ...surface.world, layerItems: surface.world.layerItems.map(hydrateLayer) },
  }
}

export const publishedCourseV2Schema = z.object({
  format: z.literal(PUBLISHED_COURSE_FORMAT),
  formatVersion: z.literal(PUBLISHED_COURSE_VERSION),
  sourceSchemaVersion: z.literal(9),
  courseId: stableIdSchema,
  title: z.string().trim().min(1).max(500),
  assets: z.record(z.string(), publishedAssetSchema),
  components: z.record(z.string(), publishedComponentSchema),
  designTokens: courseDesignTokensSchema,
  media: courseMediaSchema,
  playback: coursePlaybackSchema,
  courseState: z.array(courseStateDeclarationSchema).max(10_000),
  navigationGuards: z.array(courseNavigationGuardSchema).max(10_000),
  locations: z.array(courseLocationSchema).min(1).max(100_000),
  startLocationId: stableIdSchema,
  globalLayerItems: publishedGlobalLayerEntryListSchema,
  globalInteractions: strictCourseInteractionsSchema,
  surfaces: z.array(publishedCourseSurfaceSchema).min(1).max(10_000),
  mixedPrintPlan: mixedPrintPlanSchema.optional(),
}).strict().superRefine((published, context) => {
  const fakeAssets: Record<string, AssetMeta> = Object.fromEntries(Object.entries(published.assets).map(([id, asset]) => [
    id,
    {
      id,
      filename: `${id}.published`,
      mimeType: asset.mimeType,
      kind: (asset.mimeType.startsWith('audio/')
        ? 'audio'
        : asset.mimeType.startsWith('video/')
          ? 'video'
          : 'image') as AssetMeta['kind'],
      path: `assets/${id}`,
      byteLength: 0,
    },
  ]))
  const fakeComponents = Object.fromEntries(Object.entries(published.components).map(([recordKey, component]) => [
    component.id,
    {
      packageId: component.id,
      version: component.version,
      name: component.name,
      manifestPath: `components/${recordKey}/manifest.json`,
      runtimePath: `components/${recordKey}/runtime.js`,
      contentSha256: component.contentSha256,
    },
  ]))
  if (Object.keys(fakeComponents).length !== Object.keys(published.components).length) {
    context.addIssue({
      code: 'custom',
      path: ['components'],
      message: 'Published course cannot contain multiple versions of the same component package',
    })
  }
  const authoringCandidate: CourseProjectDocument = {
    schemaVersion: 9,
    id: published.courseId,
    revision: 0,
    title: published.title,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    assets: fakeAssets,
    componentPackages: fakeComponents,
    designTokens: published.designTokens,
    media: published.media,
    playback: published.playback,
    courseState: published.courseState,
    navigationGuards: published.navigationGuards,
    locations: published.locations,
    startLocationId: published.startLocationId,
    globalLayerItems: published.globalLayerItems.map(hydrateGlobal),
    globalInteractions: published.globalInteractions,
    surfaces: published.surfaces.map(hydrateSurface),
    mixedPrintPlan: published.mixedPrintPlan,
  }
  const result = courseProjectDocumentSchema.safeParse(authoringCandidate)
  if (!result.success) {
    result.error.issues.forEach((issue) => {
      context.addIssue({
        code: 'custom',
        path: issue.path,
        message: `Published course semantic error: ${issue.message}`,
      })
    })
  }
})

const _publishedCourseSchemaTypeContract: z.ZodType<PublishedCourseV2Payload> = publishedCourseV2Schema
void _publishedCourseSchemaTypeContract
