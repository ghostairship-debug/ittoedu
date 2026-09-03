import { z } from 'zod'
import {
  addCanonicalLayerOrderIssues,
  courseLocationSchema,
  courseNavigationGuardSchema,
  flowBodyLayerPlaneSchema,
  flowBlockSchema,
  globalLayerPlaneSchema,
  layerFrameSchema,
  layerItemOverrideSchema,
  locationVisibilitySchema,
  mixedPrintPlanSchema,
  mergeCourseNativeData,
  nativeElementContentSchema,
  runtimeContentSchema,
  spatialCameraFrameSchema,
  spatialCameraPoseSchema,
  spatialPathDocumentSchema,
  spatialRelationDocumentSchema,
  strictCourseInteractionsSchema,
} from '../course-project-v9/schema'
import { courseStateDeclarationSchema } from '../course-state/schema'
import { courseStateScalarType } from '../course-state/types'
import { courseProjectDesignTokensSchema } from '../design-v1/schema'
import { courseProjectMediaSettingsSchema } from '../media-v1/schema'
import { nativeContentSchemaByType, NATIVE_RENDERABLE_BASE_KEYS } from '../native-v1/schema'
import { courseProjectPlaybackSettingsSchema } from '../playback-v1/schema'
import type { FlowBlock } from '../course-project-v9/types'
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
const nativeBaseKeys = new Set<string>(NATIVE_RENDERABLE_BASE_KEYS)

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
  Object.keys(runtime.content.metadata ?? {}).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(runtime.content.values, key)) {
      context.addIssue({
        code: 'custom',
        path: ['content', 'metadata', key],
        message: `Runtime metadata references missing content key: ${key}`,
      })
    }
  })
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
]).superRefine((item, context) => {
  // Preserve the parser's historical rejection boundary without changing the
  // declared V2 field schema: the removed authoring hydration validated this
  // value as a 200-character label after stable-ID normalization.
  if (item.layerItemId.length > 200) {
    context.addIssue({
      code: 'custom',
      path: ['layerItemId'],
      message: 'Published layer item id cannot exceed 200 characters',
    })
  }
})

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
}).strict().superRefine((scene, context) => {
  const itemById = new Map(scene.layerItems.map((item) => [item.layerItemId, item]))
  const interactionIds = scene.interactions.map((rule) => rule.id)
  if (new Set(interactionIds).size !== interactionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['interactions'],
      message: 'Interaction rule ids must be unique in a scene',
    })
  }
  scene.presentation?.states.forEach((state, stateIndex) => {
    Object.entries(state.layerItemOverrides).forEach(([itemId, override]) => {
      const item = itemById.get(itemId)
      if (!item) {
        context.addIssue({
          code: 'custom',
          path: ['presentation', 'states', stateIndex, 'layerItemOverrides', itemId],
          message: `State override references missing layer item: ${itemId}`,
        })
        return
      }
      if (override.nativeData && item.kind !== 'native') {
        context.addIssue({
          code: 'custom',
          path: ['presentation', 'states', stateIndex, 'layerItemOverrides', itemId, 'nativeData'],
          message: 'nativeData can only override a native item',
        })
      }
      if (override.componentProps && item.kind !== 'component') {
        context.addIssue({
          code: 'custom',
          path: ['presentation', 'states', stateIndex, 'layerItemOverrides', itemId, 'componentProps'],
          message: 'componentProps can only override a component item',
        })
      }
      if (override.nativeData && item.kind === 'native') {
        if (Object.keys(override.nativeData).some((key) => nativeBaseKeys.has(key))) {
          context.addIssue({
            code: 'custom',
            path: ['presentation', 'states', stateIndex, 'layerItemOverrides', itemId, 'nativeData'],
            message: 'nativeData cannot shadow stable layer fields',
          })
        } else {
          const candidate = mergeCourseNativeData(
            item.content.data as unknown as Record<string, unknown>,
            override.nativeData,
          )
          const parsed = nativeContentSchemaByType[item.content.nativeType].safeParse(candidate)
          if (!parsed.success) {
            context.addIssue({
              code: 'custom',
              path: ['presentation', 'states', stateIndex, 'layerItemOverrides', itemId, 'nativeData'],
              message: `Invalid native override: ${parsed.error.issues[0]?.message}`,
            })
          }
        }
      }
    })
    if (state.layerItemOrder) {
      const seen = new Set<string>()
      state.layerItemOrder.forEach((itemId, itemIndex) => {
        if (!itemById.has(itemId) || seen.has(itemId)) {
          context.addIssue({
            code: 'custom',
            path: ['presentation', 'states', stateIndex, 'layerItemOrder', itemIndex],
            message: `Invalid or duplicate state layer item id: ${itemId}`,
          })
        }
        seen.add(itemId)
      })
    }
  })
})

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
}).strict().superRefine((surface, context) => {
  const ids = surface.scenes.map((scene) => scene.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['scenes'], message: 'Scene ids must be unique' })
  }
})

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
}).strict().superRefine((surface, context) => {
  if (surface.layout.wideContentWidth < surface.layout.readingWidth) {
    context.addIssue({
      code: 'custom',
      path: ['layout', 'wideContentWidth'],
      message: 'Wide content width cannot be narrower than reading width',
    })
  }
  const seen = new Set<string>()
  const visit = (blocks: FlowBlock[]): void => {
    blocks.forEach((block) => {
      if (seen.has(block.id)) {
        context.addIssue({
          code: 'custom',
          path: ['blocks'],
          message: `Flow block ids must be unique: ${block.id}`,
        })
      }
      seen.add(block.id)
      if (block.type === 'section') visit(block.blocks)
    })
  }
  visit(surface.blocks)
})

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
  const frameIds = surface.camera.frames.map((frame) => frame.id)
  if (new Set(frameIds).size !== frameIds.length) {
    context.addIssue({ code: 'custom', path: ['camera', 'frames'], message: 'Camera frame ids must be unique' })
  }
  const itemIds = new Set(surface.world.layerItems.map((item) => item.layerItemId))
  const ruleIds = new Set<string>()
  surface.semanticZoom.forEach((rule, index) => {
    if (ruleIds.has(rule.id)) {
      context.addIssue({ code: 'custom', path: ['semanticZoom', index, 'id'], message: 'Semantic zoom rule ids must be unique' })
    }
    ruleIds.add(rule.id)
    if (rule.minZoom >= rule.maxZoom) {
      context.addIssue({ code: 'custom', path: ['semanticZoom', index], message: 'Semantic zoom minZoom must be less than maxZoom' })
    }
    if (new Set(rule.layerItemIds).size !== rule.layerItemIds.length) {
      context.addIssue({ code: 'custom', path: ['semanticZoom', index, 'layerItemIds'], message: 'Semantic zoom item ids must be unique' })
    }
    rule.layerItemIds.forEach((itemId) => {
      if (!itemIds.has(itemId)) {
        context.addIssue({
          code: 'custom',
          path: ['semanticZoom', index, 'layerItemIds'],
          message: `Semantic zoom references missing world item: ${itemId}`,
        })
      }
    })
  })
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

