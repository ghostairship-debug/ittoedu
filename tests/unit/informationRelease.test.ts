import { describe, expect, it } from 'vitest'
import { analyzeInformationRelease } from '../../src/shared/informationRelease'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import { createDefaultScenePresentation } from '../../src/shared/presentation'
import type { ProjectDocument, SceneDocument } from '../../src/shared/projectTypes'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'

function blankReleaseProject(): ProjectDocument {
  const scene: SceneDocument = {
    id: 'scene_1',
    name: '场景 1',
    backgroundColor: '#ffffff',
    backgroundAssetId: null,
    nodes: [],
    presentation: createDefaultScenePresentation(),
    interactions: [],
  }
  return { scenes: [scene] } as ProjectDocument
}

function revealRule(
  id: string,
  trigger: InteractionRule['trigger'],
  nodeId: string,
): InteractionRule {
  return {
    id,
    enabled: true,
    trigger,
    conditions: [],
    actions: [{
      id: `${id}_enter`,
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'node.enter',
        nodeId,
        effect: 'fade',
        durationMs: 200,
        easing: 'ease-out',
      },
    }],
  }
}

describe('information release inspector', () => {
  it('finds a reachable staged reveal from an initially visible trigger', () => {
    const project = blankReleaseProject()
    const scene = project.scenes[0]!
    const button = createTextNode({ id: 'button', name: '继续', text: '继续' })
    const detail = createTextNode({
      id: 'detail',
      name: '第二层信息',
      playbackInitialVisibility: 'hidden',
    })
    scene.nodes = [button, detail]
    scene.interactions = [revealRule(
      'reveal_detail',
      { type: 'node.click', nodeId: button.id },
      detail.id,
    )]

    const report = analyzeInformationRelease(project)
    expect(report.summary).toMatchObject({
      initiallyHiddenCount: 1,
      revealedCount: 1,
      hiddenWithoutRevealCount: 0,
    })
    expect(report.states[0]!.revealSteps[0]).toMatchObject({
      nodeId: detail.id,
      ruleId: 'reveal_detail',
      stage: 1,
    })
  })

  it('does not treat clicking an invisible node as a reachable self reveal', () => {
    const project = blankReleaseProject()
    const scene = project.scenes[0]!
    const hidden = createTextNode({
      id: 'hidden',
      name: '锁死信息',
      playbackInitialVisibility: 'hidden',
    })
    scene.nodes = [hidden]
    scene.interactions = [revealRule(
      'self_reveal',
      { type: 'node.click', nodeId: hidden.id },
      hidden.id,
    )]

    const report = analyzeInformationRelease(project)
    expect(report.states[0]!.hiddenWithoutRevealNodeIds).toEqual([hidden.id])
    expect(report.states[0]!.hiddenSelfTriggeredNodeIds).toEqual([hidden.id])
  })

  it('evaluates presentation conditions per authored state', () => {
    const project = blankReleaseProject()
    const scene = project.scenes[0]!
    const hidden = createTextNode({
      id: 'conditional',
      playbackInitialVisibility: 'hidden',
    })
    scene.nodes = [hidden]
    scene.presentation = {
      initialStateId: 'state_a',
      states: [
        { id: 'state_a', name: '状态 A', nodeOverrides: {} },
        { id: 'state_b', name: '状态 B', nodeOverrides: {} },
      ],
    }
    const rule = revealRule('state_reveal', { type: 'scene.enter' }, hidden.id)
    rule.conditions = [{ type: 'presentation.in', stateIds: ['state_a'] }]
    scene.interactions = [rule]

    const report = analyzeInformationRelease(project)
    expect(report.states.find(({ stateId }) => stateId === 'state_a'))
      .toMatchObject({ hiddenWithoutRevealNodeIds: [] })
    expect(report.states.find(({ stateId }) => stateId === 'state_b'))
      .toMatchObject({ hiddenWithoutRevealNodeIds: [hidden.id] })
  })

  it('treats scene.enter as reachable when navigation targets a non-initial state', () => {
    const project = blankReleaseProject()
    const scene = project.scenes[0]!
    const hidden = createTextNode({
      id: 'direct-target-detail',
      playbackInitialVisibility: 'hidden',
    })
    scene.nodes = [hidden]
    scene.presentation = {
      initialStateId: 'state_a',
      states: [
        { id: 'state_a', name: '状态 A', nodeOverrides: {} },
        { id: 'state_b', name: '状态 B', nodeOverrides: {} },
      ],
    }
    const rule = revealRule('direct_state_entry', { type: 'scene.enter' }, hidden.id)
    rule.conditions = [{ type: 'presentation.in', stateIds: ['state_b'] }]
    scene.interactions = [rule]

    const stateB = analyzeInformationRelease(project).states.find(
      ({ stateId }) => stateId === 'state_b',
    )
    expect(stateB).toMatchObject({
      hiddenWithoutRevealNodeIds: [],
      revealSteps: [expect.objectContaining({ nodeId: hidden.id })],
    })
  })
})
