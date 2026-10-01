// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
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
    const text = await h.files.execute(h.context, 'file.create', { name: 'notes.txt', kind: 'text' }, 'create-txt')
    expect(text.opened).toMatchObject({ writable: true, kind: 'text' })
    expect(await readFile(path.join(h.workspace, 'lesson', 'notes.txt'), 'utf8')).toBe('')
    expect(h.host.registry.get(text.opened!.documentId).read()).toMatchObject({ model: { kind: 'text', source: '' }, binding: { kind: 'file', path: path.join(h.workspace, 'lesson', 'notes.txt') } })
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
      preflightMutation: async () => ({ paths: [path.join(h.workspace, 'lesson', 'uncertain.md')], outside: false }),
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


it('M27 generic UTF-8 data/code and extensionless sources share one dirty document and save/reopen exact bytes', async () => {
  const h = await fixture()
  for (const name of ['data.json', 'table.csv', 'lesson.py', 'Dockerfile']) {
    const filename = path.join(h.workspace, 'lesson', name), source = '\ufeff# 原稿\r\n中文,1\r\n'
    await writeFile(filename, source)
    const result = await h.files.execute(h.context, 'file.open', { path: filename }, `open-${name}`)
    expect(result.opened).toMatchObject({ kind: 'text', writable: true })
    const snapshot = await h.host.internalAPI.read(result.opened!.documentId)
    const edited = source.replace('原稿', '已修改')
    expect(await h.host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: `edit-${name}`, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: edited } } })).toMatchObject({ status: 'applied' })
    expect((await h.files.execute(h.context, 'file.open', { path: filename }, `again-${name}`)).opened?.documentId).toBe(snapshot.documentId)
    expect((await h.host.internalAPI.read(snapshot.documentId))).toMatchObject({ dirty: true, undoDepth: 1, model: { source: edited } })
    expect(await readFile(filename, 'utf8')).toBe(source)
    await h.host.saveToPath(snapshot.documentId)
    await h.host.operate({ type: 'close', documentId: snapshot.documentId })
    expect((await h.host.open(filename)).model).toMatchObject({ kind: 'text', source: edited })
    expect(await readFile(filename)).toEqual(Buffer.from(edited, 'utf8'))
  }
  const created = await h.files.execute(h.context, 'file.create', { name: 'new-script.py', kind: 'text' }, 'create-code')
  expect(created.opened).toMatchObject({ kind: 'text' })
  expect(await readFile(path.join(h.workspace, 'lesson', 'new-script.py'), 'utf8')).toBe('')
})


it('M27 binary and structured files are not misrepresented as editable source', async () => {
  const h = await fixture()
  const binary = path.join(h.workspace, 'lesson', 'binary.dat'), document = path.join(h.workspace, 'lesson', 'report.pdf')
  await writeFile(binary, Buffer.from([65, 0, 66])); await writeFile(document, '%PDF-1.7\n')
  await expect(h.files.execute(h.context, 'file.open', { path: binary }, 'binary')).rejects.toMatchObject({ code: 'TEXT_ENCODING_UNSUPPORTED' })
  await expect(h.files.execute(h.context, 'file.open', { path: document }, 'pdf')).rejects.toThrow('相应的文档')
  expect(await readFile(binary)).toEqual(Buffer.from([65, 0, 66]))
  await expect(h.files.execute(h.context, 'file.create', { name: 'fake.pdf', kind: 'text' }, 'fake')).rejects.toThrow()
  await expect(h.files.execute(h.context, 'file.create', { name: 'wrong.md', kind: 'text' }, 'wrong')).rejects.toThrow('格式不符')
})

it('M27 file listing continues across all pages and rejects a changed-directory or foreign-run cursor', async () => {
  const h = await fixture(), folder = path.join(h.workspace, 'pages'); await mkdir(folder)
  for (let i = 0; i < 12; i++) await writeFile(path.join(folder, `file-${String(i).padStart(2, '0')}.txt`), '')
  const first = (await h.files.execute(h.context, 'file.list', { path: folder, limit: 5 }, 'page-one')).data as any
  const second = (await h.files.execute(h.context, 'file.list', { path: folder, limit: 5, cursor: first.nextCursor }, 'page-two')).data as any
  const last = (await h.files.execute(h.context, 'file.list', { path: folder, limit: 5, cursor: second.nextCursor }, 'page-three')).data as any
  expect([...first.entries, ...second.entries, ...last.entries].map(entry => entry.name))
    .toEqual(Array.from({ length: 12 }, (_, i) => `file-${String(i).padStart(2, '0')}.txt`))
  expect([first.truncated, second.truncated, last.truncated]).toEqual([true, true, false])
  expect([first.unscannedEntries, second.unscannedEntries, last.unscannedEntries]).toEqual([7, 2, 0])
  await expect(h.files.execute({ ...h.context, runId: 'different' }, 'file.list', { path: folder, cursor: first.nextCursor }, 'foreign')).rejects.toThrow('本次查询')
  await writeFile(path.join(folder, 'new.txt'), '')
  await expect(h.files.execute(h.context, 'file.list', { path: folder, cursor: first.nextCursor }, 'stale')).rejects.toThrow('目录内容已改变')
})

