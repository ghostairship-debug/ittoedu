import { createHash } from 'node:crypto'
import type { ModelRequest } from '../../../shared/workbench/modelProvider'
import { effectiveModelProtocol } from '../../../shared/workbench/modelRouting'

/** Host defaults only. Native user parameters keep precedence in each adapter. */
export function providerSessionCacheParameters(request: Pick<ModelRequest, 'selection' | 'sessionAffinity'>): { prompt_cache_key?: string } {
  const { selection, sessionAffinity } = request
  if (!sessionAffinity?.key || selection.connection.auth.kind !== 'api-key') return {}
  const protocol = effectiveModelProtocol(selection)
  if (protocol !== 'openai-chat' && protocol !== 'openai-responses') return {}
  const endpoint = new URL(selection.connection.baseURL)
  // Public API support does not establish support for OAuth or compatible relays.
  if (endpoint.origin !== 'https://api.openai.com' || endpoint.pathname.replace(/\/+$/, '') !== '/v1') return {}
  const model = selection.capabilityModel ?? selection.model
  if (!/^(?:gpt-(?:4o(?:-|$)|4\.1(?:-|$)|[56](?:[.-]|$))|o[134](?:-|$))/.test(model)) return {}
  const { connection } = selection
  const scope = [sessionAffinity.key, connection.accountId, connection.auth.credentialRef, endpoint.origin,
    endpoint.pathname.replace(/\/+$/, ''), protocol, selection.model]
  return { prompt_cache_key: createHash('sha256').update(JSON.stringify(scope)).digest('hex') }
}
