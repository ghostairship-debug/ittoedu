import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { ModelConnectionSnapshot, ModelJson, ModelSelection } from '../../../shared/workbench/modelProvider'
import { bodyStreamingIdentity, bodyStreamingRecord, type BodyStreamingObservation } from '../../../shared/workbench/bodyStreaming'
import { modelCapabilityIdentity, modelCapabilityRecord, probedModelCapabilities,
  type ModelCapabilityProbeResult, type ModelCapabilityRecord } from '../../../shared/workbench/modelCapabilities'
import {
  executionRoles, type ExecutionConnectionView, type ExecutionProfile, type ExecutionRole,
  type ExecutionSelectionSnapshot, type ExecutionSettingsView, type SaveExecutionConnection, type SaveExecutionProfile,
} from '../../../shared/workbench/executionSettings'
import type { CredentialEncryptionPort } from './providerCredentials'
import type { ChatGPTOAuthCredential, OAuthCredentialTarget, OAuthSecureEntry } from './ChatGPTOAuthClient'
import type { DiscoveredModels } from '../../../shared/workbench/executionSettingsDesktop'
import { supportsChatGPTOAuthImages, supportsOpenAIImages } from '../../../shared/workbench/images'

const identity = z.string().trim().min(1).max(512)
const capability = z.enum(['supported', 'unsupported', 'unknown'])
const json: z.ZodType<ModelJson> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(z.string(), json)]))
const parameters = z.record(z.string(), json)
const configSchema = z.object({ provider: identity, protocol: z.enum(['openai-chat', 'chatgpt-responses']), baseURL: z.string().url(), accountId: identity,
  imageProtocol: z.enum(['openai-images']).nullable().default(null),
  authKind: z.enum(['api-key', 'oauth']), billing: z.object({ kind: z.enum(['metered', 'token-plan', 'subscription', 'prepaid', 'unknown']) }).strict(),
  capabilities: z.object({ tools: capability, vision: capability, stream: capability, reasoning: capability }).strict(),
}).strict()
const connectionSchema = configSchema.omit({ authKind: true }).extend({ id: identity, revision: z.number().int().positive(),
  auth: z.object({ kind: z.enum(['api-key', 'oauth']), credentialRef: identity }).strict() }).strict()
const selectionSchema = z.object({ connectionId: identity, model: identity, parameters: parameters.optional() }).strict()
const rolesSchema = z.object({ conversation: selectionSchema.nullable(), vision: selectionSchema.nullable(),
  imageGenerate: selectionSchema.nullable(), imageEdit: selectionSchema.nullable() }).strict()
const profileSchema = z.object({ revision: z.number().int().nonnegative(), updatedAt: z.string().datetime(), roles: rolesSchema }).strict()
const observationSchema = z.object({ requestId: identity, operationId: identity, observedAt: z.number().finite().nonnegative(), result: z.enum(['progressive', 'operation-only']) }).strict()
const bodyStreamingSchema = z.object({ connectionId: identity, connectionRevision: z.number().int().positive(), model: identity,
  parametersKey: z.string().max(65536), latest: observationSchema, progressive: observationSchema.optional() }).strict()
const capabilityFactSchema = z.object({ status: z.enum(['supported', 'unsupported']), observedAt: z.number().finite().nonnegative(),
  source: z.enum(['probe', 'request']), actualModel: identity.optional() }).strict()
const capabilityFactsSchema = z.object({ tools: capabilityFactSchema.optional(), vision: capabilityFactSchema.optional(),
  stream: capabilityFactSchema.optional(), reasoning: capabilityFactSchema.optional() }).strict()
const probeOutcomeSchema = z.object({ capability: z.enum(probedModelCapabilities), status: capability, code: identity,
  message: z.string().trim().min(1).max(1000), actualModel: identity.optional() }).strict()
