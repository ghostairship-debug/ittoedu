import type { DiscoveredModel, DiscoveredReasoningEffort } from './executionSettingsDesktop'
import type { ModelConnectionSnapshot, ModelJson, ModelJsonObject } from './modelProvider'
import type { ModelKnowledgeEntry, ModelReasoningFormat } from './modelKnowledge'
import { resolveModelProtocol } from './modelRouting'

export type { ModelReasoningFormat } from './modelKnowledge'
export interface ResolvedModelReasoning {
  choices: { effort: DiscoveredReasoningEffort; label?: string; description?: string }[]
  /** Documentation describes the upstream model, not a successful probe of this connection. */
  source: 'directory' | 'models.dev' | 'documented' | 'unknown'
  format: ModelReasoningFormat
  kind?: NonNullable<ModelKnowledgeEntry['reasoning']>['kind']
  /** Legacy Claude effort also works without thinking; adaptive is model-specific. */
  thinkingMode?: 'adaptive'
  /** Official upstream tool-calling requirement; does not assert a proxy's protocol conversion. */
  toolRequirement?: 'responses' | 'responses-when-thinking'
}
type ReasoningConnection = ModelConnectionSnapshot
const fullEfforts: readonly DiscoveredReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
const deepEfforts: readonly DiscoveredReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Exact model families and dated snapshots only; names of future variants do not inherit capabilities.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/models/gpt-6-sol
// https://developers.openai.com/api/docs/models/gpt-6-astra
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/models/gpt-5.6-sol
// https://developers.openai.com/api/docs/models/gpt-5.6-terra
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://developers.openai.com/api/docs/models/gpt-5.5
// https://developers.openai.com/api/docs/models/gpt-5.4
// https://developers.openai.com/api/docs/models/gpt-5.2
// https://developers.openai.com/api/docs/models/gpt-5.1
// https://developers.openai.com/api/docs/models/gpt-5
const openAIEfforts: Readonly<Record<string, readonly DiscoveredReasoningEffort[]>> = {
  'gpt-6-luna': fullEfforts,
  'gpt-6-sol': fullEfforts,
  'gpt-6-astra': deepEfforts,
  'gpt-6.1-sol': deepEfforts,
  'gpt-5.6-sol': fullEfforts,
  'gpt-5.6-terra': fullEfforts,
  'gpt-5.6-luna': fullEfforts,
  'gpt-5.5': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.4': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.2': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.1': ['none', 'low', 'medium', 'high'],
  'gpt-5': ['minimal', 'low', 'medium', 'high'],
}
// https://developers.openai.com/api/docs/guides/latest-model
const openAIToolRequirements: Readonly<Record<string, NonNullable<ResolvedModelReasoning['toolRequirement']>>> = {
  'gpt-6-astra': 'responses',
  'gpt-6.1-sol': 'responses',
  'gpt-6-sol': 'responses-when-thinking',
  'gpt-6-luna': 'responses-when-thinking',
}

// OpenAI-compatible effort maps to the model's documented thinking levels/budgets.
// https://ai.google.dev/gemini-api/docs/openai
// https://ai.google.dev/gemini-api/docs/thinking
const geminiEfforts: Readonly<Record<string, readonly DiscoveredReasoningEffort[]>> = {
  'gemini-3.8-flash': ['low', 'medium', 'high'],
  'gemini-3.7-flash': ['low', 'medium', 'high'],
  'gemini-3.6-flash': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.5-flash': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.5-flash-lite': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.1-flash-lite': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.1-pro': ['low', 'medium', 'high'],
  'gemini-3-flash': ['minimal', 'low', 'medium', 'high'],
  'gemini-3-pro': ['low', 'high'],
  'gemini-2.5-pro': ['low', 'medium', 'high'],
  'gemini-2.5-flash': ['none', 'low', 'medium', 'high'],
  'gemini-2.5-flash-lite': ['none', 'low', 'medium', 'high'],
}

function modelFamily(id: string): string {
  return id.toLowerCase().split('/').at(-1)!.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '')
}
function isDeepSeekV4(id: string): boolean {
  return /^deepseek-(?:flash|pro|v4(?:[.-]1)?-(?:flash|pro))(?:-(?:ga-)?\d{6})?$/.test(id)
}

const toggleChoices: ResolvedModelReasoning['choices'] = [{ effort: 'none', label: '关闭' }, { effort: 'high', label: '开启' }]
const effortChoices = (efforts: readonly DiscoveredReasoningEffort[]): ResolvedModelReasoning['choices'] => efforts.map(effort => ({ effort }))

