// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { resolveSaveDestination } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { DocumentSaveFailure } from '../../src/shared/workbench/documentSave'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ModelToolCall } from '../../src/shared/workbench/tools'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
  protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unsupported', stream: 'supported', reasoning: 'unknown' } } }

function response(request: ModelRequest, call?: ModelToolCall): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = call ? [{ id: request.requestId, name: call.name, argumentsText: JSON.stringify(call.input) }] : []
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'fixture',
    nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: call ? '' : '本轮结果已按工具回执确认。',
      ...(call ? { tool_calls: calls.map(value => ({ id: value.id, type: 'function' as const,
        function: { name: value.name, arguments: value.argumentsText } })) } : {}) } }
}
function lastData(request: ModelRequest): Record<string, any> {
  return JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content)).data
}
async function fixture(step: (request: ModelRequest, turn: number) => Promise<ModelToolCall | undefined> | ModelToolCall | undefined) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-ai-course-save-'))
  cleanups.push(async () => {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 })
  })
  const workspace = path.join(directory, 'workspace'), journal = path.join(directory, 'documents')
  await mkdir(workspace)
  const host = new DocumentHostService(journal)
  const deliveries = new DocumentDeliveryService({
    documents: { read: id => host.registry.get(id).drain(), saveWithFact: (...args) => host.saveWithFact(...args),
      lookupSave: (...args) => host.lookupSave(...args),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'deliveries')),
    authorize: async () => {},
    resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, id => host.tools.runFileAccess(id)),
    resolveExportDestination: async () => { throw new Error('No export requested') },
    build: { build: async () => { throw new Error('No export requested') } },
    writer: { writeNew: async () => { throw new Error('No export requested') }, inspect: async () => null },
  })
  host.tools.configureHostServices({ deliveries })
  let turn = 0
  const provider: ModelProvider = { async *stream(request) { yield response(request, await step(request, ++turn)) } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  cleanups.push(() => engine.shutdown())
  const run = async (instruction = '新建并生成演示') => {
    const started = await engine.start({ conversationId: randomUUID(), taskId: randomUUID(), instruction,
      documents: [], workspaceRoot: workspace, permission: 'workspace', selection })
    return engine.wait(started.runId)
  }
  const disk = async (name = '演示.glx') => openCourseProjectV10Archive(await readFile(path.join(workspace, name)))
  return { directory, workspace, journal, host, engine, run, disk }
}

it('saves a new GLX once when initial generation ends and leaves later-run edits unsaved', async () => {
  let target = '', documentId = ''
  const h = await fixture(async (request, turn) => {
    if (turn === 1) return { name: 'file.create', input: { name: '演示', kind: 'course-v10' } }
    if (turn === 2) {
      target = lastData(request).target; documentId = lastData(request).documentId
      expect((await h.disk()).project.title).toBe('演示')
      return { name: 'project.read', input: { project: target, path: 'project.json' } }
    }
    if (turn === 3) return { name: 'project.apply', input: { project: target, path: 'project.json', content: JSON.stringify({ title: '生成中的框架' }) } }
    if (turn === 4) {
      expect((await h.disk()).project.title).toBe('演示')
      return { name: 'project.read', input: { project: target, path: 'project.json' } }
    }
    if (turn === 5) return { name: 'project.apply', input: { project: target, path: 'project.json', content: JSON.stringify({ title: 'AI 已生成的演示内容' }) } }
    if (turn === 6) { expect((await h.disk()).project.title).toBe('演示'); return }
    if (turn === 7) return { name: 'file.open', input: { path: '演示.glx' } }
    if (turn === 8) { target = lastData(request).target; return { name: 'project.read', input: { project: target, path: 'project.json' } } }
    if (turn === 9) return { name: 'project.apply', input: { project: target, path: 'project.json', content: JSON.stringify({ title: '后续未保存编辑' }) } }
  })
  const result = await h.run()
  expect(result.status).toBe('completed')
  expect(result.tools.filter(tool => tool.origin === 'host')).toMatchObject([{ call: { name: 'task.delivery', input: { target } },
    result: { kind: 'read', data: { status: 'saved', documentId, savedRevision: 2, dirty: false } } }])
  expect((await h.disk()).project.title).toBe('AI 已生成的演示内容')
  expect(h.host.registry.get(documentId).read()).toMatchObject({ dirty: false, revision: 2, undoDepth: 2 })
  const reopened = await new DocumentHostService(path.join(h.directory, 'independent-open')).open(path.join(h.workspace, '演示.glx'))
  expect(reopened).toMatchObject({ dirty: false, model: { kind: 'course-v10', project: { title: 'AI 已生成的演示内容' } } })
  const edited = await h.run('修改已有演示，暂不保存')
  expect(edited.status).toBe('completed')
  expect(edited.tools.some(tool => tool.call.name === 'task.delivery' || tool.call.name === 'file.save')).toBe(false)
  expect(h.host.registry.get(documentId).read()).toMatchObject({ dirty: true, revision: 3, undoDepth: 3,
    model: { project: { title: '后续未保存编辑' } } })
  expect((await h.disk()).project.title).toBe('AI 已生成的演示内容')
})

