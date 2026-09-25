import { createServer, type Server, type ServerResponse } from 'node:http'
import type { OAuthLoginStatus } from '../../../shared/workbench/executionSettingsDesktop'
import type { ModelConnectionSnapshot } from '../../../shared/workbench/modelProvider'
import { ChatGPTOAuthClient, ChatGPTOAuthError } from './ChatGPTOAuthClient'
import { ExecutionSettingsError, type ExecutionSettingsStore } from './ExecutionSettingsStore'
import { createOAuthSecurePersistence } from './OAuthSecurePersistence'

/** Public native-client parameters used by the referenced OpenClaw/Codex browser PKCE flow.
 * Reference: openclaw/openclaw@78d5bedb34de17f9fadc49b0c643267f3b8015fc,
 * extensions/openai/openai-chatgpt-oauth-authorization.runtime.ts L4-10.
 * This is a public client identifier, not an application secret or imported user credential.
 */
export const CHATGPT_PUBLIC_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export interface OAuthDesktopServiceOptions {
  store: ExecutionSettingsStore
  openExternal(url: string): Promise<void>
  clientId?: string
  fetch?: typeof fetch
  callbackPort?: number
  callbackHost?: 'localhost' | '127.0.0.1'
  loginTimeoutMs?: number
  now?: () => number
}
type Session = { status: OAuthLoginStatus; connectionId: string; credentialRef: string; server: Server; client: ChatGPTOAuthClient;
  controller: AbortController; timer: ReturnType<typeof setTimeout>; exchanging: boolean }
