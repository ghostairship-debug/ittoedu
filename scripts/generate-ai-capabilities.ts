import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { stripTypeScriptTypes } from 'node:module'
import { build } from 'esbuild'
import { describeAuthoringToolDiscovery } from '../src/renderer/authoring/tools/authoringToolFacade'
import { describeGenerationSemanticTools, generationProjectDocumentWireInputSchema } from '../src/shared/generationContract'
import { courseAgentSkills, courseAgentSkillMarkdown } from '../src/shared/courseAgentSkills'
import { courseAgentCapabilityDiskIndex, courseAgentCapabilityQueryHelp, type CourseAgentCapabilityData, type CourseAgentCapabilityEntry } from '../src/shared/courseAgentCapabilities'
import packageJson from '../package.json'
import { importComponentPackage } from '../src/renderer/components/importComponentPackage'
import { BUILT_IN_COMPONENT_CATALOG_SHA256 } from '../src/shared/builtInComponentCatalog'
import {
  COMPONENT_CATALOG_VERSION,
  parseComponentCatalog,
  type ComponentCatalogPackage,
} from '../src/shared/componentCatalog'
import { componentManifestSchema } from '../src/shared/componentSchema'
import type {
  ComponentHostActions,
  ComponentInstanceLifecycle,
} from '../src/shared/componentTypes'
import {
  COMPONENT_EXECUTION_MODES,
  COMPONENT_RENDER_MODES,
  COMPONENT_SCOPES,
} from '../src/shared/componentTypes'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  COURSE_SURFACE_TYPES,
  LAYER_ITEM_KINDS,
} from '../src/shared/courseProjectTypes'
import {
  COURSE_PROJECT_DIAGNOSTIC_TARGET_KINDS,
  COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
  COURSE_PROJECT_VALIDATION_FATAL_CODES,
  COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER,
} from '../src/shared/courseProjectValidationDiagnostics'
import {
  APP_VERSION,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COMPONENT_RUNTIME_API_VERSION,
  COMPONENT_SCHEMA_VERSION,
  MAX_HISTORY_STEPS,
  MAX_PROJECT_SCENES,
  MAX_SCENE_NODES,
  MAX_SCENE_PRESENTATION_STATES,
  MIN_NODE_SIZE,
  MIN_VISIBLE_NODE_EDGE,
  RECOMMENDED_PROJECT_SCENES,
  RECOMMENDED_SCENE_NODES,
  RUNTIME_API_VERSION,
  RUNTIME_AUTHORING_API_VERSION,
} from '../src/shared/constants'
import {
  interactionActionSchema,
  interactionActionStepSchema,
  interactionConditionSchema,
  interactionRuleSchema,
  interactionTriggerSchema,
  sceneInteractionsSchema,
} from '../src/shared/interactionSchema'
import {
  INTERACTION_ACTION_TYPES,
  INTERACTION_CONDITION_TYPES,
  INTERACTION_TRIGGER_TYPES,
  MAX_INTERACTION_ACTIONS,
  MAX_INTERACTION_CONDITIONS,
  MAX_SCENE_INTERACTIONS,
} from '../src/shared/interactionTypes'
import {
  PUBLISHED_INTERACTION_PLAYBACK_SUPPORT,
} from '../src/shared/publishedInteractionSupport'
import { PUBLISHED_COURSE_FORMAT, PUBLISHED_COURSE_VERSION } from '../src/shared/publishedCourseTypes'
import {
  SURFACE_RUNTIME_API_VERSION,
  type SurfaceRuntimeAuthoring,
  type SurfaceRuntimeInstanceLifecycle,
} from '../src/shared/surfaceRuntimeTypes'
import {
  MAX_RUNTIME_ASSET_BINDINGS,
  MAX_RUNTIME_CONTENT_ENTRIES,
  MAX_RUNTIME_NODE_BINDINGS,
  MAX_RUNTIME_SOURCE_BYTES,
  runtimeDocumentSchema,
} from '../src/shared/runtimeSchema'
import type {
  RuntimeHostActions,
  RuntimeInstanceLifecycle,
} from '../src/shared/runtimeTypes'
import {
  RUNTIME_EXECUTION_MODES,
  RUNTIME_EVIDENCE_ACTION_KINDS,
  RUNTIME_RENDER_MODES,
  RUNTIME_SCOPES,
} from '../src/shared/runtimeTypes'
import { ASSESSMENT_EVALUATOR_REGISTRY } from '../src/shared/assessmentEvaluators'
import { NATIVE_NODE_TYPES } from '../src/shared/contracts/native-v1/types'
import { RECIPE_CATALOG } from '../src/renderer/recipes/recipeCatalog'
import {
  HOST_EVIDENCE_CONSOLE_PREFIX,
  HOST_EVIDENCE_SCHEMA_VERSION,
} from '../src/player/HostEvidenceRecorder'
import {
  SINGLE_HTML_HARD_LIMIT_BYTES,
  SINGLE_HTML_WARNING_BYTES,
} from '../src/renderer/export/exportSize'

export const AI_CAPABILITY_INDEX_MAX_BYTES = 16_384
export const AI_CAPABILITY_DISCOVERY_MAX_BYTES = 8_192
export const AI_CAPABILITY_MANIFEST_VERSION = 1 as const
export const INTERACTION_PROTOCOL_VERSION = 1 as const

export const COURSE_NATIVE_TYPES = NATIVE_NODE_TYPES

type CourseNativeType = typeof COURSE_NATIVE_TYPES[number]

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

type AssertExactly<Left, Right> =
  [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
    ? true
    : never

const runtimeHostActionNames = [
  'nextStep',
  'previousStep',
  'goToScene',
  'goToLocation',
  'nextScene',
  'previousScene',
  'replayScene',
  'restartCourse',
] as const satisfies readonly (keyof RuntimeHostActions)[]

const runtimeLifecycleHooks = [
  'resize',
  'setVisible',
  'suspend',
  'resume',
  'prepareCapture',
  'destroy',
] as const satisfies readonly (keyof RuntimeInstanceLifecycle)[]

const componentHostActionNames = [
  'nextStep',
  'previousStep',
  'goToScene',
  'goToLocation',
  'nextScene',
  'previousScene',
  'replayScene',
  'restartCourse',
] as const satisfies readonly (keyof ComponentHostActions)[]

const componentLifecycleHooks = [
  'setMode',
  'resize',
  'updateProps',
  'setEditorState',
  'setVisible',
  'suspend',
  'resume',
  'prepareCapture',
  'destroy',
] as const satisfies readonly (keyof ComponentInstanceLifecycle)[]

const runtimeHostActionsAreComplete: AssertExactly<
  keyof RuntimeHostActions,
  typeof runtimeHostActionNames[number]
> = true
const runtimeLifecycleIsComplete: AssertExactly<
  keyof RuntimeInstanceLifecycle,
  typeof runtimeLifecycleHooks[number]
> = true
const componentHostActionsAreComplete: AssertExactly<
  keyof ComponentHostActions,
  typeof componentHostActionNames[number]
> = true
const componentLifecycleIsComplete: AssertExactly<
  keyof ComponentInstanceLifecycle,
  typeof componentLifecycleHooks[number]
> = true

void runtimeHostActionsAreComplete
void runtimeLifecycleIsComplete
const surfaceRuntimeLifecycleHooks = [
  'setMode',
  'resize',
  'updateContent',
  'updateAssets',
  'setVisible',
  'suspend',
  'resume',
  'prepareCapture',
  'exportAuthoringCheckpoint',
  'restoreAuthoringCheckpoint',
  'destroy',
] as const satisfies readonly (keyof SurfaceRuntimeInstanceLifecycle)[]

const surfaceRuntimeAuthoringMethods = [
  'registerText',
  'registerAsset',
  'invalidate',
] as const satisfies readonly (keyof SurfaceRuntimeAuthoring)[]

const componentPublishedPlaybackSlices = [
  {
    surfaces: ['slide', 'flow', 'spatial-2d'],
    carriers: [
      'slide:scene.layerItems/surfaceLayerItems',
      'flow:blocks/surfaceLayerItems',
      'spatial-2d:world.layerItems/surfaceLayerItems',
    ],
    scope: 'local-only',
    renderMode: 'dom',
    consumers: [
      'current-location-try-run',
      'whole-course-preview',
      'single-html',
      'web-package',
    ],
    behavior: 'interactive-component-api4-playback',
    services: 'shared-courseState; active-carrier host actions; cross-location go-next-previous guarded; replay same-location; restart bypasses guards and resets defaults',
  },
  {
    surface: 'slide',
    carrier: 'scene.layerItems',
    scope: 'scene-local',
    renderMode: 'phaser',
    consumers: [
      'current-location-try-run',
      'whole-course-preview',
      'single-html',
      'web-package',
    ],
    behavior: 'interactive-component-api4-playback',
    services: 'shared-courseState; active-carrier host actions; cross-location go-next-previous guarded; replay same-location; restart bypasses guards and resets defaults',
  },
] as const

const componentPublishedStaticExport = {
  pdf: 'pure-slide-page-capture-runs-dom-scene-surface-global-and-phaser-scene; mixed-flow-spatial-use-static-fallback-or-label',
  pptx: 'slide-dom-scene-surface-and-phaser-scene-real-item-capture; global-dom-only-in-pure-slide; failure-uses-authored-fallback-or-visible-placeholder',
} as const

const componentPublishedPlaybackNotCovered = [
  'global-component-session-lifetime-and-scope-parity',
  'dom-ctx.events-course-bus',
  'presentation-outside-slide',
  'phaser-global-or-surface-shared',
  'phaser-flow-or-spatial',
  'hybrid-published-parity',
  'mixed-pdf-slide-dynamic-capture',
  'flow-or-spatial-dynamic-capture-pdf-or-pptx',
  'declarative-component.event-trigger',
] as const

const surfaceRuntimeLifecycleIsComplete: AssertExactly<
  keyof SurfaceRuntimeInstanceLifecycle,
  typeof surfaceRuntimeLifecycleHooks[number]
> = true
const surfaceRuntimeAuthoringIsComplete: AssertExactly<
  keyof SurfaceRuntimeAuthoring,
  typeof surfaceRuntimeAuthoringMethods[number]
> = true

void componentHostActionsAreComplete
void componentLifecycleIsComplete
void surfaceRuntimeLifecycleIsComplete
void surfaceRuntimeAuthoringIsComplete

interface ComponentSnapshotPackage extends ComponentCatalogPackage {
  actualSha256?: string
  hashVerified: boolean
  manifestVerified: boolean
  thumbnailAvailable: boolean
  availability: 'available' | 'unavailable'
  unavailableReasons: string[]
}

interface ComponentCatalogCapabilitySnapshot {
  snapshotVersion: 1
  status: 'available' | 'degraded' | 'unavailable'
  source: {
    kind: 'external-component-catalog'
    location: string
    expectedCatalogSha256: string
    actualCatalogSha256?: string
    trusted: boolean
  }
  catalogVersion?: number
  name?: string
  packageCount: number
  packages: ComponentSnapshotPackage[]
  issues: Array<{
    code: string
    packageId?: string
    message: string
  }>
}

export interface AiCapabilityGenerationOptions {
  projectRoot?: string
  componentCatalogRoot?: string
  componentCatalogLabel?: string
}

export interface AiCapabilityGenerationResult {
  files: ReadonlyMap<string, string>
  capabilityBundle: string
  indexBytes: number
  componentCatalogStatus: ComponentCatalogCapabilitySnapshot['status']
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, nested]) => [key, normalizeJson(nested)]),
  )
}

