import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export type McpClientConnection = {
  namespace: string
  transport: { kind: 'streamable-http'; endpoint: string; bearer?: string }
    | { kind: 'stdio'; command: string; args: readonly string[]; cwd?: string; env?: Readonly<Record<string, string>> }
  /** Explicit host classifications; remote annotations alone never grant a write. */
  tools: readonly { name: string; effect: 'read' | 'write' }[]
}

export interface McpRunGrant {
  /** Exact remote names approved for this task. */
  allowedTools: readonly string[]
  writeAllowed: boolean
}

export type McpDiscoveredTool = { name: string; remoteName: string; description: string; inputSchema: Record<string, unknown>; effect: 'read' | 'write' }
export type McpDiscovery = { status: 'available'; tools: readonly McpDiscoveredTool[] }
  | { status: 'not-configured' | 'failed' | 'stopped'; reason: string }

export type McpContent =
  | { type: 'text'; text: string; truncated: boolean }
  | { type: 'binary'; resourceId: string; mimeType: string; byteLength: number }
  | { type: 'resource-link'; uri: string; name: string; mimeType?: string; origin: 'remote' }

export type McpCallResult =
  | { status: 'returned'; service: string; tool: string; operationId: string; content: readonly McpContent[]; structuredContent?: unknown; truncated: boolean }
  | { status: 'rejected' | 'failed' | 'unknown'; service: string; tool: string; operationId: string; reason: string }

interface McpClientLike {
  listTools(params?: { cursor?: string }, options?: { signal?: AbortSignal; timeout?: number }): Promise<{ tools: readonly { name: string; description?: string;
    inputSchema: Record<string, unknown> }[]; nextCursor?: string }>
  callTool(params: { name: string; arguments: Record<string, unknown> }, schema?: undefined,
    options?: { signal?: AbortSignal; timeout?: number }): Promise<{ content: readonly unknown[]; structuredContent?: unknown; isError?: boolean }>
  close(): Promise<void>
}

export interface McpClientOptions {
  connection?: McpClientConnection
  /** Optional task-specific guard for reads such as browser navigation and output paths. */
  authorizeCall?: (input: { runId: string; service: string; tool: string; effect: 'read' | 'write'; arguments: Record<string, unknown> }) => Promise<boolean>
  /** Must validate concrete resources and the current task's authority. Missing means no external writes. */
  authorizeWrite?: (input: { runId: string; service: string; tool: string; arguments: Record<string, unknown> }) => Promise<boolean>
  /** Test seam. Production always uses the SDK and a real external transport. */
  connect?: (connection: McpClientConnection) => Promise<McpClientLike>
}

interface RunState {
  stopped: boolean
  grant: McpRunGrant
  client?: McpClientLike
  connecting?: Promise<McpClientLike>
  tools?: Map<string, McpDiscoveredTool>
  discovering?: Promise<McpDiscovery>
  controllers: Set<AbortController>
  results: Map<string, { digest: string; result: Promise<McpCallResult> }>
  resources: Map<string, { mimeType: string; bytes: Uint8Array }>
}

const nameRule = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/
const namespaceRule = /^[a-z][a-z0-9_-]{0,31}$/

