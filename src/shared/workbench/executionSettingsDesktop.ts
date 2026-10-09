import { z } from 'zod'
import type { ModelJson } from './modelProvider'
import type { ModelKnowledgeEntry } from './modelKnowledge'
import type { ExecutionConnectionConfiguration, ExecutionConnectionView, ExecutionModelFavorite, ExecutionProfile, ExecutionSettingsView, SaveExecutionConnection, SaveExecutionProfile } from './executionSettings'
import { probedModelCapabilities, type ModelCapabilityRecord, type ProbedModelCapability } from './modelCapabilities'

const identity = z.string().trim().min(1).max(512)
const json: z.ZodType<ModelJson> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(z.string(), json)]))
const parameters = z.record(z.string(), json).refine(value => JSON.stringify(value).length <= 65536)
const role = z.object({ connectionId: identity, model: identity, parameters: parameters.optional(), capabilityModel: identity.optional() }).strict().nullable()
export const executionSettingsRolesSchema = z.object({ conversation: role, vision: role, imageGenerate: role, imageEdit: role,
  compression: role.optional() }).strict()
/** Capability facts are main-owned. A settings form cannot claim a successful probe. */
export type SaveExecutionConnectionDesktop = Omit<SaveExecutionConnection, 'connection'> & { connection: Omit<ExecutionConnectionConfiguration, 'capabilities'> }
export const executionSettingsConnectionSchema = z.object({
  id: identity.optional(), expectedRevision: z.number().int().positive().optional(),
  connection: z.object({ provider: identity, protocol: z.enum(['openai-chat', 'openai-responses', 'anthropic-messages', 'chatgpt-responses']), baseURL: z.string().url().max(4096), accountId: identity,
    imageProtocol: z.enum(['openai-images']).nullable().default(null),
    authKind: z.enum(['api-key', 'oauth']), billing: z.object({ kind: z.enum(['metered', 'token-plan', 'subscription', 'prepaid', 'unknown']) }).strict(),
  }).strict(),
  apiKey: z.string().min(1).max(65536).refine(value => !/[\r\n]/.test(value)).optional(),
}).strict()
export const executionSettingsRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read') }).strict(),
  z.object({ type: z.literal('save-connection'), input: executionSettingsConnectionSchema }).strict(),
  z.object({ type: z.literal('save-profile'), input: z.object({ expectedRevision: z.number().int().nonnegative().optional(), roles: executionSettingsRolesSchema }).strict() }).strict(),
  z.object({ type: z.literal('set-model-favorite'), input: z.object({ connectionId: identity, model: identity, favorite: z.boolean() }).strict() }).strict(),
  z.object({ type: z.literal('revoke-connection'), id: identity }).strict(),
  z.object({ type: z.literal('discover-models'), id: identity, revision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('known-models') }).strict(),
  z.object({ type: z.literal('probe-capabilities'), role: z.enum(['conversation', 'vision']), expectedProfileRevision: z.number().int().nonnegative(),
    checks: z.array(z.enum(probedModelCapabilities)).min(1).max(probedModelCapabilities.length).refine(value => new Set(value).size === value.length) }).strict(),
  z.object({ type: z.literal('oauth-login-start'), id: identity, revision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('oauth-login-status'), loginId: identity }).strict(),
  z.object({ type: z.literal('oauth-login-cancel'), loginId: identity }).strict(),
])
export type ExecutionSettingsRequest = z.infer<typeof executionSettingsRequestSchema>
export type DiscoveredReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface DiscoveredModel {
  id: string
  displayName?: string
  description?: string
  /** Directory-declared choices. Missing is unknown; documented model controls may supplement them. */
  reasoningEfforts?: { effort: DiscoveredReasoningEffort; description?: string }[]
  defaultReasoningEffort?: DiscoveredReasoningEffort
  metadata?: ModelKnowledgeEntry
  metadataSource?: 'directory' | 'models.dev' | 'documented'
}
export interface DiscoveredModels {
  connectionId: string
  connectionRevision: number
  models: DiscoveredModel[]
  capabilitiesVerified: false
  source: 'live' | 'cache'
  checkedAt: string
}
export type OAuthLoginStatus = { loginId: string } & (
  | { status: 'pending' }
  | { status: 'connected'; connection: ExecutionConnectionView }
  | { status: 'cancelled' }
  | { status: 'failed'; code: string; message: string }
)
export interface ExecutionSettingsAPI {
  read(): Promise<ExecutionSettingsView>
  saveConnection(input: SaveExecutionConnectionDesktop): Promise<ExecutionConnectionView>
  saveProfile(input: SaveExecutionProfile): Promise<ExecutionProfile>
  setModelFavorite(input: ExecutionModelFavorite & { favorite: boolean }): Promise<ExecutionModelFavorite[]>
  revokeConnection(id: string): Promise<void>
  discoverModels(id: string, revision: number): Promise<DiscoveredModels>
  knownModels(): Promise<ModelKnowledgeEntry[]>
  probeCapabilities(input: { role: 'conversation' | 'vision'; expectedProfileRevision: number; checks: ProbedModelCapability[] }): Promise<ModelCapabilityRecord>
  startOAuthLogin(id: string, revision: number): Promise<OAuthLoginStatus>
  oauthLoginStatus(loginId: string): Promise<OAuthLoginStatus>
  cancelOAuthLogin(loginId: string): Promise<void>
}