const capabilityProbeSchema = z.object({ observedAt: z.number().finite().nonnegative(), checks: z.array(z.enum(probedModelCapabilities)).min(1).max(probedModelCapabilities.length)
  .refine(value => new Set(value).size === value.length), requestCount: z.number().int().positive().max(probedModelCapabilities.length),
  outcomes: z.array(probeOutcomeSchema).min(1).max(probedModelCapabilities.length), facts: capabilityFactsSchema }).strict()
const capabilityRecordSchema = z.object({ connectionId: identity, connectionRevision: z.number().int().positive(), model: identity,
  parametersKey: z.string().max(65536), facts: capabilityFactsSchema, lastProbe: capabilityProbeSchema.omit({ facts: true }) }).strict()
const reasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const discoveredModelSchema = z.object({ id: identity, displayName: z.string().min(1).max(128).optional(),
  description: z.string().min(1).max(256).optional(), reasoningEfforts: z.array(z.object({ effort: reasoningEffortSchema,
    description: z.string().min(1).max(128).optional() }).strict()).max(reasoningEffortSchema.options.length).optional(),
  defaultReasoningEffort: reasoningEffortSchema.optional() }).strict()
const modelCatalogSchema = z.object({ connectionId: identity, connectionRevision: z.number().int().positive(),
  checkedAt: z.string().datetime(), models: z.array(discoveredModelSchema).max(1024) }).strict()