// https://platform.claude.com/docs/en/build-with-claude/effort
// https://platform.claude.com/docs/en/build-with-claude/thinking
const claudeAdaptiveEfforts: Readonly<Record<string, readonly DiscoveredReasoningEffort[]>> = {
  'claude-opus-4-6': ['none', 'low', 'medium', 'high', 'max'],
  'claude-sonnet-4-6': ['none', 'low', 'medium', 'high', 'max'],
  'claude-opus-4-7': fullEfforts,
  'claude-opus-4-8': fullEfforts,
  'claude-opus-5': fullEfforts,
  'claude-sonnet-5': fullEfforts,
  'claude-opus-5-5': deepEfforts,
  'claude-sonnet-5-5': deepEfforts,
  'claude-fable-5': deepEfforts,
  'claude-fable-5-1': deepEfforts,
  'claude-mythos-5': deepEfforts,
  'claude-mythos-5-1': deepEfforts,
  'claude-mythos-preview': ['low', 'medium', 'high', 'max'],
}

function documentedReasoning(family: string, protocol: ModelConnectionSnapshot['protocol']):
  Omit<ResolvedModelReasoning, 'source' | 'toolRequirement'> | undefined {
  const isChat = protocol === 'openai-chat'
  const effortFormat = isChat ? 'reasoning-effort' : 'reasoning-object'
  if (protocol === 'anthropic-messages') {
    const efforts = claudeAdaptiveEfforts[family]
    if (efforts) return { choices: effortChoices(efforts), format: 'anthropic-effort', thinkingMode: 'adaptive' }
    if (family === 'claude-opus-4-5') return { choices: effortChoices(['low', 'medium', 'high']), format: 'anthropic-effort' }
    if (/^claude-(?:sonnet|haiku)-4-5$/.test(family) || /^claude-(?:opus|sonnet)-4-0$/.test(family)
      || family === 'claude-opus-4-1' || family === 'claude-3-7-sonnet') {
      return { choices: [], format: 'anthropic-budget', kind: 'budget' }
    }
    return undefined
  }
  if (openAIEfforts[family]) return { choices: effortChoices(openAIEfforts[family]), format: effortFormat }
  // https://docs.x.ai/developers/model-capabilities/text/reasoning
  if (protocol === 'openai-responses' && /^grok-4\.[567]$/.test(family)) {
    return { choices: effortChoices(family === 'grok-4.5' ? ['low', 'medium', 'high'] : ['low', 'medium', 'high', 'xhigh']),
      format: 'reasoning-object' }
  }
  if (!isChat) return undefined
  // https://api-docs.deepseek.com/guides/thinking_mode/
  if (isDeepSeekV4(family)) return { choices: effortChoices(['none', 'low', 'high', 'max']), format: 'deepseek-thinking' }
  if (geminiEfforts[family.replace(/-preview$/, '')]) {
    return { choices: effortChoices(geminiEfforts[family.replace(/-preview$/, '')]), format: 'reasoning-effort' }
  }
  // https://docs.bigmodel.cn/cn/guide/capabilities/thinking
  if (/^glm-5\.3(?:-flashx?)?$/.test(family)) return { choices: effortChoices(['low', 'high', 'max']), format: 'thinking-effort' }
  if (family === 'glm-5.2') return { choices: effortChoices(['none', 'high', 'max']), format: 'thinking-effort' }
  if (/^glm-(?:5(?:\.1)?(?:-turbo)?|5v-turbo|4\.(?:5(?:v|-(?:air|x|airx|flash))?|6(?:v(?:-flashx?)?)?|7(?:-flash)?))$/.test(family)) {
    return { choices: toggleChoices.map(choice => ({ ...choice })), format: 'thinking-toggle', kind: 'toggle' }
  }
  // https://platform.kimi.ai/docs/api/models-overview
  // https://github.com/MoonshotAI/Kimi-K2.5
  if (family === 'kimi-k3') return { choices: effortChoices(['low', 'high', 'max']), format: 'reasoning-effort' }
  if (/^kimi-k2\.[56]$/.test(family)) return { choices: toggleChoices.map(choice => ({ ...choice })), format: 'thinking-toggle', kind: 'toggle' }
  if (/^kimi-k2(?:\.7-code(?:-highspeed)?|-thinking(?:-turbo)?)$/.test(family)) {
    return { choices: [], format: 'unknown', kind: 'fixed' }
  }
  // Chat REST declares reasoning_effort; model guide supplies the per-model levels.
  // https://docs.x.ai/developers/rest-api-reference/inference/chat-completions.md
  // https://docs.x.ai/developers/model-capabilities/text/reasoning
  if (/^grok-4\.[67]$/.test(family)) return { choices: effortChoices(['low', 'medium', 'high', 'xhigh']), format: 'reasoning-effort' }
  if (family === 'grok-4.5') return { choices: effortChoices(['low', 'medium', 'high']), format: 'reasoning-effort' }
  return undefined
}

