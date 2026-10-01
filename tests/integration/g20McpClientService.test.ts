import { describe, expect, it, vi } from 'vitest'
import { McpClientService, type McpClientConnection } from '../../src/main/workbench/externalTools/McpClientService'

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
