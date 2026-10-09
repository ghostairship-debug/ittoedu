import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { bootstrapInstalledMcp, type InstalledMcpBootstrapOptions } from '../src/main/workbench/external/installedMcpBootstrap'
import { readMcpConnectionReady, type McpConnectionReady } from '../src/shared/workbench/mcpConnection'

export interface ExplicitMcpConnection { endpoint: string; token: string; workspaceId?: string; host?: McpConnectionReady }

/** Accept the launcher's ready JSON or explicit HTTP credentials; never extract them from a UI. */
export function readExplicitMcpConnection(value: unknown): ExplicitMcpConnection {
  if (!value || typeof value !== 'object') throw new Error('需要显式 MCP 连接配置')
  const input = value as Record<string, unknown>
  if (typeof input.endpoint !== 'string' || typeof input.token !== 'string' || !input.token) throw new Error('连接配置需要 endpoint 与 token')
  const endpoint = new URL(input.endpoint)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('MCP 使用 HTTP 传输')
  if (input.workspaceId !== undefined && (typeof input.workspaceId !== 'string' || !input.workspaceId)) throw new Error('workspaceId 无效')
  return { endpoint: endpoint.href, token: input.token, ...(typeof input.workspaceId === 'string' ? { workspaceId: input.workspaceId } : {}),
    ...(input.status === 'ready' ? { host: readMcpConnectionReady(input) } : {}) }
}

/** Closing this SDK connection detaches the client; it does not stop a shared resident host. */
export async function connectExplicitMcp(connection: ExplicitMcpConnection, name = 'guoling-direct-sdk-example') {
  const client = new Client({ name, version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
  })
  try { await client.connect(transport) }
  catch (error) {
    await transport.terminateSession().catch(() => undefined)
    await client.close().catch(() => undefined)
    throw error
  }
  let detaching: Promise<void> | undefined
  const detach = () => detaching ??= (async () => {
    // close() only aborts this client's streams. DELETE releases its server run,
    // without shutting down the resident owner or its other clients.
    try { await transport.terminateSession() }
    finally { await client.close() }
  })()
  return {
    connection,
    client,
    call: async (name: string, args: Record<string, unknown> = {}) => CallToolResultSchema.parse(await client.callTool({ name, arguments: args })),
    detach,
  }
}

/** Launch/attach once, then consume the owner's actual facts through the same HTTP SDK. */
export async function connectInstalledMcp(options: InstalledMcpBootstrapOptions, name = 'guoling-direct-sdk') {
  const ready = await bootstrapInstalledMcp(options)
  return connectExplicitMcp(readExplicitMcpConnection(ready), name)
}

/** A successful transport is not proof of a committed document or a saved package. */
export function requireCurrentProjectSave(result: unknown, filename: string): void {
  if (!result || typeof result !== 'object' || !('kind' in result) || result.kind !== 'read' || !('data' in result)) {
    throw new Error('project.save 未返回正式保存回执')
  }
  const data = result.data
  if (!data || typeof data !== 'object' || !('status' in data) || data.status !== 'saved'
    || !('savedRevision' in data) || !Number.isSafeInteger(data.savedRevision)
    || !('currentRevision' in data) || data.savedRevision !== data.currentRevision
    || !('dirty' in data) || data.dirty !== false || !('path' in data) || typeof data.path !== 'string') {
    throw new Error('正式包尚未保存到当前 revision；请保留已有提交和恢复稿事实')
  }
  const normalized = (value: string) => process.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value
  if (normalized(data.path) !== normalized(filename)) throw new Error(`保存目标不符：实际 ${data.path}；请求 ${filename}`)
}
