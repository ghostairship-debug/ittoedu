import { z } from 'zod'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_PROJECT_SCENES,
  MAX_SCENE_PRESENTATION_STATES,
  MAX_SCENE_NODES,
} from './constants'
import {
  SHAPE_TYPES,
  type FormulaAstNode,
  type ProjectDocument,
  type SceneNode,
} from './projectTypes'
import { sceneInteractionsSchema } from './interactionSchema'
import { applySceneNodeOverride } from './presentation'
import { runtimeDocumentSchema } from './runtimeSchema'
import { hasDeliveryVisibleTeacherController } from './teacherControllerConsistency'

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const finiteNumber = z.number().finite()
const positiveSize = finiteNumber.min(16)
const unitInterval = finiteNumber.min(0).max(1)

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

const baseNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  x: finiteNumber,
  y: finiteNumber,
  width: positiveSize,
  height: positiveSize,
  visible: z.boolean(),
  rotation: finiteNumber.min(-36000).max(36000),
  opacity: unitInterval,
  locked: z.boolean(),
})

const componentReferenceSchema = z.object({
  packageId: z.string().min(1),
  version: z.string().min(1),
})

const assetMetaSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  path: z.string().min(1).refine((path) => !/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(path), {
    message: '素材路径必须是相对路径',
  }),
  byteLength: z.number().int().nonnegative(),
  width: finiteNumber.positive().optional(),
  height: finiteNumber.positive().optional(),
  kind: z.enum(['image', 'audio', 'video']),
  duration: finiteNumber.nonnegative().optional(),
})

const embeddedComponentPackageMetaSchema = z.object({
  packageId: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  manifestPath: z.string().min(1),
  runtimePath: z.string().min(1),
  thumbnailPath: z.string().min(1).optional(),
  contentSha256: z.string().regex(
    /^[0-9a-f]{64}$/,
    '组件内容哈希必须是小写 SHA-256',
  ),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, '组件包哈希必须是小写 SHA-256').optional(),
  importedAt: z.string().datetime().optional(),
  sourceLabel: z.string().min(1).max(200).optional(),
  editableCopy: z.boolean().optional(),
  sourcePackageId: z.string().min(1).optional(),
}).superRefine((metadata, context) => {
  const provenanceValues = [metadata.sha256, metadata.importedAt, metadata.sourceLabel]
  const presentCount = provenanceValues.filter((value) => value !== undefined).length
  if (presentCount > 0 && presentCount < provenanceValues.length) {
    context.addIssue({
      code: 'custom',
      path: ['sha256'],
      message: '组件来源元数据必须同时包含 sha256、importedAt 和 sourceLabel',
    })
  }
})

const textRunStyleSchema = z.object({
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

const textNodeCoreSchema = baseNodeSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  runs: z.array(z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    style: textRunStyleSchema,
  })).max(10_000),
  style: z.object({
    fontFamily: z.string().min(1),
    fontSize: finiteNumber.min(8).max(400),
    color: colorSchema,
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean(),
    strike: z.boolean(),
    emphasis: z.boolean().default(false),
    highlightColor: colorSchema.nullable(),
    align: z.enum(['left', 'center', 'right']),
    verticalAlign: z.enum(['top', 'middle', 'bottom']),
    writingMode: z.enum(['horizontal', 'vertical-rl', 'vertical-lr']),
    lineSpacing: finiteNumber.min(0).max(200),
    letterSpacing: finiteNumber.min(-20).max(100),
    padding: finiteNumber.min(0).max(200),
    overflow: z.enum(['auto-height', 'fixed', 'shrink']),
    backgroundColor: colorSchema,
    backgroundOpacity: unitInterval,
    cornerRadius: finiteNumber.min(0).max(500),
  }),
}).superRefine((node, context) => {
  const characterCount = Array.from(node.text).length
  for (const [index, run] of node.runs.entries()) {
    if (run.end <= run.start || run.end > characterCount) {
      context.addIssue({
        code: 'custom',
        path: ['runs', index],
        message: '富文本范围必须位于文字内容内且结束位置大于开始位置',
      })
    }
  }
})