it('saves the created course target after opening other files, leaving an existing course edit unsaved', async () => {
  let first = '', firstId = '', second = '', secondId = ''
  const h = await fixture(async (request, turn) => {
    if (turn === 1) return { name: 'file.create', input: { name: '演示.glx' } }
    if (turn === 2) {
      first = lastData(request).target; firstId = lastData(request).documentId
      return { name: 'file.open', input: { path: '其他演示.glx' } }
    }
    if (turn === 3) { second = lastData(request).target; secondId = lastData(request).documentId; return { name: 'file.open', input: { path: '教学策划.md' } } }
    if (turn === 4) return { name: 'project.read', input: { project: first, path: 'project.json' } }
    if (turn === 5) return { name: 'project.apply', input: { project: first, path: 'project.json', content: JSON.stringify({ title: '正确的演示内容' }) } }
    if (turn === 6) return { name: 'project.read', input: { project: second, path: 'project.json' } }
    if (turn === 7) return { name: 'project.apply', input: { project: second, path: 'project.json', content: JSON.stringify({ title: '既有工程的待保存修改' }) } }
  })
  await h.host.agentFiles.execute({ runId: 'fixture', workspaceRoot: h.workspace, permission: 'workspace' },
    'file.create', { name: '其他演示.glx' }, 'existing-course')
  await writeFile(path.join(h.workspace, '教学策划.md'), '# 人工策划', 'utf8')
  const result = await h.run()
  expect(result.status).toBe('completed')
  expect((await h.disk()).project.title).toBe('正确的演示内容')
  expect((await h.disk('其他演示.glx')).project.title).toBe('其他演示')
  expect(await readFile(path.join(h.workspace, '教学策划.md'), 'utf8')).toBe('# 人工策划')
  expect(result.tools.filter(tool => tool.origin === 'host')).toMatchObject([{ result: { kind: 'read', data: { documentId: firstId } } }])
  expect(h.host.registry.get(secondId).read()).toMatchObject({ dirty: true, revision: 1, model: { project: { title: '既有工程的待保存修改' } } })
})

it('saves initial generation after an interrupted task continues with a fresh run and document grant', async () => {
  let target = '', documentId = ''
  const h = await fixture((request, turn) => {
    if (turn === 1) return { name: 'file.create', input: { name: '演示.glx' } }
    if (turn === 2) {
      target = lastData(request).target; documentId = lastData(request).documentId
      return { name: 'project.read', input: { project: target, path: 'project.json' } }
    }
    if (turn === 3) return { name: 'project.apply', input: { project: target, path: 'project.json', content: JSON.stringify({ title: '中断前的框架' }) } }
    if (turn === 4) throw new Error('fixture: model connection interrupted')
    if (turn === 5) return { name: 'project.read', input: { project: '演示.glx', path: 'project.json' } }
    if (turn === 6) return { name: 'project.apply', input: { project: '演示.glx', path: 'project.json', content: JSON.stringify({ title: '继续后完成的首次成果' }) } }
  })
  const interrupted = await h.run()
  expect(interrupted.status).toBe('partial')
  expect(interrupted.tools.some(tool => tool.call.name === 'task.delivery')).toBe(false)
  expect(h.host.registry.get(documentId).read()).toMatchObject({ dirty: true, revision: 1 })
  expect((await h.disk()).project.title).toBe('演示')
  const resumed = await h.engine.resume(interrupted.runId, { ...interrupted.input,
    documents: [{ documentId, writable: [{ kind: 'document' }] }] })
  const completed = await h.engine.wait(resumed.runId)
  expect(completed.taskContinuedFrom).toBe(interrupted.runId)
  expect(completed.status).toBe('completed')
  expect(completed.tools.some(tool => tool.call.name === 'file.create')).toBe(false)
  expect(completed.tools.filter(tool => tool.call.name === 'task.delivery')).toMatchObject([{ result: { kind: 'read',
    data: { status: 'saved', documentId, savedRevision: 2, dirty: false } } }])
  expect((await h.disk()).project.title).toBe('继续后完成的首次成果')
  expect(h.host.registry.get(documentId).read()).toMatchObject({ dirty: false, revision: 2, undoDepth: 2 })
})

it('keeps one committed edit recoverable and reports a failed save without replaying the content', async () => {
  let target = '', documentId = ''
  const h = await fixture((request, turn) => {
    if (turn === 1) return { name: 'file.create', input: { name: '演示.glx' } }
    if (turn === 2) { target = lastData(request).target; documentId = lastData(request).documentId; return { name: 'project.read', input: { project: target, path: 'project.json' } } }
    if (turn === 3) return { name: 'project.apply', input: { project: target, path: 'project.json', content: JSON.stringify({ title: '保留的生成内容' }) } }
    if (turn >= 5) expect(request.messages.some(message => message.role === 'system' && String(message.content).includes('保存文件被占用'))).toBe(true)
  })
  const saving = vi.spyOn(h.host, 'saveWithFact').mockRejectedValue(new DocumentSaveFailure('not-published', new Error('保存文件被占用')))
  const result = await h.run()
  expect(result.status).toBe('partial')
  expect(saving).toHaveBeenCalledOnce()
  expect(result.tools.filter(tool => tool.call.name === 'project.apply')).toHaveLength(1)
  expect(result.tools.filter(tool => tool.origin === 'host')).toMatchObject([{ result: { kind: 'error', code: 'delivery-rejected', message: '保存文件被占用' } }])
  expect((await h.disk()).project.title).toBe('演示')
  expect(h.host.registry.get(documentId).read()).toMatchObject({ dirty: true, revision: 1, undoDepth: 1,
    model: { kind: 'course-v10', project: { title: '保留的生成内容' } } })
  const recovery = new DocumentHostService(h.journal)
  const recovered = await recovery.operate({ type: 'restore', documentId }) as DocumentSnapshot
  expect(recovered).toMatchObject({ dirty: true, revision: 1, undoDepth: 1, model: { project: { title: '保留的生成内容' } } })
})
