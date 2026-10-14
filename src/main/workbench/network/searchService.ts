import type { ModelConnectionSnapshot, ModelProvider } from '../../../shared/workbench/modelProvider'
import { DeepSeekSearchProvider } from './DeepSeekSearchProvider'
import { OpenAISearchProvider } from './OpenAISearchProvider'
import { McpSearchProvider } from './McpSearchProvider'
import { SearxngSearchProvider } from './SearxngSearchProvider'
import { SearchRouter } from './SearchRouter'
export function createSearchRouter(options: { provider: ModelProvider; credential(connection: Readonly<ModelConnectionSnapshot>): Promise<string>; fetch?: typeof fetch; observeCapability?(selection: import('../../../shared/workbench/modelProvider').ModelSelection, status: 'supported' | 'unsupported', actualModel?: string): Promise<void> }): SearchRouter {
  const search: SearchRouter = new SearchRouter({
    openai: new OpenAISearchProvider({ selection: runId => search.selection(runId)?.openai ?? null, provider: options.provider, observeCapability: options.observeCapability }),
    deepseek: new DeepSeekSearchProvider({ selection: runId => search.selection(runId)?.deepseek ?? null, credential: options.credential, fetch: options.fetch }),
    independent: frozen => frozen.settings.independent === 'searxng'
      ? new SearxngSearchProvider({ url: frozen.settings.searxngURL, fetch: options.fetch }) : new McpSearchProvider(),
  })
  return search
}
