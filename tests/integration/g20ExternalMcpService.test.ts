// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:net'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { agentFileTools } from '../../src/core/tools/AgentFileTools'
import { describeTools } from '../../src/core/tools/ToolCatalog'
import { toolFailed } from '../../src/core/tools/modelToolResult'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ExternalFilePort } from '../../src/main/workbench/external/ExternalMcpService'
import type { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import type { ExternalApproval } from '../../src/main/workbench/external/ExternalMcpService'
import { callTool, residentMcpFixture, type ResidentToolReply } from '../helpers/residentMcpFixture'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(options: { confirm?: (request: ExternalApproval) => boolean | Promise<boolean>; files?: (files: AgentFileService) => ExternalFilePort;
  permission?: 'full' | 'workspace' | 'ask' | 'read-only'; port?: number } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-resident-mcp-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const workspace = path.join(directory, 'space'), second = path.join(directory, 'second')
  await mkdir(workspace); await mkdir(second)
  await writeFile(path.join(workspace, 'notes.md'), 'AAA BBB')
  await writeFile(path.join(second, 'other.md'), '另一个空间')
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const mcp = await residentMcpFixture({ host, directory, workspaceRoot: workspace, appendEvent: event => events.append(event), confirm: options.confirm, files: options.files,
    settings: { ...(options.permission ? { permission: options.permission } : {}), ...(options.port !== undefined ? { port: options.port } : {}) } })
  cleanups.push(() => mcp.close())
  await mcp.conversations.registerWorkspace({ workspaceId: 'second', rootPath: await realpath(second), managed: false, authorization: 'user-selected' })
  return { directory, workspace, second, host, events, ...mcp }
}
const data = (reply: { structuredContent: { result: any } }) => reply.structuredContent.result.data

it('keeps pending image jobs non-error on the real MCP transport without claiming completion or resending', async () => {
  const f = await fixture()
  // Control only the Gateway receipt; exercise the resident server, SDK envelope,
  // session, operation summaries and timeline used by an external image client.
  vi.spyOn(f.host.tools, 'resolveRunTool').mockImplementation(async (_run, name) => describeTools([name])[0] ?? null)
  let receipt: ToolResult = { kind: 'read', data: { job: 'image-pending', status: 'preparing', stopped: false, resources: [] } }
  const execute = vi.spyOn(f.host.tools, 'execute').mockImplementation(async (_run, _operation, call) => call.name === 'image.status'
    ? { kind: 'read', data: { job: 'image-pending', status: 'ready', stopped: false, resources: [{ resource: 'ready-image' }] } } : receipt)
  const client = await f.connect('pending-image-client')
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    await client.callTool({ name, arguments: args }) as unknown as ResidentToolReply
  const pending = await call('image.edit', { prompt: 'Edit the original image', references: ['original-image'] })
  expect(pending.isError).toBe(false)
  expect(data(pending)).toMatchObject({ job: 'image-pending', status: 'preparing' })
  expect(toolFailed('image.edit', receipt)).toBe(true) // Internal task settlement still remains unfinished.
  const recent = await call('operation.recent')
  expect(recent.isError, JSON.stringify(recent.structuredContent.result)).toBe(false)
  expect(data(recent).operations[0]).toMatchObject({ status: 'pending' })
  const conversation = (await f.conversations.listConversations('space'))[0]!
  const timeline = await f.events.snapshot(conversation.conversationId)
  const imageEvent = timeline.items.find(item => item.type === 'tool' && item.data.toolName === 'image.edit')!
  expect(imageEvent.data).toMatchObject({ status: 'pending' })
  expect(imageEvent.data.error).toBeUndefined()
  const status = await call('image.status', { job: data(pending).job })
  expect(status.isError).toBe(false)
  expect(data(status)).toMatchObject({ job: 'image-pending', status: 'ready' })
  expect(execute.mock.calls.filter(call => call[2].name === 'image.edit')).toHaveLength(1)
  expect((await f.service.status()).sessions).toHaveLength(1)
  for (const state of ['running', 'failed', 'unknown', 'stopped'] as const) {
    receipt = { kind: 'read', data: { job: `image-${state}`, status: state, stopped: state === 'stopped', resources: [] } }
    const result = await call('image.edit', { prompt: `Controlled ${state}`, references: ['original-image'] })
    expect(result.isError).toBe(state !== 'running')
    expect(data(result).status).toBe(state)
  }
})

it('serves a resident session in the current workspace with the built-in tool selection, automatic tickets and canonical writes', async () => {
  const f = await fixture()
  const status = await f.service.status()
  expect(status).toMatchObject({ state: 'running', settings: { enabled: true, permission: 'workspace' } })
  const client = await f.connect('Claude Code')
  const listed = (await client.listTools()).tools
  const names = listed.map(tool => tool.name)
  await f.host.tools.beginRun({ runId: 'builtin-like', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: f.root } })
  const builtin = await f.host.tools.describeRun('builtin-like')
  expect(names).toEqual(expect.arrayContaining([...builtin.map(tool => tool.name), ...agentFileTools.map(tool => tool.name),
    'course.createFromHtml', 'workspace.list', 'workspace.switch', 'workbench.state', 'operation.recent']))
  for (const tool of builtin) expect(listed.find(item => item.name === tool.name)!.inputSchema.properties!.arguments).toEqual(tool.schema)
  // Selection, not passthrough: course editing tools need an opened course document first.
  expect((await f.host.tools.describe()).some(tool => tool.name === 'object.update')).toBe(true)
  expect(names).not.toContain('object.update')

  const read = await callTool(client, 'file.read', { path: 'notes.md' })
  expect(read.isError).toBe(false)
  expect(JSON.stringify(data(read))).toContain('AAA BBB')
  const opened = await callTool(client, 'file.open', { path: 'notes.md' })
  expect(data(opened)).toMatchObject({ writable: true })
  const children = await callTool(client, 'listChildren', { target: data(opened).target })
  const range = data(children)[0].target
  const applied = await callTool(client, 'text.replace', { target: range, content: '你好😀 CCC' })
  expect(applied.structuredContent).toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
  expect(applied.structuredContent.ticket).toEqual(expect.any(String))
  const document = f.host.registry.list().find(item => item.binding.kind === 'file' && item.binding.path.endsWith('notes.md'))!
  expect(document).toMatchObject({ undoDepth: 1, dirty: true, model: { source: '你好😀 CCC' } })

  const conversation = (await f.conversations.listConversations('space')).find(item => item.title === '外部 AI · Claude Code')!
  expect(conversation.runIndex.externalPortIds).toEqual([status.sessions[0]?.sessionId ?? (await f.service.status()).sessions[0]!.sessionId])
  const timeline = await f.events.snapshot(conversation.conversationId)
  expect(timeline.items.every(item => item.source === 'external-mcp')).toBe(true)
  expect(timeline.items.some(item => item.type === 'document.commit')).toBe(true)
  expect(timeline.items.some(item => ['run.end', 'reasoning', 'usage'].includes(item.type))).toBe(false)
  expect(JSON.stringify([conversation, timeline, await f.service.status()])).not.toContain(f.token())
  expect(f.service.activity()).toEqual([{ clientName: 'Claude Code', pendingCalls: 0 }])

  const large = '中文'.repeat(800_000)
  const written = await callTool(client, 'file.write', { mode: 'create', path: 'large.md', content: large })
  expect(written.isError).toBe(false)
  expect(await readFile(path.join(f.workspace, 'large.md'), 'utf8')).toBe(large)
})