it('M27 filename search makes default exclusions visible and does not claim an unscanned dependency tree', async () => {
  const h = await fixture(), folder = path.join(h.workspace, 'filename-search')
  await mkdir(folder); await mkdir(path.join(folder, 'node_modules'))
  await writeFile(path.join(folder, 'match.txt'), '')
  await writeFile(path.join(folder, 'node_modules', 'match-inside.txt'), '')
  const result = (await h.files.execute(h.context, 'file.search', { path: folder, query: 'match' }, 'filename-exclusions')).data as any
  expect(result.matches).toEqual([path.join(folder, 'match.txt')])
  expect(result).toMatchObject({ truncated: false, excludedCount: 1, failedCount: 0,
    excluded: [{ path: path.join(folder, 'node_modules'), reason: '默认排除目录' }] })
})


it('M27 filename search preserves its position inside the last directory rather than losing remaining matches', async () => {
  const h = await fixture(), folder = path.join(h.workspace, 'search'); await mkdir(folder)
  for (let i = 0; i < 5; i++) await writeFile(path.join(folder, `hit-${i}.txt`), '')
  const all: string[] = []; let cursor: string | undefined
  do {
    const result = (await h.files.execute(h.context, 'file.search', { path: folder, query: 'hit', limit: 2, ...(cursor ? { cursor } : {}) }, `search-${all.length}`)).data as any
    all.push(...result.matches); cursor = result.nextCursor
    expect(result.truncated).toBe(Boolean(cursor))
  } while (cursor)
  expect(all).toEqual(Array.from({ length: 5 }, (_, i) => path.join(folder, `hit-${i}.txt`)))
  const first = (await h.files.execute(h.context, 'file.search', { path: folder, query: 'hit', limit: 2 }, 'again')).data as any
  await expect(h.files.execute(h.context, 'file.search', { path: folder, query: 'different', cursor: first.nextCursor }, 'wrong-query')).rejects.toThrow('本次查询')
})

it('M27 file read, versioned replace and unique patch preserve UTF-8 BOM, emoji and CRLF', async () => {
  const h = await fixture(), filename = path.join(h.workspace, 'lesson', 'source.py')
  const original = '\ufefflabel = "😀"\r\nvalue = 1\r\n'
  await writeFile(filename, original)
  const first = (await h.files.execute(h.context, 'file.read', { path: filename, limit: 11 }, 'read-1')).data as any
  expect(first).toMatchObject({ path: filename, version: expect.stringMatching(/^sha256:/), dirty: false, truncated: true })
  const second = (await h.files.execute(h.context, 'file.read', { path: filename, cursor: first.nextCursor, limit: 20 }, 'read-2')).data as any
  expect(first.text + second.text).toBe(original)
  const patch = (await h.files.execute(h.context, 'file.patch', { path: filename, expectedVersion: first.version,
    oldText: 'value = 1', newText: 'value = 2' }, 'patch-1')).data as any
  expect(patch).toMatchObject({ status: 'written', saved: true, beforeVersion: first.version, afterVersion: expect.stringMatching(/^sha256:/) })
  expect(await readFile(filename)).toEqual(Buffer.from(original.replace('value = 1', 'value = 2'), 'utf8'))
  await expect(h.files.execute(h.context, 'file.patch', { path: filename, expectedVersion: first.version,
    oldText: 'value = 2', newText: 'value = 3' }, 'stale')).rejects.toThrow('版本已改变')
  await writeFile(filename, 'same\nsame\n')
  const repeated = (await h.files.execute(h.context, 'file.read', { path: filename }, 'repeat-read')).data as any
  await expect(h.files.execute(h.context, 'file.patch', { path: filename, expectedVersion: repeated.version,
    oldText: 'same', newText: 'other' }, 'ambiguous')).rejects.toThrow('匹配多处')
  const ranged = (await h.files.execute(h.context, 'file.patch', { path: filename, expectedVersion: repeated.version,
    oldText: 'same', newText: 'other', range: { from: 5, to: 9 } }, 'ranged')).data as any
  expect(ranged.status).toBe('written')
  expect(await readFile(filename, 'utf8')).toBe('same\nother\n')
  const created = (await h.files.execute(h.context, 'file.write', { mode: 'create', path: 'lesson/new.json', content: '{"ok":true}\n' }, 'write-create')).data as any
  expect(created.operation.status).toBe('success')
  expect(await readFile(path.join(h.workspace, 'lesson', 'new.json'), 'utf8')).toBe('{"ok":true}\n')
  await expect(h.files.execute(h.context, 'file.write', { mode: 'create', path: 'lesson/new.json', content: 'overwrite' }, 'duplicate'))
    .resolves.toMatchObject({ data: { operation: { status: 'failed' } } })
})

