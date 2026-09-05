import type { InteractionRule } from './interactionTypes'
import type { CourseStateDeclaration } from './courseProjectTypes'

/** Product-authored single-choice answer result, held in ordinary editable course state.
 * Renaming a key preserves runtime behavior but opts out of this family diagnostic.
 * Handwritten multi-select interactions are not inferred from their text or Recipe name.
 */
export const SINGLE_CHOICE_STATE_KEY_PREFIX = 'single_choice_'
export const SINGLE_CHOICE_STATE_KEY_SUFFIX = '_correct'
export function isSingleChoiceStateKey(key: string): boolean {
  return key.startsWith(SINGLE_CHOICE_STATE_KEY_PREFIX) && key.endsWith(SINGLE_CHOICE_STATE_KEY_SUFFIX) && key.length > SINGLE_CHOICE_STATE_KEY_PREFIX.length + SINGLE_CHOICE_STATE_KEY_SUFFIX.length
}
export interface SingleChoiceRuleFamilyFinding {
  key: string
  nodeIds: string[]
  ruleIds: string[]
  code: 'missing-correct-answer' | 'multiple-correct-answers' | 'conflicting-option-values'
}
export function inspectSingleChoiceRuleFamilies(declarations: readonly CourseStateDeclaration[], rules: readonly InteractionRule[]): SingleChoiceRuleFamilyFinding[] {
  return declarations.filter(declaration => declaration.valueType === 'boolean' && isSingleChoiceStateKey(declaration.key)).flatMap(declaration => {
    const family = rules.filter(rule => rule.enabled && rule.trigger.type === 'node.click' && rule.actions.some(step => step.action.type === 'node.enter') && rule.actions.some(step => step.action.type === 'course-state.set' && step.action.key === declaration.key))
    const options = new Map<string, Set<boolean>>()
    for (const rule of family) {
      if (rule.trigger.type !== 'node.click') continue
      const values = options.get(rule.trigger.nodeId) ?? new Set<boolean>()
      for (const step of rule.actions) if (step.action.type === 'course-state.set' && step.action.key === declaration.key && typeof step.action.value === 'boolean') values.add(step.action.value)
      options.set(rule.trigger.nodeId, values)
    }
    const common = { key: declaration.key, nodeIds: [...options.keys()], ruleIds: family.map(rule => rule.id) }
    const findings: SingleChoiceRuleFamilyFinding[] = []
    if ([...options.values()].some(values => values.size > 1)) findings.push({ ...common, code: 'conflicting-option-values' })
    const trueCount = [...options.values()].filter(values => values.has(true)).length
    if (trueCount === 0) findings.push({ ...common, code: 'missing-correct-answer' })
    if (trueCount > 1) findings.push({ ...common, code: 'multiple-correct-answers' })
    return findings
  })
}