/** Canonical UTF-8 JSON used for deterministic files and SHA-256 evidence. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(normalizeJson(value))}\n`
}

export function canonicalJsonByteLength(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8')
}

/** Native file readers can cap each physical line; keep on-demand JSON navigable. */
function readableResourceJson(value: unknown): string {
  return `${JSON.stringify(normalizeJson(value), null, 2)}\n`
}

export function assertIndexWithinLimit(index: unknown): void {
  const byteLength = canonicalJsonByteLength(index)
  if (byteLength > AI_CAPABILITY_INDEX_MAX_BYTES) {
    throw new Error(
      `AI 能力索引规范化后为 ${byteLength} 字节，超过 ${AI_CAPABILITY_INDEX_MAX_BYTES} 字节上限。`,
    )
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>
}

function schemaLiteral(
  schema: Record<string, unknown>,
  property: string,
): unknown {
  const properties = schema.properties
  if (typeof properties !== 'object' || properties === null) return undefined
  const propertySchema = (properties as Record<string, unknown>)[property]
  if (typeof propertySchema !== 'object' || propertySchema === null) return undefined
  return (propertySchema as Record<string, unknown>).const
}

function collectDiscriminatorValues(
  value: unknown,
  output = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectDiscriminatorValues(entry, output))
    return output
  }
  if (typeof value !== 'object' || value === null) return output
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (typeof properties === 'object' && properties !== null) {
    const typeSchema = (properties as Record<string, unknown>).type
    if (typeof typeSchema === 'object' && typeSchema !== null) {
      const literal = (typeSchema as Record<string, unknown>).const
      if (typeof literal === 'string') {
        output.add(literal)
        // This object is one discriminator branch. Do not descend into nested
        // payload objects that may define their own unrelated `type` fields.
        return output
      }
    }
  }
  ;(['oneOf', 'anyOf', 'allOf'] as const).forEach((composition) => {
    const branches = record[composition]
    if (Array.isArray(branches)) {
      branches.forEach((entry) => collectDiscriminatorValues(entry, output))
    }
  })
  return output
}

