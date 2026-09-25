// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { McpDocumentServer } from '../../src/main/workbench/external/McpDocumentServer'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'

it('advertises and enforces distinct read/write tickets, supports native resource templates, and retains revocation guards', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-mcp-rules-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const server = new McpDocumentServer({ registry: host.registry, gateway: host.tools, appendEvent: event => events.append(event) })
  const client = new Client({ name: 'official-sdk-rule-check-not-a-real-cli', version: '1' })
  try {
    const document = await host.internalAPI.create({ kind: 'markdown', source: 'BEFORE KEEP', resources: { assets: {}, components: {} } }, 'protocol-rules.md')
    const grant = await server.grant({ workspaceId: 'space', conversationId: 'conversation', taskId: 'task', instruction: '修改首段',
      documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 6 }] }] })
    const transport = new StreamableHTTPClientTransport(new URL(grant.endpoint), { requestInit: { headers: { Authorization: `Bearer ${grant.bearer}` } } })
    await client.connect(transport)
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([])
    const resource = await client.readResource({ uri: 'guoling://task/context' })
    if (!('text' in resource.contents[0])) throw new Error('Missing task context')
    const context = JSON.parse(resource.contents[0].text)
    const catalog = await client.listTools()
    const writeSchema = catalog.tools.find(tool => tool.name === 'text.replace')!.inputSchema
    expect(writeSchema.properties!.arguments).toEqual((await host.tools.describe()).find(tool => tool.name === 'text.replace')!.schema)
    expect(writeSchema.properties!.ticket).toMatchObject({ description: context.ticketRule })
    expect(context.ticketRule).toContain('包括只读')
    const target = context.documents[0].writable[0].target, [readTicket, writeTicket] = context.operationTickets
    const observed = await client.callTool({ name: 'read', arguments: { ticket: readTicket, arguments: { target } } })
    expect(observed.structuredContent).toMatchObject({ result: { kind: 'read' } })
    const wrong = await client.callTool({ name: 'text.replace', arguments: { ticket: readTicket, arguments: { target, content: 'BAD' } } })
    expect(wrong.structuredContent).toMatchObject({ result: { kind: 'error', code: 'operation-payload-mismatch' } })
    const argumentsValue = { target, content: 'AFTER' }
    const applied = await client.callTool({ name: 'text.replace', arguments: { ticket: writeTicket, arguments: argumentsValue } })
    expect(applied.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
    const envelope = applied.structuredContent
    if (!envelope || typeof envelope !== 'object' || !('result' in envelope)) throw new Error('Missing structured tool result')
    const operation = envelope.result
    if (!operation || typeof operation !== 'object' || !('kind' in operation) || operation.kind !== 'document-operation' || !('result' in operation))
      throw new Error('Expected a structured document operation receipt')
    const lookup = await client.callTool({ name: 'operation.lookup', arguments: { ticket: writeTicket, name: 'text.replace', arguments: argumentsValue } })
    expect(lookup.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: operation.result } })
    expect(host.registry.get(document.documentId).read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'AFTER KEEP' } })
    const timeline = await events.snapshot('conversation')
    const writtenTool = timeline.items.find(item => item.itemId === writeTicket)!
    expect(writtenTool.data).toMatchObject({ input: JSON.stringify(argumentsValue), output: JSON.stringify(operation), applicationStatus: 'applied', documentId: document.documentId, revision: 1 })
    expect(writtenTool.data.saveStatus).toBeUndefined()
    expect(timeline.items.find(item => item.itemId === readTicket)!.data).toMatchObject({ status: 'failed', error: '同一调用编号不能提交不同内容' })
    expect(timeline.items.some(item => item.type === 'run.end' || item.type === 'reasoning' || item.type === 'usage')).toBe(false)
    const forbiddenOrigin = await fetch(grant.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${grant.bearer}`, Origin: 'http://preview.invalid' } })
    expect(forbiddenOrigin.status).toBe(403)
    await server.revoke(grant.connectionId)
    await expect(client.listResourceTemplates()).rejects.toThrow()
    expect(host.registry.get(document.documentId).read().revision).toBe(1)
  } finally { await client.close(); await server.close(); await rm(directory, { recursive: true, force: true }) }
})