const formulaAstNodeSchema: z.ZodType<FormulaAstNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('row'),
      children: z.array(formulaAstNodeSchema).min(1).max(128),
    }).strict(),
    z.object({
      type: z.literal('token'),
      value: z.string().min(1).max(128),
    }).strict(),
    z.object({
      type: z.literal('operator'),
      value: z.string().min(1).max(16),
    }).strict(),
    z.object({
      type: z.literal('fraction'),
      numerator: formulaAstNodeSchema,
      denominator: formulaAstNodeSchema,
    }).strict(),
    z.object({
      type: z.literal('root'),
      radicand: formulaAstNodeSchema,
      index: formulaAstNodeSchema.optional(),
    }).strict(),
    z.object({
      type: z.literal('script'),
      base: formulaAstNodeSchema,
      superscript: formulaAstNodeSchema.optional(),
      subscript: formulaAstNodeSchema.optional(),
    }).strict(),
    z.object({
      type: z.literal('fenced'),
      open: z.string().min(1).max(4),
      close: z.string().min(1).max(4),
      body: formulaAstNodeSchema,
    }).strict(),
  ]),
) as z.ZodType<FormulaAstNode>

function formulaAstComplexity(root: FormulaAstNode): {
  nodes: number
  depth: number
  emptyScript: boolean
} {
  const pending: Array<{ node: FormulaAstNode; depth: number }> = [{ node: root, depth: 1 }]
  let nodes = 0
  let depth = 0
  let emptyScript = false
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    depth = Math.max(depth, current.depth)
    const push = (...children: Array<FormulaAstNode | undefined>): void => {
      children.forEach((child) => {
        if (child) pending.push({ node: child, depth: current.depth + 1 })
      })
    }
    switch (current.node.type) {
      case 'row': push(...current.node.children); break
      case 'fraction': push(current.node.numerator, current.node.denominator); break
      case 'root': push(current.node.radicand, current.node.index); break
      case 'script':
        if (!current.node.superscript && !current.node.subscript) emptyScript = true
        push(current.node.base, current.node.superscript, current.node.subscript)
        break
      case 'fenced': push(current.node.body); break
      case 'token':
      case 'operator':
        break
    }
  }
  return { nodes, depth, emptyScript }
}

export const formulaAstSchema: z.ZodType<FormulaAstNode> = formulaAstNodeSchema
  .superRefine((ast, context) => {
    const complexity = formulaAstComplexity(ast)
    if (complexity.nodes > 512) {
      context.addIssue({
        code: 'custom',
        message: '公式 AST 最多包含 512 个节点',
      })
    }
    if (complexity.depth > 24) {
      context.addIssue({
        code: 'custom',
        message: '公式 AST 递归深度最多为 24 层',
      })
    }
    if (complexity.emptyScript) {
      context.addIssue({
        code: 'custom',
        message: 'script 必须包含 superscript 或 subscript',
      })
    }
  })

const formulaNodeCoreSchema = baseNodeSchema.extend({
  type: z.literal('formula'),
  formulaId: z.string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Formula ID 只能包含字母、数字、点、下划线、冒号和连字符'),
  accessibleText: z.string().trim().min(1).max(1_000),
  ast: formulaAstSchema,
  style: z.object({
    fontSize: finiteNumber.min(12).max(200),
    color: colorSchema,
    align: z.enum(['left', 'center', 'right']),
  }).strict(),
})

const imageNodeCoreSchema = baseNodeSchema.extend({
  type: z.literal('image'),
  assetId: z.string().min(1),
  preserveAspectRatio: z.boolean(),
  fit: z.enum(['contain', 'cover', 'stretch']),
  crop: z.object({
    left: unitInterval,
    top: unitInterval,
    right: unitInterval,
    bottom: unitInterval,
  }).default({ left: 0, top: 0, right: 0, bottom: 0 }),
  cropX: unitInterval,
  cropY: unitInterval,
  flipX: z.boolean(),
  flipY: z.boolean(),
  cornerRadius: finiteNumber.min(0).max(500),
  feather: z.object({
    amount: finiteNumber.min(0).max(100),
    mode: z.enum(['rectangle', 'ellipse']),
  }),
  safeAreas: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(80),
    x: unitInterval,
    y: unitInterval,
    width: finiteNumber.positive().max(1),
    height: finiteNumber.positive().max(1),
  }).strict()).max(16).default([]),
}).superRefine((node, context) => {
  if (node.crop.left + node.crop.right >= 0.99) {
    context.addIssue({
      code: 'custom',
      path: ['crop'],
      message: '图片左右裁剪总量必须小于 99%',
    })
  }
  if (node.crop.top + node.crop.bottom >= 0.99) {
    context.addIssue({
      code: 'custom',
      path: ['crop'],
      message: '图片上下裁剪总量必须小于 99%',
    })
  }
  const safeAreaIds = new Set<string>()
  node.safeAreas.forEach((area, index) => {
    if (safeAreaIds.has(area.id)) {
      context.addIssue({
        code: 'custom',
        path: ['safeAreas', index, 'id'],
        message: '同一图片的安全区 ID 不能重复',
      })
    }
    safeAreaIds.add(area.id)
    if (area.x + area.width > 1.000001 || area.y + area.height > 1.000001) {
      context.addIssue({
        code: 'custom',
        path: ['safeAreas', index],
        message: '图片安全区必须完整位于图片节点内',
      })
    }
  })
})