it('S12-T03 answers an undelivered write with its original receipt, executes again once delivered, and refuses late writes after stop', async () => {
  let release!: () => void, gate: Promise<void> | undefined, executions = 0
  const f = await fixture({ files: real => ({
    execute: async (...args) => { if (args[1] === 'file.write') { executions++; await gate } return real.execute(...args) },
    preflightMutation: (...args) => real.preflightMutation(...args), releaseRun: runId => real.releaseRun(runId),
  }) })
  const client = await f.connect('Codex')
  const args = { mode: 'replace', path: 'notes.md', content: '第一版' }
  gate = new Promise(resolve => { release = resolve })
  const controller = new AbortController()
  const first = client.callTool({ name: 'file.write', arguments: { arguments: args } }, undefined, { signal: controller.signal })
  await expect.poll(() => executions).toBe(1)
  controller.abort()
  await expect(first).rejects.toThrow()
  release()
  const recent = async () => data(await callTool(client, 'operation.recent')).operations
  await expect.poll(async () => (await recent())[0]?.delivered).toBe(false)
  const replay = await callTool(client, 'file.write', args)
  expect(replay.structuredContent.replayed).toBe(true)
  expect(replay.structuredContent.ticket).toBe((await recent())[0].ticket)
  expect(replay.content.some(item => item.text?.includes('未重复执行'))).toBe(true)
  expect(executions).toBe(1)
  await expect.poll(async () => (await recent())[0]?.delivered).toBe(true)
  const again = await callTool(client, 'file.write', args)
  expect(again.structuredContent.replayed).toBeUndefined()
  expect(executions).toBe(2)
  expect(await readFile(path.join(f.workspace, 'notes.md'), 'utf8')).toBe('第一版')

  // An explicit ticket keeps the Gateway's exact-identity semantics: same call returns its receipt, altered payload is refused.
  const opened = await callTool(client, 'file.open', { path: 'notes.md' })
  const range = data(await callTool(client, 'listChildren', { target: data(opened).target }))[0].target
  const explicit = await callTool(client, 'text.replace', { target: range, content: '第二版' }, 'client-ticket-1')
  expect(explicit.structuredContent).toMatchObject({ ticket: 'client-ticket-1', result: { result: { status: 'applied' } } })
  const repeated = await callTool(client, 'text.replace', { target: range, content: '第二版' }, 'client-ticket-1')
  expect(repeated.structuredContent.result.result.operationId).toBe(explicit.structuredContent.result.result.operationId)
  const altered = await callTool(client, 'text.replace', { target: range, content: '篡改' }, 'client-ticket-1')
  expect(altered.structuredContent.result).toMatchObject({ kind: 'error', code: 'operation-payload-mismatch' })
  const document = f.host.registry.list().find(item => item.binding.kind === 'file' && item.binding.path.endsWith('notes.md'))!
  expect(document).toMatchObject({ undoDepth: 1, model: { source: '第二版' } })

  const sessionId = (await f.service.status()).sessions[0]!.sessionId
  await f.service.stopSession(sessionId)
  await expect(callTool(client, 'file.write', { mode: 'replace', path: 'notes.md', content: '迟到' })).rejects.toThrow('已被用户在果铃中停止')
  expect((await f.service.status()).sessions[0]).toMatchObject({ stopped: true })
  expect(f.host.registry.get(document.documentId).read().model).toMatchObject({ source: '第二版' })
  const reconnected = await f.connect('Codex')
  expect((await callTool(reconnected, 'file.read', { path: 'notes.md' })).isError).toBe(false)
})

