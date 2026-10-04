import { z } from 'zod'

export const COMPONENT_CATALOG_VERSION = 1 as const

export type ComponentCatalogTrust = 'built-in' | 'trusted' | 'prompt'
export type ComponentCatalogQuality =
  | 'experimental'
  | 'candidate'
  | 'stable'
  | 'deprecated'

export interface ComponentCatalogSourceReference {
  kind: 'repository' | 'handoff' | 'local'
  reference: string
}

export interface ComponentCatalogLicense {
  status: 'declared' | 'unknown'
  expression?: string
  reference?: string
}

export interface ComponentCatalogPackage {
  packageId: string
  version: string
  name: string
  description: string
  subject: string[]
  schoolStage: string[]
  tags: string[]
  category?: string
  packagePath: string
  thumbnailPath: string
  sha256: string
  componentSchemaVersion: 4
  runtimeApiVersion: 4
  renderMode: 'dom' | 'phaser' | 'hybrid'
  supportedScopes: Array<'scene' | 'global'>
  quality: ComponentCatalogQuality
  maintainer: string
  verifiedCases: string[]
  verifiedAt?: string
  source?: ComponentCatalogSourceReference
  license?: ComponentCatalogLicense
  releaseBlockers?: string[]
}

export interface ComponentCatalogV1 {
  catalogVersion: 1
  name?: string
  packages: ComponentCatalogPackage[]
}

export interface ComponentCatalogSourceSnapshot {
  sourceId: string
  label: string
  trust: ComponentCatalogTrust
  packageCount: number
}

export interface AvailableComponentCatalogPackage extends ComponentCatalogPackage {
  sourceId: string
  sourceLabel: string
  sourceTrust: ComponentCatalogTrust
  thumbnailDataUrl?: string
}

export interface ComponentCatalogIssue {
  sourceId?: string
  sourceLabel: string
  packageId?: string
  code:
    | 'catalog-unreadable'
    | 'catalog-invalid'
    | 'package-unreadable'
    | 'package-hash-mismatch'
    | 'thumbnail-unreadable'
  message: string
}

export interface ComponentCatalogSnapshot {
  sources: ComponentCatalogSourceSnapshot[]
  packages: AvailableComponentCatalogPackage[]
  /** HTML components (`html-components/<entry>/`) found in the same catalog directories. */
  htmlComponents?: AvailableHtmlComponent[]
  issues: ComponentCatalogIssue[]
}

export interface ComponentCatalogPackageFile {
  sourceId: string
  sourceLabel: string
  sourceTrust: ComponentCatalogTrust
  packageId: string
  version: string
  sha256: string
  name: string
  bytes: Uint8Array
}

const safeRelativePathSchema = z.string()
  .min(1)
  .max(500)
  .refine(
    (value) => {
      const normalized = value.replaceAll('\\', '/')
      return !(
        normalized.startsWith('/') ||
        /^[a-zA-Z]:\//.test(normalized) ||
        normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
      )
    },
    '目录路径必须是安全的相对路径',
  )

const uniqueStrings = (label: string) => z.array(z.string().min(1).max(120))
  .refine((values) => new Set(values).size === values.length, `${label}不能重复`)

const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/