it('M27 an opened dirty file stays under DocumentSession and selected targets do not widen', async () => {
  const h = await fixture(), filename = path.join(h.workspace, 'lesson', 'existing.md')
  const snapshot = await h.host.open(filename)
  await h.host.tools.beginRun({ runId: h.context.runId, actor: 'agent', documents: [{ documentId: snapshot.documentId,
    writable: [{ kind: 'document' }] }] })
  expect(await h.host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: 'human-first', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: '未保存正文' } } }))
    .toMatchObject({ status: 'applied' })
  const read = (await h.files.execute(h.context, 'file.read', { path: filename }, 'dirty-read')).data as any
  expect(read).toMatchObject({ text: '未保存正文', dirty: true, version: expect.stringMatching(/^document:/) })
  const patched = (await h.files.execute(h.context, 'file.patch', { path: filename, expectedVersion: read.version,
    oldText: '正文', newText: '内容' }, 'dirty-patch')).data as any
  expect(patched).toMatchObject({ status: 'applied', saved: false, dirty: true })
  expect((await h.host.internalAPI.read(snapshot.documentId))).toMatchObject({ model: { source: '未保存内容' }, dirty: true, undoDepth: 2 })
  expect(await readFile(filename, 'utf8')).toBe('正文')
  const next = await h.host.internalAPI.read(snapshot.documentId)
  expect(await h.host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: next.epoch, baseRevision: next.revision,
    operationId: 'undo-patch', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect((await h.host.internalAPI.read(snapshot.documentId)).model).toMatchObject({ source: '未保存正文' })
  const narrow = await fixture(), narrowPath = path.join(narrow.workspace, 'lesson', 'existing.md')
  const narrowSnapshot = await narrow.host.open(narrowPath)
  await narrow.host.tools.beginRun({ runId: narrow.context.runId, actor: 'agent', documents: [{ documentId: narrowSnapshot.documentId,
    writable: [{ kind: 'markdown-range', from: 0, to: 1 }] }] })
  const narrowRead = (await narrow.files.execute(narrow.context, 'file.read', { path: narrowPath }, 'narrow-read')).data as any
  await expect(narrow.files.execute(narrow.context, 'file.write', { mode: 'replace', path: narrowPath,
    expectedVersion: narrowRead.version, content: '越权整篇' }, 'narrow-write')).rejects.toThrow()
  expect((await narrow.host.internalAPI.read(narrowSnapshot.documentId)).model).toMatchObject({ source: '正文' })
})

it('M27 grep resumes inside a file and across folders, with explicit exclusions', async () => {
  const h = await fixture(), folder = path.join(h.workspace, 'sources')
  await mkdir(folder); await mkdir(path.join(folder, 'node_modules'))
  for (let i = 0; i < 12; i++) await writeFile(path.join(folder, `part-${String(i).padStart(2, '0')}.txt`), `中文 needle ${i}\n`)
  await writeFile(path.join(folder, 'node_modules', 'ignored.txt'), 'needle')
  const matches: string[] = []; let cursor: string | undefined; let excluded = 0
  do {
    const page = (await h.files.execute(h.context, 'file.grep', { path: folder, query: 'needle', limit: 5,
      ...(cursor ? { cursor } : {}) }, `grep-${matches.length}`)).data as any
    matches.push(...page.matches.map((match: any) => match.path))
    excluded = page.excludedCount
    cursor = page.nextCursor
  } while (cursor)
  expect(matches).toHaveLength(12)
  expect(new Set(matches).size).toBe(12)
  expect(excluded).toBeGreaterThan(0)
  const first = (await h.files.execute(h.context, 'file.grep', { path: folder, query: 'needle', limit: 1 }, 'grep-stale-first')).data as any
  await writeFile(path.join(folder, 'new.txt'), 'needle')
  await expect(h.files.execute(h.context, 'file.grep', { path: folder, query: 'needle', limit: 1,
    cursor: first.nextCursor }, 'grep-stale-second')).rejects.toThrow('目录内容已改变')
})

