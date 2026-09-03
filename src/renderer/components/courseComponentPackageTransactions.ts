import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import { componentArchiveRoot } from '@/renderer/project/archivePath'
import type { ComponentPackageHistoryChange } from '@/renderer/store/history'
import { componentManifestSchema } from '@/shared/componentSchema'
import type {
  ComponentPackageData,
  ComponentScope,
} from '@/shared/componentTypes'
import type {
  CourseProjectDocument,
  FlowBlock,
  LayerItem,
} from '@/shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { EmbeddedComponentPackageMeta } from '@/shared/contracts/component-v4/types'
import { z } from 'zod'
import {
  parseComponentPackageFiles,
  type ImportedComponentPackage,
} from './importComponentPackage'

export type CourseComponentPackageCarrier =
  | 'global-layer'
  | 'surface-layer'
  | 'slide-scene'
  | 'spatial-world'
  | 'flow-block'

export interface CourseComponentPackageInstanceReference {
  readonly carrier: CourseComponentPackageCarrier
  readonly scope: ComponentScope
  readonly instanceId: string
  readonly version: string
  readonly surfaceId?: string
  readonly sceneId?: string
}

/**
 * Course Project V9 usage is derived from the authoritative document, never
 * from a lossy V8 projection.  The same carrier traversal drives package
 * replacement, removal guards, and the Components tab.
 */
export interface CourseComponentPackageUsage {
  readonly packageId: string
  readonly packageExists: boolean
  readonly references: readonly CourseComponentPackageInstanceReference[]
  readonly sceneInstanceCount: number
  readonly globalInstanceCount: number
  readonly totalInstanceCount: number
}

export interface CourseComponentPackageReplacementFeedback {
  readonly kind: 'component-package-replaced'
  readonly packageId: string
  readonly previousVersion: string
  readonly replacementVersion: string
  readonly affectedInstances: readonly CourseComponentPackageInstanceReference[]
}

export type CourseComponentPackageReplacementTransactionPlan =
  EditorTransactionPlan<never, CourseComponentPackageReplacementFeedback>

export type CourseComponentPackageReplacementFailureCode =
  | 'project-mismatch'
  | 'revision-conflict'
  | 'package-missing'
  | 'package-resource-missing'
  | 'package-identity-mismatch'
  | 'invalid-replacement'
  | 'content-hash-mismatch'
  | 'version-conflict'
  | 'instance-version-mismatch'
  | 'unsupported-scope'
  | 'invalid-clock'
  | 'invalid-document'

export type CourseComponentPackageReplacementPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: CourseComponentPackageReplacementTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly feedback: CourseComponentPackageReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseComponentPackageReplacementFailureCode
      readonly reason: string
    }

export interface PlanCourseComponentPackageReplacementInput {
  readonly project: CourseProjectDocument
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly packageId: string
  readonly replacement: ComponentPackageData
  readonly expected: {
    readonly projectId: string
    readonly revision: number
  }
  /** Explicit clock input keeps the planner deterministic and side-effect free. */
  readonly now: string
}

export interface CourseComponentPackageDeletionFeedback {
  readonly kind: 'component-package-deleted'
  readonly packageId: string
  readonly version: string
}

export type CourseComponentPackageDeletionTransactionPlan =
  EditorTransactionPlan<never, CourseComponentPackageDeletionFeedback>

export type CourseComponentPackageDeletionFailureCode =
  | 'project-mismatch'
  | 'revision-conflict'
  | 'package-missing'
  | 'package-resource-missing'
  | 'package-identity-mismatch'
  | 'package-referenced'
  | 'invalid-clock'
  | 'invalid-document'

export type CourseComponentPackageDeletionPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: CourseComponentPackageDeletionTransactionPlan
    }
  | {
      readonly ok: false
      readonly code: 'package-referenced'
      readonly reason: string
      readonly references: readonly CourseComponentPackageInstanceReference[]
    }
  | {
      readonly ok: false
      readonly code: Exclude<
        CourseComponentPackageDeletionFailureCode,
        'package-referenced'
      >
      readonly reason: string
    }

