import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Link2,
  MousePointerClick,
  Play,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import {
  isNodeMotionAction,
  isTerminalNavigationAction,
  MAX_INTERACTION_CONDITIONS,
  type AudioActionTarget,
  type InteractionAction,
  type InteractionActionStep,
  type InteractionCondition,
  type InteractionRule,
  type InteractionTrigger,
  type MotionDirection,
  type MotionEasing,
  type MotionEffect,
} from '../../shared/interactionTypes'
import type { CourseStateDeclaration } from '../../shared/courseProjectTypes'
import type { SoundDefinition } from '../../shared/contracts/media-v1'
import type { InteractionLayerTarget } from '../course/slideInteractionView'
import { requestNodeMotionPreview } from '../phaser/elementAnimationPreviewBus'

export interface InteractionSceneListItem {
  readonly id: string
  readonly name: string
  readonly presentation?: {
    readonly initialStateId?: string
    readonly states?: ReadonlyArray<{
      readonly id: string
      readonly name: string
    }>
  }
}

export interface InteractionSceneView {
  readonly id: string
  readonly name: string
  readonly nodes?: readonly InteractionLayerTarget[]
  readonly interactions?: readonly InteractionRule[]
  readonly presentation?: InteractionSceneListItem['presentation']
}

function presentationStates(
  scene: Pick<InteractionSceneView, 'presentation'>,
): Array<{ id: string; name: string }> {
  return (scene.presentation?.states ?? []).map((state) => ({
    id: state.id,
    name: state.name,
  }))
}

const ALL_STATES = '__all_states__'
const MULTIPLE_STATES = '__multiple_states__'
const ALL_SCENES = '__all_scenes__'
const MULTIPLE_SCENES = '__multiple_scenes__'

type ActionType = InteractionAction['type']
type AutomationTrigger = Exclude<InteractionTrigger, { type: 'node.click' }>
type AutomationTriggerType = AutomationTrigger['type']
type AutomationRule = InteractionRule & { trigger: AutomationTrigger }

interface ActionTypeOption {
  value: ActionType
  label: string
  needs?: 'state' | 'scene' | 'sound' | 'video' | 'node' | 'course-state'
}

const ACTION_TYPE_OPTIONS: ActionTypeOption[] = [
  { value: 'node.enter', label: '元素出现（入场）', needs: 'node' },
  { value: 'node.exit', label: '元素退出（退场）', needs: 'node' },
  { value: 'presentation.set', label: '切换状态', needs: 'state' },
  { value: 'scene.go', label: '跳转场景', needs: 'scene' },
  { value: 'scene.next', label: '下一场景' },
  { value: 'scene.previous', label: '上一场景' },
  { value: 'scene.replay', label: '重播当前场景' },
  { value: 'course.restart', label: '重新开始课程' },
  { value: 'course-state.set', label: '设置课程状态', needs: 'course-state' },
  { value: 'audio.play', label: '播放声音', needs: 'sound' },
  { value: 'audio.pause', label: '暂停声音' },
  { value: 'audio.resume', label: '继续声音' },
  { value: 'audio.stop', label: '停止声音' },
  { value: 'audio.toggle-mute', label: '切换静音' },
  { value: 'video.play', label: '播放视频', needs: 'video' },
  { value: 'video.pause', label: '暂停视频', needs: 'video' },
  { value: 'video.restart', label: '重播视频', needs: 'video' },
  { value: 'video.stop', label: '停止视频', needs: 'video' },
  { value: 'video.toggle', label: '切换视频播放', needs: 'video' },
  { value: 'video.seek', label: '视频跳转到时间', needs: 'video' },
]

interface AutomationTriggerOption {
  value: AutomationTriggerType
  label: string
  needs?: 'state' | 'sound' | 'video' | 'component' | 'node' | 'animation'
  disabled?: boolean
}

const AUTOMATION_TRIGGER_OPTIONS: AutomationTriggerOption[] = [
  { value: 'scene.enter', label: '进入场景' },
  { value: 'presentation.enter', label: '进入状态', needs: 'state' },
  { value: 'node.activated', label: '元素在稳定画面中被激活', needs: 'node' },
  { value: 'animation.completed', label: '动画动作完成', needs: 'animation' },
  { value: 'audio.ended', label: '声音播放结束', needs: 'sound' },
  { value: 'video.started', label: '视频开始播放', needs: 'video' },
  { value: 'video.paused', label: '视频暂停', needs: 'video' },
  { value: 'video.ended', label: '视频播放结束', needs: 'video' },
  { value: 'video.time', label: '视频到达时间点', needs: 'video' },
  { value: 'component.event', label: '组件发出事件', needs: 'component' },
  { value: 'runtime.event', label: '运行时发出事件' },
  {
    value: 'presenter.command',
    label: '翻页笔命令',
  },
]

const AUDIO_CHANNELS = [
  ['music', '背景音乐'],
  ['narration', '旁白'],
  ['sfx', '音效'],
  ['ui', '界面音'],
] as const

const MOTION_EFFECTS: Array<{ value: MotionEffect; label: string }> = [
  { value: 'none', label: '立即' },
  { value: 'fade', label: '淡化' },
  { value: 'slide', label: '滑动' },
  { value: 'scale', label: '缩放' },
]

const MOTION_DIRECTIONS: Array<{ value: MotionDirection; label: string }> = [
  { value: 'left', label: '左侧' },
  { value: 'right', label: '右侧' },
  { value: 'up', label: '上方' },
  { value: 'down', label: '下方' },
]

const MOTION_EASINGS: Array<{ value: MotionEasing; label: string }> = [
  { value: 'linear', label: '线性' },
  { value: 'ease-in', label: '渐快' },
  { value: 'ease-out', label: '渐慢' },
  { value: 'ease-in-out', label: '先慢后快再慢' },
]

interface AnimationStepOption {
  id: string
  label: string
}

function createActionStep(
  action: InteractionAction,
  start: InteractionActionStep['start'] = 'after-previous',
): InteractionActionStep {
  return {
    id: `action_${nanoid()}`,
    start,
    delayMs: 0,
    action,
  }
}

function isTerminalActionStep(step: InteractionActionStep): boolean {
  return isTerminalNavigationAction(step.action)
}

export interface InteractionEditorProps {
  scene: InteractionSceneView
  selectedNode: InteractionLayerTarget
  sourceScope?: 'scene' | 'global'
  sourceNodes?: readonly InteractionLayerTarget[]
  sourceRules?: readonly InteractionRule[]
  selectedNodeId?: string | null
  activeStateId: string | null
  scenes: ReadonlyArray<InteractionSceneListItem>
  sounds: Readonly<Record<string, SoundDefinition>>
  courseState?: readonly CourseStateDeclaration[]
  ruleWarnings?: Readonly<Record<string, readonly string[]>>
  onOpenClickRules?(): void
  onRunPreview?(): void
  onAddRule(rule: InteractionRule): void
  onUpdateRule(
    ruleId: string,
    patch: Partial<Omit<InteractionRule, 'id'>>,
  ): void
  onDeleteRule(ruleId: string): void
  onDuplicateRule?(ruleId: string): void
  onMoveRule?(ruleId: string, direction: -1 | 1): void
}

export interface RevealSequenceTemplateIntent {
  readonly ruleId: string
  readonly actionIds: readonly string[]
  readonly targetLayerItemIds: readonly string[]
  readonly name: string
}

function sceneScope(rule: InteractionRule): string {
  const sceneIds = rule.conditions
    .filter((condition) => condition.type === 'scene.in')
    .flatMap((condition) => condition.sceneIds)
  if (sceneIds.length === 0) return ALL_SCENES
  return new Set(sceneIds).size === 1 ? sceneIds[0]! : MULTIPLE_SCENES
}

function setRuleSceneScope(
  rule: InteractionRule,
  sceneId: string,
): InteractionRule['conditions'] {
  const retained = rule.conditions.filter(
    (condition) => condition.type !== 'scene.in',
  )
  return sceneId === ALL_SCENES
    ? retained
    : [...retained, { type: 'scene.in', sceneIds: [sceneId] }]
}

function stateScope(rule: InteractionRule): string {
  const stateIds = rule.conditions
    .filter((condition) => condition.type === 'presentation.in')
    .flatMap((condition) => condition.stateIds)
  if (stateIds.length === 0) return ALL_STATES
  return new Set(stateIds).size === 1 ? stateIds[0]! : MULTIPLE_STATES
}

function setRuleStateScope(
  rule: InteractionRule,
  stateId: string,
): InteractionRule['conditions'] {
  const retained = rule.conditions.filter(
    (condition) => condition.type !== 'presentation.in',
  )
  return stateId === ALL_STATES
    ? retained
    : [...retained, { type: 'presentation.in', stateIds: [stateId] }]
}

function needsUnavailableTarget(
  option: ActionTypeOption,
  counts: {
    states: number
    scenes: number
    sounds: number
    videos: number
    nodes: number
    courseStates: number
  },
): boolean {
  switch (option.needs) {
    case 'state': return counts.states === 0
    case 'scene': return counts.scenes === 0
    case 'sound': return counts.sounds === 0
    case 'video': return counts.videos === 0
    case 'node': return counts.nodes === 0
    case 'course-state': return counts.courseStates === 0
    default: return false
  }
}

function defaultAction(
  type: ActionType,
  targets: {
    stateId?: string
    sceneId?: string
    soundId?: string
    videoId?: string
    nodeId?: string
    courseState?: CourseStateDeclaration
  },
): InteractionAction {
  switch (type) {
    case 'node.enter':
      return {
        type,
        nodeId: targets.nodeId ?? '',
        effect: 'fade',
        durationMs: 320,
        easing: 'ease-out',
      }
    case 'node.exit':
      return {
        type,
        nodeId: targets.nodeId ?? '',
        effect: 'fade',
        durationMs: 240,
        easing: 'ease-in',
      }
    case 'presentation.set':
      return { type, stateId: targets.stateId ?? '' }
    case 'scene.go':
      return { type, sceneId: targets.sceneId ?? '' }
    case 'scene.next':
    case 'scene.previous':
    case 'scene.replay':
    case 'course.restart':
      return { type }
    case 'course-state.set':
      return {
        type,
        key: targets.courseState?.key ?? '',
        value: targets.courseState?.defaultValue ?? null,
      }
    case 'audio.play':
      return { type, soundId: targets.soundId ?? '' }
    case 'audio.pause':
    case 'audio.resume':
    case 'audio.stop':
    case 'audio.toggle-mute':
      return { type, target: { kind: 'all' } }
    case 'video.play':
    case 'video.pause':
    case 'video.restart':
    case 'video.stop':
    case 'video.toggle':
      return { type, nodeId: targets.videoId ?? '' }
    case 'video.seek':
      return { type, nodeId: targets.videoId ?? '', seconds: 0 }
  }
}