const stateSchema = z.object({ schemaVersion: z.literal(1), profile: profileSchema,
  bodyStreamingObservations: z.array(bodyStreamingSchema).default([]),
  capabilityRecords: z.array(capabilityRecordSchema).default([]),
  modelCatalogs: z.array(modelCatalogSchema).max(8).default([]),
  revisions: z.array(z.object({ connection: connectionSchema, encrypted: z.string().min(1).optional(), revoked: z.boolean(), credentialVersion: z.number().int().nonnegative().default(0) }).strict()),
}).strict()
type StoredState = z.infer<typeof stateSchema>
type StoredRevision = StoredState['revisions'][number]
const queues = new Map<string, Promise<unknown>>()
const oauthLeases = new Map<string, Promise<unknown>>()
const oauthReservations = new Map<string, { connection: ModelConnectionSnapshot; expectedRevision: number }>()
const oauthCredentialSchema = z.object({ connectionId: identity, revision: z.number().int().positive(), accountId: identity,
  accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number().finite().positive() }).strict()
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export class ExecutionSettingsError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ExecutionSettingsError' }
}
export interface ExecutionSettingsStoreOptions {
  directory: string
  encryption: CredentialEncryptionPort
  createId?: () => string
  now?: () => Date
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function expose(entry: StoredRevision): ExecutionConnectionView {
  return { connection: structuredClone(entry.connection), hasCredential: !entry.revoked && Boolean(entry.encrypted), revoked: entry.revoked }
}
function sameConnectionIdentity(stored: ModelConnectionSnapshot, supplied: Readonly<ModelConnectionSnapshot>): boolean {
  const { capabilities: _storedCapabilities, ...storedIdentity } = stored
  const { capabilities: _suppliedCapabilities, ...suppliedIdentity } = supplied
  return isDeepStrictEqual({ ...storedIdentity, imageProtocol: storedIdentity.imageProtocol ?? null },
    { ...suppliedIdentity, imageProtocol: suppliedIdentity.imageProtocol ?? null })
}

/** One durable settings owner. Connection history permits exact, frozen request credential resolution. */
export class ExecutionSettingsStore {
  private readonly filename: string
  private readonly queueKey: string
  private readonly createId: () => string
  private readonly now: () => Date
  constructor(private readonly options: ExecutionSettingsStoreOptions) {
    this.filename = path.join(path.resolve(options.directory), 'execution-settings-v1.json')
    this.queueKey = process.platform === 'win32' ? this.filename.toLowerCase() : this.filename
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = (queues.get(this.queueKey) ?? Promise.resolve()).then(work)
    const tail = result.catch(() => undefined)
    queues.set(this.queueKey, tail)
    void tail.finally(() => { if (queues.get(this.queueKey) === tail) queues.delete(this.queueKey) })
    return result
  }
  private async available(): Promise<boolean> {
    try { return await this.options.encryption.isEncryptionAvailable() } catch { return false }
  }
  private async requireEncryption(): Promise<void> {
    if (!(await this.available())) throw new ExecutionSettingsError('secure-storage-unavailable', '系统安全凭据存储不可用，原配置已保留。')
  }
  private async load(): Promise<StoredState> {
    let bytes: string
    try { bytes = await fs.readFile(this.filename, 'utf8') }
    catch (error) {
      if (!isMissing(error)) throw new ExecutionSettingsError('settings-read-failed', '连接配置无法读取，未创建替代配置。')
      return { schemaVersion: 1, revisions: [], bodyStreamingObservations: [], capabilityRecords: [], modelCatalogs: [], profile: { revision: 0, updatedAt: new Date(0).toISOString(),
        roles: { conversation: null, vision: null, imageGenerate: null, imageEdit: null } } }
    }
    try {
      const raw: unknown = JSON.parse(bytes)
      const state = stateSchema.parse(raw)
      const rawRevisions = raw && typeof raw === 'object' && 'revisions' in raw && Array.isArray(raw.revisions)
        ? raw.revisions as Array<{ connection?: Record<string, unknown> }> : []
      // Before imageProtocol existed, a TeamoRouter account could be explicitly
      // selected as an image role. Preserve only that already-granted route.
      // Ordinary TeamoRouter text connections remain opted out.
      for (const role of ['imageGenerate', 'imageEdit'] as const) {
        const selected = state.profile.roles[role]
        if (!selected) continue
        let latestIndex = -1
        for (let index = state.revisions.length - 1; index >= 0; index--) if (state.revisions[index]!.connection.id === selected.connectionId) {
          latestIndex = index; break
        }
        const latest = state.revisions[latestIndex]
        if (latest && !Object.hasOwn(rawRevisions[latestIndex]?.connection ?? {}, 'imageProtocol')
          && latest.connection.imageProtocol === null && latest.connection.provider === 'teamorouter'
          && latest.connection.protocol === 'openai-chat' && latest.connection.auth.kind === 'api-key'
          && latest.connection.baseURL === 'https://api.teamorouter.com/v1') latest.connection.imageProtocol = 'openai-images'
      }
      const refs = new Set<string>(), revisions = new Map<string, number>()
      for (const entry of state.revisions) {
        if (refs.has(entry.connection.auth.credentialRef) || entry.connection.revision !== (revisions.get(entry.connection.id) ?? 0) + 1
          || entry.revoked && entry.encrypted || entry.encrypted && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.encrypted)) throw new Error()
        refs.add(entry.connection.auth.credentialRef); revisions.set(entry.connection.id, entry.connection.revision)
      }
      for (const selected of Object.values(state.profile.roles)) if (selected && !revisions.has(selected.connectionId)) throw new Error()
      for (const record of state.capabilityRecords) {
        if (!state.revisions.some(entry => entry.connection.id === record.connectionId && entry.connection.revision === record.connectionRevision)) throw new Error()
        const parsed: unknown = JSON.parse(record.parametersKey)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      }
      for (const catalog of state.modelCatalogs) if (!state.revisions.some(entry => entry.connection.id === catalog.connectionId
        && entry.connection.revision === catalog.connectionRevision)) throw new Error()
      return state
    } catch { throw new ExecutionSettingsError('settings-corrupt', '连接配置损坏或版本不受支持，未覆盖原文件。') }
  }
  private async persist(state: StoredState): Promise<void> {
    const temporary = `${this.filename}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(path.dirname(this.filename), { recursive: true })
      const handle = await fs.open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(state)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, this.filename)
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw new ExecutionSettingsError('settings-write-failed', '连接配置未保存，原配置已保留。')
    }
  }
  private current(state: StoredState, id: string): StoredRevision | undefined {
    for (let index = state.revisions.length - 1; index >= 0; index--) if (state.revisions[index]!.connection.id === id) return state.revisions[index]
    return undefined
  }
  read(): Promise<ExecutionSettingsView> {
    return this.serial(async () => {
      const state = await this.load(), latest = new Map<string, StoredRevision>()
      for (const entry of state.revisions) latest.set(entry.connection.id, entry)
      return { connections: [...latest.values()].map(expose), profile: structuredClone(state.profile), bodyStreamingObservations: structuredClone(state.bodyStreamingObservations),
        capabilityRecords: structuredClone(state.capabilityRecords), secureStorageAvailable: await this.available() }
    })
  }
  cachedModelCatalog(id: string, revision: number): Promise<DiscoveredModels | undefined> {
    return this.serial(async () => {
      const state = await this.load(), entry = this.current(state, id)
      if (!entry || entry.connection.revision !== revision || entry.revoked || !entry.encrypted) return undefined
      const catalog = state.modelCatalogs.find(value => value.connectionId === id && value.connectionRevision === revision)
      return catalog ? { ...structuredClone(catalog), source: 'cache', capabilitiesVerified: false } : undefined
    })
  }
  recordModelCatalog(catalog: DiscoveredModels): Promise<void> {
    const parsed = modelCatalogSchema.parse({ connectionId: catalog.connectionId, connectionRevision: catalog.connectionRevision,
      checkedAt: catalog.checkedAt, models: catalog.models.slice(0, 1024) })
    return this.serial(async () => {
      const state = await this.load(), entry = this.current(state, parsed.connectionId)
      if (!entry || entry.connection.revision !== parsed.connectionRevision || entry.revoked || !entry.encrypted)
        throw new ExecutionSettingsError('stale-discovery', '读取期间连接已改变或撤销，请重新读取。')
      state.modelCatalogs = [...state.modelCatalogs.filter(value => value.connectionId !== parsed.connectionId
        || value.connectionRevision !== parsed.connectionRevision), parsed].slice(-8)
      await this.persist(state)
    })
  }
  /** Main-only execution evidence. Renderer settings cannot manufacture observations. */
  recordBodyStreaming(selection: ModelSelection, observation: BodyStreamingObservation): Promise<void> {
    const frozen = structuredClone(selection), evidence = observationSchema.parse(observation)
    return this.serial(async () => {
      const state = await this.load()
      const entry = state.revisions.find(value => value.connection.id === frozen.connection.id && value.connection.revision === frozen.connection.revision)
      if (!entry || !sameConnectionIdentity(entry.connection, frozen.connection)) throw new ExecutionSettingsError('stale-connection', '正文流观察不属于已保存的连接版本。')
      const previous = bodyStreamingRecord(state.bodyStreamingObservations, frozen)
      if (previous?.latest.operationId === evidence.operationId && previous.latest.requestId === evidence.requestId) {
        if (previous.latest.result !== evidence.result) throw new ExecutionSettingsError('observation-conflict', '同次正文流观察结果不一致。')
        return
      }
      const next = bodyStreamingSchema.parse({ ...bodyStreamingIdentity(frozen), latest: previous && previous.latest.observedAt > evidence.observedAt ? previous.latest : evidence,
        ...(evidence.result === 'progressive' ? { progressive: evidence } : previous?.progressive ? { progressive: previous.progressive } : {}) })
      state.bodyStreamingObservations = [...state.bodyStreamingObservations.filter(value => value !== previous), next].slice(-1000)
      await this.persist(state)
    })
  }
  /** Main-owned probe facts. Unknown attempts remain visible but never downgrade a prior verified fact. */
  recordCapabilityProbe(selection: ModelSelection, input: ModelCapabilityProbeResult): Promise<ModelCapabilityRecord> {
    const frozen = structuredClone(selection), evidence = capabilityProbeSchema.parse(input)
    return this.serial(async () => {
      const state = await this.load()
      const entry = state.revisions.find(value => value.connection.id === frozen.connection.id && value.connection.revision === frozen.connection.revision)
      if (!entry || !sameConnectionIdentity(entry.connection, frozen.connection)) throw new ExecutionSettingsError('stale-connection', '能力探针不属于已保存的连接版本。')
      if (evidence.requestCount !== evidence.checks.length || evidence.outcomes.length !== evidence.checks.length
        || evidence.outcomes.some(outcome => !evidence.checks.includes(outcome.capability))) throw new ExecutionSettingsError('invalid-capability-probe', '能力探针结果不完整，未保存。')
      const previous = modelCapabilityRecord(state.capabilityRecords, frozen)
      const record = capabilityRecordSchema.parse({ ...modelCapabilityIdentity(frozen), facts: { ...previous?.facts, ...evidence.facts },
        lastProbe: { observedAt: evidence.observedAt, checks: evidence.checks, requestCount: evidence.requestCount, outcomes: evidence.outcomes } })
      state.capabilityRecords = [...state.capabilityRecords.filter(value => value !== previous), record].slice(-1000)
      await this.persist(state)
      return structuredClone(record)
    })
  }
  saveConnection(input: SaveExecutionConnection): Promise<ExecutionConnectionView> {
    // Capture the write-only input before queuing; do not retain plaintext in the repository.
    const supplied = structuredClone(input)
    return this.serial(async () => {
      let parsed: SaveExecutionConnection
      try {
        parsed = z.object({ id: identity.optional(), expectedRevision: z.number().int().positive().optional(), connection: configSchema,
          apiKey: z.string().min(1).max(65536).refine(value => !/[\r\n]/.test(value)).optional() }).strict().parse(supplied)
        const endpoint = new URL(parsed.connection.baseURL)
        if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error()
        if (parsed.connection.imageProtocol === 'openai-images' && !supportsOpenAIImages({
          protocol: parsed.connection.protocol, baseURL: parsed.connection.baseURL,
          imageProtocol: parsed.connection.imageProtocol, auth: { kind: parsed.connection.authKind, credentialRef: '' },
        })) throw new Error()
      } catch { throw new ExecutionSettingsError('invalid-connection', '连接配置无效，原配置已保留。') }
      try {
        const state = await this.load()
        const prior = parsed.id ? this.current(state, parsed.id) : undefined
        if (parsed.id && !prior) throw new ExecutionSettingsError('unknown-connection', '所选连接不存在。')
        if (parsed.expectedRevision !== undefined && parsed.expectedRevision !== prior?.connection.revision) throw new ExecutionSettingsError('stale-connection', '连接配置已改变，请刷新后保存。')
        await this.requireEncryption()
        if (parsed.connection.authKind === 'oauth' && parsed.apiKey !== undefined) throw new ExecutionSettingsError('oauth-not-connected', 'OAuth 需要正式登录，不能用 API Key 代替。')
        const { authKind, ...configuration } = parsed.connection
        const id = prior?.connection.id ?? this.createId()
        if (!prior && state.revisions.some(entry => entry.connection.id === id)) throw new ExecutionSettingsError('duplicate-identity', '连接身份冲突，未保存。')
        const credentialRef = this.createId()
        if (state.revisions.some(entry => entry.connection.auth.credentialRef === credentialRef)) throw new ExecutionSettingsError('duplicate-identity', '凭据身份冲突，未保存。')
        const connection: StoredRevision['connection'] = { ...configuration, imageProtocol: configuration.imageProtocol ?? null,
          id, revision: (prior?.connection.revision ?? 0) + 1,
          auth: { kind: authKind, credentialRef } }
        let encrypted: string | undefined
        if (parsed.apiKey !== undefined) {
          try {
            const ciphertext = await this.options.encryption.encryptString(parsed.apiKey)
            if (!ciphertext.byteLength) throw new Error()
            encrypted = Buffer.from(ciphertext).toString('base64')
          } catch { throw new ExecutionSettingsError('credential-encryption-failed', '凭据加密失败，原配置已保留。') }
        } else if (authKind === 'api-key' && prior && !prior.revoked && prior.connection.accountId === connection.accountId
          && prior.connection.provider === connection.provider && prior.connection.baseURL === connection.baseURL
          && prior.connection.protocol === connection.protocol && prior.connection.auth.kind === authKind) encrypted = prior.encrypted
        const entry: StoredRevision = { connection, ...(encrypted ? { encrypted } : {}), revoked: false, credentialVersion: 0 }
        state.revisions.push(entry)
        await this.persist(state)
        return expose(entry)
      } finally { delete supplied.apiKey; delete parsed.apiKey }
    })
  }
  revokeConnection(id: string): Promise<void> {
    return this.serial(async () => {
      const state = await this.load()
      if (!this.current(state, id)) throw new ExecutionSettingsError('unknown-connection', '所选连接不存在。')
      for (const entry of state.revisions) if (entry.connection.id === id) { entry.revoked = true; delete entry.encrypted; entry.credentialVersion++ }
      for (const [key, pending] of oauthReservations) if (key.startsWith(`${this.queueKey}\u0000`) && pending.connection.id === id) oauthReservations.delete(key)
      // Revocation remains available while the OS key store is locked; no secret decryption is needed.
      await this.persist(state)
    })
  }
  saveProfile(input: SaveExecutionProfile): Promise<ExecutionProfile> {
    const supplied = structuredClone(input)
    return this.serial(async () => {
      let parsed: SaveExecutionProfile
      try { parsed = z.object({ expectedRevision: z.number().int().nonnegative().optional(), roles: rolesSchema }).strict().parse(supplied) }
      catch { throw new ExecutionSettingsError('invalid-profile', '模型角色配置无效，原配置已保留。') }
      const state = await this.load()
      if (parsed.expectedRevision !== undefined && parsed.expectedRevision !== state.profile.revision) throw new ExecutionSettingsError('stale-profile', '模型角色配置已改变，请刷新后保存。')
      await this.requireEncryption()
      for (const selected of Object.values(parsed.roles)) if (selected && !this.current(state, selected.connectionId)) throw new ExecutionSettingsError('unknown-connection', '模型角色引用了不存在的连接。')
      for (const role of ['imageGenerate', 'imageEdit'] as const) {
        const selected = parsed.roles[role]
        if (!selected) continue
        const connection = this.current(state, selected.connectionId)!.connection
        if (!supportsChatGPTOAuthImages(connection) && !supportsOpenAIImages(connection))
          throw new ExecutionSettingsError('unsupported-image-connection', '图片角色需要明确启用 OpenAI Images API 的连接或已登录的 ChatGPT 连接。')
      }
      state.profile = { revision: state.profile.revision + 1, updatedAt: this.now().toISOString(), roles: parsed.roles }
      await this.persist(state)
      return structuredClone(state.profile)
    })
  }
  snapshot(role: ExecutionRole): Promise<ExecutionSelectionSnapshot> {
    return this.serial(async () => {
      if (!executionRoles.includes(role)) throw new ExecutionSettingsError('unknown-role', '模型角色不存在。')
      const state = await this.load(), selected = state.profile.roles[role]
      if (!selected) throw new ExecutionSettingsError('role-unconfigured', '请先配置此角色的模型连接。')
      const entry = this.current(state, selected.connectionId)
      if (!entry || entry.revoked || !entry.encrypted) throw new ExecutionSettingsError('credential-unavailable', '此角色的连接尚未接通或已撤销。')
      await this.requireEncryption()
      const selection: ModelSelection = { connection: structuredClone(entry.connection), model: selected.model, ...(selected.parameters ? { parameters: selected.parameters } : {}) }
      const verified = modelCapabilityRecord(state.capabilityRecords, selection)
      for (const [name, fact] of Object.entries(verified?.facts ?? {})) selection.connection.capabilities[name as keyof ModelConnectionSnapshot['capabilities']] = fact.status
      return freeze(structuredClone({ role, profileRevision: state.profile.revision, profileUpdatedAt: state.profile.updatedAt, ...selection }))
    })
  }
  resolveCredential(connection: Readonly<ModelConnectionSnapshot>): Promise<string> {
    const frozen = structuredClone(connection)
    return this.serial(async () => {
      const state = await this.load()
      if (frozen.auth.kind !== 'api-key') throw new ExecutionSettingsError('wrong-credential-kind', 'OAuth 凭据必须经登录与刷新服务读取。')
      const entry = state.revisions.find(value => value.connection.id === frozen.id && value.connection.revision === frozen.revision)
      if (!entry || !sameConnectionIdentity(entry.connection, frozen)) throw new ExecutionSettingsError('stale-credential-reference', '请求连接身份不匹配，未使用当前连接代替。')
      if (entry.revoked || !entry.encrypted) throw new ExecutionSettingsError('credential-revoked', '该连接凭据已撤销或尚未接通。')
      await this.requireEncryption()
      try {
        const secret = await this.options.encryption.decryptString(Buffer.from(entry.encrypted, 'base64'))
        if (!secret || /[\r\n]/.test(secret)) throw new Error()
        return secret
      } catch { throw new ExecutionSettingsError('credential-decryption-failed', '无法读取此请求对应的安全凭据，未使用其他凭据。') }
    })
  }

  /** Reserve a new revision in memory; login failures never alter the saved account/credential. */
  reserveOAuthLogin(id: string, revision: number): Promise<OAuthCredentialTarget> {
    return this.serial(async () => {
      const state = await this.load(), prior = this.current(state, id)
      if (!prior || prior.connection.revision !== revision) throw new ExecutionSettingsError('stale-connection', '连接配置已改变，请刷新后登录。')
      const connection = prior.connection
      if (connection.auth.kind !== 'oauth' || connection.protocol !== 'chatgpt-responses' || connection.provider !== 'openai'
        || connection.baseURL !== 'https://chatgpt.com/backend-api/codex') throw new ExecutionSettingsError('invalid-oauth-connection', 'ChatGPT 登录需要选择正式 ChatGPT Responses 连接。')
      await this.requireEncryption()
      for (const [key, pending] of oauthReservations) if (key.startsWith(`${this.queueKey}\u0000`) && pending.connection.id === id) oauthReservations.delete(key)
      const credentialRef = this.createId()
      if (state.revisions.some(entry => entry.connection.auth.credentialRef === credentialRef)) throw new ExecutionSettingsError('duplicate-identity', '凭据身份冲突，未开始登录。')
      const next: ModelConnectionSnapshot = { ...structuredClone(connection), revision: revision + 1, auth: { kind: 'oauth', credentialRef } }
      oauthReservations.set(`${this.queueKey}\u0000${credentialRef}`, { connection: next, expectedRevision: revision })
      return { credentialRef, connectionId: id, revision: next.revision,
        ...(connection.accountId !== 'pending-login' ? { expectedAccountId: connection.accountId } : {}) }
    })
  }
  readOAuthCredential(credentialRef: string): Promise<OAuthSecureEntry> {
    return this.serial(async () => {
      if (oauthReservations.has(`${this.queueKey}\u0000${credentialRef}`)) return { version: 0, credential: null }
      const state = await this.load(), entry = state.revisions.find(value => value.connection.auth.credentialRef === credentialRef)
      if (!entry) return { version: 1, credential: null }
      if (entry.connection.auth.kind !== 'oauth' || entry.revoked || !entry.encrypted) return { version: entry.credentialVersion, credential: null }
      await this.requireEncryption()
      try {
        const credential = oauthCredentialSchema.parse(JSON.parse(await this.options.encryption.decryptString(Buffer.from(entry.encrypted, 'base64'))))
        if (credential.connectionId !== entry.connection.id || credential.revision !== entry.connection.revision || credential.accountId !== entry.connection.accountId) throw new Error()
        return { version: entry.credentialVersion, credential }
      } catch { throw new ExecutionSettingsError('credential-decryption-failed', '此账号的安全登录凭据不可读取，请重新登录。') }
    })
  }
  /** Cancellation linearizes with the same atomic login commit; a completed login is reported honestly. */
  settleOAuthCancellation(credentialRef: string): Promise<ExecutionConnectionView | undefined> {
    return this.serial(async () => {
      const key = `${this.queueKey}\u0000${credentialRef}`
      if (oauthReservations.has(key)) { oauthReservations.delete(key); return }
      const state = await this.load(), entry = state.revisions.find(value => value.connection.auth.credentialRef === credentialRef)
      if (entry && !entry.revoked && entry.encrypted) return expose(entry)
    })
  }
  compareAndSetOAuthCredential(credentialRef: string, expectedVersion: number, value: ChatGPTOAuthCredential | null): Promise<boolean> {
    const supplied = structuredClone(value)
    return this.serial(async () => {
      const key = `${this.queueKey}\u0000${credentialRef}`, pending = oauthReservations.get(key)
      const state = await this.load(), existing = state.revisions.find(entry => entry.connection.auth.credentialRef === credentialRef)
      if (pending) {
        if (expectedVersion !== 0) return false
        if (!supplied) { oauthReservations.delete(key); return true }
        if (this.current(state, pending.connection.id)?.connection.revision !== pending.expectedRevision) { oauthReservations.delete(key); return false }
      } else if (!existing || existing.connection.auth.kind !== 'oauth' || existing.credentialVersion !== expectedVersion || supplied && existing.revoked) return false
      if (!supplied) {
        existing!.revoked = true; delete existing!.encrypted; existing!.credentialVersion++
        await this.persist(state); return true
      }
      const parsed = oauthCredentialSchema.safeParse(supplied), connection = pending?.connection ?? existing!.connection
      if (!parsed.success || supplied.connectionId !== connection.id || supplied.revision !== connection.revision
        || connection.accountId !== 'pending-login' && supplied.accountId !== connection.accountId) throw new ExecutionSettingsError('oauth-identity-mismatch', '登录账号与此连接不匹配，原配置已保留。')
      await this.requireEncryption()
      let encrypted: string
      try {
        const bytes = await this.options.encryption.encryptString(JSON.stringify(parsed.data))
        if (!bytes.byteLength) throw new Error()
        encrypted = Buffer.from(bytes).toString('base64')
      } catch { throw new ExecutionSettingsError('credential-encryption-failed', '登录凭据无法安全保存，原配置已保留。') }
      if (pending) state.revisions.push({ connection: { ...connection, imageProtocol: connection.imageProtocol ?? null,
        accountId: supplied.accountId }, encrypted, revoked: false, credentialVersion: 1 })
      else { existing!.encrypted = encrypted; existing!.credentialVersion++ }
      await this.persist(state)
      if (pending) oauthReservations.delete(key)
      return true
    })
  }
  withOAuthLease<T>(credentialRef: string, operation: () => Promise<T>): Promise<T> {
    const key = `${this.queueKey}\u0000${credentialRef}`
    const result = (oauthLeases.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation), tail = result.catch(() => undefined)
    oauthLeases.set(key, tail); void tail.finally(() => { if (oauthLeases.get(key) === tail) oauthLeases.delete(key) })
    return result
  }
  assertOAuthConnection(connection: Readonly<ModelConnectionSnapshot>): Promise<void> {
    const supplied = structuredClone(connection)
    return this.serial(async () => {
      const entry = (await this.load()).revisions.find(item => item.connection.auth.credentialRef === supplied.auth.credentialRef)
      if (!entry || entry.revoked || !entry.encrypted || supplied.auth.kind !== 'oauth' || !sameConnectionIdentity(entry.connection, supplied)) throw new ExecutionSettingsError('credential-revoked', '此请求的登录凭据已撤销或身份不匹配。')
      await this.requireEncryption()
    })
  }
}