export interface PlanCourseComponentPackageDeletionInput {
  readonly project: CourseProjectDocument
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly packageId: string
  readonly expected: {
    readonly projectId: string
    readonly revision: number
  }
  /** Explicit clock input keeps the planner deterministic and side-effect free. */
  readonly now: string
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const ISO_TIMESTAMP_SCHEMA = z.string().datetime()

function fail(
  code: CourseComponentPackageReplacementFailureCode,
  reason: string,
): CourseComponentPackageReplacementPlanResult {
  return Object.freeze({ ok: false as const, code, reason })
}

function deletionFail(
  code: Exclude<CourseComponentPackageDeletionFailureCode, 'package-referenced'>,
  reason: string,
): CourseComponentPackageDeletionPlanResult {
  return Object.freeze({ ok: false as const, code, reason })
}

function clonePackage(packageData: ComponentPackageData): ComponentPackageData {
  const files = Object.fromEntries(
    Object.entries(packageData.files).map(([path, bytes]) => [
      path,
      Uint8Array.from(bytes),
    ]),
  )
  return {
    manifest: structuredClone(packageData.manifest),
    runtimeSource: packageData.runtimeSource,
    files,
    ...(packageData.contentSha256 === undefined
      ? {}
      : { contentSha256: packageData.contentSha256 }),
    ...(packageData.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: packageData.thumbnailUrl }),
    ...(packageData.provenance === undefined
      ? {}
      : { provenance: { ...packageData.provenance } }),
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value)
    && Object.prototype.toString.call(value) === '[object Uint8Array]'
}

function validatedPackageValue(
  source: ComponentPackageData,
  parsed: ImportedComponentPackage,
): ComponentPackageData {
  return clonePackage({
    manifest: parsed.manifest,
    runtimeSource: parsed.runtimeSource,
    files: parsed.files,
    contentSha256: parsed.contentSha256,
    ...(source.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: source.thumbnailUrl }),
    ...(source.provenance === undefined
      ? {}
      : { provenance: source.provenance }),
  })
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (isUint8Array(left) || isUint8Array(right)) {
    return isUint8Array(left)
      && isUint8Array(right)
      && left.byteLength === right.byteLength
      && left.every((value, index) => value === right[index])
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]))
  }
  if (
    left === null
    || right === null
    || typeof left !== 'object'
    || typeof right !== 'object'
  ) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key])
    ))
}

function deepFreezeValue<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreezeValue(nested)
  }
  return Object.freeze(value)
}

function replacementMetadata(
  current: EmbeddedComponentPackageMeta,
  replacement: ComponentPackageData,
  contentSha256: string,
): EmbeddedComponentPackageMeta {
  const manifest = replacement.manifest
  const root = componentArchiveRoot(manifest.id, manifest.version)
  return {
    packageId: manifest.id,
    version: manifest.version,
    name: manifest.name,
    manifestPath: `${root}/manifest.json`,
    runtimePath: `${root}/${manifest.entry}`,
    contentSha256,
    ...(manifest.thumbnail === undefined
      ? {}
      : { thumbnailPath: `${root}/${manifest.thumbnail}` }),
    ...(replacement.provenance === undefined
      ? {}
      : { ...replacement.provenance }),
    ...(current.editableCopy === undefined
      ? {}
      : { editableCopy: current.editableCopy }),
    ...(current.sourcePackageId === undefined
      ? {}
      : { sourcePackageId: current.sourcePackageId }),
  }
}

function packageProvenanceMatchesMetadata(
  packageData: ComponentPackageData,
  metadata: EmbeddedComponentPackageMeta,
): boolean {
  const provenance = packageData.provenance
  if (provenance === undefined) {
    return metadata.sha256 === undefined
      && metadata.importedAt === undefined
      && metadata.sourceLabel === undefined
  }
  return metadata.sha256 === provenance.sha256
    && metadata.importedAt === provenance.importedAt
    && metadata.sourceLabel === provenance.sourceLabel
}

