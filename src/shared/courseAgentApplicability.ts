import {
  INTERACTION_ACTION_TYPES,
  INTERACTION_CONDITION_TYPES,
  INTERACTION_TRIGGER_TYPES,
} from './contracts/interaction-v1/types'
import {
  PUBLISHED_INTERACTION_PLAYBACK_SUPPORT,
  isPublishedInteractionActionSupported,
  isPublishedInteractionConditionSupported,
  isPublishedInteractionTriggerSupported,
} from './publishedInteractionSupport'

/**
 * First-route applicability facts for generation tasks. Everything here is
 * projected from the same sources that preflight and execution already use
 * (interaction-v1 contract + Published playback support table); this module
 * adds no second capability registry and no new authorization.
 */

export type CourseAgentApplicabilityStatus = 'available' | 'unsupported' | 'needs-info'

export interface CourseAgentApplicabilityExclusionGroup {
  kind: 'interaction-trigger' | 'interaction-condition' | 'interaction-action'
  types: string[]
  reason: string
  alternatives: string[]
}

/** Verified alternatives for branches the Published host cannot play back. */
const EXCLUSION_ADVICE: Record<string, { reason: string; alternatives: string[] }> = {
  'presentation.enter': {
    reason: 'Published 播放不支持 presentation.enter 触发；写入工程也不会在播放时执行',
    alternatives: [
      '用 node.click / presenter.command 触发，并以 presentation.set（当前 Slide 场景、无 transition、独占最后执行组）进入目标呈现状态',
      '状态驱动的连续机制使用 component / runtime 正式载体',
    ],
  },
  'presentation.in': {
    reason: 'Published 播放不支持 presentation.in 条件；写入工程也不会在播放时执行',
    alternatives: [
      '用 course-state.compare / course-state.exists 表达状态条件',
      '用 scene.in 限定规则只在指定 Slide 场景生效',
    ],
  },
  'component.event': {
    reason: 'Published 声明式规则不支持 component.event 触发',
    alternatives: ['组件内部事件由组件自身处理；跨对象联动使用 node.click 等已支持触发器'],
  },
  'runtime.event': {
    reason: 'Published 声明式规则不支持 runtime.event 触发',
    alternatives: ['Runtime 内部事件由载体自身处理；跨对象联动使用 node.click 等已支持触发器'],
  },
  action: {
    reason: 'Published 播放不支持该动作；写入工程也不会在播放时执行',
    alternatives: ['读取完整能力卡核对可行的声明式组合；无法表达时使用 component / runtime 正式载体'],
  },
  lifecycle: {
    reason: 'Published 播放不支持该触发器；写入工程也不会在播放时执行',
    alternatives: ['使用 node.click / presenter.command 触发'],
  },
}

function adviceFor(kind: CourseAgentApplicabilityExclusionGroup['kind'], type: string) {
  const direct = EXCLUSION_ADVICE[type]
  if (direct) return direct
  if (kind === 'interaction-action') return EXCLUSION_ADVICE.action
  return EXCLUSION_ADVICE.lifecycle
}

function groupExclusions(
  kind: CourseAgentApplicabilityExclusionGroup['kind'],
  types: readonly string[],
): CourseAgentApplicabilityExclusionGroup[] {
  const groups = new Map<string, CourseAgentApplicabilityExclusionGroup>()
  for (const type of types) {
    const advice = adviceFor(kind, type)
    const key = `${advice.reason}${advice.alternatives.join('')}`
    const group = groups.get(key)
    if (group) group.types.push(type)
    else groups.set(key, { kind, types: [type], reason: advice.reason, alternatives: [...advice.alternatives] })
  }
  return [...groups.values()]
}

/**
 * Interaction branches the V1 contract can represent but the Published host
 * will not execute. Derived from the same support table used by authoring
 * boundary checks, health diagnostics and the player itself, so first-route
 * guidance, preflight and execution can never disagree.
 */
export function publishedInteractionPlaybackExclusions(): CourseAgentApplicabilityExclusionGroup[] {
  return [
    ...groupExclusions('interaction-trigger',
      INTERACTION_TRIGGER_TYPES.filter((type) => !isPublishedInteractionTriggerSupported(type))),
    ...groupExclusions('interaction-condition',
      INTERACTION_CONDITION_TYPES.filter((type) => !isPublishedInteractionConditionSupported(type))),
    ...groupExclusions('interaction-action',
      INTERACTION_ACTION_TYPES.filter((type) => !isPublishedInteractionActionSupported(type))),
  ]
}

/** Compact first-turn applicability projection carried by the generation context. */
export function generationApplicabilityProjection() {
  return {
    version: 1 as const,
    interactionPlayback: {
      status: PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.status,
      supportedTriggers: PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.triggerTypes,
      supportedConditions: PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.conditionTypes,
      supportedActions: PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.actionTypes,
      presentationSet: PUBLISHED_INTERACTION_PLAYBACK_SUPPORT.conditionalActions['presentation.set'],
      excluded: publishedInteractionPlaybackExclusions(),
    },
    routing:
      '首次选路：已有对象的公开字段能完整表达时走参数/内容修改；单字段不足但正式操作、已有组件及其组合能完成时走接口组合；声明式内容与公开参数不能表达所需行为时直接进入 component/runtime 源码创作或修改，不要求先失败。excluded 列出的分支当前 Published 播放不会执行，首次生成前排除并选择给出的替代；信息不足时先经 discovery/query 读取完整能力卡再判定，不要提交故意错误的候选探测。',
  }
}
