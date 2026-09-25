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
  const headers = () => ({ Authorization: `Bearer ${connection.bearer}`, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
    ...(session ? { 'MCP-Session-Id': session } : {}) })
  const request = async (method: string, params: unknown = {}) => {
    const response = await fetch(connection.endpoint, { method: 'POST', headers: headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) })
    session = response.headers.get('mcp-session-id') ?? session
    return { status: response.status, data: response.status === 200 ? await response.json() as any : null }
  }
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 's12-bridge-fixture', version: '1' } })
  expect(initialized.status).toBe(200)
  expect(initialized.data.result.serverInfo.name).toBe('guoling')
  const acknowledged = await fetch(connection.endpoint, { method: 'POST', headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  expect(acknowledged.status).toBe(202)
  const contextReply = await request('resources/read', { uri: 'guoling://task/context' })
  expect(contextReply.status).toBe(200)
  const context = JSON.parse(contextReply.data.result.contents[0].text) as {
    documents: { documentId: string; target: string; writable: { target: string }[] }[]; operationTickets: string[]
  }
  const disconnect = async () => {
    const response = await fetch(connection.endpoint, { method: 'DELETE', headers: headers() })
    expect(response.status).toBe(204)
  }
  return { request, context, disconnect }
}

it('S12-T02 keeps concurrent bridges on one unsaved Session and History through conflict and transport reconnect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s12-multi-bridge-'))
  roots.push(root)
  const documentDirectory = path.join(root, 'documents')
  const host = new DocumentHostService(documentDirectory)
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const server = new McpDocumentServer({ registry: host.registry, gateway: host.tools, appendEvent: event => events.append(event) })
  servers.push(server)
  const created = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, 'unsaved.md')
  const session = host.registry.get(created.documentId)
  expect(created.binding.kind).toBe('untitled')
  expect(created.dirty).toBe(true)

  const [leftConnection, rightConnection] = await Promise.all([0, 4].map(from => server.grant({
    workspaceId: 'space', conversationId: 'conversation', taskId: `task-${from}`, instruction: '分别修改不相交片段',
    documents: [{ documentId: created.documentId, writable: [{ kind: 'markdown-range', from, to: from + 3 }] }],
  })))
  expect(leftConnection.endpoint).toBe(rightConnection.endpoint)
  const [left, right] = await Promise.all([connect(leftConnection), connect(rightConnection)])
  expect(left.context.documents[0]?.documentId).toBe(created.documentId)
  expect(right.context.documents[0]?.documentId).toBe(created.documentId)

  const calls = await Promise.all([left, right].map((bridge, index) => bridge.request('tools/call', {
    name: 'text.replace', arguments: { ticket: bridge.context.operationTickets[0], arguments: {
      target: bridge.context.documents[0]!.writable[0]!.target, content: index === 0 ? 'LEFT' : 'RIGHT',
    } },
  })))
  expect(calls.map(call => call.status)).toEqual([200, 200])
  const receipts = calls.map(call => call.data.result.structuredContent.result.result)
  expect(receipts.map(receipt => receipt.status)).toEqual(['applied', 'applied'])
  expect(receipts.map(receipt => receipt.revision).sort()).toEqual([1, 2])
  expect(new Set(receipts.map(receipt => receipt.operationId)).size).toBe(2)
  const combined = await host.internalAPI.read(created.documentId)
  expect(combined).toMatchObject({ revision: 2, dirty: true, undoDepth: 2, redoDepth: 0,
    binding: { kind: 'untitled' }, model: { kind: 'markdown', source: 'LEFT RIGHT' } })
  expect(host.registry.get(created.documentId)).toBe(session)
  expect(host.registry.list()).toHaveLength(1)

  const journal = createDocumentJournal({ directory: documentDirectory })
  const committed = await journal.recover(created.documentId)
  expect(committed).toMatchObject({ sequence: 2, revision: 2, savedRevision: null })
  expect(committed?.past).toHaveLength(2)
  expect(committed?.operations.map(operation => operation.operationId).sort()).toEqual(receipts.map(receipt => receipt.operationId).sort())
  expect(committed?.past[1]?.before).toEqual(committed?.past[0]?.after)
  expect(committed?.past.map(entry => entry.actor)).toEqual(['external', 'external'])
  expect(new Set(committed?.past.map(entry => entry.runId)).size).toBe(2)

  const stale = await left.request('tools/call', { name: 'text.replace', arguments: {
    ticket: left.context.operationTickets[1], arguments: { target: left.context.documents[0]!.writable[0]!.target, content: 'OVERWRITE' },
  } })
  expect(stale.status).toBe(200)
  expect(stale.data.result.structuredContent.result).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect((await journal.recover(created.documentId))?.sequence).toBe(2)
  expect((await host.internalAPI.read(created.documentId)).model).toMatchObject({ source: 'LEFT RIGHT' })

  await left.disconnect()
  expect((await left.request('ping')).status).toBe(404)
  expect((await right.request('ping')).status).toBe(200)
  const reconnected = await connect(leftConnection)
  const current = await reconnected.request('tools/call', { name: 'read', arguments: {
    arguments: { target: reconnected.context.documents[0]!.target },
  } })
  expect(current.data.result.structuredContent.result).toMatchObject({ kind: 'read' })
  expect(current.data.result.structuredContent.result.data.text).toContain('LEFT RIGHT')
  expect(host.registry.get(created.documentId)).toBe(session)
  expect(host.registry.list()).toHaveLength(1)
  expect(await journal.list()).toEqual([created.documentId])

  const firstUndo = await session.execute({ documentId: created.documentId, epoch: combined.epoch, operationId: 'human-undo-1',
    baseRevision: combined.revision, actor: 'human', mutation: { type: 'undo' } })
  expect(firstUndo.status).toBe('applied')
  expect(session.read().model).toEqual(committed?.past[0]?.after)
  const secondUndo = await session.execute({ documentId: created.documentId, epoch: combined.epoch, operationId: 'human-undo-2',
    baseRevision: session.read().revision, actor: 'human', mutation: { type: 'undo' } })
  expect(secondUndo.status).toBe('applied')
  expect(session.read().model).toMatchObject({ source: 'AAA BBB' })
  for (const operationId of ['human-redo-1', 'human-redo-2']) {
    const redo = await session.execute({ documentId: created.documentId, epoch: combined.epoch, operationId,
      baseRevision: session.read().revision, actor: 'human', mutation: { type: 'redo' } })
    expect(redo.status).toBe('applied')
  }
  expect(session.read()).toMatchObject({ dirty: true, undoDepth: 2, redoDepth: 0, model: { source: 'LEFT RIGHT' } })
})