function validateConnection(connection: McpClientConnection): void {
  if (!namespaceRule.test(connection.namespace)) throw new Error('外部服务命名空间无效')
  const names = new Set<string>()
  for (const tool of connection.tools) {
    if (!nameRule.test(tool.name) || names.has(tool.name)) throw new Error('外部工具名称重复或无效')
    names.add(tool.name)
  }
  if (connection.transport.kind === 'streamable-http') {
    const url = new URL(connection.transport.endpoint)
    if (url.username || url.password || url.hash || !url.hostname || !(url.protocol === 'https:'
      || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))
      throw new Error('外部 MCP endpoint 必须使用 HTTPS 或本机 HTTP')
    if (connection.transport.bearer && url.protocol !== 'https:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
      throw new Error('外部 MCP 凭据不能发往非 TLS 远程服务')
  } else if (!isAbsolute(connection.transport.command) || connection.transport.args.some(arg => typeof arg !== 'string')
    || connection.transport.cwd && !isAbsolute(connection.transport.cwd)) throw new Error('外部 MCP 进程必须使用绝对可执行文件和工作目录')
}

async function connectSdk(connection: McpClientConnection): Promise<McpClientLike> {
  const client = new Client({ name: 'guoling', version: '2.0.0' })
  const transport = connection.transport.kind === 'streamable-http'
    ? new StreamableHTTPClientTransport(new URL(connection.transport.endpoint), {
      requestInit: connection.transport.bearer ? { headers: { Authorization: `Bearer ${connection.transport.bearer}` } } : undefined,
    })
    : new StdioClientTransport({ command: connection.transport.command, args: [...connection.transport.args],
      ...(connection.transport.cwd ? { cwd: connection.transport.cwd } : {}),
      ...(connection.transport.env ? { env: { ...connection.transport.env } } : {}), stderr: 'ignore' })
  try { await client.connect(transport); return client as unknown as McpClientLike }
  catch (cause) { await transport.close().catch(() => undefined); throw cause }
}

function summarizeError(cause: unknown): string { return cause instanceof Error ? cause.message.slice(0, 500) : '外部服务没有返回可核对结果' }

/** One host-managed external service; every run receives its own MCP session. */
export class McpClientService {
  private readonly runs = new Map<string, RunState>()
  private readonly connection?: McpClientConnection
  private readonly connect: (connection: McpClientConnection) => Promise<McpClientLike>
  constructor(private readonly options: McpClientOptions = {}) {
    if (options.connection) { validateConnection(options.connection); this.connection = structuredClone(options.connection) }
    this.connect = options.connect ?? connectSdk
  }

  beginRun(runId: string, grant: McpRunGrant): void {
    if (this.runs.has(runId)) throw new Error('外部工具任务已开始')
    const names = new Set(this.connection?.tools.map(tool => tool.name) ?? [])
    if (grant.allowedTools.some(name => !names.has(name))) throw new Error('外部工具不属于当前已配置服务')
    this.runs.set(runId, { stopped: false, grant: structuredClone(grant), controllers: new Set(), results: new Map(), resources: new Map() })
  }

  private requireRun(runId: string): RunState {
    const run = this.runs.get(runId)
    if (!run) throw new Error('外部工具任务尚未授权')
    return run
  }

  private async client(run: RunState): Promise<McpClientLike> {
    if (!this.connection) throw new Error('未配置外部 MCP 服务')
    if (run.stopped) throw new Error('任务已停止')
    if (run.client) return run.client
    run.connecting ??= this.connect(this.connection).then(async client => {
      if (run.stopped) { await client.close(); throw new Error('任务已停止') }
      run.client = client
      return client
    }).finally(() => { run.connecting = undefined })
    return run.connecting
  }

  async discover(runId: string, signal?: AbortSignal): Promise<McpDiscovery> {
    const run = this.requireRun(runId)
    if (run.stopped) return { status: 'stopped', reason: '任务已停止' }
    if (!this.connection) return { status: 'not-configured', reason: '未配置已授权的外部 MCP 服务' }
    if (run.tools) return { status: 'available', tools: [...run.tools.values()] }
    if (run.discovering) return run.discovering
    const work = this.loadTools(run, signal)
    run.discovering = work
    try { return await work } finally { if (run.discovering === work) run.discovering = undefined }
  }

  private async loadTools(run: RunState, signal?: AbortSignal): Promise<McpDiscovery> {
    if (!this.connection) return { status: 'not-configured', reason: '未配置已授权的外部 MCP 服务' }
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    run.controllers.add(controller)
    try {
      const client = await this.client(run)
      const configured = new Map(this.connection.tools.map(tool => [tool.name, tool.effect]))
      const visible = new Set(run.grant.allowedTools)
      const tools = new Map<string, McpDiscoveredTool>()
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 20; page++) {
        const result = await client.listTools(cursor ? { cursor } : undefined, { signal: controller.signal, timeout: 12_000 })
        if (run.stopped || controller.signal.aborted) return { status: 'stopped', reason: '任务已停止' }
        for (const tool of result.tools) {
          const effect = configured.get(tool.name)
          if (!effect || !visible.has(tool.name)) continue
          if (!nameRule.test(tool.name) || tools.has(tool.name) || JSON.stringify(tool.inputSchema).length > 64_000) continue
          tools.set(tool.name, { name: `mcp.${this.connection.namespace}.${tool.name}`, remoteName: tool.name,
            description: tool.description?.slice(0, 2000) ?? '', inputSchema: structuredClone(tool.inputSchema), effect })
        }
        cursor = result.nextCursor
        if (!cursor) break
        if (seen.has(cursor)) return { status: 'failed', reason: '外部工具分页游标重复' }
        seen.add(cursor)
      }
      if (cursor) return { status: 'failed', reason: '外部工具列表超出分页上限' }
      run.tools = tools
      return { status: 'available', tools: [...tools.values()] }
    } catch (cause) { return { status: 'failed', reason: summarizeError(cause) } }
    finally { run.controllers.delete(controller); signal?.removeEventListener('abort', onAbort) }
  }

  async invoke(input: { runId: string; operationId: string; name: string; arguments: Record<string, unknown>; signal?: AbortSignal }): Promise<McpCallResult> {
    const run = this.requireRun(input.runId), service = this.connection?.namespace ?? 'unconfigured'
    const reject = (reason: string): McpCallResult => ({ status: 'rejected', service, tool: input.name, operationId: input.operationId, reason })
    if (!input.operationId || input.operationId.length > 512 || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) return reject('外部工具参数或操作身份无效')
    if (run.stopped || input.signal?.aborted) return reject('任务已停止')
    const digest = createHash('sha256').update(JSON.stringify([input.name, input.arguments])).digest('hex')
    const prior = run.results.get(input.operationId)
    if (prior) return prior.digest === digest ? prior.result : reject('同一操作身份不能更换工具或参数')
    const work = this.call(run, input)
    run.results.set(input.operationId, { digest, result: work })
    return work
  }

  private async call(run: RunState, input: { runId: string; operationId: string; name: string; arguments: Record<string, unknown>; signal?: AbortSignal }): Promise<McpCallResult> {
    const service = this.connection?.namespace ?? 'unconfigured'
    const outcome = (status: 'rejected' | 'failed' | 'unknown', reason: string): McpCallResult => ({ status, service, tool: input.name, operationId: input.operationId, reason })
    if (!this.connection) return outcome('rejected', '未配置外部 MCP 服务')
    const discovered = await this.discover(input.runId, input.signal)
    if (discovered.status !== 'available') return outcome('rejected', discovered.reason)
    const tool = discovered.tools.find(item => item.name === input.name)
    if (!tool) return outcome('rejected', '外部工具未在当前任务授权范围内发现')
    if (this.options.authorizeCall) {
      try {
        if (!(await this.options.authorizeCall({ runId: input.runId, service, tool: tool.remoteName,
          effect: tool.effect, arguments: structuredClone(input.arguments) }))) return outcome('rejected', '外部工具目标不在当前任务授权范围内')
      } catch { return outcome('rejected', '无法核对外部工具目标') }
    }
    if (tool.effect === 'write') {
      if (!run.grant.writeAllowed || !this.options.authorizeWrite) return outcome('rejected', '外部修改未经授权')
      try {
        if (!(await this.options.authorizeWrite({ runId: input.runId, service, tool: tool.remoteName, arguments: structuredClone(input.arguments) })))
          return outcome('rejected', '本次外部修改目标未获授权')
      } catch { return outcome('rejected', '无法核对本次外部修改目标') }
    }
    if (run.stopped || input.signal?.aborted) return outcome('rejected', '任务已停止')
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    input.signal?.addEventListener('abort', onAbort, { once: true })
    run.controllers.add(controller)
    try {
      const client = await this.client(run)
      const reply = await client.callTool({ name: tool.remoteName, arguments: structuredClone(input.arguments) }, undefined,
        { signal: controller.signal, timeout: 30_000 })
      if (run.stopped || controller.signal.aborted) return outcome('unknown', '任务停止后外部调用结果待核对，不会自动重试或应用')
      if (reply.isError) return outcome(tool.effect === 'write' ? 'unknown' : 'failed', '外部服务报告操作错误；修改结果需按原资源核对')
      const projected = this.project(run, reply.content, reply.structuredContent)
      return { status: 'returned', service, tool: input.name, operationId: input.operationId, ...projected }
    } catch (cause) {
      return outcome(tool.effect === 'write' ? 'unknown' : 'failed', `${summarizeError(cause)}${tool.effect === 'write' ? '；外部修改结果未知，不会自动重发' : ''}`)
    } finally { run.controllers.delete(controller); input.signal?.removeEventListener('abort', onAbort) }
  }

  private project(run: RunState, blocks: readonly unknown[], structured: unknown): { content: McpContent[]; structuredContent?: unknown; truncated: boolean } {
    const content: McpContent[] = []
    let textBudget = 50_000, truncated = false
    for (const block of blocks.slice(0, 40)) {
      if (!block || typeof block !== 'object') continue
      const item = block as Record<string, unknown>
      if (item.type === 'text' && typeof item.text === 'string') {
        const text = item.text.slice(0, Math.min(16_000, textBudget))
        const cut = text.length < item.text.length
        content.push({ type: 'text', text, truncated: cut })
        truncated ||= cut; textBudget -= text.length
      } else if ((item.type === 'image' || item.type === 'audio') && typeof item.data === 'string' && typeof item.mimeType === 'string') {
        const bytes = Buffer.from(item.data, 'base64')
        if (bytes.byteLength > 5 * 1024 * 1024) { truncated = true; continue }
        const resourceId = randomUUID()
        run.resources.set(resourceId, { mimeType: item.mimeType, bytes })
        content.push({ type: 'binary', resourceId, mimeType: item.mimeType, byteLength: bytes.byteLength })
      } else if (item.type === 'resource_link' && typeof item.uri === 'string' && typeof item.name === 'string') {
        content.push({ type: 'resource-link', uri: item.uri, name: item.name, origin: 'remote',
          ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}) })
      }
    }
    if (blocks.length > 40) truncated = true
    let structuredContent: unknown
    if (structured !== undefined) {
      try { if (JSON.stringify(structured).length <= 50_000) structuredContent = structuredClone(structured); else truncated = true }
      catch { truncated = true }
    }
    return { content, truncated, ...(structuredContent === undefined ? {} : { structuredContent }) }
  }

  readResource(runId: string, resourceId: string): { mimeType: string; bytes: Uint8Array } {
    const run = this.requireRun(runId)
    if (run.stopped) throw new Error('任务已停止，外部结果不可再应用')
    const resource = run.resources.get(resourceId)
    if (!resource) throw new Error('外部结果资源不属于当前任务')
    return { mimeType: resource.mimeType, bytes: new Uint8Array(resource.bytes) }
  }

  lookup(runId: string, operationId: string): Promise<McpCallResult | null> {
    return this.requireRun(runId).results.get(operationId)?.result ?? Promise.resolve(null)
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run || run.stopped) return
    run.stopped = true
    for (const controller of run.controllers) controller.abort()
    run.resources.clear()
    const client = run.client
    if (client) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([client.close().catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, 3000); timer.unref() })])
      if (timer) clearTimeout(timer)
    }
  }

  async endRun(runId: string): Promise<void> { await this.stopRun(runId); this.runs.delete(runId) }
}
