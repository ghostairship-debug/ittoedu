import path from 'node:path'
import { executionSettingsRequestSchema, type DiscoveredModel, type DiscoveredModels,
  type DiscoveredReasoningEffort } from '../../../shared/workbench/executionSettingsDesktop'
import { ExecutionSettingsError, ExecutionSettingsStore } from './ExecutionSettingsStore'
import { createElectronCredentialEncryption } from './providerCredentials'
import { DesktopOperationError } from '../../errors'
import { OAuthDesktopService } from './OAuthDesktopService'
import type { ModelConnectionSnapshot } from '../../../shared/workbench/modelProvider'
import type { ModelProvider } from '../../../shared/workbench/modelProvider'
import { OpenAIChatProvider } from './OpenAIChatProvider'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL } from './ChatGPTResponsesProvider'
import { ModelCapabilityProbe } from './ModelCapabilityProbe'
import { diagnosticLog } from '../../diagnosticLog'

const actualModelId = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/
const reasoningEfforts = new Set<DiscoveredReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
function catalogText(value: unknown, limit: number, secret: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text && text.length <= limit && !/[\x00-\x1f\x7f]/.test(text) && !text.includes(secret) ? text : undefined
}
function catalogEffort(value: unknown): DiscoveredReasoningEffort | undefined {
  return typeof value === 'string' && reasoningEfforts.has(value as DiscoveredReasoningEffort) ? value as DiscoveredReasoningEffort : undefined
}
function parseDiscoveredModel(value: unknown, isOAuth: boolean, secret: string): DiscoveredModel | undefined {
  const item = record(value)
  if (!item) return undefined
  const id = catalogText(isOAuth ? item.slug : item.id, 512, secret)
  if (!id) return undefined
  const displayName = catalogText(item.display_name ?? item.displayName ?? item.name, 128, secret)
  const description = catalogText(item.description, 256, secret)
  const model: DiscoveredModel = { id, ...(displayName ? { displayName } : {}), ...(description ? { description } : {}) }
  if (isOAuth && Array.isArray(item.supported_reasoning_efforts)) {
    const choices = new Map<DiscoveredReasoningEffort, { effort: DiscoveredReasoningEffort; description?: string }>()
    for (const raw of item.supported_reasoning_efforts.slice(0, 16)) {
      const option = record(raw)
      const effort = catalogEffort(option?.reasoning_effort ?? raw)
      if (!effort || choices.has(effort)) continue
      const note = catalogText(option?.description, 128, secret)
      choices.set(effort, { effort, ...(note ? { description: note } : {}) })
    }
    // An explicit empty list is meaningful: it overrides documented defaults.
    model.reasoningEfforts = [...choices.values()]
    if (choices.size) {
      const defaultEffort = catalogEffort(item.default_reasoning_effort)
      if (defaultEffort && choices.has(defaultEffort)) model.defaultReasoningEffort = defaultEffort
    }
  }
  return model
}
const probeMessages: Readonly<Record<string, string>> = {
  'probe-vision-observed': '模型正确识别了随机三格图片的颜色与形状顺序。',
  'probe-answer-mismatch': '随机三格图片挑战未通过；视觉能力仍为未知。响应格式或答案与挑战不匹配。',
  'probe-tool-observed': '模型返回了参数完整的指定工具调用。',
  'probe-tool-missing': '模型未返回参数完整的指定工具调用；工具能力仍为未知。',
}

