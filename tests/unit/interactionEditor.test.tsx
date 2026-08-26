import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  InteractionAction,
  InteractionActionStep,
  InteractionRule,
  InteractionTrigger,
} from '@/shared/interactionTypes'
import type {
  ExternalComponentNode,
  SceneDocument,
  SceneNode,
  ShapeNode,
  SoundDefinition,
  VideoNode,
} from '@/shared/projectTypes'
import {
  InteractionEditor,
  SceneAutomationEditor,
} from '@/renderer/ui/InteractionEditor'

const previewMotion = vi.hoisted(() => vi.fn())

vi.mock('@/renderer/phaser/elementAnimationPreviewBus', () => ({
  requestNodeMotionPreview: previewMotion,
}))

afterEach(() => {
  cleanup()
  previewMotion.mockReset()
})

const button: ShapeNode = {
  id: 'button',
  name: '确认按钮',
  type: 'shape',
  x: 100,
  y: 100,
  width: 220,
  height: 80,
  rotation: 0,
  opacity: 1,
  visible: true,
  playbackInitialVisibility: 'inherit',
  locked: false,
  shapeType: 'rounded-rectangle',
  style: {
    fillColor: '#2563eb',
    fillOpacity: 1,
    borderColor: '#ffffff',
    borderOpacity: 1,
    borderWidth: 2,
    lineStyle: 'solid',
    cornerRadius: 16,
    startArrow: 'none',
    endArrow: 'none',
  },
}

const video: VideoNode = {
  id: 'video_demo',
  name: '讲解视频',
  type: 'video',
  x: 400,
  y: 100,
  width: 640,
  height: 360,
  rotation: 0,
  opacity: 1,
  visible: true,
  playbackInitialVisibility: 'inherit',
  locked: false,
  assetId: 'asset_video',
  fit: 'contain',
  autoplay: false,
  loop: false,
  muted: false,
  volume: 1,
  playbackRate: 1,
  showControls: true,
  clickToToggle: true,
  startTime: 0,
  endTime: null,
  poster: { mode: 'video-frame', time: 0 },
  backgroundAudioMode: 'none',
}

const component: ExternalComponentNode = {
  id: 'quiz_component',
  name: '答题组件',
  type: 'external-component',
  x: 80,
  y: 400,
  width: 360,
  height: 180,
  rotation: 0,
  opacity: 1,
  visible: true,
  playbackInitialVisibility: 'inherit',
  locked: false,
  component: { packageId: 'com.example.quiz', version: '1.0.0' },
  props: {},
}

const sounds: Record<string, SoundDefinition> = {
  correct: {
    id: 'correct',
    name: '答对提示音',
    assetId: 'asset_correct',
    channel: 'sfx',
    defaultVolume: 1,
    defaultLoop: false,
  },
  click: {
    id: 'click',
    name: '按钮点击音',
    assetId: 'asset_click',
    channel: 'ui',
    defaultVolume: 0.8,
    defaultLoop: false,
  },
}

function actionStep(
  id: string,
  action: InteractionAction,
  start: InteractionActionStep['start'] = 'after-previous',
  delayMs = 0,
): InteractionActionStep {
  return { id, start, delayMs, action }
}

function clickRule(
  id: string,
  actions: InteractionAction[],
  conditions: InteractionRule['conditions'] = [],
): InteractionRule {
  return {
    id,
    name: id,
    enabled: true,
    trigger: { type: 'node.click', nodeId: button.id },
    conditions,
    actions: actions.map((action, index) => actionStep(
      `${id}-action-${index + 1}`,
      action,
    )),
  }
}

function automationRule(
  id: string,
  trigger: Exclude<InteractionTrigger, { type: 'node.click' }>,
  actions: InteractionAction[] = [{ type: 'scene.next' }],
  conditions: InteractionRule['conditions'] = [],
): InteractionRule {
  return {
    id,
    name: id,
    enabled: true,
    trigger,
    conditions,
    actions: actions.map((action, index) => actionStep(
      `${id}-action-${index + 1}`,
      action,
    )),
  }
}

