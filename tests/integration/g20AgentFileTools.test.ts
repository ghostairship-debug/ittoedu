// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { AgentFileOutcomeUnknown, type AgentFileContext, type AgentFileService as AgentFilePort } from '../../src/core/tools/AgentFileTools'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ModelEvent, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'
import { fileCreated, serviceToolOutcome } from '../../src/main/workbench/execution/executionOutcome'

const cleanup: string[] = []
afterEach(async () => { for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-files-')); cleanup.push(root)
  const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
  await mkdir(workspace); await mkdir(outside)
  await mkdir(path.join(workspace, 'lesson'))
  await writeFile(path.join(workspace, 'lesson', 'existing.md'), '正文')
  await writeFile(path.join(outside, 'external.md'), '外部')
  const host = new DocumentHostService(path.join(root, 'journal'))
  const files = new AgentFileService(host)
  const context: AgentFileContext = { runId: 'run', workspaceRoot: workspace, conversationHome: { kind: 'file', path: 'lesson/existing.md' }, permission: 'workspace' }
  return { root, workspace, outside, host, files, context }
}

describe('general agent file tools', () => {
  it('lists from file home, creates beside it through FileService, and opens formal DocumentSession', async () => {
    const h = await fixture()
    const listed = await h.files.execute(h.context, 'file.list', {}, 'list')
    expect(listed.data).toMatchObject({ entries: [{ name: 'existing.md', kind: 'file' }] })
    const created = await h.files.execute(h.context, 'file.create', { name: 'new.md' }, 'create-1')
    expect(created.data).toMatchObject({ operation: { status: 'success' }, homeMissingFallback: false })
    expect(created.opened).toMatchObject({ writable: true, kind: 'markdown' })
    expect(await readFile(path.join(h.workspace, 'lesson', 'new.md'), 'utf8')).toBe('')
    expect(h.host.registry.get(created.opened!.documentId).read().binding).toMatchObject({ kind: 'file', path: path.join(h.workspace, 'lesson', 'new.md') })
  })

  it('confines workspace permission, permits outside only at full level, and never writes at read-only', async () => {
    const h = await fixture()
    await expect(h.files.execute(h.context, 'file.open', { path: path.join(h.outside, 'external.md') }, 'open-1')).rejects.toThrow('工作空间外')
    await expect(h.files.execute(h.context, 'file.create', { path: h.outside, name: 'new.md' }, 'create-1')).rejects.toThrow('工作空间外')
    const full = { ...h.context, permission: 'full' as const }
    expect((await h.files.execute(full, 'file.open', { path: path.join(h.outside, 'external.md') }, 'open-2')).opened).toMatchObject({ writable: true })
    expect((await h.files.execute(full, 'file.create', { path: h.outside, name: 'new.md' }, 'create-2')).opened).toMatchObject({ writable: true })
    const readonly = { ...h.context, permission: 'read-only' as const }
    expect((await h.files.execute(readonly, 'file.open', { path: 'lesson/existing.md' }, 'open-3')).opened).toMatchObject({ writable: false })
    await expect(h.files.execute(readonly, 'file.create', { name: 'blocked.md' }, 'create-3')).rejects.toThrow('只读')
  })
  it('keeps list/search inside the workspace except at full level, while read-only can inspect inside', async () => {
    const h = await fixture()
    await expect(h.files.execute(h.context, 'file.list', { path: h.outside }, 'outside-list')).rejects.toThrow('工作空间外')
    await expect(h.files.execute(h.context, 'file.search', { path: h.outside, query: 'external' }, 'outside-search')).rejects.toThrow('工作空间外')
    const full = { ...h.context, permission: 'full' as const }
    expect((await h.files.execute(full, 'file.list', { path: h.outside }, 'full-list')).data).toMatchObject({ entries: [{ name: 'external.md', kind: 'file' }] })
    expect((await h.files.execute(full, 'file.search', { path: h.outside, query: 'external' }, 'full-search')).data).toMatchObject({ matches: [path.join(h.outside, 'external.md')] })
    const readonly = { ...h.context, permission: 'read-only' as const }
    expect((await h.files.execute(readonly, 'file.list', { path: 'lesson' }, 'readonly-list')).data).toMatchObject({ entries: [{ name: 'existing.md', kind: 'file' }] })
    expect((await h.files.execute(readonly, 'file.search', { path: 'lesson', query: 'existing' }, 'readonly-search')).data).toMatchObject({ matches: [path.join(h.workspace, 'lesson', 'existing.md')] })
  })

  it('falls back to workspace root if home folder was deleted', async () => {
    const h = await fixture()
    const context = { ...h.context, conversationHome: { kind: 'folder' as const, path: 'removed', missing: true as const } }
    const created = await h.files.execute(context, 'file.create', { name: 'fallback.md' }, 'create-fallback')
    expect(created.data).toMatchObject({ homeMissingFallback: true })
    expect(created.opened?.name).toBe(path.join(h.workspace, 'fallback.md'))
  })
  it('does not widen an existing selection grant when the same file is opened again', async () => {
    const h = await fixture()
    const snapshot = await h.host.open(path.join(h.workspace, 'lesson', 'existing.md'))
    await h.host.tools.beginRun({ runId: 'selection-run', actor: 'agent', documents: [{ documentId: snapshot.documentId,
      writable: [{ kind: 'markdown-range', from: 0, to: 1 }] }] })
    expect(await h.host.tools.attachRunDocument('selection-run', snapshot.documentId, true)).toBe(false)
    const whole = await h.host.tools.issueTarget('selection-run', snapshot.documentId, { kind: 'document' })
    const outside = await h.host.tools.issueTarget('selection-run', snapshot.documentId, { kind: 'markdown-range', from: 0, to: 2 })
    expect((await h.host.tools.execute('selection-run', 'whole-edit', { name: 'text.replace', input: { target: whole, content: '越权' } })).kind).toBe('error')
    expect((await h.host.tools.execute('selection-run', 'outside-edit', { name: 'text.replace', input: { target: outside, content: '越权' } })).kind).toBe('error')
    expect(h.host.registry.get(snapshot.documentId).read().model).toMatchObject({ source: '正文' })
  })
  it('uses a separate frozen home root and requires a one-call grant for an outside default create', async () => {
    const h = await fixture()
    await mkdir(path.join(h.outside, 'lesson'))
    const moved = { ...h.context, conversationHomeRoot: h.outside }
    const preflight = await h.files.preflightCreate(moved, { name: 'moved.md' })
    expect(preflight).toMatchObject({ directory: path.join(h.outside, 'lesson'), outside: true })
    await expect(h.files.execute(moved, 'file.create', { name: 'moved.md' }, 'unapproved')).rejects.toThrow('明确批准')
    const result = await h.files.execute({ ...moved, approvedOutsideDirectory: preflight.directory }, 'file.create', { name: 'moved.md' }, 'approved')
    expect(result.opened?.name).toBe(path.join(h.outside, 'lesson', 'moved.md'))
  })
  it('settles failed and successful file receipts as side effects, not generic reads', () => {
    const failed = { kind: 'read' as const, data: { operation: { operationId: 'create-1', status: 'failed', items: [{ error: { message: '同名文件已存在' } }] } } }
    const success = { kind: 'read' as const, data: { operation: { operationId: 'create-2', status: 'success', items: [{ status: 'success' }] } } }
    expect(serviceToolOutcome('file.create', failed)).toMatchObject({ status: 'failed', message: '同名文件已存在' })
    expect(fileCreated('file.create', failed)).toBe(false)
    expect(fileCreated('file.create', success)).toBe(true)
  })
  it('never replays an unresolved file create under a second call ID', async () => {
    const h = await fixture()
    let dispatches = 0, turn = 0
    const files: AgentFilePort = { preflightCreate: async () => ({ directory: path.join(h.workspace, 'lesson'), outside: false }),
      execute: async () => { dispatches++; throw new AgentFileOutcomeUnknown('ACK 丢失') } }
    const provider: ModelProvider = { async *stream(request) {
      turn++
      const calls = turn <= 2 ? [{ id: `create-${turn}`, type: 'function' as const, function: { name: 'file.create', arguments: JSON.stringify({ name: 'uncertain.md' }) } }] : []
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `r${turn}`, actualModel: 'fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
        toolCalls: calls.map(call => ({ id: call.id, name: call.function.name, argumentsText: call.function.arguments })), assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls } : {}) } }
    } }
    const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider, files,
      runs: new ExecutionRunStore(path.join(h.root, 'unknown-runs')), events: new ExecutionEventStore({ directory: path.join(h.root, 'unknown-events') }) })
    const started = await engine.start({ conversationId: 'c', taskId: 'unknown', instruction: '新建', documents: [], workspaceRoot: h.workspace,
      selection: { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
        auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
    const result = await engine.wait(started.runId)
    expect(dispatches).toBe(1)
    expect(result.tools.map(tool => tool.result?.kind === 'error' ? tool.result.code : tool.result?.kind)).toEqual(['file-create-outcome-unknown', 'unresolved-prior-tool'])
    expect(result.status).toBe('partial')
  })
  it('reports partial completion if a committed new file is followed by a model failure', async () => {
    const h = await fixture()
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      if (++turn > 1) throw new Error('模型后续失败')
      const call = { id: 'create', type: 'function' as const, function: { name: 'file.create', arguments: JSON.stringify({ name: 'kept.md' }) } }
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'r1', actualModel: 'fixture', nativeResponse: {}, finishReason: 'tool_calls',
        toolCalls: [{ id: call.id, name: call.function.name, argumentsText: call.function.arguments }], assistant: { role: 'assistant', content: '', tool_calls: [call] } }
    } }
    const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider, files: h.files,
      runs: new ExecutionRunStore(path.join(h.root, 'partial-runs')), events: new ExecutionEventStore({ directory: path.join(h.root, 'partial-events') }) })
    const started = await engine.start({ conversationId: 'c', taskId: 'partial', instruction: '新建', documents: [], workspaceRoot: h.workspace,
      conversationHome: h.context.conversationHome, selection: { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
        auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
    const result = await engine.wait(started.runId)
    expect(result.status).toBe('partial')
    expect(fileCreated('file.create', result.tools[0]?.result)).toBe(true)
    expect(await readFile(path.join(h.workspace, 'lesson', 'kept.md'), 'utf8')).toBe('')
  })
  it('opens a file during a document-free run and receives a live Gateway write handle on the next turn', async () => {
    const h = await fixture()
    let turn = 0
    const complete = (request: ModelRequest, name?: string, input?: object): Extract<ModelEvent, { type: 'response.completed' }> => {
      const calls = name ? [{ id: `call-${turn}`, type: 'function' as const, function: { name, arguments: JSON.stringify(input) } }] : []
      return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${turn}`, actualModel: 'fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
        toolCalls: calls.map(call => ({ id: call.id, name: call.function.name, argumentsText: call.function.arguments })), assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls } : {}) } }
    }
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) {
        expect(request.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(['file.list', 'file.search', 'file.open', 'file.create']))
        yield complete(request, 'file.open', { path: 'lesson/existing.md' }); return
      }
      if (turn === 2) {
        expect(request.tools?.some(tool => tool.name === 'text.replace')).toBe(true)
        const prior = [...request.messages].reverse().find(message => message.role === 'tool')
        const target = JSON.parse(String(prior?.content)).data.markdown.writableTarget as string
        yield complete(request, 'text.replace', { target, content: '改写正文' }); return
      }
      yield complete(request)
    } }
    const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider, files: h.files,
      runs: new ExecutionRunStore(path.join(h.root, 'runs')), events: new ExecutionEventStore({ directory: path.join(h.root, 'events') }) })
    const started = await engine.start({ conversationId: 'conversation', taskId: 'task', instruction: '打开并修改文件',
      documents: [], workspaceRoot: h.workspace, conversationHome: h.context.conversationHome,
      selection: { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
        accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
    const result = await engine.wait(started.runId)
    expect(result.status, JSON.stringify(result.tools.map(tool => tool.result))).toBe('completed')
    expect(result.tools.map(tool => tool.result?.kind)).toEqual(['read', 'document-operation'])
    expect(h.host.registry.list().some(snapshot => snapshot.model.kind === 'markdown' && snapshot.model.source === '改写正文')).toBe(true)
  })
  it('discovers course tool families after file.open adds a V9 document to a live run', async () => {
    const h = await fixture()
    await h.files.execute(h.context, 'file.create', { name: 'course.h5lesson', kind: 'course-v9' }, 'course-fixture')
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) {
        expect(request.tools?.map(tool => tool.name)).not.toContain('tools.load')
        const call = { id: 'open-course', type: 'function' as const, function: { name: 'file.open', arguments: JSON.stringify({ path: 'lesson/course.h5lesson' }) } }
        yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'r1', actualModel: 'fixture', nativeResponse: {}, finishReason: 'tool_calls',
          toolCalls: [{ id: call.id, name: call.function.name, argumentsText: call.function.arguments }], assistant: { role: 'assistant', content: '', tool_calls: [call] } } as Extract<ModelEvent, { type: 'response.completed' }>
        return
      }
      expect(request.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(['tools.load', 'file.open', 'read']))
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'r2', actualModel: 'fixture', nativeResponse: {}, finishReason: 'stop', toolCalls: [], assistant: { role: 'assistant', content: '已打开' } } as Extract<ModelEvent, { type: 'response.completed' }>
    } }
    const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider, files: h.files,
      runs: new ExecutionRunStore(path.join(h.root, 'course-runs')), events: new ExecutionEventStore({ directory: path.join(h.root, 'course-events') }) })
    const started = await engine.start({ conversationId: 'c', taskId: 'course', instruction: '打开课件', documents: [], workspaceRoot: h.workspace,
      selection: { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
        auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
    expect((await engine.wait(started.runId)).status).toBe('completed')
  })
  it.each(['ask', 'workspace'] as const)('waits for explicit approval before creating a file in %s mode', async permission => {
    const h = await fixture()
    const targetDirectory = permission === 'workspace' ? h.outside : path.join(h.workspace, 'lesson')
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      const calls = turn === 1 ? [{ id: 'create', type: 'function' as const, function: { name: 'file.create', arguments: JSON.stringify({ name: 'approved.md', ...(permission === 'workspace' ? { path: targetDirectory } : {}) }) } }] : []
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `r${turn}`, actualModel: 'fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
        toolCalls: calls.map(call => ({ id: call.id, name: call.function.name, argumentsText: call.function.arguments })), assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls } : {}) } }
    } }
    const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider, files: h.files,
      runs: new ExecutionRunStore(path.join(h.root, 'ask-runs')), events: new ExecutionEventStore({ directory: path.join(h.root, 'ask-events') }) })
    let resolveApproval!: (value: { runId: string; callId: string }) => void
    const pending = new Promise<{ runId: string; callId: string }>(resolve => { resolveApproval = resolve })
    engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'approval') resolveApproval({ runId: event.runId, callId: event.itemId }) })
    const started = await engine.start({ conversationId: 'c', taskId: 't', instruction: '新建', documents: [], permission, workspaceRoot: h.workspace,
      conversationHome: h.context.conversationHome, selection: { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
        auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
    const approval = await pending
    expect(approval.runId).toBe(started.runId)
    await expect(stat(path.join(targetDirectory, 'approved.md'))).rejects.toThrow()
    await engine.decide({ ...approval, decision: permission === 'workspace' ? 'allow-all' : 'allow' })
    expect((await engine.wait(started.runId)).status).toBe('completed')
    expect(await readFile(path.join(targetDirectory, 'approved.md'), 'utf8')).toBe('')
  })
})
