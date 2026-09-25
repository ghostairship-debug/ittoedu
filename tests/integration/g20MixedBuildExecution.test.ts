// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import { MODEL_REQUEST_BUDGET_EXHAUSTED } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolResult } from '../../src/shared/workbench/tools'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'https://fixture.invalid/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
type Call = { id: string; name: string; argumentsText: string }
const call = (name: string, input: unknown): Call => ({ id: `${name}-${randomUUID()}`, name, argumentsText: JSON.stringify(input) })
function complete(request: ModelRequest, calls: Call[] = []): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: randomUUID(), actualModel: 'fixture-model', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content: calls.length ? '' : '已完成',
      ...(calls.length ? { tool_calls: calls.map(value => ({ id: value.id, type: 'function' as const,
        function: { name: value.name, arguments: value.argumentsText } })) } : {}) } }
}
function references(request: ModelRequest): { documentId: string; target: string; writable: { target: string }[] }[] {
  return JSON.parse(String(request.messages[1].content).split('：')[1])
}
function latestToolData(request: ModelRequest): Record<string, unknown> {
  const last = [...request.messages].reverse().find(message => message.role === 'tool')
  if (!last || typeof last.content !== 'string') throw new Error('No tool receipt')
  const result = JSON.parse(last.content) as ToolResult
  if (result.kind !== 'read' || !result.data || typeof result.data !== 'object') throw new Error('Expected build read receipt')
  return result.data as Record<string, unknown>
}
function jobFromHistory(request: ModelRequest): string {
  for (const message of [...request.messages].reverse()) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue
    const result = JSON.parse(message.content) as ToolResult
    if (result.kind === 'read' && result.data && typeof result.data === 'object'
      && typeof (result.data as { job?: unknown }).job === 'string') return (result.data as { job: string }).job
  }
  throw new Error('No real build job in model history')
}
async function fixture(provider: ModelProvider) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-mixed-build-')); roots.push(root)
  const markdown = new MarkdownDriver(), course = new CourseV9Driver()
  const journal = createDocumentJournal({ directory: path.join(root, 'documents') })
  const registry = new DocumentRegistry({ drivers: [markdown, course], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const text = await registry.create(markdown.load(new TextEncoder().encode('旧正文')), '讲义.md')
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const courseSession = await registry.create({ kind: 'course-v9', project, resources: { assets: {}, components: {} } }, '课件.h5lesson')
  const builds = new ControlledBuildService({ directory: path.join(root, 'scratch'), admission: { async run() { throw new Error('静态课件不应调用动态准入') } } })
  const gateway = new DocumentToolGateway(registry, [markdown, course], randomUUID, { services: { builds } })
  const runs = new ExecutionRunStore(path.join(root, 'runs')), events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const engine = new ExecutionEngine({ registry, gateway, provider, runs, events })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: randomUUID(), instruction: '先改讲义文字，再构建并导入课件', selection,
    documents: [{ documentId: text.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] },
      { documentId: courseSession.documentId, writable: [{ kind: 'document' }] }] }
  return { root, journal, text, courseSession, project, builds, gateway, runs, events, engine, input }
}
function firstRound(request: ModelRequest): Call[] {
  const refs = references(request)
  return [call('text.replace', { target: refs[0]!.writable[0]!.target, content: '新正文' }),
    call('tools.load', { families: ['build'] })]
}
function createBuild(request: ModelRequest): Call[] {
  expect(request.tools?.some(tool => tool.name === 'build.create')).toBe(true)
  return [call('build.create', { target: references(request)[1]!.target })]
}
function createdJob(run: ExecutionRunRecord): string {
  const result = run.tools.find(tool => tool.call.name === 'build.create')?.result
  if (result?.kind !== 'read' || !result.data || typeof result.data !== 'object' || typeof (result.data as { job?: unknown }).job !== 'string') throw new Error('No real build job')
  return (result.data as { job: string }).job
}
async function durableEnd(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
  const stored = await new ExecutionRunStore(path.join(f.root, 'runs')).read(runId)
  const end = await new ExecutionEventStore({ directory: path.join(f.root, 'events') }).findEvent(f.input.conversationId, `${runId}:terminal`)
  expect(stored).not.toBeNull(); expect(end?.type).toBe('run.end')
  return { stored: stored!, end: end! }
}

