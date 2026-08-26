import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
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
  NATIVE_EXPORT_PREFLIGHT_CODES,
  PROJECT_HEALTH_CODES,
} from '../src/shared/diagnosticCodes'
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
import {
  HOST_EVIDENCE_CONSOLE_PREFIX,
  HOST_EVIDENCE_SCHEMA_VERSION,
} from '../src/player/HostEvidenceRecorder'
import {
  SINGLE_HTML_HARD_LIMIT_BYTES,
  SINGLE_HTML_WARNING_BYTES,
} from '../src/renderer/export/exportSize'

export const AI_CAPABILITY_INDEX_MAX_BYTES = 16_384
export const AI_CAPABILITY_MANIFEST_VERSION = 1 as const
export const INTERACTION_PROTOCOL_VERSION = 1 as const

export const COURSE_NATIVE_TYPES = [
  'text',
  'formula',
  'image',
  'video',
  'shape',
  'teacher-controller',
] as const

type CourseNativeType = typeof COURSE_NATIVE_TYPES[number]

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

type AssertExactly<Left, Right> =
  [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
    ? true
    : never

const runtimeHostActionNames = [
  'goToScene',
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
  'goToScene',
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
  'teacher-controller': {
    label: '教师控制器',
    authoringModes: ['professional'],
    authoringScopes: ['global'],
    exports: {
      singleHtml: 'interactive',
      webPackage: 'interactive',
      pdf: 'omitted-by-default',
      pptx: 'omitted-by-default',
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
 * Direct provenance inputs of the generated capability artifacts: the files this
 * generator reads or imports, plus the contracts whose declared text the output
 * quotes. Broad main/preload/Player/preview/archive/export producer implementations
 * are deliberately excluded — they carry the behaviour the capabilities describe,
 * not the bytes the artifacts are generated from, so listing them only churns the
 * evidence on unrelated edits. Keep this list narrow.
 */
const AI_CAPABILITY_SOURCE_EVIDENCE_PATHS = [
  'package.json',
  'scripts/generate-ai-capabilities.ts',
  'scripts/validate-project.ts',
  'docs/contracts/COURSE_PROJECT_VALIDATION_REPORT_V1.md',
  'src/renderer/components/importComponentPackage.ts',
  'src/renderer/export/exportSize.ts',
  'src/player/HostEvidenceRecorder.ts',
  'src/shared/assessmentEvaluators.ts',
  'src/shared/builtInComponentCatalog.ts',
  'src/shared/componentCatalog.ts',
  'src/shared/componentContentIntegrity.ts',
  'src/shared/componentSchema.ts',
  'src/shared/componentTypes.ts',
  'src/shared/constants.ts',
  'src/shared/courseProjectSchema.ts',
  'src/shared/courseProjectTypes.ts',
  'src/shared/courseProjectValidationDiagnostics.ts',
  'src/shared/diagnosticCodes.ts',
  'src/shared/interactionSchema.ts',
  'src/shared/interactionTypes.ts',
  'src/shared/publishedCourseSchema.ts',
  'src/shared/publishedCourseTypes.ts',
  'src/shared/runtimeSchema.ts',
  'src/shared/runtimeTypes.ts',
  'src/shared/surfaceRuntimeTypes.ts',
] as const

async function sourceEvidence(projectRoot: string): Promise<Array<{
  path: string
  sha256: string
}>> {
  const sources = AI_CAPABILITY_SOURCE_EVIDENCE_PATHS
  return Promise.all(sources.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await fs.readFile(path.join(projectRoot, relativePath))),
  })))
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
    protocolVersion: COURSE_PROJECT_SCHEMA_VERSION,
    validation: 'zod:src/shared/courseProjectSchema.ts#courseProjectDocumentSchema',
    root: {
      type: 'object',
      properties: {
        schemaVersion: { const: COURSE_PROJECT_SCHEMA_VERSION },
      },
      required: [
        'schemaVersion', 'id', 'revision', 'title', 'createdAt', 'updatedAt',
        'assets', 'componentPackages', 'designTokens', 'media', 'playback',
        'courseState', 'navigationGuards', 'locations', 'startLocationId',
        'globalLayerItems', 'globalInteractions', 'surfaces',
      ],
    },
    surfaces: COURSE_SURFACE_TYPES,
    layerItemKinds: LAYER_ITEM_KINDS,
    nativeTypes: COURSE_NATIVE_TYPES,
    runtimeProtocols: {
      current: { protocol: 'surface-runtime', runtimeApiVersion: SURFACE_RUNTIME_API_VERSION },
    },
    nativeTypeSchemas: Object.fromEntries(
      COURSE_NATIVE_TYPES.map((type) => [type, {
        nativeType: { const: type },
        ...nodeCapabilitySummary[type],
      }]),
    ),
    sourceOfTruth: 'src/shared/courseProjectSchema.ts',
  }))
  files.set('schemas/published-course-v2.json', canonicalJson({
    contract: 'Published Course V2',
    format: PUBLISHED_COURSE_FORMAT,
    formatVersion: PUBLISHED_COURSE_VERSION,
    surfaces: COURSE_SURFACE_TYPES,
    sourceOfTruth: [
      'src/shared/publishedCourseTypes.ts',
      'src/shared/publishedCourseSchema.ts',
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
    sourceOfTruth: [
      'src/shared/interactionTypes.ts',
      'src/shared/interactionSchema.ts',
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
        ordinarySceneNavigation: 'preserved',
        replayScene: 'preserved',
        restartCourse: 'cleared',
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
      notCovered: [
        'surfaceLayerItems',
        'flow-or-spatial-scene-local',
        'runtime.event-or-host-actions',
        'node-resolution-or-presentation',
        'scene-local-cross-surface-courseState',
        'capture-pdf-or-pptx',
        'host-local-capabilities',
      ],
    },
    documentation: 'docs/RUNTIME_AUTHORING.md',
    sourceOfTruth: [
      'src/shared/runtimeSchema.ts',
      'src/shared/runtimeTypes.ts',
      'src/player/HostEvidenceRecorder.ts',
      'src/player/RuntimeHost.ts',
      'src/player/CourseRuntimeKernel.ts',
      'src/player/PlayerApp.ts',
      'src/player/surfaces/runtime/publishedCanvasRuntimeMount.ts',
      'src/player/surfaces/runtime/publishedGlobalCanvasRuntimeOwner.ts',
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
      'src/player/surfaces/flow/FlowSurfaceHost.ts',
      'src/player/surfaces/spatial/SpatialSurfaceHost.ts',
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
      notCovered: [
        'spatial',
        'globalLayerItems-or-non-flow-surfaceLayerItems',
        'runtime.event-or-host-actions',
        'cross-surface-courseState-or-presentation',
        'capture-pdf-or-pptx',
        'network-or-host-local-capabilities',
      ],
    },
    hostContract: {
      modes: ['playback', 'inspect', 'capture'],
      hostActions: runtimeHostActionNames,
      lifecycleHooks: surfaceRuntimeLifecycleHooks,
      authoring: surfaceRuntimeAuthoringMethods,
      content: ['ctx.content.get', 'ctx.content.all'],
      assets: ['ctx.assets.url', 'ctx.assets.projectUrl'],
    },
    documentation: 'docs/RUNTIME_AUTHORING.md',
    sourceOfTruth: [
      'src/shared/surfaceRuntimeTypes.ts',
      'src/renderer/ui/coursePlayerTryRun.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
      'src/player/surfaces/flow/FlowSurfaceHost.ts',
      'src/player/surfaces/runtime/publishedSurfaceRuntimeMount.ts',
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
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
    },
    publishedPlayback: {
      status: 'partial',
      supportedSlices: [
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
        },
      ],
      notCovered: [
        'phaser-global-or-surface-shared',
        'phaser-flow-or-spatial',
        'hybrid-published-parity',
        'capture-pdf-or-pptx',
        'component-event-or-host-actions-parity',
      ],
    },
    documentation: 'docs/COMPONENT_AUTHORING.md',
    sourceOfTruth: [
      'src/shared/componentSchema.ts',
      'src/shared/componentTypes.ts',
      'src/player/surfaces/publishedComponentMount.ts',
      'src/player/surfaces/slide/publishedSlidePhaserComponentMount.ts',
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
    ],
  }))
  files.set('diagnostics.json', canonicalJson({
    registryVersion: 1,
    projectHealth: PROJECT_HEALTH_CODES,
    nativeExportPreflight: NATIVE_EXPORT_PREFLIGHT_CODES,
    projectedProjectHealthForExport: PROJECT_HEALTH_CODES.map(
      (code) => `project-health:${code}`,
    ),
    legacyRegistryScope: 'Project V8 editor/export registry; not the active Course Project V9 CLI finding ledger.',
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
        domains: [
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
        ],
        networkDeclarationParity: 'deferred',
      },
      sourceOfTruth: 'src/shared/courseProjectValidationDiagnostics.ts',
      contract: 'docs/contracts/COURSE_PROJECT_VALIDATION_REPORT_V1.md',
    },
    sourceOfTruth: 'src/shared/diagnosticCodes.ts',
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
    })),
    interactions: {
      schema: 'schemas/interactions.json',
      triggerTypes: INTERACTION_TRIGGER_TYPES,
      conditionTypes: INTERACTION_CONDITION_TYPES,
      actionTypes: INTERACTION_ACTION_TYPES,
      authoringModes: {
        simple: 'limited-entrance-animation-authoring',
        professional: 'full-rule-authoring',
      },
      scopes: RUNTIME_SCOPES,
    },
    assessmentEvaluators: ASSESSMENT_EVALUATOR_REGISTRY,
    runtime: {
      versions: [RUNTIME_API_VERSION, SURFACE_RUNTIME_API_VERSION],
      schema: 'schemas/runtime-api2.json',
      surfaceSchema: 'schemas/runtime-api3.json',
      authoringModes: ['professional'],
      scopes: RUNTIME_SCOPES,
      exports: {
        singleHtml: 'partial:slide-scene-api2-dom-phaser-hybrid-plus-slide-scene-flow-surface-api3-dom-interactive',
        webPackage: 'partial:slide-scene-api2-dom-phaser-hybrid-plus-slide-scene-flow-surface-api3-dom-interactive',
        pdf: 'captured-with-static-fallback',
        pptx: 'captured-per-runtime-with-static-fallback',
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
        provenSlices: [
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
          },
        ],
        notCovered: [
          'phaser-global-or-surface-shared',
          'phaser-flow-or-spatial',
          'hybrid-published-parity',
          'capture-pdf-or-pptx',
          'component-event-or-host-actions-parity',
        ],
      },
      exports: {
        singleHtml: 'partial:dom-carriers-plus-slide-scene-phaser-interactive',
        webPackage: 'partial:dom-carriers-plus-slide-scene-phaser-interactive',
        pdf: 'isolated-static-capture',
        pptx: 'isolated-static-capture',
      },
    },
    publishedCourse: 'schemas/published-course-v2.json',
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
      runner: 'npx tsx --tsconfig <editor-root>/tsconfig.json <case-dir>/implementation/build.ts',
      entrypoints: {
        createCourseProject: 'src/renderer/project/createCourseProject.ts',
        courseProjectArchive: 'src/renderer/project/courseProjectArchive.ts',
        importComponentPackage: 'src/renderer/components/importComponentPackage.ts',
        courseProjectSchema: 'src/shared/courseProjectSchema.ts',
      },
      output: 'Course Project V9 .h5lesson',
      constraints: [
        'use-real-repository-apis',
        'no-shadow-project-dsl',
        'preserve-stable-ids-after-human-edits',
      ],
    },
    exportSurfaces: {
      singleHtml: {
        interactivity: 'preserved',
        resources: 'selectable-inline-or-declared-remote',
        modes: {
          offlinePortable: 'all-published-assets-inline',
          onlineLightweight: 'referenced-project-assets-with-remote-url-remote-others-inline',
        },
        networkPolicy: 'exact-declared-origins-no-remote-script',
      },
      webPackage: { interactivity: 'preserved', resources: 'relative-files' },
      pdf: { interactivity: 'omitted', representation: 'player-capture' },
      pptx: { interactivity: 'omitted', representation: 'native-plus-static-fallback' },
    },
    previewSurfaces: {
      host: 'main-renderer-published-v2',
      consumers: ['current-location-try-run', 'whole-course-preview'],
      resources: {
        remoteProjectAssets: 'actual-published-references-with-https-remote-url',
        localProjectAssets: 'inline-data-url',
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

  const indexedOutput = new Map(files)
  files.set('generation-evidence.json', canonicalJson({
    evidenceVersion: 1,
    generator: 'scripts/generate-ai-capabilities.ts',
    deterministic: true,
    generatedAt: null,
    note: '为保持相同输入的字节级确定性，证据不写入时钟或绝对路径。',
    protocols: currentProtocols,
    inputs: {
      sourceFiles: await sourceEvidence(projectRoot),
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
      else if (entry.isFile() && entry.name.endsWith('.json')) {
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
    console.log(
      `AI 能力清单已是最新状态；索引 ${generated.indexBytes} / ${AI_CAPABILITY_INDEX_MAX_BYTES} 字节，组件目录 ${generated.componentCatalogStatus}。`,
    )
    return
  }
  await writeAiCapabilityArtifacts(options.outputRoot, generated)
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
