import { nanoid } from 'nanoid'
import { z } from 'zod'
import { interactionRuleContentSchema, interactionRuleSchema } from '../../../shared/interactionSchema'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { openSlideAuthoringSession } from '../../course/slideAuthoringBackend'
import { addSlideSceneInteractionRule, updateSlideSceneInteractionRule, deleteSlideSceneInteractionRule } from '../../course/v9SlideActionCommands'
import { AuthoringToolFailure, type AuthoringToolDefinition } from './executeAuthoringTool'
import { resolveAuthoringToolScope } from './authoringToolScope'
import {
  courseStateCompareOperatorSchema,
  courseStateKeySchema,
  courseStateScalarSchema,
} from '../../../shared/contracts/course-state/schema'
import {
  MAX_INTERACTION_ACTIONS,
  type InteractionActionPayload,
  type InteractionActionStep,
  type InteractionCondition,
  type InteractionRule,
  type InteractionTrigger,
} from '../../../shared/contracts/interaction-v1/types'
import {
  isPublishedInteractionActionStepSupported,
  isPublishedInteractionClickBindable,
  isPublishedInteractionConditionSupported,
  isPublishedInteractionTriggerSupported,
  publishedPresentationSetUnsupportedReason,
} from '../../../shared/publishedInteractionSupport'
import { composeCourseProjectLocation } from '../../../shared/courseLayerComposition'
import type { CourseProjectDocument, LayerItem, SlideSceneDocument } from '../../../shared/courseProjectTypes'
import { slideMotionTargetUnavailable } from '../../../shared/slideInteractionFeasibility'

/** Both destination branches share the canonical location identity. */
type TargetLocation = { locationId: string; stateId?: string | null }

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
  z.object({ kind: z.literal('set-course-state'), key: courseStateKeySchema, value: courseStateScalarSchema }).strict(),
])

const composeInputSchema = z.object({
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

function locationItems(document: CourseProjectDocument, target: TargetLocation): LayerItem[] {
  // 只纳入当前位置真实适用的条目：被 visibility 排除当前位置的另一位置专属
  // global/surface 图层不参与当前页重名判定，避免跨位置同名误判。
  return composeCourseProjectLocation({ project: document, locationId: target.locationId, stateId: null })
    .entries.filter((entry) => entry.applicable).map((entry) => entry.item)
}

function resolutionFailure(code: string, message: string, path: (string | number)[]): never {
  throw new AuthoringToolFailure([{ code, message, path }])
}

function resolveNode(document: CourseProjectDocument, target: TargetLocation, ref: string, what: string, path: (string | number)[]): LayerItem {
  const items = locationItems(document, target)
  const byId = items.filter((item) => item.layerItemId === ref)
  const matches = byId.length > 0 ? byId : items.filter((item) => item.label === ref)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) resolutionFailure('compose-node-ambiguous', `${what}“${ref}”匹配到多个同名图层，请改用图层 id`, path)
  return resolutionFailure('compose-node-not-found', `${what}“${ref}”在当前位置不存在；请先创建该图层或使用已有图层的 id / 唯一名称`, path)
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

export const slideInteractionTool: AuthoringToolDefinition<z.infer<typeof slideInteractionToolInputSchema>> = {
  name: 'slide.interaction', inputSchema: slideInteractionToolInputSchema,
  conditions: [
    { operations: ['compose', 'insert'], destination: 'create', parents: ['owner'], message: '互动创建使用 create parent:owner append；compose 只需触发与效果，宿主生成完整规则。' },
    { operations: ['replace', 'delete'], destination: 'update', message: 'replace/delete 需要前序互动回执的 update target；新建规则请用 compose 或 insert。' },
  ],
  description: '仅 Slide scene owner。常用“点击/输入提交/翻页 → 显示或隐藏解释、切换呈现状态（图形与文字随状态同步变化）、设置分数、进入下一步或下一场景”用 compose：触发与目标可给图层/状态/场景的 id 或唯一名称，效果按顺序给出，宿主生成一致引用、步骤 id、分组与收尾导航，并在边界明确拒绝 Published 不支持的组合。显隐语义：show/hide 是已挂载节点的入退场动画，不能解除 visible:false；初始动画隐藏使用 playbackInitialVisibility:hidden。若已有目标呈现状态负责显隐，只需 set-state，不要先 show 隐藏节点再切状态。导航语义：next-step 先走完当前页剩余呈现步骤再进入下一场景；next-scene 直接跳过剩余步骤进入下一场景（跨 Slide/Flow/Spatial 位置复用课程顺序）；go-to-scene 精确进入指定 Slide 场景。限制：presentation.enter/presentation.in 当前 Published 播放不执行，因此 compose 不提供 state-enter 触发与 inStates 条件；状态进入类需求用 click/presenter 触发 + 末尾 set-state 效果（当前 Slide 场景、无 transition、独占最后执行组）表达，状态条件用 course-state.compare/course-state.exists，场景限定用 scene.in。需要延迟、动画/媒体触发或完整条件组合时用 insert/replace（本卡完整 rule Schema，不含最外层 id；第一动作 start 必须 after-previous，导航动作必须最后）。',
  plan({ document, destination, value }) {
    const { target, surface, location } = resolveAuthoringToolScope(document, destination)
    if (surface.type !== 'slide' || location.kind !== 'slide-scene' || target.owner !== 'scene') throw new Error('Slide 互动工具需要 scene owner')
    const scene = surface.scenes.find((entry) => entry.id === location.sceneId)!
    const itemId = destination.kind === 'update' ? destination.target.itemId : `rule-${nanoid(10)}`
    const address = makeAuthoringAddress({ projectId: document.id, scope: 'scene', surfaceId: surface.id, sceneId: scene.id, carrier: 'native', layerItemId: itemId, field: 'interactions' })
    if (value.operation === 'insert' || value.operation === 'compose') {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'owner' || destination.scope.insertion.kind !== 'append') throw new Error('互动创建需要 scene owner 追加位置')
    } else if (destination.kind !== 'update' || destination.target.authoringAddress !== address || !scene.interactions.some((entry) => entry.id === itemId)) throw new Error('互动规则身份已失效')
    const opened = openSlideAuthoringSession(document, { locationId: target.locationId })
    const session = { ...opened, selection: { ...opened.selection, stateId: target.stateId } }
    const options = { expectedRevision: document.revision }
    const result = value.operation === 'insert' ? addSlideSceneInteractionRule(session, { ...value.rule, id: itemId }, options)
      : value.operation === 'compose' ? addSlideSceneInteractionRule(session, (() => {
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
      })(), options)
      : value.operation === 'replace' ? updateSlideSceneInteractionRule(session, itemId, value.rule, options)
      : deleteSlideSceneInteractionRule(session, itemId, options)
    if (!result.ok || !result.nextSession) throw new Error(result.reason)
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: result.nextSession.history.present, resourceChanges: {} },
      affected: [{ id: itemId, operation: value.operation === 'delete' ? 'deleted' : value.operation === 'replace' ? 'updated' : 'created', ownerKey: target.ownerKey, authoringAddress: address }],
    }
  },
}
