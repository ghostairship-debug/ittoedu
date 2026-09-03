import { z } from 'zod'
import { sceneInteractionsSchema } from '../interaction-v1/schema'
import {
  courseStateConditionSchema,
  courseStateDeclarationSchema,
} from '../course-state/schema'
import { courseStateScalarType } from '../course-state/types'
export { courseStateDeclarationSchema } from '../course-state/schema'
import { formulaAstSchema, nativeContentSchemaByType, NATIVE_RENDERABLE_BASE_KEYS } from '../native-v1/schema'
import type { NativeRenderInput } from '../native-v1/types'
import { courseProjectEmbeddedComponentPackageMetaSchema } from '../component-v4/schema'
import { courseProjectDesignTokensSchema } from '../design-v1/schema'
import {
  courseProjectAssetMetaSchema,
  courseProjectMediaSettingsSchema,
} from '../media-v1/schema'
import { courseProjectPlaybackSettingsSchema } from '../playback-v1/schema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  FLOW_BODY_LAYER_PLANES,
  GLOBAL_LAYER_PLANES,
  type GlobalLayerEntry,
  type CourseProjectDocument,
  type CourseSurfaceDocument,
  type FlowBlock,
  type FlowSurfaceLayerEntry,
  type LayerItem,
  type NativeLayerItem,
  type MixedPrintEntry,
  type ScopedLayerItem,
} from './types'

const finiteNumber = z.number().finite()
const unitInterval = finiteNumber.min(0).max(1)
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const stableIdSchema = z.string().trim().min(1).max(240)

export {
  courseProjectDesignTokensSchema as courseDesignTokensSchema,
} from '../design-v1/schema'
export {
  courseProjectMediaSettingsSchema as courseMediaSchema,
} from '../media-v1/schema'
export {
  courseProjectPlaybackSettingsSchema as coursePlaybackSchema,
} from '../playback-v1/schema'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Applies a sparse Native content override without replacing nested records.
 * Authoring views and schema validation must share this exact merge contract.
 */
export function mergeCourseNativeData(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key]
    // Formula AST nodes are discriminated recursive values. Replacing a row
    // with a root/token must not retain fields from the former node shape.
    result[key] = !(depth === 0 && key === 'ast') &&
      isPlainRecord(value) && isPlainRecord(previous)
      ? mergeCourseNativeData(previous, value, depth + 1)
      : structuredClone(value)
  }
  return result
}

/** Finds fields silently stripped by an older permissive schema. */
function findUnknownInputPath(
  input: unknown,
  parsed: unknown,
  path: Array<string | number> = [],
): string | undefined {
  if (Array.isArray(input)) {
    if (!Array.isArray(parsed)) return undefined
    for (const [index, value] of input.entries()) {
      const nested = findUnknownInputPath(value, parsed[index], [...path, index])
      if (nested) return nested
    }
    return undefined
  }
  if (!isPlainRecord(input) || !isPlainRecord(parsed)) return undefined
  for (const [key, value] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      return [...path, key].join('.')
    }
    const nested = findUnknownInputPath(value, parsed[key], [...path, key])
    if (nested) return nested
  }
  return undefined
}

function strictExistingSchema<T>(schema: z.ZodType<T>, label: string): z.ZodType<T> {
  return z.unknown().transform((input, context) => {
    const result = schema.safeParse(input)
    if (!result.success) {
      context.addIssue({
        code: 'custom',
        message: `${label}: ${result.error.issues[0]?.message ?? 'invalid value'}`,
      })
      return z.NEVER
    }
    const unknownPath = findUnknownInputPath(input, result.data)
    if (unknownPath) {
      context.addIssue({
        code: 'custom',
        message: `${label} contains an unknown field: ${unknownPath}`,
      })
      return z.NEVER
    }
    return result.data
  }) as z.ZodType<T>
}

export const strictCourseInteractionsSchema = strictExistingSchema(
  sceneInteractionsSchema,
  'Interactions',
)

export const layerFrameSchema = z.object({
  mode: z.literal('absolute'),
  x: finiteNumber,
  y: finiteNumber,
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
}).strict()

const layerItemBaseFields = {
  layerItemId: stableIdSchema,
  label: z.string().trim().min(1).max(200),
  frame: layerFrameSchema,
  order: z.number().int().nonnegative(),
  visible: z.boolean(),
  locked: z.boolean(),
  rotation: finiteNumber.min(-36_000).max(36_000),
  opacity: unitInterval,
  hitPolicy: z.enum(['auto', 'surface', 'pass-through']),
  playbackInitialVisibility: z.enum(['inherit', 'hidden']),
  paperSpace: z.enum(['viewport', 'paper']).optional(),
} as const

const nativeBaseKeys = new Set<string>(NATIVE_RENDERABLE_BASE_KEYS)

export const nativeElementContentSchema = z.discriminatedUnion('nativeType', [
  z.object({
    nativeType: z.literal('text'),
    data: nativeContentSchemaByType.text,
  }).strict(),
  z.object({
    nativeType: z.literal('formula'),
    data: nativeContentSchemaByType.formula,
  }).strict(),
  z.object({
    nativeType: z.literal('image'),
    data: nativeContentSchemaByType.image,
  }).strict(),
  z.object({
    nativeType: z.literal('video'),
    data: nativeContentSchemaByType.video,
  }).strict(),
  z.object({
    nativeType: z.literal('shape'),
    data: nativeContentSchemaByType.shape,
  }).strict(),
  z.object({
    nativeType: z.literal('teacher-controller'),
    data: nativeContentSchemaByType['teacher-controller'],
  }).strict(),
])

