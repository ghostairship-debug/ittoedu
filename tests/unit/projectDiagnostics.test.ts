import { describe, expect, it } from 'vitest'
import { collectProjectDiagnostics } from '@/shared/projectDiagnostics'
import type { InteractionRule } from '@/shared/interactionTypes'
import type { ProjectDocument, SceneDocument } from '@/shared/projectTypes'
import {
  createProject,
  createVideoNode,
} from '@/renderer/project/createProject'

function projectWithVideo(
  options: Parameters<typeof createVideoNode>[0] = { assetId: 'asset_video' },
): { project: ProjectDocument; scene: SceneDocument } {
  const project = createProject({
    id: 'project',
    includeDefaultController: false,
    controls: 'none',
    now: '2026-07-22T00:00:00.000Z',
    idFactory: () => 'fixed',
  })
  const scene = project.scenes[0]!
  scene.id = 'scene'
  scene.name = '视频场景'
  scene.nodes = [createVideoNode({
    id: 'video',
    name: '示范视频',
    ...options,
  })]
  return { project, scene }
}

function interaction(
  id: string,
  trigger: InteractionRule['trigger'],
  stateIds: string[] = [],
  enabled = true,
): InteractionRule {
  return {
    id,
    enabled,
    trigger,
    conditions: stateIds.length > 0
      ? [{ type: 'presentation.in', stateIds }]
      : [],
    actions: [{
      id: `${id}_action`,
      start: 'after-previous',
      delayMs: 0,
      action: { type: 'presentation.set', stateId: 'state_initial' },
    }],
  }
}

describe('collectProjectDiagnostics', () => {
  it('warns when an enabled video input layer shadows node.click rules', () => {
    const { project, scene } = projectWithVideo({
      assetId: 'asset_video',
      clickToToggle: true,
      showControls: false,
    })
    scene.interactions = [interaction(
      'click-rule',
      { type: 'node.click', nodeId: 'video' },
    )]

    expect(collectProjectDiagnostics(project)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'video-click-interaction-conflict',
        sceneId: 'scene',
        nodeId: 'video',
        ruleIds: ['click-rule'],
        stateIds: ['state_initial'],
      }),
    ])
  })

  it('treats canvas controls as the same video-owned input conflict', () => {
    const { project, scene } = projectWithVideo({
      assetId: 'asset_video',
      clickToToggle: false,
      showControls: true,
    })
    scene.interactions = [interaction(
      'click-rule',
      { type: 'node.click', nodeId: 'video' },
    )]

    expect(collectProjectDiagnostics(project).map(({ code }) => code)).toEqual([
      'video-click-interaction-conflict',
    ])
  })

  it('ignores disabled rules and videos without their own input layer', () => {
    const { project, scene } = projectWithVideo({
      assetId: 'asset_video',
      clickToToggle: false,
      showControls: false,
    })
    scene.interactions = [
      interaction('inactive', { type: 'node.click', nodeId: 'video' }, [], false),
    ]

    expect(collectProjectDiagnostics(project)).toEqual([])
  })

  it('compares rule scope with effective per-state video overrides', () => {
    const { project, scene } = projectWithVideo({
      assetId: 'asset_video',
      clickToToggle: false,
      showControls: false,
    })
    scene.presentation = {
      initialStateId: 'plain',
      thumbnailStateId: 'interactive',
      states: [
        { id: 'plain', name: '普通', nodeOverrides: {} },
        {
          id: 'interactive',
          name: '内置点击',
          nodeOverrides: { video: { clickToToggle: true } },
        },
      ],
    }
    scene.interactions = [
      interaction('plain-only', { type: 'node.click', nodeId: 'video' }, ['plain']),
      interaction('interactive-only', { type: 'node.click', nodeId: 'video' }, ['interactive']),
    ]

    expect(collectProjectDiagnostics(project)).toEqual([
      expect.objectContaining({
        code: 'video-click-interaction-conflict',
        ruleIds: ['interactive-only'],
        stateIds: ['interactive'],
      }),
    ])
  })

  it('warns only where a looping video and video.ended rule are both active', () => {
    const { project, scene } = projectWithVideo({
      assetId: 'asset_video',
      loop: false,
      clickToToggle: false,
      showControls: false,
    })
    scene.presentation = {
      initialStateId: 'once',
      thumbnailStateId: 'looping',
      states: [
        { id: 'once', name: '单次', nodeOverrides: {} },
        {
          id: 'looping',
          name: '循环',
          nodeOverrides: { video: { loop: true } },
        },
      ],
    }
    scene.interactions = [
      interaction('once-ended', { type: 'video.ended', nodeId: 'video' }, ['once']),
      interaction('loop-ended', { type: 'video.ended', nodeId: 'video' }, ['looping']),
      interaction('loop-time', { type: 'video.time', nodeId: 'video', seconds: 5 }, ['looping']),
    ]

    expect(collectProjectDiagnostics(project)).toEqual([
      expect.objectContaining({
        code: 'looping-video-ended-unreachable',
        ruleIds: ['loop-ended'],
        stateIds: ['looping'],
      }),
    ])
  })

  it('keeps video diagnostics conservative when course-state conditions may pass', () => {
    const { project, scene } = projectWithVideo({
      assetId: 'asset_video',
      loop: true,
      clickToToggle: true,
      showControls: false,
    })
    const clickRule = interaction(
      'stateful-click',
      { type: 'node.click', nodeId: 'video' },
    )
    clickRule.conditions.push({
      type: 'course-state.exists',
      key: 'ready',
      exists: true,
    })
    const endedRule = interaction(
      'stateful-ended',
      { type: 'video.ended', nodeId: 'video' },
    )
    endedRule.conditions.push({
      type: 'course-state.compare',
      key: 'score',
      operator: 'gte',
      value: 1,
    })
    scene.interactions = [clickRule, endedRule]

    expect(collectProjectDiagnostics(project)).toEqual([
      expect.objectContaining({
        code: 'video-click-interaction-conflict',
        ruleIds: ['stateful-click'],
      }),
      expect.objectContaining({
        code: 'looping-video-ended-unreachable',
        ruleIds: ['stateful-ended'],
      }),
    ])
  })

  it('does not diagnose rules in states where the video is hidden', () => {
    const { project, scene } = projectWithVideo({
      assetId: 'asset_video',
      loop: true,
      clickToToggle: true,
      showControls: true,
    })
    scene.presentation!.states[0]!.nodeOverrides.video = { visible: false }
    scene.interactions = [
      interaction('hidden-click', { type: 'node.click', nodeId: 'video' }),
      interaction('hidden-ended', { type: 'video.ended', nodeId: 'video' }),
    ]

    expect(collectProjectDiagnostics(project)).toEqual([])
  })
})
