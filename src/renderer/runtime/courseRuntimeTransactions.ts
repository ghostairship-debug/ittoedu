import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import {
  captureCourseAuthoringTarget,
  validateCourseAuthoringTarget,
  type CourseAuthoringSessionToken,
  type CourseAuthoringTarget,
  type CourseAuthoringTargetRejectionCode,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import {
  makeLayerItemAuthoringAddress,
  ownerKeyFor,
  type CourseAuthoringOwner,
} from '@/renderer/authoring/courseAuthoringScope'
import type { CourseAssetSidecar } from '@/renderer/project/v9AssetAdapter'
import { planAssetFileHistoryChange } from '@/renderer/store/courseResourceState'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/projectTypes'
import { z } from 'zod'

export type CourseRuntimeCarrier =
  | 'global-layer'
  | 'surface-layer'
  | 'slide-scene'
  | 'spatial-world'

/**
 * Stable Runtime binding target captured before an asynchronous file picker.
 * Player `targetId` / DOM `hitId` values are deliberately absent: they are
 * discovery-only tokens and cannot identify a persisted V9 carrier.
 */
export interface CourseRuntimeAssetReplacementTarget {
  readonly courseTarget: CourseAuthoringTarget
  readonly bindingKey: string
}

export interface CaptureCourseRuntimeAssetReplacementTargetInput {
  readonly sessionToken: CourseAuthoringSessionToken
  readonly projectId: string
  readonly surfaceId: string
  readonly stateId: string | null
  readonly owner: CourseAuthoringOwner
  readonly sceneId: string | null
  readonly itemId: string
  readonly bindingKey: string
}

export interface CourseRuntimeAssetReplacementSelectionHint {
  readonly itemId: string
  readonly bindingKey: string
  readonly authoringAddress: string
  readonly locationId: string
  readonly stateId: string | null
  readonly carrier: CourseRuntimeCarrier
}

export interface CourseRuntimeAssetReplacementFeedback {
  readonly kind: 'runtime-asset-replaced' | 'runtime-asset-unchanged'
  readonly itemId: string
  readonly bindingKey: string
  readonly previousAssetId: string
  readonly assetId: string
  readonly carrier: CourseRuntimeCarrier
  readonly assetDisposition: 'added' | 'repaired' | 'reused' | 'unchanged'
}

export type CourseRuntimeAssetReplacementTransactionPlan = EditorTransactionPlan<
  CourseRuntimeAssetReplacementSelectionHint,
  CourseRuntimeAssetReplacementFeedback
>

export type CourseRuntimeAssetReplacementFailureCode =
  | CourseAuthoringTargetRejectionCode
  | 'wrong-carrier'
  | 'invalid-target'
  | 'target-locked'
  | 'binding-missing'
  | 'invalid-asset'
  | 'asset-conflict'
  | 'invalid-clock'
  | 'invalid-document'

export type CourseRuntimeAssetReplacementPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: CourseRuntimeAssetReplacementTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly selectionHint: CourseRuntimeAssetReplacementSelectionHint
      readonly feedback: CourseRuntimeAssetReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseRuntimeAssetReplacementFailureCode
      readonly reason: string
    }

export interface PlanCourseRuntimeAssetReplacementInput {
  readonly project: CourseProjectDocument
  readonly sidecar: CourseAssetSidecar
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly target: CourseRuntimeAssetReplacementTarget
  readonly asset: AssetMeta
  readonly bytes: Uint8Array
  /** Explicit clock input keeps the planner deterministic and side-effect free. */
  readonly now: string
}

type TargetResolution =
  | {
      readonly ok: true
      readonly item: RuntimeLayerItem
      readonly carrier: CourseRuntimeCarrier
      readonly sceneId: string | null
      readonly locked: boolean
    }
  | {
      readonly ok: false
      readonly code: Extract<
        CourseRuntimeAssetReplacementFailureCode,
        'project-mismatch' | 'surface-or-location' | 'wrong-carrier' |
        'invalid-target' | 'item-missing' | 'binding-missing'
      >
      readonly reason: string
    }