it('keeps committed text and History when build checking is stopped, and rejects a late import', async () => {
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    const step = turn++
    if (step === 0) { yield complete(request, firstRound(request)); return }
    if (step === 1) { yield complete(request, createBuild(request)); return }
    yield complete(request, [call('build.check', { job: latestToolData(request).job })])
  } }
  const f = await fixture(provider), entered = deferred(), release = deferred(), execute = f.builds.execute.bind(f.builds)
  vi.spyOn(f.builds, 'execute').mockImplementation(async (runId, input) => {
    if (input && typeof input === 'object' && 'type' in input && input.type === 'check') { entered.resolve(); await release.promise }
    return execute(runId, input)
  })
  const started = await f.engine.start(f.input)
  await entered.promise
  expect(f.text.read()).toMatchObject({ model: { source: '新正文' }, undoDepth: 1 })
  const stopping = f.engine.stop(started.runId)
  release.resolve()
  await stopping
  const { stored, end } = await durableEnd(f, started.runId)
  expect(stored.status).toBe('stopped')
  expect(end.data).toMatchObject({ status: 'stopped', text: expect.stringContaining('已保留 1 项正式文档修改') })
  expect(end.data.text).toContain('构建尚未正式导入')
  expect(end.data.text).not.toContain('构建检查已取消')
  expect(f.courseSession.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { project: { title: f.project.title } } })
  const job = createdJob(stored)
  expect(await f.gateway.execute(started.runId, 'late-import', { name: 'build.import', input: { job, artifact: 'late-artifact' } }))
    .toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(f.courseSession.read().undoDepth).toBe(0)
  const after = f.text.read()
  await f.text.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision, operationId: 'undo-text', actor: 'human', mutation: { type: 'undo' } })
  expect(f.text.read().model).toMatchObject({ source: '旧正文' })
})

it('reports model request budget exhaustion with retained text and no build import', async () => {
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    yield complete(request, turn++ === 0 ? firstRound(request) : createBuild(request))
  } }
  const f = await fixture(provider)
  const started = await f.engine.start({ ...f.input, budget: { maxRequests: 2 } })
  await f.engine.wait(started.runId)
  const { stored, end } = await durableEnd(f, started.runId)
  expect(stored.status).toBe('partial')
  expect(stored.failure?.code).toBe(MODEL_REQUEST_BUDGET_EXHAUSTED)
  expect(stored.failure?.message).toContain('2 次模型请求上限')
  expect(end.data.text).toContain('已保留 1 项正式文档修改')
  expect(end.data.text).toContain('构建尚未正式导入')
  expect(end.data.text).toContain('剩余工作未完成')
  expect(f.text.read()).toMatchObject({ model: { source: '新正文' }, undoDepth: 1 })
  expect(f.courseSession.read()).toMatchObject({ revision: 0, undoDepth: 0 })
  const job = createdJob(stored)
  expect(await f.gateway.execute(started.runId, 'late-import', { name: 'build.import', input: { job, artifact: 'late-artifact' } }))
    .toMatchObject({ kind: 'error', code: 'run-stopped' })
})

it('continues an exhausted mixed task after reading current documents without repeating committed text or build import', async () => {
  let turn = 0
  const secondRunTools: string[] = []
  const provider: ModelProvider = { async *stream(request) {
    const step = turn++
    if (step === 0) { yield complete(request, firstRound(request)); return }
    if (step === 1) { yield complete(request, createBuild(request)); return }
    if (step === 2) { yield complete(request, [call('build.write', { job: jobFromHistory(request), path: 'project.json', content: JSON.stringify(changedProject) })]); return }
    if (step === 3) { yield complete(request, [call('build.check', { job: jobFromHistory(request) })]); return }
    if (step === 4) { const ready = latestToolData(request); yield complete(request, [call('build.import', { job: ready.job, artifact: ready.artifact })]); return }
    if (step === 5) {
      const reads = references(request).map(ref => call('read', { target: ref.target }))
      secondRunTools.push(...reads.map(item => item.name))
      yield complete(request, reads); return
    }
    yield complete(request)
  } }
  const f = await fixture(provider)
  const changedProject = structuredClone(f.project); changedProject.title = '已导入构建'
  const started = await f.engine.start({ ...f.input, budget: { maxRequests: 5 } })
  const exhausted = await f.engine.wait(started.runId)
  expect(exhausted).toMatchObject({ status: 'partial', failure: { code: MODEL_REQUEST_BUDGET_EXHAUSTED } })
  expect(f.text.read()).toMatchObject({ model: { source: '新正文' }, undoDepth: 1 })
  expect(f.courseSession.read()).toMatchObject({ model: { project: { title: '已导入构建' } }, undoDepth: 1 })
  const continued = await f.engine.resume(started.runId, { ...f.input, taskId: randomUUID(), budget: { maxRequests: 2 } })
  const completed = await f.engine.wait(continued.runId)
  expect(completed).toMatchObject({ status: 'completed', continuedFrom: started.runId })
  expect(completed.requests).toHaveLength(2)
  expect(completed.tools.map(item => item.call.name)).toEqual(['read', 'read'])
  expect(secondRunTools).toEqual(['read', 'read'])
  expect(f.text.read()).toMatchObject({ model: { source: '新正文' }, undoDepth: 1 })
  expect(f.courseSession.read()).toMatchObject({ model: { project: { title: '已导入构建' } }, undoDepth: 1 })
})