const videoNodeCoreSchema = baseNodeSchema.extend({
  type: z.literal('video'),
  assetId: z.string().min(1),
  fit: z.enum(['contain', 'cover', 'stretch']),
  autoplay: z.boolean(),
  loop: z.boolean(),
  muted: z.boolean(),
  volume: unitInterval,
  playbackRate: finiteNumber.min(0.25).max(4),
  showControls: z.boolean(),
  clickToToggle: z.boolean(),
  startTime: finiteNumber.nonnegative(),
  endTime: finiteNumber.positive().nullable(),
  poster: z.object({
    mode: z.enum(['video-frame', 'image']),
    time: finiteNumber.nonnegative(),
    assetId: z.string().min(1).optional(),
  }),
  backgroundAudioMode: z.enum(['none', 'duck', 'pause', 'stop']),
}).superRefine((node, context) => {
  if (node.endTime !== null && node.endTime <= node.startTime) {
    context.addIssue({
      code: 'custom',
      path: ['endTime'],
      message: '视频结束时间必须大于开始时间',
    })
  }
  if (node.poster.mode === 'image' && !node.poster.assetId) {
    context.addIssue({
      code: 'custom',
      path: ['poster', 'assetId'],
      message: '图片封面必须引用图片素材',
    })
  }
})

const shapeNodeCoreSchema = baseNodeSchema.extend({
  type: z.literal('shape'),
  shapeType: z.enum(SHAPE_TYPES),
  style: z.object({
    fillColor: colorSchema,
    fillOpacity: unitInterval,
    borderColor: colorSchema,
    borderOpacity: unitInterval,
    borderWidth: finiteNumber.min(0).max(100),
    lineStyle: z.enum(['solid', 'dashed', 'dotted']),
    cornerRadius: finiteNumber.min(0).max(500),
    startArrow: z.enum(['none', 'triangle', 'stealth', 'circle', 'diamond']),
    endArrow: z.enum(['none', 'triangle', 'stealth', 'circle', 'diamond']),
  }),
})

const externalComponentNodeCoreSchema = baseNodeSchema.extend({
  type: z.literal('external-component'),
  component: componentReferenceSchema,
  props: z.record(z.string(), z.unknown()),
})

const playbackFieldsSchema = z.object({
  playbackInitialVisibility: z.enum(['inherit', 'hidden']),
})

export const textNodeSchema = textNodeCoreSchema.and(playbackFieldsSchema)
export const formulaNodeSchema = formulaNodeCoreSchema.and(playbackFieldsSchema)
export const imageNodeSchema = imageNodeCoreSchema.and(playbackFieldsSchema)
export const videoNodeSchema = videoNodeCoreSchema.and(playbackFieldsSchema)
export const shapeNodeSchema = shapeNodeCoreSchema.and(playbackFieldsSchema)
export const externalComponentNodeSchema = externalComponentNodeCoreSchema.and(
  playbackFieldsSchema,
)

const teacherControllerActionSchemas = [
  z.object({ type: z.literal('scene.previous') }).strict(),
  z.object({ type: z.literal('scene.next') }).strict(),
  z.object({ type: z.literal('scene.replay') }).strict(),
  z.object({ type: z.literal('course.restart') }).strict(),
  z.object({
    type: z.literal('scene.go'),
    sceneId: z.string().trim().min(1).max(200),
    targetStateId: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  z.object({ type: z.literal('audio.toggle-mute') }).strict(),
  z.object({ type: z.literal('player.fullscreen.toggle') }).strict(),
  z.object({ type: z.literal('scene.open-picker') }).strict(),
] as const

const teacherControllerActionSchema = z.discriminatedUnion(
  'type',
  teacherControllerActionSchemas,
)

export const teacherControllerNodeSchema = baseNodeSchema
  .and(playbackFieldsSchema)
  .and(z.object({
    type: z.literal('teacher-controller'),
    title: z.string().max(80),
    showSceneProgress: z.boolean(),
    compact: z.boolean(),
    collapsible: z.boolean(),
    defaultCollapsed: z.boolean(),
    buttons: z.array(z.object({
      id: z.string().trim().min(1).max(200),
      action: teacherControllerActionSchema,
      label: z.string().min(1).max(20),
      visible: z.boolean(),
    }).strict()).min(1).max(12).superRefine((buttons, context) => {
      const ids = buttons.map((button) => button.id)
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: '控制器按钮 ID 不能重复' })
      }
    }),
    style: z.object({
      backgroundColor: colorSchema,
      backgroundOpacity: unitInterval,
      accentColor: colorSchema,
      textColor: colorSchema,
      cornerRadius: finiteNumber.min(0).max(100),
    }),
    includeInStaticExports: z.boolean(),
  }))

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