const ISO_TIMESTAMP_SCHEMA = z.string().datetime()
const ABSOLUTE_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const FAILURE_REASONS: Readonly<Record<
  CourseRuntimeAssetReplacementFailureCode,
  string
>> = Object.freeze({
  'project-mismatch': 'Runtime 素材替换目标不属于当前 Course Project',
  'session-stale': 'Runtime 素材替换会话已过期，请重新选择目标',
  'surface-or-location': 'Runtime 素材替换目标所在页面或 Surface 已改变',
  'owner-mismatch': 'Runtime 素材替换目标的共享范围已改变',
  'item-missing': '原 Runtime 图层已不存在，请重新选择目标',
  'revision-conflict': 'Course Project 已改变，请重新选择 Runtime 素材目标',
  'wrong-carrier': '目标不是 V9 支持的 Runtime LayerItem carrier',
  'invalid-target': 'Runtime 素材目标的稳定作者地址或类型无效',
  'target-locked': 'Runtime 图层已锁定，不能替换素材',
  'binding-missing': 'Runtime 已不再声明这个素材绑定',
  'invalid-asset': '替换图片的 metadata 或二进制内容无效',
  'asset-conflict': '素材 ID 已存在，但 metadata 或二进制内容不同',
  'invalid-clock': 'Runtime 素材替换需要有效的显式时间',
  'invalid-document': 'Runtime 素材替换产生了无效的 Course Project V9 文档',
})

