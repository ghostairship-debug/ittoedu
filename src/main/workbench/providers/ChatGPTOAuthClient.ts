import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ModelConnectionSnapshot } from '../../../shared/workbench/modelProvider'

export interface OAuthCredentialTarget { credentialRef: string; connectionId: string; revision: number; expectedAccountId?: string }
export interface ChatGPTOAuthCredential {
  connectionId: string; revision: number; accountId: string; accessToken: string; refreshToken: string; expiresAt: number
}
export interface OAuthSecureEntry { version: number; credential: ChatGPTOAuthCredential | null }
/** Main-only port. Implementations must encrypt durable data, retain tombstone versions and serialize leases across all instances. */
export interface ChatGPTOAuthSecurePersistence {
  read(credentialRef: string): Promise<OAuthSecureEntry>
  compareAndSet(credentialRef: string, expectedVersion: number, credential: ChatGPTOAuthCredential | null): Promise<boolean>
  withLease<T>(credentialRef: string, operation: () => Promise<T>): Promise<T>
}
export interface ChatGPTOAuthSummary { credentialRef: string; connectionId: string; revision: number; accountId: string; expiresAt: number }
export interface ChatGPTOAuthClientOptions {
  /** Explicit integration parameters. No client ID, account or secret is imported from another application. */
  clientId: string
  redirectURI: string
  originator: string
  persistence: ChatGPTOAuthSecurePersistence
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
  refreshMarginMs?: number
}
export class ChatGPTOAuthError extends Error {
  constructor(readonly code: string, readonly httpStatus?: number) { super(`ChatGPT 登录操作未完成（${code}）。`); this.name = 'ChatGPTOAuthError' }
}
const AUTH_ORIGIN = 'https://auth.openai.com'
const TOKEN_ENDPOINT = `${AUTH_ORIGIN}/oauth/token`
const DEVICE_REDIRECT = `${AUTH_ORIGIN}/deviceauth/callback`
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && !/[\r\n]/.test(v)
type Pending = { target: OAuthCredentialTarget; version: number; deadline: number; exchanging?: boolean } & (
  | { kind: 'browser'; state: string; verifier: string }
  | { kind: 'device'; deviceAuthId: string; userCode: string; nextPollAt: number; intervalMs: number }
)
function accountOf(accessToken: string): string {
  try {
    const payload: unknown = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8'))
    const auth = object(payload) ? payload['https://api.openai.com/auth'] : undefined
    if (object(auth) && nonempty(auth.chatgpt_account_id)) return auth.chatgpt_account_id
  } catch { /* Never expose token fragments. */ }
  throw new ChatGPTOAuthError('account-identity-missing')
}
function summary(ref: string, credential: ChatGPTOAuthCredential): ChatGPTOAuthSummary {
  return { credentialRef: ref, connectionId: credential.connectionId, revision: credential.revision, accountId: credential.accountId, expiresAt: credential.expiresAt }
}
function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }

