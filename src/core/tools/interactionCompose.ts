import { z } from 'zod'
import { interactionRuleContentSchema, interactionRuleSchema } from '../../shared/interactionSchema'
import {
  courseStateCompareOperatorSchema,
  courseStateKeySchema,
  courseStateScalarSchema,
} from '../../shared/contracts/course-state/schema'
import {
  MAX_INTERACTION_ACTIONS,
  type InteractionActionPayload,
  type InteractionActionStep,
  type InteractionCondition,
  type InteractionRule,
  type InteractionTrigger,
} from '../../shared/contracts/interaction-v1/types'
import {
  isPublishedInteractionActionStepSupported,
  isPublishedInteractionClickBindable,
  isPublishedInteractionConditionSupported,
  isPublishedInteractionTriggerSupported,
  publishedPresentationSetUnsupportedReason,
} from '../../shared/publishedInteractionSupport'
import { composeCourseProjectLocation } from '../../shared/courseLayerComposition'
import type { CourseProjectDocument, LayerItem, SlideSceneDocument } from '../../shared/courseProjectTypes'
import { slideMotionTargetUnavailable } from '../../shared/slideInteractionFeasibility'
import { resolveSlideInteractionTarget } from '../../shared/slideInteractionTargetResolver'

import { AuthoringToolFailure } from './AuthoringToolFailure'
/** Both destination branches share the canonical location identity. */
export type TargetLocation = { locationId: string; surfaceId: string; stateId?: string | null }

const rule = interactionRuleContentSchema

/** compose references accept a stable id or one unique teacher-visible name/label. */
const reference = z.string().trim().min(1).max(200)

const composeTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), node: reference }).strict(),
  z.object({ kind: z.literal('input-submit'), node: reference }).strict(),
  z.object({ kind: z.literal('scene-enter') }).strict(),
  z.object({ kind: z.literal('presenter'), command: z.enum(['next', 'previous']) }).strict(),
])

const composeConditionSchema = z.object({
  courseState: z.union([
    z.object({ key: courseStateKeySchema, exists: z.boolean() }).strict(),
    z.object({ key: courseStateKeySchema, operator: courseStateCompareOperatorSchema, value: courseStateScalarSchema }).strict(),
  ]).optional(),
}).strict()

const motionFields = {
  effect: z.enum(['none', 'fade', 'scale']).optional(),
  durationMs: z.number().finite().min(0).max(60_000).optional(),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional(),
} as const

const composeEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set-state'), state: reference }).strict(),
  z.object({ kind: z.literal('show'), nodes: z.array(reference).min(1).max(32), ...motionFields }).strict(),
  z.object({ kind: z.literal('hide'), nodes: z.array(reference).min(1).max(32), ...motionFields }).strict(),
  z.object({ kind: z.literal('next-step') }).strict(),
  z.object({ kind: z.literal('previous-step') }).strict(),
  z.object({ kind: z.literal('next-scene') }).strict(),
  z.object({ kind: z.literal('previous-scene') }).strict(),
  z.object({ kind: z.literal('go-to-scene'), scene: reference, state: reference.optional() }).strict(),
  z.object({ kind: z.literal('go-to-location'), location: reference }).strict(),
  z.object({ kind: z.literal('set-course-state'), key: courseStateKeySchema, value: courseStateScalarSchema }).strict(),
])

export const composeInputSchema = z.object({
  operation: z.literal('compose'),
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  trigger: composeTriggerSchema,
  when: composeConditionSchema.optional(),
  effects: z.array(composeEffectSchema).min(1).max(MAX_INTERACTION_ACTIONS),
}).strict()

export const slideInteractionToolInputSchema = z.discriminatedUnion('operation', [
  composeInputSchema,
  z.object({ operation: z.literal('insert'), rule }).strict(),
  z.object({ operation: z.literal('replace'), rule }).strict(),
  z.object({ operation: z.literal('delete') }).strict(),
])

type ComposeInput = z.infer<typeof composeInputSchema>

function locationItems(document: CourseProjectDocument, target: TargetLocation) {
  // 只纳入当前位置真实适用的条目：被 visibility 排除当前位置的另一位置专属
  // global/surface 图层不参与当前页重名判定，避免跨位置同名误判。
  const composition = composeCourseProjectLocation({ project: document, locationId: target.locationId, stateId: null })
  return { composition, items: composition.entries.filter((entry) => entry.applicable).map((entry) => entry.item) }
}

function resolutionFailure(code: string, message: string, path: (string | number)[]): never {
  throw new AuthoringToolFailure([{ code, message, path }])
}

