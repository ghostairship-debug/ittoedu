import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import { buildSlideEditorView } from '@/renderer/course/slideEditorView'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { courseStateScalarType } from '@/shared/contracts/course-state/types'
import type {
  CourseProjectDocument,
  LayerItem,
  SlidePresentationState,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '@/shared/courseProjectTypes'
import {
  interactionRuleSchema,
  sceneInteractionsSchema,
} from '@/shared/interactionSchema'
import {
  MAX_SCENE_INTERACTIONS,
  isNodeMotionAction,
  type InteractionRule,
} from '@/shared/interactionTypes'
import { z } from 'zod'
import {
  buildInteractionTemplateRule,
  type InteractionTemplateRequest,
} from './interactionTemplates'

export type InteractionAuthoringTarget =
  | {
      readonly carrier: 'slide-scene'
      readonly projectId: string
      readonly baseRevision: number
      readonly locationId: string
      /**
       * Live Slide presentation state from the editor session. When omitted,
       * the persisted location state remains the compatibility fallback.
       */
      readonly activeStateId?: string | null
    }
  | {
      readonly carrier: 'global'
      readonly projectId: string
      readonly baseRevision: number
      /** Active Slide location supplies presentation-state choices; Flow/Spatial supply none. */
      readonly activeLocationId?: string
      /**
       * Live state for the active Slide location. A non-null value is invalid
       * when the active location is not a real Slide scene.
       */
      readonly activeStateId?: string | null
    }

export interface InteractionAuthoringSelectionHint {
  readonly carrier: InteractionAuthoringTarget['carrier']
  readonly ruleId: string
  readonly locationId?: string
}

export interface InteractionAuthoringFeedback {
  readonly kind:
    | 'interaction-template-applied'
    | 'interaction-rule-updated'
    | 'interaction-rule-unchanged'
  readonly carrier: InteractionAuthoringTarget['carrier']
  readonly ruleId: string
  readonly targetLayerItemIds: readonly string[]
  readonly locationId?: string
}

export type InteractionAuthoringTransactionPlan = EditorTransactionPlan<
  InteractionAuthoringSelectionHint,
  InteractionAuthoringFeedback
>

export type InteractionAuthoringPlanFailureCode =
  | 'project-mismatch'
  | 'revision-conflict'
  | 'invalid-clock'
  | 'invalid-location'
  | 'no-local-interaction-carrier'
  | 'invalid-template'
  | 'invalid-layer-target'
  | 'locked-layer'
  | 'interaction-limit'
  | 'duplicate-rule'
  | 'rule-missing'
  | 'invalid-rule'
  | 'invalid-document'

export type InteractionAuthoringPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: InteractionAuthoringTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly feedback: InteractionAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: InteractionAuthoringPlanFailureCode
      readonly reason: string
    }

export interface PlanApplyInteractionTemplateInput {
  readonly project: CourseProjectDocument
  readonly target: InteractionAuthoringTarget
  readonly template: InteractionTemplateRequest
  readonly now: string
}

export interface PlanUpdateInteractionRuleInput {
  readonly project: CourseProjectDocument
  readonly target: InteractionAuthoringTarget
  readonly ruleId: string
  readonly patch: Partial<Omit<InteractionRule, 'id'>>
  readonly now: string
}

interface ResolvedCarrier {
  readonly carrier: InteractionAuthoringTarget['carrier']
  readonly rules: InteractionRule[]
  /** Template visibility writes are deliberately limited to this owner. */
  readonly templateLayerItems: LayerItem[]
  /** Carrier-aware node references; local items include the active state override. */
  readonly referenceLayerItems: LayerItem[]
  readonly activeScene: SlideSceneDocument | null
  readonly locationId?: string
  readonly stateId: string | null
  readonly presentationState: SlidePresentationState | null
}

type ResolveCarrierResult =
  | { readonly ok: true; readonly value: ResolvedCarrier }
  | Extract<InteractionAuthoringPlanResult, { readonly ok: false }>

const ISO_TIMESTAMP_SCHEMA = z.string().datetime()

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

function fail(
  code: InteractionAuthoringPlanFailureCode,
  reason: string,
): Extract<InteractionAuthoringPlanResult, { readonly ok: false }> {
  return Object.freeze({ ok: false as const, code, reason })
}

