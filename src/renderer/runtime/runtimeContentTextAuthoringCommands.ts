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
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  LayerItem,
  RuntimeLayerItem,
  SlidePresentationState,
} from '@/shared/courseProjectTypes'
import { z } from 'zod'

export type RuntimeContentTextAuthoringCarrier =
  | 'global-layer'
  | 'surface-layer'
  | 'slide-scene'
  | 'spatial-world'

/** Exact persisted Runtime content field captured when a visible edit begins. */
export interface CourseRuntimeContentTextTarget {
  readonly courseTarget: CourseAuthoringTarget
  readonly contentKey: string
  readonly initialValue: string
}

export interface CaptureCourseRuntimeContentTextTargetInput {
  readonly sessionToken: CourseAuthoringSessionToken
  readonly projectId: string
  readonly surfaceId: string
  readonly stateId: string | null
  readonly owner: CourseAuthoringOwner
  readonly sceneId: string | null
  readonly itemId: string
  readonly contentKey: string
  readonly initialValue: string
}

export interface RuntimeContentTextAuthoringSelectionHint {
  readonly itemId: string
  readonly contentKey: string
  readonly authoringAddress: string
  readonly locationId: string
  readonly stateId: string | null
  readonly carrier: RuntimeContentTextAuthoringCarrier
}

export interface RuntimeContentTextAuthoringFeedback {
  readonly kind:
    | 'runtime-content-text-updated'
    | 'runtime-content-text-unchanged'
  readonly itemId: string
  readonly contentKey: string
  readonly previousValue: string
  readonly value: string
  readonly carrier: RuntimeContentTextAuthoringCarrier
  readonly protocol: RuntimeLayerItem['runtime']['protocol']
  readonly runtimeApiVersion: RuntimeLayerItem['runtime']['runtimeApiVersion']
}

export type RuntimeContentTextAuthoringTransactionPlan = EditorTransactionPlan<
  RuntimeContentTextAuthoringSelectionHint,
  RuntimeContentTextAuthoringFeedback
>

export type RuntimeContentTextAuthoringFailureCode =
  | CourseAuthoringTargetRejectionCode
  | 'wrong-carrier'
  | 'invalid-target'
  | 'target-locked'
  | 'content-key-missing'
  | 'content-changed'
  | 'invalid-value'
  | 'invalid-clock'
  | 'invalid-document'

/** Store-facing compatibility name for the planner failure discriminant. */
export type RuntimeContentTextAuthoringPlanFailureCode =
  RuntimeContentTextAuthoringFailureCode

export type RuntimeContentTextAuthoringPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: RuntimeContentTextAuthoringTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly selectionHint: RuntimeContentTextAuthoringSelectionHint
      readonly feedback: RuntimeContentTextAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimeContentTextAuthoringFailureCode
      readonly reason: string
    }

/** Short alias for consumers that do not need the longer authoring name. */
export type RuntimeContentTextPlanResult =
  RuntimeContentTextAuthoringPlanResult

export interface PlanRuntimeContentTextUpdateInput {
  readonly project: CourseProjectDocument
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly target: CourseRuntimeContentTextTarget
  readonly value: string
  /** Explicit clock input keeps this planner deterministic and side-effect free. */
  readonly now: string
}

interface ResolvedRuntimeContentTextTarget {
  readonly item: RuntimeLayerItem
  readonly carrier: RuntimeContentTextAuthoringCarrier
  readonly sceneId: string | null
  readonly effectiveLocked: boolean
  readonly currentValue: string
}

type RuntimeContentTextTargetResolution =
  | {
      readonly ok: true
      readonly value: ResolvedRuntimeContentTextTarget
    }
  | {
      readonly ok: false
      readonly code: Extract<
        RuntimeContentTextAuthoringFailureCode,
        | 'project-mismatch'
        | 'surface-or-location'
        | 'wrong-carrier'
        | 'invalid-target'
        | 'item-missing'
        | 'content-key-missing'
      >
      readonly reason: string
    }

const ISO_TIMESTAMP_SCHEMA = z.string().datetime()
const MAX_CONTENT_KEY_LENGTH = 256
const UNSAFE_CONTENT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const FAILURE_REASONS: Readonly<Record<
  RuntimeContentTextAuthoringFailureCode,
  string
