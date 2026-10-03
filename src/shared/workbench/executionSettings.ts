import type { ModelConnectionSnapshot, ModelJsonObject, ModelSelection } from './modelProvider'
import type { BodyStreamingRecord } from './bodyStreaming'
import type { ModelCapabilityRecord } from './modelCapabilities'

export const executionRoles = ['conversation', 'vision', 'imageGenerate', 'imageEdit'] as const
/** Conversation covers dialogue and planning; the other model roles remain independent. */
export type ExecutionRole = typeof executionRoles[number]
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
  roles: Record<ExecutionRole, ExecutionRoleSelection | null>
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
}
export interface ExecutionSelectionSnapshot extends ModelSelection {
  role: ExecutionRole
  profileRevision: number
  profileUpdatedAt: string
}
