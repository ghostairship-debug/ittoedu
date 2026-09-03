import { z } from 'zod'
import {
  COMPONENT_RENDER_MODES,
  COMPONENT_SCOPES,
  type EmbeddedComponentPackageMeta,
} from './types'

const componentIdSchema = z
  .string()
  .min(3)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i, '组件 ID 格式无效')

const localIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i, '标识符格式无效')

const propPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/,
    '属性路径必须是安全的点分路径',
  )
  .refine(
    (path) => !path.split('.').some((part) =>
      part === '__proto__' || part === 'prototype' || part === 'constructor'),
    '属性路径包含不安全字段',
  )

const forbiddenContentKeys = new Set(['__proto__', 'prototype', 'constructor'])

function validateContentPathKeys(
  value: unknown,
  path: PropertyKey[],
  context: z.RefinementCtx,
  visited = new WeakSet<object>(),
): void {
  if (typeof value !== 'object' || value === null || visited.has(value)) return
  visited.add(value)
  Object.entries(value).forEach(([key, nested]) => {
    if (
      !Array.isArray(value) &&
      (key.length === 0 || key.includes('.') || forbiddenContentKeys.has(key))
    ) {
      context.addIssue({
        code: 'custom',
        path: [...path, key],
        message: 'content 文案键不能为空、包含点号或使用不安全字段名',
      })
      return
    }
    validateContentPathKeys(nested, [...path, key], context, visited)
  })
}

const manifestBaseSchema = z.object({
  id: componentIdSchema,
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, '组件版本必须使用语义化版本'),
  description: z.string().max(500).optional(),
  entry: z.string().min(1),
  thumbnail: z.string().min(1).optional(),
  defaultSize: z.object({
    width: z.number().finite().min(16),
    height: z.number().finite().min(16),
  }),
  minSize: z.object({
    width: z.number().finite().min(16),
    height: z.number().finite().min(16),
  }),
  preserveAspectRatio: z.boolean(),
  assets: z.record(z.string(), z.string()),
  defaultProps: z.record(z.string(), z.unknown()),
})

const editorPropertyBaseSchema = z.object({
  key: propPathSchema,
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
})

export const componentEditorPropertySchema = z.discriminatedUnion('type', [
  editorPropertyBaseSchema.extend({
    type: z.literal('text'),
    placeholder: z.string().max(500).optional(),
    maxLength: z.number().int().positive().max(100_000).optional(),
  }),
  editorPropertyBaseSchema.extend({
    type: z.literal('textarea'),
    placeholder: z.string().max(500).optional(),
    maxLength: z.number().int().positive().max(100_000).optional(),
  }),
  editorPropertyBaseSchema.extend({
    type: z.literal('number'),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    unit: z.string().max(20).optional(),
  }),
  editorPropertyBaseSchema.extend({ type: z.literal('boolean') }),
  editorPropertyBaseSchema.extend({ type: z.literal('color') }),
  editorPropertyBaseSchema.extend({
    type: z.literal('select'),
    options: z.array(z.object({
      value: z.string().max(500),
      label: z.string().min(1).max(100),
    })).min(1).max(200),
  }),
  editorPropertyBaseSchema.extend({ type: z.literal('image') }),
])

const componentEditorSchema = z.object({
  properties: z.array(componentEditorPropertySchema).max(500),
  pages: z.array(z.object({
    id: localIdSchema,
    label: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    propertyKeys: z.array(propPathSchema).max(500),
  })).min(1).max(100).optional(),
  defaultPageId: localIdSchema.optional(),
  previewPageProp: propPathSchema.optional(),
})

const componentVariantSchema = z.object({
  id: localIdSchema,
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  props: z.record(z.string(), z.unknown()),
})

const componentPresetSchema = z.object({
  id: localIdSchema,
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  variantId: localIdSchema.optional(),
  props: z.record(z.string(), z.unknown()),
  previewPageId: localIdSchema.optional(),
})

const configurableManifestSchema = manifestBaseSchema.extend({
  editor: componentEditorSchema.optional(),
  variants: z.array(componentVariantSchema).max(100).optional(),
  presets: z.array(componentPresetSchema).max(100).optional(),
})

const supportedScopesSchema = z.array(z.enum(COMPONENT_SCOPES))
  .min(1, '组件必须声明至少一个支持的作用域')
  .max(2)
  .refine((scopes) => new Set(scopes).size === scopes.length, '组件作用域不能重复')

type ConfigurableManifestInput = z.infer<typeof configurableManifestSchema>

