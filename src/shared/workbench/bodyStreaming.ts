import type { ModelJson, ModelSelection } from './modelProvider'
import type { ExecutionRoleSelection, ExecutionSettingsView } from './executionSettings'

/** Observations of document tool arguments, never inferred from chat/SSE capability flags. */
export interface BodyStreamingObservation {
  requestId: string
  operationId: string
  observedAt: number
  result: 'progressive' | 'operation-only'
}
export interface BodyStreamingRecord {
  connectionId: string
  connectionRevision: number
  model: string
  parametersKey: string
  latest: BodyStreamingObservation
  progressive?: BodyStreamingObservation
}
function canonical(value: ModelJson): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function bodyStreamingIdentity(selection: ModelSelection): Omit<BodyStreamingRecord, 'latest' | 'progressive'> {
  return { connectionId: selection.connection.id, connectionRevision: selection.connection.revision,
    model: selection.model, parametersKey: canonical(selection.parameters ?? {}) }
}
export function bodyStreamingRecord(records: readonly BodyStreamingRecord[], selection: ModelSelection): BodyStreamingRecord | undefined {
  const key = bodyStreamingIdentity(selection)
  return records.find(value => value.connectionId === key.connectionId && value.connectionRevision === key.connectionRevision
    && value.model === key.model && value.parametersKey === key.parametersKey)
}
export function bodyStreamingLabel(record?: BodyStreamingRecord): string {
  if (!record) return '正文增量：尚未验证（聊天流不代表正文流）'
  if (record.latest.result === 'operation-only') return `最近一次正文修改仅完整操作更新${record.progressive ? '；此前观察到正文增量' : '；尚无正文增量证据'}，不代表模型永久不支持`
  return '正文增量：已在实际修改中观察到（不保证每次请求）'
}
export function configuredBodyStreamingAlternatives(settings: ExecutionSettingsView, current?: ModelSelection): ExecutionRoleSelection[] {
  const seen = new Set<string>()
  return Object.values(settings.profile.roles).filter((value): value is ExecutionRoleSelection => {
    if (!value) return false
    const entry = settings.connections.find(entry => entry.connection.id === value.connectionId)
    if (!entry?.hasCredential || entry.revoked || entry.connection.capabilities.tools === 'unsupported') return false
    const selection = { connection: entry.connection, model: value.model, parameters: value.parameters }
    const key = JSON.stringify(bodyStreamingIdentity(selection))
    if (seen.has(key) || current && key === JSON.stringify(bodyStreamingIdentity(current))) return false
    seen.add(key)
    return Boolean(bodyStreamingRecord(settings.bodyStreamingObservations ?? [], selection)?.progressive)
  })
}