const componentReferenceSchema = z.object({
  packageId: stableIdSchema,
  version: z.string().trim().min(1).max(100),
}).strict()

export const runtimeContentSchema = z.object({
  values: z.record(z.string(), z.string()),
  metadata: z.record(z.string(), z.object({
    label: z.string().max(200).optional(),
    description: z.string().max(1_000).optional(),
    multiline: z.boolean().optional(),
    maxLength: z.number().int().positive().max(1_000_000).optional(),
  }).strict()).optional(),
}).strict()

export const courseRuntimeDefinitionSchema = z.object({
  protocol: z.enum(['canvas-runtime', 'surface-runtime']),
  runtimeApiVersion: z.union([z.literal(2), z.literal(3)]),
  enabled: z.boolean(),
  renderMode: z.enum(['phaser', 'dom', 'hybrid']),
  source: z.string().trim().min(1).refine(
    (source) => new TextEncoder().encode(source).byteLength <= 2 * 1024 * 1024,
    'Runtime source cannot exceed 2 MiB of UTF-8',
  ),
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

const nativeLayerItemSchema = z.object({
  ...layerItemBaseFields,
  kind: z.literal('native'),
  content: nativeElementContentSchema,
}).strict()

const componentLayerItemSchema = z.object({
  ...layerItemBaseFields,
  kind: z.literal('component'),
  component: componentReferenceSchema,
  props: z.record(z.string(), z.unknown()),
  staticFallbackAssetId: stableIdSchema.optional(),
}).strict()

const runtimeLayerItemSchema = z.object({
  ...layerItemBaseFields,
  kind: z.literal('runtime'),
  runtime: courseRuntimeDefinitionSchema,
}).strict()

export const layerItemSchema: z.ZodType<LayerItem> = z.discriminatedUnion('kind', [
  nativeLayerItemSchema,
  componentLayerItemSchema,
  runtimeLayerItemSchema,
])

export function materializeNativeLayerItem(
  item: NativeLayerItem,
): NativeRenderInput {
  const layout = {
    id: item.layerItemId,
    name: item.label,
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
    opacity: item.opacity,
    visible: item.visible,
    locked: item.locked,
    playbackInitialVisibility: item.playbackInitialVisibility,
  } as const
  switch (item.content.nativeType) {
    case 'text':
      return { ...item.content.data, ...layout, type: 'text' }
    case 'formula':
      return { ...item.content.data, ...layout, type: 'formula' }
    case 'image':
      return { ...item.content.data, ...layout, type: 'image' }
    case 'video':
      return { ...item.content.data, ...layout, type: 'video' }
    case 'shape':
      return { ...item.content.data, ...layout, type: 'shape' }
    case 'teacher-controller':
      return { ...item.content.data, ...layout, type: 'teacher-controller' }
  }
}

export function addCanonicalLayerOrderIssues(
  items: ReadonlyArray<{ layerItemId: string; order: number }>,
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>()
  let previousOrder = -1
  items.forEach((item, index) => {
    if (ids.has(item.layerItemId)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'layerItemId'],
        message: `Duplicate layer item id: ${item.layerItemId}`,
      })
    }
    ids.add(item.layerItemId)
    if (item.order <= previousOrder) {
      context.addIssue({
        code: 'custom',
        path: [index, 'order'],
        message: `Layer items must be stored in strictly increasing unified order; ${item.order} follows ${previousOrder}`,
      })
    }
    previousOrder = item.order
  })
}

export const layerItemListSchema = z.array(layerItemSchema).max(20_000)
  .superRefine(addCanonicalLayerOrderIssues)

export const locationVisibilitySchema = z.object({
  mode: z.enum(['all', 'include', 'exclude']),
  locationIds: z.array(stableIdSchema).max(20_000),
}).strict().superRefine((visibility, context) => {
  if (visibility.mode !== 'all' && visibility.locationIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['locationIds'],
      message: 'Include/exclude visibility requires at least one location',
    })
  }
  if (new Set(visibility.locationIds).size !== visibility.locationIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['locationIds'],
      message: 'Visibility location ids must be unique',
    })
  }
})

export const scopedLayerItemSchema: z.ZodType<ScopedLayerItem> = z.object({
  item: layerItemSchema,
  visibility: locationVisibilitySchema,
}).strict()

export const scopedLayerItemListSchema = z.array(scopedLayerItemSchema).max(20_000)
  .superRefine((entries, context) => {
    addCanonicalLayerOrderIssues(entries.map((entry) => entry.item), context)
  })

export const flowBodyLayerPlaneSchema = z.enum(FLOW_BODY_LAYER_PLANES)

export const flowSurfaceLayerEntrySchema: z.ZodType<FlowSurfaceLayerEntry> = z.object({
  item: layerItemSchema,
  visibility: locationVisibilitySchema,
  bodyPlane: flowBodyLayerPlaneSchema.optional(),
}).strict()

export const flowSurfaceLayerEntryListSchema = z.array(flowSurfaceLayerEntrySchema).max(20_000)
  .superRefine((entries, context) => {
    addCanonicalLayerOrderIssues(entries.map((entry) => entry.item), context)
  })

