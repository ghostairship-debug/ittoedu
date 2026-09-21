import type { Page } from '@playwright/test'
import type {
  LocalAgentCapabilities,
  LocalAgentConfiguration,
  LocalAgentId,
} from '../../../src/shared/localAgentContract'

export type R18AiTestAdapter = LocalAgentId
type NativeModel = LocalAgentCapabilities['models'][number]

export interface R18AiTestRoute {
  adapter: R18AiTestAdapter
  model: string
  resolvedModel: string | null
  effort: string | null
  serviceTier: string | null
}

function preferredEffort(adapter: R18AiTestAdapter, model: NativeModel): string | null {
  const effort = model.effort
  if (effort.kind !== 'supported') return null
  const preferred = adapter === 'claude'
    ? ['high', 'medium', 'low']
    : ['max', 'medium', 'high', 'low']
  return preferred.find(value => effort.values.includes(value))
    ?? effort.default
    ?? effort.values[0]
    ?? null
}

function fastTier(model: NativeModel): string | null {
  return model.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))?.id ?? null
}

function selectModel(capabilities: LocalAgentCapabilities, adapter: R18AiTestAdapter): NativeModel | undefined {
  const models = capabilities.models
  if (adapter === 'claude') {
    return models.find(model => model.id.toLowerCase() === 'deepseek-flash[1m]'
      && /deepseek/i.test(model.resolvedModel ?? ''))
  }
  if (adapter === 'codex') {
    return models.find(model => model.id === 'gpt-5.6-luna')
  }
  return models.find(model => model.id === 'openai/gpt-5.6-luna-fast')
    ?? models.find(model => model.id === 'openai/gpt-5.6-luna')
}

function requireCapabilities(response: Awaited<ReturnType<Window['desktopAPI']['localAgent']>>, adapter: R18AiTestAdapter) {
  if (!response.capabilities) throw new Error(`${adapter} native capability directory is unavailable`)
  return response.capabilities
}

/**
 * Configure one of the explicitly authorized native routes without starting a turn.
 * The returned route is safe to record in test evidence; it contains no credentials.
 */
export async function configureR18AiTestModel(page: Page, adapter: R18AiTestAdapter): Promise<R18AiTestRoute> {
  const listed = await page.evaluate(adapterName => window.desktopAPI!.localAgent({
    operation: 'capabilities', adapter: adapterName, refresh: true,
  }), adapter)
  let capabilities = requireCapabilities(listed, adapter)
  let model = selectModel(capabilities, adapter)
  if (!model) throw new Error(`${adapter} native directory does not expose an authorized model`)

  // OpenCode may expose effort values only after its Luna model is selected.
  if (adapter === 'opencode' && model.effort.kind === 'unknown') {
    const selected = await page.evaluate(({ adapter: adapterName, modelId }) => window.desktopAPI!.localAgent({
      operation: 'configure', adapter: adapterName, configuration: { model: modelId, effort: null },
    }), { adapter, modelId: model.id })
    capabilities = requireCapabilities(selected, adapter)
    model = selectModel(capabilities, adapter)
    if (!model) throw new Error('OpenCode lost its authorized Luna model after selection')
  }

  if (adapter === 'claude' && !/deepseek/i.test(model.resolvedModel ?? model.id)) {
    throw new Error('Claude route is not the confirmed DeepSeek model')
  }
  if (adapter !== 'claude' && !/luna/i.test(model.id)) {
    throw new Error(`${adapter} route is outside the authorized Luna family`)
  }

  const tier = fastTier(model)
  if (adapter === 'codex' && (model.effort.kind !== 'supported' || !model.effort.values.includes('max'))) {
    throw new Error('Codex Luna does not expose the required max effort')
  }

  const configuration: LocalAgentConfiguration = {
    model: model.id,
    effort: preferredEffort(adapter, model),
    ...(tier ? { serviceTier: tier } : {}),
  }
  const configured = await page.evaluate(({ adapter: adapterName, configuration: next }) => window.desktopAPI!.localAgent({
    operation: 'configure', adapter: adapterName, configuration: next,
  }), { adapter, configuration })
  if (!configured.enabled) throw new Error(`${adapter} native route could not be configured`)

  return {
    adapter,
    model: model.id,
    resolvedModel: model.resolvedModel,
    effort: configuration.effort,
    serviceTier: configuration.serviceTier ?? null,
  }
}
