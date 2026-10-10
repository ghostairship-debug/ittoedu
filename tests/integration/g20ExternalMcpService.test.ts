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
import { OpenImageService } from '../../src/main/workbench/assetSources/OpenImageService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { artifactDeliverySource } from '../../src/core/tools/HostArtifactTools'

const cleanups: (() => Promise<unknown>)[] = []

it('returns the shared missing-parent diagnostic over MCP without invoking or granting a write', async () => {
  const f = await fixture(), client = await f.connect('missing-parent')
  const input = { path: 'new-lesson/plan.md', mode: 'create', content: '策划' }
  const failed = await callTool(client, 'file.write', input)
  expect(failed.isError).toBe(true)
  expect(failed.structuredContent.result).toMatchObject({ kind: 'error', code: 'tool-failed', data: { pendingCreationPath: path.join(f.root, input.path) } })
  expect((await callTool(client, 'file.mkdir', { name: 'new-lesson', path: '.' })).isError).toBe(false)
  const written = await callTool(client, 'file.write', input)
  expect(written.isError).toBe(false)
  expect(written.structuredContent.result).toMatchObject({ kind: 'read', data: { path: path.join(f.root, input.path), saved: true } })
  expect(await readFile(path.join(f.root, input.path), 'utf8')).toBe('策划')
  const recent = await callTool(client, 'operation.recent')
  expect(data(recent).operations.some((entry: { tool: string; status: string }) => entry.tool === 'file.write' && entry.status === 'failed')).toBe(true)
})
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(options: { confirm?: (request: ExternalApproval) => boolean | Promise<boolean>; files?: (files: AgentFileService) => ExternalFilePort;
  permission?: 'full' | 'workspace' | 'ask' | 'read-only'; port?: number; enabled?: boolean } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-resident-mcp-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const workspace = path.join(directory, 'space'), second = path.join(directory, 'second')
  await mkdir(workspace); await mkdir(second)
  await writeFile(path.join(workspace, 'notes.md'), 'AAA BBB')
  await writeFile(path.join(second, 'other.md'), '另一个空间')
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const mcp = await residentMcpFixture({ host, directory, workspaceRoot: workspace, appendEvent: event => events.append(event), confirm: options.confirm, files: options.files,
    settings: { ...(options.enabled !== undefined ? { enabled: options.enabled } : {}), ...(options.permission ? { permission: options.permission } : {}), ...(options.port !== undefined ? { port: options.port } : {}) } })
  cleanups.push(() => mcp.close())
  await mcp.conversations.registerWorkspace({ workspaceId: 'second', rootPath: await realpath(second), managed: false, authorization: 'user-selected' })
  return { directory, workspace, second, host, events, ...mcp }
}
const data = (reply: { structuredContent: { result: any } }) => reply.structuredContent.result.data