function validateIdentity(
  project: CourseProjectDocument,
  target: InteractionAuthoringTarget,
  now: string,
): Extract<InteractionAuthoringPlanResult, { readonly ok: false }> | null {
  if (!target.projectId.trim() || project.id !== target.projectId) {
    return fail('project-mismatch', '互动编辑目标不属于当前 Course Project。')
  }
  if (
    !Number.isInteger(target.baseRevision)
    || target.baseRevision < 0
    || project.revision !== target.baseRevision
  ) {
    return fail('revision-conflict', '互动编辑目标的 revision 已失效。')
  }
  if (!ISO_TIMESTAMP_SCHEMA.safeParse(now).success) {
    return fail('invalid-clock', '互动编辑时间必须是有效的 ISO 时间。')
  }
  return null
}

function resolveSlideScene(
  project: CourseProjectDocument,
  locationId: string,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'slide-scene' }>
  surface: SlideSurfaceDocument
  scene: SlideSceneDocument
} | null {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'slide-scene') return null
  const surface = project.surfaces.find(
    (candidate): candidate is SlideSurfaceDocument => (
      candidate.id === location.surfaceId && candidate.type === 'slide'
    ),
  )
  const scene = surface?.scenes.find((candidate) => candidate.id === location.sceneId)
  return surface && scene ? { location, surface, scene } : null
}

function resolveCarrier(
  project: CourseProjectDocument,
  target: InteractionAuthoringTarget,
): ResolveCarrierResult {
  if (target.carrier === 'global') {
    const activeSlide = target.activeLocationId
      ? resolveSlideScene(project, target.activeLocationId)
      : null
    if (target.activeStateId != null && !activeSlide) {
      return fail(
        'invalid-location',
        '当前活动位置不是可用的 Slide 场景，无法使用命名状态。',
      )
    }
    const stateId = activeSlide
      ? target.activeStateId === undefined
        ? activeSlide.location.stateId ?? null
        : target.activeStateId
      : null
    const presentationState = stateId === null
      ? null
      : activeSlide?.scene.presentation?.states.find((state) => state.id === stateId) ?? null
    if (stateId !== null && !presentationState) {
      return fail('invalid-location', '当前 Slide 命名状态已失效。')
    }
    const globalItems = project.globalLayerItems.map((entry) => entry.item)
    return {
      ok: true,
      value: {
        carrier: 'global',
        rules: project.globalInteractions,
        templateLayerItems: globalItems,
        referenceLayerItems: globalItems,
        activeScene: activeSlide?.scene ?? null,
        stateId,
        presentationState,
      },
    }
  }
  const location = project.locations.find((candidate) => candidate.id === target.locationId)
  if (!location) {
    return fail('invalid-location', '找不到互动编辑对应的课程位置。')
  }
  if (location.kind !== 'slide-scene') {
    return fail(
      'no-local-interaction-carrier',
      location.kind === 'flow-block'
        ? 'Flow 稿纸没有局部 InteractionRule carrier。'
        : 'Spatial 世界没有局部 InteractionRule carrier。',
    )
  }
  const resolved = resolveSlideScene(project, target.locationId)
  if (!resolved) {
    return fail('invalid-location', '当前 Slide 场景已失效。')
  }
  const stateId = target.activeStateId === undefined
    ? resolved.location.stateId ?? null
    : target.activeStateId
  const presentationState = stateId === null
    ? null
    : resolved.scene.presentation?.states.find((state) => state.id === stateId) ?? null
  if (stateId !== null && !presentationState) {
    return fail('invalid-location', '当前 Slide 命名状态已失效。')
  }
  const referenceLayerItems = buildSlideEditorView({
    project,
    locationId: target.locationId,
    stateId,
  }).layers
    .filter((layer) => layer.source === 'scene')
    .map((layer) => structuredClone(layer.item) as LayerItem)
  return {
    ok: true,
    value: {
      carrier: 'slide-scene',
      rules: resolved.scene.interactions,
      templateLayerItems: resolved.scene.layerItems,
      referenceLayerItems,
      activeScene: resolved.scene,
      locationId: target.locationId,
      stateId,
      presentationState,
    },
  }
}