function validProvenance(packageData: ComponentPackageData): boolean {
  const provenance = packageData.provenance
  return provenance === undefined || (
    SHA256_PATTERN.test(provenance.sha256)
    && ISO_TIMESTAMP_SCHEMA.safeParse(provenance.importedAt).success
    && provenance.sourceLabel.trim().length > 0
  )
}

export function collectCourseComponentPackageReferences(
  project: CourseProjectDocument,
  packageId: string,
): readonly CourseComponentPackageInstanceReference[] {
  const references: CourseComponentPackageInstanceReference[] = []
  const appendLayer = (
    item: LayerItem,
    context: Omit<CourseComponentPackageInstanceReference, 'instanceId' | 'version'>,
  ): void => {
    if (item.kind !== 'component' || item.component.packageId !== packageId) return
    references.push(Object.freeze({
      ...context,
      instanceId: item.layerItemId,
      version: item.component.version,
    }))
  }
  const appendBlocks = (blocks: readonly FlowBlock[], surfaceId: string): void => {
    for (const block of blocks) {
      if (block.type === 'section') appendBlocks(block.blocks, surfaceId)
      else if (block.type === 'component' && block.component.packageId === packageId) {
        references.push(Object.freeze({
          carrier: 'flow-block',
          scope: 'scene',
          instanceId: block.id,
          surfaceId,
          version: block.component.version,
        }))
      }
    }
  }
  project.globalLayerItems.forEach((entry) => appendLayer(entry.item, {
    carrier: 'global-layer',
    scope: 'global',
  }))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => appendLayer(entry.item, {
      carrier: 'surface-layer',
      scope: 'scene',
      surfaceId: surface.id,
    }))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach((item) => appendLayer(item, {
        carrier: 'slide-scene',
        scope: 'scene',
        surfaceId: surface.id,
        sceneId: scene.id,
      })))
    } else if (surface.type === 'flow') {
      appendBlocks(surface.blocks, surface.id)
    } else {
      surface.world.layerItems.forEach((item) => appendLayer(item, {
        carrier: 'spatial-world',
        scope: 'scene',
        surfaceId: surface.id,
      }))
    }
  }
  return Object.freeze(references)
}

export function collectCourseComponentPackageUsage(
  project: CourseProjectDocument,
  packageId: string,
): CourseComponentPackageUsage {
  const references = collectCourseComponentPackageReferences(project, packageId)
  const globalInstanceCount = references.filter((reference) => reference.scope === 'global').length
  return Object.freeze({
    packageId,
    packageExists: Object.hasOwn(project.componentPackages, packageId),
    references,
    sceneInstanceCount: references.length - globalInstanceCount,
    globalInstanceCount,
    totalInstanceCount: references.length,
  })
}

function retargetPackageReferences(
  project: CourseProjectDocument,
  packageId: string,
  version: string,
): void {
  const retargetLayer = (item: LayerItem): void => {
    if (item.kind === 'component' && item.component.packageId === packageId) {
      item.component.version = version
    }
  }
  const retargetBlocks = (blocks: FlowBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'section') retargetBlocks(block.blocks)
      else if (block.type === 'component' && block.component.packageId === packageId) {
        block.component.version = version
      }
    }
  }
  project.globalLayerItems.forEach((entry) => retargetLayer(entry.item))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => retargetLayer(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(retargetLayer))
    } else if (surface.type === 'flow') {
      retargetBlocks(surface.blocks)
    } else {
      surface.world.layerItems.forEach(retargetLayer)
    }
  }
}

function replacementFeedback(
  packageId: string,
  previousVersion: string,
  replacementVersion: string,
  affectedInstances: readonly CourseComponentPackageInstanceReference[],
): CourseComponentPackageReplacementFeedback {
  return Object.freeze({
    kind: 'component-package-replaced' as const,
    packageId,
    previousVersion,
    replacementVersion,
    affectedInstances: Object.freeze([...affectedInstances]),
  })
}

