import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import {
  validateCourseAuthoringTarget,
  type CourseAuthoringTarget,
  type CourseAuthoringTargetRejectionCode,
  type CurrentCourseAuthoringTargetIdentity,
} from '@/renderer/authoring/courseAuthoringSession'
import { makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseRuntimeDefinition,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import { z } from 'zod'
import {
  selectRuntimeSourceAuthoringView,
  type AvailableRuntimeSourceAuthoringView,
  type RuntimeSourceAuthoringCarrier,
} from './runtimeSourceAuthoringView'

export const COURSE_RUNTIME_ENABLED_AUTHORING_FIELD = 'runtime/enabled' as const
export const COURSE_RUNTIME_RENDER_MODE_AUTHORING_FIELD = 'runtime/renderMode' as const

export type RuntimePropertyAuthoringField = 'enabled' | 'renderMode'
export type RuntimeRenderMode = CourseRuntimeDefinition['renderMode']

export type CourseRuntimePropertyTarget =
  | {
      readonly field: 'enabled'
      readonly courseTarget: CourseAuthoringTarget
      readonly initialValue: boolean
    }
  | {
      readonly field: 'renderMode'
      readonly courseTarget: CourseAuthoringTarget
      readonly initialValue: RuntimeRenderMode
    }

export type CourseRuntimePropertyUpdate =
  | { readonly field: 'enabled'; readonly value: boolean }
  | { readonly field: 'renderMode'; readonly value: RuntimeRenderMode }

export interface RuntimePropertyAuthoringSelectionHint {
  readonly itemId: string
  readonly field: RuntimePropertyAuthoringField
  readonly authoringAddress: string
  readonly locationId: string
  readonly stateId: string | null
  readonly carrier: RuntimeSourceAuthoringCarrier
}

export interface RuntimePropertyAuthoringFeedback {
  readonly kind: 'runtime-property-updated' | 'runtime-property-unchanged'
  readonly itemId: string
  readonly field: RuntimePropertyAuthoringField
  readonly previousValue: boolean | RuntimeRenderMode
  readonly value: boolean | RuntimeRenderMode
  readonly carrier: RuntimeSourceAuthoringCarrier
  readonly protocol: RuntimeLayerItem['runtime']['protocol']
  readonly runtimeApiVersion: RuntimeLayerItem['runtime']['runtimeApiVersion']
}

export type RuntimePropertyAuthoringTransactionPlan = EditorTransactionPlan<
  RuntimePropertyAuthoringSelectionHint,
  RuntimePropertyAuthoringFeedback
>

export type RuntimePropertyAuthoringFailureCode =
  | CourseAuthoringTargetRejectionCode
  | 'wrong-carrier'
  | 'invalid-target'
  | 'target-locked'
  | 'property-changed'
  | 'invalid-value'
  | 'invalid-clock'
  | 'invalid-document'

/** Store-facing compatibility name for the planner failure discriminant. */
export type RuntimePropertyAuthoringPlanFailureCode =
  RuntimePropertyAuthoringFailureCode

export type RuntimePropertyAuthoringPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: RuntimePropertyAuthoringTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly selectionHint: RuntimePropertyAuthoringSelectionHint
      readonly feedback: RuntimePropertyAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimePropertyAuthoringFailureCode
      readonly reason: string
    }

export interface PlanRuntimePropertyUpdateInput {
  readonly project: CourseProjectDocument
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly target: CourseRuntimePropertyTarget
  readonly update: CourseRuntimePropertyUpdate
  /** Explicit clock input keeps this planner deterministic and side-effect free. */
  readonly now: string
}

interface ResolvedRuntimePropertyTarget {
  readonly view: AvailableRuntimeSourceAuthoringView
  readonly currentValue: boolean | RuntimeRenderMode
}

type RuntimePropertyTargetResolution =
  | { readonly ok: true; readonly value: ResolvedRuntimePropertyTarget }
  | {
      readonly ok: false
      readonly code: Extract<
        RuntimePropertyAuthoringFailureCode,
        | 'project-mismatch'
        | 'surface-or-location'
        | 'wrong-carrier'
        | 'invalid-target'
        | 'item-missing'
      >
      readonly reason: string
    }