/** Connection declarations win over catalog knowledge and documented model-family fallbacks. */
export function resolveModelReasoning(connection: ReasoningConnection, model: DiscoveredModel): ResolvedModelReasoning {
  const family = modelFamily(model.metadata?.id ?? model.id)
  const protocol = resolveModelProtocol(connection, model.metadata?.id ?? model.id)
  const toolRequirement = openAIToolRequirements[family]
  const toolControl = toolRequirement ? { toolRequirement } : {}
  const documented = documentedReasoning(family, protocol)
  const defaultFormat: ModelReasoningFormat = protocol === 'anthropic-messages' ? 'anthropic-effort'
    : protocol === 'openai-chat' ? 'reasoning-effort' : 'reasoning-object'
  const metadata = model.metadata?.reasoning
  const format: ModelReasoningFormat = metadata?.format ?? (metadata?.kind === 'toggle'
    ? documented?.kind === 'toggle' ? documented.format : 'unknown'
    : metadata?.kind === 'effort' && documented?.kind ? defaultFormat : documented?.format ?? defaultFormat)
  if (model.reasoningEfforts !== undefined) {
    return { choices: model.reasoningEfforts.map(choice => ({ ...choice })), source: 'directory',
      format: protocol === 'openai-responses' || protocol === 'chatgpt-responses' ? 'reasoning-object'
        : documented?.kind === 'toggle' || documented?.kind === 'fixed' || documented?.kind === 'budget' ? defaultFormat : format,
      ...(documented?.thinkingMode ? { thinkingMode: documented.thinkingMode } : {}), ...toolControl }
  }
  if (metadata) {
    const choices = metadata.kind === 'toggle' ? format !== 'unknown' ? toggleChoices.map(choice => ({ ...choice })) : []
      : metadata.kind === 'effort' ? effortChoices(metadata.efforts ?? []) : []
    return { choices, source: model.metadataSource ?? 'models.dev', kind: metadata.kind,
      format: metadata.kind === 'budget' ? protocol === 'anthropic-messages' ? 'anthropic-budget' : 'unknown'
        : metadata.kind === 'fixed' ? 'unknown'
        : metadata.kind === 'effort' && (protocol === 'openai-responses' || protocol === 'chatgpt-responses') ? 'reasoning-object' : format,
      ...(documented?.thinkingMode ? { thinkingMode: documented.thinkingMode } : {}), ...toolControl }
  }
  if (connection.capabilities.reasoning !== 'unsupported' && documented) {
    return { ...documented, source: 'documented', ...toolControl }
  }
  return { choices: [], source: 'unknown', format: 'unknown', ...toolControl }
}

const object = (value: ModelJson | undefined): ModelJsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined

/** Read the selected control using the same wire format used to apply it. */
export function readModelReasoningEffort(parameters: ModelJsonObject | undefined,
  resolved: ResolvedModelReasoning): DiscoveredReasoningEffort | undefined {
  if (!parameters) return undefined
  let value: ModelJson | undefined
  if (resolved.format === 'deepseek-thinking' || resolved.format === 'thinking-effort' || resolved.format === 'thinking-toggle') {
    const thinking = object(parameters.thinking)
    value = thinking?.type === 'disabled' ? 'none'
      : resolved.format === 'thinking-toggle' && thinking?.type === 'enabled' ? 'high' : parameters.reasoning_effort
  } else if (resolved.format === 'enable-thinking') {
    value = parameters.enable_thinking === false ? 'none' : parameters.enable_thinking === true ? 'high' : undefined
  } else if (resolved.format === 'anthropic-effort') {
    value = object(parameters.thinking)?.type === 'disabled' ? 'none' : object(parameters.output_config)?.effort
  } else if (resolved.format === 'reasoning-object') value = object(parameters.reasoning)?.effort
  else if (resolved.format === 'reasoning-effort') value = parameters.reasoning_effort
  return resolved.choices.find(choice => choice.effort === value)?.effort
}