function reply(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
  response.end(`<!doctype html><meta charset="utf-8"><title>果铃登录</title><p>${message}</p>`)
}
/** Only the explicit settings button opens a browser. No external runtime or ambient credentials. */
export class OAuthDesktopService {
  private readonly sessions = new Map<string, Session>()
  private starting = false
  private readonly resolver: ChatGPTOAuthClient
  constructor(private readonly options: OAuthDesktopServiceOptions) {
    this.resolver = this.createClient('http://localhost:1455/auth/callback')
  }
  private createClient(redirectURI: string) {
    return new ChatGPTOAuthClient({ clientId: this.options.clientId ?? CHATGPT_PUBLIC_CLIENT_ID, redirectURI,
      originator: 'guoling', persistence: createOAuthSecurePersistence(this.options.store), fetch: this.options.fetch, now: this.options.now })
  }
  async start(id: string, revision: number): Promise<OAuthLoginStatus> {
    if (this.starting || [...this.sessions.values()].some(session => session.status.status === 'pending')) throw new ExecutionSettingsError('oauth-login-pending', '已有登录正在进行，请完成或取消后重试。')
    this.starting = true
    const host = this.options.callbackHost ?? 'localhost', server = createServer()
    let session: Session | undefined, credentialRef: string | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error)
        server.once('error', failed)
        server.listen(this.options.callbackPort ?? 1455, host, () => { server.removeListener('error', failed); resolve() })
      }).catch(() => { throw new ExecutionSettingsError('oauth-callback-port-in-use', '登录回调端口不可用，可能正被其他登录使用。请结束该登录后重试。') })
      server.on('error', () => { if (session?.status.status === 'pending') void this.cancel(session.status.loginId) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new ExecutionSettingsError('oauth-callback-unavailable', '无法准备本机登录回调。')
      const redirectURI = `http://${host}:${address.port}/auth/callback`, client = this.createClient(redirectURI)
      const target = await this.options.store.reserveOAuthLogin(id, revision); credentialRef = target.credentialRef
      const started = await client.beginAuthorization(target)
      const timer = setTimeout(() => { void this.cancel(started.loginId) }, this.options.loginTimeoutMs ?? 15 * 60_000); timer.unref()
      session = { status: { loginId: started.loginId, status: 'pending' }, connectionId: id, credentialRef, server, client,
        controller: new AbortController(), timer, exchanging: false }
      this.sessions.set(started.loginId, session)
      // Keep bounded completed statuses for UI polling, never credentials or authorization codes.
      for (const [key, value] of this.sessions) if (this.sessions.size > 32 && value.status.status !== 'pending') this.sessions.delete(key)
      server.on('request', (request, response) => {
        const current = session!
        if (request.method !== 'GET' || !request.url?.startsWith('/auth/callback?')) { reply(response, 404, '此地址只接收本次登录回调。'); return }
        if (current.status.status !== 'pending' || current.exchanging) { reply(response, 409, '登录已结束或正在处理，请返回果铃。'); return }
        current.exchanging = true
        void client.completeAuthorization(started.loginId, `${redirectURI}${request.url.slice('/auth/callback'.length)}`, { signal: current.controller.signal }).then(async result => {
          if (current.status.status !== 'pending') { reply(response, 409, '登录已取消，请返回果铃。'); return }
          const connection = (await this.options.store.read()).connections.find(entry => entry.connection.id === id && entry.connection.revision === result.revision)
          if (!connection?.hasCredential) throw new ExecutionSettingsError('oauth-stale-login', '登录期间连接已改变，请刷新设置。')
          current.status = { loginId: started.loginId, status: 'connected', connection }
          reply(response, 200, '已登录果铃。模型和图片能力尚未验证，请返回果铃。')
          this.close(current)
        }).catch(error => {
          if (error instanceof ChatGPTOAuthError && ['state-or-callback-mismatch', 'invalid-callback'].includes(error.code)) {
            current.exchanging = false; reply(response, 400, '登录回调校验失败，请使用本次登录窗口继续。'); return
          }
          if (current.status.status === 'pending') current.status = { loginId: started.loginId, status: 'failed',
            code: error instanceof ChatGPTOAuthError || error instanceof ExecutionSettingsError ? error.code : 'oauth-login-failed',
            message: error instanceof ExecutionSettingsError ? error.message : 'ChatGPT 登录未完成，原连接配置已保留。' }
          reply(response, 400, '登录未完成，请返回果铃查看状态。'); this.close(current)
          void client.revoke(target.credentialRef).catch(() => undefined)
        })
      })
      await this.options.openExternal(started.authorizationURL)
      return structuredClone(session.status)
    } catch (error) {
      if (session) await this.cancel(session.status.loginId)
      else { server.close(); if (credentialRef) await this.resolver.revoke(credentialRef).catch(() => undefined) }
      throw error
    } finally { this.starting = false }
  }
  status(loginId: string): OAuthLoginStatus {
    const session = this.sessions.get(loginId)
    if (!session) throw new ExecutionSettingsError('oauth-login-not-found', '此登录已结束，请刷新连接设置。')
    return structuredClone(session.status)
  }
  private close(session: Session) { clearTimeout(session.timer); session.server.close() }
  async cancel(loginId: string): Promise<void> {
    const session = this.sessions.get(loginId)
    if (!session || session.status.status !== 'pending') return
    const committed = await this.options.store.settleOAuthCancellation(session.credentialRef)
    if (committed) { session.status = { loginId, status: 'connected', connection: committed }; this.close(session); return }
    session.status = { loginId, status: 'cancelled' }; session.controller.abort(); session.client.cancel(loginId); this.close(session)
  }
  async revokeConnection(id: string): Promise<void> {
    for (const session of this.sessions.values()) if (session.connectionId === id) await this.cancel(session.status.loginId)
    await this.options.store.revokeConnection(id)
  }
  async resolveCredential(connection: Readonly<ModelConnectionSnapshot>): Promise<{ accessToken: string; accountId: string }> {
    await this.options.store.assertOAuthConnection(connection)
    const result = await this.resolver.resolveCredential(connection)
    await this.options.store.assertOAuthConnection(connection)
    return result
  }
}