const componentCatalogPackageSchema = z.object({
  packageId: z.string()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i, '组件 ID 格式无效'),
  version: z.string().regex(
    semanticVersionPattern,
    '组件版本必须使用语义化版本',
  ),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  subject: uniqueStrings('学科'),
  schoolStage: uniqueStrings('学段'),
  tags: uniqueStrings('标签'),
  category: z.string().min(1).max(100).optional(),
  packagePath: safeRelativePathSchema,
  thumbnailPath: safeRelativePathSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, '哈希必须是小写 SHA-256'),
  componentSchemaVersion: z.literal(4),
  runtimeApiVersion: z.literal(4),
  renderMode: z.enum(['dom', 'phaser', 'hybrid']),
  supportedScopes: z.array(z.enum(['scene', 'global']))
    .min(1)
    .max(2)
    .refine((values) => new Set(values).size === values.length, '作用域不能重复'),
  quality: z.enum(['experimental', 'candidate', 'stable', 'deprecated']),
  maintainer: z.string().min(1).max(200),
  verifiedCases: uniqueStrings('验证课例'),
  verifiedAt: z.string().datetime().optional(),
  source: z.object({
    kind: z.enum(['repository', 'handoff', 'local']),
    reference: z.string().min(1).max(500),
  }).optional(),
  license: z.object({
    status: z.enum(['declared', 'unknown']),
    expression: z.string().min(1).max(200).optional(),
    reference: z.string().min(1).max(500).optional(),
  }).superRefine((license, context) => {
    if (license.status === 'declared' && !license.expression) {
      context.addIssue({
        code: 'custom',
        path: ['expression'],
        message: '声明许可证时必须提供 SPDX 表达式或明确名称',
      })
    }
    if (license.status === 'unknown' && (license.expression || license.reference)) {
      context.addIssue({
        code: 'custom',
        message: '未知许可证不得携带未经证实的表达式或引用',
      })
    }
  }).optional(),
  releaseBlockers: uniqueStrings('发布阻断项').optional(),
}).strict().superRefine((pkg, context) => {
  if (pkg.verifiedCases.length === 0 && pkg.verifiedAt !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['verifiedAt'],
      message: '未登记验证课例时不得声明验证时间',
    })
  }
  if (
    (pkg.quality === 'candidate' || pkg.quality === 'stable') &&
    pkg.license?.status !== 'declared'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['license'],
      message: 'candidate/stable 组件必须有明确许可证',
    })
  }
  if (
    (pkg.quality === 'candidate' || pkg.quality === 'stable') &&
    (pkg.releaseBlockers?.length ?? 0) > 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['releaseBlockers'],
      message: 'candidate/stable 组件不能保留发布阻断项',
    })
  }
})

export const componentCatalogSchema = z.object({
  catalogVersion: z.literal(COMPONENT_CATALOG_VERSION),
  name: z.string().min(1).max(200).optional(),
  packages: z.array(componentCatalogPackageSchema),
}).strict().superRefine((catalog, context) => {
  const identities = new Set<string>()
  const paths = new Set<string>()
  catalog.packages.forEach((pkg, index) => {
    const identity = `${pkg.packageId}@${pkg.version}`
    if (identities.has(identity)) {
      context.addIssue({
        code: 'custom',
        path: ['packages', index, 'packageId'],
        message: '组件 ID 与版本组合不能重复',
      })
    }
    identities.add(identity)
    if (paths.has(pkg.packagePath)) {
      context.addIssue({
        code: 'custom',
        path: ['packages', index, 'packagePath'],
        message: '多个组件不能指向同一个包文件',
      })
    }
    paths.add(pkg.packagePath)
  })
})

export function parseComponentCatalog(value: unknown): ComponentCatalogV1 {
  return componentCatalogSchema.parse(value)
}

/**
 * An HTML component in a component catalog directory: `html-components/<entry>/component.json`
 * (this manifest), `component.html` (the `components/<name>.html` text of a course) and the asset
 * files it refers to under `assets/`. The `.h5component` packages and `catalog.json` are unchanged.
 */
export const HTML_COMPONENT_FORMAT = 'guoling-html-component'

const htmlComponentAssetPathSchema = safeRelativePathSchema
  .refine(value => value.startsWith('assets/'), '素材路径须为 assets/ 下的相对路径')

export const htmlComponentManifestSchema = z.object({
  format: z.literal(HTML_COMPONENT_FORMAT),
  formatVersion: z.literal(1),
  packageId: z.string().min(3).max(200).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i, '组件 ID 格式无效'),
  version: z.string().regex(semanticVersionPattern, '组件版本必须使用语义化版本'),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).default(''),
  subject: uniqueStrings('学科').default([]),
  schoolStage: uniqueStrings('学段').default([]),
  tags: uniqueStrings('标签').default([]),
  /** The course it was saved from. */
  sourceCourse: z.string().min(1).max(500).optional(),
  savedAt: z.string().datetime().optional(),
  assets: z.array(z.object({ path: htmlComponentAssetPathSchema, mimeType: z.string().min(1).max(200) }).strict()).max(500).default([]),
}).strict()

export type HtmlComponentManifest = z.infer<typeof htmlComponentManifestSchema>

export interface AvailableHtmlComponent extends HtmlComponentManifest {
  sourceId: string
  sourceLabel: string
  sourceTrust: ComponentCatalogTrust
  /** Directory name under `html-components/`. */
  entry: string
  /** In the managed library (“我的资产库”), so the panel may delete it. */
  removable: boolean
}
