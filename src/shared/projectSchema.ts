import { z } from 'zod'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_PROJECT_SCENES,
  MAX_SCENE_PRESENTATION_STATES,
  MAX_SCENE_NODES,
} from './constants'
import {
  type SceneNode,
} from './projectTypes'
import { sceneInteractionsSchema } from './interactionSchema'
import { applySceneNodeOverride } from './presentation'
import { runtimeDocumentSchema } from './runtimeSchema'
import { hasDeliveryVisibleTeacherController } from './teacherControllerConsistency'
import {
  nativeRenderableBaseSchema,
  formulaNodeSchema,
  imageNodeSchema,
  shapeNodeSchema,
  teacherControllerNodeSchema,
  textNodeSchema,
  videoNodeSchema,
} from './contracts/native-v1/schema'
import { assetMetaSchema, projectMediaSettingsSchema } from './contracts/media-v1/schema'
import { projectDesignTokensSchema } from './contracts/design-v1/schema'
import { projectPlaybackSettingsSchema } from './contracts/playback-v1/schema'
import { embeddedComponentPackageMetaSchema } from './contracts/component-v4/schema'

export { formulaAstSchema } from './contracts/native-v1/schema'

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Zod objects intentionally strip unknown fields. State overrides must instead
 * reject them, otherwise a field for another node type would survive in the
 * authored override while being invisible to schema validation.
 */
function findUnsupportedNodeOverridePath(
  baseNode: SceneNode,
  override: Record<string, unknown>,
): string | undefined {
  const visit = (
    base: unknown,
    current: unknown,
    path: string[],
  ): string | undefined => {
    if (!isPlainRecord(current) || !isPlainRecord(base)) return undefined
    // Component props are an author-defined record and may introduce keys that
    // are not present in defaultProps.
    if (baseNode.type === 'external-component' && path[0] === 'props') {
      return undefined
    }
    // Formula AST branches are discriminated recursive records. A state may
    // replace one valid branch with another (for example row -> token), so
    // field compatibility must be checked by formulaAstSchema after merge.
    if (baseNode.type === 'formula' && path[0] === 'ast') {
      return undefined
    }
    for (const [key, value] of Object.entries(current)) {
      if (!Object.prototype.hasOwnProperty.call(base, key)) {
        return [...path, key].join('.')
      }
      const nested = visit(base[key], value, [...path, key])
      if (nested) return nested
    }
    return undefined
  }
  return visit(baseNode, override, [])
}

function findFieldStrippedByNodeSchema(
  input: unknown,
  parsed: unknown,
  path: Array<string | number> = [],
): string | undefined {
  if (Array.isArray(input)) {
    if (!Array.isArray(parsed)) return undefined
    for (const [index, value] of input.entries()) {
      const nested = findFieldStrippedByNodeSchema(
        value,
        parsed[index],
        [...path, index],
      )
      if (nested) return nested
    }
    return undefined
  }
  if (!isPlainRecord(input) || !isPlainRecord(parsed)) return undefined
  for (const [key, value] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      return [...path, key].join('.')
    }
    const nested = findFieldStrippedByNodeSchema(
      value,
      parsed[key],
      [...path, key],
    )
    if (nested) return nested
  }
  return undefined
}

const componentReferenceSchema = z.object({
  packageId: z.string().min(1),
  version: z.string().min(1),
})

const playbackFieldsSchema = z.object({
  playbackInitialVisibility: z.enum(['inherit', 'hidden']),
})

const externalComponentNodeCoreSchema = nativeRenderableBaseSchema.extend({
  type: z.literal('external-component'),
  component: componentReferenceSchema,
  props: z.record(z.string(), z.unknown()),
})

export {
  textNodeSchema,
  formulaNodeSchema,
  imageNodeSchema,
  videoNodeSchema,
  shapeNodeSchema,
  teacherControllerNodeSchema,
} from './contracts/native-v1/schema'

export const externalComponentNodeSchema = externalComponentNodeCoreSchema.and(
  playbackFieldsSchema,
)

export const sceneNodeSchema = z.union([
  textNodeSchema,
  formulaNodeSchema,
  imageNodeSchema,
  videoNodeSchema,
  shapeNodeSchema,
  teacherControllerNodeSchema,
  externalComponentNodeSchema,
])

const sceneNodeOverrideSchema = z.record(z.string(), z.unknown()).superRefine(
  (override, context) => {
    if ('id' in override || 'type' in override || 'component' in override) {
      context.addIssue({
        code: 'custom',
        message: '状态覆盖不能修改节点 id、type 或组件包引用',
      })
    }
  },
)

export const scenePresentationStateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  backgroundColor: colorSchema.optional(),
  backgroundAssetId: z.string().min(1).nullable().optional(),
  nodeOverrides: z.record(z.string().min(1), sceneNodeOverrideSchema),
  nodeOrder: z.array(z.string().min(1)).max(MAX_SCENE_NODES).optional(),
})

export const scenePresentationSchema = z.object({
  initialStateId: z.string().min(1),
  thumbnailStateId: z.string().min(1).optional(),
  states: z.array(scenePresentationStateSchema)
    .min(1)
    .max(MAX_SCENE_PRESENTATION_STATES),
}).superRefine((presentation, context) => {
  const stateIds = presentation.states.map((state) => state.id)
  if (new Set(stateIds).size !== stateIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['states'],
      message: '同一场景中的状态 ID 不能重复',
    })
  }
  if (!stateIds.includes(presentation.initialStateId)) {
    context.addIssue({
      code: 'custom',
      path: ['initialStateId'],
      message: '初始状态必须引用当前场景中的状态',
    })
  }
  if (
    presentation.thumbnailStateId !== undefined &&
    !stateIds.includes(presentation.thumbnailStateId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['thumbnailStateId'],
      message: '缩略图状态必须引用当前场景中的状态',
    })
  }
})