function isAutomationRule(rule: InteractionRule): rule is AutomationRule {
  return rule.trigger.type !== 'node.click'
}

function automationTriggerUnavailable(
  option: AutomationTriggerOption,
  counts: {
    states: number
    sounds: number
    videos: number
    components: number
    nodes: number
    animations: number
  },
): boolean {
  if (option.disabled) return true
  switch (option.needs) {
    case 'state': return counts.states === 0
    case 'sound': return counts.sounds === 0
    case 'video': return counts.videos === 0
    case 'component': return counts.components === 0
    case 'node': return counts.nodes === 0
    case 'animation': return counts.animations === 0
    default: return false
  }
}

function defaultAutomationTrigger(
  type: AutomationTriggerType,
  targets: {
    stateId?: string
    soundId?: string
    videoId?: string
    componentId?: string
    nodeId?: string
    actionId?: string
  },
): AutomationTrigger {
  switch (type) {
    case 'scene.enter':
      return { type }
    case 'presentation.enter':
      return { type, stateId: targets.stateId ?? '' }
    case 'node.activated':
      return { type, nodeId: targets.nodeId ?? '' }
    case 'animation.completed':
      return { type, actionId: targets.actionId ?? '' }
    case 'audio.ended':
      return { type, soundId: targets.soundId ?? '' }
    case 'video.started':
    case 'video.paused':
    case 'video.ended':
      return { type, nodeId: targets.videoId ?? '' }
    case 'video.time':
      return { type, nodeId: targets.videoId ?? '', seconds: 0 }
    case 'component.event':
      return {
        type,
        nodeId: targets.componentId ?? '',
        eventName: 'complete',
      }
    case 'runtime.event':
      return { type, scope: 'scene', eventName: 'complete' }
    case 'presenter.command':
      return { type, command: 'next' }
  }
}

function automationTriggerLabel(type: AutomationTriggerType): string {
  return AUTOMATION_TRIGGER_OPTIONS.find((option) => option.value === type)?.label ?? type
}

type RuleListFilter = 'all' | 'selected-node' | 'enabled' | 'disabled' | 'warnings'
type RuleTemplateId =
  | 'scene-enter-sequence'
  | 'audio-ended-next'
  | 'video-ended-next'
  | 'component-event-state'
  | 'animation-ended-next'

interface RuleDescriptionContext {
  nodes: ReadonlyMap<string, string>
  states: ReadonlyMap<string, string>
  scenes: ReadonlyArray<InteractionSceneListItem>
  sounds: ReadonlyMap<string, string>
  animationSteps: ReadonlyMap<string, string>
  courseState: ReadonlyMap<string, CourseStateDeclaration>
}

const RULE_TEMPLATE_OPTIONS: Array<{
  value: RuleTemplateId
  label: string
  description: string
  needs: 'nodes' | 'sounds' | 'videos' | 'components-and-states' | 'animations'
}> = [
  {
    value: 'scene-enter-sequence',
    label: '进入场景后，元素依次出现',
    description: '让当前画面前 6 个元素按顺序淡入，可在创建后继续增删动作。',
    needs: 'nodes',
  },
  {
    value: 'audio-ended-next',
    label: '声音结束后，进入下一场景',
    description: '适合旁白或讲解音频播放完成后自动继续。',
    needs: 'sounds',
  },
  {
    value: 'video-ended-next',
    label: '视频结束后，进入下一场景',
    description: '循环视频不会自然触发结束事件，创建后请检查冲突提示。',
    needs: 'videos',
  },
  {
    value: 'component-event-state',
    label: '组件完成后，切换状态',
    description: '监听组件 complete 事件，并切换到当前场景的另一个状态。',
    needs: 'components-and-states',
  },
  {
    value: 'animation-ended-next',
    label: '动画完成后，进入下一场景',
    description: '监听一个现有入场或退场动作正常完成。',
    needs: 'animations',
  },
]

function namedReference(
  values: ReadonlyMap<string, string>,
  id: string,
  fallback: string,
): string {
  return values.get(id) ?? `${fallback}（${id || '未设置'}）`
}

function describeTrigger(
  trigger: InteractionTrigger,
  context: RuleDescriptionContext,
): string {
  switch (trigger.type) {
    case 'node.click':
      return `单击“${namedReference(context.nodes, trigger.nodeId, '缺失元素')}”`
    case 'scene.enter':
      return '进入当前场景'
    case 'presentation.enter':
      return `进入状态“${namedReference(context.states, trigger.stateId, '缺失状态')}”`
    case 'node.activated':
      return `元素“${namedReference(context.nodes, trigger.nodeId, '缺失元素')}”在稳定画面中被激活`
    case 'animation.completed':
      return `动画“${namedReference(
        context.animationSteps,
        trigger.actionId,
        '缺失动作',
      )}”完成`
    case 'component.event':
      return `组件“${namedReference(context.nodes, trigger.nodeId, '缺失组件')}”发出 ${trigger.eventName || '未命名'} 事件`
    case 'runtime.event':
      return `${trigger.scope === 'global' ? '全局' : '当前场景'}运行时发出 ${trigger.eventName || '未命名'} 事件`
    case 'audio.ended':
      return `声音“${namedReference(context.sounds, trigger.soundId, '缺失声音')}”播放结束`
    case 'video.started':
      return `视频“${namedReference(context.nodes, trigger.nodeId, '缺失视频')}”开始播放`
    case 'video.paused':
      return `视频“${namedReference(context.nodes, trigger.nodeId, '缺失视频')}”暂停`
    case 'video.ended':
      return `视频“${namedReference(context.nodes, trigger.nodeId, '缺失视频')}”播放结束`
    case 'video.time':
      return `视频“${namedReference(context.nodes, trigger.nodeId, '缺失视频')}”播放到 ${trigger.seconds} 秒`
    case 'presenter.command':
      return `翻页笔发出“${trigger.command === 'next' ? '前进' : '后退'}”命令`
  }
}

function describeConditions(
  rule: InteractionRule,
  context: RuleDescriptionContext,
): string {
  if (rule.conditions.length === 0) return '无需附加条件'
  return rule.conditions.map((condition) => {
    if (condition.type === 'scene.in') {
      return `当前场景是 ${condition.sceneIds.map((sceneId) => {
        const scene = context.scenes.find((item) => item.id === sceneId)
        return `“${scene?.name ?? `缺失场景（${sceneId}）`}”`
      }).join(' 或 ')}`
    }
    if (condition.type === 'presentation.in') {
      return `当前状态是 ${condition.stateIds.map((stateId) => (
        `“${namedReference(context.states, stateId, '缺失状态')}”`
      )).join(' 或 ')}`
    }
    const key = context.courseState.has(condition.key)
      ? condition.key
      : `缺失课程状态（${condition.key}）`
    if (condition.type === 'course-state.exists') {
      return `课程状态“${key}”${condition.exists ? '存在' : '不存在'}`
    }
    const operators = {
      eq: '等于',
      neq: '不等于',
      gt: '大于',
      gte: '大于等于',
      lt: '小于',
      lte: '小于等于',
    } as const
    return `课程状态“${key}”${operators[condition.operator]} ${String(condition.value)}`
  }).join('，并且 ')
}

function describeAudioTarget(
  target: AudioActionTarget,
  context: RuleDescriptionContext,
): string {
  if (target.kind === 'all') return '全部声音'
  if (target.kind === 'channel') {
    return `${AUDIO_CHANNELS.find(([channel]) => channel === target.channel)?.[1] ?? target.channel}声道`
  }
  return `声音“${namedReference(context.sounds, target.soundId, '缺失声音')}”`
}

function describeAction(
  action: InteractionAction,
  context: RuleDescriptionContext,
): string {
  switch (action.type) {
    case 'node.enter': {
      const target = namedReference(context.nodes, action.nodeId, '缺失元素')
      const effect = action.effect === 'slide'
        ? `从${MOTION_DIRECTIONS.find(({ value }) => value === action.direction)?.label ?? action.direction}滑入`
        : action.effect === 'fade'
          ? '淡入'
          : action.effect === 'scale'
            ? '缩放出现'
            : '立即出现'
      return `让“${target}”${effect}${action.effect === 'none' ? '' : `（${action.durationMs} 毫秒）`}`
    }
    case 'node.exit': {
      const target = namedReference(context.nodes, action.nodeId, '缺失元素')
      const effect = action.effect === 'slide'
        ? `向${MOTION_DIRECTIONS.find(({ value }) => value === action.direction)?.label ?? action.direction}滑出`
        : action.effect === 'fade'
          ? '淡出'
          : action.effect === 'scale'
            ? '缩放退出'
            : '立即隐藏'
      return `让“${target}”${effect}${action.effect === 'none' ? '' : `（${action.durationMs} 毫秒）`}`
    }
    case 'presentation.set':
      return `切换到状态“${namedReference(context.states, action.stateId, '缺失状态')}”`
    case 'scene.go': {
      const targetScene = context.scenes.find((scene) => scene.id === action.sceneId)
      const targetState = action.targetStateId
        ? targetScene?.presentation?.states?.find((state) => state.id === action.targetStateId)
        : undefined
      return `跳转到场景“${targetScene?.name ?? `缺失场景（${action.sceneId}）`}”${
        action.targetStateId
          ? `的状态“${targetState?.name ?? `缺失状态（${action.targetStateId}）`}”`
          : ''
      }`
    }
    case 'scene.next':
      return '进入下一场景'
    case 'scene.previous':
      return '返回上一场景'
    case 'scene.replay':
      return '重播当前场景'
    case 'course.restart':
      return '重新开始课程'
    case 'course-state.set':
      return `把课程状态“${context.courseState.has(action.key)
        ? action.key
        : `缺失课程状态（${action.key}）`}”设为 ${String(action.value)}`
    case 'audio.play':
      return `播放声音“${namedReference(context.sounds, action.soundId, '缺失声音')}”`
    case 'audio.pause':
      return `暂停${describeAudioTarget(action.target, context)}`
    case 'audio.resume':
      return `继续${describeAudioTarget(action.target, context)}`
    case 'audio.stop':
      return `停止${describeAudioTarget(action.target, context)}`
    case 'audio.toggle-mute':
      return `切换${describeAudioTarget(action.target, context)}的静音状态`
    case 'video.play':
      return `播放视频“${namedReference(context.nodes, action.nodeId, '缺失视频')}”`
    case 'video.pause':
      return `暂停视频“${namedReference(context.nodes, action.nodeId, '缺失视频')}”`
    case 'video.restart':
      return `重播视频“${namedReference(context.nodes, action.nodeId, '缺失视频')}”`
    case 'video.stop':
      return `停止视频“${namedReference(context.nodes, action.nodeId, '缺失视频')}”`
    case 'video.toggle':
      return `切换视频“${namedReference(context.nodes, action.nodeId, '缺失视频')}”的播放状态`
    case 'video.seek':
      return `把视频“${namedReference(context.nodes, action.nodeId, '缺失视频')}”跳转到 ${action.seconds} 秒`
  }
}

