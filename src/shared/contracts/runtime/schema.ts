import { z } from 'zod'
import { RUNTIME_API_VERSION } from '../../constants'
import { lightEditTextOverridesSchema } from './lightEdit'
import {
  RUNTIME_RENDER_MODES,
  type RuntimeDocument,
} from './types'

export const MAX_RUNTIME_SOURCE_BYTES = 2 * 1024 * 1024
export const MAX_RUNTIME_CONTENT_ENTRIES = 10_000
export const MAX_RUNTIME_ASSET_BINDINGS = 10_000
export const MAX_RUNTIME_NODE_BINDINGS = 10_000

const safeRecordKeySchema = z
  .string()
  .min(1, '键名不能为空')
  .max(200, '键名不能超过 200 个字符')
  .refine((key) => key.trim().length > 0, '键名不能为空')
  .refine(
    (key) => !key.split('.').some((part) =>
      part === '__proto__' || part === 'prototype' || part === 'constructor'),
    '键名包含不安全字段',
  )

const assetIdSchema = z
  .string()
  .min(1, '素材 ID 不能为空')
  .max(500, '素材 ID 不能超过 500 个字符')
  .refine((value) => value.trim().length > 0, '素材 ID 不能为空')

const nodeIdSchema = z
  .string()
  .min(1, '节点 ID 不能为空')
  .max(500, '节点 ID 不能超过 500 个字符')
  .refine((value) => value.trim().length > 0, '节点 ID 不能为空')

export const editableTextMetadataSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  multiline: z.boolean().optional(),
  maxLength: z.number().int().positive().max(1_000_000).optional(),
}).strict()

export const editableTextContentSchema = z.object({
  values: z.record(safeRecordKeySchema, z.string()),
  metadata: z.record(safeRecordKeySchema, editableTextMetadataSchema).optional(),
  overrides: lightEditTextOverridesSchema.optional(),
}).strict().superRefine((content, context) => {
  const valueKeys = Object.keys(content.values)
  if (valueKeys.length > MAX_RUNTIME_CONTENT_ENTRIES) {
    context.addIssue({
      code: 'custom',
      path: ['values'],
      message: `可编辑文字不能超过 ${MAX_RUNTIME_CONTENT_ENTRIES} 项`,
    })
  }

  const metadataKeys = Object.keys(content.metadata ?? {})
  if (metadataKeys.length > MAX_RUNTIME_CONTENT_ENTRIES) {
    context.addIssue({
      code: 'custom',
      path: ['metadata'],
      message: `文字元数据不能超过 ${MAX_RUNTIME_CONTENT_ENTRIES} 项`,
    })
  }

  const knownKeys = new Set(valueKeys)
  metadataKeys.forEach((key) => {
    if (!knownKeys.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', key],
        message: '文字元数据引用了不存在的内容键',
      })
    }
  })
})

export const runtimeAssetBindingSchema = z.object({
  assetId: assetIdSchema,
}).strict()

export const runtimeStaticFallbackSchema = z.object({
  assetId: assetIdSchema,
  coverage: z.enum(['runtime-layer', 'full-scene']),
  layer: z.enum(['underlay', 'overlay']),
}).strict()

const runtimeSourceSchema = z
  .string()
  .refine((source) => source.trim().length > 0, '运行时源码不能为空')
  .refine(
    (source) => new TextEncoder().encode(source).byteLength <= MAX_RUNTIME_SOURCE_BYTES,
    `运行时源码不能超过 ${MAX_RUNTIME_SOURCE_BYTES} 字节（2 MiB）`,
  )

const runtimeDocumentBaseShape = {
  enabled: z.boolean(),
  renderMode: z.enum(RUNTIME_RENDER_MODES),
  source: runtimeSourceSchema,
  content: editableTextContentSchema,
  assets: z.record(safeRecordKeySchema, runtimeAssetBindingSchema),
  nodeBindings: z.record(safeRecordKeySchema, nodeIdSchema).optional(),
  staticFallback: runtimeStaticFallbackSchema.optional(),
} as const

function validateRuntimeLimits(
  runtime: Pick<RuntimeDocument, 'assets' | 'nodeBindings'>,
  context: z.RefinementCtx,
): void {
  if (Object.keys(runtime.assets).length > MAX_RUNTIME_ASSET_BINDINGS) {
    context.addIssue({
      code: 'custom',
      path: ['assets'],
      message: `运行时素材绑定不能超过 ${MAX_RUNTIME_ASSET_BINDINGS} 项`,
    })
  }
  if (Object.keys(runtime.nodeBindings ?? {}).length > MAX_RUNTIME_NODE_BINDINGS) {
    context.addIssue({
      code: 'custom',
      path: ['nodeBindings'],
      message: `运行时节点绑定不能超过 ${MAX_RUNTIME_NODE_BINDINGS} 项`,
    })
  }
}

export const runtimeDocumentSchema = z.object({
  runtimeApiVersion: z.literal(RUNTIME_API_VERSION),
  ...runtimeDocumentBaseShape,
}).strict().superRefine(validateRuntimeLimits) satisfies z.ZodType<RuntimeDocument>