function ruleLayerItemIds(rule: InteractionRule): readonly string[] {
  const ids: string[] = []
  if ('nodeId' in rule.trigger) ids.push(rule.trigger.nodeId)
  for (const step of rule.actions) {
    if ('nodeId' in step.action) ids.push(step.action.nodeId)
  }
  return ids
}

function slideScenes(project: CourseProjectDocument): Map<string, SlideSceneDocument> {
  const scenes = new Map<string, SlideSceneDocument>()
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    surface.scenes.forEach((scene) => scenes.set(scene.id, scene))
  }
  return scenes
}

function validateInteractionReferences(
  project: CourseProjectDocument,
  carrier: ResolvedCarrier,
  rules: readonly InteractionRule[],
  scopeRules: readonly InteractionRule[] = rules,
): Extract<InteractionAuthoringPlanResult, { readonly ok: false }> | null {
  const carrierItems = new Map(
    carrier.referenceLayerItems.map((item) => [item.layerItemId, item]),
  )
  const scenes = slideScenes(project)
  const soundIds = new Set(Object.keys(project.media.audio.sounds))
  const courseStateByKey = new Map(project.courseState.map((state) => [state.key, state]))
  const actionIds = new Set(scopeRules.flatMap((rule) => (
    rule.actions
      .filter((step) => isNodeMotionAction(step.action))
      .map((step) => step.id)
  )))
  const checkNode = (
    itemId: string,
  ): Extract<InteractionAuthoringPlanResult, { readonly ok: false }> | null => {
    const item = carrierItems.get(itemId)
    if (!item) {
      return fail(
        'invalid-rule',
        carrier.carrier === 'global'
          ? `全局互动规则只能引用全局层元素：${itemId}。`
          : `Slide 局部互动规则只能引用当前场景元素：${itemId}。`,
      )
    }
    if (item.locked) {
      return fail('locked-layer', `锁定元素“${item.label}”不能被互动规则修改。`)
    }
    return null
  }
  const checkCourseState = (
    reference: Readonly<{
      key: string
      value?: boolean | number | string | null
      operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
    }>,
  ): Extract<InteractionAuthoringPlanResult, { readonly ok: false }> | null => {
    const declaration = courseStateByKey.get(reference.key)
    if (!declaration) {
      return fail('invalid-rule', `互动规则引用了不存在的课程状态“${reference.key}”。`)
    }
    if (!Object.hasOwn(reference, 'value')) return null
    if (courseStateScalarType(reference.value!) !== declaration.valueType) {
      return fail('invalid-rule', `课程状态“${reference.key}”的值类型与声明不一致。`)
    }
    if (
      reference.operator !== undefined
      && reference.operator !== 'eq'
      && reference.operator !== 'neq'
      && declaration.valueType !== 'number'
    ) {
      return fail('invalid-rule', `课程状态“${reference.key}”只有数字类型可使用大小比较。`)
    }
    return null
  }
  for (const rule of rules) {
    const ruleStateScenes = (() => {
      if (carrier.carrier === 'slide-scene') {
        return carrier.activeScene ? [carrier.activeScene] : []
      }
      const scopedSceneIds = rule.conditions
        .filter((condition) => condition.type === 'scene.in')
        .flatMap((condition) => condition.sceneIds)
      if (scopedSceneIds.length > 0) {
        return [...new Set(scopedSceneIds)]
          .map((sceneId) => scenes.get(sceneId))
          .filter((scene): scene is SlideSceneDocument => Boolean(scene))
      }
      return [...scenes.values()]
    })()
    const checkRuleState = (
      stateId: string,
    ): Extract<InteractionAuthoringPlanResult, { readonly ok: false }> | null => {
      if (
        ruleStateScenes.length > 0
        && ruleStateScenes.some((scene) => (
          scene.presentation?.states.some((state) => state.id === stateId)
        ))
      ) {
        return null
      }
      return fail(
        'invalid-rule',
        `互动规则的 Slide 场景上下文中不存在状态“${stateId}”。`,
      )
    }
    if ('nodeId' in rule.trigger) {
      const invalidNode = checkNode(rule.trigger.nodeId)
      if (invalidNode) return invalidNode
    }
    if (rule.trigger.type === 'audio.ended' && !soundIds.has(rule.trigger.soundId)) {
      return fail('invalid-rule', `互动规则引用了不存在的声音“${rule.trigger.soundId}”。`)
    }
    if (rule.trigger.type === 'presentation.enter') {
      const invalidState = checkRuleState(rule.trigger.stateId)
      if (invalidState) return invalidState
    }
    if (
      rule.trigger.type === 'animation.completed'
      && !actionIds.has(rule.trigger.actionId)
    ) {
      return fail(
        'invalid-rule',
        `互动规则引用了不存在的动画动作“${rule.trigger.actionId}”。`,
      )
    }
    for (const condition of rule.conditions) {
      if (condition.type === 'scene.in') {
        const missingScene = condition.sceneIds.find((sceneId) => !scenes.has(sceneId))
        if (missingScene) {
          return fail('invalid-rule', `互动规则引用了不存在的 Slide 场景“${missingScene}”。`)
        }
      } else if (condition.type === 'presentation.in') {
        for (const stateId of condition.stateIds) {
          const invalidState = checkRuleState(stateId)
          if (invalidState) return invalidState
        }
      } else {
        const invalidCourseState = checkCourseState(condition)
        if (invalidCourseState) return invalidCourseState
      }
    }
    for (const step of rule.actions) {
      const action = step.action
      if ('nodeId' in action) {
        const invalidNode = checkNode(action.nodeId)
        if (invalidNode) return invalidNode
      }
      if (action.type === 'audio.play' && !soundIds.has(action.soundId)) {
        return fail('invalid-rule', `互动规则引用了不存在的声音“${action.soundId}”。`)
      }
      if (
        (
          action.type === 'audio.pause'
          || action.type === 'audio.resume'
          || action.type === 'audio.stop'
          || action.type === 'audio.toggle-mute'
        )
        && action.target.kind === 'sound'
        && !soundIds.has(action.target.soundId)
      ) {
        return fail('invalid-rule', `互动规则引用了不存在的声音“${action.target.soundId}”。`)
      }
      if (action.type === 'presentation.set') {
        const invalidState = checkRuleState(action.stateId)
        if (invalidState) return invalidState
      }
      if (action.type === 'course-state.set') {
        const invalidCourseState = checkCourseState(action)
        if (invalidCourseState) return invalidCourseState
      }
      if (action.type === 'scene.go') {
        const targetScene = scenes.get(action.sceneId)
        if (!targetScene) {
          return fail('invalid-rule', `互动规则引用了不存在的 Slide 场景“${action.sceneId}”。`)
        }
        if (
          action.targetStateId
          && !targetScene.presentation?.states.some(
            (state) => state.id === action.targetStateId,
          )
        ) {
          return fail(
            'invalid-rule',
            `目标 Slide 场景中不存在状态“${action.targetStateId}”。`,
          )
        }
      }
    }
  }
  return null
}