function fail(
  code: CourseRuntimeAssetReplacementFailureCode,
  reason = FAILURE_REASONS[code],
): Extract<CourseRuntimeAssetReplacementPlanResult, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    ArrayBuffer.isView(value) ||
    Object.isFrozen(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function jsonPointerEscape(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function bindingKeyIsValid(bindingKey: string): boolean {
  return bindingKey.trim().length > 0 && bindingKey.length <= 256
}

export function courseRuntimeAssetBindingAuthoringField(bindingKey: string): string {
  if (!bindingKeyIsValid(bindingKey)) {
    throw new TypeError('Runtime 素材绑定键不能为空且不能超过 256 个字符')
  }
  return `runtime/assets/${jsonPointerEscape(bindingKey)}/assetId`
}

/** Builds the field-specific stable target; callers still own host-hit discovery. */
export function captureCourseRuntimeAssetReplacementTarget(
  input: CaptureCourseRuntimeAssetReplacementTargetInput,
): CourseRuntimeAssetReplacementTarget {
  const ownerKey = ownerKeyFor(input.owner, input.surfaceId, input.sceneId)
  const authoringAddress = makeLayerItemAuthoringAddress({
    projectId: input.projectId,
    owner: input.owner,
    surfaceId: input.surfaceId,
    sceneId: input.sceneId,
    kind: 'runtime',
    layerItemId: input.itemId,
    field: courseRuntimeAssetBindingAuthoringField(input.bindingKey),
  })
  return Object.freeze({
    courseTarget: captureCourseAuthoringTarget({
      sessionToken: input.sessionToken,
      projectId: input.projectId,
      surfaceId: input.surfaceId,
      stateId: input.stateId,
      owner: input.owner,
      ownerKey,
      itemId: input.itemId,
      authoringAddress,
    }),
    bindingKey: input.bindingKey,
  })
}

function runtimeItemIn(
  items: ReadonlyArray<RuntimeLayerItem | CourseProjectDocument['globalLayerItems'][number]['item']>,
  itemId: string,
): RuntimeLayerItem | undefined {
  const item = items.find((candidate) => candidate.layerItemId === itemId)
  return item?.kind === 'runtime' ? item : undefined
}

function flowBlockIdExists(
  blocks: ReadonlyArray<Extract<CourseSurfaceDocument, { type: 'flow' }>['blocks'][number]>,
  itemId: string,
): boolean {
  return blocks.some((block) => (
    block.id === itemId ||
    (block.type === 'section' && flowBlockIdExists(block.blocks, itemId))
  ))
}

function resolutionFailure(
  code: Extract<TargetResolution, { readonly ok: false }>['code'],
  reason = FAILURE_REASONS[code],
): Extract<TargetResolution, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function resolveRuntimeTarget(
  project: CourseProjectDocument,
  target: CourseRuntimeAssetReplacementTarget,
): TargetResolution {
  const stable = target.courseTarget
  if (project.id !== stable.projectId) {
    return resolutionFailure('project-mismatch')
  }
  if (!bindingKeyIsValid(target.bindingKey)) {
    return resolutionFailure('invalid-target')
  }
  const location = project.locations.find((candidate) => candidate.id === stable.locationId)
  const surface = project.surfaces.find((candidate) => candidate.id === stable.surfaceId)
  if (
    !location ||
    !surface ||
    location.surfaceId !== surface.id ||
    stable.surfaceType !== surface.type
  ) {
    return resolutionFailure('surface-or-location')
  }
  if (surface.type !== 'slide' && stable.stateId !== null) {
    return resolutionFailure(
      'invalid-target',
      '非 Slide Runtime 目标不能携带 presentation state',
    )
  }

  let item: RuntimeLayerItem | undefined
  let carrier: CourseRuntimeCarrier
  let sceneId: string | null = null
  let locked: boolean | undefined
  if (stable.owner === 'global') {
    if (stable.ownerKey !== 'global') return resolutionFailure('wrong-carrier')
    item = runtimeItemIn(
      project.globalLayerItems.map((entry) => entry.item),
      stable.itemId,
    )
    carrier = 'global-layer'
  } else if (stable.owner === 'surface') {
    if (stable.ownerKey !== `surface:${surface.id}`) {
      return resolutionFailure('wrong-carrier')
    }
    item = runtimeItemIn(
      surface.surfaceLayerItems.map((entry) => entry.item),
      stable.itemId,
    )
    if (!item && surface.type === 'flow' && flowBlockIdExists(surface.blocks, stable.itemId)) {
      return resolutionFailure(
        'wrong-carrier',
        'Flow 正文 block 不是 Runtime LayerItem carrier',
      )
    }
    carrier = 'surface-layer'
  } else if (stable.owner === 'scene') {
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') {
      return resolutionFailure('wrong-carrier')
    }
    sceneId = location.sceneId
    if (stable.ownerKey !== `scene:${sceneId}`) {
      return resolutionFailure('wrong-carrier')
    }
    const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
    item = scene ? runtimeItemIn(scene.layerItems, stable.itemId) : undefined
    if (item && stable.stateId !== null) {
      const state = scene?.presentation?.states.find(
        (candidate) => candidate.id === stable.stateId,
      )
      if (!state) {
        return resolutionFailure(
          'invalid-target',
          '捕获的 Slide presentation state 已不存在',
        )
      }
      locked = state.layerItemOverrides[item.layerItemId]?.locked ?? item.locked
    }
    carrier = 'slide-scene'
  } else {
    if (
      surface.type !== 'spatial-2d' ||
      location.kind !== 'spatial-camera' ||
      stable.ownerKey !== `world:${surface.id}`
    ) {
      return resolutionFailure('wrong-carrier')
    }
    item = runtimeItemIn(surface.world.layerItems, stable.itemId)
    carrier = 'spatial-world'
  }

  if (!item) {
    const sameIdExists = project.globalLayerItems.some(
      (entry) => entry.item.layerItemId === stable.itemId,
    ) || project.surfaces.some((candidate) => (
      candidate.surfaceLayerItems.some((entry) => entry.item.layerItemId === stable.itemId) ||
      (candidate.type === 'slide' && candidate.scenes.some((scene) => (
        scene.layerItems.some((layer) => layer.layerItemId === stable.itemId)
      ))) ||
      (candidate.type === 'spatial-2d' && candidate.world.layerItems.some(
        (layer) => layer.layerItemId === stable.itemId,
      ))
    ))
    return resolutionFailure(sameIdExists ? 'wrong-carrier' : 'item-missing')
  }

  const canonicalAddress = makeLayerItemAuthoringAddress({
    projectId: project.id,
    owner: stable.owner,
    surfaceId: surface.id,
    sceneId,
    kind: 'runtime',
    layerItemId: item.layerItemId,
    field: courseRuntimeAssetBindingAuthoringField(target.bindingKey),
  })
  if (canonicalAddress !== stable.authoringAddress) {
    return resolutionFailure('invalid-target')
  }
  if (!Object.hasOwn(item.runtime.assets, target.bindingKey)) {
    return resolutionFailure('binding-missing')
  }
  return Object.freeze({
    ok: true as const,
    item,
    carrier,
    sceneId,
    locked: locked ?? item.locked,
  })
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]'
}

