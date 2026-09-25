import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { DocumentToolGateway } from '../../../core/tools/DocumentToolGateway'
import type { DocumentRegistry } from '../../../core/documents/DocumentRegistry'
import type { ToolResult, ToolRunGrant } from '../../../shared/workbench/tools'
import type { ExecutionEventInput } from '../../../shared/workbench/executionEvents'
import type { ExternalConnection, ExternalHandoff, ExternalGrantView } from '../../../shared/workbench/external'
import type { AttachmentProvenance } from '../../../shared/workbench/attachments'
export type { ExternalConnection } from '../../../shared/workbench/external'

interface ServerGrantInput {
  workspaceId: string; conversationId: string; taskId: string
  instruction: string; documents: ToolRunGrant['documents']; lifetimeMs?: number
  handoff?: ExternalHandoff
  expectedDocuments?: readonly { documentId: string; epoch: string; revision: number }[]
}
export interface ExternalResource {
  uri: string; name: string; mimeType: string
  provenance?: AttachmentProvenance
  gaps?: string[]
  content: { text: string } | { blob: string }
}
interface Grant {
  connection: ExternalConnection; input: ServerGrantInput; revoked: boolean
  status: ExternalGrantView['status']; barrier?: Promise<void>
  sessions: Map<string, { version: string; initialized: boolean }>; tickets: Set<string>; context: unknown
  resources: ExternalResource[]
  expiration?: ReturnType<typeof setTimeout>
}
export interface McpDocumentServerOptions {
  gateway: DocumentToolGateway
  registry: DocumentRegistry
  /** The caller owns persistence/events; no second Registry or domain implementation exists here. */
  appendEvent(event: ExecutionEventInput): Promise<unknown>
  now?: () => number
}
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const error = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const safeEqual = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const successful = (result: ToolResult) => result.kind === 'read' || result.kind === 'document-operation' && (result.result.status === 'applied' || result.result.status === 'unchanged')
const TICKET_RULE = '每个不同调用（包括只读）使用不同的 operationTickets 或 nextTicket。只读可以省略 ticket，由宿主分配。只有查询或重试同一个既有调用时复用它原来的 ticket、工具名和完全相同的 arguments；不能把读取用过的票据交给修改。'

