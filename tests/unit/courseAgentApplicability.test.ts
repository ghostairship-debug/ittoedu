import { describe, expect, it } from 'vitest'
import {
  INTERACTION_ACTION_TYPES,
  INTERACTION_CONDITION_TYPES,
  INTERACTION_TRIGGER_TYPES,
} from '../../src/shared/contracts/interaction-v1/types'
import {
  generationApplicabilityProjection,
  publishedInteractionPlaybackExclusions,
} from '../../src/shared/courseAgentApplicability'
import {
  isPublishedInteractionActionSupported,
  isPublishedInteractionActionStepSupported,
  isPublishedInteractionConditionSupported,
  isPublishedInteractionTriggerSupported,
} from '../../src/shared/publishedInteractionSupport'
import { generationCapabilityContext } from '../../src/renderer/authoring/generation/generationCapabilities'

describe('courseAgentApplicability', () => {
  it('keeps playable conditional state and media operations out of first-route exclusions', () => {
    const projection = generationApplicabilityProjection().interactionPlayback
    const excluded = projection.excluded.flatMap(group => group.types)
    for (const type of ['presentation.set', 'audio.play', 'audio.ended', 'video.play', 'video.time']) {
      expect(excluded).not.toContain(type)
    }
    const rule = { id: 'r', enabled: true, trigger: { type: 'node.click' as const, nodeId: 'button' }, conditions: [],
      actions: [{ id: 'set', start: 'after-previous' as const, delayMs: 0,
        action: { type: 'presentation.set' as const, stateId: 'on' } }] }
    expect(isPublishedInteractionActionStepSupported(rule, 0)).toBe(true)
    expect(isPublishedInteractionActionStepSupported({ ...rule, trigger: { type: 'scene.enter' } }, 0)).toBe(false)
    expect(isPublishedInteractionActionStepSupported(rule, 0, 'global')).toBe(false)
    expect(projection.presentationSet).toContain('global requires scene.in')
  })

  it('排除分支与合同减支持表完全同源', () => {
    const groups = publishedInteractionPlaybackExclusions()
    const listed = (kind: string) => groups.filter((group) => group.kind === kind).flatMap((group) => group.types)
    expect(listed('interaction-trigger').sort()).toEqual(
      INTERACTION_TRIGGER_TYPES.filter((type) => !isPublishedInteractionTriggerSupported(type)).sort())
    expect(listed('interaction-condition').sort()).toEqual(
      INTERACTION_CONDITION_TYPES.filter((type) => !isPublishedInteractionConditionSupported(type)).sort())
    expect(listed('interaction-action').sort()).toEqual(
      INTERACTION_ACTION_TYPES.filter((type) => !isPublishedInteractionActionSupported(type)).sort())
    for (const group of groups) {
      expect(group.reason.length).toBeGreaterThan(0)
      expect(group.alternatives.length).toBeGreaterThan(0)
    }
  })

  it('presentation.enter 与 presentation.in 首次即被排除并给出经核实的替代', () => {
    const groups = publishedInteractionPlaybackExclusions()
    const enter = groups.find((group) => group.types.includes('presentation.enter'))
    const condition = groups.find((group) => group.types.includes('presentation.in'))
    expect(enter?.reason).toContain('不会')
    expect(enter?.alternatives.join(' ')).toContain('presentation.set')
    expect(condition?.alternatives.join(' ')).toContain('course-state.compare')
    // 替代本身必须是当前支持的分支，不能指向另一个排除项。
    expect(isPublishedInteractionTriggerSupported('node.click')).toBe(true)
    expect(isPublishedInteractionTriggerSupported('presenter.command')).toBe(true)
    expect(isPublishedInteractionConditionSupported('course-state.compare')).toBe(true)
    expect(isPublishedInteractionConditionSupported('scene.in')).toBe(true)
  })

  it('首次上下文携带同源适用性投影与选路规则', () => {
    const context = generationCapabilityContext([], 'local-edit', undefined, '修改标题文字')
    const applicability = (context as { applicability?: ReturnType<typeof generationApplicabilityProjection> }).applicability
    expect(applicability?.version).toBe(1)
    const excluded = applicability?.interactionPlayback.excluded ?? []
    expect(excluded.flatMap((group) => group.types)).toContain('presentation.enter')
    expect(excluded.flatMap((group) => group.types)).toContain('presentation.in')
    expect(applicability?.routing).toContain('首次选路')
    expect(context.instruction).toContain('applicability')
  })
})