/** No credential reads or arbitrary provider request endpoint are exposed to the renderer. */
export class ExecutionSettingsDesktopService {
  constructor(private readonly store: ExecutionSettingsStore, private readonly transport: typeof fetch = fetch,
    private readonly oauth?: OAuthDesktopService, private readonly clientVersion = '1.0.0') {}
  async operate(raw: unknown) {
    try {
      const parsed = executionSettingsRequestSchema.safeParse(raw)
      if (!parsed.success) throw new ExecutionSettingsError('invalid-settings-request', '连接设置请求无效，未修改配置。')
      const input = parsed.data
      switch (input.type) {
        case 'read': return await this.store.read()
        case 'save-connection': return await this.store.saveConnection({ ...input.input, connection: { ...input.input.connection,
          capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } })
        case 'save-profile': return await this.store.saveProfile(input.input)
        case 'revoke-connection': return this.oauth ? await this.oauth.revokeConnection(input.id) : await this.store.revokeConnection(input.id)
        case 'discover-models': return await this.discoverModels(input.id, input.revision)
        case 'probe-capabilities': return await this.probeCapabilities(input)
        case 'oauth-login-start': return await this.requireOAuth().start(input.id, input.revision)
        case 'oauth-login-status': return this.requireOAuth().status(input.loginId)
        case 'oauth-login-cancel': return await this.requireOAuth().cancel(input.loginId)
      }
    } catch (error) {
      const known = error instanceof ExecutionSettingsError
      throw new DesktopOperationError(known ? error.code : 'execution-settings-failed', '模型连接设置未完成',
        known ? error.message : '无法完成模型连接设置，已保留原配置。', '请检查当前连接或系统安全存储后重试。')
    }
  }
  private requireOAuth(): OAuthDesktopService {
    if (!this.oauth) throw new ExecutionSettingsError('oauth-service-unavailable', '当前环境无法打开 ChatGPT 登录，请使用桌面应用。')
    return this.oauth
  }
  private provider(onCredential?: (secret: string) => void): ModelProvider {
    const chat = new OpenAIChatProvider({ credentialResolver: async connection => {
      const secret = await this.store.resolveCredential(connection)
      onCredential?.(secret)
      return secret
    }, fetch: this.transport,
      onTransportDiagnostic: diagnostic => diagnosticLog.append({ source: 'main', message: 'OpenAI Chat transport failure', details: {
        chatTransportPhase: diagnostic.phase, chatTransportClass: diagnostic.errorClass,
        chatHttpResponseReceived: diagnostic.httpResponseReceived,
        ...(diagnostic.errorCode ? { code: diagnostic.errorCode } : {}),
        ...(diagnostic.httpStatus !== undefined ? { httpStatus: diagnostic.httpStatus } : {}),
      } }),
      onProtocolShape: shape => diagnosticLog.append({ source: 'main', message: 'OpenAI Chat tool fragment protocol', details: {
        chatToolCode: shape.code, chatToolType: shape.type, chatToolIndex: shape.index, chatToolHasFunction: shape.hasFunction } }) })
    const oauth = new ChatGPTResponsesProvider({ credentialResolver: async connection => {
      const credential = await this.requireOAuth().resolveCredential(connection)
      onCredential?.(credential.accessToken)
      return credential
    }, fetch: this.transport,
      onProtocolError: error => diagnosticLog.append({ source: 'main', message: 'ChatGPT 协议解析失败', stack: error.stack }) })
    return { stream: (request, options) => (request.selection.connection.protocol === 'chatgpt-responses' ? oauth : chat).stream(request, options) }
  }
  private async probeCapabilities(input: Extract<ReturnType<typeof executionSettingsRequestSchema.parse>, { type: 'probe-capabilities' }>) {
    const selection = await this.store.snapshot(input.role)
    if (selection.profileRevision !== input.expectedProfileRevision) throw new ExecutionSettingsError('stale-profile', '模型角色配置已改变，请刷新设置后重新验证。')
    const usedSecrets = new Set<string>()
    try {
      const result = await new ModelCapabilityProbe({ provider: this.provider(secret => { usedSecrets.add(secret) }) }).probe(selection, input.checks)
      // Provider metadata and failure text are untrusted. Keep model IDs that
      // look like IDs, but never persist a value echoing the credential used.
      const safeModel = (value?: string) => value && actualModelId.test(value)
        && ![...usedSecrets].some(secret => secret && value.includes(secret)) ? value : undefined
      const outcomes = result.outcomes.map(outcome => {
        const { actualModel, ...fields } = outcome
        const code = /^[a-z][a-z0-9-]{0,63}$/.test(fields.code)
          && ![...usedSecrets].some(secret => secret && fields.code.includes(secret)) ? fields.code : 'probe-failed'
        const status = fields.status
        const message = probeMessages[code]
          ?? (/^http-[1-5][0-9]{2}$/.test(code) ? `模型服务返回 HTTP ${code.slice(5)}；能力仍为未知。`
            : status === 'unsupported' ? '所选模型未支持此次能力验证。' : '能力验证未完整结束；能力仍为未知。')
        const safe = safeModel(actualModel)
        return { ...fields, code, message, ...(safe ? { actualModel: safe } : {}) }
      })
      const facts: typeof result.facts = {}
      for (const capability of ['tools', 'vision'] as const) {
        const fact = result.facts[capability]
        if (!fact) continue
        const { actualModel, ...fields } = fact, safe = safeModel(actualModel)
        facts[capability] = { ...fields, ...(safe ? { actualModel: safe } : {}) }
      }
      return this.store.recordCapabilityProbe(selection, { ...result, outcomes, facts })
    } finally { usedSecrets.clear() }
  }
  private async discoverModels(id: string, revision: number): Promise<DiscoveredModels> {
    const current = (await this.store.read()).connections.find(entry => entry.connection.id === id)
    if (!current || current.connection.revision !== revision) throw new ExecutionSettingsError('stale-connection', '连接配置已改变，请刷新后读取模型目录。')
    if (!current.hasCredential || current.revoked) throw new ExecutionSettingsError('credential-revoked', '连接凭据不可用或已撤销。')
    const isOAuth = current.connection.auth.kind === 'oauth'
    if (isOAuth && (current.connection.protocol !== 'chatgpt-responses' || current.connection.provider !== 'openai'
      || current.connection.baseURL !== CHATGPT_RESPONSES_BASE_URL || !/^[0-9][A-Za-z0-9.+-]{0,63}$/.test(this.clientVersion)))
      throw new ExecutionSettingsError('invalid-oauth-connection', 'ChatGPT 模型目录需要正式登录的连接。')
    const credential = isOAuth ? await this.requireOAuth().resolveCredential(current.connection) : await this.store.resolveCredential(current.connection)
    const secret = typeof credential === 'string' ? credential : credential.accessToken
    const accountId = typeof credential === 'string' ? undefined : credential.accountId
    const endpoint = `${current.connection.baseURL.replace(/\/+$/, '')}/models${isOAuth ? `?client_version=${encodeURIComponent(this.clientVersion)}` : ''}`
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15_000)
    let response: Response | undefined
    try {
      response = await this.transport(endpoint, {
        headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json', ...(accountId ? { 'chatgpt-account-id': accountId } : {}) },
        signal: abort.signal, redirect: 'error',
      })
      if (!response.ok) throw new ExecutionSettingsError('model-discovery-http', `模型目录请求返回 HTTP ${response.status}；未切换连接。`)
      if (!response.body) throw new ExecutionSettingsError('model-discovery-invalid', '模型服务没有返回可读取的目录。')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 1024 * 1024) throw new ExecutionSettingsError('model-discovery-limit', '模型目录超过读取上限。')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      let models: DiscoveredModel[]
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: unknown; models?: unknown }
        const entries = isOAuth ? payload.models : payload.data
        if (!Array.isArray(entries) || entries.length > 4096) throw new Error()
        const found = new Map<string, DiscoveredModel>()
        for (const item of entries) {
          const model = parseDiscoveredModel(item, isOAuth, secret)
          if (!model) throw new Error()
          if (!found.has(model.id)) found.set(model.id, model)
        }
        models = [...found.values()].sort((left, right) => left.id.localeCompare(right.id))
      } catch { throw new ExecutionSettingsError('model-discovery-invalid', '模型目录格式无效；连接能力仍未验证。') }
      const latest = (await this.store.read()).connections.find(entry => entry.connection.id === id)
      if (!latest || latest.connection.revision !== revision || !latest.hasCredential) throw new ExecutionSettingsError('stale-discovery', '读取期间连接已改变或撤销，请重新读取。')
      const result: DiscoveredModels = { connectionId: id, connectionRevision: revision, models,
        capabilitiesVerified: false, source: 'live', checkedAt: new Date().toISOString() }
      await this.store.recordModelCatalog(result)
      return result
    } catch (error) {
      if (!(error instanceof ExecutionSettingsError) || error.code === 'model-discovery-http' && response && (response.status === 429 || response.status >= 500)) {
        const cached = await this.store.cachedModelCatalog(id, revision)
        if (cached) return cached
      }
      if (error instanceof ExecutionSettingsError) throw error
      throw new ExecutionSettingsError('model-discovery-failed', '模型目录暂不可读取；未切换连接或发起生成。')
    } finally {
      clearTimeout(timer); abort.abort()
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}