const ISO_TIMESTAMP_SCHEMA = z.string().datetime()
const RENDER_MODES = new Set<RuntimeRenderMode>(['phaser', 'dom', 'hybrid'])

const FAILURE_REASONS: Readonly<Record<
  RuntimePropertyAuthoringFailureCode,
  string
>> = Object.freeze({
  'project-mismatch': 'Runtime 属性目标不属于当前 Course Project',
  'session-stale': 'Runtime 属性编辑会话已过期，请重新选择目标',
  'surface-or-location': 'Runtime 属性目标所在页面或 Surface 已改变',
  'owner-mismatch': 'Runtime 属性目标的共享范围已改变',
  'item-missing': '原 Runtime 图层已不存在，请重新选择目标',
  'revision-conflict': 'Course Project 已改变，请重新打开 Runtime 属性编辑',
  'wrong-carrier': 'Runtime 图层已移动到其他 carrier',
  'invalid-target': 'Runtime 属性目标的稳定作者地址、类型或状态无效',
  'target-locked': 'Runtime 图层已锁定，不能修改属性',
  'property-changed': 'Runtime 属性已在编辑期间改变，请重新打开',
  'invalid-value': 'Runtime 属性值无效',
  'invalid-clock': 'Runtime 属性提交需要有效的显式时间',
  'invalid-document': 'Runtime 属性提交产生了无效的 Course Project V9 文档',
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
  code: RuntimePropertyAuthoringFailureCode,
  reason = FAILURE_REASONS[code],
): Extract<RuntimePropertyAuthoringPlanResult, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function resolutionFailure(
  code: Extract<RuntimePropertyTargetResolution, { readonly ok: false }>['code'],
  reason = FAILURE_REASONS[code],
): Extract<RuntimePropertyTargetResolution, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function runtimePropertyAuthoringField(
  field: RuntimePropertyAuthoringField,
): typeof COURSE_RUNTIME_ENABLED_AUTHORING_FIELD
  | typeof COURSE_RUNTIME_RENDER_MODE_AUTHORING_FIELD {
  return field === 'enabled'
    ? COURSE_RUNTIME_ENABLED_AUTHORING_FIELD
    : COURSE_RUNTIME_RENDER_MODE_AUTHORING_FIELD
}

function sceneIdFromTarget(target: CourseAuthoringTarget): string | null {
  if (target.owner !== 'scene') return null
  const prefix = 'scene:'
  return target.ownerKey.startsWith(prefix)
    ? target.ownerKey.slice(prefix.length)
    : null
}

/** Retargets the trusted B1-09 source identity to one exact Runtime scalar. */
export function retargetCourseRuntimeProperty(
  sourceTarget: CourseAuthoringTarget,
  property: { readonly field: 'enabled'; readonly initialValue: boolean }
    | { readonly field: 'renderMode'; readonly initialValue: RuntimeRenderMode },
): CourseRuntimePropertyTarget {
  const sceneId = sceneIdFromTarget(sourceTarget)
  if (sourceTarget.owner === 'scene' && !sceneId) {
    throw new TypeError('Runtime 属性的 scene ownerKey 无效')
  }
  const courseTarget = Object.freeze({
    ...sourceTarget,
    authoringAddress: makeLayerItemAuthoringAddress({
      projectId: sourceTarget.projectId,
      owner: sourceTarget.owner,
      surfaceId: sourceTarget.surfaceId,
      sceneId,
      kind: 'runtime',
      layerItemId: sourceTarget.itemId,
      field: runtimePropertyAuthoringField(property.field),
    }),
  })
  return Object.freeze({ ...property, courseTarget }) as CourseRuntimePropertyTarget
}

function flowBlockIdExists(
  blocks: ReadonlyArray<Extract<
    CourseProjectDocument['surfaces'][number],
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

function expectedCourseTarget(
  view: AvailableRuntimeSourceAuthoringView,
  field: RuntimePropertyAuthoringField,
): CourseAuthoringTarget {
  return retargetCourseRuntimeProperty(
    view.target,
    field === 'enabled'
      ? { field, initialValue: view.runtime.enabled }
      : { field, initialValue: view.runtime.renderMode },
  ).courseTarget
}

function stableIdentityMatches(
  actual: CourseAuthoringTarget,
  expected: CourseAuthoringTarget,
): boolean {
  return actual.projectId === expected.projectId
    && actual.surfaceType === expected.surfaceType
    && actual.surfaceId === expected.surfaceId
    && actual.locationId === expected.locationId
    && actual.stateId === expected.stateId
    && actual.owner === expected.owner
    && actual.ownerKey === expected.ownerKey
    && actual.itemId === expected.itemId
    && actual.authoringAddress === expected.authoringAddress
}

function resolveRuntimePropertyTarget(
  project: CourseProjectDocument,
  target: CourseRuntimePropertyTarget,
): RuntimePropertyTargetResolution {
  const stable = target.courseTarget
  if (project.id !== stable.projectId) {
    return resolutionFailure('project-mismatch')
  }
  if (
    (target.field === 'enabled' && typeof target.initialValue !== 'boolean')
    || (
      target.field === 'renderMode'
      && !RENDER_MODES.has(target.initialValue as RuntimeRenderMode)
    )
    || (target.field !== 'enabled' && target.field !== 'renderMode')
  ) {
    return resolutionFailure('invalid-target')
  }

  const view = selectRuntimeSourceAuthoringView({
    project,
    locationId: stable.locationId,
    editingScope: stable.owner === 'global' ? 'global' : 'scene',
    activeStateId: stable.stateId,
    sessionToken: {
      locationId: stable.locationId,
      surfaceType: stable.surfaceType,
      revision: project.revision,
      generation: stable.sessionGeneration,
    },
  })
  if (view.availability !== 'available') {
    if (view.reason === 'runtime-missing') {
      return resolutionFailure(
        sameLayerItemIdExists(project, stable.itemId)
          ? 'wrong-carrier'
          : 'item-missing',
      )
    }
    return resolutionFailure(
      view.reason === 'invalid-state' ? 'invalid-target' : 'surface-or-location',
      view.label,
    )
  }

  if (view.target.itemId !== stable.itemId) {
    return resolutionFailure(
      sameLayerItemIdExists(project, stable.itemId)
        ? 'wrong-carrier'
        : 'item-missing',
    )
  }
  if (
    view.target.owner !== stable.owner
    || view.target.ownerKey !== stable.ownerKey
  ) {
    return resolutionFailure('wrong-carrier')
  }
  if (!stableIdentityMatches(stable, expectedCourseTarget(view, target.field))) {
    return resolutionFailure('invalid-target')
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      view,
      currentValue: target.field === 'enabled'
        ? view.runtime.enabled
        : view.runtime.renderMode,
    }),
  })
}

