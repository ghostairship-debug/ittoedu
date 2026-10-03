import type { ModelConnectionSnapshot, ModelSelection } from './modelProvider'

export type ModelApiProtocol = ModelConnectionSnapshot['protocol']
export function isTeamoRouter(connection: Pick<ModelConnectionSnapshot, 'baseURL'>): boolean {
  try { return ['api.teamorouter.com', 'api.teamorouter.cn'].includes(new URL(connection.baseURL).hostname.toLowerCase()) }
  catch { return false }
}
/** Pick a documented endpoint within the same connection; never rewrite credentials or requested IDs. */
export function resolveModelProtocol(connection: ModelConnectionSnapshot, model: string): ModelApiProtocol {
  if (connection.protocol !== 'openai-chat' || connection.auth.kind !== 'api-key') return connection.protocol
  if (isTeamoRouter(connection)) {
    const id = model.toLowerCase().split('/').at(-1)!
    if (id.startsWith('claude-')) return 'anthropic-messages'
    if (/^gpt-(?:6(?:[.-]1)?-(?:astra|sol|luna)|5(?:\.|-))/.test(id) && !id.startsWith('gpt-image-')) return 'openai-responses'
  }
  return connection.protocol
}
export const effectiveModelProtocol = (selection: Pick<ModelSelection, 'connection' | 'model' | 'apiProtocol' | 'capabilityModel'>): ModelApiProtocol =>
  selection.apiProtocol ?? resolveModelProtocol(selection.connection, selection.capabilityModel ?? selection.model)