function newlyDanglingAnimationReference(
  before: readonly InteractionRule[],
  after: readonly InteractionRule[],
): Extract<InteractionAuthoringPlanResult, { readonly ok: false }> | null {
  const beforeActionIds = new Set(before.flatMap((rule) => (
    rule.actions
      .filter((step) => isNodeMotionAction(step.action))
      .map((step) => step.id)
  )))
  const afterActionIds = new Set(after.flatMap((rule) => (
    rule.actions
      .filter((step) => isNodeMotionAction(step.action))
      .map((step) => step.id)
  )))
  const newlyDangling = after.find((rule) => (
    rule.trigger.type === 'animation.completed'
    && beforeActionIds.has(rule.trigger.actionId)
    && !afterActionIds.has(rule.trigger.actionId)
  ))
  if (!newlyDangling || newlyDangling.trigger.type !== 'animation.completed') return null
  return fail(
    'invalid-rule',
    `修改会使动画动作“${newlyDangling.trigger.actionId}”的完成规则失去目标。`,
  )
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
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
  const leftKeys = Object.keys(leftRecord)
  return leftKeys.length === Object.keys(rightRecord).length
    && leftKeys.every((key) => (
      Object.hasOwn(rightRecord, key)
      && valuesEqual(leftRecord[key], rightRecord[key])
    ))
}

function feedback(
  kind: InteractionAuthoringFeedback['kind'],
  target: InteractionAuthoringTarget,
  ruleId: string,
  targetLayerItemIds: readonly string[],
): InteractionAuthoringFeedback {
  return Object.freeze({
    kind,
    carrier: target.carrier,
    ruleId,
    targetLayerItemIds: Object.freeze([...targetLayerItemIds]),
    ...(target.carrier === 'slide-scene' ? { locationId: target.locationId } : {}),
  })
}

