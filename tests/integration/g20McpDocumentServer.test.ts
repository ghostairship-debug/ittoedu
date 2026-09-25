// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { McpDocumentServer, type ExternalConnection } from '../../src/main/workbench/external/McpDocumentServer'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-mcp-')); cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const server = new McpDocumentServer({ registry: host.registry, gateway: host.tools, appendEvent: event => events.append(event) })
  cleanups.push(() => server.close())
  const a = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, 'unsaved.md')
  return { directory, host, events, server, a }
}
async function client(connection: ExternalConnection) {
  let sequence = 0, session = ''
  const request = async (method: string, params: unknown = {}, extra: Record<string, string> = {}) => {
    const response = await fetch(connection.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${connection.bearer}`, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', ...(session ? { 'MCP-Session-Id': session } : {}), ...extra },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) })
    session = response.headers.get('mcp-session-id') ?? session
    return { response, data: response.status === 200 ? await response.json() as any : null }
  }
  expect((await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'deterministic-mcp-client', version: '1' } })).data.result.serverInfo.name).toBe('guoling')
  const initialized = await fetch(connection.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${connection.bearer}`, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', 'MCP-Session-Id': session },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  expect(initialized.status).toBe(202)
  const context = JSON.parse((await request('resources/read', { uri: 'guoling://task/context' })).data.result.contents[0].text)
  return { request, context }
}

it('serves two HTTP bridges over the same unsaved Session with canonical schemas, disjoint edits and one History', async () => {
  const { server, host, a, events } = await fixture()
  const grants = await Promise.all([0, 4].map(from => server.grant({ workspaceId: 'space', conversationId: 'conversation', taskId: `task-${from}`,
    instruction: '修改指定局部', documents: [{ documentId: a.documentId, writable: [{ kind: 'markdown-range', from, to: from + 3 }] }] })))
  expect(grants[0].endpoint).toBe(grants[1].endpoint)
  const [left, right] = await Promise.all(grants.map(client))
  const catalog = (await left.request('tools/list')).data.result.tools
  const canonical = (await host.tools.describe()).find(tool => tool.name === 'text.replace')!
  expect(catalog.find((tool: any) => tool.name === canonical.name).inputSchema.properties.arguments).toEqual(canonical.schema)
  const results = await Promise.all([left, right].map((caller, index) => caller.request('tools/call', { name: 'text.replace', arguments: {
    ticket: caller.context.operationTickets[0], arguments: { target: caller.context.documents[0].writable[0].target, content: index === 0 ? '中文😀' : 'END' },
  } })))
  expect(results.map(result => result.data.result.structuredContent.result.result.status)).toEqual(['applied', 'applied'])
  const snapshot = await host.internalAPI.read(a.documentId)
  expect(snapshot.model).toMatchObject({ source: '中文😀 END' }); expect(snapshot.undoDepth).toBe(2)
  expect(host.registry.list()).toHaveLength(1)
  const reconnect = await client(grants[0])
  expect(reconnect.context.documents[0].documentId).toBe(a.documentId)
  const timeline = await events.snapshot('conversation')
  expect(timeline.items.every(item => item.source === 'external-mcp')).toBe(true)
  expect(timeline.items.some(item => item.type === 'run.end' || item.type === 'reasoning' || item.type === 'usage')).toBe(false)
})

it('queries a lost ACK by host ticket, rejects altered/revoked identities and gives preview origins no access', async () => {
  const { server, host, a } = await fixture()
  const grant = await server.grant({ workspaceId: 'space', conversationId: 'conversation', taskId: 'external-task', instruction: '修改',
    documents: [{ documentId: a.documentId, writable: [{ kind: 'document' }] }] })
  const caller = await client(grant)
  const read = await caller.request('tools/call', { name: 'listChildren', arguments: { arguments: { target: caller.context.documents[0].target } } })
  const children = read.data.result.structuredContent.result.data
  // Read supplies a real range handle; it is not an arbitrary address accepted from the client.
  const target = children[0]?.target
  expect(typeof target).toBe('string')
  const ticket = caller.context.operationTickets[0], args = { target, content: '改稿' }
  const first = await caller.request('tools/call', { name: 'text.replace', arguments: { ticket, arguments: args } })
  expect(first.data.result.structuredContent.result.result.status).toBe('applied')
  const lookup = await caller.request('tools/call', { name: 'operation.lookup', arguments: { ticket, name: 'text.replace', arguments: args } })
  const replay = await caller.request('tools/call', { name: 'text.replace', arguments: { ticket, arguments: args } })
  expect(lookup.data.result.structuredContent.result).toMatchObject({ kind: 'document-operation', result: { operationId: first.data.result.structuredContent.result.result.operationId } })
  expect(replay.data.result.structuredContent.result.result.status).toBe('applied')
  expect((await host.internalAPI.read(a.documentId)).undoDepth).toBe(1)
  const changed = await caller.request('tools/call', { name: 'text.replace', arguments: { ticket, arguments: { ...args, content: 'evil' } } })
  expect(changed.data.result.structuredContent.result).toMatchObject({ kind: 'error', code: 'operation-payload-mismatch' })
  expect((await caller.request('tools/list', {}, { Origin: 'http://preview.invalid' })).response.status).toBe(403)
  expect((await caller.request('tools/list', {}, { Authorization: 'Bearer wrong' })).response.status).toBe(401)
  await server.revoke(grant.connectionId)
  expect((await caller.request('tools/call', { name: 'text.replace', arguments: { ticket: caller.context.operationTickets[1], arguments: args } })).response.status).toBe(401)
  expect((await host.internalAPI.read(a.documentId)).undoDepth).toBe(1)
})