export const globalLayerPlaneSchema = z.enum(GLOBAL_LAYER_PLANES)

export const globalLayerEntrySchema: z.ZodType<GlobalLayerEntry> = z.object({
  item: layerItemSchema,
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

export const globalLayerEntryListSchema = z.array(globalLayerEntrySchema).max(20_000)
  .superRefine((entries, context) => {
    addCanonicalLayerOrderIssues(entries.map((entry) => entry.item), context)
  })

export const layerItemOverrideSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  frame: z.object({
    mode: z.literal('absolute').optional(),
    x: finiteNumber.optional(),
    y: finiteNumber.optional(),
    width: finiteNumber.positive().optional(),
    height: finiteNumber.positive().optional(),
  }).strict().optional(),
  order: z.number().int().nonnegative().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  rotation: finiteNumber.min(-36_000).max(36_000).optional(),
  opacity: unitInterval.optional(),
  hitPolicy: z.enum(['auto', 'surface', 'pass-through']).optional(),
  playbackInitialVisibility: z.enum(['inherit', 'hidden']).optional(),
  nativeData: z.record(z.string(), z.unknown()).optional(),
  componentProps: z.record(z.string(), z.unknown()).optional(),
}).strict()

const slidePresentationStateSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).optional(),
  backgroundColor: colorSchema.optional(),
  backgroundAssetId: stableIdSchema.nullable().optional(),
  layerItemOverrides: z.record(z.string(), layerItemOverrideSchema),
  layerItemOrder: z.array(stableIdSchema).max(20_000).optional(),
}).strict()

const slidePresentationSchema = z.object({
  initialStateId: stableIdSchema,
  thumbnailStateId: stableIdSchema.optional(),
  states: z.array(slidePresentationStateSchema).min(1).max(1_000),
}).strict().superRefine((presentation, context) => {
  const ids = presentation.states.map((state) => state.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['states'], message: 'State ids must be unique' })
  }
  if (!ids.includes(presentation.initialStateId)) {
    context.addIssue({
      code: 'custom',
      path: ['initialStateId'],
      message: 'Initial state does not exist',
    })
  }
  if (presentation.thumbnailStateId && !ids.includes(presentation.thumbnailStateId)) {
    context.addIssue({
      code: 'custom',
      path: ['thumbnailStateId'],
      message: 'Thumbnail state does not exist',
    })
  }
})

export const slideSceneSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(200),
  backgroundColor: colorSchema,
  backgroundAssetId: stableIdSchema.nullable().optional(),
  layerItems: layerItemListSchema,
  presentation: slidePresentationSchema.optional(),
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

const flowBlockBaseFields = { id: stableIdSchema } as const

/** Same fields as V8 `TextRun` / `TextRunStyle`; types stay in projectTypes. */
const flowTextRunStyleSchema = z.object({
  color: colorSchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  emphasis: z.boolean().optional(),
  highlightColor: colorSchema.nullable().optional(),
  fontFamily: z.string().trim().min(1).max(300).optional(),
  fontSize: finiteNumber.min(8).max(400).optional(),
})

const flowTextRunSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  style: flowTextRunStyleSchema,
}).strict()

const flowTextRunListSchema = z.array(flowTextRunSchema).max(10_000)

function addFlowRunRangeIssues(
  text: string,
  runs: Array<{ start: number; end: number }> | undefined,
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  if (!runs) return
  const characterCount = Array.from(text).length
  runs.forEach((run, index) => {
    if (run.end <= run.start || run.end > characterCount) {
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: '富文本范围必须位于文字内容内且结束位置大于开始位置',
      })
    }
  })
}

const flowRichTextFields = {
  text: z.string(),
  runs: flowTextRunListSchema.optional(),
} as const

const flowTableCellObjectSchema = z.object({
  text: z.string(),
  runs: flowTextRunListSchema.optional(),
}).strict()

const flowTableCellSchema = z.union([z.string(), flowTableCellObjectSchema])

const flowHeadingBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('heading'),
  level: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6),
  ]),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  lineSpacing: finiteNumber.min(0).max(200).optional(),
  ...flowRichTextFields,
}).strict().superRefine((block, context) => {
  addFlowRunRangeIssues(block.text, block.runs, context, ['runs'])
})

const flowParagraphBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('paragraph'),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  lineSpacing: finiteNumber.min(0).max(200).optional(),
  ...flowRichTextFields,
}).strict().superRefine((block, context) => {
  addFlowRunRangeIssues(block.text, block.runs, context, ['runs'])
})

const flowListBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(z.object({
    id: stableIdSchema,
    text: z.string(),
    runs: flowTextRunListSchema.optional(),
  }).strict()).min(1).max(10_000),
}).strict().superRefine((block, context) => {
  const ids = block.items.map((item) => item.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'List item ids must be unique' })
  }
  block.items.forEach((item, itemIndex) => {
    addFlowRunRangeIssues(item.text, item.runs, context, ['items', itemIndex, 'runs'])
  })
})

const flowQuoteBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('quote'),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  lineSpacing: finiteNumber.min(0).max(200).optional(),
  ...flowRichTextFields,
  citation: z.string().max(1_000).optional(),
}).strict().superRefine((block, context) => {
  addFlowRunRangeIssues(block.text, block.runs, context, ['runs'])
})

const flowDividerBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('divider'),
}).strict()

const flowMediaBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('media'),
  assetId: stableIdSchema,
  mediaKind: z.enum(['image', 'audio', 'video']),
  altText: z.string().max(4_000).optional(),
  caption: z.string().max(4_000).optional(),
  layout: z.enum(['content-width', 'wide', 'full-width']),
  wrap: z.enum(['none', 'left', 'right']).optional(),
}).strict()

const flowTableBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('table'),
  caption: z.string().max(4_000).optional(),
  columns: z.array(z.object({
    id: stableIdSchema,
    header: z.string(),
  }).strict()).min(1).max(256),
  rows: z.array(z.object({
    id: stableIdSchema,
    cells: z.record(z.string(), flowTableCellSchema),
  }).strict()).max(100_000),
}).strict().superRefine((block, context) => {
  const columnIds = block.columns.map((column) => column.id)
  if (new Set(columnIds).size !== columnIds.length) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'Column ids must be unique' })
  }
  const rowIds = block.rows.map((row) => row.id)
  if (new Set(rowIds).size !== rowIds.length) {
    context.addIssue({ code: 'custom', path: ['rows'], message: 'Row ids must be unique' })
  }
  const expected = new Set(columnIds)
  block.rows.forEach((row, rowIndex) => {
    const cellIds = Object.keys(row.cells)
    if (cellIds.length !== expected.size || cellIds.some((id) => !expected.has(id))) {
      context.addIssue({
        code: 'custom',
        path: ['rows', rowIndex, 'cells'],
        message: 'Every table row must contain exactly one cell for every column',
      })
    }
    for (const [columnId, cell] of Object.entries(row.cells)) {
      if (typeof cell === 'string') continue
      addFlowRunRangeIssues(
        cell.text,
        cell.runs,
        context,
        ['rows', rowIndex, 'cells', columnId, 'runs'],
      )
    }
  })
})

const flowFormulaBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('formula'),
  formulaId: stableIdSchema,
  accessibleText: z.string().trim().min(1).max(4_000),
  ast: formulaAstSchema,
}).strict()

const flowCodeBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('code'),
  language: z.string().trim().min(1).max(100).optional(),
  code: z.string().max(5_000_000),
}).strict()

const flowCalloutBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('callout'),
  tone: z.enum(['note', 'example', 'warning', 'conclusion']),
  title: z.string().max(500).optional(),
  body: z.string(),
}).strict()

const flowComponentBlockSchema = z.object({
  ...flowBlockBaseFields,
  type: z.literal('component'),
  component: componentReferenceSchema,
  props: z.record(z.string(), z.unknown()),
  staticFallbackAssetId: stableIdSchema,
  wrap: z.enum(['none', 'left', 'right']).optional(),
}).strict()

export const flowBlockSchema: z.ZodType<FlowBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    flowHeadingBlockSchema,
    flowParagraphBlockSchema,
    flowListBlockSchema,
    flowQuoteBlockSchema,
    flowDividerBlockSchema,
    flowMediaBlockSchema,
    flowTableBlockSchema,
    flowFormulaBlockSchema,
    flowCodeBlockSchema,
    flowCalloutBlockSchema,
    z.object({
      ...flowBlockBaseFields,
      type: z.literal('section'),
      title: z.string().trim().min(1).max(500),
      collapsedByDefault: z.boolean(),
      blocks: z.array(flowBlockSchema).max(100_000),
    }).strict(),
    flowComponentBlockSchema,
  ]),
)

export const spatialCameraPoseSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  zoom: finiteNumber.positive().max(1_000),
}).strict()

export const spatialCameraFrameSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(200),
  x: finiteNumber,
  y: finiteNumber,
  zoom: finiteNumber.positive().max(1_000),
}).strict()

const spatialPathStyleSchema = z.object({
  color: colorSchema.optional(),
  width: finiteNumber.positive().max(10_000).optional(),
  dash: z.enum(['solid', 'dashed', 'dotted']).optional(),
}).strict()

export const spatialPathDocumentSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(200),
  layerItemIds: z.array(stableIdSchema).min(1).max(20_000),
  style: spatialPathStyleSchema.optional(),
}).strict()

export const spatialRelationDocumentSchema = z.object({
  id: stableIdSchema,
  sourceLayerItemId: stableIdSchema,
  targetLayerItemId: stableIdSchema,
  label: z.string().trim().min(1).max(500).optional(),
  kind: z.enum(['line', 'arrow', 'bidirectional']),
}).strict()

const surfaceBaseFields = {
  id: stableIdSchema,
  title: z.string().trim().min(1).max(500),
  surfaceLayerItems: scopedLayerItemListSchema,
} as const

const slideSurfaceSchema = z.object({
  ...surfaceBaseFields,
  type: z.literal('slide'),
  canvas: z.object({ width: z.literal(1280), height: z.literal(720) }).strict(),
  scenes: z.array(slideSceneSchema).min(1).max(10_000),
}).strict().superRefine((surface, context) => {
  const ids = surface.scenes.map((scene) => scene.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['scenes'], message: 'Scene ids must be unique' })
  }
})

