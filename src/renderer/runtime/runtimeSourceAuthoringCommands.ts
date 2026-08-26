import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import {
  validateCourseAuthoringTarget,
  type CourseAuthoringTarget,
  type CourseAuthoringTargetRejectionCode,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import { makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import { validateRuntimeSource } from '@/player/RuntimeRegistry'
import {
  courseProjectDocumentSchema,
  courseRuntimeDefinitionSchema,
} from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  LayerItem,
  RuntimeLayerItem,
  SlidePresentationState,
} from '@/shared/courseProjectTypes'
import { z } from 'zod'
import {
  COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
  type RuntimeSourceAuthoringCarrier,
} from './runtimeSourceAuthoringView'

export interface RuntimeSourceAuthoringSelectionHint {
  readonly itemId: string
  readonly authoringAddress: string
  readonly locationId: string
  readonly stateId: string | null
  readonly carrier: RuntimeSourceAuthoringCarrier
}

export interface RuntimeSourceAuthoringFeedback {
  readonly kind: 'runtime-source-updated' | 'runtime-source-unchanged'
  readonly itemId: string
  readonly carrier: RuntimeSourceAuthoringCarrier
  readonly protocol: RuntimeLayerItem['runtime']['protocol']
  readonly runtimeApiVersion: RuntimeLayerItem['runtime']['runtimeApiVersion']
}

export type RuntimeSourceAuthoringTransactionPlan = EditorTransactionPlan<
  RuntimeSourceAuthoringSelectionHint,
  RuntimeSourceAuthoringFeedback
>

export type RuntimeSourceAuthoringFailureCode =
  | CourseAuthoringTargetRejectionCode
  | 'wrong-carrier'
  | 'invalid-target'
  | 'target-locked'
  | 'invalid-source'
  | 'invalid-clock'
  | 'invalid-document'

/** Store-facing compatibility name for the planner failure discriminant. */
export type RuntimeSourceAuthoringPlanFailureCode =
  RuntimeSourceAuthoringFailureCode

export type RuntimeSourceAuthoringPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: RuntimeSourceAuthoringTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly selectionHint: RuntimeSourceAuthoringSelectionHint
      readonly feedback: RuntimeSourceAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimeSourceAuthoringFailureCode
      readonly reason: string
    }

export interface PlanRuntimeSourceUpdateInput {
  readonly project: CourseProjectDocument
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly target: CourseAuthoringTarget
  readonly source: string
  /** Explicit clock input keeps this planner deterministic and side-effect free. */
  readonly now: string
}

interface ResolvedRuntimeTarget {
  readonly item: RuntimeLayerItem
  readonly carrier: RuntimeSourceAuthoringCarrier
  readonly sceneId: string | null
  readonly effectiveLocked: boolean
}

type RuntimeTargetResolution =
  | { readonly ok: true; readonly value: ResolvedRuntimeTarget }
  | {
      readonly ok: false
      readonly code: Extract<
        RuntimeSourceAuthoringFailureCode,
        | 'project-mismatch'
        | 'surface-or-location'
        | 'wrong-carrier'
        | 'invalid-target'
        | 'item-missing'
      >
      readonly reason: string
    }

const ISO_TIMESTAMP_SCHEMA = z.string().datetime()

const FAILURE_REASONS: Readonly<Record<RuntimeSourceAuthoringFailureCode, string>> =
  Object.freeze({
    'project-mismatch': 'Runtime 源码目标不属于当前 Course Project',
    'session-stale': 'Runtime 源码编辑会话已过期，请重新选择目标',
    'surface-or-location': 'Runtime 源码目标所在页面或 Surface 已改变',
    'owner-mismatch': 'Runtime 源码目标的共享范围已改变',
    'item-missing': '原 Runtime 图层已不存在，请重新选择目标',
    'revision-conflict': 'Course Project 已改变，请重新选择 Runtime 源码目标',
    'wrong-carrier': 'Runtime 图层已移动到其他 carrier',
    'invalid-target': 'Runtime 源码目标的稳定作者地址、类型或状态无效',
    'target-locked': 'Runtime 图层已锁定，不能修改源码',
    'invalid-source': 'Runtime 源码无效',
    'invalid-clock': 'Runtime 源码提交需要有效的显式时间',
    'invalid-document': 'Runtime 源码提交产生了无效的 Course Project V9 文档',
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
  code: RuntimeSourceAuthoringFailureCode,
  reason = FAILURE_REASONS[code],
): Extract<RuntimeSourceAuthoringPlanResult, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function resolutionFailure(
  code: Extract<RuntimeTargetResolution, { readonly ok: false }>['code'],
  reason = FAILURE_REASONS[code],
): Extract<RuntimeTargetResolution, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
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
  blocks: ReadonlyArray<Extract<CourseSurfaceDocument, { type: 'flow' }>['blocks'][number]>,
  itemId: string,
): boolean {
  return blocks.some((block) => (
    block.id === itemId
    || (block.type === 'section' && flowBlockIdExists(block.blocks, itemId))
  ))
}

