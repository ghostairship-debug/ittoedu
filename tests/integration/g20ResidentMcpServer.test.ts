// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { request as httpRequest } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpProtocolError, ResidentMcpServer, type ResidentMcpCall, type ResidentMcpHandler } from '../../src/main/workbench/external/ResidentMcpServer'
import { ResidentMcpSettingsStore } from '../../src/main/workbench/external/ResidentMcpSettings'
import { DEFAULT_EXTERNAL_MCP_SETTINGS } from '../../src/shared/workbench/external'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function fixture() {
  const calls: ResidentMcpCall[] = [], terminated: string[] = []
  const releases = new Map<string | number, () => void>()
  const handler: ResidentMcpHandler = {
    async initialize(client) { return { sessionId: `session-${client.name}-${calls.length}-${Math.random()}`, instructions: '测试实例' } },
    terminate(sessionId) { terminated.push(sessionId) },
    async request(_sessionId, call) {
      calls.push(call)
      if (call.method === 'tools/call' && call.params.name === 'slow') await new Promise<void>(resolve => { releases.set(call.requestId, resolve) })
      return call.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } : { content: [{ type: 'text', text: 'ok' }] }
    },
  }
  const server = new ResidentMcpServer(handler)
  cleanups.push(() => server.stop())
  return { server, calls, terminated, release: (id: string) => releases.get(id)?.() }
}
async function connect(port: number) {
  const client = new Client({ name: 'resident-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))
  await client.connect(transport)
  cleanups.push(() => client.close())
  return { client, transport }
}
const post = (port: number, headers: Record<string, string>, body: unknown = { jsonrpc: '2.0', id: 1, method: 'ping' }) =>
  fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })

it('listens on the configured loopback port, reports an occupied port without falling back, and stops cleanly', async () => {
  const { server } = fixture()
  const started = await server.start(0)
  if (started.state !== 'running') throw new Error(JSON.stringify(started))
  const { client } = await connect(started.port)
  expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['echo'])

  const blocker: Server = createServer()
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise(resolve => blocker.close(resolve)))
  const busy = (blocker.address() as { port: number }).port
  const occupied = await server.start(busy)
  expect(occupied).toMatchObject({ state: 'port-in-use', port: busy })
  expect(occupied.state !== 'running' && occupied.message).toContain(`端口 ${busy} 已被其他程序占用`)
  expect(server.listeningPort).toBeUndefined()
  await expect(client.listTools()).rejects.toThrow()

  const again = await server.start(started.port)
  expect(again).toEqual({ state: 'running', port: started.port })
  await server.stop()
  await expect(fetch(`http://127.0.0.1:${started.port}/mcp`)).rejects.toThrow()
})

it('initializes without Bearer and keeps loopback Host/Origin and transport termination boundaries', async () => {
  const { server, terminated } = fixture()
  const started = await server.start(0)
  if (started.state !== 'running') throw new Error('not running')
  const port = started.port
  expect((await post(port, { Origin: 'http://preview.invalid' })).status).toBe(403)
  expect((await post(port, {})).status).toBe(400)
  const rebound = await new Promise<number>((resolve, reject) => {
    const sent = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { Host: `evil.invalid:${port}`,  } },
      reply => { reply.resume(); resolve(reply.statusCode ?? 0) })
    sent.on('error', reject); sent.end()
  })
  expect(rebound).toBe(404)
  const { client, transport } = await connect(port)
  await client.listTools()
  const sessionId = transport.sessionId!
  await transport.terminateSession()
  expect(terminated).toEqual([sessionId])

  const live = await connect(port)
  expect((await live.client.listTools()).tools).toHaveLength(1)

})

it('returns an initialize refusal to the client with its reason', async () => {
  const server = new ResidentMcpServer({ initialize: async () => { throw new McpProtocolError(-32000, '果铃还没有打开任何工作空间。') },
    terminate: () => undefined, request: async () => ({}) })
  cleanups.push(() => server.stop())
  const started = await server.start(0)
  if (started.state !== 'running') throw new Error('not running')
  const reply = await post(started.port, {  }, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'early', version: '1' } } })
  expect(reply.status).toBe(200)
  expect(await reply.json()).toMatchObject({ error: { code: -32000, message: '果铃还没有打开任何工作空间。' } })
})

it('reports whether each reply reached the client, including aborted requests and cancellations', async () => {
  const f = fixture()
  const started = await f.server.start(0)
  if (started.state !== 'running') throw new Error('not running')
  const { client, transport } = await connect(started.port)
  await client.callTool({ name: 'echo', arguments: {} })
  expect(await f.calls.at(-1)!.delivery).toBe(true)

  const headers = { 'MCP-Session-Id': transport.sessionId!, 'MCP-Protocol-Version': transport.protocolVersion! }
  const slow = (id: string, signal?: AbortSignal) => {
    const reply = fetch(`http://127.0.0.1:${started.port}/mcp`, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'slow', arguments: {} } }) })
    void reply.catch(() => undefined)
    return reply
  }
  const cancelled = slow('slow-1')
  await expect.poll(() => f.calls.some(call => call.requestId === 'slow-1')).toBe(true)
  expect((await post(started.port, headers, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'slow-1' } })).status).toBe(202)
  expect(await f.calls.find(call => call.requestId === 'slow-1')!.delivery).toBe(false)
  f.release('slow-1')
  expect((await cancelled).status).toBe(200)

  const controller = new AbortController()
  slow('slow-2', controller.signal)
  await expect.poll(() => f.calls.some(call => call.requestId === 'slow-2')).toBe(true)
  controller.abort()
  expect(await f.calls.find(call => call.requestId === 'slow-2')!.delivery).toBe(false)
  f.release('slow-2')
})

it('defaults off, preserves legacy preferences and persists only explicit tokenless enablement', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-resident-settings-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const store = new ResidentMcpSettingsStore({ directory })
  expect(await store.read()).toEqual(DEFAULT_EXTERNAL_MCP_SETTINGS)
  expect(DEFAULT_EXTERNAL_MCP_SETTINGS).toMatchObject({ enabled: false, port: 45123, permission: 'workspace', closeAction: 'ask' })
  await writeFile(path.join(directory, 'settings.json'), JSON.stringify({ enabled: true, port: 46001, permission: 'full', closeAction: 'tray' }))
  expect(await store.read()).toMatchObject({ enabled: false, port: 46001, permission: 'full', closeAction: 'tray' })
  await store.update({ port: 46002 })
  expect(await new ResidentMcpSettingsStore({ directory }).read()).toMatchObject({ enabled: false, port: 46002, permission: 'full' })
  await store.update({ enabled: true })
  expect(await new ResidentMcpSettingsStore({ directory }).read()).toMatchObject({ enabled: true, port: 46002, closeAction: 'tray' })
  expect(JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'))).toMatchObject({ tokenlessEnabled: true })
  await expect(store.update({ port: 80 })).rejects.toThrow()
  await expect(readFile(path.join(directory, 'token.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
})
