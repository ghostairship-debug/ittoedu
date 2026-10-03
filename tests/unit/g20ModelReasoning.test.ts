// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ModelConnectionSnapshot, ModelJsonObject } from '../../src/shared/workbench/modelProvider'
import { readModelReasoningEffort, resolveModelReasoning, withModelReasoning, readModelThinkingBudget, withModelThinkingBudget, withoutManagedModelReasoning } from '../../src/shared/workbench/modelReasoning'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'

const connection = (provider = 'teamorouter', protocol: ModelConnectionSnapshot['protocol'] = 'openai-chat'): ModelConnectionSnapshot => ({
  id: 'fixture-connection', revision: 1, provider, protocol, baseURL: 'https://fixture.invalid/v1',
  accountId: 'fixture-account', auth: { kind: protocol === 'chatgpt-responses' ? 'oauth' : 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
})
const choices = (model: string, provider = 'teamorouter', protocol: ModelConnectionSnapshot['protocol'] = 'openai-chat') =>
  resolveModelReasoning(connection(provider, protocol), { id: model }).choices.map(choice => choice.effort)

describe('documented model reasoning through any connection', () => {
  it('sets native thinking tokens and clears prior protocol controls without changing unrelated advanced parameters', () => {
    const resolved = resolveModelReasoning(connection('anthropic', 'anthropic-messages'), { id: 'claude-haiku-4-5' })
    const original = { temperature: 0.3, thinking: { display: 'summarized' }, max_tokens: 30000 }
    const enabled = withModelThinkingBudget(original, { type: 'enabled', budgetTokens: 12000 }, resolved)
    expect(readModelThinkingBudget(enabled, resolved)).toEqual({ type: 'enabled', budgetTokens: 12000 })
    expect(withModelThinkingBudget(enabled, { type: 'disabled' }, resolved)).toEqual({
      ...original, thinking: { display: 'summarized', type: 'disabled' },
    })
    expect(withModelThinkingBudget(enabled, undefined, resolved)).toEqual(original)
    expect(() => withModelThinkingBudget(original, { type: 'enabled', budgetTokens: 1023 }, resolved)).toThrow('1024')
    expect(withoutManagedModelReasoning({ ...enabled, reasoning: { effort: 'high', summary: 'auto' }, output_config: { effort: 'high', format: 'text' } }))
      .toEqual({ ...original, reasoning: { summary: 'auto' }, output_config: { format: 'text' } })
  })
  it('recognizes DeepSeek V4 aliases and upstream snapshots without changing the requested model', () => {
    for (const id of ['deepseek-flash', 'deepseek-pro', 'deepseek-v4-flash', 'deepseek-v4-pro',
      'deepseek-v4-1-flash-260910', 'deepseek-v4-flash-ga-260731', 'deepseek/DeepSeek-V4.1-Flash']) {
      for (const provider of ['teamorouter', 'deepseek', 'other-proxy']) {
        expect(resolveModelReasoning(connection(provider), { id })).toEqual({
          choices: [{ effort: 'none' }, { effort: 'low' }, { effort: 'high' }, { effort: 'max' }],
          source: 'documented', format: 'deepseek-thinking',
        })
      }
    }
  })

  it('gives each documented GPT family its supported efforts and protocol parameter format', () => {
    expect(choices('gpt-6-luna')).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(choices('openai/gpt-6-sol-2026-08-20')).toEqual(choices('gpt-6-sol', 'openai', 'chatgpt-responses'))
    expect(choices('gpt-6-astra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(choices('gpt-6.1-sol')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(choices('gpt-5.6-terra')).toEqual(choices('gpt-5.6-sol'))
    expect(choices('gpt-5')).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(choices('gpt-5.1')).toEqual(['none', 'low', 'medium', 'high'])
    expect(choices('gpt-5.2')).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
    expect(choices('gpt-5.4')).toEqual(choices('gpt-5.5'))
    expect(resolveModelReasoning(connection('openai', 'chatgpt-responses'), { id: 'gpt-6-sol' }).format).toBe('reasoning-object')
    expect(resolveModelReasoning(connection(), { id: 'gpt-6-sol' }).format).toBe('reasoning-effort')
    for (const id of ['gpt-6-astra', 'gpt-6.1-sol']) {
      expect(resolveModelReasoning(connection(), { id }).toolRequirement).toBe('responses')
    }
    for (const id of ['gpt-6-sol', 'openai/gpt-6-luna-2026-08-20']) {
      expect(resolveModelReasoning(connection(), { id }).toolRequirement).toBe('responses-when-thinking')
    }
    expect(resolveModelReasoning(connection(), { id: 'gpt-6-luna-custom' }).toolRequirement).toBeUndefined()
  })

  it('uses documented Gemini compatibility controls without inventing a thinking-off level', () => {
    expect(choices('gemini-3.8-flash')).toEqual(['low', 'medium', 'high'])
    expect(choices('gemini-3-pro-preview')).toEqual(['low', 'high'])
    expect(choices('gemini-3.1-pro-preview')).toEqual(['low', 'medium', 'high'])
    expect(choices('gemini-3-flash-preview')).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(choices('gemini-2.5-pro')).not.toContain('none')
    expect(choices('gemini-2.5-flash')).toEqual(['none', 'low', 'medium', 'high'])
    expect(choices('gemini-3.8-flash', 'openai', 'chatgpt-responses')).toEqual([])
  })

  it('preserves directory declarations, including an explicit empty list', () => {
    const declared = [{ effort: 'high' as const, description: 'Directory choice' }]
    expect(resolveModelReasoning(connection(), { id: 'deepseek-flash', reasoningEfforts: declared })).toEqual({
      choices: declared, source: 'directory', format: 'deepseek-thinking',
    })
    expect(resolveModelReasoning(connection('openai', 'chatgpt-responses'), { id: 'gpt-6-luna', reasoningEfforts: [] }))
      .toEqual({ choices: [], source: 'directory', format: 'reasoning-object', toolRequirement: 'responses-when-thinking' })
    expect(resolveModelReasoning(connection(), { id: 'gpt-6-astra', reasoningEfforts: [{ effort: 'high' }] }))
      .toEqual({ choices: [{ effort: 'high' }], source: 'directory', format: 'reasoning-effort', toolRequirement: 'responses' })
  })

  it('leaves undeclared variants and unverified Claude controls unknown', () => {
    for (const id of ['claude-sonnet-4-6', 'unknown-model', 'gpt-6-luna-custom', 'gpt-5.2-pro', 'deepseek-v3', 'deepseek-chat']) {
      expect(resolveModelReasoning(connection(), { id })).toEqual({ choices: [], source: 'unknown', format: 'unknown' })
    }
    expect(resolveModelReasoning({ ...connection(), capabilities: { ...connection().capabilities, reasoning: 'unsupported' } },
      { id: 'gpt-6-luna' }).source).toBe('unknown')
  })

  it('uses the connection-specific protocol for GPT and Claude without rewriting their requested IDs', () => {
    const teamo = { ...connection(), baseURL: 'https://api.teamorouter.com/v1' }
    expect(resolveModelReasoning(teamo, { id: 'gpt-6-sol' }).format).toBe('reasoning-object')
    expect(resolveModelReasoning(teamo, { id: 'claude-sonnet-4-6' })).toMatchObject({
      source: 'documented', format: 'anthropic-effort', thinkingMode: 'adaptive',
    })
    expect(choices('claude-sonnet-4-6', 'anthropic', 'anthropic-messages')).toEqual(['none', 'low', 'medium', 'high', 'max'])
    expect(choices('claude-opus-4-7', 'anthropic', 'anthropic-messages')).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(choices('anthropic/claude-opus-4-5-20251101', 'anthropic', 'anthropic-messages')).toEqual(['low', 'medium', 'high'])
    for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5']) {
      expect(choices(id, 'anthropic', 'anthropic-messages')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    }
    expect(teamo.protocol).toBe('openai-chat')
  })

  it('distinguishes GLM strength controls from older thinking switches', () => {
    for (const id of ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx']) {
      expect(choices(id)).toEqual(['low', 'high', 'max'])
    }
    expect(choices('glm-5.2')).toEqual(['none', 'high', 'max'])
    for (const id of ['glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4.6', 'glm-4.5-air']) {
      expect(resolveModelReasoning(connection(), { id })).toMatchObject({ kind: 'toggle', format: 'thinking-toggle',
        choices: [{ effort: 'none', label: '关闭' }, { effort: 'high', label: '开启' }] })
    }
    expect(resolveModelReasoning(connection(), { id: 'glm-5.4' }).source).toBe('unknown')
  })

  it('recognizes Kimi and Grok model controls without fabricating fixed-thinking or budget levels', () => {
    expect(choices('kimi-k3')).toEqual(['low', 'high', 'max'])
    expect(resolveModelReasoning(connection(), { id: 'kimi-k2.5' }).kind).toBe('toggle')
    expect(resolveModelReasoning(connection(), { id: 'kimi-k2.6' }).kind).toBe('toggle')
    for (const id of ['kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo']) {
      expect(resolveModelReasoning(connection(), { id })).toMatchObject({ choices: [], kind: 'fixed', source: 'documented' })
    }
    for (const id of ['claude-haiku-4-5', 'claude-sonnet-4-5']) {
      expect(resolveModelReasoning(connection('anthropic', 'anthropic-messages'), { id }))
        .toMatchObject({ choices: [], kind: 'budget', source: 'documented' })
    }
    expect(choices('grok-4.6')).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(choices('grok-4.5')).toEqual(['low', 'medium', 'high'])
    expect(resolveModelReasoning(connection('xai', 'openai-responses'), { id: 'grok-4.6' }).format).toBe('reasoning-object')
  })

  it('gives live directory choices priority over knowledge, and knowledge priority over fallback rules', () => {
    const model = { id: 'glm-5.3', metadata: { id: 'glm-5.3', reasoning: { kind: 'effort' as const,
      efforts: ['high' as const] } }, metadataSource: 'models.dev' as const }
    expect(resolveModelReasoning(connection(), model)).toMatchObject({ source: 'models.dev', kind: 'effort',
      format: 'thinking-effort', choices: [{ effort: 'high' }] })
    expect(resolveModelReasoning(connection(), { ...model, reasoningEfforts: [{ effort: 'max', description: 'Connection level' }] }))
      .toMatchObject({ source: 'directory', choices: [{ effort: 'max', description: 'Connection level' }] })
    expect(resolveModelReasoning(connection(), { ...model, reasoningEfforts: [] })).toMatchObject({ source: 'directory', choices: [] })
    const teamo = { ...connection(), baseURL: 'https://api.teamorouter.com/v1' }
    expect(resolveModelReasoning(teamo, { id: 'gpt-6-sol', metadata: { id: 'gpt-6-sol', reasoning: {
      kind: 'effort', efforts: ['high'], format: 'reasoning-effort' } }, metadataSource: 'models.dev' }))
      .toMatchObject({ source: 'models.dev', format: 'reasoning-object', choices: [{ effort: 'high' }] })
    expect(resolveModelReasoning(connection(), { id: 'unknown-model', metadata: { id: 'unknown-model',
      reasoning: { kind: 'fixed' } } })).toMatchObject({ source: 'models.dev', kind: 'fixed', choices: [] })
    expect(resolveModelReasoning(connection(), { id: 'unknown-toggle', metadata: { id: 'unknown-toggle',
      reasoning: { kind: 'toggle' } } })).toMatchObject({ source: 'models.dev', kind: 'toggle', format: 'unknown', choices: [] })
    expect(resolveModelReasoning(connection(), { id: 'toggle-with-format', metadata: { id: 'toggle-with-format',
      reasoning: { kind: 'toggle', format: 'enable-thinking' } } })).toMatchObject({ source: 'models.dev',
      kind: 'toggle', format: 'enable-thinking', choices: [{ effort: 'none', label: '关闭' }, { effort: 'high', label: '开启' }] })
  })
})

describe('reasoning parameter application', () => {
  it('enables, disables and restores DeepSeek defaults while preserving unrelated parameters', () => {
    const resolved = resolveModelReasoning(connection(), { id: 'deepseek-flash' })
    const original: ModelJsonObject = { temperature: 0.25, max_tokens: 24000,
      thinking: { type: 'disabled', custom: true }, reasoning: { effort: 'high', summary: 'auto' } }
    const low = withModelReasoning(original, 'low', resolved)
    expect(low).toEqual({ temperature: 0.25, max_tokens: 24000, thinking: { type: 'enabled', custom: true },
      reasoning: { summary: 'auto' }, reasoning_effort: 'low' })
    const none = withModelReasoning(low, 'none', resolved)
    expect(none).toEqual({ temperature: 0.25, max_tokens: 24000, thinking: { type: 'disabled', custom: true }, reasoning: { summary: 'auto' } })
    expect(withModelReasoning(none, undefined, resolved)).toEqual({ temperature: 0.25, max_tokens: 24000,
      thinking: { custom: true }, reasoning: { summary: 'auto' } })
    expect(original.thinking).toEqual({ type: 'disabled', custom: true })
    expect(original.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    expect(withModelReasoning({ thinking: { type: 'enabled' }, reasoning_effort: 'max' }, undefined, resolved)).toEqual({})
  })

  it('keeps Responses options and removes competing Chat Completions effort', () => {
    const resolved = resolveModelReasoning(connection('openai', 'chatgpt-responses'), { id: 'gpt-6-sol' })
    const parameters = withModelReasoning({ reasoning_effort: 'low', reasoning: { mode: 'pro', summary: 'auto' },
      service_tier: 'fast' }, 'xhigh', resolved)
    expect(parameters).toEqual({ reasoning: { mode: 'pro', summary: 'auto', effort: 'xhigh' }, service_tier: 'fast' })
    expect(withModelReasoning(parameters, undefined, resolved)).toEqual({ reasoning: { mode: 'pro', summary: 'auto' }, service_tier: 'fast' })
  })

  it('serializes model-specific Chat Completions controls into the actual credential-free request body', () => {
    for (const id of ['deepseek-flash', 'gpt-6-sol', 'gemini-3.8-flash']) {
      const resolved = resolveModelReasoning(connection(), { id })
      const parameters = withModelReasoning({ service_tier: 'auto' }, 'low', resolved)
      const body = JSON.parse(serializeModelRequest({ selection: { connection: connection(), model: id, parameters },
        messages: [{ role: 'user', content: 'Fixture only' }] }))
      expect(body).toMatchObject({ model: id, reasoning_effort: 'low', service_tier: 'auto', stream: true })
      if (id === 'deepseek-flash') expect(body.thinking).toEqual({ type: 'enabled' })
      else expect(body.thinking).toBeUndefined()
    }
  })

  it('serializes OAuth effort as the Responses object without conflicting legacy effort', () => {
    const oauth = { ...connection('openai', 'chatgpt-responses'), baseURL: CHATGPT_RESPONSES_BASE_URL }
    const resolved = resolveModelReasoning(oauth, { id: 'gpt-6-luna' })
    const parameters = withModelReasoning({ reasoning_effort: 'low', reasoning: { summary: 'auto' } }, 'high', resolved)
    const body = JSON.parse(serializeChatGPTResponsesRequest({ selection: { connection: oauth, model: 'gpt-6-luna', parameters },
      messages: [{ role: 'user', content: 'Fixture only' }] }))
    expect(body.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('does not invent unsupported choices and preserves advanced options for unknown models', () => {
    const resolved = resolveModelReasoning(connection(), { id: 'claude-unknown' })
    const advanced = { thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, temperature: 0.2,
      reasoning_effort: 'high', reasoning: { effort: 'low', summary: 'auto' } }
    expect(withModelReasoning(advanced, undefined, resolved)).toEqual(advanced)
    expect(withModelReasoning(advanced, undefined, resolved)).not.toBe(advanced)
    expect(() => withModelReasoning(advanced, 'high', resolved)).toThrow('invalid-reasoning-effort')
  })

  it('applies GLM toggle and strength fields and reads their actual selected controls', () => {
    const toggle = resolveModelReasoning(connection(), { id: 'glm-4.7' })
    const enabled = withModelReasoning({ temperature: 0.2, thinking: { clear_thinking: false }, reasoning_effort: 'max' }, 'high', toggle)
    expect(enabled).toEqual({ temperature: 0.2, thinking: { clear_thinking: false, type: 'enabled' } })
    expect(readModelReasoningEffort(enabled, toggle)).toBe('high')
    expect(readModelReasoningEffort(withModelReasoning(enabled, 'none', toggle), toggle)).toBe('none')
    const strength = resolveModelReasoning(connection(), { id: 'glm-5.2' })
    const high = withModelReasoning({ thinking: { clear_thinking: false } }, 'high', strength)
    expect(high).toEqual({ thinking: { clear_thinking: false, type: 'enabled' }, reasoning_effort: 'high' })
    expect(readModelReasoningEffort(high, strength)).toBe('high')
    expect(withModelReasoning(high, 'none', strength)).toEqual({ thinking: { clear_thinking: false, type: 'disabled' } })
    expect(() => withModelReasoning({}, 'none', resolveModelReasoning(connection(), { id: 'glm-5.3' })))
      .toThrow('invalid-reasoning-effort')
    const boolToggle = resolveModelReasoning(connection(), { id: 'toggle-with-format', metadata: { id: 'toggle-with-format',
      reasoning: { kind: 'toggle', format: 'enable-thinking' } } })
    const boolParameters = withModelReasoning({ seed: 42 }, 'none', boolToggle)
    expect(boolParameters).toEqual({ seed: 42, enable_thinking: false })
    expect(readModelReasoningEffort(boolParameters, boolToggle)).toBe('none')
  })

  it('writes Claude adaptive thinking and effort while retaining unrelated output and display options', () => {
    const resolved = resolveModelReasoning(connection('anthropic', 'anthropic-messages'), { id: 'claude-opus-4-7' })
    const parameters = { thinking: { type: 'enabled', budget_tokens: 8000, display: 'summarized' },
      output_config: { format: { type: 'json_schema' }, effort: 'medium' }, reasoning_effort: 'high',
      reasoning: { effort: 'low', summary: 'auto' }, temperature: 0.5 }
    const applied = withModelReasoning(parameters, 'xhigh', resolved)
    expect(applied).toEqual({ thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { format: { type: 'json_schema' }, effort: 'xhigh' }, reasoning: { summary: 'auto' }, temperature: 0.5 })
    expect(parameters.thinking.budget_tokens).toBe(8000)
    expect(readModelReasoningEffort(applied, resolved)).toBe('xhigh')
    const disabled = withModelReasoning(applied, 'none', resolved)
    expect(disabled.thinking).toEqual({ type: 'disabled', display: 'summarized' })
    expect(disabled.output_config).toEqual({ format: { type: 'json_schema' } })
    expect(readModelReasoningEffort(disabled, resolved)).toBe('none')
    expect(withModelReasoning(disabled, undefined, resolved).thinking).toEqual({ display: 'summarized' })
    const legacy = resolveModelReasoning(connection('anthropic', 'anthropic-messages'), { id: 'claude-opus-4-5' })
    expect(withModelReasoning({ thinking: { type: 'enabled', budget_tokens: 8000 } }, 'high', legacy))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 8000 }, output_config: { effort: 'high' } })
  })

  it('preserves manually configured budgets and fixed-thinking parameters, and never fabricates token limits', () => {
    const budget = resolveModelReasoning(connection('anthropic', 'anthropic-messages'), { id: 'claude-haiku-4-5' })
    const original = { thinking: { type: 'enabled', budget_tokens: 12000 }, max_tokens: 30000 }
    expect(withModelReasoning(original, undefined, budget)).toEqual(original)
    expect(readModelReasoningEffort(original, budget)).toBeUndefined()
    const fixed = resolveModelReasoning(connection(), { id: 'kimi-k2.7-code' })
    expect(withModelReasoning({ thinking: { keep: 'all' } }, undefined, fixed)).toEqual({ thinking: { keep: 'all' } })
    const grok = resolveModelReasoning(connection(), { id: 'grok-4.6' })
    const parameters = withModelReasoning({}, 'xhigh', grok)
    expect(parameters).toEqual({ reasoning_effort: 'xhigh' })
    expect(readModelReasoningEffort(parameters, grok)).toBe('xhigh')
    const body = JSON.parse(serializeModelRequest({ selection: { connection: connection(), model: 'grok-4.6', parameters },
      messages: [{ role: 'user', content: 'Fixture only' }] }))
    expect(body.reasoning_effort).toBe('xhigh')
    expect(body.max_tokens).toBeUndefined()
  })
})
