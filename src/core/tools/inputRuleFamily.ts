import type { NativeInputContent } from '../../shared/contracts/native-v1/types'
import type { InteractionActionPayload, InteractionCondition, InteractionRule } from '../../shared/interactionTypes'
import { normalizeShortAnswer } from '../../shared/assessmentEvaluators'

export type InputAnswerConfig =
  | { answerType: 'text'; answers: string[] }
  | { answerType: 'number'; min: number; max: number }
export type InputRuleConfig = InputAnswerConfig & {
  correct: InteractionActionPayload[]
  error: InteractionActionPayload[]
}

export function buildInputRuleFamily(
  nodeId: string,
  input: Pick<NativeInputContent, 'stateKey' | 'validityKey'>,
  config: InputRuleConfig,
  id: () => string,
): InteractionRule[] {
  if (!config.correct.length || !config.error.length) throw new Error('请配置正确和错误反馈')
  const compare = (key: string, operator: 'eq' | 'neq' | 'gte' | 'lte' | 'lt' | 'gt', value: string | number | boolean): InteractionCondition =>
    ({ type: 'course-state.compare', key, operator, value })
  const valid = compare(input.validityKey, 'eq', true)
  const rule = (name: string, conditions: InteractionCondition[], actions: InteractionActionPayload[]): InteractionRule => ({
    id: id(), name, enabled: true, trigger: { type: 'input.submit', nodeId }, conditions,
    actions: actions.map(action => ({ id: id(), start: 'after-previous', delayMs: 0, action: structuredClone(action) })),
  })
  const invalid = rule('未填写或格式错误', [compare(input.validityKey, 'eq', false)], config.error)
  if (config.answerType === 'number') {
    if (!Number.isFinite(config.min) || !Number.isFinite(config.max) || config.min > config.max) throw new Error('数值答案范围无效')
    return [invalid,
      rule('回答正确', [valid, compare(input.stateKey, 'gte', config.min), compare(input.stateKey, 'lte', config.max)], config.correct),
      rule('数值偏小', [valid, compare(input.stateKey, 'lt', config.min)], config.error),
      rule('数值偏大', [valid, compare(input.stateKey, 'gt', config.max)], config.error),
    ]
  }
  const answers = config.answers.map(normalizeShortAnswer)
  if (!answers.length || answers.length > 15 || answers.some(answer => !answer) || new Set(answers).size !== answers.length) {
    throw new Error('文本答案需为 1–15 个非空且归一化后不重复的答案')
  }
  return [invalid,
    ...answers.map(answer => rule('回答正确', [valid, compare(input.stateKey, 'eq', answer)], config.correct)),
    rule('回答错误', [valid, ...answers.map(answer => compare(input.stateKey, 'neq', answer))], config.error),
  ]
}

function shape(rule: InteractionRule) {
  return { enabled: rule.enabled, trigger: rule.trigger, conditions: rule.conditions,
    actions: rule.actions.map(({ id: _id, ...step }) => step) }
}

export function inspectInputRuleFamily(nodeId: string, input: NativeInputContent, rules: readonly InteractionRule[]): {
  config: InputRuleConfig | null; conflict: boolean; managed: boolean
} {
  const family = input.ruleFamilyRuleIds.map(id => rules.find(rule => rule.id === id))
  const extra = rules.some(rule => rule.trigger.type === 'input.submit' && rule.trigger.nodeId === nodeId && !input.ruleFamilyRuleIds.includes(rule.id))
  if (!family.length || family.some(rule => !rule)) return { config: null, conflict: true, managed: family.length > 0 }
  const listed = family as InteractionRule[]
  const correct = listed[1]?.actions.map(step => step.action) ?? []
  const error = listed[0]!.actions.map(step => step.action)
  let config: InputRuleConfig
  if (input.answerType === 'text') {
    const answers = listed.slice(1, -1).map(rule => rule.conditions.find(condition =>
      condition.type === 'course-state.compare' && condition.key === input.stateKey && condition.operator === 'eq'))
    if (answers.some(condition => !condition || !('value' in condition) || typeof condition.value !== 'string')) return { config: null, conflict: true, managed: true }
    config = { answerType: 'text', answers: answers.map(condition => (condition as { value: string }).value), correct, error }
  } else {
    const bounds = listed[1]?.conditions.filter(condition => condition.type === 'course-state.compare' && condition.key === input.stateKey) ?? []
    const min = bounds.find(condition => condition.type === 'course-state.compare' && condition.operator === 'gte')
    const max = bounds.find(condition => condition.type === 'course-state.compare' && condition.operator === 'lte')
    if (!min || !max || !('value' in min) || !('value' in max) || typeof min.value !== 'number' || typeof max.value !== 'number') return { config: null, conflict: true, managed: true }
    config = { answerType: 'number', min: min.value, max: max.value, correct, error }
  }
  try {
    const expected = buildInputRuleFamily(nodeId, input, config, () => 'comparison')
    return { config, conflict: extra || JSON.stringify(listed.map(shape)) !== JSON.stringify(expected.map(shape)), managed: true }
  } catch { return { config: null, conflict: true, managed: true } }
}