it('reports an occupied port without starting, recovers on a new port, and disconnects every session when the token is regenerated', async () => {
  const blocker: Server = createServer()
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise(resolve => blocker.close(resolve)))
  const busy = (blocker.address() as { port: number }).port
  const f = await fixture({ port: busy })
  const occupied = await f.service.status()
  expect(occupied).toMatchObject({ state: 'port-in-use', endpoint: `http://127.0.0.1:${busy}/mcp` })
  expect(occupied.message).toContain(`端口 ${busy} 已被其他程序占用`)
  expect(occupied.message).toContain('设置')
  const running = await f.service.configure({ port: 0 })
  expect(running.state).toBe('running')
  const left = await f.connect('Gemini CLI'), right = await f.connect('OpenCode')
  await callTool(left, 'workspace.list'); await callTool(right, 'workspace.list')
  expect((await f.service.status()).sessions).toHaveLength(2)
  const before = f.token()
  const regenerated = await f.service.regenerateToken()
  expect(regenerated.token).not.toBe(before)
  expect(regenerated.status.sessions).toEqual([])
  await expect(left.listTools()).rejects.toThrow()
  await expect(f.connect('stale', before)).rejects.toThrow()
  const renewed = await f.connect('OpenCode')
  expect((await renewed.listTools()).tools.length).toBeGreaterThan(0)
  const disabled = await f.service.configure({ enabled: false })
  expect(disabled).toMatchObject({ state: 'disabled', sessions: [] })
  await expect(renewed.listTools()).rejects.toThrow()
})

it('S12-T06 binds sessions to the app workspace, switches spaces, isolates handles and asks before writing outside', async () => {
  const f = await fixture({ confirm: request => request.reason !== 'outside-workspace' })
  f.ui.state = { workspaceId: 'second' }
  const second = await f.connect('Codex')
  expect(data(await callTool(second, 'workspace.list'))).toMatchObject({ current: 'second' })
  expect(JSON.stringify(data(await callTool(second, 'file.read', { path: 'other.md' })))).toContain('另一个空间')
  f.ui.state = { workspaceId: 'space' }
  const first = await f.connect('Claude Code')
  const opened = data(await callTool(first, 'file.open', { path: 'notes.md' }))
  const foreign = await callTool(second, 'read', { target: opened.target })
  expect(foreign.isError).toBe(true)
  const outside = await callTool(first, 'file.write', { mode: 'create', path: path.join(f.second, 'leak.md'), content: '越界' })
  expect(outside.structuredContent.result).toMatchObject({ kind: 'error', code: 'approval-denied' })
  expect(f.approvals.at(-1)).toMatchObject({ clientName: 'Claude Code', reason: 'outside-workspace' })
  await expect(readFile(path.join(f.second, 'leak.md'))).rejects.toThrow()
  const switched = data(await callTool(second, 'workspace.switch', { workspaceId: 'space' }))
  expect(switched).toMatchObject({ workspaceId: 'space' })
  expect(JSON.stringify(data(await callTool(second, 'file.read', { path: 'notes.md' })))).toContain('AAA BBB')
  expect((await callTool(second, 'file.read', { path: 'other.md' })).isError).toBe(true)
})

