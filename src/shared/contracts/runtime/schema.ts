import { z } from 'zod'
import { RUNTIME_API_VERSION } from '../../constants'
import { lightEditTextOverridesSchema } from './lightEdit'
import {
  RUNTIME_RENDER_MODES,
  type RuntimeDocument,
} from './types'

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
  maxLength: z.number().int().positive().optional(),
}).strict()

export const editableTextContentSchema = z.object({
  values: z.record(safeRecordKeySchema, z.string()),
  metadata: z.record(safeRecordKeySchema, editableTextMetadataSchema).optional(),
  overrides: lightEditTextOverridesSchema.optional(),
}).strict().superRefine((content, context) => {
  const valueKeys = Object.keys(content.values)
  const metadataKeys = Object.keys(content.metadata ?? {})

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

const runtimeDocumentBaseShape = {
  enabled: z.boolean(),
  renderMode: z.enum(RUNTIME_RENDER_MODES),
  source: runtimeSourceSchema,
  content: editableTextContentSchema,
  assets: z.record(safeRecordKeySchema, runtimeAssetBindingSchema),
  nodeBindings: z.record(safeRecordKeySchema, nodeIdSchema).optional(),
  staticFallback: runtimeStaticFallbackSchema.optional(),
} as const

export const runtimeDocumentSchema = z.object({
  runtimeApiVersion: z.literal(RUNTIME_API_VERSION),
  ...runtimeDocumentBaseShape,
}).strict() satisfies z.ZodType<RuntimeDocument>
