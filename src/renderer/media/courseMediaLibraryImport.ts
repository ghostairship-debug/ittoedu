import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import type {
  CourseAssetSidecar,
  CourseImportedAsset,
} from '@/renderer/project/v9AssetAdapter'
import {
  planAssetFileHistoryChange,
  type AssetFileHistoryChange,
  type HistoryResourceChanges,
} from '@/renderer/store/courseResourceState'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseAssetMeta,
  CourseProjectDocument,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1/types'

export interface PlanCourseMediaLibraryImportInput {
  readonly project: CourseProjectDocument
  readonly sidecar: CourseAssetSidecar
  readonly items: ReadonlyArray<CourseImportedAsset>
  /** Stable project identity captured when the user action began. */
  readonly projectId: string
  /** Exact document revision captured when the user action began. */
  readonly baseRevision: number
  /** Explicit clock input keeps the planner deterministic and side-effect free. */
  readonly now: string
}

export interface CourseMediaLibraryImportFeedback {
  readonly kind: 'media-library-imported' | 'media-library-unchanged'
  /** All asset IDs that need either metadata, bytes, or both committed. */
  readonly importedAssetIds: readonly string[]
  readonly addedAssetIds: readonly string[]
  readonly repairedAssetIds: readonly string[]
  readonly reusedAssetIds: readonly string[]
}

export type CourseMediaLibraryImportTransactionPlan = EditorTransactionPlan<
  undefined,
  CourseMediaLibraryImportFeedback
>

export type CourseMediaLibraryImportPlanFailureCode =
  | 'project-mismatch'
  | 'revision-conflict'
  | 'invalid-clock'
  | 'invalid-asset'
  | 'asset-conflict'

export type CourseMediaLibraryImportPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: CourseMediaLibraryImportTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly feedback: CourseMediaLibraryImportFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseMediaLibraryImportPlanFailureCode
      readonly reason: string
    }

type AssetDisposition = 'added' | 'repaired' | 'reused'

interface StagedAsset {
  readonly meta: AssetMeta
  readonly bytes: Uint8Array
  readonly disposition: AssetDisposition
}

const FAILURE_REASONS: Readonly<Record<
  CourseMediaLibraryImportPlanFailureCode,
  string
>> = Object.freeze({
  'project-mismatch': '媒体库导入计划不属于当前 Course Project',
  'revision-conflict': '媒体库导入计划基于过期的 Course Project revision',
  'invalid-clock': '媒体库导入需要有效的显式时间',
  'invalid-asset': '媒体素材的 metadata 或二进制内容无效',
  'asset-conflict': '素材 ID 已存在，但 metadata 或二进制内容不同',
})

function failure(
  code: CourseMediaLibraryImportPlanFailureCode,
  reason = FAILURE_REASONS[code],
): Extract<CourseMediaLibraryImportPlanResult, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index])
}

function sameAssetMeta(left: AssetMeta, right: AssetMeta): boolean {
  return left.id === right.id
    && left.filename === right.filename
    && left.mimeType === right.mimeType
    && left.kind === right.kind
    && left.path === right.path
    && left.byteLength === right.byteLength
    && left.width === right.width
    && left.height === right.height
    && left.duration === right.duration
}

function cloneAssetMeta(meta: AssetMeta): AssetMeta {
  return {
    id: meta.id,
    filename: meta.filename,
    mimeType: meta.mimeType,
    kind: meta.kind,
    path: meta.path,
    byteLength: meta.byteLength,
    ...(meta.width === undefined ? {} : { width: meta.width }),
    ...(meta.height === undefined ? {} : { height: meta.height }),
    ...(meta.duration === undefined ? {} : { duration: meta.duration }),
  }
}

function cloneCourseAssetMeta(meta: CourseAssetMeta): CourseAssetMeta {
  return {
    ...cloneAssetMeta(meta),
    ...(meta.remote ? { remote: { url: meta.remote.url } } : {}),
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value)
    && Object.prototype.toString.call(value) === '[object Uint8Array]'
}

function assetInputIsValid(item: CourseImportedAsset): boolean {
  const { meta, bytes } = item
  const positiveOptional = (value: number | undefined): boolean => (
    value === undefined || (Number.isFinite(value) && value > 0)
  )
  return isUint8Array(bytes)
    && Boolean(meta.id.trim())
    && Boolean(meta.filename.trim())
    && Boolean(meta.mimeType.trim())
    && Boolean(meta.path.trim())
    && !/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(meta.path)
    && (meta.kind === 'image' || meta.kind === 'audio' || meta.kind === 'video')
    && Number.isInteger(meta.byteLength)
    && meta.byteLength >= 0
    && meta.byteLength === bytes.byteLength
    && positiveOptional(meta.width)
    && positiveOptional(meta.height)
    && (
      meta.duration === undefined
      || (Number.isFinite(meta.duration) && meta.duration >= 0)
    )
}

function clockIsValid(project: CourseProjectDocument, now: string): boolean {
  return courseProjectDocumentSchema.safeParse({
    ...project,
    updatedAt: now,
  }).success
}

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function freezeIds(ids: string[]): readonly string[] {
  return Object.freeze([...ids])
}