function updateIsValid(
  update: CourseRuntimePropertyUpdate,
  runtime: AvailableRuntimeSourceAuthoringView['runtime'],
): boolean {
  if (update.field === 'enabled') return typeof update.value === 'boolean'
  if (!RENDER_MODES.has(update.value as RuntimeRenderMode)) return false
  return runtime.runtimeApiVersion !== 3 || update.value === 'dom'
}

function selectionHint(
  target: CourseRuntimePropertyTarget,
  carrier: RuntimeSourceAuthoringCarrier,
): RuntimePropertyAuthoringSelectionHint {
  return deepFreeze({
    itemId: target.courseTarget.itemId,
    field: target.field,
    authoringAddress: target.courseTarget.authoringAddress,
    locationId: target.courseTarget.locationId,
    stateId: target.courseTarget.stateId,
    carrier,
  })
}

function feedback(
  kind: RuntimePropertyAuthoringFeedback['kind'],
  target: CourseRuntimePropertyTarget,
  update: CourseRuntimePropertyUpdate,
  resolved: ResolvedRuntimePropertyTarget,
): RuntimePropertyAuthoringFeedback {
  return deepFreeze({
    kind,
    itemId: resolved.view.target.itemId,
    field: target.field,
    previousValue: resolved.currentValue,
    value: update.value,
    carrier: resolved.view.carrier,
    protocol: resolved.view.runtime.protocol,
    runtimeApiVersion: resolved.view.runtime.runtimeApiVersion,
  })
}

