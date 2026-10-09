// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'

const driver = new MarkdownDriver()
const gatewayWith = (services: HostToolServices) => {
  const registry = new DocumentRegistry({ persistence: { async append() {}, async save() { return {
    kind: 'file' as const, path: 'D:/fixture/doc.md', version: null, bindingVersion: 0,
  } } }, drivers: [driver],
    createId: () => crypto.randomUUID(), bindingKey: binding => binding.path })
  return new DocumentToolGateway(registry, [driver], () => crypto.randomUUID(), { services })
}

describe('M28/M29 shared service catalog and gateway', () => {
  it('exposes only frozen built-in run services without a document and revokes them on Stop', async () => {
    const resourceId = 'image-resource', bytes = new Uint8Array([137, 80, 78, 71])
    const gateway = gatewayWith({
      web: { async search() { return { status: 'not-configured', reason: '无搜索连接' } },
        async open() { return { status: 'opened', text: '真实正文', source: { url: 'https://example.com/' }, offset: 0, truncated: false } } },
      mcp: { async discover() { return { status: 'available', tools: [{ name: 'mcp.browser.browser_snapshot' }] } },
        async invoke() { return { status: 'returned', content: [{ type: 'binary', resourceId, mimeType: 'image/png', byteLength: bytes.length }] } },
        readResource(_runId, requested) { if (requested !== resourceId) throw new Error('wrong resource'); return { mimeType: 'image/png', bytes } },
        async lookup() { return null } },
      media: { discover() { return [{ kind: 'speech', status: 'not-configured' }] },
        async start() { return { status: 'not-configured', reason: '无模型' } } },
    })
    await gateway.beginRun({ runId: 'agent-run', actor: 'agent', documents: [],
      fileAccess: { permission: 'workspace', workspaceRoot: 'D:/fixture' } })
    // The initial baseline catalog is lean: web.open/mcp/web.search/media.discover are
    // visible immediately; job/compute/media mutations require explicit family loading.
    await gateway.loadToolFamilies('agent-run', ['jobs', 'media'])
    const names = (await gateway.describeRun('agent-run')).map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['web.open', 'mcp.discover', 'mcp.invoke', 'mcp.resource', 'media.start']))
    expect(names).not.toContain('compute.run') // No compute backend is configured.
    expect(names).not.toContain('job.status') // No job owner is configured.
    expect(await gateway.execute('agent-run', 'open', { name: 'web.open', input: { url: 'https://example.com/' } }))
      .toMatchObject({ kind: 'read', data: { status: 'opened', text: '真实正文' } })
    expect(await gateway.execute('agent-run', 'search', { name: 'web.search', input: { query: '叶片' } }))
      .toMatchObject({ kind: 'read', data: { status: 'not-configured' } })
    expect(await gateway.execute('agent-run', 'screen', { name: 'mcp.invoke', input: { name: 'mcp.browser.browser_snapshot', arguments: {} } }))
      .toMatchObject({ kind: 'read', data: { status: 'returned' } })
    expect(await gateway.execute('agent-run', 'resource', { name: 'mcp.resource', input: { resourceId } }))
      .toMatchObject({ kind: 'read', data: { resourceId, mimeType: 'image/png', byteLength: bytes.length } })
    expect((await gateway.readMcpResource('agent-run', resourceId)).bytes).toEqual(bytes)
    expect(await gateway.execute('agent-run', 'media', { name: 'media.start', input: { kind: 'speech', prompt: '读出这段文字' } }))
      .toMatchObject({ kind: 'read', data: { status: 'not-configured' } })
    await gateway.stop('agent-run')
    expect(await gateway.execute('agent-run', 'late', { name: 'web.open', input: { url: 'https://example.com/' } }))
      .toMatchObject({ kind: 'error', code: 'run-stopped' })

    await gateway.beginRun({ runId: 'external-run', actor: 'external', documents: [] })
    expect((await gateway.describeRun('external-run')).map(tool => tool.name)).not.toContain('mcp.invoke')
    await gateway.stop('external-run')
  })
})
