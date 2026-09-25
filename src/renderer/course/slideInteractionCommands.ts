import { planAddSlideInteractionRule, planUpdateSlideInteractionRule, planDeleteSlideInteractionRule, assertSceneScope, assertRuleTargetsUnlocked, locateScene, locateSceneInteractions, locateRule, emptyRuleScopeMessage, type SlideInteractionTarget } from '../../core/tools/slideInteractions'
export { interactionRuleNodeIds, LOCKED_INTERACTION_WRITE_REASON, SLIDE_INTERACTION_GLOBAL_WRITE_REASON } from '../../core/tools/slideInteractions'
export type { SlideInteractionScope, SlideInteractionTarget } from '../../core/tools/slideInteractions'
import { commitResourceAwareAuthoringHistory, type ResourceAwareAuthoringHistory } from '../authoring/resourceAwareAuthoringHistory'
import { nanoid } from 'nanoid'
import {
  type InteractionRule,
} from '../../shared/interactionTypes'
import type {
  CourseProjectDocument,
} from '../../shared/courseProjectTypes'
import { commitSlideProjectMutation } from './slideEditorCommands'

function commitHistory(
  history: ResourceAwareAuthoringHistory,
  project: CourseProjectDocument,
): ResourceAwareAuthoringHistory {
  return commitResourceAwareAuthoringHistory(history, project)
}

/**
 * Adds one scene interaction rule. Global scope is refused with wrong-owner.
 * Exactly one Project revision and one history entry per invocation.
 */
export function addSlideInteractionRule(
  history: ResourceAwareAuthoringHistory,
  target: SlideInteractionTarget,
  rule: InteractionRule,
  now?: string,
): ResourceAwareAuthoringHistory {
  return commitHistory(history, planAddSlideInteractionRule(history.present, target, rule, now))
}

/**
 * Applies one patch to an existing scene rule. `ruleId` is immutable.
 */
export function updateSlideInteractionRule(
  history: ResourceAwareAuthoringHistory,
  target: SlideInteractionTarget,
  ruleId: string,
  patch: Partial<Omit<InteractionRule, 'id'>>,
  now?: string,
): ResourceAwareAuthoringHistory {
  const project = planUpdateSlideInteractionRule(history.present, target, ruleId, patch, now)
  return project === history.present ? history : commitHistory(history, project)
}

export function deleteSlideInteractionRule(
  history: ResourceAwareAuthoringHistory,
  target: SlideInteractionTarget,
  ruleId: string,
  now?: string,
): ResourceAwareAuthoringHistory {
  return commitHistory(history, planDeleteSlideInteractionRule(history.present, target, ruleId, now))
}

export function duplicateSlideInteractionRule(
  history: ResourceAwareAuthoringHistory,
  target: SlideInteractionTarget,
  ruleId: string,
  now?: string,
): ResourceAwareAuthoringHistory {
  assertSceneScope(target)
  const current = locateRule(history.present, target, ruleId)
  if (!current) throw new Error(emptyRuleScopeMessage())
  assertRuleTargetsUnlocked(history.present, current)
  const next = commitSlideProjectMutation(history.present, (draft) => {
    const rules = locateSceneInteractions(draft, target.locationId)
    const index = rules.findIndex((candidate) => candidate.id === ruleId)
    if (index < 0) throw new Error(emptyRuleScopeMessage())
    const copy = structuredClone(current)
    copy.id = `interaction_${nanoid()}`
    copy.name = current.name ? `${current.name} 副本` : undefined
    copy.actions = copy.actions.map((step) => ({
      ...step,
      id: `action_${nanoid()}`,
    }))
    rules.splice(index + 1, 0, copy)
  }, now)
  return commitHistory(history, next)
}

export function moveSlideInteractionRule(
  history: ResourceAwareAuthoringHistory,
  target: SlideInteractionTarget,
  ruleId: string,
  direction: -1 | 1,
  now?: string,
): ResourceAwareAuthoringHistory {
  assertSceneScope(target)
  const project = history.present
  const rules = locateSceneInteractions(project, target.locationId)
  const index = rules.findIndex((candidate) => candidate.id === ruleId)
  if (index < 0) throw new Error(emptyRuleScopeMessage())
  const current = rules[index]
  if (current) assertRuleTargetsUnlocked(project, current)
  const swapIndex = index + direction
  if (swapIndex < 0 || swapIndex >= rules.length) return history
  const next = commitSlideProjectMutation(project, (draft) => {
    const draftRules = locateSceneInteractions(draft, target.locationId)
    const from = draftRules.findIndex((candidate) => candidate.id === ruleId)
    if (from < 0) throw new Error(emptyRuleScopeMessage())
    ;[draftRules[from], draftRules[swapIndex]] = [
      draftRules[swapIndex]!,
      draftRules[from]!,
    ]
  }, now)
  return commitHistory(history, next)
}
