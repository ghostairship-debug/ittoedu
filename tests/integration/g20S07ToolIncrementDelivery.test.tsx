// @vitest-environment jsdom
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { callTool, residentMcpFixture } from '../helpers/residentMcpFixture'
import { OpenAIChatProvider, modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  cleanup(); vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'g20-s07-production-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const eventsDirectory = path.join(directory, 'events')
  const events = new ExecutionEventStore({ directory: eventsDirectory })
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'PRIVATE_DOCUMENT_BODY', resources: { assets: {}, components: {} } }, 'unsaved.md')
  const reopen = () => new ExecutionEventStore({ directory: eventsDirectory })
  return { directory, host, events, document, reopen }
}
async function toolEvents(events: ExecutionEventStore, source: 'builtin' | 'external-mcp', conversationId = 'conversation', update: 'append' | 'snapshot' = 'append') {
  const page = await events.readPage({ conversationId, limit: 100 })
  return page.events.filter(event => event.type === 'tool' && event.source === source && event.data.status === 'running' && event.update === update && event.data.text)
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read()
    if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Production tool increments were not observed')
}
function assertRunningCard(projection: Awaited<ReturnType<ExecutionEventStore['snapshot']>>, source: 'builtin' | 'external-mcp', parts: string[]) {
  const tools = projection.items.filter(item => item.type === 'tool' && item.source === source)
  expect(tools).toHaveLength(1)
  expect(tools[0]!.data.status).toBe('running')
  expect(tools[0]!.content).toEqual(parts.map(text => ({ kind: 'text', text })))
  const { unmount } = render(<ExecutionTimeline projection={projection} />)
  const card = screen.getByRole('article', { name: '工具执行' })
  const details = card.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  expect(within(card).getByText(parts.join(''))).toBeInTheDocument()
  if (source === 'external-mcp') expect(within(card).getByText('外部 MCP · 仅显示实际工具事实')).toBeInTheDocument()
  unmount()
}

it('S07-T01 receives three real HTTP SSE tool fragments and reopens one built-in timeline card', async () => {
  const h = await fixture(), release = deferred()
  let requests = 0
  const wire = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'response', model: 'actual-fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const server = createServer((request, response) => { void (async () => {
    let body = ''; for await (const bytes of request) body += bytes.toString()
    const payload = JSON.parse(body); requests++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests === 1) {
      const refs = JSON.parse(payload.messages[1].content.split('：')[1])
      const args = JSON.stringify({ target: refs[0].target, limit: 100 })
      const cut1 = Math.floor(args.length / 3), cut2 = Math.floor(args.length * 2 / 3)
      response.write(wire({ role: 'assistant', tool_calls: [{ index: 0, id: 'provider-call', type: 'function', function: { name: modelToolWireName('read'), arguments: args.slice(0, cut1) } }] }))
      response.write(wire({ tool_calls: [{ index: 0, function: { arguments: args.slice(cut1, cut2) } }] }))
      response.write(wire({ tool_calls: [{ index: 0, function: { arguments: args.slice(cut2) } }] }, 'tool_calls'))
      await release.promise
    } else response.write(wire({ role: 'assistant', content: '读取完成' }, 'stop'))
    response.end('data: [DONE]\n\n')
  })() })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  cleanups.push(async () => release.resolve())
  const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, accountId: 'fixture-account',
    auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
  const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools,
    runs: new ExecutionRunStore(path.join(h.directory, 'runs')),
    events: h.events, provider: new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' }) })
  const started = await engine.start({ conversationId: 'conversation', taskId: 'builtin-task', instruction: '读取当前文档', selection,
    documents: [{ documentId: h.document.documentId, writable: [] }] })
  // The fragments of one call show live on one card as the tool being prepared (coalesced, never the argument text).
  const increments = await until(() => toolEvents(h.reopen(), 'builtin', 'conversation', 'snapshot'), rows => rows.length > 0)
  expect(increments.every(row => row.data.text === '正在准备读取内容…')).toBe(true)
  expect(new Set(increments.map(row => `${row.runId}:${row.itemId}`)).size).toBe(1)
  expect(JSON.stringify(increments)).not.toContain('PRIVATE_DOCUMENT_BODY')
  expect(JSON.stringify(increments)).not.toContain('fixture-key')
  assertRunningCard(await h.reopen().snapshot('conversation'), 'builtin', ['正在准备读取内容…'])
  release.resolve()
  expect((await engine.wait(started.runId)).status).toBe('completed')
  expect(requests).toBe(2)
  const final = (await h.reopen().snapshot('conversation')).items.filter(item => item.type === 'tool')
  expect(final).toHaveLength(1)
  expect(final[0]).toMatchObject({ runId: started.runId, itemId: increments[0]!.itemId, data: { status: 'completed' } })
  expect(final[0]!.content).toEqual([{ kind: 'text', text: '已收到正式结果' }])
})

it('S07-T01 receives real resident MCP stages and reopens one external source timeline card', async () => {
  const h = await fixture(), release = deferred()
  const workspace = path.join(h.directory, 'space')
  await mkdir(workspace)
  const mcp = await residentMcpFixture({ host: h.host, directory: h.directory, workspaceRoot: workspace, appendEvent: event => h.events.append(event) })
  cleanups.push(() => mcp.close())
  cleanups.push(async () => release.resolve())
  mcp.ui.state = { workspaceId: 'space', activeDocumentId: h.document.documentId }
  const client = await mcp.connect('S07 外部客户端')
  const state = (await callTool(client, 'workbench.state')).structuredContent.result.data
  const execute = h.host.tools.execute.bind(h.host.tools)
  vi.spyOn(h.host.tools, 'execute').mockImplementation(async (...args) => { await release.promise; return execute(...args) })
  const pending = callTool(client, 'read', { target: state.activeDocument.target, limit: 100 })
  const conversationId = await until(async () => (await mcp.conversations.listConversations('space'))
    .find(item => item.title === '外部 AI · S07 外部客户端')?.conversationId, Boolean) as string
  const increments = await until(() => toolEvents(h.reopen(), 'external-mcp', conversationId), rows => rows.length === 2)
  expect(increments.map(row => row.data.text)).toEqual(['已收到外部工具请求。', '正在调用正式工具。'])
  expect(new Set(increments.map(row => `${row.runId}:${row.itemId}`)).size).toBe(1)
  expect(JSON.stringify(increments)).not.toContain('PRIVATE_DOCUMENT_BODY')
  expect(JSON.stringify(increments)).not.toContain("Authorization")
  assertRunningCard(await h.reopen().snapshot(conversationId), 'external-mcp', increments.map(row => row.data.text!))
  release.resolve()
  const response = await pending
  expect(response.structuredContent.result.kind).toBe('read')
  const final = (await h.reopen().snapshot(conversationId)).items.filter(item => item.type === 'tool')
  expect(final).toHaveLength(1)
  expect(final[0]).toMatchObject({ runId: increments[0]!.runId, itemId: increments[0]!.itemId, source: 'external-mcp', data: { status: 'completed' } })
})