function sameLayerItemIdExists(project: CourseProjectDocument, itemId: string): boolean {
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

function resolveRuntimeTarget(
  project: CourseProjectDocument,
  target: CourseAuthoringTarget,
): RuntimeTargetResolution {
  if (project.id !== target.projectId) {
    return resolutionFailure('project-mismatch')
  }
  const resolved = surfaceAtTarget(project, target)
  if (!resolved) return resolutionFailure('surface-or-location')
  const state = capturedSlideState(target, resolved)
  if (state === 'invalid') {
    return resolutionFailure(
      'invalid-target',
      target.surfaceType === 'slide'
        ? '捕获的 Slide presentation state 已不存在'
        : '非 Slide Runtime 目标不能携带 presentation state',
    )
  }

  let candidate: RuntimeLayerItem | 'wrong-type' | undefined
  let carrier: RuntimeSourceAuthoringCarrier
  let sceneId: string | null = null
  if (target.owner === 'global') {
    if (target.ownerKey !== 'global') return resolutionFailure('wrong-carrier')
    candidate = runtimeFromExpectedCarrier(
      project.globalLayerItems.map((entry) => entry.item),
      target.itemId,
    )
    carrier = 'global-layer'
  } else if (target.owner === 'surface') {
    if (target.ownerKey !== `surface:${resolved.surface.id}`) {
      return resolutionFailure('wrong-carrier')
    }
    candidate = runtimeFromExpectedCarrier(
      resolved.surface.surfaceLayerItems.map((entry) => entry.item),
      target.itemId,
    )
    if (
      !candidate
      && resolved.surface.type === 'flow'
      && flowBlockIdExists(resolved.surface.blocks, target.itemId)
    ) {
      return resolutionFailure(
        'wrong-carrier',
        'Flow 正文 block 不是 Runtime LayerItem carrier',
      )
    }
    carrier = 'surface-layer'
  } else if (target.owner === 'scene') {
    if (
      resolved.surface.type !== 'slide'
      || resolved.location.kind !== 'slide-scene'
      || target.ownerKey !== `scene:${resolved.location.sceneId}`
    ) {
      return resolutionFailure('wrong-carrier')
    }
    sceneId = resolved.location.sceneId
    const scene = resolved.surface.scenes.find((entry) => entry.id === sceneId)
    candidate = scene
      ? runtimeFromExpectedCarrier(scene.layerItems, target.itemId)
      : undefined
    carrier = 'slide-scene'
  } else {
    if (
      resolved.surface.type !== 'spatial-2d'
      || resolved.location.kind !== 'spatial-camera'
      || target.ownerKey !== `world:${resolved.surface.id}`
    ) {
      return resolutionFailure('wrong-carrier')
    }
    candidate = runtimeFromExpectedCarrier(
      resolved.surface.world.layerItems,
      target.itemId,
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
      sameLayerItemIdExists(project, target.itemId) ? 'wrong-carrier' : 'item-missing',
    )
  }

  const canonicalAddress = makeLayerItemAuthoringAddress({
    projectId: project.id,
    owner: target.owner,
    surfaceId: resolved.surface.id,
    sceneId,
    kind: 'runtime',
    layerItemId: candidate.layerItemId,
    field: COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
  })
  if (canonicalAddress !== target.authoringAddress) {
    return resolutionFailure('invalid-target')
  }
  const effectiveLocked = target.owner === 'scene' && state !== null
    ? state.layerItemOverrides[candidate.layerItemId]?.locked ?? candidate.locked
    : candidate.locked
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      item: candidate,
      carrier,
      sceneId,
      effectiveLocked,
    }),
  })
}