it('retains a failed compile fact yet completes after fixing the same job and formally importing it', async () => {
  let turn = 0
  let changedProject: ReturnType<typeof createBlankCourseProject>
  const provider: ModelProvider = { async *stream(request) {
    const step = turn++
    if (step === 0) { yield complete(request, firstRound(request)); return }
    if (step === 1) { yield complete(request, createBuild(request)); return }
    const job = jobFromHistory(request)
    if (step === 2) { yield complete(request, [call('build.write', { job, path: 'runtime.js', content: 'function (' }),
      call('build.compile', { job, path: 'runtime.js', kind: 'runtime' })]); return }
    if (step === 3) { yield complete(request, [call('build.write', { job, path: 'runtime.js', content: 'globalThis.example = 1' }),
      call('build.compile', { job, path: 'runtime.js', kind: 'runtime' }),
      call('build.write', { job, path: 'project.json', content: JSON.stringify(changedProject) })]); return }
    if (step === 4) { yield complete(request, [call('build.check', { job })]); return }
    if (step === 5) {
      const ready = latestToolData(request)
      yield complete(request, [call('build.import', { job: ready.job, artifact: ready.artifact })]); return
    }
    yield complete(request)
  } }
  const f = await fixture(provider)
  changedProject = structuredClone(f.project); changedProject.title = '已导入构建'
  const started = await f.engine.start(f.input)
  await f.engine.wait(started.runId)
  const { stored, end } = await durableEnd(f, started.runId)
  expect(stored.status).toBe('completed')
  expect(end.data).toMatchObject({ status: 'completed', label: '已完成' })
  expect(stored.tools.find(tool => tool.call.name === 'build.compile' && tool.result?.kind === 'read'
    && typeof tool.result.data === 'object' && tool.result.data && (tool.result.data as { ok?: unknown }).ok === false)).toBeDefined()
  expect(stored.tools.find(tool => tool.call.name === 'build.import')?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(f.text.read()).toMatchObject({ model: { source: '新正文' }, undoDepth: 1 })
  expect(f.courseSession.read()).toMatchObject({ undoDepth: 1, model: { project: { title: '已导入构建' } } })
  const events = (await f.events.snapshot(f.input.conversationId)).items
  expect(events.some(item => item.type === 'tool' && item.data.toolName === 'build.compile' && item.data.status === 'failed')).toBe(true)
  expect(events.filter(item => item.type === 'document.commit')).toHaveLength(2)
})

it('lets the next model request repair a failed compile after the old 24-request boundary', async () => {
  let turn = 0
  let changedProject: ReturnType<typeof createBlankCourseProject>
  const provider: ModelProvider = { async *stream(request) {
    const step = turn++
    if (step === 0) { yield complete(request, firstRound(request)); return }
    if (step === 1) { yield complete(request, createBuild(request)); return }
    const job = jobFromHistory(request)
    // Distinct paged reads place the failed compile on request 24 without forming a repeated-tool loop.
    if (step <= 22) { yield complete(request, [call('build.read', { job, path: 'project.json', offset: step - 2, limit: 1 })]); return }
    if (step === 23) { yield complete(request, [call('build.write', { job, path: 'runtime.js', content: 'function (' }),
      call('build.compile', { job, path: 'runtime.js', kind: 'runtime' })]); return }
    if (step === 24) {
      expect(latestToolData(request)).toMatchObject({ ok: false, message: expect.any(String) })
      yield complete(request, [call('build.write', { job, path: 'runtime.js', content: 'globalThis.example = 1' }),
        call('build.compile', { job, path: 'runtime.js', kind: 'runtime' }),
        call('build.write', { job, path: 'project.json', content: JSON.stringify(changedProject) })]); return
    }
    if (step === 25) { yield complete(request, [call('build.check', { job })]); return }
    if (step === 26) {
      const ready = latestToolData(request)
      yield complete(request, [call('build.import', { job, artifact: ready.artifact })]); return
    }
    yield complete(request)
  } }
  const f = await fixture(provider)
  changedProject = structuredClone(f.project); changedProject.title = '第 25 轮修复后导入'
  const started = await f.engine.start(f.input)
  await f.engine.wait(started.runId)
  const { stored } = await durableEnd(f, started.runId)
  const job = createdJob(stored)
  expect(stored.budget.maxRequests).toBeNull()
  expect(stored.status).toBe('completed')
  expect(stored.requests).toHaveLength(28)
  expect(stored.failure).toBeUndefined()
  expect(stored.tools.filter(tool => tool.call.name === 'build.compile').map(tool =>
    tool.result?.kind === 'read' && (tool.result.data as { ok?: boolean }).ok)).toEqual([false, true])
  expect(stored.tools.find(tool => tool.call.name === 'build.import')?.call.input).toMatchObject({ job })
  expect(stored.tools.find(tool => tool.call.name === 'build.import')?.result).toMatchObject({
    kind: 'document-operation', result: { status: 'applied' },
  })
  expect(f.courseSession.read()).toMatchObject({ model: { project: { title: '第 25 轮修复后导入' } } })
})