>> = Object.freeze({
  'project-mismatch': 'Runtime 文字目标不属于当前 Course Project',
  'session-stale': 'Runtime 文字编辑会话已过期，请重新选择目标',
  'surface-or-location': 'Runtime 文字目标所在页面或 Surface 已改变',
  'owner-mismatch': 'Runtime 文字目标的共享范围已改变',
  'item-missing': '原 Runtime 图层已不存在，请重新选择目标',
  'revision-conflict': 'Course Project 已改变，请重新打开 Runtime 文字编辑',
  'wrong-carrier': 'Runtime 图层已移动到其他 carrier',
  'invalid-target': 'Runtime 文字目标的稳定作者地址、类型或状态无效',
  'target-locked': 'Runtime 图层已锁定，不能修改文字',
  'content-key-missing': 'Runtime 已不再声明这个文字字段',
  'content-changed': 'Runtime 文字已在编辑期间改变，请重新打开',
  'invalid-value': 'Runtime 文字必须是字符串',
  'invalid-clock': 'Runtime 文字提交需要有效的显式时间',
  'invalid-document': 'Runtime 文字提交产生了无效的 Course Project V9 文档',
})

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
    || Object.isFrozen(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function fail(
  code: RuntimeContentTextAuthoringFailureCode,
  reason = FAILURE_REASONS[code],
): Extract<RuntimeContentTextAuthoringPlanResult, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function resolutionFailure(
  code: Extract<RuntimeContentTextTargetResolution, { readonly ok: false }>['code'],
  reason = FAILURE_REASONS[code],
): Extract<RuntimeContentTextTargetResolution, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function jsonPointerEscape(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function contentKeyIsValid(contentKey: unknown): contentKey is string {
  return typeof contentKey === 'string'
    && contentKey.trim().length > 0
    && contentKey.length <= MAX_CONTENT_KEY_LENGTH
    && !UNSAFE_CONTENT_KEYS.has(contentKey)
}

/** Stable field path shared with Runtime host hits and the V9 inventory. */
export function courseRuntimeContentValueAuthoringField(contentKey: string): string {
  if (!contentKeyIsValid(contentKey)) {
    throw new TypeError(
      `Runtime 文字键必须为 1–${MAX_CONTENT_KEY_LENGTH} 个安全字符`,
    )
  }
  return `runtime/content/values/${jsonPointerEscape(contentKey)}`
}

/** Captures a field-specific V9 target before the local text overlay opens. */
export function captureCourseRuntimeContentTextTarget(
  input: CaptureCourseRuntimeContentTextTargetInput,
): CourseRuntimeContentTextTarget {
  if (typeof input.initialValue !== 'string') {
    throw new TypeError('Runtime 文字初始值必须是字符串')
  }
  const field = courseRuntimeContentValueAuthoringField(input.contentKey)
  const ownerKey = ownerKeyFor(input.owner, input.surfaceId, input.sceneId)
  const authoringAddress = makeLayerItemAuthoringAddress({
    projectId: input.projectId,
    owner: input.owner,
    surfaceId: input.surfaceId,
    sceneId: input.sceneId,
    kind: 'runtime',
    layerItemId: input.itemId,
    field,
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
    contentKey: input.contentKey,
    initialValue: input.initialValue,
  })
}

function surfaceAtTarget(
  project: CourseProjectDocument,
  target: CourseAuthoringTarget,
): {
  readonly location: CourseProjectDocument['locations'][number]
  readonly surface: CourseSurfaceDocument
} | null {
  const location = project.locations.find((candidate) => candidate.id === target.locationId)
  const surface = project.surfaces.find((candidate) => candidate.id === target.surfaceId)
  if (
    !location
    || !surface
    || location.surfaceId !== surface.id
    || target.surfaceType !== surface.type
  ) {
    return null
  }
  const kindMatches =
    (location.kind === 'slide-scene' && surface.type === 'slide')
    || (location.kind === 'flow-block' && surface.type === 'flow')
    || (location.kind === 'spatial-camera' && surface.type === 'spatial-2d')
  return kindMatches ? { location, surface } : null
}

function flowBlockIdExists(
  blocks: ReadonlyArray<Extract<
    CourseSurfaceDocument,
    { type: 'flow' }
  >['blocks'][number]>,
  itemId: string,
): boolean {
  return blocks.some((block) => (
    block.id === itemId
    || (block.type === 'section' && flowBlockIdExists(block.blocks, itemId))
  ))
}

function sameLayerItemIdExists(
  project: CourseProjectDocument,
  itemId: string,
): boolean {
  if (project.globalLayerItems.some((entry) => entry.item.layerItemId === itemId)) {
    return true
  }
  return project.surfaces.some((surface) => (
    surface.surfaceLayerItems.some((entry) => entry.item.layerItemId === itemId)
    || (surface.type === 'slide' && surface.scenes.some((scene) => (
      scene.layerItems.some((item) => item.layerItemId === itemId)
    )))
    || (surface.type === 'flow' && flowBlockIdExists(surface.blocks, itemId))
    || (surface.type === 'spatial-2d' && surface.world.layerItems.some(
      (item) => item.layerItemId === itemId,
    ))
  ))
}

function runtimeFromExpectedCarrier(
  items: ReadonlyArray<LayerItem>,
  itemId: string,
): RuntimeLayerItem | 'wrong-type' | undefined {
  const item = items.find((candidate) => candidate.layerItemId === itemId)
  if (!item) return undefined
  return item.kind === 'runtime' ? item : 'wrong-type'
}

function capturedSlideState(
  target: CourseAuthoringTarget,
  resolved: NonNullable<ReturnType<typeof surfaceAtTarget>>,
): SlidePresentationState | null | 'invalid' {
  if (resolved.surface.type !== 'slide' || resolved.location.kind !== 'slide-scene') {
    return target.stateId === null ? null : 'invalid'
  }
  if (target.stateId === null) return null
  const sceneId = resolved.location.sceneId
  const scene = resolved.surface.scenes.find(
    (candidate) => candidate.id === sceneId,
  )
  return scene?.presentation?.states.find(
    (candidate) => candidate.id === target.stateId,
  ) ?? 'invalid'
}

function resolveRuntimeContentTextTarget(
  project: CourseProjectDocument,
  target: CourseRuntimeContentTextTarget,
): RuntimeContentTextTargetResolution {
  const stable = target.courseTarget
  if (project.id !== stable.projectId) {
    return resolutionFailure('project-mismatch')
  }
  if (
    !contentKeyIsValid(target.contentKey)
    || typeof target.initialValue !== 'string'
  ) {
    return resolutionFailure('invalid-target')
  }
  const resolved = surfaceAtTarget(project, stable)
  if (!resolved) return resolutionFailure('surface-or-location')
  const state = capturedSlideState(stable, resolved)
  if (state === 'invalid') {
    return resolutionFailure(
      'invalid-target',
      stable.surfaceType === 'slide'
        ? '捕获的 Slide presentation state 已不存在'
        : '非 Slide Runtime 目标不能携带 presentation state',
    )
  }

  let candidate: RuntimeLayerItem | 'wrong-type' | undefined
  let carrier: RuntimeContentTextAuthoringCarrier
  let sceneId: string | null = null
  if (stable.owner === 'global') {
    if (stable.ownerKey !== 'global') return resolutionFailure('wrong-carrier')
    candidate = runtimeFromExpectedCarrier(
      project.globalLayerItems.map((entry) => entry.item),
      stable.itemId,
    )
    carrier = 'global-layer'
  } else if (stable.owner === 'surface') {
    if (stable.ownerKey !== `surface:${resolved.surface.id}`) {
      return resolutionFailure('wrong-carrier')
    }
    candidate = runtimeFromExpectedCarrier(
      resolved.surface.surfaceLayerItems.map((entry) => entry.item),
      stable.itemId,
    )
    if (
      !candidate
      && resolved.surface.type === 'flow'
      && flowBlockIdExists(resolved.surface.blocks, stable.itemId)
    ) {
      return resolutionFailure(
        'wrong-carrier',
        'Flow 正文 block 不是 Runtime LayerItem carrier',
      )
    }
    carrier = 'surface-layer'
  } else if (stable.owner === 'scene') {
    if (
      resolved.surface.type !== 'slide'
      || resolved.location.kind !== 'slide-scene'
      || stable.ownerKey !== `scene:${resolved.location.sceneId}`
    ) {
      return resolutionFailure('wrong-carrier')
    }
    sceneId = resolved.location.sceneId
    const scene = resolved.surface.scenes.find((entry) => entry.id === sceneId)
    candidate = scene
      ? runtimeFromExpectedCarrier(scene.layerItems, stable.itemId)
      : undefined
    carrier = 'slide-scene'
  } else {
    if (
      resolved.surface.type !== 'spatial-2d'
      || resolved.location.kind !== 'spatial-camera'
      || stable.ownerKey !== `world:${resolved.surface.id}`
    ) {
      return resolutionFailure('wrong-carrier')
    }
    candidate = runtimeFromExpectedCarrier(
      resolved.surface.world.layerItems,
      stable.itemId,
    )
    carrier = 'spatial-world'
  }

  if (candidate === 'wrong-type') {
    return resolutionFailure(
      'invalid-target',
      '捕获的图层已不再是 Runtime LayerItem',
    )
  }
  if (!candidate) {
    return resolutionFailure(
      sameLayerItemIdExists(project, stable.itemId) ? 'wrong-carrier' : 'item-missing',
    )
  }

  const canonicalAddress = makeLayerItemAuthoringAddress({
    projectId: project.id,
    owner: stable.owner,
    surfaceId: resolved.surface.id,
    sceneId,
    kind: 'runtime',
    layerItemId: candidate.layerItemId,
    field: courseRuntimeContentValueAuthoringField(target.contentKey),
  })
  if (canonicalAddress !== stable.authoringAddress) {
    return resolutionFailure('invalid-target')
  }
  if (!Object.hasOwn(candidate.runtime.content.values, target.contentKey)) {
    return resolutionFailure('content-key-missing')
  }
  const currentValue = candidate.runtime.content.values[target.contentKey]
  if (typeof currentValue !== 'string') {
    return resolutionFailure('invalid-target')
  }
  const effectiveLocked = stable.owner === 'scene' && state !== null
    ? state.layerItemOverrides[candidate.layerItemId]?.locked ?? candidate.locked
    : candidate.locked
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      item: candidate,
      carrier,
      sceneId,
      effectiveLocked,
      currentValue,
    }),
  })
}