function resolveNode(document: CourseProjectDocument, target: TargetLocation, ref: string, what: string, path: (string | number)[]): LayerItem {
  const { composition, items } = locationItems(document, target)
  const resolution = resolveSlideInteractionTarget({
    index: { locationId: target.locationId, surfaceId: composition.surfaceId, stateId: null,
      scope: 'applicable-location-items', completeness: 'complete', items: items.map(item => ({ id: item.layerItemId, label: item.label })) },
    reference: ref, what, path,
  })
  if (resolution.status === 'error') return resolutionFailure(resolution.code, resolution.message, resolution.path)
  if (resolution.status === 'deferred') return resolutionFailure('compose-node-not-found', resolution.message, path)
  const item = items.find(candidate => candidate.layerItemId === resolution.itemId)
  if (!item) return resolutionFailure('compose-node-not-found', `${what}“${ref}”在当前位置不存在；请先创建该图层或使用已有图层的 id / 唯一名称`, path)
  return item
}

function resolveState(scene: SlideSceneDocument, ref: string, what: string, path: (string | number)[]): string {
  const states = scene.presentation?.states ?? []
  if (states.some((state) => state.id === ref)) return ref
  const byName = states.filter((state) => state.name === ref)
  if (byName.length === 1) return byName[0]!.id
  if (byName.length > 1) resolutionFailure('compose-state-ambiguous', `${what}“${ref}”匹配到多个同名呈现状态，请改用状态 id`, path)
  return resolutionFailure('compose-state-not-found', `${what}“${ref}”在当前场景不存在；可用状态：${states.map((state) => state.name).join('、') || '无'}`, path)
}

function resolveSlideScene(document: CourseProjectDocument, ref: string): SlideSceneDocument {
  const scenes = document.surfaces.flatMap((surface) => surface.type === 'slide' ? surface.scenes : [])
  const byId = scenes.filter((scene) => scene.id === ref)
  const matches = byId.length > 0 ? byId : scenes.filter((scene) => scene.name === ref)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) throw new Error(`目标场景“${ref}”匹配到多个同名 Slide 场景，请改用场景 id`)
  throw new Error(`目标场景“${ref}”不存在；顺序进入下一场景请使用 next-scene，精确目标只接受已有 Slide 场景`)
}

function resolveCourseLocation(
  document: CourseProjectDocument,
  ref: string,
): CourseProjectDocument['locations'][number] {
  const byId = document.locations.filter((location) => location.id === ref)
  const matches = byId.length > 0
    ? byId
    : document.locations.filter((location) => location.label === ref)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) {
    throw new Error(`目标课程位置“${ref}”匹配到多个同名位置，请改用位置 id`)
  }
  throw new Error(`目标课程位置“${ref}”不存在；精确跨 Surface 跳转只接受已有课程位置的 id 或唯一名称`)
}