function selectionHint(
  target: InteractionAuthoringTarget,
  ruleId: string,
): InteractionAuthoringSelectionHint {
  return Object.freeze({
    carrier: target.carrier,
    ruleId,
    ...(target.carrier === 'slide-scene' ? { locationId: target.locationId } : {}),
  })
}

function planned(
  target: InteractionAuthoringTarget,
  nextDraft: CourseProjectDocument,
  now: string,
  planFeedback: InteractionAuthoringFeedback,
): InteractionAuthoringPlanResult {
  nextDraft.revision = target.baseRevision + 1
  nextDraft.updatedAt = now
  const parsed = courseProjectDocumentSchema.safeParse(nextDraft)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(
      'invalid-document',
      `互动修改后的 Course Project V9 无效：${issue?.path.join('.') || 'project'} ${issue?.message ?? '字段无效'}。`,
    )
  }
  const plan: InteractionAuthoringTransactionPlan = Object.freeze({
    projectId: target.projectId,
    baseRevision: target.baseRevision,
    // Validation must not normalize or rebuild unrelated project records.
    nextDocument: deepFreeze(nextDraft),
    resourceChanges: Object.freeze({}),
    selectionHint: selectionHint(target, planFeedback.ruleId),
    feedback: planFeedback,
  })
  return Object.freeze({ ok: true as const, status: 'planned' as const, plan })
}

function setTemplatePlaybackInitialVisibility(
  carrier: ResolvedCarrier,
  layerItemId: string,
): void {
  const base = carrier.templateLayerItems.find(
    (item) => item.layerItemId === layerItemId,
  )
  if (!base) return
  if (
    carrier.carrier !== 'slide-scene'
    || carrier.stateId === null
    || !carrier.presentationState
  ) {
    base.playbackInitialVisibility = 'hidden'
    return
  }
  const overrides = carrier.presentationState.layerItemOverrides
  const override = overrides[layerItemId] ?? {}
  if (base.playbackInitialVisibility === 'hidden') {
    delete override.playbackInitialVisibility
  } else {
    override.playbackInitialVisibility = 'hidden'
  }
  if (Object.keys(override).length === 0) delete overrides[layerItemId]
  else overrides[layerItemId] = override
}

/**
 * Plans one atomic template application: initial hidden state and the standard
 * InteractionRule land in the same document revision with no resource delta.
 */
export function planApplyInteractionTemplate(
  input: PlanApplyInteractionTemplateInput,
): InteractionAuthoringPlanResult {
  const invalidIdentity = validateIdentity(input.project, input.target, input.now)
  if (invalidIdentity) return invalidIdentity
  const resolved = resolveCarrier(input.project, input.target)
  if (!resolved.ok) return resolved
  if (resolved.value.rules.length >= MAX_SCENE_INTERACTIONS) {
    return fail(
      'interaction-limit',
      `当前作用域最多可以保存 ${MAX_SCENE_INTERACTIONS} 条互动规则。`,
    )
  }

  let rule: InteractionRule
  try {
    rule = buildInteractionTemplateRule(input.template)
  } catch (error) {
    return fail(
      error instanceof z.ZodError ? 'invalid-rule' : 'invalid-template',
      error instanceof Error ? error.message : '互动模板无效。',
    )
  }
  if (resolved.value.rules.some((candidate) => candidate.id === rule.id)) {
    return fail('duplicate-rule', `当前作用域已存在规则 ID“${rule.id}”。`)
  }

  const ownedItems = new Map(
    resolved.value.referenceLayerItems.map((item) => [item.layerItemId, item]),
  )
  for (const itemId of input.template.targetLayerItemIds) {
    const item = ownedItems.get(itemId)
    if (!item || !item.visible) {
      return fail(
        'invalid-layer-target',
        `元素“${itemId}”不属于当前互动模板的可写 carrier。`,
      )
    }
    if (item.locked) {
      return fail('locked-layer', `锁定元素“${item.label}”不能用于互动模板。`)
    }
  }
  const prospectiveRules = [...resolved.value.rules, rule]
  const parsedProspectiveRules = sceneInteractionsSchema.safeParse(prospectiveRules)
  if (!parsedProspectiveRules.success) {
    return fail(
      'invalid-rule',
      parsedProspectiveRules.error.issues[0]?.message ?? '互动规则无效。',
    )
  }
  const targetFailure = validateInteractionReferences(
    input.project,
    resolved.value,
    [rule],
    prospectiveRules,
  )
  if (targetFailure) return targetFailure

  const nextDraft = structuredClone(input.project)
  const nextCarrier = resolveCarrier(nextDraft, input.target)
  if (!nextCarrier.ok) return nextCarrier
  for (const itemId of input.template.targetLayerItemIds) {
    setTemplatePlaybackInitialVisibility(nextCarrier.value, itemId)
  }
  nextCarrier.value.rules.push(structuredClone(rule))
  const parsedRules = sceneInteractionsSchema.safeParse(nextCarrier.value.rules)
  if (!parsedRules.success) {
    return fail('invalid-rule', parsedRules.error.issues[0]?.message ?? '互动规则无效。')
  }
  return planned(
    input.target,
    nextDraft,
    input.now,
    feedback(
      'interaction-template-applied',
      input.target,
      rule.id,
      input.template.targetLayerItemIds,
    ),
  )
}