const flowSurfaceSchema = z.object({
  id: surfaceBaseFields.id,
  title: surfaceBaseFields.title,
  surfaceLayerItems: flowSurfaceLayerEntryListSchema,
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

const spatialSurfaceSchema = z.object({
  ...surfaceBaseFields,
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
    layerItems: layerItemListSchema,
    paths: z.array(spatialPathDocumentSchema).max(10_000).default([]),
    relations: z.array(spatialRelationDocumentSchema).max(10_000).default([]),
  }).strict(),
  camera: z.object({
    home: spatialCameraPoseSchema,
    frames: z.array(spatialCameraFrameSchema).max(10_000),
  }).strict(),
  semanticZoom: z.array(z.object({
    id: stableIdSchema,
    layerItemIds: z.array(stableIdSchema).min(1).max(20_000),
    minZoom: finiteNumber.nonnegative(),
    maxZoom: finiteNumber.positive(),
    visible: z.boolean(),
  }).strict()).max(10_000),
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

export const courseSurfaceSchema: z.ZodType<CourseSurfaceDocument> = z.discriminatedUnion('type', [
  slideSurfaceSchema,
  flowSurfaceSchema,
  spatialSurfaceSchema,
])

/**
 * Normalized exact network origin: `https:`/`wss:` only, no wildcard, no
 * userinfo, no path/query/fragment. Requiring the string to equal its URL
 * `origin` enforces lowercase scheme/host and forbids default-port spelling.
 */
export const courseConnectOriginSchema = z.string().trim().min(1).max(300).refine(
  (value) => {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' && url.protocol !== 'wss:') return false
      if (url.username !== '' || url.password !== '') return false
      if (url.hostname.includes('*')) return false
      if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false
      return url.origin === value
    } catch {
      return false
    }
  },
  'Connect origin must be a normalized exact https/wss origin',
)

export const courseNetworkDeclarationSchema = z.object({
  connectOrigins: z.array(courseConnectOriginSchema).max(1_000).optional(),
}).strict().superRefine((network, context) => {
  const origins = network.connectOrigins ?? []
  if (new Set(origins).size !== origins.length) {
    context.addIssue({
      code: 'custom',
      path: ['connectOrigins'],
      message: 'Connect origins must be unique',
    })
  }
})

export const courseNavigationGuardSchema = z.object({
  id: stableIdSchema,
  effect: z.literal('block'),
  fromLocationIds: z.array(stableIdSchema).min(1).max(20_000).optional(),
  toLocationIds: z.array(stableIdSchema).min(1).max(20_000),
  match: z.enum(['all', 'any']),
  conditions: z.array(courseStateConditionSchema).min(1).max(64),
  message: z.string().trim().min(1).max(2_000),
}).strict()

export const courseLocationSchema = z.discriminatedUnion('kind', [
  z.object({
    id: stableIdSchema,
    label: z.string().trim().min(1).max(500),
    kind: z.literal('slide-scene'),
    surfaceId: stableIdSchema,
    sceneId: stableIdSchema,
    stateId: stableIdSchema.optional(),
  }).strict(),
  z.object({
    id: stableIdSchema,
    label: z.string().trim().min(1).max(500),
    kind: z.literal('flow-block'),
    surfaceId: stableIdSchema,
    blockId: stableIdSchema,
  }).strict(),
  z.object({
    id: stableIdSchema,
    label: z.string().trim().min(1).max(500),
    kind: z.literal('spatial-camera'),
    surfaceId: stableIdSchema,
    cameraFrameId: stableIdSchema,
  }).strict(),
])

const mixedPrintEntrySchema: z.ZodType<MixedPrintEntry> = z.discriminatedUnion('kind', [
  z.object({
    id: stableIdSchema,
    kind: z.literal('slide-scenes'),
    surfaceId: stableIdSchema,
    sceneIds: z.array(stableIdSchema).min(1).max(10_000),
  }).strict(),
  z.object({
    id: stableIdSchema,
    kind: z.literal('flow-document'),
    surfaceId: stableIdSchema,
  }).strict(),
  z.object({
    id: stableIdSchema,
    kind: z.literal('spatial-frames'),
    surfaceId: stableIdSchema,
    cameraFrameIds: z.array(stableIdSchema).min(1).max(10_000),
  }).strict(),
])

export const mixedPrintPlanSchema = z.object({
  pageSize: z.enum(['A4', 'letter', 'surface-native']),
  orientation: z.enum(['auto', 'portrait', 'landscape']),
  entries: z.array(mixedPrintEntrySchema).min(2).max(10_000),
}).strict()

function walkFlowBlocks(blocks: FlowBlock[], visit: (block: FlowBlock) => void): void {
  blocks.forEach((block) => {
    visit(block)
    if (block.type === 'section') walkFlowBlocks(block.blocks, visit)
  })
}

function addReferenceIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: 'custom', path, message })
}

