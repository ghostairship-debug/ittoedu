import type { ModelConnectionSnapshot, ModelJsonObject, ModelSelection } from './modelProvider'
import type { BodyStreamingRecord } from './bodyStreaming'
import type { ModelCapabilityRecord } from './modelCapabilities'
import type { SpeechGenerationSelection } from './speechSettings'

export const executionRoles = ['conversation', 'vision', 'imageGenerate', 'imageEdit', 'compression'] as const
/** Conversation covers dialogue and planning; the other model roles remain independent. */
export type ExecutionRole = typeof executionRoles[number]
export const DEFAULT_NATIVE_CONCURRENCY_LIMIT = 10
export const MAX_NATIVE_CONCURRENCY_LIMIT = 32
export interface ExecutionRoleSelection {
  connectionId: string
  model: string
  parameters?: ModelJsonObject
  /** Reference model used to describe an unfamiliar alias; the actual request keeps model. */
  capabilityModel?: string
}
/** A favorite names the actual route as well as the model; it never changes the selected role. */
export interface ExecutionModelFavorite {
  connectionId: string
  model: string
}
export interface ExecutionProfile {
  revision: number
  updatedAt: string
  search?: import('./searchSettings').SearchSettings
  /** An explicit remote speech route; ordinary text/image roles never enable it. */
  speech?: SpeechGenerationSelection | null
  /** Frozen when a new root task starts; its descendants share this capacity. */
  nativeConcurrencyLimit?: number
  roles: Record<Exclude<ExecutionRole, 'compression'>, ExecutionRoleSelection | null> & { compression?: ExecutionRoleSelection | null }
}
export type ExecutionConnectionConfiguration = Omit<ModelConnectionSnapshot, 'id' | 'revision' | 'auth'> & {
  authKind: ModelConnectionSnapshot['auth']['kind']
}
/** API key is accepted only by this write operation and is never returned by settings reads. */
export interface SaveExecutionConnection {
  id?: string
  expectedRevision?: number
  connection: ExecutionConnectionConfiguration
  apiKey?: string
}
export interface ExecutionConnectionView {
  connection: ModelConnectionSnapshot
  hasCredential: boolean
  revoked: boolean
}
export interface ExecutionSettingsView {
  modelFavorites?: ExecutionModelFavorite[]
  bodyStreamingObservations?: BodyStreamingRecord[]
  capabilityRecords?: ModelCapabilityRecord[]
  connections: ExecutionConnectionView[]
  profile: ExecutionProfile
  secureStorageAvailable: boolean
}
export interface SaveExecutionProfile {
  expectedRevision?: number
  roles: ExecutionProfile['roles']
  search?: import('./searchSettings').SearchSettings
  /** Omission preserves the saved route; null explicitly disables the remote speech API. */
  speech?: SpeechGenerationSelection | null
  nativeConcurrencyLimit?: number
}
export interface ExecutionSelectionSnapshot extends ModelSelection {
  role: ExecutionRole
  profileRevision: number
  profileUpdatedAt: string
  nativeConcurrencyLimit?: number
}
/** Settings discovery only; IDs and known parameters contain no credential material. */
export interface AvailableDelegationModel extends ExecutionRoleSelection {
  provider: string
  protocol: ModelConnectionSnapshot['protocol']
  reasoning?: import('./modelReasoning').ResolvedModelReasoning
}