it('M27 grep cursor keeps exact line positions inside one long file', async () => {
  const h = await fixture(), filename = path.join(h.workspace, 'lesson', 'many.txt')
  await writeFile(filename, Array.from({ length: 12 }, (_, i) => `行${i} needle`).join('\r\n'))
  const hits: Array<{ line: number; column: number }> = []; let cursor: string | undefined
  do {
    const page = (await h.files.execute(h.context, 'file.grep', { path: filename, query: 'needle', limit: 5,
      ...(cursor ? { cursor } : {}) }, `grep-file-${hits.length}`)).data as any
    hits.push(...page.matches.map(({ line, column }: { line: number; column: number }) => ({ line, column })))
    cursor = page.nextCursor
  } while (cursor)
  expect(hits).toEqual(Array.from({ length: 12 }, (_, i) => ({ line: i + 1, column: i < 10 ? 4 : 5 })))
})

it('M27 file organization reports per-item partials and external read grants stay read-only', async () => {
  const h = await fixture(), readGrant = { ...h.context, readOnlyRoots: [h.outside] }
  expect((await h.files.execute(readGrant, 'file.read', { path: path.join(h.outside, 'external.md') }, 'outside-read')).data)
    .toMatchObject({ text: '外部' })
  expect((await h.files.execute(readGrant, 'file.open', { path: path.join(h.outside, 'external.md') }, 'outside-open')).opened)
    .toMatchObject({ writable: false })
  const externalVersion = (await h.files.execute(readGrant, 'file.read', { path: path.join(h.outside, 'external.md') }, 'outside-version')).data as any
  await expect(h.files.execute(readGrant, 'file.write', { mode: 'replace', path: path.join(h.outside, 'external.md'),
    expectedVersion: externalVersion.version, content: '越权' }, 'outside-write')).rejects.toThrow('明确批准')
  expect(await readFile(path.join(h.outside, 'external.md'), 'utf8')).toBe('外部')
  expect((await h.files.execute(h.context, 'file.mkdir', { path: 'lesson', name: 'sub' }, 'mkdir')).data)
    .toMatchObject({ operation: { status: 'success' } })
  await writeFile(path.join(h.workspace, 'lesson', 'a.txt'), 'a')
  await writeFile(path.join(h.workspace, 'lesson', 'b.txt'), 'b')
  await writeFile(path.join(h.workspace, 'lesson', 'sub', 'b.txt'), 'collision')
  const copy = (await h.files.execute(h.context, 'file.copy', { sources: ['lesson/a.txt', 'lesson/b.txt'],
    destination: 'lesson/sub' }, 'copy')).data as any
  expect(copy.operation).toMatchObject({ status: 'partial', items: [{ status: 'success' }, { status: 'failed' }] })
  expect(await readFile(path.join(h.workspace, 'lesson', 'sub', 'a.txt'), 'utf8')).toBe('a')
  expect(await readFile(path.join(h.workspace, 'lesson', 'sub', 'b.txt'), 'utf8')).toBe('collision')
  expect((await h.files.execute(h.context, 'file.rename', { path: 'lesson/sub/a.txt', name: 'renamed.txt' }, 'rename')).data)
    .toMatchObject({ operation: { status: 'success' } })
  expect((await h.files.execute(h.context, 'file.move', { sources: ['lesson/sub/renamed.txt'], destination: 'lesson' }, 'move')).data)
    .toMatchObject({ operation: { status: 'success' } })
  expect(await readFile(path.join(h.workspace, 'lesson', 'renamed.txt'), 'utf8')).toBe('a')
})