function actionSequenceLead(
  step: InteractionActionStep,
  index: number,
): string {
  const delay = step.delayMs > 0 ? `延迟 ${step.delayMs} 毫秒` : ''
  if (index === 0) return delay ? `${delay}后` : '立即'
  if (step.start === 'with-previous') {
    return delay ? `与上一步同时计时，${delay}后开始` : '与上一步同时开始'
  }
  return delay ? `等待上一组完成，再${delay}后开始` : '等待上一组完成'
}

function describeActionSequence(
  actions: readonly InteractionActionStep[],
  context: RuleDescriptionContext,
): string {
  return actions.map((step, index) => (
    `${actionSequenceLead(step, index)}：${describeAction(step.action, context)}`
  )).join('；')
}

function ruleReferencesNode(
  rule: InteractionRule,
  nodeId: string,
  allRules: readonly InteractionRule[],
): boolean {
  if ('nodeId' in rule.trigger && rule.trigger.nodeId === nodeId) return true
  if (rule.actions.some((step) => (
    'nodeId' in step.action && step.action.nodeId === nodeId
  ))) return true
  if (rule.trigger.type !== 'animation.completed') return false
  const completedActionId = rule.trigger.actionId
  const sourceStep = allRules
    .flatMap((item) => item.actions)
    .find((step) => step.id === completedActionId)
  return Boolean(
    sourceStep &&
    'nodeId' in sourceStep.action &&
    sourceStep.action.nodeId === nodeId,
  )
}

function ruleTemplateUnavailable(
  option: (typeof RULE_TEMPLATE_OPTIONS)[number],
  counts: {
    nodes: number
    sounds: number
    videos: number
    components: number
    states: number
    animations: number
  },
): boolean {
  switch (option.needs) {
    case 'nodes': return counts.nodes === 0
    case 'sounds': return counts.sounds === 0
    case 'videos': return counts.videos === 0
    case 'components-and-states':
      return counts.components === 0 || counts.states < 2
    case 'animations': return counts.animations === 0
  }
}

function missingOption(
  value: string,
  available: ReadonlySet<string>,
  label: string,
) {
  return value && !available.has(value)
    ? <option value={value}>{`${label}（已缺失）`}</option>
    : null
}