it.each(['ask', 'outside-workspace', 'denied', 'stop-approved'] as const)('binds artifact %s approval to the actual MCP operation path and frozen resource owner', async scenario => {
  let artifactPhase = false
  const f = await fixture({ permission: scenario === 'ask' ? 'ask' : 'workspace', confirm: async () => {
    if (!artifactPhase) return true
    if (scenario === 'denied') return false
    if (scenario === 'stop-approved') await f.service.stopSession((await f.service.status()).sessions[0]!.sessionId)
    return true
  } })
  const bytes = await readFile(path.resolve('tests/fixtures/g20M17/local-media.png'))
  const images = new OpenImageService({ http: { getJson: async () => { throw new Error('Offline source') },
    getBytes: async () => ({ url: 'https://example.com/fixture.png', contentType: 'image/png', bytes }) },
    libraries: [['openverse', async () => ({ library: 'openverse', excluded: 0, hasMore: false, candidates: [{
      library: 'openverse', providerId: 'fixture', title: 'Offline resource', license: { code: 'cc0', id: 'CC0 1.0', attributionRequired: false },
      sourceName: 'Offline resource', pageUrl: 'https://example.com/fixture', fileUrl: 'https://example.com/fixture.png',
    }] })]] })
  f.host.tools.configureHostServices({ openImages: images, beginRun: async grant => { images.beginRun(grant.runId) }, stopRun: runId => { images.stopRun(runId) },
    artifacts: {
      preflight: ({ grant, destination }) => f.host.artifactDeliveries.preflight({ workspaceRoot: grant.fileAccess!.workspaceRoot!, permission: grant.fileAccess!.permission, destination }),
      lookup: (runId, operationId) => f.host.artifactDeliveries.lookup(operationId, runId),
      save: ({ grant, operationId, source, bytes, approvedPaths, assertActive }) => f.host.artifactDeliveries.deliver({ runId: grant.runId, operationId,
        workspaceRoot: grant.fileAccess!.workspaceRoot!, permission: grant.fileAccess!.permission, destination: source.destination,
        ...artifactDeliverySource(source), bytes, approvedTargetPath: approvedPaths?.[0], assertActive }),
    },
  })
  const document = await f.host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Resource owner'), resources: { assets: {}, components: {} } }, 'source.h5lesson')
  await f.host.internalAPI.save(document.documentId, path.join(f.workspace, 'source.h5lesson'))
  const client = await f.connect('artifact-path-owner')
  expect((await callTool(client, 'file.open', { path: 'source.h5lesson' })).isError).toBe(false)
  const found = data(await callTool(client, 'image.search', { query: 'fixture', limit: 1 }))
  const fetched = data(await callTool(client, 'image.fetch', { image: found.candidates[0].image }))
  expect(fetched).toMatchObject({ status: 'ready' })
  f.approvals.length = 0
  artifactPhase = true
  const destination = scenario === 'ask' ? 'saved.png' : path.join(f.directory, 'outside.png')
  const target = path.resolve(f.workspace, destination)
  const saved = await callTool(client, 'artifact.save', { source: fetched.resource, destination })
  expect(f.approvals).toEqual([expect.objectContaining({ paths: [target], reason: scenario === 'ask' ? 'ask' : 'outside-workspace' })])
  if (scenario === 'ask' || scenario === 'outside-workspace') {
    expect(data(saved)).toMatchObject({ status: 'written', path: target, sourceId: fetched.resource })
    expect(await readFile(target)).toEqual(bytes)
  } else {
    expect(saved.isError).toBe(true)
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

it('delivers every typed prepared image through the real MCP reply without decoding data.image', async () => {
  const f = await fixture()
  vi.spyOn(f.host.tools, 'resolveRunTool').mockImplementation(async (_run, name) => describeTools([name])[0] ?? null)
  const result: ToolResult = { kind: 'read', data: { status: 'prepared', image: { resourceId: 'unrelated-legacy-value' } }, images: [
    { kind: 'image', source: 'preview', resourceId: 'one', mimeType: 'image/png' },
    { kind: 'image', source: 'preview', resourceId: 'two', mimeType: 'image/webp' },
  ] }
  vi.spyOn(f.host.tools, 'execute').mockResolvedValue(result)
  const prepare = vi.spyOn(f.host.tools, 'prepareResultImages').mockResolvedValue([
    { kind: 'image', bytes: Uint8Array.from([1, 2]), mimeType: 'image/png' },
    { kind: 'image', bytes: Uint8Array.from([3, 4]), mimeType: 'image/webp' },
  ])
  const legacyRead = vi.spyOn(f.host.tools, 'readObservationResource')
  const client = await f.connect('typed-preview-client')
  const reply = await client.callTool({ name: 'image.preview', arguments: { images: ['one', 'two'] } }) as unknown as ResidentToolReply
  expect(reply.isError).toBe(false)
  expect(reply.content.filter(item => item.type === 'image')).toEqual([
    { type: 'image', data: 'AQI=', mimeType: 'image/png' },
    { type: 'image', data: 'AwQ=', mimeType: 'image/webp' },
  ])
  expect(prepare).toHaveBeenCalledOnce()
  expect(prepare.mock.calls[0]![1]).toBe(result)
  expect(legacyRead).not.toHaveBeenCalled()
})

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
  for (const tool of builtin) expect(listed.find(item => item.name === tool.name)!.inputSchema).toEqual(tool.schema)
  // Selection, not passthrough: course editing tools need an opened course document first.
  expect((await f.host.tools.describe()).some(tool => tool.name === 'object.update')).toBe(true)
  expect(names).not.toContain('object.update')

  const read = await callTool(client, 'file.read', { path: 'notes.md' })
  expect(read.isError, JSON.stringify(read.structuredContent.result)).toBe(false)
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
  expect(JSON.stringify([conversation, timeline, await f.service.status()])).not.toContain("Authorization")
  // The current lifecycle treats only pending calls as work; an idle resident
  // connection stays available without holding an active-operation barrier.
  expect(f.service.activity()).toEqual([])
  expect((await f.service.status()).sessions).toHaveLength(1)

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
  const first = client.callTool({ name: 'file.write', arguments: args }, undefined, { signal: controller.signal })
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

it('reports an occupied port without starting, recovers on a new port, and disconnects every session when disabled', async () => {
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
  const disabled = await f.service.configure({ enabled: false })
  expect(disabled).toMatchObject({ state: 'disabled', sessions: [] })
  await expect(left.listTools()).rejects.toThrow()
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
  expect(stale.structuredContent.result).toMatchObject({ kind: 'error' })
  expect((await f.service.status()).sessions.every(session => !session.stopped)).toBe(true)
  expect((await callTool(codex, 'file.read', { path: 'notes.md' })).isError).toBe(false)
})


it('stays disabled until explicitly enabled and uses tokenless SDK initialization', async () => {
  const f = await fixture({ enabled: false })
  expect(await f.service.status()).toMatchObject({ state: 'disabled', settings: { enabled: false, permission: 'workspace' } })
  expect(f.service.server.listeningPort).toBeUndefined()
  await f.service.configure({ enabled: true })
  const client = await f.connect('no-bearer-client')
  expect((await callTool(client, 'file.read', { path: 'notes.md' })).isError).toBe(false)
})

it('changes the same live connection across all four permissions, including real full outside reads and writes', async () => {
  const f = await fixture({ permission: 'read-only' }), client = await f.connect('same-live-connection')
  const id = (await f.service.status()).sessions[0]!.sessionId
  expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain('file.write')
  await f.service.configureSession(id, 'ask')
  expect((await callTool(client, 'file.write', { mode: 'create', path: 'ask.md', content: 'ask' })).isError).toBe(false)
  expect(f.approvals.at(-1)?.reason).toBe('ask')
  await f.service.configureSession(id, 'workspace')
  f.approvals.length = 0
  expect((await callTool(client, 'file.write', { mode: 'create', path: 'workspace.md', content: 'workspace' })).isError).toBe(false)
  expect(f.approvals).toHaveLength(0)
  const outside = path.join(f.second, 'other.md')
  expect((await callTool(client, 'file.read', { path: outside })).isError).toBe(true)
  await f.service.configureSession(id, 'full')
  expect((await callTool(client, 'file.read', { path: outside })).isError).toBe(false)
  const opened = data(await callTool(client, 'file.open', { path: outside }))
  expect(opened.writable).toBe(true)
  expect((await callTool(client, 'file.write', { mode: 'create', path: path.join(f.second, 'full.txt'), content: 'full' })).isError).toBe(false)
  expect(await readFile(path.join(f.second, 'full.txt'), 'utf8')).toBe('full')
  expect(f.approvals).toHaveLength(0)
  f.ui.state = { workspaceId: 'second', activeDocumentId: opened.documentId }
  expect(data(await callTool(client, 'workspace.list')).current).toBe('space')
  expect(data(await callTool(client, 'workbench.state')).activeDocument).toMatchObject({ documentId: opened.documentId, writable: true })
  await f.service.configureSession(id, 'read-only')
  expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain('file.write')
  expect((await callTool(client, 'text.replace', { target: opened.target, content: 'stale handle' })).isError).toBe(true)
  expect((await f.service.status()).sessions).toMatchObject([{ sessionId: id, permission: 'read-only', stopped: false }])
})

it('shares exact host-bound outside reads with file and foreground state without granting a sibling', async () => {
  const f = await fixture()
  const outside = path.join(f.second, 'other.md'), sibling = path.join(f.second, 'sibling.md')
  await writeFile(sibling, 'private sibling')
  const doc = await f.host.internalAPI.open(outside)
  f.ui.state = { workspaceId: 'space', activeDocumentId: doc.documentId }
  const client = await f.connect('host-bound-file')
  expect((await callTool(client, 'file.read', { path: outside })).isError).toBe(false)
  expect((await callTool(client, 'file.read', { path: sibling })).isError).toBe(true)
  const state = data(await callTool(client, 'workbench.state'))
  expect(state.activeDocument).toMatchObject({ documentId: doc.documentId, writable: false })
  expect((await callTool(client, 'read', { target: state.activeDocument.target })).isError).toBe(false)
  const unbound = await f.host.internalAPI.open(sibling)
  f.ui.state = { workspaceId: 'second', activeDocumentId: unbound.documentId }
  expect(data(await callTool(client, 'workbench.state')).activeDocument).toBeNull()
  expect((await callTool(client, 'file.read', { path: sibling })).isError).toBe(true)
})

it.each(['full', 'read-only'] as const)('keeps an accepted file call frozen and revoked while changing the connection to %s', async nextPermission => {
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const arrived = new Promise<void>(resolve => { entered = resolve })
  let first = true
  const seen: string[] = []
  const f = await fixture({ permission: nextPermission === 'full' ? 'workspace' : 'full', files: files => ({
    execute: files.execute.bind(files), releaseRun: files.releaseRun.bind(files),
    preflightMutation: async (context, name, input) => {
      seen.push(context.permission)
      const result = await files.preflightMutation(context, name, input)
      if (first) { first = false; entered(); await gate }
      return result
    },
  }) })
  const client = await f.connect('frozen-inflight'), id = (await f.service.status()).sessions[0]!.sessionId
  const filename = path.join(f.second, `frozen-${nextPermission}.txt`)
  const old = callTool(client, 'file.write', { mode: 'create', path: filename, content: 'must not commit' })
  await arrived
  await f.service.configureSession(id, nextPermission)
  release()
  expect((await old).isError).toBe(true)
  expect(seen[0]).toBe(nextPermission === 'full' ? 'workspace' : 'full')
  await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(f.approvals).toHaveLength(0)
  if (nextPermission === 'full') {
    expect((await callTool(client, 'file.write', { mode: 'create', path: filename, content: 'new full operation' })).isError).toBe(false)
    expect(await readFile(filename, 'utf8')).toBe('new full operation')
  } else expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain('file.write')
})

it('executes a new identical operation in B and retries only the explicitly identified receipt from A', async () => {
  const f = await fixture(), client = await f.connect('scoped-retry')
  const input = { mode: 'create', path: 'scope.txt', content: 'same args' }
  const a = await callTool(client, 'file.write', input, 'same-ticket')
  expect(a.isError).toBe(false)
  expect(a.structuredContent.operationScope).toMatchObject({ workspaceId: 'space', workspaceRoot: f.workspace })
  await callTool(client, 'workspace.switch', { workspaceId: 'second' })
  const b = await callTool(client, 'file.write', input, 'same-ticket')
  expect(b.isError).toBe(false)
  expect(b.structuredContent.operationScope).toMatchObject({ workspaceId: 'second', workspaceRoot: f.second })
  expect(b.structuredContent.operationScope!.runId).not.toBe(a.structuredContent.operationScope!.runId)
  const retry = await client.callTool({ name: 'file.write', arguments: input,
    _meta: { 'guoling/ticket': a.structuredContent.ticket!, 'guoling/operation': { ...a.structuredContent.operationScope! } } }) as unknown as ResidentToolReply
  expect(retry.isError).toBe(false)
  expect(retry.structuredContent).toMatchObject({ replayed: true, operationScope: a.structuredContent.operationScope })
  expect(retry.structuredContent.result).toEqual(a.structuredContent.result)
  expect(await readFile(path.join(f.workspace, 'scope.txt'), 'utf8')).toBe('same args')
  expect(await readFile(path.join(f.second, 'scope.txt'), 'utf8')).toBe('same args')
  expect(data(await callTool(client, 'operation.recent')).operations.filter((item: { tool: string }) => item.tool === 'file.write')).toHaveLength(2)
})


it('uses registry effects for readonly delegation receipts instead of starting another job on retry', async () => {
  const f = await fixture(), client = await f.connect('readonly-job-retry')
  vi.spyOn(f.host.tools, 'resolveRunTool').mockImplementation(async (_run, name) => describeTools([name])[0] ?? null)
  const execute = vi.spyOn(f.host.tools, 'execute').mockResolvedValue({ kind: 'read', data: { job: 'original-delegation-job', status: 'running' } })
  const input = { goal: 'Read the supplied fixture', sources: ['notes.md'], budget: { maxOutputTokens: 1000, maxDurationMs: 30000 } }
  const first = await callTool(client, 'delegate.readonly', input, 'readonly-job')
  const again = await callTool(client, 'delegate.readonly', input, 'readonly-job')
  expect(first.isError).toBe(false)
  expect(again.structuredContent).toMatchObject({ replayed: true, result: first.structuredContent.result })
  expect(execute).toHaveBeenCalledOnce()
  expect(data(await callTool(client, 'operation.recent')).operations[0]).toMatchObject({ tool: 'delegate.readonly', ticket: 'readonly-job', status: 'pending' })
})


it('fetches resource-only images without an ask modification prompt while target application still asks', async () => {
  const f = await fixture({ permission: 'ask' }), client = await f.connect('resource-only-ask')
  vi.spyOn(f.host.tools, 'resolveRunTool').mockImplementation(async (_run, name) => describeTools([name])[0] ?? null)
  const execute = vi.spyOn(f.host.tools, 'execute').mockResolvedValue({ kind: 'read', data: { status: 'ready', resource: 'downloaded-original' } })
  const resource = await callTool(client, 'image.fetch', { image: 'approved-open-image' })
  expect(resource.isError).toBe(false)
  expect(f.approvals).toHaveLength(0)
  expect(resource.structuredContent.operationScope).toBeDefined()
  const applied = await callTool(client, 'image.fetch', { image: 'approved-open-image', path: '/current-page/image' })
  expect(applied.isError).toBe(false)
  expect(f.approvals).toMatchObject([{ reason: 'ask' }])
  expect(execute).toHaveBeenCalledTimes(2)
})