/**
 * Plans one immutable Course Project V9 package replacement. The caller owns
 * Store/history integration; this function only validates and describes the
 * document/resource transaction.
 */
export function planCourseComponentPackageReplacement(
  input: PlanCourseComponentPackageReplacementInput,
): CourseComponentPackageReplacementPlanResult {
  if (input.project.id !== input.expected.projectId) {
    return fail('project-mismatch', '组件替换目标不属于当前 Course Project。')
  }
  if (
    !Number.isInteger(input.expected.revision)
    || input.expected.revision < 0
    || input.project.revision !== input.expected.revision
  ) {
    return fail('revision-conflict', '组件替换目标 revision 已失效。')
  }
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(input.now).success) {
    return fail('invalid-clock', '组件替换时间必须是有效的 ISO 时间。')
  }

  const packageId = input.packageId
  if (!packageId.trim() || packageId !== packageId.trim()) {
    return fail('package-identity-mismatch', '待替换组件包 ID 必须是精确的非空 ID。')
  }
  const currentMetadata = input.project.componentPackages[packageId]
  if (!packageId || currentMetadata === undefined) {
    return fail('package-missing', `工程中不存在组件包“${packageId || input.packageId}”。`)
  }
  const currentPackage = input.componentPackages[packageId]
  if (currentPackage === undefined) {
    return fail('package-resource-missing', `工程缺少组件包“${packageId}”的执行资源。`)
  }
  if (
    currentMetadata.packageId !== packageId
    || currentPackage.manifest.id !== packageId
    || currentPackage.manifest.version !== currentMetadata.version
  ) {
    return fail('package-identity-mismatch', `组件包“${packageId}”的文档与执行资源身份不一致。`)
  }

  let parsedCurrentPackage: ImportedComponentPackage
  try {
    parsedCurrentPackage = parseComponentPackageFiles(currentPackage.files, {
      expectedId: packageId,
      expectedVersion: currentMetadata.version,
    })
  } catch {
    return fail(
      'content-hash-mismatch',
      `组件包“${packageId}”的文件、Manifest 或 Runtime 内容无效。`,
    )
  }
  if (
    !valuesEqual(currentPackage.manifest, parsedCurrentPackage.manifest)
    || currentPackage.runtimeSource !== parsedCurrentPackage.runtimeSource
  ) {
    return fail(
      'content-hash-mismatch',
      `组件包“${packageId}”的外置 Manifest 或 Runtime 与包内文件不一致。`,
    )
  }

  const parsedManifest = componentManifestSchema.safeParse(input.replacement.manifest)
  if (!parsedManifest.success || !validProvenance(input.replacement)) {
    return fail('invalid-replacement', '替换组件包的 Component API 4 Manifest 或来源信息无效。')
  }
  if (parsedManifest.data.id !== packageId) {
    return fail(
      'package-identity-mismatch',
      `替换包 ID“${parsedManifest.data.id}”与工程组件“${packageId}”不一致。`,
    )
  }

  let parsedReplacementPackage: ImportedComponentPackage
  try {
    parsedReplacementPackage = parseComponentPackageFiles(input.replacement.files, {
      expectedId: packageId,
      expectedVersion: parsedManifest.data.version,
    })
  } catch {
    return fail(
      'invalid-replacement',
      `替换组件包“${packageId}”的文件、Manifest 或 Runtime 内容无效。`,
    )
  }
  if (
    !valuesEqual(input.replacement.manifest, parsedReplacementPackage.manifest)
    || input.replacement.runtimeSource !== parsedReplacementPackage.runtimeSource
  ) {
    return fail(
      'invalid-replacement',
      `替换组件包“${packageId}”的外置 Manifest 或 Runtime 与包内文件不一致。`,
    )
  }

  const currentContentSha256 = parsedCurrentPackage.contentSha256
  const replacementContentSha256 = parsedReplacementPackage.contentSha256
  if (currentContentSha256 === undefined) {
    return fail('content-hash-mismatch', `组件包“${packageId}”缺少内容哈希。`)
  }
  if (replacementContentSha256 === undefined) {
    return fail('invalid-replacement', `替换组件包“${packageId}”缺少内容哈希。`)
  }
  if (
    currentMetadata.contentSha256 !== currentContentSha256
    || (currentPackage.contentSha256 !== undefined
      && currentPackage.contentSha256 !== currentContentSha256)
    || !validProvenance(currentPackage)
    || !packageProvenanceMatchesMetadata(currentPackage, currentMetadata)
    || (input.replacement.contentSha256 !== undefined
      && input.replacement.contentSha256 !== replacementContentSha256)
  ) {
    return fail('content-hash-mismatch', `组件包“${packageId}”的内容哈希或来源锁定值不一致。`)
  }
  if (
    parsedReplacementPackage.manifest.version === currentMetadata.version
    && (
      replacementContentSha256 !== currentContentSha256
      || (
        currentPackage.provenance?.sha256 !== undefined
        && input.replacement.provenance?.sha256 !== undefined
        && currentPackage.provenance.sha256
          !== input.replacement.provenance.sha256
      )
    )
  ) {
    return fail(
      'version-conflict',
      `组件“${packageId}”的 ${currentMetadata.version} 版本不能替换为不同内容。`,
    )
  }

  const affectedInstances = collectCourseComponentPackageReferences(input.project, packageId)
  if (affectedInstances.some((reference) => reference.version !== currentMetadata.version)) {
    return fail(
      'instance-version-mismatch',
      `组件“${packageId}”存在未锁定到 ${currentMetadata.version} 的实例。`,
    )
  }
  const requiredScopes = new Set(affectedInstances.map((reference) => reference.scope))
  const unsupportedScope = [...requiredScopes].find((scope) => (
    !parsedReplacementPackage.manifest.supportedScopes.includes(scope)
  ))
  if (unsupportedScope !== undefined) {
    return fail(
      'unsupported-scope',
      `替换组件包不支持现有${unsupportedScope === 'global' ? '全局层' : '场景层'}实例。`,
    )
  }

  const normalizedCurrentPackage = validatedPackageValue(
    currentPackage,
    parsedCurrentPackage,
  )
  const nextPackage = validatedPackageValue(
    input.replacement,
    parsedReplacementPackage,
  )
  const nextMetadata = replacementMetadata(
    currentMetadata,
    nextPackage,
    replacementContentSha256,
  )
  const feedback = replacementFeedback(
    packageId,
    currentMetadata.version,
    parsedReplacementPackage.manifest.version,
    affectedInstances,
  )
  if (
    valuesEqual(normalizedCurrentPackage, nextPackage)
    && valuesEqual(currentMetadata, nextMetadata)
  ) {
    return Object.freeze({
      ok: true as const,
      status: 'no-op' as const,
      plan: null,
      feedback,
    })
  }

  const nextDocument = structuredClone(input.project)
  nextDocument.componentPackages[packageId] = structuredClone(nextMetadata)
  retargetPackageReferences(
    nextDocument,
    packageId,
    parsedReplacementPackage.manifest.version,
  )
  nextDocument.revision = input.project.revision + 1
  nextDocument.updatedAt = input.now
  const parsedNextDocument = courseProjectDocumentSchema.safeParse(nextDocument)
  if (!parsedNextDocument.success) {
    const issue = parsedNextDocument.error.issues[0]
    const path = issue?.path.join('.') || 'project'
    return fail(
      'invalid-document',
      `组件替换后的 Course Project V9 无效：${path} ${issue?.message ?? '字段无效'}。`,
    )
  }

  const componentPackageChanges = Object.freeze([deepFreezeValue({
    packageId,
    before: deepFreezeValue(clonePackage(currentPackage)),
    after: deepFreezeValue(clonePackage(nextPackage)),
  })]) as unknown as ComponentPackageHistoryChange[]
  const plan: CourseComponentPackageReplacementTransactionPlan = Object.freeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: deepFreezeValue(parsedNextDocument.data),
    resourceChanges: Object.freeze({
      componentPackageChanges,
    }),
    feedback,
  })
  return Object.freeze({ ok: true as const, status: 'planned' as const, plan })
}