function composeTrigger(document: CourseProjectDocument, target: TargetLocation, scene: SlideSceneDocument, input: ComposeInput['trigger']): InteractionTrigger {
  switch (input.kind) {
    case 'click': {
      const item = resolveNode(document, target, input.node, '点击目标', ['input', 'trigger', 'node'])
      if (!isPublishedInteractionClickBindable(item)) {
        throw new Error(`点击目标“${input.node}”必须是自动命中的 Native 文字/图片/公式/图形；当前图层不可绑定点击`)
      }
      return { type: 'node.click', nodeId: item.layerItemId }
    }
    case 'input-submit': {
      const item = resolveNode(document, target, input.node, '提交目标', ['input', 'trigger', 'node'])
      if (item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error(`提交目标“${input.node}”必须是 Native 输入框`)
      return { type: 'input.submit', nodeId: item.layerItemId }
    }
    case 'scene-enter': return { type: 'scene.enter' }
    case 'presenter': return { type: 'presenter.command', command: input.command }
  }
}

function composeConditions(document: CourseProjectDocument, scene: SlideSceneDocument, when: ComposeInput['when']): InteractionCondition[] {
  if (!when) return []
  const conditions: InteractionCondition[] = []
  if (when.courseState) {
    if (!document.courseState.some((declaration) => declaration.key === when.courseState!.key)) {
      throw new Error(`课程状态“${when.courseState.key}”尚未声明；请先用 course.settings 声明后再引用`)
    }
    conditions.push('exists' in when.courseState
      ? { type: 'course-state.exists', key: when.courseState.key, exists: when.courseState.exists }
      : { type: 'course-state.compare', key: when.courseState.key, operator: when.courseState.operator, value: when.courseState.value })
  }
  return conditions
}

/** The product owns step ids, grouping and terminal placement; the model owns
 * content, visual states and trigger conditions. */
function composeActions(document: CourseProjectDocument, target: TargetLocation, scene: SlideSceneDocument, ruleId: string, effects: ComposeInput['effects'], conditional = false): InteractionActionStep[] {
  const actions: InteractionActionStep[] = []
  const push = (action: InteractionActionPayload, start: InteractionActionStep['start']) => {
    actions.push({ id: `${ruleId}-a${actions.length + 1}`, start, delayMs: 0, action })
  }
  effects.forEach((effect, index) => {
    const navigation = (action: InteractionActionPayload): void => {
      if (index !== effects.length - 1) throw new Error('导航效果必须是最后一个效果；导航之后的其他效果请拆到另一条规则')
      push(action, 'after-previous')
    }
    switch (effect.kind) {
      case 'show':
      case 'hide': {
        const type = effect.kind === 'show' ? 'node.enter' as const : 'node.exit' as const
        for (const [nodeIndex, ref] of effect.nodes.entries()) {
          const item = resolveNode(document, target, ref, '显隐目标', ['input', 'effects', index, 'nodes', nodeIndex])
          // Conditional rules may become reachable in a later state. Do not infer
          // their runtime state from an authoring focus; actual checks report coverage.
          const unavailable = !conditional && slideMotionTargetUnavailable(document, target.locationId,
            target.stateId ?? scene.presentation?.initialStateId ?? null, item.layerItemId)
          if (unavailable) resolutionFailure('compose-motion-target-unmounted', unavailable, ['input', 'effects', index, 'nodes', nodeIndex])
          push({ type, nodeId: item.layerItemId, durationMs: effect.durationMs ?? 240, easing: effect.easing ?? 'ease-out', effect: effect.effect ?? 'fade' },
            actions.length === 0 ? 'after-previous' : 'with-previous')
        }
        break
      }
      case 'set-course-state': {
        if (!document.courseState.some((declaration) => declaration.key === effect.key)) {
          throw new Error(`课程状态“${effect.key}”尚未声明；请先用 course.settings 声明后再引用`)
        }
        push({ type: 'course-state.set', key: effect.key, value: effect.value }, actions.length === 0 ? 'after-previous' : 'with-previous')
        break
      }
      case 'set-state':
        push({ type: 'presentation.set', stateId: resolveState(scene, effect.state, '目标呈现状态', ['input', 'effects', index, 'state']) }, 'after-previous')
        break
      case 'next-step': navigation({ type: 'step.next' }); break
      case 'previous-step': navigation({ type: 'step.previous' }); break
      case 'next-scene': navigation({ type: 'scene.next' }); break
      case 'previous-scene': navigation({ type: 'scene.previous' }); break
      case 'go-to-scene': {
        const destination = resolveSlideScene(document, effect.scene)
        const targetStateId = effect.state === undefined ? undefined : resolveState(destination, effect.state, '目标场景状态', ['input', 'effects', index, 'state'])
        navigation({ type: 'scene.go', sceneId: destination.id, ...(targetStateId ? { targetStateId } : {}) })
        break
      }
      case 'go-to-location': {
        const destination = resolveCourseLocation(document, effect.location)
        navigation({ type: 'location.go', locationId: destination.id })
        break
      }
    }
  })
  return actions
}

/** Capability, health and playback share this exact support judgment; compose
 * refuses unsupported combinations at the authoring boundary instead of
 * silently dropping actions. */
function assertComposedRulePlayable(rule: InteractionRule): void {
  const parsed = interactionRuleSchema.safeParse(rule)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '组合规则结构无效')
  if (!isPublishedInteractionTriggerSupported(rule.trigger.type)) throw new Error(`触发器“${rule.trigger.type}”当前 Published 播放不支持`)
  for (const condition of rule.conditions) {
    if (!isPublishedInteractionConditionSupported(condition.type)) throw new Error(`条件“${condition.type}”当前 Published 播放不支持`)
  }
  rule.actions.forEach((step, index) => {
    if (!isPublishedInteractionActionStepSupported(rule, index, 'scene')) {
      throw new Error(publishedPresentationSetUnsupportedReason(rule, index, 'scene')
        ?? `动作“${step.action.type}”当前 Published 播放不支持；请改用 compose 提供的效果种类或拆成多条规则`)
    }
  })
}

export function composeSlideInteraction(document: CourseProjectDocument, target: TargetLocation, scene: SlideSceneDocument, itemId: string, raw: ComposeInput): InteractionRule {
  const value = composeInputSchema.parse(raw)
  const composed: InteractionRule = {
    id: itemId,
    ...(value.name ? { name: value.name } : {}),
    enabled: value.enabled ?? true,
    trigger: composeTrigger(document, target, scene, value.trigger),
    conditions: composeConditions(document, scene, value.when),
    actions: composeActions(document, target, scene, itemId, value.effects, Boolean(value.when)),
  }
  assertComposedRulePlayable(composed)
  return composed
}

/** Partial edits retain every omitted field, including professional conditions/actions. */
export const updateComposedInteractionSchema = composeInputSchema.omit({ operation: true }).partial()
export function updateComposedInteraction(document: CourseProjectDocument, target: TargetLocation, scene: SlideSceneDocument, current: InteractionRule, raw: z.infer<typeof updateComposedInteractionSchema>): InteractionRule {
  const value = updateComposedInteractionSchema.parse(raw)
  const conditions = value.when === undefined ? current.conditions : composeConditions(document, scene, value.when)
  const rule: InteractionRule = {
    ...current,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
    trigger: value.trigger === undefined ? current.trigger : composeTrigger(document, target, scene, value.trigger),
    conditions,
    actions: value.effects === undefined ? current.actions : composeActions(document, target, scene, current.id, value.effects, conditions.length > 0),
  }
  assertComposedRulePlayable(rule)
  return rule
}