function makeScene(interactions: InteractionRule[]): SceneDocument {
  return {
    id: 'scene_one',
    name: '答题页',
    backgroundColor: '#ffffff',
    backgroundAssetId: null,
    nodes: [button, video, component],
    presentation: {
      initialStateId: 'question',
      thumbnailStateId: 'question',
      states: [
        { id: 'question', name: '题目', nodeOverrides: {} },
        { id: 'feedback', name: '答对反馈', nodeOverrides: {} },
      ],
    },
    interactions,
  }
}

const projectScenes = [
  {
    id: 'scene_one',
    name: '答题页',
    presentation: {
      initialStateId: 'question',
      thumbnailStateId: 'question',
      states: [
        { id: 'question', name: '题目', nodeOverrides: {} },
        { id: 'feedback', name: '答对反馈', nodeOverrides: {} },
      ],
    },
  },
  {
    id: 'scene_two',
    name: '总结页',
    presentation: {
      initialStateId: 'summary',
      thumbnailStateId: 'summary',
      states: [
        { id: 'summary', name: '总结', nodeOverrides: {} },
        { id: 'complete', name: '完成', nodeOverrides: {} },
      ],
    },
  },
]

function renderEditor({
  scene = makeScene([]),
  selectedNode = button as SceneNode,
  activeStateId = 'question' as string | null,
  onAddRule = vi.fn(),
  onUpdateRule = vi.fn(),
  onDeleteRule = vi.fn(),
  onDuplicateRule = vi.fn(),
  onMoveRule = vi.fn(),
} = {}) {
  render(
    <InteractionEditor
      scene={scene}
      selectedNode={selectedNode}
      activeStateId={activeStateId}
      scenes={projectScenes}
      sounds={sounds}
      onAddRule={onAddRule}
      onUpdateRule={onUpdateRule}
      onDeleteRule={onDeleteRule}
      onDuplicateRule={onDuplicateRule}
      onMoveRule={onMoveRule}
    />,
  )
  return { onAddRule, onUpdateRule, onDeleteRule }
}

function renderAutomationEditor({
  scene = makeScene([]),
  activeStateId = 'question' as string | null,
  authoringStates = undefined as ReadonlyArray<{
    readonly id: string
    readonly name: string
  }> | undefined,
  selectedNodeId = null as string | null,
  ruleWarnings = {} as Record<string, string[]>,
  legacyRuleActionsAvailable = undefined as boolean | undefined,
  legacyRuleActionsUnavailableReason = undefined as string | undefined,
  onOpenClickRules = vi.fn(),
  onApplyRevealSequenceTemplate = vi.fn(),
  onRunPreview = vi.fn(),
  onAddRule = vi.fn(),
  onUpdateRule = vi.fn(),
  onDeleteRule = vi.fn(),
  onDuplicateRule = vi.fn(),
  onMoveRule = vi.fn(),
} = {}) {
  render(
    <SceneAutomationEditor
      scene={scene}
      activeStateId={activeStateId}
      authoringStates={authoringStates}
      selectedNodeId={selectedNodeId}
      scenes={projectScenes}
      sounds={sounds}
      ruleWarnings={ruleWarnings}
      onOpenClickRules={onOpenClickRules}
      onApplyRevealSequenceTemplate={onApplyRevealSequenceTemplate}
      legacyRuleActionsAvailable={legacyRuleActionsAvailable}
      legacyRuleActionsUnavailableReason={legacyRuleActionsUnavailableReason}
      onRunPreview={onRunPreview}
      onAddRule={onAddRule}
      onUpdateRule={onUpdateRule}
      onDeleteRule={onDeleteRule}
      onDuplicateRule={onDuplicateRule}
      onMoveRule={onMoveRule}
    />,
  )
  return {
    onAddRule,
    onUpdateRule,
    onDeleteRule,
    onDuplicateRule,
    onMoveRule,
    onOpenClickRules,
    onApplyRevealSequenceTemplate,
    onRunPreview,
  }
}