type PublishedSemanticPath = Array<string | number>

function addPublishedSemanticIssue(
  context: z.RefinementCtx,
  path: PublishedSemanticPath,
  message: string,
): void {
  context.addIssue({
    code: 'custom',
    path,
    message: `Published course semantic error: ${message}`,
  })
}

function walkPublishedFlowBlocks(
  blocks: readonly FlowBlock[],
  visit: (block: FlowBlock) => void,
): void {
  blocks.forEach((block) => {
    visit(block)
    if (block.type === 'section') walkPublishedFlowBlocks(block.blocks, visit)
  })
}

function validatePublishedCourseSemantics(
  published: PublishedCourseV2Payload,
  context: z.RefinementCtx,
): void {
  const assetIds = new Set(Object.keys(published.assets))
  Object.keys(published.assets).forEach((assetId) => {
    const parsed = stableIdSchema.safeParse(assetId)
    if (!parsed.success || parsed.data !== assetId) {
      addPublishedSemanticIssue(context, ['assets', assetId], 'Published asset ids must be stable ids')
    }
  })

  const componentsById = new Map<string, PublishedCourseV2Payload['components'][string]>()
  Object.entries(published.components).forEach(([recordKey, component]) => {
    if (componentsById.has(component.id)) {
      context.addIssue({
        code: 'custom',
        path: ['components', recordKey],
        message: 'Published course cannot contain multiple versions of the same component package',
      })
    }
    componentsById.set(component.id, component)
  })

  const stateByKey = new Map(published.courseState.map((state) => [state.key, state]))
  if (stateByKey.size !== published.courseState.length) {
    addPublishedSemanticIssue(context, ['courseState'], 'Course-state keys must be unique')
  }
  const locationsById = new Map(published.locations.map((location) => [location.id, location]))
  if (locationsById.size !== published.locations.length) {
    addPublishedSemanticIssue(context, ['locations'], 'Course location ids must be unique')
  }
  if (!locationsById.has(published.startLocationId)) {
    addPublishedSemanticIssue(context, ['startLocationId'], 'Start location does not exist')
  }
  const surfacesById = new Map(published.surfaces.map((surface) => [surface.id, surface]))
  if (surfacesById.size !== published.surfaces.length) {
    addPublishedSemanticIssue(context, ['surfaces'], 'Surface ids must be unique')
  }
  const sceneIds = new Set(published.surfaces.flatMap((surface) => (
    surface.type === 'slide' ? surface.scenes.map((scene) => scene.id) : []
  )))

  const checkAsset = (assetId: string | undefined, path: PublishedSemanticPath): void => {
    if (assetId && !assetIds.has(assetId)) {
      addPublishedSemanticIssue(context, path, `Missing asset: ${assetId}`)
    }
  }
  const checkCourseStateReference = (
    reference: Readonly<{
      key: string
      value?: boolean | number | string | null
      operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
    }>,
    path: PublishedSemanticPath,
  ): void => {
    const state = stateByKey.get(reference.key)
    if (!state) {
      addPublishedSemanticIssue(context, [...path, 'key'], `Missing course-state key: ${reference.key}`)
      return
    }
    if (!Object.hasOwn(reference, 'value')) return
    const valueType = courseStateScalarType(reference.value!)
    if (state.valueType !== valueType) {
      addPublishedSemanticIssue(
        context,
        [...path, 'value'],
        'Course-state value type must match the declared course state',
      )
    }
    if (
      reference.operator !== undefined
      && reference.operator !== 'eq'
      && reference.operator !== 'neq'
      && state.valueType !== 'number'
    ) {
      addPublishedSemanticIssue(
        context,
        [...path, 'operator'],
        'Ordering comparisons require a number state',
      )
    }
  }
  const checkComponent = (
    reference: Readonly<{ packageId: string; version: string }>,
    path: PublishedSemanticPath,
  ): void => {
    const component = componentsById.get(reference.packageId)
    if (!component || component.version !== reference.version) {
      addPublishedSemanticIssue(
        context,
        path,
        `Missing component package/version: ${reference.packageId}@${reference.version}`,
      )
    }
  }
  const checkLayer = (item: PublishedLayerItem, path: PublishedSemanticPath): void => {
    if (item.kind === 'component') {
      checkComponent(item.component, [...path, 'component'])
      checkAsset(item.staticFallbackAssetId, [...path, 'staticFallbackAssetId'])
    } else if (item.kind === 'runtime') {
      Object.values(item.runtime.assets).forEach((binding) => {
        checkAsset(binding.assetId, [...path, 'runtime', 'assets'])
      })
      checkAsset(item.runtime.staticFallback?.assetId, [...path, 'runtime', 'staticFallback', 'assetId'])
    } else if (item.content.nativeType === 'image') {
      checkAsset(item.content.data.assetId, [...path, 'content', 'data', 'assetId'])
    } else if (item.content.nativeType === 'video') {
      checkAsset(item.content.data.assetId, [...path, 'content', 'data', 'assetId'])
      checkAsset(item.content.data.poster.assetId, [...path, 'content', 'data', 'poster', 'assetId'])
    }
  }
  const checkScoped = (entry: PublishedScopedLayerItem, path: PublishedSemanticPath): void => {
    checkLayer(entry.item, [...path, 'item'])
    entry.visibility.locationIds.forEach((locationId) => {
      if (!locationsById.has(locationId)) {
        addPublishedSemanticIssue(
          context,
          [...path, 'visibility', 'locationIds'],
          `Missing location: ${locationId}`,
        )
      }
    })
  }
  const checkEffectiveLayerIdentity = (
    items: readonly PublishedLayerItem[],
    path: PublishedSemanticPath,
  ): void => {
    const ids = new Set<string>()
    items.forEach((item, index) => {
      if (ids.has(item.layerItemId)) {
        addPublishedSemanticIssue(
          context,
          [...path, index, 'layerItemId'],
          `Effective layer item id is duplicated: ${item.layerItemId}`,
        )
      }
      ids.add(item.layerItemId)
    })
  }

  const knownLayerItemIds = new Set<string>()
  published.globalLayerItems.forEach((entry) => knownLayerItemIds.add(entry.item.layerItemId))
  published.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach((entry) => knownLayerItemIds.add(entry.item.layerItemId))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        scene.layerItems.forEach((item) => knownLayerItemIds.add(item.layerItemId))
      })
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => knownLayerItemIds.add(item.layerItemId))
    }
  })
  const checkInteractionReferences = (
    interactions: PublishedCourseV2Payload['globalInteractions'],
    path: PublishedSemanticPath,
    localLayerItemIds?: ReadonlySet<string>,
  ): void => {
    interactions.forEach((rule, ruleIndex) => {
      const checkLayerItem = (itemId: string, referencePath: PublishedSemanticPath): void => {
        const known = localLayerItemIds?.has(itemId) || knownLayerItemIds.has(itemId)
        if (!known) {
          addPublishedSemanticIssue(
            context,
            referencePath,
            `Interaction references missing layer item: ${itemId}`,
          )
        }
      }
      const trigger = rule.trigger
      if ('nodeId' in trigger) checkLayerItem(trigger.nodeId, [...path, ruleIndex, 'trigger', 'nodeId'])
      if (trigger.type === 'audio.ended' && !published.media.audio.sounds[trigger.soundId]) {
        addPublishedSemanticIssue(
          context,
          [...path, ruleIndex, 'trigger', 'soundId'],
          `Interaction references missing sound: ${trigger.soundId}`,
        )
      }
      rule.conditions.forEach((condition, conditionIndex) => {
        if (condition.type === 'scene.in') {
          condition.sceneIds.forEach((sceneId) => {
            if (!sceneIds.has(sceneId)) {
              addPublishedSemanticIssue(
                context,
                [...path, ruleIndex, 'conditions', conditionIndex],
                `Interaction references missing scene: ${sceneId}`,
              )
            }
          })
        } else if (
          condition.type === 'course-state.exists'
          || condition.type === 'course-state.compare'
        ) {
          checkCourseStateReference(condition, [...path, ruleIndex, 'conditions', conditionIndex])
        }
      })
      rule.actions.forEach((step, stepIndex) => {
        const action = step.action
        const actionPath = [...path, ruleIndex, 'actions', stepIndex, 'action']
        if ('nodeId' in action) checkLayerItem(action.nodeId, [...actionPath, 'nodeId'])
        if (action.type === 'audio.play' && !published.media.audio.sounds[action.soundId]) {
          addPublishedSemanticIssue(
            context,
            [...actionPath, 'soundId'],
            `Interaction references missing sound: ${action.soundId}`,
          )
        }
        if (
          (action.type === 'audio.pause'
            || action.type === 'audio.resume'
            || action.type === 'audio.stop'
            || action.type === 'audio.toggle-mute')
          && action.target.kind === 'sound'
          && !published.media.audio.sounds[action.target.soundId]
        ) {
          addPublishedSemanticIssue(
            context,
            [...actionPath, 'target', 'soundId'],
            `Interaction references missing sound: ${action.target.soundId}`,
          )
        }
        if (action.type === 'course-state.set') checkCourseStateReference(action, actionPath)
      })
    })
  }

  published.globalLayerItems.forEach((entry, index) => {
    checkScoped(entry, ['globalLayerItems', index])
  })
  checkInteractionReferences(published.globalInteractions, ['globalInteractions'])
  published.surfaces.forEach((surface, surfaceIndex) => {
    surface.surfaceLayerItems.forEach((entry, itemIndex) => {
      checkScoped(entry, ['surfaces', surfaceIndex, 'surfaceLayerItems', itemIndex])
    })
    const sharedLayerItems = [
      ...published.globalLayerItems.map((entry) => entry.item),
      ...surface.surfaceLayerItems.map((entry) => entry.item),
    ]
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        checkEffectiveLayerIdentity(
          [...sharedLayerItems, ...scene.layerItems],
          ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'effectiveLayerItems'],
        )
        const sceneItemIds = new Set([
          ...published.globalLayerItems.map((entry) => entry.item.layerItemId),
          ...surface.surfaceLayerItems.map((entry) => entry.item.layerItemId),
          ...scene.layerItems.map((item) => item.layerItemId),
        ])
        checkInteractionReferences(
          scene.interactions,
          ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'interactions'],
          sceneItemIds,
        )
        checkAsset(
          scene.backgroundAssetId ?? undefined,
          ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'backgroundAssetId'],
        )
        scene.layerItems.forEach((item, itemIndex) => {
          checkLayer(item, ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'layerItems', itemIndex])
        })
        scene.presentation?.states.forEach((state, stateIndex) => {
          checkAsset(
            state.backgroundAssetId ?? undefined,
            ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'presentation', 'states', stateIndex, 'backgroundAssetId'],
          )
        })
      })
    } else if (surface.type === 'flow') {
      checkEffectiveLayerIdentity(sharedLayerItems, ['surfaces', surfaceIndex, 'effectiveLayerItems'])
      walkPublishedFlowBlocks(surface.blocks, (block) => {
        if (block.type === 'media') {
          checkAsset(block.assetId, ['surfaces', surfaceIndex, 'blocks', block.id, 'assetId'])
        }
        if (block.type === 'component') {
          checkComponent(block.component, ['surfaces', surfaceIndex, 'blocks', block.id, 'component'])
          checkAsset(
            block.staticFallbackAssetId,
            ['surfaces', surfaceIndex, 'blocks', block.id, 'staticFallbackAssetId'],
          )
        }
      })
    } else {
      checkEffectiveLayerIdentity(
        [...sharedLayerItems, ...surface.world.layerItems],
        ['surfaces', surfaceIndex, 'world', 'effectiveLayerItems'],
      )
      surface.world.layerItems.forEach((item, itemIndex) => {
        checkLayer(item, ['surfaces', surfaceIndex, 'world', 'layerItems', itemIndex])
      })
    }
  })
  Object.values(published.media.audio.sounds).forEach((sound) => {
    checkAsset(sound.assetId, ['media', 'audio', 'sounds', sound.id, 'assetId'])
  })

  published.locations.forEach((location, index) => {
    const surface = surfacesById.get(location.surfaceId)
    if (!surface || (
      (location.kind === 'slide-scene' && surface.type !== 'slide')
      || (location.kind === 'flow-block' && surface.type !== 'flow')
      || (location.kind === 'spatial-camera' && surface.type !== 'spatial-2d')
    )) {
      addPublishedSemanticIssue(
        context,
        ['locations', index, 'surfaceId'],
        'Location surface is missing or has the wrong type',
      )
      return
    }
    if (location.kind === 'slide-scene' && surface.type === 'slide') {
      const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
      if (!scene) {
        addPublishedSemanticIssue(context, ['locations', index, 'sceneId'], `Missing scene: ${location.sceneId}`)
      }
      if (location.stateId && !scene?.presentation?.states.some((state) => state.id === location.stateId)) {
        addPublishedSemanticIssue(
          context,
          ['locations', index, 'stateId'],
          `Missing scene state: ${location.stateId}`,
        )
      }
    } else if (location.kind === 'flow-block' && surface.type === 'flow') {
      let found = false
      walkPublishedFlowBlocks(surface.blocks, (block) => {
        if (block.id === location.blockId) found = true
      })
      if (!found) {
        addPublishedSemanticIssue(
          context,
          ['locations', index, 'blockId'],
          `Missing flow block: ${location.blockId}`,
        )
      }
    } else if (location.kind === 'spatial-camera' && surface.type === 'spatial-2d') {
      if (!surface.camera.frames.some((frame) => frame.id === location.cameraFrameId)) {
        addPublishedSemanticIssue(
          context,
          ['locations', index, 'cameraFrameId'],
          `Missing camera frame: ${location.cameraFrameId}`,
        )
      }
    }
  })

  const guardIds = new Set<string>()
  published.navigationGuards.forEach((guard, index) => {
    if (guardIds.has(guard.id)) {
      addPublishedSemanticIssue(context, ['navigationGuards', index, 'id'], 'Navigation guard ids must be unique')
    }
    guardIds.add(guard.id)
    ;[...(guard.fromLocationIds ?? []), ...guard.toLocationIds].forEach((locationId) => {
      if (!locationsById.has(locationId)) {
        addPublishedSemanticIssue(
          context,
          ['navigationGuards', index],
          `Navigation guard references missing location: ${locationId}`,
        )
      }
    })
    guard.conditions.forEach((condition, conditionIndex) => {
      checkCourseStateReference(condition, ['navigationGuards', index, 'conditions', conditionIndex])
    })
  })

  if (published.surfaces.length > 1 && !published.mixedPrintPlan) {
    addPublishedSemanticIssue(context, ['mixedPrintPlan'], 'A mixed project requires an explicit print plan')
  }
  if (published.surfaces.length === 1 && published.mixedPrintPlan) {
    addPublishedSemanticIssue(context, ['mixedPrintPlan'], 'A single-surface project cannot declare a mixed print plan')
  }
  if (published.mixedPrintPlan) {
    const entryIds = new Set<string>()
    const coveredSurfaceIds = new Set<string>()
    published.mixedPrintPlan.entries.forEach((entry, index) => {
      if (entryIds.has(entry.id)) {
        addPublishedSemanticIssue(context, ['mixedPrintPlan', 'entries', index, 'id'], 'Print entry ids must be unique')
      }
      entryIds.add(entry.id)
      if (coveredSurfaceIds.has(entry.surfaceId)) {
        addPublishedSemanticIssue(
          context,
          ['mixedPrintPlan', 'entries', index, 'surfaceId'],
          'Every surface may appear only once in a print plan',
        )
      }
      coveredSurfaceIds.add(entry.surfaceId)
      const surface = surfacesById.get(entry.surfaceId)
      if (!surface || (
        (entry.kind === 'slide-scenes' && surface.type !== 'slide')
        || (entry.kind === 'flow-document' && surface.type !== 'flow')
        || (entry.kind === 'spatial-frames' && surface.type !== 'spatial-2d')
      )) {
        addPublishedSemanticIssue(
          context,
          ['mixedPrintPlan', 'entries', index, 'surfaceId'],
          'Print entry surface is missing or has the wrong type',
        )
        return
      }
      if (entry.kind === 'slide-scenes' && surface.type === 'slide') {
        const ids = new Set(surface.scenes.map((scene) => scene.id))
        entry.sceneIds.forEach((id) => {
          if (!ids.has(id)) {
            addPublishedSemanticIssue(
              context,
              ['mixedPrintPlan', 'entries', index, 'sceneIds'],
              `Missing print scene: ${id}`,
            )
          }
        })
      }
      if (entry.kind === 'spatial-frames' && surface.type === 'spatial-2d') {
        const ids = new Set(surface.camera.frames.map((frame) => frame.id))
        entry.cameraFrameIds.forEach((id) => {
          if (!ids.has(id)) {
            addPublishedSemanticIssue(
              context,
              ['mixedPrintPlan', 'entries', index, 'cameraFrameIds'],
              `Missing print camera frame: ${id}`,
            )
          }
        })
      }
    })
    published.surfaces.forEach((surface) => {
      if (!coveredSurfaceIds.has(surface.id)) {
        addPublishedSemanticIssue(
          context,
          ['mixedPrintPlan', 'entries'],
          `Print plan omits surface: ${surface.id}`,
        )
      }
    })
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
  designTokens: courseProjectDesignTokensSchema,
  media: courseProjectMediaSettingsSchema,
  playback: courseProjectPlaybackSettingsSchema,
  courseState: z.array(courseStateDeclarationSchema).max(10_000),
  navigationGuards: z.array(courseNavigationGuardSchema).max(10_000),
  locations: z.array(courseLocationSchema).min(1).max(100_000),
  startLocationId: stableIdSchema,
  globalLayerItems: publishedGlobalLayerEntryListSchema,
  globalInteractions: strictCourseInteractionsSchema,
  surfaces: z.array(publishedCourseSurfaceSchema).min(1).max(10_000),
  mixedPrintPlan: mixedPrintPlanSchema.optional(),
}).strict().superRefine(validatePublishedCourseSemantics)

const _publishedCourseSchemaTypeContract: z.ZodType<PublishedCourseV2Payload> = publishedCourseV2Schema
void _publishedCourseSchemaTypeContract