it('gives the foreground selection actionable handles through the read-only workbench state', async () => {
  const f = await fixture()
  const document = await f.host.internalAPI.open(path.join(f.workspace, 'notes.md'))
  f.ui.state = { workspaceId: 'space', activeDocumentId: document.documentId,
    selection: { documentId: document.documentId, targets: [{ kind: 'markdown-range', from: 4, to: 7 }] } }
  const client = await f.connect('Claude Code')
  const state = data(await callTool(client, 'workbench.state'))
  expect(state.documents).toEqual([expect.objectContaining({ documentId: document.documentId, name: 'notes.md', active: true, dirty: false })])
  expect(state.activeDocument).toMatchObject({ documentId: document.documentId, writable: true })
  expect(state.selection.targets).toEqual([{ kind: 'markdown-range', target: expect.any(String) }])
  expect(f.host.registry.get(document.documentId).read().revision).toBe(document.revision)
  const applied = await callTool(client, 'text.replace', { target: state.selection.targets[0].target, content: '选中处' })
  expect(applied.structuredContent.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(f.host.registry.get(document.documentId).read().model).toMatchObject({ source: 'AAA 选中处' })
})

it('freezes the permission level per session: read-only hides changes and ask requires the host confirmation', async () => {
  let allow = false
  const f = await fixture({ permission: 'read-only', confirm: () => allow })
  const reader = await f.connect('Gemini CLI')
  const readerTools = (await reader.listTools()).tools.map(tool => tool.name)
  expect(readerTools).toContain('file.read')
  expect(readerTools).not.toContain('file.write')
  expect(readerTools).not.toContain('course.createFromHtml')
  expect((await callTool(reader, 'file.write', { mode: 'create', path: 'blocked.md', content: 'x' })).structuredContent.result).toMatchObject({ code: 'unknown-tool' })
  await f.service.configure({ permission: 'ask' })
  const asker = await f.connect('Codex')
  const denied = await callTool(asker, 'file.write', { mode: 'create', path: 'asked.md', content: '询问后写入' })
  expect(denied.structuredContent.result).toMatchObject({ code: 'approval-denied' })
  expect(f.approvals.at(-1)).toMatchObject({ clientName: 'Codex', reason: 'ask' })
  await expect(readFile(path.join(f.workspace, 'asked.md'))).rejects.toThrow()
  allow = true
  expect((await callTool(asker, 'file.write', { mode: 'create', path: 'asked.md', content: '询问后写入' })).isError).toBe(false)
  expect(await readFile(path.join(f.workspace, 'asked.md'), 'utf8')).toBe('询问后写入')
  expect((await reader.listTools()).tools.map(tool => tool.name)).not.toContain('file.write')
})

it('S12-T02 keeps concurrent clients on one Session and History, and a closing document revokes only its handles', async () => {
  const f = await fixture()
  const codex = await f.connect('Codex'), opencode = await f.connect('OpenCode')
  const [left, right] = await Promise.all([codex, opencode].map(async client => data(await callTool(client, 'file.open', { path: 'notes.md' }))))
  expect(left.documentId).toBe(right.documentId)
  const results = await Promise.all([
    callTool(codex, 'file.patch', { path: 'notes.md', oldText: 'AAA', newText: '中文😀' }),
    callTool(opencode, 'file.patch', { path: 'notes.md', oldText: 'BBB', newText: 'END' }),
  ])
  expect(results.map(result => result.isError)).toEqual([false, false])
  const conflict = await Promise.all([
    callTool(codex, 'file.patch', { path: 'notes.md', oldText: 'END', newText: 'X' }),
    callTool(opencode, 'file.patch', { path: 'notes.md', oldText: 'END', newText: 'Y' }),
  ])
  expect(conflict.filter(result => !result.isError)).toHaveLength(1)
  expect(f.host.registry.list()).toHaveLength(1)
  expect(f.host.registry.get(left.documentId).read()).toMatchObject({ undoDepth: 3 })
  expect(f.service.writableSessionsForDocument(left.documentId)).toHaveLength(2)
  await f.service.stopForDocument(left.documentId)
  expect(f.service.writableSessionsForDocument(left.documentId)).toEqual([])
  const stale = await callTool(codex, 'read', { target: left.target })
  expect(stale.isError).toBe(true)
  expect(stale.content.some(item => item.text?.includes('句柄均已失效'))).toBe(true)
  expect((await f.service.status()).sessions.every(session => !session.stopped)).toBe(true)
  expect((await callTool(codex, 'file.read', { path: 'notes.md' })).isError).toBe(false)
})