let singleton: Promise<ExecutionSettingsStore> | undefined
let oauthSingleton: Promise<OAuthDesktopService> | undefined
/** Shared by Engine and settings UI. No test connection or environment credential is installed. */
export function executionSettingsStore(): Promise<ExecutionSettingsStore> {
  return singleton ??= (async () => {
    const { app } = await import('electron')
    await app.whenReady()
    return new ExecutionSettingsStore({ directory: path.join(app.getPath('userData'), 'workbench-v2', 'settings'),
      encryption: await createElectronCredentialEncryption() })
  })().catch(error => { singleton = undefined; throw error })
}
export async function operateExecutionSettings(raw: unknown) {
  const { app } = await import('electron')
  return new ExecutionSettingsDesktopService(await executionSettingsStore(), fetch, await executionOAuthService(), app.getVersion()).operate(raw)
}
export function executionOAuthService(): Promise<OAuthDesktopService> {
  return oauthSingleton ??= (async () => {
    const { shell } = await import('electron')
    return new OAuthDesktopService({ store: await executionSettingsStore(), openExternal: async url => {
      const parsed = new URL(url)
      if (parsed.origin !== 'https://auth.openai.com' || parsed.pathname !== '/oauth/authorize') throw new ExecutionSettingsError('invalid-login-url', '登录地址无效。')
      await shell.openExternal(url)
    } })
  })().catch(error => { oauthSingleton = undefined; throw error })
}
/** Engine uses the same frozen connection and encrypted store as the settings login UI. */
export async function resolveOAuthCredential(connection: Readonly<ModelConnectionSnapshot>): Promise<{ accessToken: string; accountId: string }> {
  return (await executionOAuthService()).resolveCredential(connection)
}
