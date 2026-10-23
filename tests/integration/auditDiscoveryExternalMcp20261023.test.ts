// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { callTool, residentMcpFixture } from '../helpers/residentMcpFixture'

it('lists and calls builtin asset discovery over real external loopback MCP without an asset service', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'discovery-external-mcp-'))
  let mcp: Awaited<ReturnType<typeof residentMcpFixture>> | undefined
  try {
    const host = new DocumentHostService(path.join(directory, 'documents'))
    mcp = await residentMcpFixture({ host, directory, workspaceRoot: directory,
      settings: { permission: 'read-only', port: 0 } })
    const client = await mcp.connect('discovery-loopback-client')
    expect(mcp.service.server.listeningPort).toBeGreaterThan(0)
    const listed = (await client.listTools()).tools
    expect(listed.find(tool => tool.name === 'asset.search')).toMatchObject({ annotations: { readOnlyHint: true } })
    const reply = await callTool(client, 'asset.search', { query: '柱形图', limit: 1 })
    expect(reply.isError, JSON.stringify(reply.structuredContent.result)).toBe(false)
    expect(reply.structuredContent.result).toMatchObject({ kind: 'read', data: {
      status: 'results', directory: { available: false, reason: expect.stringContaining('尚未配置') },
      entries: [{ id: 'chart:bar', availability: { available: true }, action: {
        kind: 'create', tool: 'object.insert', input: { kind: 'chart', chartType: 'bar' },
      } }],
    } })
    expect(mcp.approvals).toEqual([])
  } finally {
    await mcp?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})