function selectionHint(
  target: CourseRuntimeContentTextTarget,
  carrier: RuntimeContentTextAuthoringCarrier,
): RuntimeContentTextAuthoringSelectionHint {
  return deepFreeze({
    itemId: target.courseTarget.itemId,
    contentKey: target.contentKey,
    authoringAddress: target.courseTarget.authoringAddress,
    locationId: target.courseTarget.locationId,
    stateId: target.courseTarget.stateId,
    carrier,
  })
}

function feedback(
  kind: RuntimeContentTextAuthoringFeedback['kind'],
  target: CourseRuntimeContentTextTarget,
  resolved: ResolvedRuntimeContentTextTarget,
  value: string,
): RuntimeContentTextAuthoringFeedback {
  return deepFreeze({
    kind,
    itemId: resolved.item.layerItemId,
    contentKey: target.contentKey,
    previousValue: resolved.currentValue,
    value,
    carrier: resolved.carrier,
    protocol: resolved.item.runtime.protocol,
    runtimeApiVersion: resolved.item.runtime.runtimeApiVersion,
  })
}

/**
 * Plans one exact Runtime content string edit without reading a Player hit,
 * touching the V8 projection, changing resources or coupling layer visibility.
 */
export function planRuntimeContentTextUpdate(
  input: PlanRuntimeContentTextUpdateInput,
): RuntimeContentTextAuthoringPlanResult {
  const resolution = resolveRuntimeContentTextTarget(input.project, input.target)
  if (
    input.target.courseTarget.surfaceType !== 'slide'
    && input.currentIdentity.stateId !== null
  ) {
    return fail(
      'invalid-target',
      '非 Slide Runtime 当前身份不能携带 presentation state',
    )
  }
  // Runtime content is shared by all named states. A -> B alone does not stale
  // the target, while resolution still validates state A and its effective lock.
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
    input.project.revision !== input.currentIdentity.documentRevision
    || input.currentIdentity.sessionToken.revision
      !== input.currentIdentity.documentRevision
  ) {
    return fail('revision-conflict')
  }
  if (resolution.value.effectiveLocked) return fail('target-locked')
  if (resolution.value.currentValue !== input.target.initialValue) {
    return fail('content-changed')
  }
  if (typeof input.value !== 'string') return fail('invalid-value')
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(input.now).success) {
    return fail('invalid-clock')
  }

  const hint = selectionHint(input.target, resolution.value.carrier)
  if (resolution.value.currentValue === input.value) {
    const parsed = courseProjectDocumentSchema.safeParse(structuredClone(input.project))
    if (!parsed.success) {
      return fail(
        'invalid-document',
        parsed.error.issues[0]?.message ?? FAILURE_REASONS['invalid-document'],
      )
    }
    return deepFreeze({
      ok: true as const,
      status: 'no-op' as const,
      plan: null,
      selectionHint: hint,
      feedback: feedback(
        'runtime-content-text-unchanged',
        input.target,
        resolution.value,
        input.value,
      ),
    })
  }

  const next = structuredClone(input.project)
  const nextResolution = resolveRuntimeContentTextTarget(next, input.target)
  if (!nextResolution.ok) {
    return fail(nextResolution.code, nextResolution.reason)
  }
  nextResolution.value.item.runtime.content.values[input.target.contentKey] = input.value
  next.revision = input.project.revision + 1
  next.updatedAt = input.now

  const parsed = courseProjectDocumentSchema.safeParse(next)
  if (!parsed.success) {
    return fail(
      'invalid-document',
      parsed.error.issues[0]?.message ?? FAILURE_REASONS['invalid-document'],
    )
  }
  const plan: RuntimeContentTextAuthoringTransactionPlan = deepFreeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: parsed.data,
    resourceChanges: {},
    selectionHint: hint,
    feedback: feedback(
      'runtime-content-text-updated',
      input.target,
      resolution.value,
      input.value,
    ),
  })
  return Object.freeze({
    ok: true as const,
    status: 'planned' as const,
    plan,
  })
}