/**
 * Plans one atomic Course Project V9 package removal.  Package metadata and
 * executable bytes are deliberately represented by the same resource delta,
 * so a removal cannot leave the document and sidecar out of sync on any
 * authoring surface.
 */
export function planCourseComponentPackageDeletion(
  input: PlanCourseComponentPackageDeletionInput,
): CourseComponentPackageDeletionPlanResult {
  if (input.project.id !== input.expected.projectId) {
    return deletionFail('project-mismatch', '组件删除目标不属于当前 Course Project。')
  }
  if (
    !Number.isInteger(input.expected.revision)
    || input.expected.revision < 0
    || input.project.revision !== input.expected.revision
  ) {
    return deletionFail('revision-conflict', '组件删除目标 revision 已失效。')
  }
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(input.now).success) {
    return deletionFail('invalid-clock', '组件删除时间必须是有效的 ISO 时间。')
  }

  const packageId = input.packageId
  if (!packageId.trim() || packageId !== packageId.trim()) {
    return deletionFail('package-identity-mismatch', '待删除组件包 ID 必须是精确的非空 ID。')
  }
  const currentMetadata = input.project.componentPackages[packageId]
  if (!packageId || currentMetadata === undefined) {
    return deletionFail('package-missing', `工程中不存在组件包“${packageId || input.packageId}”。`)
  }

  const references = collectCourseComponentPackageReferences(input.project, packageId)
  if (references.length > 0) {
    const globalInstanceCount = references.filter((reference) => reference.scope === 'global').length
    const sceneInstanceCount = references.length - globalInstanceCount
    return Object.freeze({
      ok: false as const,
      code: 'package-referenced' as const,
      reason: `组件包“${packageId}”仍被 ${sceneInstanceCount} 个场景实例和 ${globalInstanceCount} 个全局实例引用。`,
      references,
    })
  }

  const currentPackage = input.componentPackages[packageId]
  if (currentPackage === undefined) {
    return deletionFail('package-resource-missing', `工程缺少组件包“${packageId}”的执行资源。`)
  }
  if (
    currentMetadata.packageId !== packageId
    || currentPackage.manifest.id !== packageId
    || currentPackage.manifest.version !== currentMetadata.version
  ) {
    return deletionFail('package-identity-mismatch', `组件包“${packageId}”的文档与执行资源身份不一致。`)
  }

  const nextDocument = structuredClone(input.project)
  delete nextDocument.componentPackages[packageId]
  nextDocument.revision = input.project.revision + 1
  nextDocument.updatedAt = input.now
  const parsedNextDocument = courseProjectDocumentSchema.safeParse(nextDocument)
  if (!parsedNextDocument.success) {
    const issue = parsedNextDocument.error.issues[0]
    const path = issue?.path.join('.') || 'project'
    return deletionFail(
      'invalid-document',
      `组件删除后的 Course Project V9 无效：${path} ${issue?.message ?? '字段无效'}。`,
    )
  }

  const feedback: CourseComponentPackageDeletionFeedback = Object.freeze({
    kind: 'component-package-deleted',
    packageId,
    version: currentMetadata.version,
  })
  const componentPackageChanges = Object.freeze([deepFreezeValue({
    packageId,
    before: deepFreezeValue(clonePackage(currentPackage)),
  })]) as unknown as ComponentPackageHistoryChange[]
  const plan: CourseComponentPackageDeletionTransactionPlan = Object.freeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: deepFreezeValue(parsedNextDocument.data),
    resourceChanges: Object.freeze({
      componentPackageChanges,
    }),
    feedback,
  })
  return Object.freeze({ ok: true as const, status: 'planned' as const, plan })
}