function findMutableRuntime(
  project: CourseProjectDocument,
  target: CourseAuthoringTarget,
): RuntimeLayerItem | null {
  const surface = project.surfaces.find((candidate) => (
    candidate.id === target.surfaceId
  ))
  let item: RuntimeLayerItem | undefined
  if (target.owner === 'global') {
    const candidate = project.globalLayerItems.find((entry) => (
      entry.item.layerItemId === target.itemId
    ))?.item
    item = candidate?.kind === 'runtime' ? candidate : undefined
  } else if (target.owner === 'surface') {
    const candidate = surface?.surfaceLayerItems.find((entry) => (
      entry.item.layerItemId === target.itemId
    ))?.item
    item = candidate?.kind === 'runtime' ? candidate : undefined
  } else if (target.owner === 'scene' && surface?.type === 'slide') {
    const sceneId = sceneIdFromTarget(target)
    const candidate = surface.scenes.find((scene) => scene.id === sceneId)
      ?.layerItems.find((entry) => entry.layerItemId === target.itemId)
    item = candidate?.kind === 'runtime' ? candidate : undefined
  } else if (target.owner === 'world' && surface?.type === 'spatial-2d') {
    const candidate = surface.world.layerItems.find((entry) => (
      entry.layerItemId === target.itemId
    ))
    item = candidate?.kind === 'runtime' ? candidate : undefined
  }
  return item ?? null
}

/**
 * Plans one exact Runtime scalar edit. Runtime enabled remains independent of
 * LayerItem visibility, API/protocol/source/content/assets remain untouched,
 * and no resource mutation is produced.
 */
export function planRuntimePropertyUpdate(
  input: PlanRuntimePropertyUpdateInput,
): RuntimePropertyAuthoringPlanResult {
  const resolution = resolveRuntimePropertyTarget(input.project, input.target)
  const stable = input.target.courseTarget
  if (stable.surfaceType !== 'slide' && input.currentIdentity.stateId !== null) {
    return fail(
      'invalid-target',
      '非 Slide Runtime 当前身份不能携带 presentation state',
    )
  }
  // Runtime properties are shared across named states. State A -> B alone does
  // not stale the target; resolution still validates state A and its lock.
  const validation = validateCourseAuthoringTarget({
    target: { ...stable, stateId: null },
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
  if (resolution.value.view.effectiveLocked) return fail('target-locked')
  if (resolution.value.currentValue !== input.target.initialValue) {
    return fail('property-changed')
  }
  if (input.target.field !== input.update.field) {
    return fail('invalid-target', 'Runtime 属性目标与更新字段不匹配')
  }
  if (!updateIsValid(input.update, resolution.value.view.runtime)) {
    return fail(
      'invalid-value',
      resolution.value.view.runtime.runtimeApiVersion === 3
        && input.update.field === 'renderMode'
        ? 'Surface Runtime API 3 只支持 DOM 渲染模式'
        : FAILURE_REASONS['invalid-value'],
    )
  }
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(input.now).success) {
    return fail('invalid-clock')
  }

  const hint = selectionHint(input.target, resolution.value.view.carrier)
  if (resolution.value.currentValue === input.update.value) {
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
        'runtime-property-unchanged',
        input.target,
        input.update,
        resolution.value,
      ),
    })
  }

  const next = structuredClone(input.project)
  const item = findMutableRuntime(next, stable)
  if (!item) return fail('item-missing')
  if (input.update.field === 'enabled') {
    item.runtime.enabled = input.update.value
  } else {
    item.runtime.renderMode = input.update.value
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
  const plan: RuntimePropertyAuthoringTransactionPlan = deepFreeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: parsed.data,
    resourceChanges: {},
    selectionHint: hint,
    feedback: feedback(
      'runtime-property-updated',
      input.target,
      input.update,
      resolution.value,
    ),
  })
  return Object.freeze({
    ok: true as const,
    status: 'planned' as const,
    plan,
  })
}