function removeField(parameters: ModelJsonObject, key: string, field: string): void {
  const current = object(parameters[key])
  if (!current || !Object.hasOwn(current, field)) return
  const remaining = { ...current }
  delete remaining[field]
  if (Object.keys(remaining).length) parameters[key] = remaining
  else delete parameters[key]
}

/** A new capability reference starts with its own protocol controls. */
export function withoutManagedModelReasoning(parameters: ModelJsonObject): ModelJsonObject {
  const next = { ...parameters }
  delete next.reasoning_effort; delete next.enable_thinking
  removeField(next, 'reasoning', 'effort'); removeField(next, 'output_config', 'effort')
  removeField(next, 'thinking', 'type'); removeField(next, 'thinking', 'budget_tokens')
  return next
}

export type ModelThinkingBudget = { type: 'disabled' } | { type: 'enabled'; budgetTokens: number }
export function readModelThinkingBudget(parameters: ModelJsonObject | undefined,
  resolved: ResolvedModelReasoning): ModelThinkingBudget | undefined {
  if (resolved.format !== 'anthropic-budget') return undefined
  const thinking = object(parameters?.thinking)
  if (thinking?.type === 'disabled') return { type: 'disabled' }
  if (thinking?.type === 'enabled' && typeof thinking.budget_tokens === 'number')
    return { type: 'enabled', budgetTokens: thinking.budget_tokens }
  return undefined
}

/** This is Anthropic's required reasoning parameter, independent of agent task limits. */
export function withModelThinkingBudget(parameters: ModelJsonObject, setting: ModelThinkingBudget | undefined,
  resolved: ResolvedModelReasoning): ModelJsonObject {
  if (resolved.format !== 'anthropic-budget') throw new Error('unsupported-thinking-budget')
  if (setting?.type === 'enabled' && (!Number.isSafeInteger(setting.budgetTokens) || setting.budgetTokens < 1024))
    throw new Error('思考 token 数需为不小于 1024 的整数（Anthropic API 要求）。')
  const next = withModelReasoning(parameters, undefined, resolved)
  removeField(next, 'thinking', 'type'); removeField(next, 'thinking', 'budget_tokens')
  if (setting) next.thinking = { ...object(next.thinking), type: setting.type,
    ...(setting.type === 'enabled' ? { budget_tokens: setting.budgetTokens } : {}) }
  return next
}

/** Change only the managed reasoning controls; keep all unrelated advanced parameters. */
export function withModelReasoning(parameters: ModelJsonObject, effort: DiscoveredReasoningEffort | undefined,
  resolved: ResolvedModelReasoning): ModelJsonObject {
  if (resolved.format === 'unknown' && effort === undefined) return { ...parameters }
  const next = { ...parameters }
  if (effort !== undefined && !resolved.choices.some(choice => choice.effort === effort)) {
    throw new Error('invalid-reasoning-effort')
  }
  delete next.reasoning_effort
  removeField(next, 'reasoning', 'effort')
  removeField(next, 'output_config', 'effort')
  if (resolved.format === 'deepseek-thinking' || resolved.format === 'thinking-effort' || resolved.format === 'thinking-toggle') {
    removeField(next, 'thinking', 'type')
    if (effort !== undefined) {
      next.thinking = { ...object(next.thinking), type: effort === 'none' ? 'disabled' : 'enabled' }
      if (effort !== 'none' && resolved.format !== 'thinking-toggle') next.reasoning_effort = effort
    }
  } else if (resolved.format === 'enable-thinking') {
    delete next.enable_thinking
    if (effort !== undefined) next.enable_thinking = effort !== 'none'
  } else if (resolved.format === 'anthropic-effort') {
    if (resolved.thinkingMode === 'adaptive') {
      removeField(next, 'thinking', 'type')
      if (effort !== undefined) {
        removeField(next, 'thinking', 'budget_tokens')
        next.thinking = { ...object(next.thinking), type: effort === 'none' ? 'disabled' : 'adaptive' }
      }
    }
    if (effort !== undefined && effort !== 'none') next.output_config = { ...object(next.output_config), effort }
  } else if (effort !== undefined) {
    if (resolved.format === 'reasoning-object') next.reasoning = { ...object(next.reasoning), effort }
    else next.reasoning_effort = effort
  }
  return next
}
