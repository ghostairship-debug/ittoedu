import { z } from 'zod'

import { SHAPE_TYPES, type FormulaAstNode } from './types'

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const finiteNumber = z.number().finite()
const positiveSize = finiteNumber.min(16)
const unitInterval = finiteNumber.min(0).max(1)

export const nativeRenderableBaseSchema = z.object({
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

const textNodeCoreSchema = nativeRenderableBaseSchema.extend({
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

const formulaNodeCoreSchema = nativeRenderableBaseSchema.extend({
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

const imageNodeCoreSchema = nativeRenderableBaseSchema.extend({
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

const videoNodeCoreSchema = nativeRenderableBaseSchema.extend({
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

const shapeNodeCoreSchema = nativeRenderableBaseSchema.extend({
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

const playbackFieldsSchema = z.object({
  playbackInitialVisibility: z.enum(['inherit', 'hidden']),
})

export const textNodeSchema = textNodeCoreSchema.and(playbackFieldsSchema)
export const formulaNodeSchema = formulaNodeCoreSchema.and(playbackFieldsSchema)
export const imageNodeSchema = imageNodeCoreSchema.and(playbackFieldsSchema)
export const videoNodeSchema = videoNodeCoreSchema.and(playbackFieldsSchema)
export const shapeNodeSchema = shapeNodeCoreSchema.and(playbackFieldsSchema)

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

export const teacherControllerNodeSchema = nativeRenderableBaseSchema
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

export const nativeRenderableNodeSchema = z.union([
  textNodeSchema,
  formulaNodeSchema,
  imageNodeSchema,
  videoNodeSchema,
  shapeNodeSchema,
  teacherControllerNodeSchema,
])

export const NATIVE_RENDERABLE_BASE_KEYS = [
  'id',
  'name',
  'type',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'playbackInitialVisibility',
] as const

const nativeRenderableBaseKeySet = new Set<string>(NATIVE_RENDERABLE_BASE_KEYS)

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

function nativeContentSchema<T>(
  nativeType: string,
  schema: z.ZodType<T>,
): z.ZodType<T> {
  return z.unknown().transform((input, context) => {
    if (!isPlainRecord(input)) {
      context.addIssue({ code: 'custom', message: 'Native data must be an object' })
      return z.NEVER
    }
    const forbiddenKey = Object.keys(input).find((key) => nativeRenderableBaseKeySet.has(key))
    if (forbiddenKey) {
      context.addIssue({
        code: 'custom',
        message: `Native data cannot shadow layer field: ${forbiddenKey}`,
      })
      return z.NEVER
    }
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        message: `Invalid ${nativeType} native data: ${parsed.error.issues[0]?.message}`,
      })
      return z.NEVER
    }
    const unknownPath = findUnknownInputPath(input, parsed.data)
    if (unknownPath) {
      context.addIssue({
        code: 'custom',
        message: `${nativeType} native data contains an unknown field: ${unknownPath}`,
      })
      return z.NEVER
    }
    return parsed.data
  }) as z.ZodType<T>
}

const textNativeContentObjectSchema = z.object({
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

const formulaNativeContentObjectSchema = z.object({
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

const imageNativeContentObjectSchema = z.object({
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

const videoNativeContentObjectSchema = z.object({
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

const shapeNativeContentObjectSchema = z.object({
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

const teacherControllerNativeContentObjectSchema = z.object({
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
})

export const textNativeContentSchema = nativeContentSchema('text', textNativeContentObjectSchema)
export const formulaNativeContentSchema = nativeContentSchema('formula', formulaNativeContentObjectSchema)
export const imageNativeContentSchema = nativeContentSchema('image', imageNativeContentObjectSchema)
export const videoNativeContentSchema = nativeContentSchema('video', videoNativeContentObjectSchema)
export const shapeNativeContentSchema = nativeContentSchema('shape', shapeNativeContentObjectSchema)
export const teacherControllerNativeContentSchema = nativeContentSchema(
  'teacher-controller',
  teacherControllerNativeContentObjectSchema,
)

export const nativeContentSchemaByType = {
  text: textNativeContentSchema,
  formula: formulaNativeContentSchema,
  image: imageNativeContentSchema,
  video: videoNativeContentSchema,
  shape: shapeNativeContentSchema,
  'teacher-controller': teacherControllerNativeContentSchema,
} as const