/** Protocol client only: host owns browser/loopback callback UI and supplies its own encrypted persistence. */
export class ChatGPTOAuthClient {
  private readonly pending = new Map<string, Pending>()
  private readonly now: () => number
  constructor(private readonly options: ChatGPTOAuthClientOptions) {
    this.now = options.now ?? Date.now
    let callback: URL
    try { callback = new URL(options.redirectURI) } catch { throw new ChatGPTOAuthError('invalid-configuration') }
    if (!nonempty(options.clientId) || !nonempty(options.originator) || callback.protocol !== 'http:'
      || !['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname) || !callback.port
      || callback.username || callback.password || callback.search || callback.hash || callback.pathname !== '/auth/callback') throw new ChatGPTOAuthError('invalid-configuration')
  }
  private async newPending(target: OAuthCredentialTarget) {
    if (!nonempty(target.credentialRef) || !nonempty(target.connectionId) || !Number.isSafeInteger(target.revision) || target.revision < 0
      || target.expectedAccountId !== undefined && !nonempty(target.expectedAccountId)) throw new ChatGPTOAuthError('invalid-target')
    for (const [id, flow] of this.pending) if (flow.deadline <= this.now()) this.pending.delete(id)
    // A new ceremony supersedes the old ceremony for the same credential reference.
    for (const [id, flow] of this.pending) if (flow.target.credentialRef === target.credentialRef) this.pending.delete(id)
    if (this.pending.size >= 8) throw new ChatGPTOAuthError('too-many-login-attempts')
    const entry = await this.options.persistence.read(target.credentialRef)
    return { target: structuredClone(target), version: entry.version, deadline: this.now() + 15 * 60_000 }
  }
  async beginAuthorization(target: OAuthCredentialTarget): Promise<{ loginId: string; authorizationURL: string }> {
    const base = await this.newPending(target), loginId = randomUUID()
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url')
    const url = new URL(`${AUTH_ORIGIN}/oauth/authorize`)
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.options.clientId, redirect_uri: this.options.redirectURI,
      scope: 'openid profile email offline_access', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', state, id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: this.options.originator }).toString()
    this.pending.set(loginId, { ...base, kind: 'browser', verifier, state })
    return { loginId, authorizationURL: url.toString() }
  }
  cancel(loginId: string): void { this.pending.delete(loginId) }
  private getPending(loginId: string): Pending {
    const flow = this.pending.get(loginId)
    if (!flow || flow.deadline <= this.now()) { this.pending.delete(loginId); throw new ChatGPTOAuthError('login-expired-or-cancelled') }
    return flow
  }
  async completeAuthorization(loginId: string, callbackURL: string, options: { signal?: AbortSignal } = {}): Promise<ChatGPTOAuthSummary> {
    const flow = this.getPending(loginId)
    if (flow.kind !== 'browser') throw new ChatGPTOAuthError('wrong-login-flow')
    if (flow.exchanging) throw new ChatGPTOAuthError('exchange-already-started')
    let url: URL
    try { url = new URL(callbackURL) } catch { throw new ChatGPTOAuthError('invalid-callback') }
    const expected = new URL(this.options.redirectURI)
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash
      || url.searchParams.getAll('state').length !== 1 || !equal(url.searchParams.get('state') ?? '', flow.state)) throw new ChatGPTOAuthError('state-or-callback-mismatch')
    if (url.searchParams.has('error')) { this.cancel(loginId); throw new ChatGPTOAuthError('authorization-denied') }
    const code = url.searchParams.get('code')
    if (!nonempty(code) || url.searchParams.getAll('code').length !== 1) throw new ChatGPTOAuthError('authorization-code-missing')
    // Duplicate callbacks cannot spend a one-time code twice; cancellation still invalidates settlement.
    flow.exchanging = true
    try {
      const token = await this.tokenRequest({ grant_type: 'authorization_code', client_id: this.options.clientId,
        code, code_verifier: flow.verifier, redirect_uri: this.options.redirectURI }, options.signal)
      return await this.persist(loginId, flow, token)
    } finally { if (this.pending.get(loginId) === flow) this.pending.delete(loginId) }
  }
  async beginDeviceAuthorization(target: OAuthCredentialTarget, options: { signal?: AbortSignal } = {}): Promise<{ loginId: string; verificationURL: string; userCode: string; expiresAt: number; retryAfterMs: number }> {
    const base = await this.newPending(target)
    const result = await this.request(`${AUTH_ORIGIN}/api/accounts/deviceauth/usercode`, { client_id: this.options.clientId }, false, options.signal)
    if (!nonempty(result.device_auth_id) || !nonempty(result.user_code)) throw new ChatGPTOAuthError('invalid-device-response')
    const interval = typeof result.interval === 'string' ? Number(result.interval) : result.interval
    const intervalMs = typeof interval === 'number' && Number.isFinite(interval) && interval > 0 ? Math.max(1000, Math.min(60_000, interval * 1000)) : 5000
    const loginId = randomUUID()
    this.pending.set(loginId, { ...base, kind: 'device', deviceAuthId: result.device_auth_id, userCode: result.user_code, intervalMs, nextPollAt: this.now() + intervalMs })
    return { loginId, verificationURL: `${AUTH_ORIGIN}/codex/device`, userCode: result.user_code, expiresAt: base.deadline, retryAfterMs: intervalMs }
  }
  /** One poll per call, never earlier than the server interval. Host stops polling on cancel/window close. */
  async pollDeviceAuthorization(loginId: string, options: { signal?: AbortSignal } = {}): Promise<{ status: 'pending'; retryAfterMs: number } | { status: 'complete'; account: ChatGPTOAuthSummary }> {
    const flow = this.getPending(loginId)
    if (flow.kind !== 'device') throw new ChatGPTOAuthError('wrong-login-flow')
    if (flow.exchanging) throw new ChatGPTOAuthError('exchange-already-started')
    if (flow.nextPollAt > this.now()) return { status: 'pending', retryAfterMs: flow.nextPollAt - this.now() }
    flow.nextPollAt = this.now() + flow.intervalMs
    let result: Record<string, unknown>
    try { result = await this.request(`${AUTH_ORIGIN}/api/accounts/deviceauth/token`, { device_auth_id: flow.deviceAuthId, user_code: flow.userCode }, false, options.signal) }
    catch (error) {
      if (error instanceof ChatGPTOAuthError && [403, 404].includes(error.httpStatus ?? 0)) return { status: 'pending', retryAfterMs: flow.intervalMs }
      throw error
    }
    if (this.pending.get(loginId) !== flow) throw new ChatGPTOAuthError('login-expired-or-cancelled')
    if (!nonempty(result.authorization_code) || !nonempty(result.code_verifier)) throw new ChatGPTOAuthError('invalid-device-authorization')
    flow.exchanging = true
    try {
      const token = await this.tokenRequest({ grant_type: 'authorization_code', client_id: this.options.clientId,
        code: result.authorization_code, code_verifier: result.code_verifier, redirect_uri: DEVICE_REDIRECT }, options.signal)
      return { status: 'complete', account: await this.persist(loginId, flow, token) }
    } finally { if (this.pending.get(loginId) === flow) this.pending.delete(loginId) }
  }
  private credential(target: OAuthCredentialTarget, token: Record<string, unknown>, existingRefresh?: string): ChatGPTOAuthCredential {
    const refreshToken = nonempty(token.refresh_token) ? token.refresh_token : existingRefresh
    if (!nonempty(token.access_token) || !nonempty(refreshToken) || typeof token.expires_in !== 'number'
      || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 365 * 24 * 3600) throw new ChatGPTOAuthError('invalid-token-response')
    const accountId = accountOf(token.access_token)
    if (target.expectedAccountId && accountId !== target.expectedAccountId) throw new ChatGPTOAuthError('account-mismatch')
    return { connectionId: target.connectionId, revision: target.revision, accountId, accessToken: token.access_token,
      refreshToken, expiresAt: this.now() + token.expires_in * 1000 }
  }
  private async persist(loginId: string, flow: Pending, token: Record<string, unknown>): Promise<ChatGPTOAuthSummary> {
    if (this.getPending(loginId) !== flow) throw new ChatGPTOAuthError('login-expired-or-cancelled')
    const credential = this.credential(flow.target, token)
    if (!await this.options.persistence.compareAndSet(flow.target.credentialRef, flow.version, credential)) throw new ChatGPTOAuthError('credential-changed-during-login')
    return summary(flow.target.credentialRef, credential)
  }
  async resolveCredential(connection: Readonly<ModelConnectionSnapshot>, options: { signal?: AbortSignal } = {}): Promise<{ accessToken: string; accountId: string }> {
    if (connection.auth.kind !== 'oauth' || connection.protocol !== 'chatgpt-responses') throw new ChatGPTOAuthError('wrong-connection-protocol')
    const ref = connection.auth.credentialRef
    return await this.options.persistence.withLease(ref, async () => {
      const entry = await this.options.persistence.read(ref), credential = entry.credential
      if (!credential || credential.connectionId !== connection.id || credential.revision !== connection.revision || credential.accountId !== connection.accountId) throw new ChatGPTOAuthError('credential-revoked-or-mismatched')
      let current = credential
      if (current.expiresAt <= this.now() + (this.options.refreshMarginMs ?? 60_000)) {
        const token = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: this.options.clientId }, options.signal)
        current = this.credential({ credentialRef: ref, connectionId: current.connectionId, revision: current.revision, expectedAccountId: current.accountId }, token, current.refreshToken)
        if (!await this.options.persistence.compareAndSet(ref, entry.version, current)) throw new ChatGPTOAuthError('credential-changed-during-refresh')
      }
      options.signal?.throwIfAborted()
      return { accessToken: current.accessToken, accountId: current.accountId }
    })
  }
  async revoke(credentialRef: string): Promise<void> {
    for (const [id, flow] of this.pending) if (flow.target.credentialRef === credentialRef) this.pending.delete(id)
    // CAS does not wait for a network refresh lease: a late refresh cannot resurrect this reference.
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await this.options.persistence.read(credentialRef)
      if (await this.options.persistence.compareAndSet(credentialRef, entry.version, null)) return
    }
    throw new ChatGPTOAuthError('concurrent-credential-update')
  }
  private async tokenRequest(body: Record<string, string>, signal?: AbortSignal) { return await this.request(TOKEN_ENDPOINT, body, true, signal) }
  private async request(url: string, body: Record<string, string>, form: boolean, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const controller = new AbortController(), abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    const timer = setTimeout(abort, this.options.timeoutMs ?? 30_000)
    let response: Response | undefined
    try {
      controller.signal.throwIfAborted()
      response = await (this.options.fetch ?? fetch)(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) })
      if (!response.ok) throw new ChatGPTOAuthError(`http-${response.status}`, response.status)
      if (!response.body) throw new ChatGPTOAuthError('empty-token-response')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0
      try {
        for (;;) { const next = await reader.read(); if (next.done) break; total += next.value.length
          if (total > 256 * 1024) throw new ChatGPTOAuthError('token-response-too-large'); chunks.push(next.value) }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!object(parsed)) throw new ChatGPTOAuthError('invalid-token-response')
      return parsed
    } catch (error) {
      if (error instanceof ChatGPTOAuthError) throw error
      throw new ChatGPTOAuthError(controller.signal.aborted ? 'cancelled-or-timeout' : 'request-failed')
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}
