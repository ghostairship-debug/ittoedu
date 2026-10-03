import { describe, expect, it, vi } from 'vitest'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpSdkClient, McpClientService, type McpClientConnection } from '../../src/main/workbench/externalTools/McpClientService'

const connection: McpClientConnection = {
  namespace: 'browser', transport: { kind: 'streamable-http', endpoint: 'https://example.com/mcp', bearer: 'host-secret' },
  tools: [{ name: 'page_read', effect: 'read' }, { name: 'page_submit', effect: 'write' }],
}

describe('M29 outgoing MCP authorization', () => {
  it('discovers namespaced, run-scoped tools and preserves remote resource identity', async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [
        { name: 'page_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
        { name: 'page_submit', description: 'Submit', inputSchema: { type: 'object', properties: {} } },
        { name: 'unapproved', description: 'Not allowed', inputSchema: { type: 'object', properties: {} } },
      ] }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Actual page' },
        { type: 'resource_link', uri: 'https://remote.example/file', name: 'file' }] }), close: vi.fn().mockResolvedValue(undefined),
    }
    const service = new McpClientService({ connection, connect: async () => client })
    service.beginRun('run', { allowedTools: ['page_read'], writeAllowed: false })
    expect(await service.discover('run')).toMatchObject({ status: 'available', tools: [{ name: 'mcp.browser.page_read', effect: 'read' }] })
    const result = await service.invoke({ runId: 'run', operationId: 'read-1', name: 'mcp.browser.page_read', arguments: {} })
    expect(result).toMatchObject({ status: 'returned', content: [{ type: 'text', text: 'Actual page' },
      { type: 'resource-link', uri: 'https://remote.example/file', origin: 'remote' }] })
    expect(await service.invoke({ runId: 'run', operationId: 'read-1', name: 'mcp.browser.page_read', arguments: {} })).toEqual(result)
    expect(client.callTool).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('host-secret')
  })

  it('refuses writes without concrete authorization and reports uncertain writes without replay', async () => {
    const client = { listTools: vi.fn().mockResolvedValue({ tools: [
      { name: 'page_submit', inputSchema: { type: 'object', properties: {} } },
    ] }), callTool: vi.fn().mockRejectedValue(new Error('connection lost')), close: vi.fn().mockResolvedValue(undefined) }
    const authorizeWrite = vi.fn().mockResolvedValue(true)
    const service = new McpClientService({ connection, connect: async () => client, authorizeWrite })
    service.beginRun('readonly', { allowedTools: ['page_submit'], writeAllowed: false })
    expect(await service.invoke({ runId: 'readonly', operationId: 'write-1', name: 'mcp.browser.page_submit', arguments: {} }))
      .toMatchObject({ status: 'rejected' })
    expect(client.callTool).not.toHaveBeenCalled()
    service.beginRun('write', { allowedTools: ['page_submit'], writeAllowed: true })
    const first = await service.invoke({ runId: 'write', operationId: 'write-2', name: 'mcp.browser.page_submit', arguments: { target: 'test-only' } })
    expect(first).toMatchObject({ status: 'unknown' })
    expect(await service.invoke({ runId: 'write', operationId: 'write-2', name: 'mcp.browser.page_submit', arguments: { target: 'test-only' } })).toEqual(first)
    expect(client.callTool).toHaveBeenCalledTimes(1)
    expect(authorizeWrite).toHaveBeenCalledTimes(1)
  })

  it('revokes new calls before a late external response can publish resources', async () => {
    let complete!: (result: { content: unknown[] }) => void
    const client = { listTools: vi.fn().mockResolvedValue({ tools: [
      { name: 'page_read', inputSchema: { type: 'object', properties: {} } },
    ] }), callTool: vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve })), close: vi.fn().mockResolvedValue(undefined) }
    const service = new McpClientService({ connection, connect: async () => client })
    service.beginRun('run', { allowedTools: ['page_read'], writeAllowed: false })
    await service.discover('run')
    const pending = service.invoke({ runId: 'run', operationId: 'read', name: 'mcp.browser.page_read', arguments: {} })
    await Promise.resolve()
    await service.stopRun('run')
    complete({ content: [{ type: 'image', data: Buffer.from('image').toString('base64'), mimeType: 'image/png' }] })
    expect(await pending).toMatchObject({ status: 'unknown' })
    expect(await service.invoke({ runId: 'run', operationId: 'new', name: 'mcp.browser.page_read', arguments: {} }))
      .toMatchObject({ status: 'rejected' })
  })
})

