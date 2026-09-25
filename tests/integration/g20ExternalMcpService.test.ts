// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExternalMcpService } from '../../src/main/workbench/external/ExternalMcpService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ExternalConnection } from '../../src/shared/workbench/external'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused-fixture' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
const reference = (snapshot: DocumentSnapshot) => ({ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
  writable: [{ kind: 'markdown-range' as const, from: 0, to: 3 }] })
async function fixture(provider: ModelProvider = { async *stream() { throw new Error('No model request expected') } }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-external-service-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const runs = new ExecutionRunStore(path.join(directory, 'runs'))
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, runs, events, provider })
  const attachments = new AttachmentService({ directory: path.join(directory, 'attachments') })
  let time = Date.now()
  const service = new ExternalMcpService({ conversations, registry: host.registry, gateway: host.tools, engine, attachments,
    appendEvent: event => events.append(event), now: () => time })
  cleanups.push(() => service.close())
  await conversations.registerWorkspace({ workspaceId: 'space', rootPath: directory, managed: true, authorization: 'managed' })
  await conversations.registerWorkspace({ workspaceId: 'other-space', rootPath: directory, managed: true, authorization: 'managed' })
  const conversation = await conversations.createConversation({ workspaceId: 'space', title: 'MCP 交接' })
  const owner = { workspaceId: 'space', conversationId: conversation.conversationId }
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, '未保存.md')
  return { directory, host, conversations, events, runs, engine, attachments, service, conversation, owner, document, advance: (ms: number) => { time += ms } }
}
async function connect(connection: ExternalConnection) {
  const client = new Client({ name: 'guoling-official-sdk-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint), { requestInit: { headers: { Authorization: `Bearer ${connection.bearer}` } } })
  await client.connect(transport)
  cleanups.push(() => client.close())
  const read = await client.readResource({ uri: 'guoling://task/context' })
  if (!('text' in read.contents[0])) throw new Error('Task context must be text')
  const context = JSON.parse(read.contents[0].text)
  return { client, transport, context }
}

it('uses the official SDK transport for discovery, resources, canonical edits, retry and session reconnection', async () => {
  const f = await fixture()
  const granted = await f.service.grant({ ...f.owner, expectedRevision: f.conversation.revision, instruction: '修改 AAA', documents: [reference(f.document)] })
  const { client, transport, context } = await connect(granted.connection)
  const tools = await client.listTools()
  const domain = (await f.host.tools.describe()).find(tool => tool.name === 'text.replace')!
  expect(tools.tools.find(tool => tool.name === 'text.replace')!.inputSchema.properties!.arguments).toEqual(domain.schema)
  expect((await client.listResources()).resources[0].uri).toBe('guoling://task/context')
  const args = { ticket: context.operationTickets[0], arguments: { target: context.documents[0].writable[0].target, content: '你好😀' } }
  const applied = await client.callTool({ name: 'text.replace', arguments: args })
  expect(applied.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
  const lookedUp = await client.callTool({ name: 'operation.lookup', arguments: { ...args, name: 'text.replace' } })
  const replay = await client.callTool({ name: 'text.replace', arguments: args })
  const receipt = ((applied.structuredContent as Record<string, unknown>).result as Extract<ToolResult, { kind: 'document-operation' }>).result
  expect(lookedUp.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: receipt } })
  expect(replay.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: receipt } })
  const snapshot = f.host.registry.get(f.document.documentId).read()
  expect(snapshot.model).toMatchObject({ source: '你好😀 BBB' }); expect(snapshot.undoDepth).toBe(1)
  await transport.terminateSession()
  const reconnected = await connect(granted.connection)
  expect(reconnected.context.documents[0].documentId).toBe(f.document.documentId)
  expect(f.host.registry.list()).toHaveLength(1)
  expect(JSON.stringify(await f.service.list(f.owner))).not.toContain(granted.connection.bearer)
  expect(granted.config.opencode).toContain('"oauth": false')
  expect(granted.config.codex).toContain('bearer_token_env_var')
  expect(JSON.stringify(granted.conversation)).not.toContain(granted.connection.bearer)
  const initialize = await fetch(granted.connection.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${granted.connection.bearer}`,
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'future-version', method: 'initialize', params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'future', version: '1' } } }) })
  expect((await initialize.json()).result.protocolVersion).toBe('2025-11-25')
  const readOnly = await f.service.grant({ ...f.owner, expectedRevision: granted.conversation.revision, instruction: '只读检查',
    documents: [{ ...reference(snapshot), writable: [] }] })
  const reader = await connect(readOnly.connection)
  expect(f.service.writableConnectionsForDocument(f.document.documentId)).toEqual([{ ...f.owner, connectionId: granted.connection.connectionId }])
  await f.service.stopForDocument(f.document.documentId)
  expect(f.service.writableConnectionsForDocument(f.document.documentId)).toEqual([])
  await expect(reconnected.client.listTools()).rejects.toThrow()
  expect((await reader.client.listResources()).resources).toHaveLength(1)
})

it('settles a real built-in run, transfers only receipts and frozen attachment resources, then deletes through the revoke barrier', async () => {
  let entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  let requests = 0
  const provider: ModelProvider = { async *stream(request, options) {
    if (++requests === 1) {
      const target = JSON.parse(String(request.messages[1].content).split('：')[1])[0].writable[0].target
      const call = { id: 'first', name: 'text.replace', argumentsText: JSON.stringify({ target, content: 'NEW' }) }
      yield { type: 'response.completed', requestId: request.requestId, responseId: 'fixture-response', sequence: 0, nativeResponse: {}, actualModel: 'fixture', finishReason: 'tool_calls',
        toolCalls: [call], assistant: { role: 'assistant', content: '', tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } }] } }
    } else {
      entered()
      const signal = options?.signal
      if (!signal) throw new Error('ExecutionEngine must pass cancellation')
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) })
      signal.throwIfAborted()
    }
  } }
  const f = await fixture(provider)
  const attachment = await f.attachments.receiveBytes({ name: '材料.md', bytes: new TextEncoder().encode('必要附件😀'), source: { kind: 'paste' } })
  const run = await f.engine.start({ conversationId: f.owner.conversationId, taskId: 'builtin-task', instruction: '先改后补充', selection,
    documents: [{ documentId: f.document.documentId, writable: [{ kind: 'markdown-range', from: 4, to: 7 }] }] }, undefined, async record => {
    await f.conversations.updateConversation({ ...f.owner, expectedRevision: f.conversation.revision,
      patch: { inputAttachments: [{ attachmentId: attachment.id, representationId: 'original-text' }], runIndex: { ...f.conversation.runIndex, builtinRunIds: [record.runId] } } })
  })
  await waiting
  const current = (await f.conversations.readConversation(f.owner))!
  const before = f.host.registry.get(f.document.documentId).read()
  expect(before.model).toMatchObject({ source: 'AAA NEW' })
  const granted = await f.service.grant({ ...f.owner, expectedRevision: current.revision, instruction: '接着补充', sourceRunId: run.runId,
    remainingWork: '只补充开头，保留 NEW', documents: [reference(before)] })
  expect((await f.engine.read(run.runId))!.status).toBe('stopped')
  expect(granted.handoff).toMatchObject({ originalGoal: '先改后补充', previousRun: run.runId, remainingWork: '只补充开头，保留 NEW' })
  expect(granted.handoff.committedFacts).toHaveLength(1)
  expect(granted.handoff.committedFacts[0]).toMatchObject({ status: 'applied', revision: before.revision })
  const { client, context } = await connect(granted.connection)
  expect(context.attachments[0]).toMatchObject({ provenance: { complete: true, downsampled: false }, gaps: [] })
  const resource = await client.readResource({ uri: context.attachments[0].uri })
  expect(resource.contents[0]).toMatchObject({ text: '必要附件😀' })
  await expect(client.readResource({ uri: 'guoling://attachment/not-authorized' })).rejects.toThrow()
  await expect(f.service.list({ ...f.owner, workspaceId: 'other-space' })).rejects.toThrow()
  await f.conversations.deleteConversation({ ...f.owner, expectedRevision: granted.conversation.revision,
    ports: { stopBuiltinRuns: async ({ runIds }) => { await Promise.all(runIds.map(id => f.engine.stop(id))) }, revokeExternalPorts: input => f.service.revokeConversation(input) } })
  await expect(client.callTool({ name: 'text.replace', arguments: { ticket: context.operationTickets[0], arguments: { target: context.documents[0].writable[0].target, content: '迟到' } } })).rejects.toThrow()
  expect(f.host.registry.get(f.document.documentId).read().model).toMatchObject({ source: 'AAA NEW' })
  expect((await f.events.snapshot(f.owner.conversationId)).items.filter(item => item.source === 'external-mcp').some(item => ['usage', 'reasoning', 'run.end'].includes(item.type))).toBe(false)
})

it('fails closed on registration races, expiry and changed selections without renewing frozen authority', async () => {
  const f = await fixture()
  const input = { ...f.owner, expectedRevision: f.conversation.revision, instruction: '修改', documents: [reference(f.document)] }
  const write = vi.spyOn(f.conversations, 'updateConversation').mockRejectedValueOnce(new Error('registration lost'))
  await expect(f.service.grant(input)).rejects.toThrow('registration lost')
  write.mockRestore()
  const failed = (await f.service.list(f.owner))[0]
  expect(failed.status).toBe('revoked')
  await expect(f.host.tools.issueTarget(failed.runId, f.document.documentId, { kind: 'document' })).rejects.toThrow('任务已停止')
  const granted = await f.service.grant({ ...input, lifetimeMs: 1000 })
  const { client } = await connect(granted.connection)
  f.advance(1001)
  await expect(client.listTools()).rejects.toThrow()
  expect((await f.service.list(f.owner)).at(-1)!.status).toBe('expired')
  await expect(f.host.tools.issueTarget(granted.connection.runId, f.document.documentId, { kind: 'document' })).rejects.toThrow('任务已停止')
  await f.host.internalAPI.dispatch({ documentId: f.document.documentId, epoch: f.document.epoch, operationId: 'human', baseRevision: f.document.revision,
    actor: 'human', mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 0, text: 'H ' } } })
  await expect(f.service.grant({ ...input, expectedRevision: granted.conversation.revision })).rejects.toThrow('所选文档或范围已改变')
  expect(f.host.registry.get(f.document.documentId).read().model).toMatchObject({ source: 'H AAA BBB' })
})