describe('InteractionEditor', () => {
  it('creates a quick click-to-state rule using the active-state scope', () => {
    const { onAddRule } = renderEditor()

    expect(screen.getByLabelText('快捷连接目标状态')).toHaveValue('feedback')
    fireEvent.click(screen.getByRole('button', { name: '连接到状态' }))

    expect(onAddRule).toHaveBeenCalledWith({
      id: expect.stringMatching(/^interaction_/),
      name: '确认按钮 → 答对反馈',
      enabled: true,
      trigger: { type: 'node.click', nodeId: 'button' },
      conditions: [{ type: 'presentation.in', stateIds: ['question'] }],
      actions: [{
        id: expect.stringMatching(/^action_/),
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'presentation.set',
          stateId: 'feedback',
          transition: { duration: 240 },
        },
      }],
    })
  })

  it('uses all states when quick-linking from the base scene', () => {
    const { onAddRule } = renderEditor({ activeStateId: null })

    fireEvent.click(screen.getByRole('button', { name: '连接到状态' }))
    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({
      conditions: [],
    }))
  })

  it('edits enabled state, scope, state target, and transition duration', () => {
    const rule = clickRule(
      'state-rule',
      [{
        type: 'presentation.set',
        stateId: 'feedback',
        transition: { duration: 180 },
      }],
      [{ type: 'presentation.in', stateIds: ['question'] }],
    )
    const { onUpdateRule } = renderEditor({ scene: makeScene([rule]) })
    const group = screen.getByRole('group', { name: '单击规则 1' })

    fireEvent.click(within(group).getByLabelText('启用规则'))
    expect(onUpdateRule).toHaveBeenCalledWith('state-rule', { enabled: false })

    fireEvent.change(within(group).getByLabelText('作用范围'), {
      target: { value: '__all_states__' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('state-rule', { conditions: [] })

    fireEvent.change(within(group).getByLabelText('目标状态'), {
      target: { value: 'question' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('state-rule', {
      actions: [{
        id: 'state-rule-action-1',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'presentation.set',
          stateId: 'question',
          transition: { duration: 180 },
        },
      }],
    })

    fireEvent.change(within(group).getByLabelText('过渡时长（毫秒）'), {
      target: { value: '360' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('state-rule', {
      actions: [{
        id: 'state-rule-action-1',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'presentation.set',
          stateId: 'feedback',
          transition: { duration: 360 },
        },
      }],
    })
  })

  it('edits scene, sound, and video targets through labelled controls', () => {
    const scene = makeScene([
      clickRule('scene-rule', [{ type: 'scene.go', sceneId: 'scene_two' }]),
      clickRule('sound-rule', [{ type: 'audio.play', soundId: 'correct' }]),
      clickRule('video-rule', [{
        type: 'video.seek',
        nodeId: 'video_demo',
        seconds: 5,
      }]),
    ])
    const { onUpdateRule } = renderEditor({ scene })
    const sceneGroup = screen.getByRole('group', { name: '单击规则 1' })
    const soundGroup = screen.getByRole('group', { name: '单击规则 2' })
    const videoGroup = screen.getByRole('group', { name: '单击规则 3' })

    fireEvent.change(within(sceneGroup).getByLabelText('目标场景'), {
      target: { value: 'scene_one' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('scene-rule', {
      actions: [actionStep(
        'scene-rule-action-1',
        { type: 'scene.go', sceneId: 'scene_one' },
      )],
    })

    fireEvent.change(within(sceneGroup).getByLabelText('进入状态'), {
      target: { value: 'complete' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('scene-rule', {
      actions: [actionStep('scene-rule-action-1', {
        type: 'scene.go', sceneId: 'scene_two', targetStateId: 'complete',
      })],
    })

    fireEvent.change(within(soundGroup).getByLabelText('声音'), {
      target: { value: 'click' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('sound-rule', {
      actions: [actionStep(
        'sound-rule-action-1',
        { type: 'audio.play', soundId: 'click' },
      )],
    })

    fireEvent.change(within(videoGroup).getByLabelText('目标时间（秒）'), {
      target: { value: '12.5' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('video-rule', {
      actions: [actionStep('video-rule-action-1', {
        type: 'video.seek', nodeId: 'video_demo', seconds: 12.5,
      })],
    })
  })

  it('edits event-relative motion timing, previews the action, and protects completion references', () => {
    const motionRule = clickRule('motion-rule', [
      { type: 'audio.play', soundId: 'click' },
      {
        type: 'node.enter',
        nodeId: button.id,
        effect: 'slide',
        direction: 'left',
        durationMs: 320,
        easing: 'ease-out',
      },
    ])
    motionRule.actions[1] = {
      ...motionRule.actions[1]!,
      start: 'with-previous',
      delayMs: 40,
    }
    const completionRule = automationRule(
      'after-motion',
      {
        type: 'animation.completed',
        actionId: 'motion-rule-action-2',
      },
      [{ type: 'scene.next' }],
    )
    const { onUpdateRule } = renderEditor({
      scene: makeScene([motionRule, completionRule]),
    })
    const ruleGroup = screen.getByRole('group', { name: '单击规则 1' })
    const motionGroup = within(ruleGroup).getByRole('group', { name: '动作 2' })

    expect(within(motionGroup).getByLabelText('开始方式'))
      .toHaveValue('with-previous')
    expect(within(motionGroup).getByLabelText('局部延迟（毫秒）')).toHaveValue(40)
    expect(within(motionGroup).getByLabelText('动作类型')).toHaveValue('node.enter')
    expect(within(motionGroup).getByLabelText('效果')).toHaveValue('slide')
    expect(within(motionGroup).getByLabelText('进入来源')).toHaveValue('left')
    expect(within(motionGroup).getByLabelText('动画时长（毫秒）')).toHaveValue(320)
    expect(within(motionGroup).getByLabelText('缓动')).toHaveValue('ease-out')

    fireEvent.change(within(motionGroup).getByLabelText('局部延迟（毫秒）'), {
      target: { value: '90' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('motion-rule', {
      actions: [
        motionRule.actions[0],
        { ...motionRule.actions[1], delayMs: 90 },
      ],
    })

    fireEvent.click(within(motionGroup).getByRole('button', {
      name: '预览动作 2',
    }))
    expect(previewMotion).toHaveBeenCalledWith(
      motionRule.actions[1]!.action,
      40,
    )
    expect(within(motionGroup).getByRole('button', { name: '删除动作 2' }))
      .toBeDisabled()
    expect(within(ruleGroup).getByRole('button', { name: '删除单击规则 1' }))
      .toBeDisabled()
    expect(within(motionGroup).getByRole('option', { name: '下一场景' }))
      .toBeDisabled()
  })

  it('inserts a new action before terminal navigation and deletes the rule', () => {
    const rule = clickRule('next-rule', [{ type: 'scene.next' }])
    const { onUpdateRule, onDeleteRule } = renderEditor({
      scene: makeScene([rule]),
    })
    const group = screen.getByRole('group', { name: '单击规则 1' })

    fireEvent.click(within(group).getByRole('button', {
      name: '为规则 1 添加动作',
    }))
    expect(onUpdateRule).toHaveBeenCalledWith('next-rule', {
      actions: [
        expect.objectContaining({
          id: expect.stringMatching(/^action_/),
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'presentation.set', stateId: 'question' },
        }),
        actionStep('next-rule-action-1', { type: 'scene.next' }),
      ],
    })

    fireEvent.click(within(group).getByRole('button', {
      name: '删除单击规则 1',
    }))
    expect(onDeleteRule).toHaveBeenCalledWith('next-rule')
  })

  it('shows only click rules belonging to the selected node', () => {
    const scene = makeScene([
      clickRule('visible-rule', [{ type: 'scene.next' }]),
      {
        ...clickRule('other-rule', [{ type: 'scene.previous' }]),
        trigger: { type: 'node.click', nodeId: 'another-node' },
      },
      {
        ...clickRule('scene-enter-rule', [{ type: 'scene.replay' }]),
        trigger: { type: 'scene.enter' },
      },
    ])
    renderEditor({ scene })

    expect(screen.getByRole('group', { name: '单击规则 1' })).toHaveTextContent(
      'visible-rule',
    )
    expect(screen.queryByText('other-rule')).not.toBeInTheDocument()
    expect(screen.queryByText('scene-enter-rule')).not.toBeInTheDocument()
  })

  it('reserves new video clicks for playback while exposing legacy conflicts', () => {
    const legacyRule: InteractionRule = {
      ...clickRule('legacy-video-click', [{
        type: 'presentation.set',
        stateId: 'feedback',
      }]),
      trigger: { type: 'node.click', nodeId: video.id },
    }
    const onAddRule = vi.fn()
    renderEditor({
      scene: makeScene([legacyRule]),
      selectedNode: video,
      onAddRule,
    })

    expect(screen.queryByLabelText('快捷连接目标状态')).not.toBeInTheDocument()
    expect(screen.getByTestId('video-click-policy')).toHaveTextContent(
      '独立按钮或透明图形热点',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '播放点击或画布控件正在占用视频表面',
    )
    expect(screen.getByRole('group', { name: '单击规则 1' })).toHaveTextContent(
      'legacy-video-click',
    )
    expect(onAddRule).not.toHaveBeenCalled()
  })
})

describe('SceneAutomationEditor', () => {
  it('uses an explicit empty authoring-state list instead of synthetic scene states', () => {
    const stateRule = automationRule('state-rule', {
      type: 'presentation.enter',
      stateId: 'question',
    })
    renderAutomationEditor({
      scene: makeScene([stateRule]),
      authoringStates: [],
    })

    expect(screen.getByTestId('rule-summary-state-rule')).toHaveTextContent(
      '缺失状态（question）',
    )
    expect(within(screen.getByLabelText('新规则的触发时机')).getByRole('option', {
      name: '进入状态',
    })).toBeDisabled()
  })

  it('disables unsupported legacy rule actions while preserving reveal and updates', () => {
    const first = automationRule('first-rule', { type: 'scene.enter' })
    const second = automationRule('second-rule', {
      type: 'video.ended',
      nodeId: video.id,
    })
    const reason = '此载体仅支持现有规则编辑和依次出现模板。'
    const {
      onAddRule,
      onUpdateRule,
      onDeleteRule,
      onDuplicateRule,
      onMoveRule,
      onApplyRevealSequenceTemplate,
    } = renderAutomationEditor({
      scene: makeScene([first, second]),
      legacyRuleActionsAvailable: false,
      legacyRuleActionsUnavailableReason: reason,
    })

    expect(screen.getByTestId('legacy-rule-actions-unavailable')).toHaveTextContent(reason)
    expect(screen.getByLabelText('新规则的触发时机')).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加规则' })).toBeDisabled()
    expect(screen.getByRole('option', {
      name: '声音结束后，进入下一场景',
    })).toBeDisabled()
    expect(screen.getByRole('option', {
      name: '进入场景后，元素依次出现',
    })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
    expect(onApplyRevealSequenceTemplate).toHaveBeenCalledOnce()
    expect(onAddRule).not.toHaveBeenCalled()

    for (const name of [
      '复制规则 1',
      '上移规则 1',
      '下移规则 1',
      '删除规则 1',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    fireEvent.click(screen.getByRole('button', { name: '复制规则 1' }))
    fireEvent.click(screen.getByRole('button', { name: '下移规则 1' }))
    fireEvent.click(screen.getByRole('button', { name: '删除规则 1' }))
    expect(onDuplicateRule).not.toHaveBeenCalled()
    expect(onMoveRule).not.toHaveBeenCalled()
    expect(onDeleteRule).not.toHaveBeenCalled()

    const firstRuleGroup = screen.getByRole('group', { name: '规则 1' })
    fireEvent.change(within(firstRuleGroup).getByLabelText('规则名称'), {
      target: { value: '专业编辑仍可用' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('first-rule', {
      name: '专业编辑仍可用',
    })
  })

  it('exposes undoable rule copy and ordering controls', () => {
    const first = automationRule('first-rule', { type: 'scene.enter' })
    const second = automationRule('second-rule', {
      type: 'video.ended',
      nodeId: video.id,
    })
    const { onDuplicateRule, onMoveRule } = renderAutomationEditor({
      scene: makeScene([first, second]),
    })

    fireEvent.click(screen.getByRole('button', { name: '复制规则 1' }))
    expect(onDuplicateRule).toHaveBeenCalledWith('first-rule')

    expect(screen.getByRole('button', { name: '上移规则 1' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '下移规则 1' }))
    expect(onMoveRule).toHaveBeenCalledWith('first-rule', 1)

    fireEvent.click(screen.getByRole('button', { name: '上移规则 2' }))
    expect(onMoveRule).toHaveBeenCalledWith('second-rule', -1)
    expect(screen.getByRole('button', { name: '下移规则 2' })).toBeDisabled()
  })

  it('explains a rule as 当、如果、就 and makes parallel timing readable', () => {
    const rule = automationRule(
      'readable-sequence',
      { type: 'scene.enter' },
      [
        { type: 'audio.play', soundId: 'click' },
        {
          type: 'node.enter',
          nodeId: button.id,
          effect: 'fade',
          durationMs: 320,
          easing: 'ease-out',
        },
        { type: 'scene.next' },
      ],
      [{ type: 'presentation.in', stateIds: ['question'] }],
    )
    rule.actions[1] = {
      ...rule.actions[1]!,
      start: 'with-previous',
      delayMs: 120,
    }
    renderAutomationEditor({ scene: makeScene([rule]) })

    const summary = screen.getByTestId('rule-summary-readable-sequence')
    expect(summary).toHaveTextContent('当进入当前场景')
    expect(summary).toHaveTextContent('如果当前状态是 “题目”')
    expect(summary).toHaveTextContent('与上一步同时计时，延迟 120 毫秒后开始')
    expect(summary).toHaveTextContent('等待上一组完成：进入下一场景')

    const sequence = screen.getByRole('list', { name: '动作执行顺序' })
    expect(within(sequence).getAllByRole('listitem')).toHaveLength(3)
    expect(within(sequence).getAllByRole('listitem')[1]).toHaveTextContent(
      '与上一步同时计时，延迟 120 毫秒后开始',
    )
  })

  it('filters and searches rules related to the selected element', () => {
    const related = automationRule(
      'selected-node-rule',
      { type: 'node.activated', nodeId: button.id },
      [{
        type: 'node.exit',
        nodeId: button.id,
        effect: 'fade',
        durationMs: 240,
        easing: 'ease-in',
      }],
    )
    const unrelated = automationRule(
      'video-rule',
      { type: 'video.ended', nodeId: video.id },
    )
    renderAutomationEditor({
      scene: makeScene([related, unrelated]),
      selectedNodeId: button.id,
    })

    fireEvent.change(screen.getByLabelText('规则筛选'), {
      target: { value: 'selected-node' },
    })
    expect(screen.getByRole('group', { name: '规则 1' })).toHaveTextContent(
      'selected-node-rule',
    )
    expect(screen.queryByRole('group', { name: '规则 2' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('规则筛选'), {
      target: { value: 'all' },
    })
    fireEvent.change(screen.getByLabelText('搜索规则'), {
      target: { value: '视频' },
    })
    expect(screen.queryByRole('group', { name: '规则 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '规则 2' })).toHaveTextContent(
      'video-rule',
    )
  })

  it('emits one stable sequential entrance template intent', () => {
    const { onAddRule, onApplyRevealSequenceTemplate } = renderAutomationEditor({
      selectedNodeId: button.id,
    })

    fireEvent.click(screen.getByRole('button', { name: '使用模板' }))

    expect(onApplyRevealSequenceTemplate).toHaveBeenCalledOnce()
    expect(onApplyRevealSequenceTemplate).toHaveBeenCalledWith({
      ruleId: expect.stringMatching(/^interaction_/),
      name: '进入场景后依次出现',
      actionIds: [
        expect.stringMatching(/^action_/),
        expect.stringMatching(/^action_/),
        expect.stringMatching(/^action_/),
      ],
      targetLayerItemIds: [button.id, video.id, component.id],
    })
    expect(onAddRule).not.toHaveBeenCalled()

    const intent = onApplyRevealSequenceTemplate.mock.calls[0]![0]
    const stableIds = [intent.ruleId, ...intent.actionIds]
    expect(new Set(stableIds).size).toBe(stableIds.length)
  })

  it('routes selected-element clicks to properties and starts current-position preview', () => {
    const { onOpenClickRules, onRunPreview } = renderAutomationEditor({
      selectedNodeId: button.id,
    })

    fireEvent.click(screen.getByRole('button', {
      name: '设置选中元素的点击动作',
    }))
    expect(onOpenClickRules).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '当前位置试运行' }))
    expect(onRunPreview).toHaveBeenCalledOnce()
  })

  it('shows rule-level conflict hints and can filter to warnings', () => {
    const safe = automationRule('safe-rule', { type: 'scene.enter' })
    const warning = automationRule('warning-rule', {
      type: 'video.ended',
      nodeId: video.id,
    })
    renderAutomationEditor({
      scene: makeScene([safe, warning]),
      ruleWarnings: {
        'warning-rule': ['循环视频不会自然触发播放结束。'],
      },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      '循环视频不会自然触发播放结束',
    )
    fireEvent.change(screen.getByLabelText('规则筛选'), {
      target: { value: 'warnings' },
    })
    expect(screen.queryByRole('group', { name: '规则 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '规则 2' })).toHaveTextContent(
      'warning-rule',
    )
  })

  it('authors exit motion from an animation-completed trigger and exposes preview controls', () => {
    const sourceRule = clickRule('source-motion', [{
      type: 'node.enter',
      nodeId: button.id,
      effect: 'fade',
      durationMs: 300,
      easing: 'ease-out',
    }])
    const completionRule = automationRule(
      'completion-motion',
      {
        type: 'animation.completed',
        actionId: 'source-motion-action-1',
      },
      [{
        type: 'node.exit',
        nodeId: button.id,
        effect: 'scale',
        durationMs: 240,
        easing: 'ease-in',
      }],
    )
    renderAutomationEditor({ scene: makeScene([sourceRule, completionRule]) })

    const group = screen.getByRole('group', { name: '规则 1' })
    expect(within(group).getByLabelText('触发方式'))
      .toHaveValue('animation.completed')
    expect(within(group).getByLabelText('监听动画动作'))
      .toHaveValue('source-motion-action-1')
    expect(within(group).getByLabelText('动作类型')).toHaveValue('node.exit')
    expect(within(group).getByLabelText('效果')).toHaveValue('scale')
    expect(within(group).getByLabelText('动画时长（毫秒）')).toHaveValue(240)

    fireEvent.click(within(group).getByRole('button', { name: '预览动作 1' }))
    expect(previewMotion).toHaveBeenCalledWith(
      completionRule.actions[0]!.action,
      0,
    )
  })

  it('authors persistent global rules with an editable scene.in scope', () => {
    const existing = automationRule(
      'global-enter',
      { type: 'scene.enter' },
      [{ type: 'scene.next' }],
      [{ type: 'scene.in', sceneIds: ['scene_one'] }],
    )
    const onAddRule = vi.fn()
    const onUpdateRule = vi.fn()
    render(
      <SceneAutomationEditor
        scene={makeScene([])}
        sourceScope="global"
        sourceNodes={[component, video]}
        sourceRules={[existing]}
        activeStateId="question"
        scenes={projectScenes}
        sounds={sounds}
        onApplyRevealSequenceTemplate={vi.fn()}
        onAddRule={onAddRule}
        onUpdateRule={onUpdateRule}
        onDeleteRule={vi.fn()}
      />,
    )

    expect(screen.getByText('全局规则')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: '规则 1' })
    expect(within(group).getByLabelText('生效场景')).toHaveValue('scene_one')
    fireEvent.change(within(group).getByLabelText('生效场景'), {
      target: { value: 'scene_two' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('global-enter', {
      conditions: [{ type: 'scene.in', sceneIds: ['scene_two'] }],
    })

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({
      conditions: [
        { type: 'scene.in', sceneIds: ['scene_one'] },
        { type: 'presentation.in', stateIds: ['question'] },
      ],
    }))
  })

  it('adds a scoped scene-enter rule and never repeats node-click rules', () => {
    const scene = makeScene([
      clickRule('click-only', [{ type: 'scene.next' }]),
      automationRule('existing-automation', { type: 'scene.enter' }),
    ])
    const { onAddRule } = renderAutomationEditor({ scene })

    expect(screen.getByRole('group', { name: '规则 1' })).toHaveTextContent(
      'existing-automation',
    )
    expect(screen.queryByText('click-only')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    expect(onAddRule).toHaveBeenCalledWith({
      id: expect.stringMatching(/^interaction_/),
      name: '进入场景规则',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{ type: 'presentation.in', stateIds: ['question'] }],
      actions: [{
        id: expect.stringMatching(/^action_/),
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'presentation.set', stateId: 'feedback' },
      }],
    })
  })

  it('offers presenter commands now that the presenter input layer exists', () => {
    renderAutomationEditor({ scene: makeScene([]) })

    expect(screen.getByRole('option', {
      name: '翻页笔命令',
    })).toBeEnabled()
  })

  it('edits state, audio, video, component, and scoped runtime-event triggers', () => {
    const scene = makeScene([
      automationRule('state-trigger', {
        type: 'presentation.enter',
        stateId: 'question',
      }),
      automationRule('audio-trigger', {
        type: 'audio.ended',
        soundId: 'correct',
      }),
      automationRule('started-trigger', {
        type: 'video.started',
        nodeId: video.id,
      }),
      automationRule('paused-trigger', {
        type: 'video.paused',
        nodeId: video.id,
      }),
      automationRule('ended-trigger', {
        type: 'video.ended',
        nodeId: video.id,
      }),
      automationRule('time-trigger', {
        type: 'video.time',
        nodeId: video.id,
        seconds: 8,
      }),
      automationRule('component-trigger', {
        type: 'component.event',
        nodeId: component.id,
        eventName: 'answered',
      }),
      automationRule('runtime-trigger', {
        type: 'runtime.event',
        scope: 'scene',
        eventName: 'decision:ready',
      }),
    ])
    const { onUpdateRule } = renderAutomationEditor({ scene })
    const groups = screen.getAllByRole('group', { name: /规则 \d+/ })

    fireEvent.change(within(groups[0]!).getByLabelText('进入状态'), {
      target: { value: 'feedback' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('state-trigger', {
      trigger: { type: 'presentation.enter', stateId: 'feedback' },
    })

    fireEvent.change(within(groups[1]!).getByLabelText('监听声音'), {
      target: { value: 'click' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('audio-trigger', {
      trigger: { type: 'audio.ended', soundId: 'click' },
    })

    expect(within(groups[2]!).getByLabelText('触发方式')).toHaveValue('video.started')
    expect(within(groups[3]!).getByLabelText('触发方式')).toHaveValue('video.paused')
    expect(within(groups[4]!).getByLabelText('触发方式')).toHaveValue('video.ended')
    fireEvent.change(within(groups[5]!).getByLabelText('触发时间（秒）'), {
      target: { value: '12.5' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('time-trigger', {
      trigger: { type: 'video.time', nodeId: video.id, seconds: 12.5 },
    })

    fireEvent.change(within(groups[6]!).getByLabelText('事件名称'), {
      target: { value: 'completed' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('component-trigger', {
      trigger: {
        type: 'component.event',
        nodeId: component.id,
        eventName: 'completed',
      },
    })

    fireEvent.change(within(groups[7]!).getByLabelText('运行时来源'), {
      target: { value: 'global' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('runtime-trigger', {
      trigger: {
        type: 'runtime.event',
        scope: 'global',
        eventName: 'decision:ready',
      },
    })
    fireEvent.change(within(groups[7]!).getByLabelText('运行时事件名称'), {
      target: { value: 'decision:complete' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('runtime-trigger', {
      trigger: {
        type: 'runtime.event',
        scope: 'scene',
        eventName: 'decision:complete',
      },
    })
  })

  it('reuses state scope and the complete state/scene/audio/video action editor', () => {
    const rule = automationRule(
      'full-actions',
      { type: 'scene.enter' },
      [
        { type: 'presentation.set', stateId: 'feedback' },
        { type: 'audio.play', soundId: 'correct' },
        { type: 'video.seek', nodeId: video.id, seconds: 5 },
        { type: 'scene.go', sceneId: 'scene_two' },
      ],
      [{ type: 'presentation.in', stateIds: ['question'] }],
    )
    const { onUpdateRule } = renderAutomationEditor({ scene: makeScene([rule]) })
    const group = screen.getByRole('group', { name: '规则 1' })

    fireEvent.change(within(group).getByLabelText('作用范围'), {
      target: { value: '__all_states__' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('full-actions', { conditions: [] })
    expect(within(group).getByLabelText('目标状态')).toHaveValue('feedback')
    expect(within(group).getByLabelText('声音')).toHaveValue('correct')
    expect(within(group).getByLabelText('目标视频')).toHaveValue(video.id)
    expect(within(group).getByLabelText('目标场景')).toHaveValue('scene_two')

    fireEvent.change(within(group).getByLabelText('目标时间（秒）'), {
      target: { value: '9.5' },
    })
    expect(onUpdateRule).toHaveBeenCalledWith('full-actions', {
      actions: [
        actionStep('full-actions-action-1', {
          type: 'presentation.set', stateId: 'feedback',
        }),
        actionStep('full-actions-action-2', {
          type: 'audio.play', soundId: 'correct',
        }),
        actionStep('full-actions-action-3', {
          type: 'video.seek', nodeId: video.id, seconds: 9.5,
        }),
        actionStep('full-actions-action-4', {
          type: 'scene.go', sceneId: 'scene_two',
        }),
      ],
    })
  })
})
