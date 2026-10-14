import type { ModelCapability, ModelConnectionSnapshot, ModelJson, ModelJsonObject, ModelSelection } from './modelProvider'
import { effectiveModelProtocol } from './modelRouting'

export const probedModelCapabilities = ['tools', 'vision'] as const
export type ProbedModelCapability = typeof probedModelCapabilities[number]
export type ModelCapabilityName = 'tools' | 'vision' | 'stream' | 'reasoning' | 'webSearch'

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
  outcome?: 'not-sent' | 'rejected' | 'unknown'
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
  lastProbe?: Omit<ModelCapabilityProbeResult, 'facts'>
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
    parametersKey: JSON.stringify({ protocol: effectiveModelProtocol(selection), parameters: ordered(selection.parameters ?? {}),
      ...(selection.capabilityModel ? { capabilityModel: selection.capabilityModel } : {}) }),
  }
}

/** Restore only request parameters and the selected reference, never the evidence identity envelope. */
export function modelCapabilitySelection(record: ModelCapabilityRecord, connection: ModelConnectionSnapshot): Pick<ModelSelection, 'model' | 'parameters' | 'capabilityModel'> | undefined {
  try {
    const parsed: unknown = JSON.parse(record.parametersKey)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const identity = parsed as Record<string, unknown>, parameters = identity.parameters
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)
      || identity.capabilityModel !== undefined && typeof identity.capabilityModel !== 'string') return
    const selection = { model: record.model, parameters: parameters as ModelJsonObject,
      ...(typeof identity.capabilityModel === 'string' ? { capabilityModel: identity.capabilityModel } : {}) }
    if (record.connectionId !== connection.id || record.connectionRevision !== connection.revision
      || identity.protocol !== effectiveModelProtocol({ connection, ...selection })) return
    return selection
  } catch { return }
}

export function modelCapabilityRecord(records: readonly ModelCapabilityRecord[], selection: ModelSelection): ModelCapabilityRecord | undefined {
  const identity = modelCapabilityIdentity(selection)
  return records.find(record => record.connectionId === identity.connectionId && record.connectionRevision === identity.connectionRevision
    && record.model === identity.model && record.parametersKey === identity.parametersKey)
}
