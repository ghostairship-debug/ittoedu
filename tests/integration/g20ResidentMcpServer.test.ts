// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { request as httpRequest } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ResidentMcpServer, type ResidentMcpCall, type ResidentMcpHandler } from '../../src/main/workbench/external/ResidentMcpServer'
import { ResidentMcpSettingsStore } from '../../src/main/workbench/external/ResidentMcpSettings'
import { DEFAULT_EXTERNAL_MCP_SETTINGS } from '../../src/shared/workbench/external'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const TOKEN = 'a'.repeat(43), NEXT = 'b'.repeat(43)

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
async function connect(port: number, token = TOKEN) {
  const client = new Client({ name: 'resident-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  cleanups.push(() => client.close())
  return { client, transport }
}
const post = (port: number, headers: Record<string, string>, body: unknown = { jsonrpc: '2.0', id: 1, method: 'ping' }) =>
  fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })

it('listens on the configured loopback port, reports an occupied port without falling back, and stops cleanly', async () => {
  const { server } = fixture()
  const started = await server.start(0, TOKEN)
  if (started.state !== 'running') throw new Error(JSON.stringify(started))
  const { client } = await connect(started.port)
  expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['echo'])

  const blocker: Server = createServer()
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise(resolve => blocker.close(resolve)))
  const busy = (blocker.address() as { port: number }).port
  const occupied = await server.start(busy, TOKEN)
  expect(occupied).toMatchObject({ state: 'port-in-use', port: busy })
  expect(occupied.state !== 'running' && occupied.message).toContain(`端口 ${busy} 已被其他程序占用`)
  expect(server.listeningPort).toBeUndefined()
  await expect(client.listTools()).rejects.toThrow()

  const again = await server.start(started.port, TOKEN)
  expect(again).toEqual({ state: 'running', port: started.port })
  await server.stop()
  await expect(fetch(`http://127.0.0.1:${started.port}/mcp`)).rejects.toThrow()
})

it('keeps the local security boundary and drops every session when the token is regenerated', async () => {
  const { server, terminated } = fixture()
  const started = await server.start(0, TOKEN)
  if (started.state !== 'running') throw new Error('not running')
  const port = started.port
  expect((await post(port, { Authorization: `Bearer ${TOKEN}`, Origin: 'http://preview.invalid' })).status).toBe(403)
  expect((await post(port, { Authorization: 'Bearer wrong' })).status).toBe(401)
  expect((await post(port, {})).status).toBe(401)
  const rebound = await new Promise<number>((resolve, reject) => {
    const sent = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { Host: `evil.invalid:${port}`, Authorization: `Bearer ${TOKEN}` } },
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
  server.replaceToken(NEXT)
  await expect(live.client.listTools()).rejects.toThrow()
  expect((await post(port, { Authorization: `Bearer ${TOKEN}` })).status).toBe(401)
  const renewed = await connect(port, NEXT)
  expect((await renewed.client.listTools()).tools).toHaveLength(1)
})

it('reports whether each reply reached the client, including aborted requests and cancellations', async () => {
  const f = fixture()
  const started = await f.server.start(0, TOKEN)
  if (started.state !== 'running') throw new Error('not running')
  const { client, transport } = await connect(started.port)
  await client.callTool({ name: 'echo', arguments: {} })
  expect(await f.calls.at(-1)!.delivery).toBe(true)

  const headers = { Authorization: `Bearer ${TOKEN}`, 'MCP-Session-Id': transport.sessionId!, 'MCP-Protocol-Version': transport.protocolVersion! }
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

it('stores settings with defaults and keeps the long-lived token only as OS-store ciphertext', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-resident-settings-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  let broken = false
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => new TextEncoder().encode(`sealed:${[...plaintext].reverse().join('')}`),
    decryptString: (ciphertext: Uint8Array) => {
      if (broken) throw new Error('key changed')
      return [...new TextDecoder().decode(ciphertext).slice('sealed:'.length)].reverse().join('')
    },
  }
  const store = new ResidentMcpSettingsStore({ directory, encryption })
  expect(await store.read()).toEqual(DEFAULT_EXTERNAL_MCP_SETTINGS)
  expect(DEFAULT_EXTERNAL_MCP_SETTINGS).toMatchObject({ enabled: true, port: 45123, permission: 'workspace', closeAction: 'ask' })
  expect(await store.update({ port: 46001, closeAction: 'tray' })).toMatchObject({ port: 46001, closeAction: 'tray', enabled: true })
  expect(await new ResidentMcpSettingsStore({ directory, encryption }).read()).toMatchObject({ port: 46001, closeAction: 'tray' })
  await expect(store.update({ port: 80 })).rejects.toThrow()

  const token = await store.token()
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(await new ResidentMcpSettingsStore({ directory, encryption }).token()).toBe(token)
  expect((await readFile(path.join(directory, 'token.bin'))).toString()).not.toContain(token)
  const regenerated = await store.regenerateToken()
  expect(regenerated).not.toBe(token)
  expect(await store.token()).toBe(regenerated)
  broken = true
  const replaced = await store.token()
  expect(replaced).not.toBe(regenerated)
})