function AudioTargetFields({
  idPrefix,
  target,
  sounds,
  update,
}: {
  idPrefix: string
  target: AudioActionTarget
  sounds: SoundDefinition[]
  update(target: AudioActionTarget): void
}) {
  const soundIds = new Set(sounds.map((sound) => sound.id))
  return (
    <>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-audio-target-kind`}>声音目标范围</label>
        <select
          id={`${idPrefix}-audio-target-kind`}
          className="form-input"
          value={target.kind}
          onChange={(event) => {
            const kind = event.currentTarget.value as AudioActionTarget['kind']
            if (kind === 'all') update({ kind })
            else if (kind === 'channel') update({ kind, channel: 'music' })
            else update({ kind, soundId: sounds[0]?.id ?? '' })
          }}
        >
          <option value="all">全部声音</option>
          <option value="channel">指定声道</option>
          <option value="sound" disabled={sounds.length === 0}>指定声音</option>
        </select>
      </div>
      {target.kind === 'channel' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-audio-channel`}>声道</label>
          <select
            id={`${idPrefix}-audio-channel`}
            className="form-input"
            value={target.channel}
            onChange={(event) => update({
              kind: 'channel',
              channel: event.currentTarget.value as typeof target.channel,
            })}
          >
            {AUDIO_CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      ) : null}
      {target.kind === 'sound' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-audio-sound`}>声音</label>
          <select
            id={`${idPrefix}-audio-sound`}
            className="form-input"
            value={target.soundId}
            onChange={(event) => update({
              kind: 'sound',
              soundId: event.currentTarget.value,
            })}
          >
            {missingOption(target.soundId, soundIds, target.soundId)}
            {sounds.map((sound) => (
              <option key={sound.id} value={sound.id}>{sound.name}</option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  )
}

function AutomationTriggerEditor({
  rule,
  states,
  sounds,
  videos,
  components,
  nodes,
  animationSteps,
  onChange,
}: {
  rule: AutomationRule
  states: ReadonlyArray<{ id: string; name: string }>
  sounds: SoundDefinition[]
  videos: InteractionLayerTarget[]
  components: InteractionLayerTarget[]
  nodes: ReadonlyArray<InteractionLayerTarget>
  animationSteps: AnimationStepOption[]
  onChange(trigger: AutomationTrigger): void
}) {
  const trigger = rule.trigger
  const idPrefix = `automation-${rule.id}-trigger`
  const stateIds = new Set(states.map((state) => state.id))
  const soundIds = new Set(sounds.map((sound) => sound.id))
  const videoIds = new Set(videos.map((video) => video.id))
  const componentIds = new Set(components.map((component) => component.id))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const animationIds = new Set(animationSteps.map((step) => step.id))
  const targets = {
    stateId: states[0]?.id,
    soundId: sounds[0]?.id,
    videoId: videos[0]?.id,
    componentId: components[0]?.id,
    nodeId: nodes[0]?.id,
    actionId: animationSteps[0]?.id,
  }
  const counts = {
    states: states.length,
    sounds: sounds.length,
    videos: videos.length,
    components: components.length,
    nodes: nodes.length,
    animations: animationSteps.length,
  }

  return (
    <>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-type`}>触发方式</label>
        <select
          id={`${idPrefix}-type`}
          className="form-input"
          value={trigger.type}
          onChange={(event) => onChange(defaultAutomationTrigger(
            event.currentTarget.value as AutomationTriggerType,
            targets,
          ))}
        >
          {AUTOMATION_TRIGGER_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={automationTriggerUnavailable(option, counts)}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {trigger.type === 'presentation.enter' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-state`}>进入状态</label>
          <select
            id={`${idPrefix}-state`}
            className="form-input"
            value={trigger.stateId}
            onChange={(event) => onChange({
              ...trigger,
              stateId: event.currentTarget.value,
            })}
          >
            {missingOption(trigger.stateId, stateIds, trigger.stateId)}
            {states.map((state) => (
              <option key={state.id} value={state.id}>{state.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {trigger.type === 'presenter.command' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-presenter-command`}>演示命令</label>
          <select
            id={`${idPrefix}-presenter-command`}
            className="form-input"
            value={trigger.command}
            onChange={(event) => onChange({
              ...trigger,
              command: event.currentTarget.value as 'next' | 'previous',
            })}
          >
            <option value="next">前进</option>
            <option value="previous">后退</option>
          </select>
        </div>
      ) : null}

      {trigger.type === 'node.activated' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-node`}>监听元素</label>
          <select
            id={`${idPrefix}-node`}
            className="form-input"
            value={trigger.nodeId}
            onChange={(event) => onChange({
              ...trigger,
              nodeId: event.currentTarget.value,
            })}
          >
            {missingOption(trigger.nodeId, nodeIds, trigger.nodeId)}
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>{node.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {trigger.type === 'animation.completed' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-animation`}>监听动画动作</label>
          <select
            id={`${idPrefix}-animation`}
            className="form-input"
            value={trigger.actionId}
            onChange={(event) => onChange({
              ...trigger,
              actionId: event.currentTarget.value,
            })}
          >
            {missingOption(trigger.actionId, animationIds, trigger.actionId)}
            {animationSteps.map((step) => (
              <option key={step.id} value={step.id}>{step.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      {trigger.type === 'audio.ended' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-sound`}>监听声音</label>
          <select
            id={`${idPrefix}-sound`}
            className="form-input"
            value={trigger.soundId}
            onChange={(event) => onChange({
              ...trigger,
              soundId: event.currentTarget.value,
            })}
          >
            {missingOption(trigger.soundId, soundIds, trigger.soundId)}
            {sounds.map((sound) => (
              <option key={sound.id} value={sound.id}>{sound.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {(
        trigger.type === 'video.started' ||
        trigger.type === 'video.paused' ||
        trigger.type === 'video.ended' ||
        trigger.type === 'video.time'
      ) ? (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-video`}>监听视频</label>
            <select
              id={`${idPrefix}-video`}
              className="form-input"
              value={trigger.nodeId}
              onChange={(event) => onChange({
                ...trigger,
                nodeId: event.currentTarget.value,
              })}
            >
              {missingOption(trigger.nodeId, videoIds, trigger.nodeId)}
              {videos.map((video) => (
                <option key={video.id} value={video.id}>{video.name}</option>
              ))}
            </select>
          </div>
          {trigger.type === 'video.time' ? (
            <div className="form-field">
              <label htmlFor={`${idPrefix}-seconds`}>触发时间（秒）</label>
              <input
                id={`${idPrefix}-seconds`}
                className="form-input"
                type="number"
                min={0}
                max={604_800}
                step={0.1}
                value={trigger.seconds}
                onChange={(event) => onChange({
                  ...trigger,
                  seconds: Math.max(0, event.currentTarget.valueAsNumber || 0),
                })}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {trigger.type === 'component.event' ? (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-component`}>来源组件</label>
            <select
              id={`${idPrefix}-component`}
              className="form-input"
              value={trigger.nodeId}
              onChange={(event) => onChange({
                ...trigger,
                nodeId: event.currentTarget.value,
              })}
            >
              {missingOption(trigger.nodeId, componentIds, trigger.nodeId)}
              {components.map((component) => (
                <option key={component.id} value={component.id}>{component.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-event-name`}>事件名称</label>
            <input
              id={`${idPrefix}-event-name`}
              className="form-input"
              maxLength={160}
              value={trigger.eventName}
              onChange={(event) => onChange({
                ...trigger,
                eventName: event.currentTarget.value,
              })}
            />
          </div>
        </>
      ) : null}

      {trigger.type === 'runtime.event' ? (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-runtime-scope`}>运行时来源</label>
            <select
              id={`${idPrefix}-runtime-scope`}
              className="form-input"
              value={trigger.scope}
              onChange={(event) => onChange({
                ...trigger,
                scope: event.currentTarget.value as typeof trigger.scope,
              })}
            >
              <option value="scene">当前场景运行时</option>
              <option value="global">全局运行时</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-runtime-event-name`}>运行时事件名称</label>
            <input
              id={`${idPrefix}-runtime-event-name`}
              className="form-input"
              maxLength={160}
              value={trigger.eventName}
              onChange={(event) => onChange({
                ...trigger,
                eventName: event.currentTarget.value,
              })}
            />
          </div>
        </>
      ) : null}
    </>
  )
}

type InteractionCourseStateCondition = Extract<
  InteractionCondition,
  { type: 'course-state.exists' | 'course-state.compare' }
>

function courseStateValueMatchesDeclaration(
  declaration: CourseStateDeclaration,
  value: unknown,
): value is CourseStateDeclaration['defaultValue'] {
  return declaration.valueType === 'null'
    ? value === null
    : typeof value === declaration.valueType
}

function CourseStateValueField({
  id,
  label,
  declaration,
  value,
  onChange,
}: {
  id: string
  label: string
  declaration: CourseStateDeclaration
  value: boolean | number | string | null
  onChange(value: boolean | number | string | null): void
}) {
  const effectiveValue = courseStateValueMatchesDeclaration(declaration, value)
    ? value
    : declaration.defaultValue
  if (declaration.valueType === 'boolean') {
    return (
      <div className="form-field">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          className="form-input"
          value={effectiveValue === true ? 'true' : 'false'}
          onChange={(event) => onChange(event.currentTarget.value === 'true')}
        >
          <option value="true">是（true）</option>
          <option value="false">否（false）</option>
        </select>
      </div>
    )
  }
  if (declaration.valueType === 'number') {
    return (
      <div className="form-field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          className="form-input"
          type="number"
          value={typeof effectiveValue === 'number' ? effectiveValue : declaration.defaultValue}
          onChange={(event) => onChange(Number.isFinite(event.currentTarget.valueAsNumber)
            ? event.currentTarget.valueAsNumber
            : declaration.defaultValue)}
        />
      </div>
    )
  }
  if (declaration.valueType === 'string') {
    return (
      <div className="form-field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          className="form-input"
          value={typeof effectiveValue === 'string' ? effectiveValue : declaration.defaultValue}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
    )
  }
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="form-input" value="null" readOnly />
    </div>
  )
}

function CourseStateConditionsEditor({
  rule,
  declarations,
  onChange,
}: {
  rule: InteractionRule
  declarations: readonly CourseStateDeclaration[]
  onChange(conditions: InteractionCondition[]): void
}) {
  const declarationByKey = new Map(declarations.map((item) => [item.key, item]))
  const stateKeys = new Set(declarations.map((item) => item.key))
  const entries = rule.conditions.flatMap((condition, index) => (
    condition.type === 'course-state.exists'
    || condition.type === 'course-state.compare'
      ? [{ condition, index }]
      : []
  ))
  const replace = (index: number, condition: InteractionCondition): void => {
    onChange(rule.conditions.map((item, itemIndex) => (
      itemIndex === index ? condition : item
    )))
  }
  const firstDeclaration = declarations[0]

  return (
    <section className="interaction-course-state-conditions">
      <h4>课程状态条件</h4>
      <p className="property-hint">与场景、画面状态条件一起按“并且”判断。</p>
      {entries.map(({ condition, index }, conditionIndex) => {
        const declaration = declarationByKey.get(condition.key) ?? firstDeclaration
        const idPrefix = `interaction-${rule.id}-course-state-condition-${index}`
        return (
          <fieldset key={`${condition.type}:${index}`} aria-label={`课程状态条件 ${conditionIndex + 1}`}>
            <legend>{`课程状态条件 ${conditionIndex + 1}`}</legend>
            <div className="form-field">
              <label htmlFor={`${idPrefix}-type`}>条件类型</label>
              <select
                id={`${idPrefix}-type`}
                className="form-input"
                value={condition.type}
                onChange={(event) => {
                  const type = event.currentTarget.value as InteractionCourseStateCondition['type']
                  replace(index, type === 'course-state.exists'
                    ? { type, key: condition.key, exists: true }
                    : {
                        type,
                        key: condition.key,
                        operator: 'eq',
                        value: declaration?.defaultValue ?? null,
                      })
                }}
              >
                <option value="course-state.compare">比较课程状态</option>
                <option value="course-state.exists">检查课程状态是否存在</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor={`${idPrefix}-key`}>课程状态键</label>
              <select
                id={`${idPrefix}-key`}
                className="form-input"
                value={condition.key}
                onChange={(event) => {
                  const nextDeclaration = declarationByKey.get(event.currentTarget.value)
                  if (!nextDeclaration) return
                  replace(index, condition.type === 'course-state.exists'
                    ? { ...condition, key: nextDeclaration.key }
                    : {
                        ...condition,
                        key: nextDeclaration.key,
                        operator: nextDeclaration.valueType === 'number'
                          ? condition.operator
                          : condition.operator === 'eq' || condition.operator === 'neq'
                            ? condition.operator
                            : 'eq',
                        value: nextDeclaration.defaultValue,
                      })
                }}
              >
                {missingOption(condition.key, stateKeys, condition.key)}
                {declarations.map((item) => (
                  <option key={item.key} value={item.key}>{item.key}</option>
                ))}
              </select>
            </div>
            {condition.type === 'course-state.exists' ? (
              <div className="form-field">
                <label htmlFor={`${idPrefix}-exists`}>存在要求</label>
                <select
                  id={`${idPrefix}-exists`}
                  className="form-input"
                  value={condition.exists ? 'true' : 'false'}
                  onChange={(event) => replace(index, {
                    ...condition,
                    exists: event.currentTarget.value === 'true',
                  })}
                >
                  <option value="true">必须存在</option>
                  <option value="false">必须不存在</option>
                </select>
              </div>
            ) : declaration ? (
              <>
                <div className="form-field">
                  <label htmlFor={`${idPrefix}-operator`}>比较方式</label>
                  <select
                    id={`${idPrefix}-operator`}
                    className="form-input"
                    value={condition.operator}
                    onChange={(event) => replace(index, {
                      ...condition,
                      operator: event.currentTarget.value as Extract<
                        InteractionCourseStateCondition,
                        { type: 'course-state.compare' }
                      >['operator'],
                    })}
                  >
                    <option value="eq">等于</option>
                    <option value="neq">不等于</option>
                    {declaration.valueType === 'number' ? (
                      <>
                        <option value="gt">大于</option>
                        <option value="gte">大于等于</option>
                        <option value="lt">小于</option>
                        <option value="lte">小于等于</option>
                      </>
                    ) : null}
                  </select>
                </div>
                <CourseStateValueField
                  id={`${idPrefix}-value`}
                  label="比较值"
                  declaration={declaration}
                  value={condition.value}
                  onChange={(value) => replace(index, { ...condition, value })}
                />
              </>
            ) : null}
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              onClick={() => onChange(rule.conditions.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 size={13} />删除条件
            </button>
          </fieldset>
        )
      })}
      <button
        type="button"
        className="secondary-button"
        disabled={!firstDeclaration || rule.conditions.length >= MAX_INTERACTION_CONDITIONS}
        onClick={() => {
          if (!firstDeclaration) return
          onChange([
            ...rule.conditions,
            {
              type: 'course-state.compare',
              key: firstDeclaration.key,
              operator: 'eq',
              value: firstDeclaration.defaultValue,
            },
          ])
        }}
      >
        <Plus size={13} />添加课程状态条件
      </button>
      {!firstDeclaration ? (
        <p className="property-hint">请先在“课程状态与导航守卫”中声明课程状态。</p>
      ) : null}
    </section>
  )
}

function ActionEditor({
  rule,
  step,
  actionIndex,
  states,
  scenes,
  sounds,
  videos,
  nodes,
  courseState,
  referencedByCompletion,
  onChange,
  onRemove,
}: {
  rule: InteractionRule
  step: InteractionActionStep
  actionIndex: number
  states: ReadonlyArray<{ id: string; name: string }>
  scenes: ReadonlyArray<InteractionSceneListItem>
  sounds: SoundDefinition[]
  videos: InteractionLayerTarget[]
  nodes: ReadonlyArray<InteractionLayerTarget>
  courseState: readonly CourseStateDeclaration[]
  referencedByCompletion: boolean
  onChange(step: InteractionActionStep): void
  onRemove(): void
}) {
  const action = step.action
  const idPrefix = `interaction-${rule.id}-action-${step.id}`
  const updateAction = (nextAction: InteractionAction): void => {
    onChange({
      ...step,
      start: actionIndex === 0 || isTerminalNavigationAction(nextAction)
        ? 'after-previous'
        : step.start,
      action: nextAction,
    })
  }
  const stateIds = new Set(states.map((state) => state.id))
  const sceneIds = new Set(scenes.map((scene) => scene.id))
  const soundIds = new Set(sounds.map((sound) => sound.id))
  const videoIds = new Set(videos.map((video) => video.id))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const targets = {
    stateId: states[0]?.id,
    sceneId: scenes[0]?.id,
    soundId: sounds[0]?.id,
    videoId: videos[0]?.id,
    nodeId: nodes[0]?.id,
    courseState: courseState[0],
  }
  const counts = {
    states: states.length,
    scenes: scenes.length,
    sounds: sounds.length,
    videos: videos.length,
    nodes: nodes.length,
    courseStates: courseState.length,
  }
  const targetScene = action.type === 'scene.go'
    ? scenes.find((scene) => scene.id === action.sceneId)
    : undefined
  const targetStates = targetScene?.presentation?.states ?? []
  const targetStateIds = new Set(targetStates.map((state) => state.id))

  return (
    <fieldset
      aria-label={`动作 ${actionIndex + 1}`}
      style={{ border: '1px solid var(--border-color, #d8dee9)', borderRadius: 8, padding: 10, margin: '0 0 10px' }}
    >
      <legend>{`动作 ${actionIndex + 1}`}</legend>
      <div className="coordinate-grid">
        <div className="form-field">
          <label htmlFor={`${idPrefix}-start`}>开始方式</label>
          <select
            id={`${idPrefix}-start`}
            className="form-input"
            value={actionIndex === 0 ? 'after-previous' : step.start}
            disabled={actionIndex === 0 || isTerminalNavigationAction(action)}
            onChange={(event) => onChange({
              ...step,
              start: event.currentTarget.value as InteractionActionStep['start'],
            })}
          >
            <option value="after-previous">等待上一组完成</option>
            <option value="with-previous">与上一步同时开始</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-delay`}>局部延迟（毫秒）</label>
          <input
            id={`${idPrefix}-delay`}
            className="form-input"
            type="number"
            min={0}
            max={60_000}
            step={10}
            value={step.delayMs}
            onChange={(event) => onChange({
              ...step,
              delayMs: Math.min(
                60_000,
                Math.max(0, event.currentTarget.valueAsNumber || 0),
              ),
            })}
          />
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-type`}>动作类型</label>
        <select
          id={`${idPrefix}-type`}
          className="form-input"
          value={action.type}
          onChange={(event) => updateAction(defaultAction(
            event.currentTarget.value as ActionType,
            targets,
          ))}
        >
          {ACTION_TYPE_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={
                needsUnavailableTarget(option, counts) ||
                (referencedByCompletion &&
                  option.value !== 'node.enter' && option.value !== 'node.exit') ||
                (actionIndex < rule.actions.length - 1 &&
                  isTerminalNavigationAction(defaultAction(option.value, targets)))
              }
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {isNodeMotionAction(action) ? (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-node`}>目标元素</label>
            <select
              id={`${idPrefix}-node`}
              className="form-input"
              value={action.nodeId}
              onChange={(event) => updateAction({
                ...action,
                nodeId: event.currentTarget.value,
              })}
            >
              {missingOption(action.nodeId, nodeIds, action.nodeId)}
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </div>
          <div className="coordinate-grid">
            <div className="form-field">
              <label htmlFor={`${idPrefix}-effect`}>效果</label>
              <select
                id={`${idPrefix}-effect`}
                className="form-input"
                value={action.effect}
                onChange={(event) => {
                  const effect = event.currentTarget.value as MotionEffect
                  updateAction(effect === 'slide'
                    ? { ...action, effect, direction: 'left' }
                    : {
                        type: action.type,
                        nodeId: action.nodeId,
                        effect,
                        durationMs: action.durationMs,
                        easing: action.easing,
                      })
                }}
              >
                {MOTION_EFFECTS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            {action.effect === 'slide' ? (
              <div className="form-field">
                <label htmlFor={`${idPrefix}-direction`}>
                  {action.type === 'node.enter' ? '进入来源' : '退出方向'}
                </label>
                <select
                  id={`${idPrefix}-direction`}
                  className="form-input"
                  value={action.direction}
                  onChange={(event) => updateAction({
                    ...action,
                    direction: event.currentTarget.value as MotionDirection,
                  })}
                >
                  {MOTION_DIRECTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className="coordinate-grid">
            <div className="form-field">
              <label htmlFor={`${idPrefix}-motion-duration`}>动画时长（毫秒）</label>
              <input
                id={`${idPrefix}-motion-duration`}
                className="form-input"
                type="number"
                min={0}
                max={10_000}
                step={10}
                disabled={action.effect === 'none'}
                value={action.effect === 'none' ? 0 : action.durationMs}
                onChange={(event) => updateAction({
                  ...action,
                  durationMs: Math.min(
                    10_000,
                    Math.max(0, event.currentTarget.valueAsNumber || 0),
                  ),
                })}
              />
            </div>
            <div className="form-field">
              <label htmlFor={`${idPrefix}-easing`}>缓动</label>
              <select
                id={`${idPrefix}-easing`}
                className="form-input"
                disabled={action.effect === 'none'}
                value={action.easing}
                onChange={(event) => updateAction({
                  ...action,
                  easing: event.currentTarget.value as MotionEasing,
                })}
              >
                {MOTION_EASINGS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="property-hint">
            动画由当前规则的事件触发；延迟只相对该事件或上一动作组，不按场景绝对时间计时。
          </p>
          <button
            type="button"
            className="secondary-button"
            aria-label={`预览动作 ${actionIndex + 1}`}
            onClick={() => requestNodeMotionPreview(action, step.delayMs)}
          >
            <Play size={13} />预览此动作
          </button>
        </>
      ) : null}

      {action.type === 'presentation.set' ? (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-state`}>目标状态</label>
            <select
              id={`${idPrefix}-state`}
              className="form-input"
              value={action.stateId}
              onChange={(event) => updateAction({
                ...action,
                stateId: event.currentTarget.value,
              })}
            >
              {missingOption(action.stateId, stateIds, action.stateId)}
              {states.map((state) => (
                <option key={state.id} value={state.id}>{state.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-duration`}>过渡时长（毫秒）</label>
            <input
              id={`${idPrefix}-duration`}
              className="form-input"
              type="number"
              min={0}
              max={10_000}
              step={10}
              value={action.transition?.duration ?? 0}
              onChange={(event) => {
                const duration = Math.min(
                  10_000,
                  Math.max(0, event.currentTarget.valueAsNumber || 0),
                )
                updateAction({
                  ...action,
                  transition: duration > 0
                    ? { ...action.transition, duration }
                    : undefined,
                })
              }}
            />
          </div>
        </>
      ) : null}

      {action.type === 'course-state.set' ? (() => {
        const declaration = courseState.find((item) => item.key === action.key)
          ?? courseState[0]
        const keys = new Set(courseState.map((item) => item.key))
        if (!declaration) return null
        return (
          <>
            <div className="form-field">
              <label htmlFor={`${idPrefix}-course-state-key`}>课程状态键</label>
              <select
                id={`${idPrefix}-course-state-key`}
                className="form-input"
                value={action.key}
                onChange={(event) => {
                  const next = courseState.find((item) => item.key === event.currentTarget.value)
                  if (next) updateAction({
                    type: 'course-state.set',
                    key: next.key,
                    value: next.defaultValue,
                  })
                }}
              >
                {missingOption(action.key, keys, action.key)}
                {courseState.map((item) => (
                  <option key={item.key} value={item.key}>{item.key}</option>
                ))}
              </select>
            </div>
            <CourseStateValueField
              id={`${idPrefix}-course-state-value`}
              label="目标值"
              declaration={declaration}
              value={action.value}
              onChange={(value) => updateAction({ ...action, value })}
            />
          </>
        )
      })() : null}

      {action.type === 'scene.go' ? (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-scene`}>目标场景</label>
            <select
              id={`${idPrefix}-scene`}
              className="form-input"
              value={action.sceneId}
              onChange={(event) => updateAction({
                type: 'scene.go',
                sceneId: event.currentTarget.value,
              })}
            >
              {missingOption(action.sceneId, sceneIds, action.sceneId)}
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{scene.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-target-state`}>进入状态</label>
            <select
              id={`${idPrefix}-target-state`}
              className="form-input"
              value={action.targetStateId ?? ''}
              onChange={(event) => {
                const targetStateId = event.currentTarget.value
                updateAction(targetStateId
                  ? { ...action, targetStateId }
                  : { type: 'scene.go', sceneId: action.sceneId })
              }}
            >
              <option value="">场景初始状态</option>
              {action.targetStateId
                ? missingOption(
                    action.targetStateId,
                    targetStateIds,
                    action.targetStateId,
                  )
                : null}
              {targetStates.map((state) => (
                <option key={state.id} value={state.id}>{state.name}</option>
              ))}
            </select>
          </div>
        </>
      ) : null}

      {action.type === 'audio.play' ? (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-sound`}>声音</label>
          <select
            id={`${idPrefix}-sound`}
            className="form-input"
            value={action.soundId}
            onChange={(event) => updateAction({
              ...action,
              soundId: event.currentTarget.value,
            })}
          >
            {missingOption(action.soundId, soundIds, action.soundId)}
            {sounds.map((sound) => (
              <option key={sound.id} value={sound.id}>{sound.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {(
        action.type === 'audio.pause' ||
        action.type === 'audio.resume' ||
        action.type === 'audio.stop' ||
        action.type === 'audio.toggle-mute'
      ) ? (
        <AudioTargetFields
          idPrefix={idPrefix}
          target={action.target}
          sounds={sounds}
          update={(target) => updateAction({ ...action, target })}
        />
      ) : null}

      {action.type.startsWith('video.') ? (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-video`}>目标视频</label>
            <select
              id={`${idPrefix}-video`}
              className="form-input"
              value={'nodeId' in action ? action.nodeId : ''}
              onChange={(event) => {
                if ('nodeId' in action) {
                  updateAction({ ...action, nodeId: event.currentTarget.value })
                }
              }}
            >
              {'nodeId' in action
                ? missingOption(action.nodeId, videoIds, action.nodeId)
                : null}
              {videos.map((video) => (
                <option key={video.id} value={video.id}>{video.name}</option>
              ))}
            </select>
          </div>
          {action.type === 'video.seek' ? (
            <div className="form-field">
              <label htmlFor={`${idPrefix}-seconds`}>目标时间（秒）</label>
              <input
                id={`${idPrefix}-seconds`}
                className="form-input"
                type="number"
                min={0}
                max={604_800}
                step={0.1}
                value={action.seconds}
                onChange={(event) => updateAction({
                  ...action,
                  seconds: Math.max(0, event.currentTarget.valueAsNumber || 0),
                })}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className="secondary-button secondary-button--danger"
        disabled={rule.actions.length <= 1 || referencedByCompletion}
        title={referencedByCompletion
          ? '该动作正被“动画完成”规则引用，请先更改触发器。'
          : undefined}
        aria-label={`删除动作 ${actionIndex + 1}`}
        onClick={onRemove}
      >
        <Trash2 size={13} />删除动作
      </button>
    </fieldset>
  )
}

export function InteractionEditor({
  scene,
  selectedNode,
  sourceScope = 'scene',
  sourceNodes,
  sourceRules,
  activeStateId,
  scenes,
  sounds,
  courseState = [],
  onAddRule,
  onUpdateRule,
  onDeleteRule,
}: InteractionEditorProps) {
  const availableNodes = sourceNodes ?? scene.nodes ?? []
  const allRules = sourceRules ?? scene.interactions ?? []
  const completionActionIds = useMemo(() => new Set(
    allRules.flatMap((rule) => rule.trigger.type === 'animation.completed'
      ? [rule.trigger.actionId]
      : []),
  ), [allRules])
  const states = useMemo(
    () => presentationStates(scene),
    [scene],
  )
  const videoNodes = useMemo(
    () => availableNodes.filter((node) => node.type === 'video'),
    [availableNodes],
  )
  const soundList = useMemo(
    () => Object.values(sounds).sort((left, right) => (
      left.name.localeCompare(right.name, 'zh-CN')
    )),
    [sounds],
  )
  const rules = allRules.filter(
    (rule) => rule.trigger.type === 'node.click' &&
      rule.trigger.nodeId === selectedNode.id,
  )
  const isVideoNode = selectedNode.type === 'video'
  const videoOwnsClick = isVideoNode && (
    selectedNode.clickToToggle || selectedNode.showControls
  )
  const suggestedTargetId = states.find((state) => state.id !== activeStateId)?.id ??
    states[0]?.id ?? ''
  const [quickTargetId, setQuickTargetId] = useState(suggestedTargetId)

  useEffect(() => {
    if (!states.some((state) => state.id === quickTargetId)) {
      setQuickTargetId(suggestedTargetId)
    }
  }, [quickTargetId, states, suggestedTargetId])

  const targets = {
    stateId: states[0]?.id,
    sceneId: scenes[0]?.id,
    soundId: soundList[0]?.id,
    videoId: videoNodes[0]?.id,
    nodeId: availableNodes[0]?.id,
    courseState: courseState[0],
  }

  const addQuickStateRule = () => {
    const target = states.find((state) => state.id === quickTargetId)
    if (!target) return
    onAddRule({
      id: `interaction_${nanoid()}`,
      name: `${selectedNode.name} → ${target.name}`,
      enabled: true,
      trigger: { type: 'node.click', nodeId: selectedNode.id },
      conditions: activeStateId
        ? [
            ...(sourceScope === 'global'
              ? [{ type: 'scene.in' as const, sceneIds: [scene.id] }]
              : []),
            { type: 'presentation.in', stateIds: [activeStateId] },
          ]
        : sourceScope === 'global'
          ? [{ type: 'scene.in', sceneIds: [scene.id] }]
          : [],
      actions: [createActionStep({
        type: 'presentation.set',
        stateId: target.id,
        transition: { duration: 240 },
      })],
    })
  }

  return (
    <section className="property-section" aria-labelledby="interaction-editor-title">
      <h3 className="property-title" id="interaction-editor-title">
        <MousePointerClick size={14} />交互
      </h3>
      <p className="property-hint">
        {isVideoNode
          ? '视频表面点击默认只用于播放控制。状态、声音和场景变化请在专业模式的“互动与动画”中使用视频开始、暂停、结束或时间点触发。'
          : `为“${selectedNode.name}”配置单击后按顺序执行的动作。`}
      </p>

      {!isVideoNode ? (
        <>
          <div className="form-field">
            <label htmlFor={`interaction-${selectedNode.id}-quick-target`}>快捷连接目标状态</label>
            <select
              id={`interaction-${selectedNode.id}-quick-target`}
              className="form-input"
              value={quickTargetId}
              disabled={states.length === 0}
              onChange={(event) => setQuickTargetId(event.currentTarget.value)}
            >
              {states.map((state) => (
                <option key={state.id} value={state.id}>{state.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="secondary-button"
            style={{ width: '100%', marginBottom: 12 }}
            disabled={!quickTargetId}
            onClick={addQuickStateRule}
          >
            <Link2 size={14} />连接到状态
          </button>
        </>
      ) : (
        <p className="property-hint" data-testid="video-click-policy">
          如需点击视频区域进行导航，请在视频上方放置一个独立按钮或透明图形热点，使播放与导航拥有明确的不同元素。
        </p>
      )}

      {isVideoNode && rules.length > 0 ? (
        <p className="property-hint" role={videoOwnsClick ? 'alert' : 'status'}>
          {videoOwnsClick
            ? '该视频包含旧版点击规则，但播放点击或画布控件正在占用视频表面，规则不会接收点击。请删除规则并改用视频事件规则或独立热点。'
            : '以下是旧工程保留的视频点击规则。视频关闭播放点击和画布控件时仍可兼容执行，但新工程不再创建此类规则。'}
        </p>
      ) : null}

      {rules.length === 0 ? (
        <p className="property-hint" role="status">
          {isVideoNode ? '该视频没有旧版点击规则。' : '该元素尚未配置单击交互。'}
        </p>
      ) : null}

      {rules.map((rule, ruleIndex) => {
        const scope = stateScope(rule)
        const activeSceneScope = sceneScope(rule)
        return (
          <fieldset
            key={rule.id}
            aria-label={`单击规则 ${ruleIndex + 1}`}
            style={{ border: '1px solid var(--border-color, #cbd5e1)', borderRadius: 10, padding: 10, margin: '0 0 12px' }}
          >
            <legend>{rule.name || `单击规则 ${ruleIndex + 1}`}</legend>
            <div className="toggle-row">
              <label htmlFor={`interaction-${rule.id}-enabled`}>启用规则</label>
              <input
                id={`interaction-${rule.id}-enabled`}
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => onUpdateRule(rule.id, {
                  enabled: event.currentTarget.checked,
                })}
              />
            </div>
            {sourceScope === 'global' ? (
              <div className="form-field">
                <label htmlFor={`interaction-${rule.id}-scene-scope`}>生效场景</label>
                <select
                  id={`interaction-${rule.id}-scene-scope`}
                  className="form-input"
                  value={activeSceneScope}
                  onChange={(event) => onUpdateRule(rule.id, {
                    conditions: setRuleSceneScope(rule, event.currentTarget.value),
                  })}
                >
                  <option value={ALL_SCENES}>所有场景</option>
                  {activeSceneScope === MULTIPLE_SCENES ? (
                    <option value={MULTIPLE_SCENES} disabled>多个场景（请重新选择）</option>
                  ) : null}
                  {scenes.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="form-field">
              <label htmlFor={`interaction-${rule.id}-scope`}>作用范围</label>
              <select
                id={`interaction-${rule.id}-scope`}
                className="form-input"
                value={scope}
                onChange={(event) => onUpdateRule(rule.id, {
                  conditions: setRuleStateScope(rule, event.currentTarget.value),
                })}
              >
                <option value={ALL_STATES}>所有状态</option>
                {scope === MULTIPLE_STATES ? (
                  <option value={MULTIPLE_STATES} disabled>多个状态（请重新选择）</option>
                ) : null}
                {states.map((state) => (
                  <option key={state.id} value={state.id}>{state.name}</option>
                ))}
              </select>
            </div>

            <CourseStateConditionsEditor
              rule={rule}
              declarations={courseState}
              onChange={(conditions) => onUpdateRule(rule.id, { conditions })}
            />

            {rule.actions.map((step, actionIndex) => (
              <ActionEditor
                key={step.id}
                rule={rule}
                step={step}
                actionIndex={actionIndex}
                states={states}
                scenes={scenes}
                sounds={soundList}
                videos={videoNodes}
                nodes={availableNodes}
                courseState={courseState}
                referencedByCompletion={completionActionIds.has(step.id)}
                onChange={(nextStep) => onUpdateRule(rule.id, {
                  actions: rule.actions.map((item, index) => (
                    index === actionIndex ? nextStep : item
                  )),
                })}
                onRemove={() => onUpdateRule(rule.id, {
                  actions: rule.actions.filter((_, index) => index !== actionIndex),
                })}
              />
            ))}

            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                aria-label={`为规则 ${ruleIndex + 1} 添加动作`}
                onClick={() => {
                  const nextStep = createActionStep(
                    defaultAction('presentation.set', targets),
                  )
                  const terminalIndex = rule.actions.findIndex(isTerminalActionStep)
                  const actions = [...rule.actions]
                  actions.splice(
                    terminalIndex >= 0 ? terminalIndex : actions.length,
                    0,
                    nextStep,
                  )
                  onUpdateRule(rule.id, { actions })
                }}
              >
                <Plus size={13} />添加动作
              </button>
              <button
                type="button"
                className="secondary-button secondary-button--danger"
                aria-label={`删除单击规则 ${ruleIndex + 1}`}
                disabled={rule.actions.some((step) => completionActionIds.has(step.id))}
                title={rule.actions.some((step) => completionActionIds.has(step.id))
                  ? '该规则的动画正被“动画完成”规则引用，请先更改触发器。'
                  : undefined}
                onClick={() => onDeleteRule(rule.id)}
              >
                <Trash2 size={13} />删除规则
              </button>
            </div>
          </fieldset>
        )
      })}
    </section>
  )
}

export interface SceneAutomationEditorProps extends Omit<
  InteractionEditorProps,
  'selectedNode'
> {
  /** Carrier-derived states; an explicit empty list prevents synthetic scenes from inventing states. */
  authoringStates?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Canonical Slide scene used for global scene.in; null on Flow/Spatial. */
  conditionSceneId?: string | null
  /** Stable, carrier-owned and unlocked candidates for the atomic reveal template. */
  revealTemplateTargetNodeIds?: readonly string[]
  /** Whether legacy callbacks can persist generic create/delete/copy/order operations. */
  legacyRuleActionsAvailable?: boolean
  /** Visible explanation shown when legacy rule actions are unavailable. */
  legacyRuleActionsUnavailableReason?: string
  onApplyRevealSequenceTemplate(intent: RevealSequenceTemplateIntent): void
}

export function SceneAutomationEditor({
  scene,
  sourceScope = 'scene',
  sourceNodes,
  sourceRules,
  selectedNodeId = null,
  activeStateId,
  authoringStates,
  scenes,
  sounds,
  courseState = [],
  ruleWarnings,
  onOpenClickRules,
  onRunPreview,
  conditionSceneId,
  revealTemplateTargetNodeIds,
  legacyRuleActionsAvailable = true,
  legacyRuleActionsUnavailableReason = '当前载体暂不支持普通规则的新建、删除、复制或排序。',
  onApplyRevealSequenceTemplate,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onDuplicateRule,
  onMoveRule,
}: SceneAutomationEditorProps) {
  const availableNodes = sourceNodes ?? scene.nodes ?? []
  const allRules = sourceRules ?? scene.interactions ?? []
  const completionActionIds = useMemo(() => new Set(
    allRules.flatMap((rule) => rule.trigger.type === 'animation.completed'
      ? [rule.trigger.actionId]
      : []),
  ), [allRules])
  const states = useMemo(
    () => (authoringStates ?? presentationStates(scene)),
    [authoringStates, scene],
  )
  const videoNodes = useMemo(
    () => availableNodes.filter((node) => node.type === 'video'),
    [availableNodes],
  )
  const componentNodes = useMemo(
    () => availableNodes.filter((node) => node.type === 'external-component'),
    [availableNodes],
  )
  const animationSteps = useMemo<AnimationStepOption[]>(() => {
    const nodeNames = new Map(availableNodes.map((node) => [node.id, node.name]))
    return allRules.flatMap((rule) =>
      rule.actions.flatMap((step) => isNodeMotionAction(step.action)
        ? [{
            id: step.id,
            label: `${rule.name || rule.id} · ${
              nodeNames.get(step.action.nodeId) ?? step.action.nodeId
            } · ${step.action.type === 'node.enter' ? '入场' : '退场'}`,
          }]
        : []),
    )
  }, [allRules, availableNodes])
  const soundList = useMemo(
    () => Object.values(sounds).sort((left, right) => (
      left.name.localeCompare(right.name, 'zh-CN')
    )),
    [sounds],
  )
  const rules = allRules.filter(isAutomationRule)
  const suggestedStateId = states.find((state) => state.id !== activeStateId)?.id ??
    states[0]?.id ?? ''
  const visibleMotionNodes = useMemo(() => {
    const allowed = revealTemplateTargetNodeIds
      ? new Set(revealTemplateTargetNodeIds)
      : null
    return availableNodes
      .filter((node) => node.visible && (!allowed || allowed.has(node.id)))
      .slice(0, 6)
  }, [availableNodes, revealTemplateTargetNodeIds])
  const descriptionContext = useMemo<RuleDescriptionContext>(() => ({
    nodes: new Map(availableNodes.map((node) => [node.id, node.name])),
    states: new Map(states.map((state) => [state.id, state.name])),
    scenes,
    sounds: new Map(soundList.map((sound) => [sound.id, sound.name])),
    animationSteps: new Map(animationSteps.map((step) => [step.id, step.label])),
    courseState: new Map(courseState.map((state) => [state.key, state])),
  }), [animationSteps, availableNodes, courseState, scenes, soundList, states])
  const [newTriggerType, setNewTriggerType] = useState<AutomationTriggerType>(
    'scene.enter',
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<RuleTemplateId>(
    'scene-enter-sequence',
  )
  const [ruleFilter, setRuleFilter] = useState<RuleListFilter>('all')
  const [ruleQuery, setRuleQuery] = useState('')
  const triggerTargets = {
    stateId: states[0]?.id,
    soundId: soundList[0]?.id,
    videoId: videoNodes[0]?.id,
    componentId: componentNodes[0]?.id,
    nodeId: availableNodes[0]?.id,
    actionId: animationSteps[0]?.id,
  }
  const actionTargets = {
    stateId: suggestedStateId,
    sceneId: scenes[0]?.id,
    soundId: soundList[0]?.id,
    videoId: videoNodes[0]?.id,
    nodeId: availableNodes[0]?.id,
    courseState: courseState[0],
  }
  const triggerCounts = {
    states: states.length,
    sounds: soundList.length,
    videos: videoNodes.length,
    components: componentNodes.length,
    nodes: availableNodes.length,
    animations: animationSteps.length,
  }
  const templateCounts = {
    nodes: visibleMotionNodes.length,
    sounds: soundList.length,
    videos: videoNodes.length,
    components: componentNodes.length,
    states: states.length,
    animations: animationSteps.length,
  }
  const selectedTriggerOption = AUTOMATION_TRIGGER_OPTIONS.find(
    (option) => option.value === newTriggerType,
  )!
  const selectedTemplateOption = RULE_TEMPLATE_OPTIONS.find(
    (option) => option.value === selectedTemplateId,
  )!
  const isTemplateUnavailable = (
    option: (typeof RULE_TEMPLATE_OPTIONS)[number],
  ): boolean => (
    ruleTemplateUnavailable(option, templateCounts) ||
    (!legacyRuleActionsAvailable && option.value !== 'scene-enter-sequence')
  )
  const ruleWarningsById = useMemo(() => new Map(rules.map((rule) => {
    const warnings = [...(ruleWarnings?.[rule.id] ?? [])]
    const navigationIndex = rule.actions.findIndex(isTerminalActionStep)
    if (navigationIndex >= 0 && navigationIndex < rule.actions.length - 1) {
      warnings.push('场景跳转、重播或重开会结束当前规则，必须放在最后一个独立动作组。')
    }
    for (const step of rule.actions) {
      if (!isNodeMotionAction(step.action) || step.action.type !== 'node.enter') continue
      const targetNodeId = step.action.nodeId
      const node = availableNodes.find((item) => item.id === targetNodeId)
      if (node && node.playbackInitialVisibility !== 'hidden') {
        warnings.push(
          `元素“${node.name}”尚未设置为播放前隐藏，入场动作触发前可能已经可见。`,
        )
      }
    }
    if (rule.trigger.type === 'animation.completed') {
      const completedActionId = rule.trigger.actionId
      if (rule.actions.some((step) => step.id === completedActionId)) {
        warnings.push('该规则正在等待自身动画完成，会形成无法启动的循环。')
      }
    }
    return [rule.id, [...new Set(warnings)]] as const
  })), [availableNodes, ruleWarnings, rules])
  const normalizedQuery = ruleQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredRules = rules.filter((rule) => {
    const warnings = ruleWarningsById.get(rule.id) ?? []
    if (ruleFilter === 'selected-node') {
      if (!selectedNodeId || !ruleReferencesNode(rule, selectedNodeId, allRules)) {
        return false
      }
    } else if (ruleFilter === 'enabled' && !rule.enabled) {
      return false
    } else if (ruleFilter === 'disabled' && rule.enabled) {
      return false
    } else if (ruleFilter === 'warnings' && warnings.length === 0) {
      return false
    }
    if (!normalizedQuery) return true
    const searchable = [
      rule.name,
      describeTrigger(rule.trigger, descriptionContext),
      describeConditions(rule, descriptionContext),
      describeActionSequence(rule.actions, descriptionContext),
    ].join(' ').toLocaleLowerCase('zh-CN')
    return searchable.includes(normalizedQuery)
  })

  useEffect(() => {
    if (ruleFilter === 'selected-node' && !selectedNodeId) setRuleFilter('all')
  }, [ruleFilter, selectedNodeId])

  useEffect(() => {
    if (!legacyRuleActionsAvailable && selectedTemplateId !== 'scene-enter-sequence') {
      setSelectedTemplateId('scene-enter-sequence')
      return
    }
    if (!isTemplateUnavailable(selectedTemplateOption)) return
    const fallback = RULE_TEMPLATE_OPTIONS.find(
      (option) => !isTemplateUnavailable(option),
    )
    if (fallback) setSelectedTemplateId(fallback.value)
  }, [
    legacyRuleActionsAvailable,
    selectedTemplateOption,
    selectedTemplateId,
    templateCounts.animations,
    templateCounts.components,
    templateCounts.nodes,
    templateCounts.sounds,
    templateCounts.states,
    templateCounts.videos,
  ])

  const conditionSlideSceneId = conditionSceneId === undefined
    ? scene.id
    : conditionSceneId
  const defaultConditions = (): InteractionRule['conditions'] => (
    activeStateId
      ? [
          ...(sourceScope === 'global' && conditionSlideSceneId
            ? [{ type: 'scene.in' as const, sceneIds: [conditionSlideSceneId] }]
            : []),
          { type: 'presentation.in', stateIds: [activeStateId] },
        ]
      : sourceScope === 'global' && conditionSlideSceneId
        ? [{ type: 'scene.in', sceneIds: [conditionSlideSceneId] }]
        : []
  )

  const addAutomationRule = () => {
    if (
      !legacyRuleActionsAvailable ||
      automationTriggerUnavailable(selectedTriggerOption, triggerCounts)
    ) return
    const action = suggestedStateId
      ? defaultAction('presentation.set', actionTargets)
      : defaultAction('scene.next', actionTargets)
    onAddRule({
      id: `interaction_${nanoid()}`,
      name: `${automationTriggerLabel(newTriggerType)}规则`,
      enabled: true,
      trigger: defaultAutomationTrigger(newTriggerType, triggerTargets),
      conditions: defaultConditions(),
      actions: [createActionStep(action)],
    })
  }

  const addTemplateRule = () => {
    if (isTemplateUnavailable(selectedTemplateOption)) return
    const common = {
      id: `interaction_${nanoid()}`,
      enabled: true,
      conditions: defaultConditions(),
    }
    let nextRule: InteractionRule
    switch (selectedTemplateId) {
      case 'scene-enter-sequence': {
        const nodeIds = visibleMotionNodes.map((node) => node.id)
        onApplyRevealSequenceTemplate({
          ruleId: common.id,
          actionIds: nodeIds.map(() => `action_${nanoid()}`),
          targetLayerItemIds: nodeIds,
          name: '进入场景后依次出现',
        })
        return
      }
      case 'audio-ended-next':
        nextRule = {
          ...common,
          name: '声音结束后进入下一场景',
          trigger: { type: 'audio.ended', soundId: soundList[0]!.id },
          actions: [createActionStep({ type: 'scene.next' })],
        }
        break
      case 'video-ended-next':
        nextRule = {
          ...common,
          name: '视频结束后进入下一场景',
          trigger: { type: 'video.ended', nodeId: videoNodes[0]!.id },
          actions: [createActionStep({ type: 'scene.next' })],
        }
        break
      case 'component-event-state':
        nextRule = {
          ...common,
          name: '组件完成后切换状态',
          trigger: {
            type: 'component.event',
            nodeId: componentNodes[0]!.id,
            eventName: 'complete',
          },
          actions: [createActionStep({
            type: 'presentation.set',
            stateId: suggestedStateId,
            transition: { duration: 240 },
          })],
        }
        break
      case 'animation-ended-next':
        nextRule = {
          ...common,
          name: '动画完成后进入下一场景',
          trigger: {
            type: 'animation.completed',
            actionId: animationSteps[0]!.id,
          },
          actions: [createActionStep({ type: 'scene.next' })],
        }
        break
    }
    onAddRule(nextRule)
  }

  return (
    <section
      className="property-section interaction-workbench"
      aria-labelledby={`${sourceScope}-automation-title`}
    >
      <div className="interaction-workbench__heading">
        <h3 className="property-title" id={`${sourceScope}-automation-title`}>
          <Workflow size={14} />{sourceScope === 'global' ? '全局规则' : '场景规则'}
        </h3>
        {onRunPreview ? (
          <button
            type="button"
            className="secondary-button interaction-workbench__preview"
            onClick={onRunPreview}
          >
            <Play size={13} />当前位置试运行
          </button>
        ) : null}
      </div>
      <p className="property-hint">
        {sourceScope === 'global'
          ? '全局规则可跨场景工作，也可限制只在指定场景生效。'
          : '用于进入场景、音视频变化或其他非点击事件；普通元素点击仍在“属性”中设置。'}
      </p>
      <div className="rule-mechanism" aria-label="规则由触发、条件和动作组成">
        <span><strong>1 触发</strong><small>何时发生</small></span>
        <i aria-hidden="true">→</i>
        <span><strong>2 条件</strong><small>何时生效</small></span>
        <i aria-hidden="true">→</i>
        <span><strong>3 动作</strong><small>执行什么</small></span>
      </div>

      {!legacyRuleActionsAvailable ? (
        <p
          className="property-hint"
          role="status"
          data-testid="legacy-rule-actions-unavailable"
        >
          {legacyRuleActionsUnavailableReason}
        </p>
      ) : null}

      <div className="interaction-template-panel" aria-labelledby="rule-template-title">
        <div>
          <h4 id="rule-template-title">从常用模板开始</h4>
          <p>先生成可运行的规则，再按需要调整触发、条件和动作。</p>
        </div>
        <div className="form-field">
          <label htmlFor={`automation-${scene.id}-template`}>常用规则模板</label>
          <select
            id={`automation-${scene.id}-template`}
            className="form-input"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(
              event.currentTarget.value as RuleTemplateId,
            )}
          >
            {RULE_TEMPLATE_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={isTemplateUnavailable(option)}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <p className="interaction-template-panel__description">
          {selectedTemplateOption.description}
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={isTemplateUnavailable(selectedTemplateOption)}
          title={!legacyRuleActionsAvailable && selectedTemplateId !== 'scene-enter-sequence'
            ? legacyRuleActionsUnavailableReason
            : undefined}
          onClick={addTemplateRule}
        >
          <Plus size={14} />使用模板
        </button>
        {selectedNodeId && onOpenClickRules ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenClickRules}
          >
            <MousePointerClick size={14} />设置选中元素的点击动作
          </button>
        ) : null}
      </div>

      <div className="interaction-custom-rule">
        <h4>从触发时机创建</h4>
        <div className="form-field">
          <label htmlFor={`automation-${scene.id}-new-trigger`}>新规则的触发时机</label>
          <select
            id={`automation-${scene.id}-new-trigger`}
            className="form-input"
            value={newTriggerType}
            disabled={!legacyRuleActionsAvailable}
            title={!legacyRuleActionsAvailable
              ? legacyRuleActionsUnavailableReason
              : undefined}
            onChange={(event) => setNewTriggerType(
              event.currentTarget.value as AutomationTriggerType,
            )}
          >
            {AUTOMATION_TRIGGER_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={automationTriggerUnavailable(option, triggerCounts)}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={
            !legacyRuleActionsAvailable ||
            automationTriggerUnavailable(selectedTriggerOption, triggerCounts)
          }
          title={!legacyRuleActionsAvailable
            ? legacyRuleActionsUnavailableReason
            : undefined}
          onClick={addAutomationRule}
        >
          <Plus size={14} />添加规则
        </button>
      </div>

      <div className="interaction-rule-list-heading">
        <div>
          <h4>规则列表</h4>
          <p>{rules.length} 条非点击规则；点击规则只在“属性”中维护。</p>
        </div>
        <span>{filteredRules.length} 条可见</span>
      </div>
      <div className="interaction-rule-filters">
        <div className="form-field">
          <label htmlFor={`automation-${scene.id}-query`}>搜索规则</label>
          <input
            id={`automation-${scene.id}-query`}
            className="form-input"
            type="search"
            placeholder="名称、触发、条件或动作"
            value={ruleQuery}
            onChange={(event) => setRuleQuery(event.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`automation-${scene.id}-filter`}>规则筛选</label>
          <select
            id={`automation-${scene.id}-filter`}
            className="form-input"
            value={ruleFilter}
            onChange={(event) => setRuleFilter(
              event.currentTarget.value as RuleListFilter,
            )}
          >
            <option value="all">全部规则</option>
            <option value="selected-node" disabled={!selectedNodeId}>
              仅看选中元素相关
            </option>
            <option value="enabled">仅看已启用</option>
            <option value="disabled">仅看已停用</option>
            <option value="warnings">仅看有冲突</option>
          </select>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="property-hint" role="status">
          {sourceScope === 'global' ? '尚未配置全局规则。' : '当前场景尚未配置专业规则。'}
        </p>
      ) : null}

      {rules.length > 0 && filteredRules.length === 0 ? (
        <p className="property-hint" role="status">
          当前筛选下没有规则，请清除搜索词或切换筛选条件。
        </p>
      ) : null}

      {filteredRules.length > 1 ? (
        <nav className="interaction-rule-index" aria-label="规则快速定位">
          {filteredRules.map((rule) => (
            <button
              key={rule.id}
              type="button"
              onClick={() => {
                document.getElementById(`automation-rule-${rule.id}`)
                  ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
              }}
            >
              <strong>{rule.name || '未命名规则'}</strong>
              <small>{describeTrigger(rule.trigger, descriptionContext)}</small>
            </button>
          ))}
        </nav>
      ) : null}

      {filteredRules.map((rule) => {
        const ruleIndex = rules.findIndex((item) => item.id === rule.id)
        const scope = stateScope(rule)
        const activeSceneScope = sceneScope(rule)
        const warnings = ruleWarningsById.get(rule.id) ?? []
        return (
          <fieldset
            key={rule.id}
            id={`automation-rule-${rule.id}`}
            className={`interaction-rule-card${
              rule.enabled ? '' : ' interaction-rule-card--disabled'
            }${warnings.length > 0 ? ' interaction-rule-card--warning' : ''}`}
            aria-label={`规则 ${ruleIndex + 1}`}
          >
            <legend>{rule.name || `规则 ${ruleIndex + 1}`}</legend>
            <div
              className="interaction-rule-summary"
              data-testid={`rule-summary-${rule.id}`}
            >
              <div><strong>当</strong><span>{describeTrigger(rule.trigger, descriptionContext)}</span></div>
              <div><strong>如果</strong><span>{describeConditions(rule, descriptionContext)}</span></div>
              <div><strong>就</strong><span>{describeActionSequence(rule.actions, descriptionContext)}</span></div>
            </div>
            {warnings.length > 0 ? (
              <div className="interaction-rule-warnings" role="alert">
                <strong>需要检查</strong>
                {warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}
            <div className="form-field">
              <label htmlFor={`automation-${rule.id}-name`}>规则名称</label>
              <input
                id={`automation-${rule.id}-name`}
                className="form-input"
                maxLength={120}
                value={rule.name ?? ''}
                onChange={(event) => onUpdateRule(rule.id, {
                  name: event.currentTarget.value,
                })}
              />
            </div>
            <div className="toggle-row">
              <label htmlFor={`automation-${rule.id}-enabled`}>启用规则</label>
              <input
                id={`automation-${rule.id}-enabled`}
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => onUpdateRule(rule.id, {
                  enabled: event.currentTarget.checked,
                })}
              />
            </div>

            <details className="interaction-rule-details" open>
              <summary>详细编辑：触发、条件与动作</summary>
              <AutomationTriggerEditor
                rule={rule}
                states={states}
                sounds={soundList}
                videos={videoNodes}
                components={componentNodes}
                nodes={availableNodes}
                animationSteps={animationSteps}
                onChange={(trigger) => onUpdateRule(rule.id, { trigger })}
              />

              {sourceScope === 'global' ? (
                <div className="form-field">
                  <label htmlFor={`automation-${rule.id}-scene-scope`}>生效场景</label>
                  <select
                    id={`automation-${rule.id}-scene-scope`}
                    className="form-input"
                    value={activeSceneScope}
                    onChange={(event) => onUpdateRule(rule.id, {
                      conditions: setRuleSceneScope(rule, event.currentTarget.value),
                    })}
                  >
                    <option value={ALL_SCENES}>所有场景</option>
                    {activeSceneScope === MULTIPLE_SCENES ? (
                      <option value={MULTIPLE_SCENES} disabled>多个场景（请重新选择）</option>
                    ) : null}
                    {scenes.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="form-field">
                <label htmlFor={`automation-${rule.id}-scope`}>作用范围</label>
                <select
                  id={`automation-${rule.id}-scope`}
                  className="form-input"
                  value={scope}
                  onChange={(event) => onUpdateRule(rule.id, {
                    conditions: setRuleStateScope(rule, event.currentTarget.value),
                  })}
                >
                  <option value={ALL_STATES}>所有状态</option>
                  {scope === MULTIPLE_STATES ? (
                    <option value={MULTIPLE_STATES} disabled>多个状态（请重新选择）</option>
                  ) : null}
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>{state.name}</option>
                  ))}
                </select>
              </div>

              <CourseStateConditionsEditor
                rule={rule}
                declarations={courseState}
                onChange={(conditions) => onUpdateRule(rule.id, { conditions })}
              />

              <ol className="interaction-action-sequence" aria-label="动作执行顺序">
                {rule.actions.map((step, actionIndex) => (
                  <li key={step.id}>
                    <span>{actionSequenceLead(step, actionIndex)}</span>
                    <p>{describeAction(step.action, descriptionContext)}</p>
                  </li>
                ))}
              </ol>

              {rule.actions.map((step, actionIndex) => (
                <ActionEditor
                  key={step.id}
                  rule={rule}
                  step={step}
                  actionIndex={actionIndex}
                  states={states}
                  scenes={scenes}
                  sounds={soundList}
                  videos={videoNodes}
                  nodes={availableNodes}
                  courseState={courseState}
                  referencedByCompletion={completionActionIds.has(step.id)}
                  onChange={(nextStep) => onUpdateRule(rule.id, {
                    actions: rule.actions.map((item, index) => (
                      index === actionIndex ? nextStep : item
                    )),
                  })}
                  onRemove={() => onUpdateRule(rule.id, {
                    actions: rule.actions.filter((_, index) => index !== actionIndex),
                  })}
                />
              ))}

              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`为规则 ${ruleIndex + 1} 添加动作`}
                  onClick={() => {
                    const nextStep = createActionStep(
                      defaultAction('presentation.set', actionTargets),
                    )
                    const terminalIndex = rule.actions.findIndex(isTerminalActionStep)
                    const actions = [...rule.actions]
                    actions.splice(
                      terminalIndex >= 0 ? terminalIndex : actions.length,
                      0,
                      nextStep,
                    )
                    onUpdateRule(rule.id, { actions })
                  }}
                >
                  <Plus size={13} />添加动作
                </button>
                {onDuplicateRule ? (
                  <button
                    type="button"
                    className="secondary-button"
                    aria-label={`复制规则 ${ruleIndex + 1}`}
                    disabled={!legacyRuleActionsAvailable}
                    title={!legacyRuleActionsAvailable
                      ? legacyRuleActionsUnavailableReason
                      : undefined}
                    onClick={() => onDuplicateRule(rule.id)}
                  >
                    <Copy size={13} />复制规则
                  </button>
                ) : null}
                {onMoveRule ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`上移规则 ${ruleIndex + 1}`}
                      disabled={!legacyRuleActionsAvailable || ruleIndex <= 0}
                      title={!legacyRuleActionsAvailable
                        ? legacyRuleActionsUnavailableReason
                        : undefined}
                      onClick={() => onMoveRule(rule.id, -1)}
                    >
                      <ArrowUp size={13} />上移
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`下移规则 ${ruleIndex + 1}`}
                      disabled={
                        !legacyRuleActionsAvailable ||
                        ruleIndex >= rules.length - 1
                      }
                      title={!legacyRuleActionsAvailable
                        ? legacyRuleActionsUnavailableReason
                        : undefined}
                      onClick={() => onMoveRule(rule.id, 1)}
                    >
                      <ArrowDown size={13} />下移
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="secondary-button secondary-button--danger"
                  aria-label={`删除规则 ${ruleIndex + 1}`}
                  disabled={
                    !legacyRuleActionsAvailable ||
                    rule.actions.some((step) => completionActionIds.has(step.id))
                  }
                  title={!legacyRuleActionsAvailable
                    ? legacyRuleActionsUnavailableReason
                    : rule.actions.some((step) => completionActionIds.has(step.id))
                      ? '该规则的动画正被“动画完成”规则引用，请先更改触发器。'
                      : undefined}
                  onClick={() => onDeleteRule(rule.id)}
                >
                  <Trash2 size={13} />删除规则
                </button>
              </div>
            </details>
          </fieldset>
        )
      })}
    </section>
  )
}