function assertExactStrings(
  label: string,
  expected: readonly string[],
  actual: ReadonlySet<string>,
): void {
  const expectedSet = new Set(expected)
  const missing = expected.filter((value) => !actual.has(value))
  const extra = [...actual].filter((value) => !expectedSet.has(value))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} discriminator 与 Schema 不一致；缺失 [${missing.join(', ')}]，多出 [${extra.join(', ')}]。`,
    )
  }
}

function pathIsOutsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || relative === '..' ||
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

async function readCatalogFile(
  catalogRoot: string,
  relativePath: string,
): Promise<Uint8Array> {
  const realRoot = await fs.realpath(catalogRoot)
  const lexicalTarget = path.resolve(
    realRoot,
    ...relativePath.replaceAll('\\', '/').split('/'),
  )
  if (pathIsOutsideRoot(realRoot, lexicalTarget)) {
    throw new Error('目录路径越界')
  }
  const realTarget = await fs.realpath(lexicalTarget)
  if (pathIsOutsideRoot(realRoot, realTarget)) {
    throw new Error('目录路径经符号链接越界')
  }
  return Uint8Array.from(await fs.readFile(realTarget))
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value) => right.includes(value))
}

async function buildComponentCatalogSnapshot(
  catalogRoot: string,
  location: string,
): Promise<ComponentCatalogCapabilitySnapshot> {
  const sourceBase = {
    kind: 'external-component-catalog' as const,
    location,
    expectedCatalogSha256: BUILT_IN_COMPONENT_CATALOG_SHA256,
  }
  let catalogBytes: Uint8Array
  try {
    catalogBytes = await fs.readFile(path.join(catalogRoot, 'catalog.json'))
  } catch {
    return {
      snapshotVersion: 1,
      status: 'unavailable',
      source: { ...sourceBase, trusted: false },
      packageCount: 0,
      packages: [],
      issues: [{
        code: 'catalog-unavailable',
        message: '外部组件目录缺失或 catalog.json 不可读，未声明任何可用组件。',
      }],
    }
  }

  const actualCatalogSha256 = sha256(catalogBytes)
  const catalogTrusted = actualCatalogSha256 === BUILT_IN_COMPONENT_CATALOG_SHA256
  let catalog: ReturnType<typeof parseComponentCatalog>
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(catalogBytes)
    catalog = parseComponentCatalog(JSON.parse(source) as unknown)
  } catch {
    return {
      snapshotVersion: 1,
      status: 'unavailable',
      source: {
        ...sourceBase,
        actualCatalogSha256,
        trusted: false,
      },
      packageCount: 0,
      packages: [],
      issues: [{
        code: 'catalog-invalid',
        message: '外部 catalog.json 不是有效的 Component Catalog V1，未声明任何可用组件。',
      }],
    }
  }

  const issues: ComponentCatalogCapabilitySnapshot['issues'] = []
  if (!catalogTrusted) {
    issues.push({
      code: 'catalog-hash-mismatch',
      message: '外部 catalog.json 与当前编辑器审核哈希不一致，目录内组件均不声明为可用。',
    })
  }

  const packages: ComponentSnapshotPackage[] = []
  const sortedPackages = [...catalog.packages].sort((left, right) =>
    `${left.packageId}@${left.version}`.localeCompare(
      `${right.packageId}@${right.version}`,
      'en',
    ),
  )

  for (const entry of sortedPackages) {
    let actualSha256: string | undefined
    let hashVerified = false
    let manifestVerified = false
    let thumbnailAvailable = false
    const unavailableReasons: string[] = []
    try {
      const packageBytes = await readCatalogFile(catalogRoot, entry.packagePath)
      actualSha256 = sha256(packageBytes)
      hashVerified = actualSha256 === entry.sha256
      if (!hashVerified) {
        unavailableReasons.push('package-hash-mismatch')
        issues.push({
          code: 'package-hash-mismatch',
          packageId: entry.packageId,
          message: `组件 ${entry.packageId}@${entry.version} 的实际归档哈希与 catalog.json 不一致。`,
        })
      } else {
        try {
          const imported = importComponentPackage(packageBytes, {
            expectedId: entry.packageId,
            expectedVersion: entry.version,
          })
          manifestVerified =
            imported.manifest.schemaVersion === entry.componentSchemaVersion &&
            imported.manifest.runtimeApiVersion === entry.runtimeApiVersion &&
            imported.manifest.renderMode === entry.renderMode &&
            imported.manifest.name === entry.name &&
            sameStringSet(
              imported.manifest.supportedScopes,
              entry.supportedScopes,
            )
          if (!manifestVerified) {
            unavailableReasons.push('package-manifest-mismatch')
            issues.push({
              code: 'package-manifest-mismatch',
              packageId: entry.packageId,
              message: `组件 ${entry.packageId}@${entry.version} 的实际 manifest 与 catalog.json 协议元数据不一致。`,
            })
          }
        } catch {
          unavailableReasons.push('package-invalid')
          issues.push({
            code: 'package-invalid',
            packageId: entry.packageId,
            message: `组件 ${entry.packageId}@${entry.version} 无法通过正式组件归档与 manifest 解析。`,
          })
        }
      }
    } catch {
      unavailableReasons.push('package-unavailable')
      issues.push({
        code: 'package-unavailable',
        packageId: entry.packageId,
        message: `组件 ${entry.packageId}@${entry.version} 的归档不可读。`,
      })
    }

    try {
      await readCatalogFile(catalogRoot, entry.thumbnailPath)
      thumbnailAvailable = true
    } catch {
      issues.push({
        code: 'thumbnail-unavailable',
        packageId: entry.packageId,
        message: `组件 ${entry.packageId}@${entry.version} 的目录缩略图不可读。`,
      })
    }

    if (!catalogTrusted) unavailableReasons.unshift('catalog-untrusted')
    packages.push({
      ...entry,
      ...(actualSha256 === undefined ? {} : { actualSha256 }),
      hashVerified,
      manifestVerified,
      thumbnailAvailable,
      availability:
        catalogTrusted && hashVerified && manifestVerified
          ? 'available'
          : 'unavailable',
      unavailableReasons,
    })
  }

  const unavailableCount = packages.filter(
    (entry) => entry.availability === 'unavailable',
  ).length
  return {
    snapshotVersion: 1,
    status: !catalogTrusted
      ? 'unavailable'
      : unavailableCount > 0
        ? 'degraded'
        : 'available',
    source: {
      ...sourceBase,
      actualCatalogSha256,
      trusted: catalogTrusted,
    },
    catalogVersion: catalog.catalogVersion,
    ...(catalog.name === undefined ? {} : { name: catalog.name }),
    packageCount: packages.length,
    packages,
    issues: issues.sort((left, right) =>
      `${left.packageId ?? ''}:${left.code}`.localeCompare(
        `${right.packageId ?? ''}:${right.code}`,
        'en',
      ),
    ),
  }
}

const nodeCapabilitySummary = {
  table: {
    label: '表格', authoringModes: ['simple', 'professional'], authoringScopes: ['slide-scene', 'slide-surface', 'flow-body', 'spatial-world'],
    exports: { singleHtml: 'native', webPackage: 'native', pptx: 'slide-editable-table;spatial-camera-static', docx: 'flow-editable-table', pdf: 'static-capture' },
  },
  chart: {
    label: '图表', authoringModes: ['simple', 'professional'], authoringScopes: ['slide-scene', 'slide-surface', 'flow-body', 'spatial-world'],
    exports: { singleHtml: 'native', webPackage: 'native', pptx: 'slide-editable-chart;spatial-camera-static', docx: 'flow-static-chart-and-editable-data', pdf: 'static-chart' },
  },
  input: {
    label: '输入框', authoringModes: ['simple', 'professional'], authoringScopes: ['slide-scene'],
    exports: { singleHtml: 'interactive', webPackage: 'interactive', pptx: 'static-editable-answer-area', pdf: 'static-answer-area' },
  },
  text: {
    label: '文本',
    authoringModes: ['simple', 'professional'],
    authoringScopes: ['scene', 'global'],
    exports: {
      singleHtml: 'native',
      webPackage: 'native',
      pdf: 'static-capture',
      pptx: 'native-except-emphasis-or-vertical-lr',
    },
  },
  formula: {
    label: '公式',
    authoringModes: ['simple', 'professional'],
    authoringScopes: ['scene', 'global'],
    exports: {
      singleHtml: 'shared-formula-renderer',
      webPackage: 'shared-formula-renderer',
      pdf: 'static-capture',
      pptx: 'transparent-raster-with-metadata',
    },
  },
  image: {
    label: '图片',
    authoringModes: ['simple', 'professional'],
    authoringScopes: ['scene', 'global'],
    exports: {
      singleHtml: 'native',
      webPackage: 'native',
      pdf: 'static-capture',
      pptx: 'native-image',
    },
  },
  video: {
    label: '视频',
    authoringModes: ['simple', 'professional'],
    authoringScopes: ['scene', 'global'],
    exports: {
      singleHtml: 'interactive',
      webPackage: 'interactive',
      pdf: 'poster-frame',
      pptx: 'filename-placeholder',
    },
  },
  shape: {
    label: '图形',
    authoringModes: ['simple', 'professional'],
    authoringScopes: ['scene', 'global'],
    exports: {
      singleHtml: 'native',
      webPackage: 'native',
      pdf: 'static-capture',
      pptx: 'native-shape',
    },
  },

} as const satisfies Record<CourseNativeType, {
  label: string
  authoringModes: readonly string[]
  authoringScopes: readonly string[]
  exports: Readonly<Record<string, string>>
}>

function artifactEvidence(files: ReadonlyMap<string, string>): Record<string, {
  bytes: number
  sha256: string
}> {
  return Object.fromEntries(
    [...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([relativePath, content]) => [relativePath, {
        bytes: Buffer.byteLength(content, 'utf8'),
        sha256: sha256(content),
      }]),
  )
}

/**
 * Keep the provenance roots small and stable, then derive their complete local
 * module closure. The generator is the byte-producing root. The two executable
 * schemas are semantic-authority roots referenced by the compact Builder
 * summaries below; tracing their closure ensures a nested contract change cannot
 * leave the evidence claiming that every relevant authority input was unchanged.
 */
const AI_CAPABILITY_PROVENANCE_ENTRYPOINTS = [
  'scripts/generate-ai-capabilities.ts',
  'src/shared/contracts/index.ts',
  'src/shared/courseProjectSchema.ts',
  'src/shared/publishedCourseSchema.ts',
] as const

const HEADLESS_BUILD_EVIDENCE_FILES = [
  'scripts/build-courseware-case.ts',
  'scripts/courseware-builder-v2-host.ts',
  'src/renderer/course/coursewareBuilderV2.ts',
  'src/renderer/authoring/tools/authoringToolFacade.ts',
  'src/renderer/course/coursewareCaseBuilderApi.ts',
] as const

const LOCAL_MODULE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json',
] as const

function localModuleSpecifiers(source: string): string[] {
  const output = new Set<string>()
  // All repository modules use ESM. Capturing `from` also deliberately follows
  // type-only contract edges: those files define the public protocol summarized
  // for Builder even when TypeScript erases the import at runtime.
  const patterns = [
    /\bfrom\s*['"]([^'"\r\n]+)['"]/g,
    /\bimport\s*['"]([^'"\r\n]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/g,
  ]
  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) output.add(match[1])
    }
  })
  return [...output]
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function resolveLocalModule(
  projectRoot: string,
  importerRelativePath: string,
  specifier: string,
): Promise<string | undefined> {
  let unresolved: string
  if (specifier.startsWith('@/')) {
    unresolved = path.join(projectRoot, 'src', specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    unresolved = path.resolve(
      projectRoot,
      path.dirname(importerRelativePath),
      specifier,
    )
  } else {
    return undefined
  }

  const candidates = path.extname(unresolved)
    ? [unresolved]
    : [
        ...LOCAL_MODULE_EXTENSIONS.map((extension) => `${unresolved}${extension}`),
        ...LOCAL_MODULE_EXTENSIONS.map((extension) =>
          path.join(unresolved, `index${extension}`),
        ),
      ]
  for (const candidate of candidates) {
    if (!await isFile(candidate)) continue
    if (pathIsOutsideRoot(projectRoot, candidate)) {
      throw new Error(`AI 能力溯源模块越出仓库：${specifier}`)
    }
    return path.relative(projectRoot, candidate).replaceAll('\\', '/')
  }
  throw new Error(
    `AI 能力溯源无法解析 ${importerRelativePath} 引用的本地模块：${specifier}`,
  )
}

async function sourceEvidence(projectRoot: string): Promise<Array<{
  path: string
  sha256: string
}>> {
  const discovered = new Set<string>()
  const pending: string[] = [...AI_CAPABILITY_PROVENANCE_ENTRYPOINTS]
  while (pending.length > 0) {
    const relativePath = pending.shift()!
    if (discovered.has(relativePath)) continue
    discovered.add(relativePath)
    const absolutePath = path.join(projectRoot, ...relativePath.split('/'))
    const source = await fs.readFile(absolutePath, 'utf8')
    if (!/\.[cm]?[jt]sx?$/.test(relativePath)) continue
    for (const specifier of localModuleSpecifiers(source)) {
      const dependency = await resolveLocalModule(
        projectRoot,
        relativePath,
        specifier,
      )
      if (dependency && !discovered.has(dependency)) pending.push(dependency)
    }
  }
  const sources = [...discovered].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )
  return Promise.all(sources.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await fs.readFile(path.join(projectRoot, relativePath))),
  })))
}

async function directFileEvidence(
  projectRoot: string,
  relativePaths: readonly string[],
): Promise<Array<{ path: string, sha256: string }>> {
  return Promise.all(relativePaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await fs.readFile(path.join(projectRoot, relativePath))),
  })))
}

async function addDiscoveryArtifacts(projectRoot: string, files: Map<string, string>, catalog: ComponentCatalogCapabilitySnapshot) {
  const entries: CourseAgentCapabilityEntry[] = []
  const resources = new Map<string, string>()
  const allScopes = ['slide:scene', 'slide:surface', 'slide:global', 'flow:surface', 'flow:global', 'spatial-2d:world', 'spatial-2d:surface', 'spatial-2d:global']
  const allCarriers = ['native', 'recipe', 'existing-component', 'generated-component', 'runtime']
  const toolDefinitions = describeAuthoringToolDiscovery()
  for (const tool of toolDefinitions) {
    const location = `tools/${tool.name}.json`
    // The CLI sends a file reference, not an inline 100 KB document schema.
    // Preserve the complete canonical input contract as an on-demand resource.
    const artifactSchema = 'schemas/project-document-artifact.json'
    if (tool.name === 'project.document') {
      const input = tool.inputSchema as Record<string, any>
      resources.set(artifactSchema, readableResourceJson({ $schema: input.$schema, ...input.properties.artifact, $defs: input.$defs }))
    }
    resources.set(location, readableResourceJson({ version: 1, ...tool,
      ...(tool.name === 'project.document' ? {
        inputSchema: z.toJSONSchema(generationProjectDocumentWireInputSchema),
        artifactSchema,
        examples: [{ input: { artifact: { $candidateFile: 'resources/result.json' } } }],
        invocation: '候选提交文件引用，宿主解析文件并严格验证 V9。通常直接编辑冻结 document.json 的已有结构，无需读取完整 Schema 或编写验证器；新增未知结构时按需读取 artifactSchema。保留工程 cwd，用绝对路径读写暂存文件，避免 Windows 长工作目录错误。',
      } : {}),
      ...(tool.name === 'asset.media.import' ? { candidateTransport: {
        instruction: '候选传输允许 base64 使用本轮文件引用，Main 摄取真实字节后才调用正式工具。使用 request.destinations 的 global create 素材依赖目标；后续 owner.background.backgroundAssetId 可引用该步 asset-id 结果。所有步骤同一事务，失败零写入。',
        input: { kind: 'image', filename: 'dog.png', mimeType: 'image/png', base64: { $candidateFile: 'resources/dog.png' } },
      } } : {}),
    }))
    entries.push({ id: tool.name, kind: 'tool', label: tool.name, path: location,
      scopes: tool.supportedScopes, carriers: [...new Set([tool.candidateCarrier.default, ...Object.values(tool.candidateCarrier.operations ?? {})])],
      variants: tool.variants,
      summary: tool.description ?? '按完整输入 Schema、当前 canonical target 和宿主支持执行。',
      dependencies: tool.name === 'component.package' ? ['component-api4'] : tool.name === 'runtime.insert' || tool.name === 'runtime.source' ? ['runtime-api2', 'runtime-api3'] : [],
    })
  }
  // Candidate semantic operations expand the same formal commands. They are
  // discoverable through this one generated catalog, not standalone Facade RPCs.
  for (const tool of describeGenerationSemanticTools()) {
    const location = `tools/${tool.name}.json`
    resources.set(location, readableResourceJson({ version: 1, ...tool, supportedScopes: tool.scopes,
      invocation: { channel: 'generation-candidate', destination: 'current request destination alias',
        instruction: '作为当前候选的一步返回；由宿主展开和提交，不直接调用 session.execute。' } }))
    entries.push({ id: tool.name, kind: 'tool', label: tool.name, path: location,
      scopes: tool.scopes, carriers: [tool.candidateCarrier.default], summary: tool.description,
      keywords: '图片 插图 换图 形状 背景 素材 替换 image picture replace background' })
  }
  for (const recipe of RECIPE_CATALOG) {
    const location = `recipes/${recipe.id}.json`
    const input = { recipeId: recipe.id, slots: Object.fromEntries(recipe.fields.map(field => [field.key, field.value])) }
    resources.set(location, readableResourceJson({ ...recipe, tool: 'recipe.apply', input,
      destination: { kind: 'create', owner: 'scene', parent: { kind: 'course-locations' }, insertion: 'after current locationId' },
      example: 'const view = await session.observe(); const scope = await session.createScope({parent:{kind:"course-locations"},insertion:{kind:"after",siblingId:view.scope.locationId}}); const receipt = await session.execute("recipe.apply", card.input, {kind:"create",scope}); if(receipt.status!=="committed") throw new Error(JSON.stringify(receipt.diagnostics));',
      output: 'ordinary editable Course Project V9 content',
    }))
    entries.push({ id: `recipe:${recipe.id}`, kind: 'recipe', label: recipe.label, path: location, scopes: ['slide:scene'], carriers: ['recipe'],
      summary: recipe.fields.map(field => field.label).join('、'), keywords: recipe.fields.map(field => field.value).join(' '), dependencies: ['recipe.apply'],
    })
  }
  for (const component of catalog.packages) {
    const location = `components/${encodeURIComponent(component.packageId)}@${encodeURIComponent(component.version)}.json`
    resources.set(location, readableResourceJson({ ...component, tool: 'component.insert',
      catalogSource: catalog.source,
      example: '按 request.context.componentCatalogFile.path 读取本轮完整目录，找到 packageId/version/sha256 与卡片完全匹配的 source，使用 {operation:"catalog",sourceId:source.sourceId,packageId:source.packageId,version:source.version,sha256:source.sha256}。sourceId 必须来自当前宿主，不能猜测。',
      note: 'catalog 操作需要宿主目录 consumer；不能把生成时可用误作当前宿主可用。Builder 没有目录 consumer 时使用公开 candidate 文件输入或明确报告缺口。目录不可用不阻止创建或导入工程内组件。',
    }))
    const scopes = component.supportedScopes.flatMap(scope => scope === 'scene' ? ['slide:scene', 'flow:surface', 'spatial-2d:world'] : ['slide:global', 'flow:global'])
    entries.push({ id: `component:${component.packageId}@${component.version}`, kind: 'component', label: component.name, path: location, scopes,
      carriers: ['existing-component'], summary: component.description ?? component.name, available: component.availability === 'available',
      keywords: JSON.stringify(component), dependencies: ['component.insert'],
    })
  }
  const protocolSources = [
    { id: 'component-api4', schema: 'schemas/component-api4.json', source: 'src/shared/contracts/component-v4/types.ts', carriers: ['generated-component', 'existing-component'], scopes: allScopes },
    { id: 'runtime-api2', schema: 'schemas/runtime-api2.json', source: 'src/shared/contracts/runtime/types.ts', carriers: ['runtime'], scopes: ['slide:scene', 'slide:global'] },
    { id: 'runtime-api3', schema: 'schemas/runtime-api3.json', source: 'src/shared/contracts/runtime/surface.ts', carriers: ['runtime'], scopes: ['slide:scene', 'flow:surface'] },
  ]
  for (const protocol of protocolSources) {
    const location = `protocols/${protocol.id}.json`
    const guideLocation = `protocols/${protocol.id}.authoring.md`
    const guideId = `reference:${protocol.id}/authoring`
    const schema = JSON.parse(files.get(protocol.schema)!)
    const authoringGuide = await fs.readFile(path.join(projectRoot, schema.documentation), 'utf8')
    resources.set(guideLocation, authoringGuide)
    resources.set(location, readableResourceJson({ ...schema, types: await fs.readFile(path.join(projectRoot, protocol.source), 'utf8'),
      sharedTypes: { assessment: await fs.readFile(path.join(projectRoot, 'src/shared/assessmentEvaluators.ts'), 'utf8'),
        ...(protocol.id === 'component-api4' ? { teacherController: await fs.readFile(path.join(projectRoot, 'src/shared/contracts/component-v4/teacherController.ts'), 'utf8') } : {}),
        ...(protocol.id === 'runtime-api2' ? {} : { runtime: await fs.readFile(path.join(projectRoot, 'src/shared/contracts/runtime/types.ts'), 'utf8') }) },
      authoringGuide, authoringGuideFile: guideLocation }))
    entries.push({ id: protocol.id, kind: 'protocol', label: protocol.id, path: location, scopes: protocol.scopes, carriers: protocol.carriers,
      dependencies: [guideId], summary: '完整正式协议、宿主范围、生命周期与验证限制；编写指南可通过同目录.authoring.md读取，不替代真实宿主准入。' })
    entries.push({ id: guideId, kind: 'reference', label: `${protocol.id} 编写指南`, path: guideLocation, scopes: protocol.scopes,
      carriers: protocol.carriers, summary: '正式协议同源的完整Markdown指南，保留自然换行供原生Read按需读取。' })
  }
  for (const skillName of ['orchestrate-courseware', 'build-courseware-project']) {
    const sourceRoot = path.join(projectRoot, '.agents', 'skills', skillName)
    const sourcePaths = ['SKILL.md', ...(await fs.readdir(path.join(sourceRoot, 'references'))).filter(name => name.endsWith('.md')).map(name => `references/${name}`)]
    for (const sourcePath of sourcePaths) {
      const text = await fs.readFile(path.join(sourceRoot, sourcePath), 'utf8')
      const location = `skills/${skillName}/${sourcePath}`
      resources.set(location, text)
      const label = text.match(/^# (.+)$/m)?.[1] ?? sourcePath
      entries.push({ id: sourcePath === 'SKILL.md' ? `skill:${skillName}` : `reference:${skillName}/${path.posix.basename(sourcePath, '.md')}`,
        kind: sourcePath === 'SKILL.md' ? 'skill' : 'reference', label, path: location, scopes: allScopes, carriers: allCarriers,
        summary: sourcePath === 'SKILL.md' ? text.match(/^description: (.+)$/m)?.[1]?.slice(0, 300) ?? label : label,
        keywords: text.split('\n').filter(line => /^#{1,3} /.test(line)).join(' '),
      })
    }
  }
  for (const skill of courseAgentSkills) {
    const location = `skills/${skill.name}/SKILL.md`
    resources.set(location, courseAgentSkillMarkdown(skill))
    entries.push({ id: `skill:${skill.name}`, kind: 'skill', label: skill.name, path: location, scopes: allScopes, carriers: allCarriers, summary: skill.body.split('。')[0]! })
  }
  resources.set('query-core.mjs', stripTypeScriptTypes(await fs.readFile(path.join(projectRoot, 'src/shared/courseAgentCapabilities.ts'), 'utf8')).split('\n').map(line => line.trimEnd()).join('\n'))
  const helper = await build({ entryPoints: [path.join(projectRoot, 'scripts/candidate-helper.ts')], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'node20', minify: false, legalComments: 'none' })
  resources.set('candidate-helper-core.mjs', helper.outputFiles[0]!.text)
  resources.set('candidate-helper.mjs', '// Run: node candidate-helper.mjs --request <request.json> --input <draft.json> [--check]\n// Draft: {summary,steps,afterCommit?}; IDs and version come from the request.\n// Precheck is not host commit. Keep native cwd; use absolute paths.\nimport "./candidate-helper-core.mjs";\n')
  resources.set('query.mjs', [
    "import {readFile} from 'node:fs/promises';",
    "import {readFileSync} from 'node:fs';",
    `import {runCourseAgentCapabilityQuery} from ${JSON.stringify("./query-core.mjs")};`,
    "const data=JSON.parse(await readFile(new URL('./discovery-data.json',import.meta.url),'utf8'));",
    "data.files=new Proxy({}, {get:(_target,name)=>typeof name==='string' && data.resourcePaths.includes(name) ? readFileSync(new URL(name,import.meta.url),'utf8') : undefined});",
    "try {const result=runCourseAgentCapabilityQuery(data,process.argv.slice(2));console.log(typeof result==='string'?result:JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}",
  ].join('\n') + '\n')
  entries.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const semanticVersion = createHash('sha256').update(canonicalJson({ version: 1, entries, files: Object.fromEntries([...resources].sort(([a], [b]) => a.localeCompare(b, 'en'))) })).digest('hex')
  const discovery = { version: 1, semanticVersion, query: 'query.mjs', data: 'discovery-data.json',
    usage: courseAgentCapabilityQueryHelp,
    groups: { recipes: 'query --kind recipe', components: 'query --kind component', skills: 'query --kind skill', references: 'query --kind reference' },
    tools: entries.filter(entry => entry.kind === 'tool').map(entry => ({ id: entry.id, path: entry.path, scopes: entry.scopes, carriers: entry.carriers })),
    protocols: entries.filter(entry => entry.kind === 'protocol').map(entry => ({ id: entry.id, path: entry.path, authoringGuideFile: `protocols/${entry.id}.authoring.md`, scopes: entry.scopes })),
    cache: 'Reuse only with the same semanticVersion and the same query scope; source/material/observation versions are separate.',
  }
  // One-space indentation keeps the routing index below 8 KiB and each native Read line short.
  const discoveryText = JSON.stringify(JSON.parse(canonicalJson(discovery)), null, 1) + '\n'
  if (Buffer.byteLength(discoveryText) > AI_CAPABILITY_DISCOVERY_MAX_BYTES) throw new Error('精简发现入口超过 8 KiB，不能截断能力')
  resources.set('discovery.json', discoveryText)
  const data: CourseAgentCapabilityData = { version: 1, semanticVersion, entries, files: Object.fromEntries(resources) }
  for (const [location, content] of resources) files.set(location, content)
  files.set('discovery-data.json', courseAgentCapabilityDiskIndex(data))
  return canonicalJson(data)
}

export async function generateAiCapabilityArtifacts(
  options: AiCapabilityGenerationOptions = {},
): Promise<AiCapabilityGenerationResult> {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot)
  const catalogRoot = path.resolve(
    options.componentCatalogRoot ?? path.join(projectRoot, '..', 'courseware-components'),
  )
  const catalogLabel = options.componentCatalogLabel ??
    (options.componentCatalogRoot === undefined
      ? '../courseware-components'
      : 'external-component-catalog')

  const triggerJsonSchema = jsonSchema(interactionTriggerSchema)
  const conditionJsonSchema = jsonSchema(interactionConditionSchema)
  const actionJsonSchema = jsonSchema(interactionActionSchema)
  const runtimeJsonSchema = jsonSchema(runtimeDocumentSchema)
  const componentJsonSchema = jsonSchema(componentManifestSchema)

  if (packageJson.version !== APP_VERSION) {
    throw new Error('package.json 版本与 APP_VERSION 常量不一致。')
  }

  const currentProtocols = {
    project: COURSE_PROJECT_SCHEMA_VERSION,
    publishedCourse: PUBLISHED_COURSE_VERSION,
    runtime: [RUNTIME_API_VERSION, SURFACE_RUNTIME_API_VERSION],
    component: COMPONENT_SCHEMA_VERSION,
    interaction: INTERACTION_PROTOCOL_VERSION,
  } as const

  if (COURSE_PROJECT_SCHEMA_VERSION !== 9) {
    throw new Error('当前工程版本必须来自 COURSE_PROJECT_SCHEMA_VERSION = 9。')
  }
  if (schemaLiteral(runtimeJsonSchema, 'runtimeApiVersion') !== RUNTIME_API_VERSION) {
    throw new Error('Runtime Schema 版本与 RUNTIME_API_VERSION 常量不一致。')
  }
  if (schemaLiteral(componentJsonSchema, 'schemaVersion') !== COMPONENT_SCHEMA_VERSION) {
    throw new Error('Component Schema 版本与 COMPONENT_SCHEMA_VERSION 常量不一致。')
  }
  if (
    schemaLiteral(componentJsonSchema, 'runtimeApiVersion') !==
    COMPONENT_RUNTIME_API_VERSION
  ) {
    throw new Error('Component Runtime 版本与常量不一致。')
  }

  assertExactStrings(
    'trigger',
    INTERACTION_TRIGGER_TYPES,
    collectDiscriminatorValues(triggerJsonSchema),
  )
  assertExactStrings(
    'condition',
    INTERACTION_CONDITION_TYPES,
    collectDiscriminatorValues(conditionJsonSchema),
  )
  assertExactStrings(
    'action',
    INTERACTION_ACTION_TYPES,
    collectDiscriminatorValues(actionJsonSchema),
  )

  const componentCatalogSnapshot = await buildComponentCatalogSnapshot(
    catalogRoot,
    catalogLabel,
  )

  const files = new Map<string, string>()
  files.set('schemas/course-project-v9.json', canonicalJson({
    contract: 'Course Project V9',
    artifactKind: 'builder-capability-summary',
    isValidationSchema: false,
    scope: 'selected-builder-facing-capabilities',
    note: '此文件是紧凑能力摘要，不是 JSON Schema，也不替代权威 Zod 校验；路径为兼容旧索引保留。',
    protocolVersion: COURSE_PROJECT_SCHEMA_VERSION,
    validationAuthority: {
      kind: 'executable-zod-schema',
      module: 'src/shared/courseProjectSchema.ts',
      export: 'courseProjectDocumentSchema',
      relationship: 'referenced-not-derived',
    },
    surfaces: COURSE_SURFACE_TYPES,
    layerItemKinds: LAYER_ITEM_KINDS,
    nativeTypes: COURSE_NATIVE_TYPES,
    runtimeProtocols: {
      current: { protocol: 'surface-runtime', runtimeApiVersion: SURFACE_RUNTIME_API_VERSION },
    },
    // Compatibility key for Capability Index V1 consumers. These entries are
    // capability summaries, not standalone validation schemas.
    nativeTypeSchemas: Object.fromEntries(
      COURSE_NATIVE_TYPES.map((type) => [type, {
        nativeType: { const: type },
        ...nodeCapabilitySummary[type],
      }]),
    ),
    capabilitySources: [
      'src/shared/courseProjectTypes.ts',
      'scripts/generate-ai-capabilities.ts',
    ],
  }))
  files.set('schemas/published-course-v2.json', canonicalJson({
    contract: 'Published Course V2',
    artifactKind: 'builder-capability-summary',
    isValidationSchema: false,
    scope: 'selected-builder-facing-capabilities',
    note: '此文件是紧凑能力摘要，不是 JSON Schema，也不替代权威 Zod 校验；路径为兼容旧索引保留。',
    format: PUBLISHED_COURSE_FORMAT,
    formatVersion: PUBLISHED_COURSE_VERSION,
    surfaces: COURSE_SURFACE_TYPES,
    validationAuthority: {
      kind: 'executable-zod-schema',
      module: 'src/shared/publishedCourseSchema.ts',
      export: 'publishedCourseV2Schema',
      relationship: 'referenced-not-derived',
    },
    capabilitySources: [
      'src/shared/publishedCourseTypes.ts',
      'src/shared/courseProjectTypes.ts',
    ],
  }))
  files.set('schemas/interactions.json', canonicalJson({
    contract: 'Interaction Protocol V1',
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    discriminators: {
      trigger: INTERACTION_TRIGGER_TYPES,
      condition: INTERACTION_CONDITION_TYPES,
      action: INTERACTION_ACTION_TYPES,
    },
    schemas: {
      trigger: triggerJsonSchema,
      condition: conditionJsonSchema,
      action: actionJsonSchema,
      actionStep: jsonSchema(interactionActionStepSchema),
      rule: jsonSchema(interactionRuleSchema),
      scope: jsonSchema(sceneInteractionsSchema),
    },
    publishedPlayback: PUBLISHED_INTERACTION_PLAYBACK_SUPPORT,
    sourceOfTruth: [
      'src/shared/interactionTypes.ts',
      'src/shared/interactionSchema.ts',
      'src/shared/publishedInteractionSupport.ts',
      'src/player/interactions/PublishedInteractionController.ts',
      'src/player/surfaces/publishedCourseState.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
    ],
  }))
  files.set('schemas/runtime-api2.json', canonicalJson({
    contract: 'Runtime API 2',
    runtimeApiVersion: RUNTIME_API_VERSION,
    authoringApiVersion: RUNTIME_AUTHORING_API_VERSION,
    documentSchema: runtimeJsonSchema,
    hostContract: {
      scopes: RUNTIME_SCOPES,
      executionModes: RUNTIME_EXECUTION_MODES,
      renderModes: RUNTIME_RENDER_MODES,
      hostActions: runtimeHostActionNames,
      lifecycleHooks: runtimeLifecycleHooks,
      assessment: {
        invocation: 'ctx.assessment.evaluate',
        evaluators: ASSESSMENT_EVALUATOR_REGISTRY.map(({ id }) => id),
        hostEvidence: {
          schemaVersion: HOST_EVIDENCE_SCHEMA_VERSION,
          consolePrefix: HOST_EVIDENCE_CONSOLE_PREFIX,
          sessionStartBeforeRuntimeMount: true,
          recordKinds: [
            'assessment-evaluated',
            'action-recorded',
          ],
        },
      },
      evidence: {
        invocation: 'ctx.evidence.recordAction',
        actionKinds: RUNTIME_EVIDENCE_ACTION_KINDS,
        requiresTrustedDispatchedEvent: true,
        idPatterns: {
          actId: '^ACT-\\d{3,}$',
          responseId: '^RESP-\\d{3,}$',
        },
      },
      renderCapabilities: {
        phaser: ['phaser', 'nodes'],
        dom: ['dom'],
        hybrid: ['phaser', 'nodes', 'dom'],
      },
      courseState: {
        initialization: 'declared-defaults',
        ordinaryLocationNavigation: 'preserved-across-active-carriers',
        replayLocation: 'preserved',
        restartCourse: 'reset-to-declared-defaults',
        navigationActions: 'active-carrier-only; go-next-previous-cross-location-guarded; replay-same-location; restart-bypasses-guards-and-resets-defaults',
      },
    },
    publishedPlayback: {
      status: 'partial',
      supportedSlices: [
        {
          surface: 'slide',
          carrier: 'scene.layerItems',
          scope: 'scene-local',
          renderModes: ['dom', 'phaser', 'hybrid'],
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
          behavior: 'interactive-canvas-runtime-playback-with-partial-host-context',
        },
        {
          surfaces: ['slide', 'flow', 'spatial-2d'],
          carrier: 'globalLayerItems',
          scope: 'session-global',
          renderModes: ['dom', 'phaser', 'hybrid'],
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
          lifetime: 'one-instance-per-published-session-moved-between-surface-wrappers',
          behavior: 'interactive-canvas-runtime-playback-with-partial-host-context',
        },
      ],
      sharedServices: {
        courseState: 'declared-defaults-shared-across-active-published-carriers',
        hostActions: 'go-next-previous-cross-location-guarded; replay-same-location; restart-bypasses-guards-and-resets-defaults',
      },
      staticExport: {
        slideScene: 'enabled-api2-pptx-real-item-capture-and-pure-slide-pdf-page-capture',
        global: 'enabled-api2-real-capture-in-pure-slide-static-exports-only',
        flowAndSpatialDynamicCarriers: 'not-covered',
      },
      notCovered: [
        'surfaceLayerItems',
        'flow-or-spatial-scene-local',
        'declarative-runtime.event-trigger',
        'dynamic-runtime-navigation.guard',
        'global-local-runtime-shared-event-bus',
        'published-assessment-evidence-persistence',
        'node-resolution',
        'presentation-outside-slide-scene',
        'mixed-pdf-slide-dynamic-capture',
        'flow-or-spatial-dynamic-capture-pdf-or-pptx',
        'no-stable-host-local-interface-and-cross-export-network-parity',
      ],
    },
    documentation: 'docs/RUNTIME_AUTHORING.md',
    sourceOfTruth: [
      'src/shared/runtimeSchema.ts',
      'src/shared/runtimeTypes.ts',
      'src/player/HostEvidenceRecorder.ts',
      'src/player/RuntimeHost.ts',
      'src/player/surfaces/CoursePlayer.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
      'src/player/surfaces/runtime/publishedCanvasRuntimeMount.ts',
      'src/player/surfaces/runtime/publishedGlobalCanvasRuntimeOwner.ts',
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
      'src/player/surfaces/flow/FlowSurfaceHost.ts',
      'src/player/surfaces/spatial/SpatialSurfaceHost.ts',
      'src/player/surfaces/publishedCourseState.ts',
      'src/player/surfaces/publishedCapture.ts',
      'src/renderer/export/course/publishedSlideCapture.ts',
      'src/renderer/export/course/buildCoursePptx.ts',
      'src/renderer/export/course/buildCoursePrintArtifacts.ts',
    ],
  }))
  files.set('schemas/runtime-api3.json', canonicalJson({
    contract: 'Surface Runtime API 3',
    protocol: 'surface-runtime',
    runtimeApiVersion: SURFACE_RUNTIME_API_VERSION,
    renderMode: 'dom',
    publishedPlayback: {
      status: 'partial',
      supportedSlice: {
        surface: 'slide',
        carrier: 'scene.layerItems',
        scope: 'scene-local',
        renderMode: 'dom',
        consumers: [
          'current-location-try-run',
          'whole-course-preview',
          'single-html',
          'web-package',
        ],
        behavior: 'interactive-dom-playback',
      },
      supportedSlices: [
        {
          surface: 'slide',
          carrier: 'scene.layerItems',
          scope: 'scene-local',
          renderMode: 'dom',
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
          behavior: 'interactive-dom-playback',
        },
        {
          surface: 'flow',
          carrier: 'surfaceLayerItems',
          scope: 'surface-local',
          renderMode: 'dom',
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
          behavior: 'interactive-dom-playback',
        },
      ],
      sharedServices: {
        courseState: 'declared-defaults-shared-across-active-published-carriers',
        hostActions: 'go-next-previous-cross-location-guarded; replay-same-location; restart-bypasses-guards-and-resets-defaults',
      },
      staticExport: {
        slideScene: 'enabled-api3-pptx-real-item-capture-and-pure-slide-pdf-page-capture',
        flowAndSpatialDynamicCarriers: 'not-covered',
      },
      notCovered: [
        'spatial',
        'globalLayerItems-or-non-flow-surfaceLayerItems',
        'declarative-runtime.event-trigger',
        'presentation-outside-slide-scene',
        'mixed-pdf-slide-dynamic-capture',
        'flow-or-spatial-dynamic-capture-pdf-or-pptx',
        'stable-host-local-interfaces-and-cross-export-network-parity',
      ],
    },
    hostContract: {
      modes: ['playback', 'inspect', 'capture'],
      hostActions: runtimeHostActionNames,
      lifecycleHooks: surfaceRuntimeLifecycleHooks,
      authoring: surfaceRuntimeAuthoringMethods,
      content: ['ctx.content.get', 'ctx.content.all'],
      assets: ['ctx.assets.url', 'ctx.assets.projectUrl'],
      courseState: 'shared-published-session-store',
      publishedHostActions: 'active-carrier-only; go-next-previous-cross-location-guarded; replay-same-location; restart-bypasses-guards-and-resets-defaults',
    },
    documentation: 'docs/RUNTIME_AUTHORING.md',
    sourceOfTruth: [
      'src/shared/surfaceRuntimeTypes.ts',
      'src/renderer/ui/coursePlayerTryRun.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
      'src/player/surfaces/flow/FlowSurfaceHost.ts',
      'src/player/surfaces/runtime/publishedSurfaceRuntimeMount.ts',
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
      'src/player/surfaces/publishedCourseState.ts',
      'src/player/surfaces/publishedCapture.ts',
      'src/renderer/export/course/publishedSlideCapture.ts',
      'src/renderer/export/course/buildCoursePptx.ts',
      'src/renderer/export/course/buildCoursePrintArtifacts.ts',
    ],
  }))
  files.set('schemas/component-api4.json', canonicalJson({
    contract: 'Component Schema 4 / Component Runtime API 4',
    componentSchemaVersion: COMPONENT_SCHEMA_VERSION,
    runtimeApiVersion: COMPONENT_RUNTIME_API_VERSION,
    manifestSchema: componentJsonSchema,
    hostContract: {
      scopes: COMPONENT_SCOPES,
      modes: COMPONENT_EXECUTION_MODES,
      renderModes: COMPONENT_RENDER_MODES,
      hostActions: componentHostActionNames,
      lifecycleHooks: componentLifecycleHooks,
      visibleTextAuthority: 'props.content',
      optionalAuthoringTargets: [
        'DOM data-courseware-edit-key',
        'ctx.editor.registerTextRegion',
      ],
      courseState: 'shared-published-session-store',
      publishedHostActions: 'active-carrier-only; go-next-previous-cross-location-guarded; replay-same-location; restart-bypasses-guards-and-resets-defaults',
    },
    publishedPlayback: {
      status: 'partial',
      supportedSlices: componentPublishedPlaybackSlices,
      staticExport: componentPublishedStaticExport,
      notCovered: componentPublishedPlaybackNotCovered,
    },
    documentation: 'docs/COMPONENT_AUTHORING.md',
    sourceOfTruth: [
      'src/shared/componentSchema.ts',
      'src/shared/componentTypes.ts',
      'src/player/surfaces/publishedComponentMount.ts',
      'src/player/surfaces/slide/publishedSlidePhaserComponentMount.ts',
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
      'src/player/surfaces/flow/FlowSurfaceHost.ts',
      'src/player/surfaces/spatial/SpatialSurfaceHost.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
      'src/player/surfaces/publishedCourseState.ts',
      'src/player/surfaces/publishedCapture.ts',
      'src/renderer/export/course/publishedSlideCapture.ts',
      'src/renderer/export/course/buildCoursePptx.ts',
      'src/renderer/export/course/buildCoursePrintArtifacts.ts',
    ],
  }))
  files.set('diagnostics.json', canonicalJson({
    artifactVersion: 2,
    courseProjectValidation: {
      reportVersion: 1,
      target: {
        version: COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
        stableIdentity: 'course-project-v9-ids-only',
        kinds: COURSE_PROJECT_DIAGNOSTIC_TARGET_KINDS,
        unresolvedFallback: 'project',
        schemaInvalid: 'omitted',
      },
      fatalCodes: COURSE_PROJECT_VALIDATION_FATAL_CODES,
      schemaIssueCodes: 'zod-issue-code',
      findingCodes: COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER,
      projectHealth: {
        collector: 'collectCourseProjectHealth',
        input: 'schema-valid-course-project-v9-plus-opened-archive-files',
        ordering: 'severity-path-code-message',
        target: 'required-diagnostic-target-v1',
        readOnly: true,
        contentChecks: {
          math: 'native-and-flow-AST-slots; explicit 公式：linear parse; shared-native-formula-layout-warnings',
          answer: 'explicit 答案：option text compared with one unambiguous product single-choice finite evaluator',
          chart: 'explicit 图表：title / series / category = number compared with same-owner chart data',
          source: 'explicit source label and Flow quote citation missing-location checks',
          outputs: ['severity', 'code', 'target', 'message', 'evidence', 'suggestion'],
          exclusions: ['general-natural-language-correctness', 'opaque-extension-evaluators', 'source-authenticity'],
        },
        domains: [
          { id: 'content', collector: 'collectCourseProjectContentHealth', source: 'src/shared/courseProjectHealth/content.ts' },
          {
            id: 'runtime',
            collector: 'collectCourseProjectRuntimeHealth',
            source: 'src/shared/courseProjectHealth/runtime.ts',
          },
          {
            id: 'interaction',
            collector: 'collectCourseProjectInteractionHealth',
            source: 'src/shared/courseProjectHealth/interaction.ts',
          },
          {
            id: 'component',
            collector: 'collectCourseProjectComponentHealth',
            source: 'src/shared/courseProjectHealth/component.ts',
          },
          {
            id: 'controller-media',
            collector: 'collectCourseProjectControllerMediaHealth',
            source: 'src/shared/courseProjectHealth/controllerMedia.ts',
          },
          {
            id: 'native',
            collector: 'collectCourseProjectNativeHealth',
            source: 'src/shared/courseProjectHealth/native.ts',
          },
        ],
      },
      onlinePackagePreflight: {
        collector: 'collectCoursePackageExportPreflight',
        cliStatus: 'upstream-filtered',
        status: 'partial',
        scope: 'online-lightweight-single-html',
        literalApis: [
          'fetch',
          'WebSocket',
          'EventSource',
          'navigator.sendBeacon',
          'XMLHttpRequest.open',
        ],
        undeclaredStaticOrigin: 'blocking-error',
        unresolvedOrigin: 'warning',
        limitations: 'no-wrapper-alias-or-general-javascript-data-flow-analysis',
        source: 'src/renderer/export/course/coursePackagePreflight.ts',
      },
      sourceOfTruth: 'src/shared/courseProjectValidationDiagnostics.ts',
      contract: 'docs/contracts/COURSE_PROJECT_VALIDATION_REPORT_V1.md',
    },
  }))
  files.set('limits.json', canonicalJson({
    protocolVersions: currentProtocols,
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    guidance: {
      recommendedProjectScenes: RECOMMENDED_PROJECT_SCENES,
      recommendedSceneNodes: RECOMMENDED_SCENE_NODES,
    },
    defensive: {
      maxProjectScenes: MAX_PROJECT_SCENES,
      maxSceneNodes: MAX_SCENE_NODES,
      maxGlobalLayerItems: MAX_SCENE_NODES,
      maxScenePresentationStates: MAX_SCENE_PRESENTATION_STATES,
      maxSceneInteractions: MAX_SCENE_INTERACTIONS,
      maxInteractionConditions: MAX_INTERACTION_CONDITIONS,
      maxInteractionActions: MAX_INTERACTION_ACTIONS,
      maxRuntimeSourceBytes: MAX_RUNTIME_SOURCE_BYTES,
      maxRuntimeContentEntries: MAX_RUNTIME_CONTENT_ENTRIES,
      maxRuntimeAssetBindings: MAX_RUNTIME_ASSET_BINDINGS,
      maxRuntimeNodeBindings: MAX_RUNTIME_NODE_BINDINGS,
      maxHistorySteps: MAX_HISTORY_STEPS,
      minNodeSize: MIN_NODE_SIZE,
      minVisibleNodeEdge: MIN_VISIBLE_NODE_EDGE,
      singleHtmlWarningBytes: SINGLE_HTML_WARNING_BYTES,
      singleHtmlHardLimitBytes: SINGLE_HTML_HARD_LIMIT_BYTES,
      aiCapabilityIndexMaxBytes: AI_CAPABILITY_INDEX_MAX_BYTES,
    },
    note: '推荐值用于可维护性；防御上限用于损坏与滥用保护，不是日常创作目标。',
    sourceOfTruth: [
      'src/shared/constants.ts',
      'src/shared/courseProjectTypes.ts',
      'src/shared/interactionTypes.ts',
      'src/shared/runtimeSchema.ts',
      'src/renderer/export/exportSize.ts',
    ],
  }))
  files.set(
    'component-catalog.snapshot.json',
    canonicalJson(componentCatalogSnapshot),
  )

  const downstreamEvidence = artifactEvidence(files)
  const index = {
    manifestVersion: AI_CAPABILITY_MANIFEST_VERSION,
    editorVersion: APP_VERSION,
    protocols: currentProtocols,
    surfaces: {
      types: COURSE_SURFACE_TYPES,
      status: 'available',
    },
    layerItemKinds: LAYER_ITEM_KINDS,
    nodes: COURSE_NATIVE_TYPES.map((type) => ({
      type,
      ...nodeCapabilitySummary[type],
      schema: `schemas/course-project-v9.json#/nativeTypeSchemas/${type}`,
      schemaRole: 'builder-capability-summary',
    })),
    interactions: {
      schema: 'schemas/interactions.json',
      triggerTypes: INTERACTION_TRIGGER_TYPES,
      conditionTypes: INTERACTION_CONDITION_TYPES,
      actionTypes: INTERACTION_ACTION_TYPES,
      publishedPlayback: PUBLISHED_INTERACTION_PLAYBACK_SUPPORT,
      authoringModes: {
        simple: 'limited-entrance-animation-authoring',
        professional: 'all-contract-rule-types-authorable-see-publishedPlayback',
      },
      courseLogicAuthoring: {
        courseState: 'professional-gui-and-undoable-commands',
        navigationGuards: 'professional-gui-and-undoable-commands',
        commitValidation: 'full-course-project-v9-schema',
      },
      scopes: RUNTIME_SCOPES,
    },
    assessmentEvaluators: ASSESSMENT_EVALUATOR_REGISTRY,
    recipes: {
      catalog: RECIPE_CATALOG.map(({ id, version, label }) => ({ id, version, label })),
      sourceOfTruth: 'src/renderer/recipes/recipeCatalog.ts',
      builder: 'api.recipes.planRecipe',
      output: 'ordinary-course-project-v9-with-atomic-resource-transaction',
      authoringScope: 'new-slide-scene',
    },
    designProductivity: {
      referenceClone: 'same-project-slide-scene-with-remapped-identities',
      batchReplace: 'selected-formal-text-fields-with-preview-and-stale-rejection',
      projectPalette: 'designTokens.colors',
      tokenApply: 'selected-color-properties-with-preview-and-single-undo;no-live-binding',
      diagnostics: 'read-only-severity-and-surface-groups-with-stable-target-navigation',
    },
    runtime: {
      versions: [RUNTIME_API_VERSION, SURFACE_RUNTIME_API_VERSION],
      schema: 'schemas/runtime-api2.json',
      surfaceSchema: 'schemas/runtime-api3.json',
      authoringModes: ['professional'],
      scopes: RUNTIME_SCOPES,
      exports: {
        singleHtml: 'partial:slide-scene-api2-dom-phaser-hybrid-plus-slide-scene-flow-surface-api3-dom-interactive',
        webPackage: 'partial:slide-scene-api2-dom-phaser-hybrid-plus-slide-scene-flow-surface-api3-dom-interactive',
        pdf: 'pure-slide-real-published-page-capture; mixed-slide-static-composition; flow-spatial-static-representation',
        pptx: 'enabled-slide-scene-api2-api3-real-item-capture; enabled-global-api2-only-in-pure-slide; authored-fallback-or-visible-placeholder-otherwise',
      },
    },
    components: {
      schema: 'schemas/component-api4.json',
      catalog: 'component-catalog.snapshot.json',
      catalogVersion: COMPONENT_CATALOG_VERSION,
      catalogStatus: componentCatalogSnapshot.status,
      packageAdmission: {
        requiredAvailability: 'available',
        allowedQualitiesForRelease: ['stable'],
        experimentalRequiresExplicitCaseApproval: true,
        releaseBlockersMustBeEmpty: true,
        licenseStatusMustBe: 'verified',
        maintainerMustBeAssigned: true,
      },
      authoringModes: ['professional'],
      scopes: ['manifest-dependent'],
      publishedPlayback: {
        status: 'partial',
        provenSlices: componentPublishedPlaybackSlices,
        staticExport: componentPublishedStaticExport,
        notCovered: componentPublishedPlaybackNotCovered,
      },
      exports: {
        singleHtml: 'partial:local-dom-carriers-plus-slide-scene-phaser-interactive; global-component-session-lifetime-not-covered',
        webPackage: 'partial:local-dom-carriers-plus-slide-scene-phaser-interactive; global-component-session-lifetime-not-covered',
        pdf: 'pure-slide-real-published-capture; other-surfaces-static-fallback-or-label',
        pptx: 'slide-real-published-capture-with-authored-fallback-or-visible-placeholder; global-only-in-pure-slide',
      },
    },
    publishedCourse: 'schemas/published-course-v2.json',
    publishedCourseRole: 'builder-capability-summary',
    publishedCourseValidationAuthority:
      'src/shared/publishedCourseSchema.ts#publishedCourseV2Schema',
    diagnostics: 'diagnostics.json',
    limits: 'limits.json',
    validation: {
      command: 'npm run --silent validate:course-project -- <project.h5lesson>',
      input: 'Course Project V9 .h5lesson',
      output: 'stable-json',
      reportVersion: 1,
      contract: 'docs/contracts/COURSE_PROJECT_VALIDATION_REPORT_V1.md',
      findingCodeLedger: 'diagnostics.json#/courseProjectValidation/findingCodes',
      diagnosticTargetVersion: COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
      schemaInvalid: {
        status: 'unreadable',
        exitCode: 2,
        semanticSections: 'all-null',
        canExport: false,
      },
      semanticCoverage: 'current-wired-only-see-code-ledger',
      checks: [
        'course-project-v9-schema',
        'assets-and-components',
        'runtime-component-protocol',
        'single-html-preflight',
        'web-package-preflight',
        'pdf-preflight',
        'pptx-preflight',
        'stable-ids',
        'no-v8-fields-or-migration-markers',
        'v9-project-health-runtime-interaction-component-controller-media',
      ],
      exitCodes: {
        valid: 0,
        diagnosedErrors: 1,
        unreadableOrUsageError: 2,
      },
      execution: 'node-only-no-electron-no-export-no-write',
      layoutMeasurement: 'browser-canvas-or-declared-deterministic-fallback',
    },
    headlessBuild: {
      language: 'typescript',
      runner: 'npm --prefix <editor-root> run --silent build:courseware-case -- --case-dir <case-dir> --builder implementation/build.ts --project <relative-output.h5lesson> --html <relative-output.html>',
      caseDirectory: 'may-be-outside-editor-repository-and-need-not-be-git',
      builderContract: 'src/renderer/course/coursewareBuilderV2.ts',
      apiVersion: 2,
      compatibilityContract: 'src/renderer/course/coursewareCaseBuilderApi.ts',
      authoringTools: 'src/renderer/authoring/tools/authoringToolFacade.ts',
      execution: 'product-managed-chromium-private-session',
      entrypoints: {
        externalCaseBuilder: 'scripts/build-courseware-case.ts',
        createCourseProject: 'src/renderer/project/createCourseProject.ts',
        courseProjectArchive: 'src/renderer/project/courseProjectArchive.ts',
        importComponentPackage: 'src/renderer/components/importComponentPackage.ts',
        courseProjectSchema: 'src/shared/courseProjectSchema.ts',
      },
      output: 'Course Project V9 .h5lesson and offline HTML inside case-dir',
      constraints: [
        'case-builder-receives-real-repository-apis-through-versioned-facade',
        'export-apiVersion-2-and-return-registered-session-finish-result',
        'all-writes-via-canonical-tools-with-per-step-receipts',
        'dynamic-candidates-require-fixed-real-host-admission',
        'no-editor-internal-imports-from-case-module',
        'all-inputs-and-outputs-remain-inside-case-dir',
        'no-shadow-project-dsl',
        'preserve-stable-ids-after-human-edits',
      ],
    },
    importSurfaces: {
      pptx: {
        entry: 'manual-ui-only',
        editable: 'text-shape-line-rounded-process-png-jpeg-crop-ordinary-group-unmerged-table',
        inheritance: 'master-layout-shared-surface-items-with-location-visibility;scene-placeholder-instances;recursive-group-text-role',
        unsupported: 'merged-table-chart-smartart-ole-equation-complex-effects;explicit-report-before-partial-import',
        backend: 'local-parser;no-office-or-external-renderer',
        commit: 'single-document-and-sidecar-transaction',
      },
    },
    exportSurfaces: {
      singleHtml: {
        interactivity: 'preserved',
        resources: 'selectable-inline-or-declared-remote',
        modes: {
          offlinePortable: 'all-published-assets-inline',
          onlineLightweight: 'referenced-project-assets-with-remote-url-remote-others-inline; saved-bytes-required-at-build-even-for-remote-delivery',
        },
        networkPolicy: 'exact-declared-origins-no-remote-script',
      },
      webPackage: { interactivity: 'preserved', resources: 'relative-files' },
      pdf: {
        interactivity: 'omitted',
        representation: 'pure-slide-published-capture-plus-mixed-flow-spatial-static-rendering',
      },
      pptx: {
        interactivity: 'omitted',
        representation: 'slide-native-editable-plus-published-dynamic-capture-with-explicit-fallback',
      },
    },
    previewSurfaces: {
      host: 'main-renderer-published-v2',
      consumers: ['current-location-try-run', 'whole-course-preview'],
      resources: {
        remoteProjectAssets: 'remote-only-project-assets-not-supported-by-current-producer',
        localProjectAssets: 'required-saved-bytes-inline-data-url-in-authoring-and-preview',
        componentAssets: 'inline-data-url',
      },
      networkPolicy: {
        declaredConnectOrigins: ['https', 'wss'],
        enforcement: 'editor-scheme-csp-plus-main-session-exact-origin-leases',
        leaseLifetime: 'published-session-and-document-generation',
        corsTls: 'browser-enforced',
        remoteScripts: 'blocked',
      },
    },
    documentation: {
      authoring: '.agents/skills/build-courseware-project/SKILL.md',
      runtime: 'docs/RUNTIME_AUTHORING.md',
      component: 'docs/COMPONENT_AUTHORING.md',
    },
    artifacts: downstreamEvidence,
    hashScope: '索引只记录下级生成物哈希；generation-evidence 另行记录索引哈希，两者均不自哈希。',
  }
  assertIndexWithinLimit(index)
  files.set('index.json', canonicalJson(index))
  const capabilityBundle = await addDiscoveryArtifacts(projectRoot, files, componentCatalogSnapshot)

  const indexedOutput = new Map(files)
  files.set('generation-evidence.json', canonicalJson({
    evidenceVersion: 1,
    generator: 'scripts/generate-ai-capabilities.ts',
    deterministic: true,
    generatedAt: null,
    note: '为保持相同输入的字节级确定性，证据不写入时钟或绝对路径。',
    protocols: currentProtocols,
    inputs: {
      sourceDiscovery: {
        kind: 'transitive-local-module-closure',
        entrypoints: AI_CAPABILITY_PROVENANCE_ENTRYPOINTS,
        aliases: { '@/': 'src/' },
        includesTypeOnlyEdges: true,
      },
      sourceFiles: await sourceEvidence(projectRoot),
      headlessBuildFiles: await directFileEvidence(projectRoot, HEADLESS_BUILD_EVIDENCE_FILES),
      componentCatalog: {
        status: componentCatalogSnapshot.status,
        expectedCatalogSha256:
          componentCatalogSnapshot.source.expectedCatalogSha256,
        ...(componentCatalogSnapshot.source.actualCatalogSha256 === undefined
          ? {}
          : {
              actualCatalogSha256:
                componentCatalogSnapshot.source.actualCatalogSha256,
            }),
        packages: componentCatalogSnapshot.packages.map((entry) => ({
          identity: `${entry.packageId}@${entry.version}`,
          expectedSha256: entry.sha256,
          ...(entry.actualSha256 === undefined
            ? {}
            : { actualSha256: entry.actualSha256 }),
          availability: entry.availability,
        })),
      },
    },
    output: artifactEvidence(indexedOutput),
    hashScope: '证据记录 index.json 和全部下级生成物；不记录 generation-evidence.json 自身哈希。',
  }))

  return {
    files,
    capabilityBundle,
    indexBytes: Buffer.byteLength(files.get('index.json')!, 'utf8'),
    componentCatalogStatus: componentCatalogSnapshot.status,
  }
}

