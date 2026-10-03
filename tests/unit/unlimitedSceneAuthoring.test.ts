import { describe, expect, it } from 'vitest'
import { locateScene, planAddSlideInteractionRule } from '@/core/tools/slideInteractions'
import { interactionRuleSchema } from '@/shared/interactionSchema'
import type { InteractionRule } from '@/shared/interactionTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

function rule(id: string, sceneId: string, conditionCount = 0, actionCount = 1): InteractionRule {
  return {
    id,
    enabled: true,
    trigger: { type: 'scene.enter' },
    conditions: Array.from({ length: conditionCount }, () => ({
      type: 'scene.in',
      sceneIds: [sceneId],
    })),
    actions: Array.from({ length: actionCount }, (_, index) => ({
      id: `${id}-action-${index}`,
      start: 'after-previous',
      delayMs: 0,
      action: { type: 'audio.stop', target: { kind: 'all' } },
    })),
  }
}

describe('unlimited scene authoring', () => {
  it('commits the 1001st rule with seventeen conditions and thirty-three actions without truncation', () => {
    const fixture = listCourseProjectV9Fixtures().find(candidate => candidate.id === 'slide-native')!
    const project = structuredClone(fixture.data.project)
    const locationId = project.startLocationId
    const scene = locateScene(project, locationId)
    scene.interactions = Array.from({ length: 1000 }, (_, index) => rule(`rule-${index}`, scene.id))
    const input = rule('rule-1000', scene.id, 17, 33)

    const result = planAddSlideInteractionRule(project, { locationId, scope: 'scene' }, input)
    const interactions = locateScene(result, locationId).interactions

    expect(result.revision).toBe(project.revision + 1)
    expect(interactions).toHaveLength(1001)
    expect(interactions.slice(0, 1000)).toEqual(scene.interactions)
    expect(interactions[1000]).toEqual(input)
    expect(scene.interactions).toHaveLength(1000)
    expect(() => planAddSlideInteractionRule(result, { locationId, scope: 'scene' }, input)).toThrow('规则 ID 已存在')
    expect(interactionRuleSchema.safeParse({ ...input, actions: [...input.actions, input.actions[0]] }).success).toBe(false)
  })
})
