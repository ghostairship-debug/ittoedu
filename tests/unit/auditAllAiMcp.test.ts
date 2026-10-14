// @vitest-environment node
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { ResidentMcpServer } from '../../src/main/workbench/external/ResidentMcpServer'
import { ExternalMcpService } from '../../src/main/workbench/external/ExternalMcpService'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { randomUUID } from 'node:crypto'
const deferred = () => { let resolve!: (value?: any) => void; const promise = new Promise(resolveValue => { resolve = resolveValue }); return { promise, resolve } }
it('CA-139 terminates a newly initialized domain session when the client closes before receiving its ID', async () => {
  const gate = deferred(), entered = deferred(), terminate = vi.fn()
  const server = new ResidentMcpServer({ initialize: async () => { entered.resolve(); await gate.promise; return { sessionId: 'new', instructions: '' } }, terminate, request: vi.fn() }) as any
  server.port = 4321
  const request = Readable.from([Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture' } } }))]) as any
  Object.assign(request, { method: 'POST', url: '/mcp', headers: { host: '127.0.0.1:4321', 'content-type': 'application/json', accept: 'application/json,text/event-stream' }, socket: { remoteAddress: '127.0.0.1' } })
  const response = Object.assign(new EventEmitter(), { destroyed: false, writableFinished: false, writeHead: vi.fn(), end: vi.fn() })
  const receiving = server.receive(request, response)
  await entered.promise; response.destroyed = true; response.emit('close'); gate.resolve(); await receiving
  expect(terminate).toHaveBeenCalledExactlyOnceWith('new'); expect(server.sessions.size).toBe(0); expect(response.end).not.toHaveBeenCalled()
})
it('CA-156 stops intake before queued close so a late initialize cannot wait on the close that awaits it', async () => {
  const gate = deferred(), h = new ExternalMcpService({} as any) as any
  h.state = 'running'; h.lifecycle = gate.promise
  h.server.stop = vi.fn(async () => {}); h.closeSessions = vi.fn(async () => {})
  const closing = h.close()
  await expect(h.initialize({ name: 'late', version: 'fixture' })).rejects.toThrow('尚未启动或已停止')
  gate.resolve(); await closing; expect(h.requests.size).toBe(0)
})
it('CA-163 serializes actual tool planning through commit within an MCP session without replaying a stale mutation', async () => {
  const gate = deferred(), h = new ExternalMcpService({} as any) as any
  const session = { sessionId: 's', runId: 'r', authority: Promise.resolve(), pending: 0, stopped: false }
  h.sessions.set('s', session)
  const calls: string[] = []; let revision = 0
  h.callTool = async (_session: any, call: any) => { const observed = revision; calls.push(call.params.name); if (calls.length === 1) await gate.promise; expect(observed).toBe(revision); revision++; return {} }
  const call = (name: string) => h.request('s', { method: 'tools/call', params: { name }, notify: vi.fn() })
  const a = call('A'), b = call('B'); await Promise.resolve(); await Promise.resolve()
  expect(calls).toEqual(['A']); gate.resolve(); await Promise.all([a, b]); expect(calls).toEqual(['A', 'B']); expect(revision).toBe(2)
})
it('CA-135 detaches a closed read-only document grant while keeping the external session available', async () => {
  const stopRunDocument = vi.fn(async () => {}), h = new ExternalMcpService({ gateway: { runIdsForDocument: () => ['read-run'], stopRunDocument } } as any) as any
  const session = { sessionId: 's', runId: 'read-run', permission: 'read-only', notices: [], stopped: false }
  h.sessions.set('s', session)
  await h.stopForDocument('closed')
  expect(stopRunDocument).toHaveBeenCalledWith('read-run', 'closed'); expect(session.stopped).toBe(false); expect(h.sessions.size).toBe(1)
})
it('CA-135 keeps real Gateway catalog and new document attach usable after closing a read-only granted document', async () => {
  const driver = new MarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { append: async () => {}, save: async input => { if (input.binding.kind !== 'file') throw new Error('No fixture file'); return input.binding } } })
  const old = await registry.create({ kind: 'markdown', source: 'old', resources: { assets: {}, components: {} } }, 'old.md', true), next = await registry.create({ kind: 'markdown', source: 'next', resources: { assets: {}, components: {} } }, 'next.md', true)
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'read-run', actor: 'agent', documents: [{ documentId: old.documentId, writable: [] }] })
  await gateway.describeRun('read-run')
  const h = new ExternalMcpService({ gateway } as any) as any
  h.sessions.set('s', { sessionId: 's', runId: 'read-run', notices: [], stopped: false })
  await registry.close(old.documentId); await h.stopForDocument(old.documentId)
  await gateway.attachRunDocument('read-run', next.documentId, false)
  expect((await gateway.describeRun('read-run')).some(tool => tool.name === 'read')).toBe(true)
  expect(gateway.runIdsForDocument(old.documentId)).toEqual([]); expect(gateway.runIdsForDocument(next.documentId)).toEqual(['read-run'])
  await gateway.stop('read-run')
})
