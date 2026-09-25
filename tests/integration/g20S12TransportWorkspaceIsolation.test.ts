// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExternalMcpService } from '../../src/main/workbench/external/ExternalMcpService'
import type { ExternalConnection } from '../../src/shared/workbench/external'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ModelProvider } from '../../src/shared/workbench/modelProvider'

const cleanups: (() => Promise<unknown>)[] = []
const output = path.resolve('output/g20/s12-transport-isolation')
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

const reference = (snapshot: DocumentSnapshot) => ({ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
  writable: [{ kind: 'markdown-range' as const, from: 0, to: 3 }] })

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-s12-transport-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const provider: ModelProvider = { async *stream() { throw new Error('No paid or fixture model request expected') } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events })
  const service = new ExternalMcpService({ conversations, registry: host.registry, gateway: host.tools, engine,
    appendEvent: event => events.append(event) })
  cleanups.push(() => service.close())
  const ownerA = { workspaceId: 'workspace-a', conversationId: '' }, ownerB = { workspaceId: 'workspace-b', conversationId: '' }
  for (const owner of [ownerA, ownerB]) {
    const root = path.join(directory, owner.workspaceId)
    mkdirSync(root)
    await conversations.registerWorkspace({ workspaceId: owner.workspaceId, rootPath: root, managed: true, authorization: 'managed' })
    owner.conversationId = (await conversations.createConversation({ workspaceId: owner.workspaceId, title: owner.workspaceId })).conversationId
  }
  const documentA = await host.internalAPI.create({ kind: 'markdown', source: 'AAA KEEP', resources: { assets: {}, components: {} } }, 'A.md')
  const documentB = await host.internalAPI.create({ kind: 'markdown', source: 'BBB KEEP', resources: { assets: {}, components: {} } }, 'B.md')
  const conversationA = (await conversations.readConversation(ownerA))!, conversationB = (await conversations.readConversation(ownerB))!
  const grantA = await service.grant({ ...ownerA, expectedRevision: conversationA.revision, instruction: '只修改 A', documents: [reference(documentA)] })
  const grantB = await service.grant({ ...ownerB, expectedRevision: conversationB.revision, instruction: '只修改 B', documents: [reference(documentB)] })
  return { host, service, ownerA, ownerB, documentA, documentB, grantA, grantB }
}

async function connect(connection: ExternalConnection) {
  const client = new Client({ name: 's12-transport-integration-client', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint), { requestInit: { headers: { Authorization: `Bearer ${connection.bearer}` } } })
  await client.connect(transport)
  cleanups.push(() => client.close())
  const resource = await client.readResource({ uri: 'guoling://task/context' })
  if (!('text' in resource.contents[0])) throw new Error('Task context is not text')
  return { client, context: JSON.parse(resource.contents[0].text) as { documents: { documentId: string; writable: { target: string }[] }[]; operationTickets: string[] } }
}

it('S12-T06 confines two workspaces to their own grant, document target, ticket, and loopback transport', async () => {
  const f = await fixture()
  expect(f.grantA.connection.endpoint).toBe(f.grantB.connection.endpoint)
  expect(f.grantA.connection.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  const a = await connect(f.grantA.connection), b = await connect(f.grantB.connection)
  expect(a.context.documents.map(document => document.documentId)).toEqual([f.documentA.documentId])
  expect(b.context.documents.map(document => document.documentId)).toEqual([f.documentB.documentId])
  expect(a.context.operationTickets).not.toContain(b.context.operationTickets[0])
  await expect(f.service.list({ ...f.ownerA, workspaceId: f.ownerB.workspaceId })).rejects.toThrow()
  await expect(f.service.revoke({ ...f.ownerA, workspaceId: f.ownerB.workspaceId, connectionId: f.grantA.connection.connectionId })).rejects.toThrow()
  const cross = await a.client.callTool({ name: 'text.replace', arguments: { ticket: a.context.operationTickets[0],
    arguments: { target: b.context.documents[0]!.writable[0]!.target, content: 'CROSS' } } })
  expect(cross.structuredContent).toMatchObject({ result: { kind: 'error' } })
  await expect(a.client.callTool({ name: 'text.replace', arguments: { ticket: b.context.operationTickets[0],
    arguments: { target: a.context.documents[0]!.writable[0]!.target, content: 'CROSS' } } })).rejects.toThrow()
  expect(f.host.registry.get(f.documentA.documentId).read().model).toMatchObject({ source: 'AAA KEEP' })
  expect(f.host.registry.get(f.documentB.documentId).read().model).toMatchObject({ source: 'BBB KEEP' })
  const appliedB = await b.client.callTool({ name: 'text.replace', arguments: { ticket: b.context.operationTickets[1],
    arguments: { target: b.context.documents[0]!.writable[0]!.target, content: 'B-OK' } } })
  expect(appliedB.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
  const appliedA = await a.client.callTool({ name: 'text.replace', arguments: { ticket: a.context.operationTickets[1],
    arguments: { target: a.context.documents[0]!.writable[0]!.target, content: 'A-OK' } } })
  expect(appliedA.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
  expect(f.host.registry.get(f.documentA.documentId).read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'A-OK KEEP' } })
  expect(f.host.registry.get(f.documentB.documentId).read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'B-OK KEEP' } })

  const rpc = JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'preview', version: '1' } } })
  const request = (headers: Record<string, string>) => fetch(f.grantA.connection.endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: rpc })
  const unauthenticated = await request({}), wrongBearer = await request({ Authorization: 'Bearer wrong-token' })
  const preview = await request({ Authorization: `Bearer ${f.grantA.connection.bearer}`, Origin: 'http://preview.invalid' })
  const wrongHostStatus = await new Promise<number>((resolve, reject) => {
    const forged = httpRequest(f.grantA.connection.endpoint, { method: 'POST', headers: { Host: 'remote.invalid',
      Authorization: `Bearer ${f.grantA.connection.bearer}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } },
    response => { response.resume(); response.on('end', () => resolve(response.statusCode ?? 0)) })
    forged.on('error', reject); forged.end(rpc)
  })
  expect([unauthenticated.status, wrongBearer.status, preview.status, wrongHostStatus]).toEqual([401, 401, 403, 404])
  expect(f.host.registry.get(f.documentA.documentId).read().revision).toBe(1)
  expect(f.host.registry.get(f.documentB.documentId).read().revision).toBe(1)
  mkdirSync(output, { recursive: true })
  writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ endpointHost: '127.0.0.1', sameServer: true,
    separateContexts: [f.documentA.documentId, f.documentB.documentId], crossTargetRejected: true,
    final: { a: { revision: 1, source: 'A-OK KEEP' }, b: { revision: 1, source: 'B-OK KEEP' } },
    rejectedHttpStatuses: { unauthenticated: unauthenticated.status, wrongBearer: wrongBearer.status,
      previewOrigin: preview.status, forgedHost: wrongHostStatus },
    limitation: 'Official SDK clients verify current loopback transport and authority. This does not test a real remote network or every external CLI; the product UI separately states cloud clients cannot directly reach the local address.' }, null, 2))
})