const audioChannelVolumesSchema = z.object({
  music: unitInterval,
  narration: unitInterval,
  sfx: unitInterval,
  ui: unitInterval,
  video: unitInterval,
})

const projectMediaSettingsSchema = z.object({
  audio: z.object({
    defaultMuted: z.boolean(),
    masterVolume: unitInterval,
    channelVolumes: audioChannelVolumesSchema,
    sounds: z.record(z.string(), z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(120),
      assetId: z.string().min(1),
      channel: z.enum(['music', 'narration', 'sfx', 'ui']),
      defaultVolume: unitInterval,
      defaultLoop: z.boolean(),
    })),
    narrationDucking: z.object({
      enabled: z.boolean(),
      musicVolume: unitInterval,
      fadeMs: finiteNumber.min(0).max(10_000),
    }),
  }),
})

const designTokenIdSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9._-]*$/, 'Token ID 必须以小写字母开头，并只含小写字母、数字、点、横线或下划线')

const projectDesignTokensSchema = z.object({
  fonts: z.array(z.object({
    id: designTokenIdSchema,
    label: z.string().trim().min(1).max(80),
    fontFamily: z.string().trim().min(1).max(300),
  }).strict()).max(16),
  colors: z.array(z.object({
    id: designTokenIdSchema,
    label: z.string().trim().min(1).max(80),
    color: colorSchema,
  }).strict()).max(32),
}).strict().superRefine((tokens, context) => {
  ;(['fonts', 'colors'] as const).forEach((kind) => {
    const ids = new Set<string>()
    tokens[kind].forEach((token, index) => {
      if (ids.has(token.id)) {
        context.addIssue({
          code: 'custom',
          path: [kind, index, 'id'],
          message: '同类设计 Token 的 ID 不能重复',
        })
      }
      ids.add(token.id)
    })
  })
}).default({
  fonts: [{
    id: 'body',
    label: '正文',
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
  }],
  colors: [
    { id: 'background', label: '背景', color: '#ffffff' },
    { id: 'text', label: '正文', color: '#1f2937' },
    { id: 'accent', label: '强调', color: '#2563eb' },
  ],
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

const presenterKeyBindingSchema = z.object({
  id: z.string().trim().min(1).max(200),
  command: z.enum(['next', 'previous']),
  key: z.string().min(1).max(64),
  altKey: z.boolean(),
  ctrlKey: z.boolean(),
  shiftKey: z.boolean(),
  metaKey: z.boolean(),
}).strict()

const projectPresenterSettingsSchema = z.object({
  enabled: z.boolean(),
  strategy: z.enum(['scene-navigation', 'authored-command']),
  additionalBindings: z.array(presenterKeyBindingSchema).max(32),
}).strict().superRefine((presenter, context) => {
  const ids = presenter.additionalBindings.map((binding) => binding.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: 'custom',
      path: ['additionalBindings'],
      message: '翻页笔附加按键 ID 不能重复',
    })
  }

  const signatures = new Map<string, number>()
  presenter.additionalBindings.forEach((binding, index) => {
    const isUnmodifiedStandardBinding =
      (binding.key === 'PageDown' || binding.key === 'PageUp') &&
      !binding.altKey &&
      !binding.ctrlKey &&
      !binding.shiftKey &&
      !binding.metaKey
    if (isUnmodifiedStandardBinding) {
      context.addIssue({
        code: 'custom',
        path: ['additionalBindings', index, 'key'],
        message: 'PageDown/PageUp 是内建标准绑定，不能作为附加按键重复配置',
      })
    }
    const signature = [
      binding.key,
      binding.altKey,
      binding.ctrlKey,
      binding.shiftKey,
      binding.metaKey,
    ].join('\0')
    const existingIndex = signatures.get(signature)
    if (existingIndex !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['additionalBindings', index],
        message: `翻页笔附加按键与第 ${existingIndex + 1} 项重复`,
      })
    } else {
      signatures.set(signature, index)
    }
  })
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
  playback: z.object({
    controls: z.enum(['canvas', 'none']),
    keyboardNavigation: z.boolean(),
    presenter: projectPresenterSettingsSchema,
  }).strict(),
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
