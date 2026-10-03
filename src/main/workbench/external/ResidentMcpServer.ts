import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export type ResidentMcpListenResult =
  | { state: 'running'; port: number }
  | { state: 'port-in-use' | 'failed'; port: number; message: string }
export interface ResidentMcpClientInfo { name: string; version: string; title?: string }
export interface ResidentMcpCall {
  requestId: string | number
  method: string
  params: Record<string, unknown>
  /** true once the reply was fully written to a live connection; false if the client left or cancelled first. */
  delivery: Promise<boolean>
}
/** Domain sessions, tools and authority live behind this port; the transport only authenticates and frames JSON-RPC. */
export interface ResidentMcpHandler {
  initialize(client: ResidentMcpClientInfo): Promise<{ sessionId: string; instructions: string }>
  terminate(sessionId: string): void
  request(sessionId: string, call: ResidentMcpCall): Promise<unknown>
}
/** A JSON-RPC error the client should see as-is (invalid params, stopped session, unknown method). */
export class McpProtocolError extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}
interface TransportSession { version: string; initialized: boolean; inflight: Map<string | number, (delivered: boolean) => void> }

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const LOOPBACK = ['127.0.0.1', '::ffff:127.0.0.1']
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const safeEqual = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Fixed-port Streamable HTTP MCP transport for the explicitly started app: 127.0.0.1 only, Host-checked, no browser Origin, Bearer. */
export class ResidentMcpServer {
  private server?: Server
  private port?: number
  private token = ''
  private readonly sessions = new Map<string, TransportSession>()
  constructor(private readonly handler: ResidentMcpHandler) {}
  get listeningPort(): number | undefined { return this.port }

