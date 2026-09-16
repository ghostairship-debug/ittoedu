import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { adjacentPlaybackTarget, buildCoursePlaybackSequence, playbackNavigationProgress } from '../../../player/navigation/coursePlaybackSequence'

/** Read-only navigation facts from the Player's sequence Owner. These are
 * declared targets, not proof that a guarded or conditional click has run. */
export function generationNavigationContext(project: CourseProjectDocument, locationId: string, stateId: string | null) {
  const sequence = buildCoursePlaybackSequence(project)
  const location = project.locations.find(value => value.id === locationId)
  const surface = project.surfaces.find(value => value.id === location?.surfaceId)
  const slide = surface?.type === 'slide' && location?.kind === 'slide-scene'
    ? surface.scenes.find(value => value.id === location.sceneId) : undefined
  const currentStateId = stateId ?? (location?.kind === 'slide-scene' ? location.stateId : undefined) ?? slide?.presentation?.initialStateId ?? null
  const describe = (target: ReturnType<typeof adjacentPlaybackTarget>) => {
    if (!target) return null
    const scene = sequence.find(value => value.steps.some(step => step.id === target.id))!
    return { locationId: target.locationId, stateId: target.stateId ?? null, sceneName: scene.name, stepName: target.name, surfaceType: scene.kind }
  }
  const targets = (fromStateId: string | null) => {
    const progress = playbackNavigationProgress(sequence, locationId, fromStateId)
    return { stateId: fromStateId,
      nextStep: describe(adjacentPlaybackTarget(sequence, progress, 'step', 'next')),
      nextScene: describe(adjacentPlaybackTarget(sequence, progress, 'scene', 'next')),
      previousStep: describe(adjacentPlaybackTarget(sequence, progress, 'step', 'previous')),
      previousScene: describe(adjacentPlaybackTarget(sequence, progress, 'scene', 'previous')) }
  }
  return {
    evidence: 'declared-navigation-targets',
    instruction: '当前工程事实优先于旧记忆。step.next/previous（下一步/上一步）包含页内呈现步骤；scene.next/previous（下一场景/上一场景）跳过页内剩余步骤并可跨 Slide/Flow/Spatial。不能因相邻 locations 就断言 step.next 一次跨页。以下是声明目标，条件与导航守卫仍需实际操作验证；未修改的按钮也须核对用户要求。',
    current: targets(currentStateId),
    states: slide?.presentation?.states.map(state => ({ name: state.name, ...targets(state.id) })) ?? [],
    rules: (slide?.interactions ?? []).flatMap(rule => {
      const actions = rule.actions.filter(step => /^(scene|step)\./.test(step.action.type))
      return actions.length ? [{ ruleId: rule.id, name: rule.name, enabled: rule.enabled,
        trigger: rule.trigger, conditions: rule.conditions, actions }] : []
    }),
  }
}