function validateConfigurableManifest(
  manifest: ConfigurableManifestInput,
  context: z.RefinementCtx,
): void {
  const unique = (
    values: Array<{ id: string }>,
    path: 'variants' | 'presets',
  ) => {
    const seen = new Set<string>()
    values.forEach((value, index) => {
      if (seen.has(value.id)) {
        context.addIssue({
          code: 'custom',
          path: [path, index, 'id'],
          message: '标识符不能重复',
        })
      }
      seen.add(value.id)
    })
  }

  unique(manifest.variants ?? [], 'variants')
  unique(manifest.presets ?? [], 'presets')

  const variantIds = new Set((manifest.variants ?? []).map((variant) => variant.id))
  const pageIds = new Set(manifest.editor?.pages?.map((page) => page.id) ?? [])
  const propertyKeys = new Set<string>()

  manifest.editor?.properties.forEach((property, index) => {
    if (propertyKeys.has(property.key)) {
      context.addIssue({
        code: 'custom',
        path: ['editor', 'properties', index, 'key'],
        message: '可编辑属性路径不能重复',
      })
    }
    propertyKeys.add(property.key)

    if (property.type === 'number' &&
      property.min !== undefined &&
      property.max !== undefined &&
      property.min > property.max) {
      context.addIssue({
        code: 'custom',
        path: ['editor', 'properties', index, 'min'],
        message: '最小值不能大于最大值',
      })
    }
    if (property.type === 'select') {
      const optionValues = new Set<string>()
      property.options.forEach((option, optionIndex) => {
        if (optionValues.has(option.value)) {
          context.addIssue({
            code: 'custom',
            path: ['editor', 'properties', index, 'options', optionIndex, 'value'],
            message: '选项值不能重复',
          })
        }
        optionValues.add(option.value)
      })
    }
  })

  if (manifest.editor?.pages) {
    if (!manifest.editor.previewPageProp) {
      context.addIssue({
        code: 'custom',
        path: ['editor', 'previewPageProp'],
        message: '声明内部页面时必须提供 previewPageProp',
      })
    }
    const seenPages = new Set<string>()
    manifest.editor.pages.forEach((page, pageIndex) => {
      if (seenPages.has(page.id)) {
        context.addIssue({
          code: 'custom',
          path: ['editor', 'pages', pageIndex, 'id'],
          message: '页面标识符不能重复',
        })
      }
      seenPages.add(page.id)
      page.propertyKeys.forEach((key, keyIndex) => {
        if (!propertyKeys.has(key)) {
          context.addIssue({
            code: 'custom',
            path: ['editor', 'pages', pageIndex, 'propertyKeys', keyIndex],
            message: '页面引用了未声明的可编辑属性',
          })
        }
      })
    })
    if (manifest.editor.defaultPageId && !pageIds.has(manifest.editor.defaultPageId)) {
      context.addIssue({
        code: 'custom',
        path: ['editor', 'defaultPageId'],
        message: '默认页面不存在',
      })
    }
  }

  manifest.presets?.forEach((preset, index) => {
    if (preset.variantId && !variantIds.has(preset.variantId)) {
      context.addIssue({
        code: 'custom',
        path: ['presets', index, 'variantId'],
        message: '预设引用的变体不存在',
      })
    }
    if (preset.previewPageId && !pageIds.has(preset.previewPageId)) {
      context.addIssue({
        code: 'custom',
        path: ['presets', index, 'previewPageId'],
        message: '预设引用的编辑预览页面不存在',
      })
    }
  })
}

function validateRecursiveContentManifest(
  manifest: ConfigurableManifestInput,
  context: z.RefinementCtx,
): void {
  validateContentPathKeys(
    manifest.defaultProps.content,
    ['defaultProps', 'content'],
    context,
  )
  manifest.variants?.forEach((variant, index) => {
    validateContentPathKeys(
      variant.props.content,
      ['variants', index, 'props', 'content'],
      context,
    )
  })
  manifest.presets?.forEach((preset, index) => {
    validateContentPathKeys(
      preset.props.content,
      ['presets', index, 'props', 'content'],
      context,
    )
  })
  manifest.editor?.properties.forEach((property, index) => {
    if (
      (property.key === 'content' || property.key.startsWith('content.')) &&
      property.type !== 'text' &&
      property.type !== 'textarea'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editor', 'properties', index, 'type'],
        message: '组件的 content 文案只能使用 text 或 textarea 编辑器字段',
      })
    }
  })
}

export const componentManifestV4Schema = configurableManifestSchema.extend({
  schemaVersion: z.literal(4),
  runtimeApiVersion: z.literal(4),
  supportedScopes: supportedScopesSchema,
  renderMode: z.enum(COMPONENT_RENDER_MODES),
}).superRefine((manifest, context) => {
  validateConfigurableManifest(manifest, context)
  validateRecursiveContentManifest(manifest, context)
})

export const componentManifestSchema = componentManifestV4Schema

export const embeddedComponentPackageMetaSchema = z.object({
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
}).strict().superRefine((metadata, context) => {
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

const courseProjectStableIdSchema = z.string().trim().min(1).max(240)
const courseProjectPortablePathSchema = z.string().min(1).refine(
  (value) => !/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(value),
  'Path must be project-relative',
)

/** Exact Course Project V9 embedded component metadata profile. */
export const courseProjectEmbeddedComponentPackageMetaSchema: z.ZodType<EmbeddedComponentPackageMeta> = z.object({
  packageId: courseProjectStableIdSchema,
  version: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(500),
  manifestPath: courseProjectPortablePathSchema,
  runtimePath: courseProjectPortablePathSchema,
  thumbnailPath: courseProjectPortablePathSchema.optional(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  importedAt: z.string().datetime().optional(),
  sourceLabel: z.string().trim().min(1).max(200).optional(),
  editableCopy: z.boolean().optional(),
  sourcePackageId: courseProjectStableIdSchema.optional(),
}).strict().superRefine((metadata, context) => {
  const provenance = [metadata.sha256, metadata.importedAt, metadata.sourceLabel]
  const present = provenance.filter((value) => value !== undefined).length
  if (present > 0 && present < provenance.length) {
    context.addIssue({
      code: 'custom',
      path: ['sha256'],
      message: 'Component provenance must include sha256, importedAt and sourceLabel together',
    })
  }
})