it('discovers an authorized tool on page 25 and rejects real cursor loops', async () => {
  let calls = 0, loop = false
  const client = { listTools: vi.fn(async () => {
    calls++
    return calls === 25 && !loop ? { tools: [{ name: 'page_read', inputSchema: { type: 'object', properties: {} } }] }
      : { tools: [], nextCursor: loop ? 'same-cursor' : `p-${calls}` }
  }), callTool: vi.fn(), close: vi.fn(async () => undefined) }
  const service = new McpClientService({ connection, connect: async () => client })
  service.beginRun('long-discovery', { allowedTools: ['page_read'], writeAllowed: false })
  expect(await service.discover('long-discovery')).toMatchObject({ status: 'available', tools: [{ remoteName: 'page_read' }] })
  expect(calls).toBe(25)
  loop = true
  service.beginRun('loop', { allowedTools: ['page_read'], writeAllowed: false })
  expect(await service.discover('loop')).toMatchObject({ status: 'failed', reason: '外部工具分页游标重复' })
  expect(calls).toBe(27)
  await service.endRun('long-discovery'); await service.endRun('loop')
})

it('keeps actual SDK tool calls alive beyond 60 seconds while preserving discovery timers and AbortSignal', async () => {
  const server = new Server({ name: 'long-tool-fixture', version: '1.0' }, { capabilities: { tools: {} } })
  const client = createMcpSdkClient()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  let finish!: (reply: { content: { type: 'text'; text: string }[] }) => void
  let aborted = false, delayListing = false
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    if (delayListing) await new Promise<void>(resolve => extra.signal.addEventListener('abort', () => resolve(), { once: true }))
    return { tools: [{ name: 'page_read', inputSchema: { type: 'object' as const } }] }
  })
  server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => new Promise(resolve => {
    finish = resolve
    extra.signal.addEventListener('abort', () => { aborted = true; resolve({ content: [] }) }, { once: true })
  }))
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const service = new McpClientService({ connection, connect: async () => ({
    listTools: (params, options) => client.listTools(params, options),
    callTool: async (params, _schema, options) => {
      const result = await client.callTool(params, undefined, options)
      if (!Array.isArray(result.content)) throw new Error('fixture tool result has no content')
      return { content: result.content, structuredContent: result.structuredContent, isError: result.isError === true }
    }, close: () => client.close(),
  }) })
  service.beginRun('long-sdk', { allowedTools: ['page_read'], writeAllowed: false })
  await service.discover('long-sdk')
  vi.useFakeTimers()
  try {
    let returned = false
    const pending = service.invoke({ runId: 'long-sdk', operationId: 'long-read', name: 'mcp.browser.page_read', arguments: {} })
    void pending.then(() => { returned = true })
    await vi.advanceTimersByTimeAsync(0)
    delayListing = true
    const listing = expect(client.listTools(undefined, { timeout: 10 })).rejects.toThrow('Request timed out')
    await vi.advanceTimersByTimeAsync(61_000)
    await listing
    expect(returned).toBe(false)
    expect(aborted).toBe(false)
    finish({ content: [{ type: 'text', text: 'long task complete' }] })
    expect(await pending).toMatchObject({ status: 'returned', content: [{ text: 'long task complete' }] })
    const stop = new AbortController()
    const cancelled = service.invoke({ runId: 'long-sdk', operationId: 'cancel-read', name: 'mcp.browser.page_read', arguments: {}, signal: stop.signal })
    await vi.advanceTimersByTimeAsync(0)
    stop.abort()
    expect(await cancelled).toMatchObject({ status: 'failed' })
    expect(aborted).toBe(true)
  } finally {
    vi.useRealTimers()
    await service.endRun('long-sdk')
    await server.close()
  }
})

it('preserves complete external results beyond former text, block, schema and binary quotas', async () => {
  const text = 'content-'.repeat(10_000)
  const image = Buffer.alloc(6 * 1024 * 1024, 65)
  const client = { listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'page_read', description: text,
    inputSchema: { type: 'object', description: 's'.repeat(5 * 1024 * 1024) } }] }),
    callTool: vi.fn().mockResolvedValue({ content: [
      ...Array.from({ length: 45 }, () => ({ type: 'text', text })),
      { type: 'image', data: image.toString('base64'), mimeType: 'image/png' },
    ], structuredContent: { text } }), close: vi.fn().mockResolvedValue(undefined) }
  const service = new McpClientService({ connection, connect: async () => client })
  service.beginRun('full', { allowedTools: ['page_read'], writeAllowed: false })
  try {
    expect(await service.discover('full')).toMatchObject({ status: 'available', tools: [{ description: text }] })
    const result = await service.invoke({ runId: 'full', operationId: 'o'.repeat(600), name: 'mcp.browser.page_read', arguments: {} })
    expect(result).toMatchObject({ status: 'returned', structuredContent: { text }, truncated: false })
    if (result.status !== 'returned') throw new Error('external result unavailable')
    expect(result.content).toHaveLength(46)
    expect(result.content[44]).toMatchObject({ text, truncated: false })
    const resource = result.content[45]
    if (resource?.type !== 'binary') throw new Error('image result unavailable')
    expect(service.readResource('full', resource.resourceId).bytes.length).toBe(image.length)
    expect(client.callTool.mock.calls[0]?.[2]).toEqual({ signal: expect.any(AbortSignal), timeout: 0 })
  } finally { await service.endRun('full') }
})