function selectionHint(
  target: CourseAuthoringTarget,
  carrier: RuntimeSourceAuthoringCarrier,
): RuntimeSourceAuthoringSelectionHint {
  return deepFreeze({
    itemId: target.itemId,
    authoringAddress: target.authoringAddress,
    locationId: target.locationId,
    stateId: target.stateId,
    carrier,
  })
}

function feedback(
  kind: RuntimeSourceAuthoringFeedback['kind'],
  item: RuntimeLayerItem,
  carrier: RuntimeSourceAuthoringCarrier,
): RuntimeSourceAuthoringFeedback {
  return deepFreeze({
    kind,
    itemId: item.layerItemId,
    carrier,
    protocol: item.runtime.protocol,
    runtimeApiVersion: item.runtime.runtimeApiVersion,
  })
}

function validateSource(
  item: RuntimeLayerItem,
  source: string,
): Extract<RuntimeSourceAuthoringPlanResult, { readonly ok: false }> | null {
  if (typeof source !== 'string') return fail('invalid-source')
  try {
    validateRuntimeSource(source)
    // Compile without executing. Runtime registration and lifecycle execution
    // remain inside the isolated Player host.
    Function(`"use strict";\n${source}`)
  } catch (error) {
    return fail(
      'invalid-source',
      error instanceof Error ? error.message : FAILURE_REASONS['invalid-source'],
    )
  }
  const definition = courseRuntimeDefinitionSchema.safeParse({
    ...item.runtime,
    source,
  })
  if (!definition.success) {
    const issue = definition.error.issues[0]
    return fail(
      issue?.path[0] === 'source' ? 'invalid-source' : 'invalid-document',
      issue?.message,
    )
  }
  return null
}

/**
 * Plans one exact-field Runtime source edit without touching the V8 projection,
 * resources or any other Runtime/LayerItem field.
 */
export function planRuntimeSourceUpdate(
  input: PlanRuntimeSourceUpdateInput,
): RuntimeSourceAuthoringPlanResult {
  const resolution = resolveRuntimeTarget(input.project, input.target)
  if (
    input.target.surfaceType !== 'slide'
    && input.currentIdentity.stateId !== null
  ) {
    return fail(
      'invalid-target',
      '非 Slide Runtime 当前身份不能携带 presentation state',
    )
  }
  // Runtime source is shared across named states. State A -> B alone does not
  // stale the draft, while target resolution still checks state A existence and
  // uses its effective lock.
  const validation = validateCourseAuthoringTarget({
    target: { ...input.target, stateId: null },
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
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(input.now).success) {
    return fail('invalid-clock')
  }
  const sourceFailure = validateSource(resolution.value.item, input.source)
  if (sourceFailure) return sourceFailure

  const hint = selectionHint(input.target, resolution.value.carrier)
  if (resolution.value.item.runtime.source === input.source) {
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
        'runtime-source-unchanged',
        resolution.value.item,
        resolution.value.carrier,
      ),
    })
  }

  const next = structuredClone(input.project)
  const nextResolution = resolveRuntimeTarget(next, input.target)
  if (!nextResolution.ok) {
    return fail(nextResolution.code, nextResolution.reason)
  }
  nextResolution.value.item.runtime.source = input.source
  next.revision = input.project.revision + 1
  next.updatedAt = input.now

  const parsed = courseProjectDocumentSchema.safeParse(next)
  if (!parsed.success) {
    return fail(
      'invalid-document',
      parsed.error.issues[0]?.message ?? FAILURE_REASONS['invalid-document'],
    )
  }
  const plan: RuntimeSourceAuthoringTransactionPlan = deepFreeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: parsed.data,
    resourceChanges: {},
    selectionHint: hint,
    feedback: feedback(
      'runtime-source-updated',
      nextResolution.value.item,
      nextResolution.value.carrier,
    ),
  })
  return Object.freeze({
    ok: true as const,
    status: 'planned' as const,
    plan,
  })
}