function cloneOwnAssetRecord(
  assets: Readonly<Record<string, CourseAssetMeta>>,
): Record<string, CourseAssetMeta> {
  const clone: Record<string, CourseAssetMeta> = {}
  for (const [assetId, meta] of Object.entries(assets)) {
    // defineProperty keeps "__proto__" an own record key instead of invoking
    // Object.prototype's legacy setter.
    Object.defineProperty(clone, assetId, {
      value: cloneCourseAssetMeta(meta),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return clone
}

function feedback(
  kind: CourseMediaLibraryImportFeedback['kind'],
  staged: ReadonlyMap<string, StagedAsset>,
): CourseMediaLibraryImportFeedback {
  const importedAssetIds: string[] = []
  const addedAssetIds: string[] = []
  const repairedAssetIds: string[] = []
  const reusedAssetIds: string[] = []
  for (const [assetId, item] of staged) {
    if (item.disposition === 'reused') {
      reusedAssetIds.push(assetId)
      continue
    }
    importedAssetIds.push(assetId)
    if (item.disposition === 'added') addedAssetIds.push(assetId)
    else repairedAssetIds.push(assetId)
  }
  return Object.freeze({
    kind,
    importedAssetIds: freezeIds(importedAssetIds),
    addedAssetIds: freezeIds(addedAssetIds),
    repairedAssetIds: freezeIds(repairedAssetIds),
    reusedAssetIds: freezeIds(reusedAssetIds),
  })
}

/**
 * Plans one project-scoped media-library batch. It never reads a Surface,
 * creates a placement, writes a Store, or mutates project/sidecar/item inputs.
 */
export function planCourseMediaLibraryImport(
  input: PlanCourseMediaLibraryImportInput,
): CourseMediaLibraryImportPlanResult {
  if (!input.projectId.trim() || input.project.id !== input.projectId) {
    return failure('project-mismatch')
  }
  if (
    !Number.isInteger(input.baseRevision)
    || input.baseRevision < 0
    || input.project.revision !== input.baseRevision
  ) {
    return failure('revision-conflict')
  }
  if (!clockIsValid(input.project, input.now)) {
    return failure('invalid-clock')
  }

  const uniqueItems = new Map<string, { meta: AssetMeta; bytes: Uint8Array }>()
  for (const item of input.items) {
    if (!assetInputIsValid(item)) return failure('invalid-asset')
    const previous = uniqueItems.get(item.meta.id)
    if (previous) {
      if (
        !sameAssetMeta(previous.meta, item.meta)
        || !sameBytes(previous.bytes, item.bytes)
      ) {
        return failure('asset-conflict')
      }
      continue
    }
    uniqueItems.set(item.meta.id, {
      meta: cloneAssetMeta(item.meta),
      // Buffer and other Uint8Array subclasses may implement slice() as a
      // shared view. Always materialize a base Uint8Array for the plan.
      bytes: Uint8Array.from(item.bytes),
    })
  }

  const staged = new Map<string, StagedAsset>()
  for (const [assetId, item] of uniqueItems) {
    const hasExistingMeta = Object.hasOwn(input.project.assets, assetId)
    const hasExistingBytes = Object.hasOwn(input.sidecar.files, assetId)
    const existingMeta = hasExistingMeta
      ? input.project.assets[assetId]
      : undefined
    const existingBytes = hasExistingBytes
      ? input.sidecar.files[assetId]
      : undefined
    if (hasExistingMeta && (
      !existingMeta || !sameAssetMeta(existingMeta, item.meta)
    )) {
      return failure('asset-conflict')
    }
    if (hasExistingBytes && (
      !existingBytes || !sameBytes(existingBytes, item.bytes)
    )) {
      return failure('asset-conflict')
    }
    staged.set(assetId, {
      ...item,
      disposition: hasExistingMeta && hasExistingBytes
        ? 'reused'
        : hasExistingMeta || hasExistingBytes
          ? 'repaired'
          : 'added',
    })
  }

  const changed = [...staged.values()].some((item) => (
    item.disposition !== 'reused'
  ))
  if (!changed) {
    return Object.freeze({
      ok: true as const,
      status: 'no-op' as const,
      plan: null,
      feedback: feedback('media-library-unchanged', staged),
    })
  }

  const nextDraft = structuredClone(input.project)
  const assetFileChanges: AssetFileHistoryChange[] = []
  for (const [assetId, item] of staged) {
    if (item.disposition === 'reused') continue
    if (!Object.hasOwn(nextDraft.assets, assetId)) {
      Object.defineProperty(nextDraft.assets, assetId, {
        value: cloneAssetMeta(item.meta),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    if (!Object.hasOwn(input.sidecar.files, assetId)) {
      const resourceChange = planAssetFileHistoryChange(
        assetId,
        undefined,
        item.bytes,
      )
      if (resourceChange) assetFileChanges.push(resourceChange)
    }
  }
  nextDraft.revision = input.baseRevision + 1
  nextDraft.updatedAt = input.now

  const parsed = courseProjectDocumentSchema.safeParse(nextDraft)
  if (!parsed.success) {
    return failure('invalid-asset', parsed.error.issues[0]?.message)
  }
  const nextDocument = deepFreeze({
    ...parsed.data,
    // Zod's ordinary record output can invoke the legacy "__proto__"
    // setter. Rebuild the already-validated asset record with own keys.
    assets: cloneOwnAssetRecord(nextDraft.assets),
  })
  const resourceChanges: HistoryResourceChanges = assetFileChanges.length
    ? Object.freeze({
        assetFileChanges: Object.freeze(assetFileChanges) as unknown as AssetFileHistoryChange[],
      })
    : Object.freeze({})
  const planFeedback = feedback('media-library-imported', staged)
  const plan: CourseMediaLibraryImportTransactionPlan = Object.freeze({
    projectId: input.projectId,
    baseRevision: input.baseRevision,
    nextDocument,
    resourceChanges,
    feedback: planFeedback,
  })
  return Object.freeze({
    ok: true as const,
    status: 'planned' as const,
    plan,
  })
}