function positiveOptional(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0)
}

function imageAssetInputIsValid(asset: AssetMeta, bytes: Uint8Array): boolean {
  return isUint8Array(bytes) &&
    Boolean(asset.id.trim()) &&
    !UNSAFE_RECORD_KEYS.has(asset.id) &&
    Boolean(asset.filename.trim()) &&
    asset.kind === 'image' &&
    asset.mimeType.startsWith('image/') &&
    Boolean(asset.path.trim()) &&
    !ABSOLUTE_PATH_PATTERN.test(asset.path) &&
    Number.isInteger(asset.byteLength) &&
    asset.byteLength >= 0 &&
    asset.byteLength === bytes.byteLength &&
    positiveOptional(asset.width) &&
    positiveOptional(asset.height) &&
    (asset.duration === undefined || (Number.isFinite(asset.duration) && asset.duration >= 0))
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
}

function sameAssetMeta(left: AssetMeta, right: AssetMeta): boolean {
  return left.id === right.id &&
    left.filename === right.filename &&
    left.mimeType === right.mimeType &&
    left.kind === right.kind &&
    left.path === right.path &&
    left.byteLength === right.byteLength &&
    left.width === right.width &&
    left.height === right.height &&
    left.duration === right.duration
}

function selectionHint(
  target: CourseRuntimeAssetReplacementTarget,
  carrier: CourseRuntimeCarrier,
): CourseRuntimeAssetReplacementSelectionHint {
  return deepFreeze({
    itemId: target.courseTarget.itemId,
    bindingKey: target.bindingKey,
    authoringAddress: target.courseTarget.authoringAddress,
    locationId: target.courseTarget.locationId,
    stateId: target.courseTarget.stateId,
    carrier,
  })
}

function feedback(
  target: CourseRuntimeAssetReplacementTarget,
  carrier: CourseRuntimeCarrier,
  previousAssetId: string,
  assetId: string,
  assetDisposition: CourseRuntimeAssetReplacementFeedback['assetDisposition'],
): CourseRuntimeAssetReplacementFeedback {
  return deepFreeze({
    kind: assetDisposition === 'unchanged'
      ? 'runtime-asset-unchanged' as const
      : 'runtime-asset-replaced' as const,
    itemId: target.courseTarget.itemId,
    bindingKey: target.bindingKey,
    previousAssetId,
    assetId,
    carrier,
    assetDisposition,
  })
}

/**
 * Plans one Runtime binding replacement as one document/resource transaction.
 * It never reads live selection, writes Store state, or removes the old asset.
 */