export const globalLayerVisibilitySchema = z.object({
  mode: z.enum(['all', 'include', 'exclude']),
  sceneIds: z.array(z.string().min(1)).max(MAX_PROJECT_SCENES),
}).superRefine((visibility, context) => {
  if (visibility.mode !== 'all' && visibility.sceneIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['sceneIds'],
      message: '按场景控制全局元素时至少需要一个场景 ID',
    })
  }
  if (new Set(visibility.sceneIds).size !== visibility.sceneIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['sceneIds'],
      message: '全局元素的场景 ID 不能重复',
    })
  }
})

export const globalLayerItemSchema = z.object({
  node: sceneNodeSchema,
  layer: z.enum(['underlay', 'overlay']),
  visibility: globalLayerVisibilitySchema,
})

export const sceneDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  backgroundColor: colorSchema,
  backgroundAssetId: z.string().min(1).nullable().optional(),
  nodes: z.array(sceneNodeSchema).max(MAX_SCENE_NODES),
  presentation: scenePresentationSchema.optional(),
  runtime: runtimeDocumentSchema.optional(),
  interactions: sceneInteractionsSchema,
}).superRefine((scene, context) => {
  const nodeIds = scene.nodes.map((node) => node.id)
  if (new Set(nodeIds).size !== nodeIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['nodes'],
      message: '同一场景中的节点 ID 不能重复',
    })
  }
  const ruleIds = scene.interactions.map((rule) => rule.id)
  if (new Set(ruleIds).size !== ruleIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['interactions'],
      message: '同一场景中的交互规则 ID 不能重复',
    })
  }
  if (!scene.presentation) return
  const nodesById = new Map(scene.nodes.map((node) => [node.id, node]))
  for (const [stateIndex, state] of scene.presentation.states.entries()) {
    if (state.nodeOrder) {
      if (new Set(state.nodeOrder).size !== state.nodeOrder.length) {
        context.addIssue({
          code: 'custom',
          path: ['presentation', 'states', stateIndex, 'nodeOrder'],
          message: '状态节点层级不能包含重复 ID',
        })
      }
      for (const nodeId of state.nodeOrder) {
        if (!nodesById.has(nodeId)) {
          context.addIssue({
            code: 'custom',
            path: ['presentation', 'states', stateIndex, 'nodeOrder'],
            message: `状态节点层级引用了不存在的节点：${nodeId}`,
          })
        }
      }
    }
    for (const [nodeId, override] of Object.entries(state.nodeOverrides)) {
      const baseNode = nodesById.get(nodeId)
      if (!baseNode) {
        context.addIssue({
          code: 'custom',
          path: ['presentation', 'states', stateIndex, 'nodeOverrides', nodeId],
          message: `状态覆盖引用了不存在的节点：${nodeId}`,
        })
        continue
      }
      const unsupportedPath = findUnsupportedNodeOverridePath(baseNode, override)
      if (unsupportedPath) {
        context.addIssue({
          code: 'custom',
          path: ['presentation', 'states', stateIndex, 'nodeOverrides', nodeId],
          message: `状态覆盖包含不适用于该节点的字段：${unsupportedPath}`,
        })
        continue
      }
      const materializedNode = applySceneNodeOverride(baseNode as SceneNode, override)
      const result = sceneNodeSchema.safeParse(materializedNode)
      if (!result.success) {
        context.addIssue({
          code: 'custom',
          path: ['presentation', 'states', stateIndex, 'nodeOverrides', nodeId],
          message: `状态覆盖生成了无效节点：${result.error.issues[0]?.message ?? nodeId}`,
        })
      } else {
        const strippedPath = findFieldStrippedByNodeSchema(materializedNode, result.data)
        if (strippedPath) {
          context.addIssue({
            code: 'custom',
            path: ['presentation', 'states', stateIndex, 'nodeOverrides', nodeId],
            message: `状态覆盖包含未知字段：${strippedPath}`,
          })
        }
      }
    }
  }
})

export const projectDocumentSchema = z.object({
  schemaVersion: z.literal(8),
  id: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  canvas: z.object({
    width: z.literal(CANVAS_WIDTH),
    height: z.literal(CANVAS_HEIGHT),
  }),
  scenes: z.array(sceneDocumentSchema).min(1).max(MAX_PROJECT_SCENES),
  assets: z.record(z.string(), assetMetaSchema),
  componentPackages: z.record(z.string(), embeddedComponentPackageMetaSchema),
  globalRuntime: runtimeDocumentSchema.optional(),
  globalLayer: z.array(globalLayerItemSchema).max(MAX_SCENE_NODES),
  globalInteractions: sceneInteractionsSchema,
  designTokens: projectDesignTokensSchema,
  media: projectMediaSettingsSchema,
  playback: projectPlaybackSettingsSchema,
}).strict().superRefine((project, context) => {
  const ruleIds = project.globalInteractions.map((rule) => rule.id)
  if (new Set(ruleIds).size !== ruleIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['globalInteractions'],
      message: '全局交互规则 ID 不能重复',
    })
  }
  const hasVisibleController = hasDeliveryVisibleTeacherController(project)
  if (project.playback.controls === 'canvas' && !hasVisibleController) {
    context.addIssue({
      code: 'custom',
      path: ['playback', 'controls'],
      message: '画布控制模式必须至少有一个交付时可见的全局教师控制器',
    })
  }
  if (project.playback.controls === 'none' && hasVisibleController) {
    context.addIssue({
      code: 'custom',
      path: ['playback', 'controls'],
      message: '不显示控制器时不能保留交付时可见的全局教师控制器',
    })
  }
})
