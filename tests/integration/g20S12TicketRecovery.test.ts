// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { McpDocumentServer, type ExternalConnection } from '../../src/main/workbench/external/McpDocumentServer'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'

const roots: string[] = []
const servers: McpDocumentServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe S12 fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function connect(connection: ExternalConnection) {
  let sequence = 0
  let session = ''
  const request = async (method: string, params: unknown = {}, signal?: AbortSignal) => {
    const response = await fetch(connection.endpoint, { method: 'POST', signal, headers: {
      Authorization: `Bearer ${connection.bearer}`, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
      ...(session ? { 'MCP-Session-Id': session } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) })
    session = response.headers.get('mcp-session-id') ?? session
    return { status: response.status, data: response.status === 200 ? await response.json() as any : null }
  }
  expect((await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 's12-lost-ack-fixture', version: '1' } })).status).toBe(200)
  const acknowledged = await fetch(connection.endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${connection.bearer}`, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', 'MCP-Session-Id': session,
  }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  expect(acknowledged.status).toBe(202)
  const context = JSON.parse((await request('resources/read', { uri: 'guoling://task/context' })).data.result.contents[0].text) as {
    documents: { target: string; writable: { target: string }[] }[]; operationTickets: string[]
  }
  return { request, context }
}

it('S12-T03 recovers a lost MCP ACK by ticket, refuses altered replay and denies late writes after revocation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s12-ticket-recovery-'))
  roots.push(root)
  const documentDirectory = path.join(root, 'documents')
  const host = new DocumentHostService(documentDirectory)
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  let reachedTerminal!: () => void
  let releaseTerminal!: () => void
  let loggedTerminal!: () => void
  const terminalReached = new Promise<void>(resolve => { reachedTerminal = resolve })
  const terminalBarrier = new Promise<void>(resolve => { releaseTerminal = resolve })
  const terminalLogged = new Promise<void>(resolve => { loggedTerminal = resolve })
  let held = false
  let terminalStatus: string | undefined
  const server = new McpDocumentServer({ registry: host.registry, gateway: host.tools, appendEvent: async event => {
    if (!held && event.type === 'tool' && (event.data.status === 'completed' || event.data.status === 'failed')) {
      held = true; terminalStatus = event.data.status; reachedTerminal(); await terminalBarrier
    }
    const stored = await events.append(event)
    if (held && event.type === 'tool' && event.data.status === terminalStatus) loggedTerminal()
    return stored
  } })
  servers.push(server)
  const created = await host.internalAPI.create({ kind: 'markdown', source: 'old left | stable right', resources: { assets: {}, components: {} } }, 'unsaved.md')
  const journal = createDocumentJournal({ directory: documentDirectory })
  const connection = await server.grant({ workspaceId: 'space', conversationId: 'conversation', taskId: 'task', instruction: '只修改左侧',
    documents: [{ documentId: created.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 8 }] }] })
  const caller = await connect(connection)
  const ticket = caller.context.operationTickets[0]!
  const arguments_ = { target: caller.context.documents[0]!.writable[0]!.target, content: 'new left' }
  const controller = new AbortController()
  const lostReply = caller.request('tools/call', { name: 'text.replace', arguments: { ticket, arguments: arguments_ } }, controller.signal)
  try {
    await terminalReached
    expect(terminalStatus).toBe('completed')
    const committed = await host.internalAPI.read(created.documentId)
    expect(committed).toMatchObject({ revision: 1, dirty: true, undoDepth: 1,
      model: { kind: 'markdown', source: 'new left | stable right' } })
    expect((await journal.recover(created.documentId))?.operations).toHaveLength(1)
    controller.abort()
    await expect(lostReply).rejects.toMatchObject({ name: 'AbortError' })
  } finally { releaseTerminal() }
  await terminalLogged

  const lookup = await caller.request('tools/call', { name: 'operation.lookup', arguments: { ticket, name: 'text.replace', arguments: arguments_ } })
  expect(lookup.status).toBe(200)
  const receipt = lookup.data.result.structuredContent.result
  expect(receipt).toMatchObject({ kind: 'document-operation', result: {
    status: 'applied', documentId: created.documentId, beforeRevision: 0, revision: 1,
  } })
  const replay = await caller.request('tools/call', { name: 'text.replace', arguments: { ticket, arguments: arguments_ } })
  expect(replay.data.result.structuredContent.result).toEqual(receipt)
  const altered = await caller.request('tools/call', { name: 'text.replace', arguments: { ticket,
    arguments: { ...arguments_, content: 'different intent' } } })
  expect(altered.data.result.structuredContent.result).toMatchObject({ kind: 'error', code: 'operation-payload-mismatch' })
  const beforeRevoke = await journal.recover(created.documentId)
  expect(beforeRevoke).toMatchObject({ sequence: 1, revision: 1, savedRevision: null })
  expect(beforeRevoke?.operations).toHaveLength(1)
  expect(beforeRevoke?.past).toHaveLength(1)

  await server.revoke(connection.connectionId)
  const afterRevoke = await journal.recover(created.documentId)
  expect(afterRevoke?.revision).toBe(1)
  expect(afterRevoke?.operations).toHaveLength(1)
  const late = await caller.request('tools/call', { name: 'text.replace', arguments: {
    ticket: caller.context.operationTickets[1], arguments: { ...arguments_, content: 'late write' },
  } })
  expect(late.status).toBe(401)
  const afterLate = await journal.recover(created.documentId)
  expect(afterLate?.sequence).toBe(afterRevoke?.sequence)
  expect(afterLate?.operations).toEqual(afterRevoke?.operations)
  expect(afterLate?.past).toEqual(afterRevoke?.past)
  expect((await host.internalAPI.read(created.documentId)).model).toMatchObject({ source: 'new left | stable right' })
})
