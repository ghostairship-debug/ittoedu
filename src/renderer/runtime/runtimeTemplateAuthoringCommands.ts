import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import type {
  CourseAuthoringSessionToken,
  CourseAuthoringTargetRejectionCode,
  CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import {
  allocateCourseLayerOrder,
  collectCourseLayerItemIds,
  sortLayerItemList,
  sortScopedLayerList,
} from '@/renderer/course/globalLayerCommands'
import {
  courseProjectDocumentSchema,
  layerItemSchema,
} from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
  SlideSceneDocument,
} from '@/shared/courseProjectTypes'
import { z } from 'zod'

export const COURSE_RUNTIME_TEMPLATE_SLOT = 'runtime-template' as const

export type CourseRuntimeTemplateOwner = 'scene' | 'global'
export type CourseRuntimeTemplateCarrier = 'slide-scene' | 'global-layer'

/**
 * Stable identity of an empty Runtime slot. This deliberately is not a
 * CourseAuthoringTarget: no LayerItem or authoring address exists yet.
 */
export interface CourseRuntimeTemplateCreationTarget {
  readonly projectId: string
  readonly documentRevision: number
  readonly revisionPolicy: { readonly kind: 'exact' }
  readonly sessionGeneration: number
  readonly surfaceType: 'slide'
  readonly surfaceId: string
  readonly locationId: string
  readonly stateId: string | null
  readonly owner: CourseRuntimeTemplateOwner
  readonly ownerKey: string
  readonly sceneId: string | null
  readonly slot: typeof COURSE_RUNTIME_TEMPLATE_SLOT
}

export interface CourseRuntimeTemplateCreationSelectionHint {
  readonly itemId: string
  readonly locationId: string
  readonly stateId: string | null
  readonly surfaceId: string
  readonly sceneId: string | null
  readonly owner: CourseRuntimeTemplateOwner
  readonly ownerKey: string
  readonly carrier: CourseRuntimeTemplateCarrier
}

export interface CourseRuntimeTemplateCreationFeedback {
  readonly kind: 'runtime-template-created'
  readonly itemId: string
  readonly owner: CourseRuntimeTemplateOwner
  readonly carrier: CourseRuntimeTemplateCarrier
  readonly protocol: 'canvas-runtime'
  readonly runtimeApiVersion: 2
}

export type CourseRuntimeTemplateCreationTransactionPlan = EditorTransactionPlan<
  CourseRuntimeTemplateCreationSelectionHint,
  CourseRuntimeTemplateCreationFeedback
>

export type CourseRuntimeTemplateCreationFailureCode =
  | Exclude<CourseAuthoringTargetRejectionCode, 'item-missing'>
  | 'wrong-carrier'
  | 'invalid-target'
  | 'runtime-already-exists'
  | 'invalid-item-id'
  | 'id-conflict'
  | 'invalid-clock'
  | 'invalid-document'

/** Store-facing compatibility name for the planner failure discriminant. */
export type CourseRuntimeTemplateCreationPlanFailureCode =
  CourseRuntimeTemplateCreationFailureCode

export type CourseRuntimeTemplateCreationPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: CourseRuntimeTemplateCreationTransactionPlan
    }
  | {
      readonly ok: false
      readonly code: CourseRuntimeTemplateCreationFailureCode
      readonly reason: string
    }

export interface PlanRuntimeTemplateCreationInput {
  readonly project: CourseProjectDocument
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly target: CourseRuntimeTemplateCreationTarget
  /** Store-supplied ID keeps this planner deterministic and collision-testable. */
  readonly newItemId: string
  /** Explicit clock input keeps this planner deterministic and side-effect free. */
  readonly now: string
}

interface ResolvedRuntimeTemplateSlot {
  readonly scene: SlideSceneDocument
  readonly carrier: CourseRuntimeTemplateCarrier
}