async function listJsonFiles(rootPath: string): Promise<string[]> {
  const output: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() && /\.(json|md|mjs)$/.test(entry.name)) {
        output.push(path.relative(rootPath, absolute).replaceAll('\\', '/'))
      }
    }
  }
  await visit(rootPath)
  return output.sort((left, right) => left.localeCompare(right, 'en'))
}

export async function writeAiCapabilityArtifacts(
  outputRoot: string,
  generated: AiCapabilityGenerationResult,
): Promise<void> {
  for (const [relativePath, content] of generated.files) {
    const absolute = path.join(outputRoot, ...relativePath.split('/'))
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, content, 'utf8')
  }
  const expectedPaths = new Set(generated.files.keys())
  for (const relativePath of await listJsonFiles(outputRoot)) {
    if (expectedPaths.has(relativePath)) continue
    await fs.rm(path.join(outputRoot, ...relativePath.split('/')), { force: true })
  }
}

export async function checkAiCapabilityArtifacts(
  outputRoot: string,
  generated: AiCapabilityGenerationResult,
): Promise<void> {
  const failures: string[] = []
  const stalePaths: string[] = []
  for (const [relativePath, expected] of generated.files) {
    const absolute = path.join(outputRoot, ...relativePath.split('/'))
    let actual: string
    try {
      actual = await fs.readFile(absolute, 'utf8')
    } catch {
      failures.push(`缺失 ${relativePath}`)
      continue
    }
    if (actual !== expected) stalePaths.push(relativePath)
  }
  const staleCapabilityPaths = stalePaths.filter(
    (relativePath) => relativePath !== 'generation-evidence.json',
  )
  if (staleCapabilityPaths.length > 0) {
    failures.push(
      ...staleCapabilityPaths.map(
        (relativePath) => `能力生成物过期 ${relativePath}`,
      ),
    )
  } else if (stalePaths.includes('generation-evidence.json')) {
    failures.push('来源溯源证据过期 generation-evidence.json')
  }
  const expectedPaths = new Set(generated.files.keys())
  for (const relativePath of await listJsonFiles(outputRoot)) {
    if (!expectedPaths.has(relativePath)) failures.push(`多余 ${relativePath}`)
  }
  if (failures.length > 0) {
    throw new Error(
      `AI 能力清单生成检查失败：\n${failures.map((item) => `- ${item}`).join('\n')}\n` +
      '请运行 npm run generate:ai-capabilities 后重试。',
    )
  }
}