it('M27 a continued run uses file.read as the exact source observation before a scoped patch', async () => {
  const h = await fixture(), filename = path.join(h.workspace, 'lesson', 'existing.md')
  const snapshot = await h.host.open(filename)
  await h.host.tools.beginRun({ runId: h.context.runId, actor: 'agent', documents: [{ documentId: snapshot.documentId,
    writable: [{ kind: 'document' }] }] })
  h.host.tools.requireReadObservation(h.context.runId)
  const version = `document:${snapshot.documentId}:${snapshot.epoch}:${snapshot.revision}`
  await expect(h.files.execute(h.context, 'file.patch', { path: filename, expectedVersion: version,
    oldText: '正', newText: '新', range: { from: 0, to: 1 } }, 'without-observation')).rejects.toThrow('继续修改前需读取')
  expect((await h.files.execute(h.context, 'file.read', { path: filename, limit: 1 }, 'observed')).data)
    .toMatchObject({ text: '正', truncated: true })
  expect((await h.files.execute(h.context, 'file.patch', { path: filename, expectedVersion: version,
    oldText: '正', newText: '新', range: { from: 0, to: 1 } }, 'after-observation')).data)
    .toMatchObject({ status: 'applied', saved: false })
  expect((await h.host.internalAPI.read(snapshot.documentId)).model).toMatchObject({ source: '新文' })
})

it('M27 stop before final file replacement leaves original bytes and no temp file', async () => {
  const h = await fixture(), filename = path.join(h.workspace, 'lesson', 'plain.txt')
  await writeFile(filename, 'before')
  const version = ((await h.files.execute(h.context, 'file.read', { path: filename }, 'read')).data as any).version
  const stopped = { ...h.context, assertActive: () => { throw new Error('任务已停止') } }
  await expect(h.files.execute(stopped, 'file.write', { mode: 'replace', path: filename,
    expectedVersion: version, content: 'after' }, 'stopped-write')).rejects.toThrow('任务已停止')
  expect(await readFile(filename, 'utf8')).toBe('before')
  expect((await readdir(path.dirname(filename))).some(name => name.endsWith('.tmp'))).toBe(false)
})

it('M27 rename preserves an opened dirty document binding; trash uses the host recycle callback', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-files-organize-')); cleanup.push(root)
  const workspace = path.join(root, 'workspace'), trash = path.join(root, 'trash')
  await mkdir(workspace); await mkdir(trash)
  const oldPath = path.join(workspace, 'draft.md'), newPath = path.join(workspace, 'renamed.md')
  await writeFile(oldPath, 'disk')
  const host = new DocumentHostService(path.join(root, 'journal'), { trashItem: async source => rename(source, path.join(trash, path.basename(source))) })
  const files = new AgentFileService(host), context: AgentFileContext = { runId: 'organize', workspaceRoot: workspace, permission: 'workspace' }
  const snapshot = await host.open(oldPath)
  expect(await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: 'edit', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'dirty' } } }))
    .toMatchObject({ status: 'applied' })
  expect((await files.execute(context, 'file.rename', { path: oldPath, name: 'renamed.md' }, 'rename-dirty')).data)
    .toMatchObject({ operation: { status: 'success' } })
  expect((await host.internalAPI.read(snapshot.documentId))).toMatchObject({ binding: { kind: 'file', path: newPath }, dirty: true, model: { source: 'dirty' } })
  await host.saveToPath(snapshot.documentId)
  expect(await readFile(newPath, 'utf8')).toBe('dirty')
  expect((await files.execute(context, 'file.trash', { paths: [newPath] }, 'trash-dirty')).data)
    .toMatchObject({ operation: { status: 'success' } })
  expect(await readFile(path.join(trash, 'renamed.md'), 'utf8')).toBe('dirty')
  expect((await host.internalAPI.read(snapshot.documentId)).binding).toMatchObject({ kind: 'untitled' })
})

it('accepts a large read-page request without invalid-arguments failure and preserves a real continuation cursor', async () => {
  const h = await fixture(), filename = path.join(h.workspace, 'lesson', 'large.md')
  await writeFile(filename, 'x'.repeat(70_000))
  const snapshot = await h.host.open(filename)
  await h.host.tools.beginRun({ runId: 'paged', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [] }] })
  const target = await h.host.tools.issueTarget('paged', snapshot.documentId, { kind: 'document' }, { readOnly: true })
  const first = await h.host.tools.execute('paged', 'large-read', { name: 'read', input: { target, limit: 5000 } })
  expect(first).toMatchObject({ kind: 'read', data: { text: 'x'.repeat(64_000), truncated: true } })
  if (first.kind !== 'read') throw new Error('read failed')
  expect(await h.host.tools.execute('paged', 'next', { name: 'read', input: { target, cursor: first.nextCursor, limit: 5000 } }))
    .toMatchObject({ kind: 'read', data: { text: 'x'.repeat(6000), truncated: false } })
  await h.host.tools.stop('paged')
})