type RuntimeTemplateSlotResolution =
  | { readonly ok: true; readonly value: ResolvedRuntimeTemplateSlot }
  | {
      readonly ok: false
      readonly code: Extract<
        CourseRuntimeTemplateCreationFailureCode,
        'surface-or-location' | 'wrong-carrier' | 'invalid-target' | 'runtime-already-exists'
      >
      readonly reason: string
    }

const EXACT_REVISION_POLICY = Object.freeze({ kind: 'exact' as const })
const ISO_TIMESTAMP_SCHEMA = z.string().datetime()
const STABLE_LAYER_ITEM_ID_SCHEMA = z.string().trim().min(1).max(240)

const EMPTY_RUNTIME_TEMPLATE_SOURCE = `CoursewareRuntime.define({
  runtimeApiVersion: 2,
  create(ctx) {
    return {
      destroy() {},
    }
  },
})`

const FAILURE_REASONS: Readonly<Record<
  CourseRuntimeTemplateCreationFailureCode,
  string
>> = Object.freeze({
  'project-mismatch': 'Runtime 模板目标不属于当前 Course Project',
  'session-stale': 'Runtime 模板创建会话已过期，请重新选择当前页面',
  'surface-or-location': 'Runtime 模板目标所在 Slide 或位置已改变',
  'owner-mismatch': 'Runtime 模板目标的编辑范围已改变',
  'revision-conflict': 'Course Project 已改变，请重新选择 Runtime 模板目标',
  'wrong-carrier': 'Runtime 模板目标不是当前 Slide 的场景或全局 slot',
  'invalid-target': 'Runtime 模板的稳定 slot 目标或呈现状态无效',
  'runtime-already-exists': '当前作用域已经存在 Runtime，未覆盖原定义',
  'invalid-item-id': 'Runtime 模板需要有效的 LayerItem ID',
  'id-conflict': 'Runtime 模板 LayerItem ID 已存在',
  'invalid-clock': 'Runtime 模板创建需要有效的显式时间',
  'invalid-document': 'Runtime 模板创建产生了无效的 Course Project V9 文档',
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

function requireIdentity(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} 不能为空`)
  }
  return value
}

/** Captures the supported Slide scene/global Runtime slot before dispatch. */
export function captureCourseRuntimeTemplateCreationTarget(input: {
  readonly sessionToken: CourseAuthoringSessionToken
  readonly projectId: string
  readonly surfaceId: string
  readonly stateId: string | null
  readonly owner: CourseRuntimeTemplateOwner
  readonly sceneId: string | null
}): CourseRuntimeTemplateCreationTarget {
  if (input.sessionToken.surfaceType !== 'slide') {
    throw new TypeError('Runtime 模板只能在 Slide 作者会话中创建')
  }
  const projectId = requireIdentity(input.projectId, 'projectId')
  const surfaceId = requireIdentity(input.surfaceId, 'surfaceId')
  const locationId = requireIdentity(input.sessionToken.locationId, 'locationId')
  const stateId = input.stateId === null
    ? null
    : requireIdentity(input.stateId, 'stateId')
  const sceneId = input.owner === 'scene'
    ? requireIdentity(input.sceneId ?? '', 'sceneId')
    : null
  if (input.owner === 'global' && input.sceneId !== null) {
    throw new TypeError('全局 Runtime 模板目标不能携带 sceneId')
  }
  return deepFreeze({
    projectId,
    documentRevision: input.sessionToken.revision,
    revisionPolicy: EXACT_REVISION_POLICY,
    sessionGeneration: input.sessionToken.generation,
    surfaceType: 'slide' as const,
    surfaceId,
    locationId,
    stateId,
    owner: input.owner,
    ownerKey: input.owner === 'global' ? 'global' : `scene:${sceneId}`,
    sceneId,
    slot: COURSE_RUNTIME_TEMPLATE_SLOT,
  })
}

function fail(
  code: CourseRuntimeTemplateCreationFailureCode,
  reason = FAILURE_REASONS[code],
): Extract<CourseRuntimeTemplateCreationPlanResult, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function resolutionFailure(
  code: Extract<RuntimeTemplateSlotResolution, { readonly ok: false }>['code'],
  reason = FAILURE_REASONS[code],
): Extract<RuntimeTemplateSlotResolution, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function resolveRuntimeTemplateSlot(
  project: CourseProjectDocument,
  target: CourseRuntimeTemplateCreationTarget,
): RuntimeTemplateSlotResolution {
  if (
    target.slot !== COURSE_RUNTIME_TEMPLATE_SLOT
    || target.surfaceType !== 'slide'
    || target.revisionPolicy?.kind !== 'exact'
  ) {
    return resolutionFailure('invalid-target')
  }
  const location = project.locations.find(
    (candidate) => candidate.id === target.locationId,
  )
  const surface = project.surfaces.find(
    (candidate) => candidate.id === target.surfaceId,
  )
  if (
    !location
    || !surface
    || location.kind !== 'slide-scene'
    || surface.type !== 'slide'
    || location.surfaceId !== surface.id
  ) {
    return resolutionFailure('surface-or-location')
  }
  const scene = surface.scenes.find(
    (candidate) => candidate.id === location.sceneId,
  )
  if (!scene) return resolutionFailure('surface-or-location')

  if (target.owner === 'scene') {
    if (
      target.sceneId !== scene.id
      || target.ownerKey !== `scene:${scene.id}`
    ) {
      return resolutionFailure('wrong-carrier')
    }
  } else if (
    target.owner !== 'global'
    || target.ownerKey !== 'global'
    || target.sceneId !== null
  ) {
    return resolutionFailure('wrong-carrier')
  }

  if (
    target.stateId !== null
    && !scene.presentation?.states.some(
      (candidate) => candidate.id === target.stateId,
    )
  ) {
    return resolutionFailure(
      'invalid-target',
      '捕获的 Slide presentation state 已不存在',
    )
  }

  const items = target.owner === 'global'
    ? project.globalLayerItems.map((entry) => entry.item)
    : scene.layerItems
  if (items.some((item) => item.kind === 'runtime')) {
    return resolutionFailure('runtime-already-exists')
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      scene,
      carrier: target.owner === 'global' ? 'global-layer' : 'slide-scene',
    }),
  })
}

function validateCurrentIdentity(
  input: PlanRuntimeTemplateCreationInput,
): Extract<CourseRuntimeTemplateCreationPlanResult, { readonly ok: false }> | null {
  const { currentIdentity: current, project, target } = input
  if (
    project.id !== target.projectId
    || current.projectId !== target.projectId
  ) {
    return fail('project-mismatch')
  }
  if (current.sessionToken.generation !== target.sessionGeneration) {
    return fail('session-stale')
  }
  if (
    current.sessionToken.surfaceType !== target.surfaceType
    || current.surfaceId !== target.surfaceId
    || current.sessionToken.locationId !== target.locationId
  ) {
    return fail('surface-or-location')
  }
  if (current.owner !== target.owner || current.ownerKey !== target.ownerKey) {
    return fail('owner-mismatch')
  }
  if (
    target.revisionPolicy?.kind !== 'exact'
    || target.documentRevision !== current.documentRevision
    || project.revision !== current.documentRevision
    || current.sessionToken.revision !== current.documentRevision
  ) {
    return fail('revision-conflict')
  }
  return null
}

function newItemIdIsValid(value: string): boolean {
  if (typeof value !== 'string' || value !== value.trim()) return false
  return STABLE_LAYER_ITEM_ID_SCHEMA.safeParse(value).success
}

function canonicalRuntimeTemplate(
  itemId: string,
  label: string,
  order: number,
): RuntimeLayerItem {
  return {
    kind: 'runtime',
    layerItemId: itemId,
    label,
    frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'phaser',
      source: EMPTY_RUNTIME_TEMPLATE_SOURCE,
      content: { values: {} },
      assets: {},
    },
  }
}

function selectionHint(
  target: CourseRuntimeTemplateCreationTarget,
  itemId: string,
  carrier: CourseRuntimeTemplateCarrier,
): CourseRuntimeTemplateCreationSelectionHint {
  return deepFreeze({
    itemId,
    locationId: target.locationId,
    stateId: target.stateId,
    surfaceId: target.surfaceId,
    sceneId: target.sceneId,
    owner: target.owner,
    ownerKey: target.ownerKey,
    carrier,
  })
}

function feedback(
  target: CourseRuntimeTemplateCreationTarget,
  itemId: string,
  carrier: CourseRuntimeTemplateCarrier,
): CourseRuntimeTemplateCreationFeedback {
  return deepFreeze({
    kind: 'runtime-template-created' as const,
    itemId,
    owner: target.owner,
    carrier,
    protocol: 'canvas-runtime' as const,
    runtimeApiVersion: 2 as const,
  })
}

/**
 * Plans one exact-slot canonical Runtime template create. Existing definitions
 * are explicit failures, never no-ops or whole-document replacements.
 */
export function planRuntimeTemplateCreation(
  input: PlanRuntimeTemplateCreationInput,
): CourseRuntimeTemplateCreationPlanResult {
  const identityFailure = validateCurrentIdentity(input)
  if (identityFailure) return identityFailure

  const resolution = resolveRuntimeTemplateSlot(input.project, input.target)
  if (!resolution.ok) return fail(resolution.code, resolution.reason)
  if (!newItemIdIsValid(input.newItemId)) return fail('invalid-item-id')
  if (collectCourseLayerItemIds(input.project).has(input.newItemId)) {
    return fail('id-conflict')
  }
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(input.now).success) {
    return fail('invalid-clock')
  }

  const order = allocateCourseLayerOrder(input.project, 0)
  const item = canonicalRuntimeTemplate(
    input.newItemId,
    input.target.owner === 'global' ? '全局运行时' : '场景运行时',
    order,
  )
  const parsedItem = layerItemSchema.safeParse(item)
  if (!parsedItem.success || parsedItem.data.kind !== 'runtime') {
    return fail(
      'invalid-document',
      parsedItem.success
        ? FAILURE_REASONS['invalid-document']
        : parsedItem.error.issues[0]?.message ?? FAILURE_REASONS['invalid-document'],
    )
  }

  const next = structuredClone(input.project)
  const nextResolution = resolveRuntimeTemplateSlot(next, input.target)
  if (!nextResolution.ok) {
    return fail(nextResolution.code, nextResolution.reason)
  }
  if (input.target.owner === 'global') {
    next.globalLayerItems.push({
      item: parsedItem.data,
      plane: 'overlay',
      visibility: { mode: 'all', locationIds: [] },
    })
    sortScopedLayerList(next.globalLayerItems)
  } else {
    nextResolution.value.scene.layerItems.push(parsedItem.data)
    sortLayerItemList(nextResolution.value.scene.layerItems)
  }
  next.revision = input.project.revision + 1
  next.updatedAt = input.now

  const parsed = courseProjectDocumentSchema.safeParse(next)
  if (!parsed.success) {
    return fail(
      'invalid-document',
      parsed.error.issues[0]?.message ?? FAILURE_REASONS['invalid-document'],
    )
  }
  const hint = selectionHint(input.target, input.newItemId, resolution.value.carrier)
  const result = feedback(input.target, input.newItemId, resolution.value.carrier)
  const plan: CourseRuntimeTemplateCreationTransactionPlan = deepFreeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: parsed.data,
    resourceChanges: {},
    selectionHint: hint,
    feedback: result,
  })
  return Object.freeze({
    ok: true as const,
    status: 'planned' as const,
    plan,
  })
}