interface CliOptions {
  check: boolean
  projectRoot: string
  outputRoot: string
  componentCatalogRoot?: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let check = false
  let projectRoot = defaultProjectRoot
  let outputRoot: string | undefined
  let componentCatalogRoot: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--project-root' || argument === '--output-root' || argument === '--catalog-root') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${argument} 缺少路径参数。`)
      index += 1
      if (argument === '--project-root') projectRoot = path.resolve(value)
      else if (argument === '--output-root') outputRoot = path.resolve(value)
      else componentCatalogRoot = path.resolve(value)
      continue
    }
    throw new Error(`未知参数：${argument}`)
  }
  return {
    check,
    projectRoot,
    outputRoot: outputRoot ?? path.join(projectRoot, 'artifacts', 'ai-capabilities'),
    ...(componentCatalogRoot === undefined ? {} : { componentCatalogRoot }),
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const generated = await generateAiCapabilityArtifacts({
    projectRoot: options.projectRoot,
    ...(options.componentCatalogRoot === undefined
      ? {}
      : { componentCatalogRoot: options.componentCatalogRoot }),
  })
  if (options.check) {
    await checkAiCapabilityArtifacts(options.outputRoot, generated)
    if (options.outputRoot === path.join(options.projectRoot, 'artifacts', 'ai-capabilities')) {
      const bundle = await fs.readFile(path.join(options.projectRoot, 'src/shared/generated/courseAgentCapabilities.json'), 'utf8').catch(() => '')
      if (bundle !== generated.capabilityBundle) throw new Error('打包能力资源过期，请运行 generate:ai-capabilities')
    }
    console.log(
      `AI 能力清单已是最新状态；索引 ${generated.indexBytes} / ${AI_CAPABILITY_INDEX_MAX_BYTES} 字节，组件目录 ${generated.componentCatalogStatus}。`,
    )
    return
  }
  await writeAiCapabilityArtifacts(options.outputRoot, generated)
  if (options.outputRoot === path.join(options.projectRoot, 'artifacts', 'ai-capabilities')) {
    const target = path.join(options.projectRoot, 'src/shared/generated/courseAgentCapabilities.json')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, generated.capabilityBundle, 'utf8')
  }
  console.log(
    `已生成 ${generated.files.size} 个 AI 能力文件；索引 ${generated.indexBytes} / ${AI_CAPABILITY_INDEX_MAX_BYTES} 字节，组件目录 ${generated.componentCatalogStatus}。`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