/** Local Streamable HTTP MCP transport. Business schemas are embedded unchanged inside the protocol envelope. */
export class McpDocumentServer {
  private server?: Server
  private endpoint?: string
  private listening?: Promise<string>
  private readonly grants = new Map<string, Grant>()
  private readonly now: () => number
  constructor(private readonly options: McpDocumentServerOptions) { this.now = options.now ?? Date.now }
  async listen(): Promise<string> {
    if (this.endpoint) return this.endpoint
    if (this.listening) return this.listening
    this.listening = this.openServer().finally(() => { this.listening = undefined })
    return this.listening
  }
  private async openServer(): Promise<string> {
    const server = createServer((request, response) => { void this.receive(request, response).catch(() => {
      if (!response.headersSent) this.respond(response, 500, error(null, -32603, 'MCP 请求未完成'))
      else response.end()
    }) })
    this.server = server
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
    this.endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`
    return this.endpoint
  }
  async grant(input: ServerGrantInput, resources: ExternalResource[] = []): Promise<ExternalConnection> {
    if (!input.workspaceId || !input.conversationId || !input.taskId) throw new Error('外部连接缺少空间和任务身份')
    const lifetime = input.lifetimeMs ?? 30 * 60_000
    if (!Number.isSafeInteger(lifetime) || lifetime < 1000 || lifetime > 8 * 60 * 60_000) throw new Error('外部授权有效期无效')
    const endpoint = await this.listen(), runId = randomUUID()
    const frozen = structuredClone(input)
    await this.options.gateway.beginRun({ runId, actor: 'external', documents: frozen.documents })
    try {
      const documents = []
      for (const reference of frozen.documents) {
        const snapshot = await this.options.registry.get(reference.documentId).drain()
        const target = await this.options.gateway.issueTarget(runId, reference.documentId, { kind: 'document' })
        const writable = []
        for (const scope of reference.writable) writable.push({ kind: scope.kind, target: await this.options.gateway.issueTarget(runId, reference.documentId, scope) })
        documents.push({ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, target, writable })
      }
      // No await after this check: the returned handles must describe exactly the user-frozen authority.
      for (const expected of frozen.expectedDocuments ?? []) {
        const current = this.options.registry.get(expected.documentId).read()
        if (current.epoch !== expected.epoch || current.revision !== expected.revision) throw new Error('授权期间目标已改变，请重新选择')
      }
      const connection: ExternalConnection = { connectionId: randomUUID(), runId, endpoint, bearer: randomBytes(32).toString('base64url'), expiresAt: this.now() + lifetime }
      const grant: Grant = { connection, input: frozen, revoked: false, status: 'active', sessions: new Map(), tickets: new Set(), resources: structuredClone(resources),
        context: { instruction: frozen.instruction, documents, handoff: frozen.handoff,
          attachments: resources.map(({ content: _, ...description }) => description),
          visibility: '果铃只记录收到的工具调用；外部聊天、模型用量和任务是否结束未知。', authority: '授权目标固定；请先读取当前文档。外部磁盘写入不属于宿主提交。', ticketRule: TICKET_RULE } }
      this.grants.set(connection.connectionId, grant)
      grant.expiration = setTimeout(() => { void this.revoke(connection.connectionId, 'expired').catch(() => undefined) }, lifetime)
      grant.expiration.unref()
      return { ...connection }
    } catch (cause) { await this.options.gateway.stop(runId); throw cause }
  }
  status(connectionId: string): ExternalGrantView['status'] {
    const grant = this.grants.get(connectionId)
    if (!grant) return 'closed'
    if (!grant.revoked && grant.connection.expiresAt <= this.now()) void this.revoke(connectionId, 'expired').catch(() => undefined)
    return grant.status
  }
  async revoke(connectionId: string, status: 'revoked' | 'expired' | 'closed' = 'revoked'): Promise<void> {
    const grant = this.grants.get(connectionId)
    if (!grant) return
    if (grant.revoked) return grant.barrier
    grant.revoked = true; grant.status = status; grant.sessions.clear()
    clearTimeout(grant.expiration)
    grant.barrier = this.options.gateway.stop(grant.connection.runId)
    await grant.barrier
  }
  async close(): Promise<void> {
    await Promise.all([...this.grants.keys()].map(id => this.revoke(id, 'closed')))
    const server = this.server; this.server = undefined; this.endpoint = undefined
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(cause => cause ? reject(cause) : resolve())) }
  }
  private respond(response: ServerResponse, status: number, value?: unknown, headers?: Record<string, string>) {
    response.writeHead(status, { 'Cache-Control': 'no-store', ...(value === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers })
    response.end(value === undefined ? undefined : JSON.stringify(value))
  }
  private authorize(request: IncomingMessage): Grant | undefined {
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1]
    if (!token) return
    return [...this.grants.values()].find(grant => this.status(grant.connection.connectionId) === 'active' && safeEqual(token, grant.connection.bearer))
  }
  private ticket(grant: Grant): string {
    if (grant.tickets.size >= 4096) throw new Error('本次连接操作票据已达上限，请重新授权')
    const ticket = randomUUID(); grant.tickets.add(ticket); return ticket
  }
  private async emit(grant: Grant, callId: string, type: ExecutionEventInput['type'], data: ExecutionEventInput['data'], update: ExecutionEventInput['update'] = 'snapshot') {
    await this.options.appendEvent({ eventId: randomUUID(), conversationId: grant.input.conversationId, taskId: grant.input.taskId, runId: grant.connection.runId,
      itemId: callId, time: this.now(), source: 'external-mcp', type, update, data })
  }
  private async receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Native clients have no browser Origin. Preview pages and arbitrary websites have no bridge access.
    if (!this.endpoint || request.url !== '/mcp' || request.headers.host !== new URL(this.endpoint).host) return this.respond(response, 404)
    if (request.headers.origin !== undefined || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) return this.respond(response, 403)
    const grant = this.authorize(request)
    if (!grant) return this.respond(response, 401)
    if (request.method === 'GET') return this.respond(response, 405, undefined, { Allow: 'POST, DELETE' })
    const sessionId = typeof request.headers['mcp-session-id'] === 'string' ? request.headers['mcp-session-id'] : undefined
    if (request.method === 'DELETE') {
      if (!sessionId || !grant.sessions.has(sessionId)) return this.respond(response, 404)
      grant.sessions.delete(sessionId) // Closing one transport does not revoke another independently attached bridge.
      return this.respond(response, 204)
    }
    if (request.method !== 'POST') return this.respond(response, 405)
    if (!request.headers['content-type']?.startsWith('application/json')) return this.respond(response, 415)
    const accept = request.headers.accept ?? ''
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return this.respond(response, 406)
    const chunks: Buffer[] = []; let length = 0
    for await (const bytes of request) {
      length += bytes.length
      if (length > 4 * 1024 * 1024) return this.respond(response, 413)
      chunks.push(Buffer.from(bytes))
    }
    let message: Record<string, unknown>
    try { const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); if (!record(parsed)) throw new Error(); message = parsed }
    catch { return this.respond(response, 400, error(null, -32700, 'JSON 请求无效')) }
    const id = message.id
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || id !== undefined && typeof id !== 'string' && typeof id !== 'number') return this.respond(response, 400, error(id, -32600, 'RPC 请求无效'))
    if (message.method === 'initialize') {
      if (id === undefined || !record(message.params) || typeof message.params.protocolVersion !== 'string' || !record(message.params.capabilities) || !record(message.params.clientInfo)) return this.respond(response, 400, error(id, -32602, 'MCP 初始化参数无效'))
      if (grant.revoked) return this.respond(response, 401)
      const version = VERSIONS.includes(message.params.protocolVersion) ? message.params.protocolVersion : VERSIONS[0]
      const session = randomUUID(); grant.sessions.set(session, { version, initialized: false })
      return this.respond(response, 200, { jsonrpc: '2.0', id, result: { protocolVersion: version,
        capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'guoling', version: '2.0.0-candidate' },
        instructions: '先用 resources/read 读取 guoling://task/context。工具的 arguments 字段直接使用同源领域 schema；写入时传宿主签发的 ticket。' + TICKET_RULE } }, { 'MCP-Session-Id': session })
    }
    if (!sessionId) return this.respond(response, 400)
    const session = grant.sessions.get(sessionId)
    if (!session) return this.respond(response, 404)
    const version = request.headers['mcp-protocol-version']
    if (version !== undefined && version !== session.version) return this.respond(response, 400)
    if (id === undefined) {
      if (message.method === 'notifications/initialized') { session.initialized = true; return this.respond(response, 202) }
      // Cancelling a transport request is not authority to stop an entire external agent or grant.
      if (message.method === 'notifications/cancelled') return this.respond(response, 202)
      return this.respond(response, 202)
    }
    if (!session.initialized && message.method !== 'ping') return this.respond(response, 400, error(id, -32000, '客户端尚未完成初始化'))
    try {
      const result = await this.dispatch(grant, message.method, message.params)
      this.respond(response, 200, { jsonrpc: '2.0', id, result })
    } catch (cause) { this.respond(response, 200, error(id, -32602, cause instanceof Error ? cause.message : '工具请求未完成')) }
  }
  private async dispatch(grant: Grant, method: string, raw: unknown): Promise<unknown> {
    if (grant.revoked || grant.connection.expiresAt <= this.now()) throw new Error('外部授权已失效')
    if (method === 'ping') return {}
    const params = record(raw) ? raw : {}
    if (method === 'resources/list') return { resources: [{ uri: 'guoling://task/context', name: '本次任务与授权目标', mimeType: 'application/json' }, ...grant.resources.map(({ uri, name, mimeType }) => ({ uri, name, mimeType }))] }
    if (method === 'resources/templates/list') return { resourceTemplates: [] }
    if (method === 'resources/read') {
      if (params.uri !== 'guoling://task/context') {
        const resource = grant.resources.find(item => item.uri === params.uri)
        if (!resource) throw new Error('此资源不属于本次授权')
        return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, ...resource.content }] }
      }
      return { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify({ ...grant.context as object, operationTickets: Array.from({ length: 16 }, () => this.ticket(grant)) }) }] }
    }
    if (method === 'tools/list') {
      const tools = await this.options.gateway.describe()
      return { tools: [
        ...tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: { type: 'object', additionalProperties: false,
          properties: { arguments: tool.schema, ticket: { type: 'string', description: TICKET_RULE } },
          required: tool.manual.group === 'read' ? ['arguments'] : ['arguments', 'ticket'] } })),
        { name: 'operation.lookup', description: '只查询原操作的正式回执，不执行或重放工具。', inputSchema: { type: 'object', additionalProperties: false,
          properties: { ticket: { type: 'string' }, name: { type: 'string' }, arguments: { type: 'object' } }, required: ['ticket', 'name', 'arguments'] } },
      ] }
    }
    if (method !== 'tools/call' || typeof params.name !== 'string' || !record(params.arguments)) throw new Error('不支持此 MCP 方法')
    const envelope = params.arguments
    if (Object.keys(envelope).some(key => !['arguments', 'ticket', 'name'].includes(key))) throw new Error('工具协议参数无效')
    const lookup = params.name === 'operation.lookup'
    const name = lookup ? envelope.name : params.name
    const definition = (await this.options.gateway.describe()).find(tool => tool.name === name)
    if (!definition) throw new Error('工具不存在')
    const supplied = envelope.ticket
    if (supplied !== undefined && (typeof supplied !== 'string' || !grant.tickets.has(supplied))) throw new Error('操作票据不属于当前连接')
    if ((lookup || definition.manual.group !== 'read') && typeof supplied !== 'string') throw new Error('修改需要本次授权的操作票据')
    const ticket = typeof supplied === 'string' ? supplied : this.ticket(grant)
    const call = { name: definition.name, input: envelope.arguments }
    if (!lookup) await this.emit(grant, ticket, 'tool', { toolName: call.name, label: definition.manual.label, status: 'running', text: '已收到外部工具请求。' }, 'append')
    let result: ToolResult
    try {
      if (grant.revoked || grant.connection.expiresAt <= this.now()) throw new Error('外部授权已失效')
      const known = await this.options.gateway.lookup(grant.connection.runId, ticket, call)
      if (!lookup) await this.emit(grant, ticket, 'tool', { status: 'running', text: known ? '已找到同一票据的正式回执。' : '已核对同一票据，未发现既有回执。' }, 'append')
      if (known) result = known
      else if (lookup) result = { kind: 'error', code: 'operation-not-found', message: '尚未找到正式提交；未执行工具' }
      else {
        await this.emit(grant, ticket, 'tool', { status: 'running', text: '已完成票据核对，准备调用正式工具。' }, 'append')
        result = await this.options.gateway.execute(grant.connection.runId, ticket, call)
      }
    } catch (cause) {
      if (!lookup) await this.emit(grant, ticket, 'tool', { toolName: call.name, label: definition.manual.label, status: 'failed', error: cause instanceof Error ? cause.message : String(cause) })
      throw cause
    }
    if (!lookup) {
      await this.emit(grant, ticket, 'tool', { toolName: call.name, label: definition.manual.label, status: successful(result) ? 'completed' : 'failed',
        input: JSON.stringify(call.input), output: JSON.stringify(result),
        ...(result.kind === 'error' ? { error: result.message } : {}),
        ...(result.kind === 'document-operation' ? { documentId: result.result.documentId, operationId: result.result.operationId, applicationStatus: result.result.status,
          ...('message' in result.result ? { error: result.result.message } : { revision: result.result.revision }) } : {}),
      })
      if (result.kind === 'document-operation' && (result.result.status === 'applied' || result.result.status === 'unchanged')) await this.emit(grant, `${ticket}:commit`, 'document.commit', {
        documentId: result.result.documentId, operationId: result.result.operationId, revision: result.result.revision, status: result.result.status, label: '外部工具修改已应用',
      })
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result, ticket, nextTicket: this.ticket(grant) }, isError: !successful(result) }
  }
}
