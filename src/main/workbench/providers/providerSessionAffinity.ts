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

/** OAuth transport affinity only. This is a cache/routing hint, never authority,
 * a body cache parameter, a credential, or native response continuation. */
export function providerSessionAffinityHeaders(request: Pick<ModelRequest, 'selection' | 'sessionAffinity'>): { 'session-id'?: string } {
  const { selection, sessionAffinity } = request, { connection } = selection
  if (!sessionAffinity?.key || connection.auth.kind !== 'oauth' || connection.provider !== 'openai'
    || connection.protocol !== 'chatgpt-responses' || effectiveModelProtocol(selection) !== 'chatgpt-responses'
    || connection.baseURL !== 'https://chatgpt.com/backend-api/codex'
    || !connection.id || !Number.isSafeInteger(connection.revision) || connection.revision < 1
    || !connection.accountId || !connection.auth.credentialRef || !selection.model) return {}
  const scope = ['guoling:chatgpt-session-affinity:v1', sessionAffinity.key, connection.id, connection.revision,
    connection.accountId, connection.auth.credentialRef, connection.baseURL, connection.protocol, selection.model]
  // Deterministic namespace UUID: opaque on the wire and stable after cold resume.
  // The exact frozen credentialRef changes on a new login/configuration revision;
  // ordinary token refresh updates the existing credential owner, not this scope.
  // SHA-1 is used only for UUID v5 naming, never for authorization or token storage.
  const bytes = createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
    .update(JSON.stringify(scope)).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const value = bytes.toString('hex')
  return { 'session-id': `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}` }
}