/** Applies a professional top-level patch while preserving the stable rule ID. */
export function planUpdateInteractionRule(
  input: PlanUpdateInteractionRuleInput,
): InteractionAuthoringPlanResult {
  const invalidIdentity = validateIdentity(input.project, input.target, input.now)
  if (invalidIdentity) return invalidIdentity
  const resolved = resolveCarrier(input.project, input.target)
  if (!resolved.ok) return resolved
  const current = resolved.value.rules.find((rule) => rule.id === input.ruleId)
  if (!current) {
    return fail('rule-missing', `找不到互动规则“${input.ruleId}”。`)
  }

  const parsedRule = interactionRuleSchema.safeParse({
    ...structuredClone(current),
    ...structuredClone(input.patch),
    id: input.ruleId,
  })
  if (!parsedRule.success) {
    return fail('invalid-rule', parsedRule.error.issues[0]?.message ?? '互动规则无效。')
  }
  if (valuesEqual(current, parsedRule.data)) {
    const unchanged = feedback(
      'interaction-rule-unchanged',
      input.target,
      current.id,
      ruleLayerItemIds(current),
    )
    return Object.freeze({
      ok: true as const,
      status: 'no-op' as const,
      plan: null,
      feedback: unchanged,
    })
  }

  const prospectiveRules = resolved.value.rules.map((rule) => (
    rule.id === input.ruleId ? parsedRule.data : rule
  ))
  const parsedProspectiveRules = sceneInteractionsSchema.safeParse(prospectiveRules)
  if (!parsedProspectiveRules.success) {
    return fail(
      'invalid-rule',
      parsedProspectiveRules.error.issues[0]?.message ?? '互动规则无效。',
    )
  }
  const targetFailure = validateInteractionReferences(
    input.project,
    resolved.value,
    [parsedRule.data],
    prospectiveRules,
  )
  if (targetFailure) return targetFailure
  const danglingFailure = newlyDanglingAnimationReference(
    resolved.value.rules,
    prospectiveRules,
  )
  if (danglingFailure) return danglingFailure

  const nextDraft = structuredClone(input.project)
  const nextCarrier = resolveCarrier(nextDraft, input.target)
  if (!nextCarrier.ok) return nextCarrier
  const index = nextCarrier.value.rules.findIndex((rule) => rule.id === input.ruleId)
  if (index < 0) return fail('rule-missing', `找不到互动规则“${input.ruleId}”。`)
  nextCarrier.value.rules[index] = structuredClone(parsedRule.data)
  const parsedRules = sceneInteractionsSchema.safeParse(nextCarrier.value.rules)
  if (!parsedRules.success) {
    return fail('invalid-rule', parsedRules.error.issues[0]?.message ?? '互动规则无效。')
  }
  return planned(
    input.target,
    nextDraft,
    input.now,
    feedback(
      'interaction-rule-updated',
      input.target,
      parsedRule.data.id,
      ruleLayerItemIds(parsedRule.data),
    ),
  )
}