export function planCourseRuntimeAssetReplacement(
  input: PlanCourseRuntimeAssetReplacementInput,
): CourseRuntimeAssetReplacementPlanResult {
  const resolution = resolveRuntimeTarget(input.project, input.target)
  if (
    input.target.courseTarget.surfaceType !== 'slide' &&
    input.currentIdentity.stateId !== null
  ) {
    return fail(
      'invalid-target',
      '非 Slide Runtime 当前身份不能携带 presentation state',
    )
  }
  // Runtime content/assets are shared by all presentation states. Ignore an
  // A -> B state switch for stale-target validation, while resolveRuntimeTarget
  // still uses the originally captured state to validate effective locking.
  const validation = validateCourseAuthoringTarget({
    target: { ...input.target.courseTarget, stateId: null },
    current: { ...input.currentIdentity, stateId: null },
    hasItem: () => resolution.ok,
  })
  if (!validation.ok) {
    if (!resolution.ok && validation.code === 'item-missing') {
      return fail(resolution.code, resolution.reason)
    }
    return fail(validation.code, validation.reason)
  }
  if (!resolution.ok) return fail(resolution.code, resolution.reason)
  if (input.project.id !== input.currentIdentity.projectId) {
    return fail('project-mismatch')
  }
  if (
    input.project.revision !== input.currentIdentity.documentRevision ||
    input.currentIdentity.sessionToken.revision !== input.currentIdentity.documentRevision
  ) {
    return fail('revision-conflict')
  }
  if (resolution.locked) return fail('target-locked')
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(input.now).success) return fail('invalid-clock')
  if (!imageAssetInputIsValid(input.asset, input.bytes)) return fail('invalid-asset')

  const hasExistingMeta = Object.hasOwn(input.project.assets, input.asset.id)
  const existingMeta = hasExistingMeta ? input.project.assets[input.asset.id] : undefined
  const hasExistingBytes = Object.hasOwn(input.sidecar.files, input.asset.id)
  const existingBytes = hasExistingBytes ? input.sidecar.files[input.asset.id] : undefined
  if (existingMeta && !sameAssetMeta(existingMeta, input.asset)) {
    return fail('asset-conflict')
  }
  if (existingBytes && !sameBytes(existingBytes, input.bytes)) {
    return fail('asset-conflict')
  }

  const previousAssetId = resolution.item.runtime.assets[input.target.bindingKey]!.assetId
  const hint = selectionHint(input.target, resolution.carrier)
  if (
    previousAssetId === input.asset.id &&
    hasExistingMeta &&
    hasExistingBytes
  ) {
    const unchanged = feedback(
      input.target,
      resolution.carrier,
      previousAssetId,
      input.asset.id,
      'unchanged',
    )
    return Object.freeze({
      ok: true as const,
      status: 'no-op' as const,
      plan: null,
      selectionHint: hint,
      feedback: unchanged,
    })
  }

  const disposition: Exclude<
    CourseRuntimeAssetReplacementFeedback['assetDisposition'],
    'unchanged'
  > = hasExistingMeta && hasExistingBytes
    ? 'reused'
    : (!hasExistingMeta && !hasExistingBytes && previousAssetId !== input.asset.id)
        ? 'added'
        : 'repaired'
  const resourceChange = planAssetFileHistoryChange(
    input.asset.id,
    existingBytes,
    input.bytes,
  )
  const next = structuredClone(input.project)
  if (!Object.hasOwn(next.assets, input.asset.id)) {
    Object.defineProperty(next.assets, input.asset.id, {
      value: structuredClone(input.asset),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  const nextResolution = resolveRuntimeTarget(next, input.target)
  if (!nextResolution.ok) return fail(nextResolution.code, nextResolution.reason)
  Object.defineProperty(nextResolution.item.runtime.assets, input.target.bindingKey, {
    value: { assetId: input.asset.id },
    enumerable: true,
    configurable: true,
    writable: true,
  })
  next.revision = input.project.revision + 1
  next.updatedAt = input.now

  const parsed = courseProjectDocumentSchema.safeParse(next)
  if (!parsed.success) {
    return fail(
      'invalid-document',
      parsed.error.issues[0]?.message ?? FAILURE_REASONS['invalid-document'],
    )
  }
  const committedFeedback = feedback(
    input.target,
    resolution.carrier,
    previousAssetId,
    input.asset.id,
    disposition,
  )
  const plan: CourseRuntimeAssetReplacementTransactionPlan = deepFreeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: parsed.data,
    resourceChanges: resourceChange
      ? { assetFileChanges: [resourceChange] }
      : {},
    selectionHint: hint,
    feedback: committedFeedback,
  })
  return Object.freeze({
    ok: true as const,
    status: 'planned' as const,
    plan,
  })
}