export const courseProjectDocumentSchema = z.object({
  schemaVersion: z.literal(COURSE_PROJECT_SCHEMA_VERSION),
  id: stableIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(1).max(500),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assets: z.record(z.string(), courseProjectAssetMetaSchema),
  componentPackages: z.record(z.string(), courseProjectEmbeddedComponentPackageMetaSchema),
  network: courseNetworkDeclarationSchema.optional(),
  designTokens: courseProjectDesignTokensSchema,
  media: courseProjectMediaSettingsSchema,
  playback: courseProjectPlaybackSettingsSchema,
  courseState: z.array(courseStateDeclarationSchema).max(10_000),
  navigationGuards: z.array(courseNavigationGuardSchema).max(10_000),
  locations: z.array(courseLocationSchema).min(1).max(100_000),
  startLocationId: stableIdSchema,
  globalLayerItems: globalLayerEntryListSchema,
  globalInteractions: strictCourseInteractionsSchema,
  surfaces: z.array(courseSurfaceSchema).min(1).max(10_000),
  mixedPrintPlan: mixedPrintPlanSchema.optional(),
}).strict().superRefine((project, context) => {
  const assetIds = new Set(Object.keys(project.assets))
  Object.entries(project.assets).forEach(([key, asset]) => {
    if (asset.id !== key) addReferenceIssue(context, ['assets', key, 'id'], 'Asset record key must equal asset.id')
  })
  const componentKeys = new Set(Object.keys(project.componentPackages))
  Object.entries(project.componentPackages).forEach(([key, component]) => {
    if (component.packageId !== key) {
      addReferenceIssue(context, ['componentPackages', key, 'packageId'], 'Component record key must equal packageId')
    }
  })

  const stateByKey = new Map(project.courseState.map((state) => [state.key, state]))
  if (stateByKey.size !== project.courseState.length) {
    addReferenceIssue(context, ['courseState'], 'Course-state keys must be unique')
  }
  const locationsById = new Map(project.locations.map((location) => [location.id, location]))
  if (locationsById.size !== project.locations.length) {
    addReferenceIssue(context, ['locations'], 'Course location ids must be unique')
  }
  if (!locationsById.has(project.startLocationId)) {
    addReferenceIssue(context, ['startLocationId'], 'Start location does not exist')
  }
  const surfacesById = new Map(project.surfaces.map((surface) => [surface.id, surface]))
  if (surfacesById.size !== project.surfaces.length) {
    addReferenceIssue(context, ['surfaces'], 'Surface ids must be unique')
  }

  const checkAsset = (assetId: string | undefined, path: Array<string | number>): void => {
    if (assetId && !assetIds.has(assetId)) addReferenceIssue(context, path, `Missing asset: ${assetId}`)
  }
  const checkCourseStateReference = (
    reference: Readonly<{
      key: string
      value?: boolean | number | string | null
      operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
    }>,
    path: Array<string | number>,
  ): void => {
    const state = stateByKey.get(reference.key)
    if (!state) {
      addReferenceIssue(context, [...path, 'key'], `Missing course-state key: ${reference.key}`)
      return
    }
    if (!Object.hasOwn(reference, 'value')) return
    const valueType = courseStateScalarType(reference.value!)
    if (state.valueType !== valueType) {
      addReferenceIssue(
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
      addReferenceIssue(
        context,
        [...path, 'operator'],
        'Ordering comparisons require a number state',
      )
    }
  }
  const checkComponent = (
    reference: { packageId: string; version: string },
    path: Array<string | number>,
  ): void => {
    const component = project.componentPackages[reference.packageId]
    if (!component || component.version !== reference.version || !componentKeys.has(reference.packageId)) {
      addReferenceIssue(context, path, `Missing component package/version: ${reference.packageId}@${reference.version}`)
    }
  }
  const checkLayer = (item: LayerItem, path: Array<string | number>): void => {
    if (item.kind === 'component') {
      checkComponent(item.component, [...path, 'component'])
      checkAsset(item.staticFallbackAssetId, [...path, 'staticFallbackAssetId'])
    } else if (item.kind === 'runtime') {
      Object.values(item.runtime.assets).forEach((binding) => checkAsset(binding.assetId, [...path, 'runtime', 'assets']))
      checkAsset(item.runtime.staticFallback?.assetId, [...path, 'runtime', 'staticFallback', 'assetId'])
    } else if (item.content.nativeType === 'image') {
      checkAsset(item.content.data.assetId, [...path, 'content', 'data', 'assetId'])
    } else if (item.content.nativeType === 'video') {
      checkAsset(item.content.data.assetId, [...path, 'content', 'data', 'assetId'])
      checkAsset(item.content.data.poster.assetId, [...path, 'content', 'data', 'poster', 'assetId'])
    }
  }
  const checkScoped = (entry: ScopedLayerItem, path: Array<string | number>): void => {
    checkLayer(entry.item, [...path, 'item'])
    entry.visibility.locationIds.forEach((locationId) => {
      if (!locationsById.has(locationId)) addReferenceIssue(context, [...path, 'visibility', 'locationIds'], `Missing location: ${locationId}`)
    })
  }
  const checkEffectiveLayerIdentity = (
    items: readonly LayerItem[],
    path: Array<string | number>,
  ): void => {
    const ids = new Set<string>()
    items.forEach((item, index) => {
      if (ids.has(item.layerItemId)) {
        addReferenceIssue(context, [...path, index, 'layerItemId'], `Effective layer item id is duplicated: ${item.layerItemId}`)
      }
      ids.add(item.layerItemId)
    })
  }

  const knownLayerItemIds = new Set<string>()
  project.globalLayerItems.forEach((entry) => knownLayerItemIds.add(entry.item.layerItemId))
  project.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach((entry) => knownLayerItemIds.add(entry.item.layerItemId))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach((item) => knownLayerItemIds.add(item.layerItemId)))
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => knownLayerItemIds.add(item.layerItemId))
    }
  })
  const checkInteractionReferences = (
    interactions: typeof project.globalInteractions,
    path: Array<string | number>,
    localLayerItemIds?: ReadonlySet<string>,
  ): void => {
    interactions.forEach((rule, ruleIndex) => {
      const checkLayerItem = (itemId: string, referencePath: Array<string | number>): void => {
        const known = localLayerItemIds?.has(itemId) || knownLayerItemIds.has(itemId)
        if (!known) addReferenceIssue(context, referencePath, `Interaction references missing layer item: ${itemId}`)
      }
      const trigger = rule.trigger
      if ('nodeId' in trigger) checkLayerItem(trigger.nodeId, [...path, ruleIndex, 'trigger', 'nodeId'])
      if (trigger.type === 'audio.ended' && !project.media.audio.sounds[trigger.soundId]) {
        addReferenceIssue(context, [...path, ruleIndex, 'trigger', 'soundId'], `Interaction references missing sound: ${trigger.soundId}`)
      }
      rule.conditions.forEach((condition, conditionIndex) => {
        if (condition.type === 'scene.in') {
          const sceneIds = new Set(project.surfaces.flatMap((surface) =>
            surface.type === 'slide' ? surface.scenes.map((scene) => scene.id) : [],
          ))
          condition.sceneIds.forEach((sceneId) => {
            if (!sceneIds.has(sceneId)) addReferenceIssue(context, [...path, ruleIndex, 'conditions', conditionIndex], `Interaction references missing scene: ${sceneId}`)
          })
        } else if (
          condition.type === 'course-state.exists'
          || condition.type === 'course-state.compare'
        ) {
          checkCourseStateReference(
            condition,
            [...path, ruleIndex, 'conditions', conditionIndex],
          )
        }
      })
      rule.actions.forEach((step, stepIndex) => {
        const action = step.action
        const actionPath = [...path, ruleIndex, 'actions', stepIndex, 'action']
        if ('nodeId' in action) checkLayerItem(action.nodeId, [...actionPath, 'nodeId'])
        if (action.type === 'audio.play' && !project.media.audio.sounds[action.soundId]) {
          addReferenceIssue(context, [...actionPath, 'soundId'], `Interaction references missing sound: ${action.soundId}`)
        }
        if (
          (action.type === 'audio.pause' || action.type === 'audio.resume' || action.type === 'audio.stop' || action.type === 'audio.toggle-mute') &&
          action.target.kind === 'sound' &&
          !project.media.audio.sounds[action.target.soundId]
        ) {
          addReferenceIssue(context, [...actionPath, 'target', 'soundId'], `Interaction references missing sound: ${action.target.soundId}`)
        }
        if (action.type === 'course-state.set') {
          checkCourseStateReference(action, actionPath)
        }
      })
    })
  }

  project.globalLayerItems.forEach((entry, index) => checkScoped(entry, ['globalLayerItems', index]))
  checkInteractionReferences(project.globalInteractions, ['globalInteractions'])
  project.surfaces.forEach((surface, surfaceIndex) => {
    surface.surfaceLayerItems.forEach((entry, itemIndex) => checkScoped(entry, ['surfaces', surfaceIndex, 'surfaceLayerItems', itemIndex]))
    const sharedLayerItems = [
      ...project.globalLayerItems.map((entry) => entry.item),
      ...surface.surfaceLayerItems.map((entry) => entry.item),
    ]
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        checkEffectiveLayerIdentity(
          [...sharedLayerItems, ...scene.layerItems],
          ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'effectiveLayerItems'],
        )
        const sceneItemIds = new Set([
          ...project.globalLayerItems.map((entry) => entry.item.layerItemId),
          ...surface.surfaceLayerItems.map((entry) => entry.item.layerItemId),
          ...scene.layerItems.map((item) => item.layerItemId),
        ])
        checkInteractionReferences(
          scene.interactions,
          ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'interactions'],
          sceneItemIds,
        )
        checkAsset(scene.backgroundAssetId ?? undefined, ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'backgroundAssetId'])
        scene.layerItems.forEach((item, itemIndex) => checkLayer(item, ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'layerItems', itemIndex]))
        scene.presentation?.states.forEach((state, stateIndex) => {
          checkAsset(state.backgroundAssetId ?? undefined, ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'presentation', 'states', stateIndex, 'backgroundAssetId'])
        })
      })
    } else if (surface.type === 'flow') {
      checkEffectiveLayerIdentity(sharedLayerItems, ['surfaces', surfaceIndex, 'effectiveLayerItems'])
      walkFlowBlocks(surface.blocks, (block) => {
        if (block.type === 'media') checkAsset(block.assetId, ['surfaces', surfaceIndex, 'blocks', block.id, 'assetId'])
        if (block.type === 'component') {
          checkComponent(block.component, ['surfaces', surfaceIndex, 'blocks', block.id, 'component'])
          checkAsset(block.staticFallbackAssetId, ['surfaces', surfaceIndex, 'blocks', block.id, 'staticFallbackAssetId'])
        }
      })
    } else {
      checkEffectiveLayerIdentity(
        [...sharedLayerItems, ...surface.world.layerItems],
        ['surfaces', surfaceIndex, 'world', 'effectiveLayerItems'],
      )
      surface.world.layerItems.forEach((item, itemIndex) => checkLayer(item, ['surfaces', surfaceIndex, 'world', 'layerItems', itemIndex]))
    }
  })
  Object.values(project.media.audio.sounds).forEach((sound) => checkAsset(sound.assetId, ['media', 'audio', 'sounds', sound.id, 'assetId']))

  project.locations.forEach((location, index) => {
    const surface = surfacesById.get(location.surfaceId)
    if (!surface || (
      (location.kind === 'slide-scene' && surface.type !== 'slide') ||
      (location.kind === 'flow-block' && surface.type !== 'flow') ||
      (location.kind === 'spatial-camera' && surface.type !== 'spatial-2d')
    )) {
      addReferenceIssue(context, ['locations', index, 'surfaceId'], 'Location surface is missing or has the wrong type')
      return
    }
    if (location.kind === 'slide-scene' && surface.type === 'slide') {
      const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
      if (!scene) addReferenceIssue(context, ['locations', index, 'sceneId'], `Missing scene: ${location.sceneId}`)
      if (location.stateId && !scene?.presentation?.states.some((state) => state.id === location.stateId)) {
        addReferenceIssue(context, ['locations', index, 'stateId'], `Missing scene state: ${location.stateId}`)
      }
    } else if (location.kind === 'flow-block' && surface.type === 'flow') {
      let found = false
      walkFlowBlocks(surface.blocks, (block) => { if (block.id === location.blockId) found = true })
      if (!found) addReferenceIssue(context, ['locations', index, 'blockId'], `Missing flow block: ${location.blockId}`)
    } else if (location.kind === 'spatial-camera' && surface.type === 'spatial-2d') {
      if (!surface.camera.frames.some((frame) => frame.id === location.cameraFrameId)) {
        addReferenceIssue(context, ['locations', index, 'cameraFrameId'], `Missing camera frame: ${location.cameraFrameId}`)
      }
    }
  })

  const guardIds = new Set<string>()
  project.navigationGuards.forEach((guard, index) => {
    if (guardIds.has(guard.id)) addReferenceIssue(context, ['navigationGuards', index, 'id'], 'Navigation guard ids must be unique')
    guardIds.add(guard.id)
    ;[...(guard.fromLocationIds ?? []), ...guard.toLocationIds].forEach((locationId) => {
      if (!locationsById.has(locationId)) addReferenceIssue(context, ['navigationGuards', index], `Navigation guard references missing location: ${locationId}`)
    })
    guard.conditions.forEach((condition, conditionIndex) => {
      checkCourseStateReference(
        condition,
        ['navigationGuards', index, 'conditions', conditionIndex],
      )
    })
  })

  if (project.surfaces.length > 1 && !project.mixedPrintPlan) {
    addReferenceIssue(context, ['mixedPrintPlan'], 'A mixed project requires an explicit print plan')
  }
  if (project.surfaces.length === 1 && project.mixedPrintPlan) {
    addReferenceIssue(context, ['mixedPrintPlan'], 'A single-surface project cannot declare a mixed print plan')
  }
  if (project.mixedPrintPlan) {
    const entryIds = new Set<string>()
    const coveredSurfaceIds = new Set<string>()
    project.mixedPrintPlan.entries.forEach((entry, index) => {
      if (entryIds.has(entry.id)) addReferenceIssue(context, ['mixedPrintPlan', 'entries', index, 'id'], 'Print entry ids must be unique')
      entryIds.add(entry.id)
      if (coveredSurfaceIds.has(entry.surfaceId)) addReferenceIssue(context, ['mixedPrintPlan', 'entries', index, 'surfaceId'], 'Every surface may appear only once in a print plan')
      coveredSurfaceIds.add(entry.surfaceId)
      const surface = surfacesById.get(entry.surfaceId)
      if (!surface || (
        (entry.kind === 'slide-scenes' && surface.type !== 'slide') ||
        (entry.kind === 'flow-document' && surface.type !== 'flow') ||
        (entry.kind === 'spatial-frames' && surface.type !== 'spatial-2d')
      )) {
        addReferenceIssue(context, ['mixedPrintPlan', 'entries', index, 'surfaceId'], 'Print entry surface is missing or has the wrong type')
        return
      }
      if (entry.kind === 'slide-scenes' && surface.type === 'slide') {
        const ids = new Set(surface.scenes.map((scene) => scene.id))
        entry.sceneIds.forEach((id) => { if (!ids.has(id)) addReferenceIssue(context, ['mixedPrintPlan', 'entries', index, 'sceneIds'], `Missing print scene: ${id}`) })
      }
      if (entry.kind === 'spatial-frames' && surface.type === 'spatial-2d') {
        const ids = new Set(surface.camera.frames.map((frame) => frame.id))
        entry.cameraFrameIds.forEach((id) => { if (!ids.has(id)) addReferenceIssue(context, ['mixedPrintPlan', 'entries', index, 'cameraFrameIds'], `Missing print camera frame: ${id}`) })
      }
    })
    project.surfaces.forEach((surface) => {
      if (!coveredSurfaceIds.has(surface.id)) addReferenceIssue(context, ['mixedPrintPlan', 'entries'], `Print plan omits surface: ${surface.id}`)
    })
  }
})

const _courseProjectSchemaTypeContract: z.ZodType<CourseProjectDocument> = courseProjectDocumentSchema
void _courseProjectSchemaTypeContract
