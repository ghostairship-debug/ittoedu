import type { ModelCapability, ModelJson, ModelSelection } from './modelProvider'

export const probedModelCapabilities = ['tools', 'vision'] as const
export type ProbedModelCapability = typeof probedModelCapabilities[number]
export type ModelCapabilityName = 'tools' | 'vision' | 'stream' | 'reasoning'

export interface ModelCapabilityFact {
  status: Exclude<ModelCapability, 'unknown'>
  observedAt: number
  source: 'probe' | 'request'
  actualModel?: string
}

export interface ModelCapabilityProbeOutcome {
  capability: ProbedModelCapability
  status: ModelCapability
  code: string
  message: string
  actualModel?: string
}

export interface ModelCapabilityProbeResult {
  observedAt: number
  checks: ProbedModelCapability[]
  requestCount: number
  outcomes: ModelCapabilityProbeOutcome[]
  facts: Partial<Record<ProbedModelCapability, ModelCapabilityFact>>
}

export interface ModelCapabilityRecord {
  connectionId: string
  connectionRevision: number
  model: string
  parametersKey: string
  facts: Partial<Record<ModelCapabilityName, ModelCapabilityFact>>
  lastProbe: Omit<ModelCapabilityProbeResult, 'facts'>
}

function ordered(value: ModelJson): ModelJson {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, ordered(child)]))
  return value
}

export function modelCapabilityIdentity(selection: ModelSelection): Pick<ModelCapabilityRecord, 'connectionId' | 'connectionRevision' | 'model' | 'parametersKey'> {
  return {
    connectionId: selection.connection.id,
    connectionRevision: selection.connection.revision,
    model: selection.model,
    parametersKey: JSON.stringify(ordered(selection.parameters ?? {})),
  }
}

export function modelCapabilityRecord(records: readonly ModelCapabilityRecord[], selection: ModelSelection): ModelCapabilityRecord | undefined {
  const identity = modelCapabilityIdentity(selection)
  return records.find(record => record.connectionId === identity.connectionId && record.connectionRevision === identity.connectionRevision
    && record.model === identity.model && record.parametersKey === identity.parametersKey)
}