  async start(port: number, token: string): Promise<ResidentMcpListenResult> {
    await this.stop()
    this.token = token
    const server = createServer((request, response) => { void this.receive(request, response).catch(() => {
      if (!response.headersSent) this.respond(response, 500, rpcError(null, -32603, 'MCP 请求未完成'))
      else response.end()
    }) })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
      })
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      // Never fall back to another port: configured clients must keep pointing at the address shown in settings.
      if (code === 'EADDRINUSE') return { state: 'port-in-use', port, message: `端口 ${port} 已被其他程序占用，外部连接服务未启动。请在设置中改用其他端口（1024–65535），或关闭占用该端口的程序后重新启用。` }
      if (code === 'EACCES') return { state: 'port-in-use', port, message: `端口 ${port} 被系统保留或无权使用，外部连接服务未启动。请在设置中改用其他端口（1024–65535）。` }
      return { state: 'failed', port, message: `外部连接服务未能启动：${cause instanceof Error ? cause.message : String(cause)}` }
    }
    this.server = server
    this.port = (server.address() as { port: number }).port
    return { state: 'running', port: this.port }
  }
  /** The previous bearer stops working immediately and every attached transport session is dropped. */
  replaceToken(token: string): void {
    this.token = token
    this.dropSessions()
    this.server?.closeAllConnections()
  }
  /** Forget one transport session; its next request receives 404 and a standard client re-initializes. */
  dropSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    for (const settle of session.inflight.values()) settle(false)
  }
  private dropSessions(): void { for (const id of [...this.sessions.keys()]) this.dropSession(id) }
  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined; this.port = undefined
    this.dropSessions()
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  private respond(response: ServerResponse, status: number, value?: unknown, headers?: Record<string, string>) {
    response.writeHead(status, { 'Cache-Control': 'no-store', ...(value === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers })
    response.end(value === undefined ? undefined : JSON.stringify(value))
  }
  private authorized(request: IncomingMessage): boolean {
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1]
    return !!token && !!this.token && safeEqual(token, this.token)
  }
  private async receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const port = this.port
    if (!port || request.url !== '/mcp' || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '')) return this.respond(response, 404)
    // Native clients send no browser Origin; web pages and preview frames get no access.
    if (request.headers.origin !== undefined || !LOOPBACK.includes(request.socket.remoteAddress ?? '')) return this.respond(response, 403)
    if (!this.authorized(request)) return this.respond(response, 401)
    if (request.method === 'GET') return this.respond(response, 405, undefined, { Allow: 'POST, DELETE' })
    const sessionId = typeof request.headers['mcp-session-id'] === 'string' ? request.headers['mcp-session-id'] : undefined
    if (request.method === 'DELETE') {
      if (!sessionId || !this.sessions.has(sessionId)) return this.respond(response, 404)
      this.dropSession(sessionId)
      this.handler.terminate(sessionId)
      return this.respond(response, 204)
    }
    if (request.method !== 'POST') return this.respond(response, 405)
    if (!request.headers['content-type']?.startsWith('application/json')) return this.respond(response, 415)
    const accept = request.headers.accept ?? ''
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return this.respond(response, 406)
    const chunks: Buffer[] = []
    for await (const bytes of request) chunks.push(Buffer.from(bytes))
    let message: Record<string, unknown>
    try { const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); if (!record(parsed)) throw new Error(); message = parsed }
    catch { return this.respond(response, 400, rpcError(null, -32700, 'JSON 请求无效')) }
    const id = message.id
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || id !== undefined && typeof id !== 'string' && typeof id !== 'number') return this.respond(response, 400, rpcError(id, -32600, 'RPC 请求无效'))
    const params = record(message.params) ? message.params : {}
    if (message.method === 'initialize') {
      if (id === undefined || typeof params.protocolVersion !== 'string' || !record(params.capabilities) || !record(params.clientInfo)) return this.respond(response, 400, rpcError(id, -32602, 'MCP 初始化参数无效'))
      const version = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0]
      const info = params.clientInfo
      const client = { name: typeof info.name === 'string' && info.name.trim() ? info.name.trim() : '未命名客户端', version: typeof info.version === 'string' ? info.version : '',
        ...(typeof info.title === 'string' && info.title.trim() ? { title: info.title.trim() } : {}) }
      const opened = await this.handler.initialize(client)
      this.sessions.set(opened.sessionId, { version, initialized: false, inflight: new Map() })
      return this.respond(response, 200, { jsonrpc: '2.0', id, result: { protocolVersion: version, capabilities: { tools: {} },
        serverInfo: { name: 'guoling', title: '果铃', version: '2.0.0' }, instructions: opened.instructions } }, { 'MCP-Session-Id': opened.sessionId })
    }
    if (!sessionId) return this.respond(response, 400, rpcError(id, -32600, '缺少 MCP-Session-Id'))
    const session = this.sessions.get(sessionId)
    if (!session) return this.respond(response, 404)
    const version = request.headers['mcp-protocol-version']
    if (version !== undefined && version !== session.version) return this.respond(response, 400, rpcError(id, -32600, 'MCP 协议版本与会话不一致'))
    if (id === undefined) {
      if (message.method === 'notifications/initialized') session.initialized = true
      // A cancelled request means the client will discard our reply; its effect, if any, stays queryable.
      if (message.method === 'notifications/cancelled' && (typeof params.requestId === 'string' || typeof params.requestId === 'number')) session.inflight.get(params.requestId)?.(false)
      return this.respond(response, 202)
    }
    if (!session.initialized && message.method !== 'ping') return this.respond(response, 200, rpcError(id, -32000, '客户端尚未完成初始化'))
    if (message.method === 'ping') return this.respond(response, 200, { jsonrpc: '2.0', id, result: {} })
    let settled = false, settle!: (delivered: boolean) => void
    const delivery = new Promise<boolean>(resolve => { settle = delivered => { if (!settled) { settled = true; resolve(delivered) } } })
    response.once('close', () => settle(response.writableFinished))
    session.inflight.set(id, settle)
    try {
      const result = await this.handler.request(sessionId, { requestId: id, method: message.method, params, delivery })
      this.respond(response, 200, { jsonrpc: '2.0', id, result })
    } catch (cause) {
      this.respond(response, 200, rpcError(id, cause instanceof McpProtocolError ? cause.code : -32603, cause instanceof Error ? cause.message : '请求未完成'))
    } finally { if (session.inflight.get(id) === settle) session.inflight.delete(id) }
  }
}
