// @vitest-environment node
// Settlement proof: the compute owner and its durable job receipts are real;
// the backend execution result is controlled, not a Python/runtime acceptance.
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { ComputeJobService } from '../../../../src/main/workbench/compute/ComputeJobService'
import { HostJobService } from '../../../../src/main/workbench/jobs/HostJobService'
import { DocumentDeliveryService } from '../../../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, textDataEdit } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { prepareExecutionContentOutput } from '../../../../src/core/tools/ToolTargets'
import type { ComputeBackend, ComputeProcessResult } from '../../../../src/main/workbench/compute/ComputeBackend'
import { ImageGenerationService } from '../../../../src/main/workbench/images/ImageGenerationService'
import { imageProvenance } from '../../../../src/main/workbench/images/imageRoute'
import type { ImageModelSelection } from '../../../../src/shared/workbench/images'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../../../src/shared/workbench/modelProvider'
import { callTool, residentMcpFixture } from '../../../helpers/residentMcpFixture'

const selection: ModelSelection = { model: 'controlled', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function reply(request: ModelRequest, tools: Array<{ name: string; input: unknown }>, content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  for (const tool of tools) expect(request.tools?.some(value => value.name === tool.name), `Actual default catalog: ${tool.name}`).toBe(true)
  const calls = tools.map((tool, index) => ({ id: `${request.requestId}-${index}`, name: tool.name, argumentsText: JSON.stringify(tool.input) }))
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'controlled', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content,
      ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
function lastReceipt(request: ModelRequest): any {
  const message = request.messages.filter(value => value.role === 'tool').at(-1)
  if (!message || typeof message.content !== 'string') throw new Error('A real tool receipt must reach the provider')
  return JSON.parse(message.content)
}
function namedReceipt(request: ModelRequest, name: string): any {
  const call = request.messages.filter(value => value.role === 'assistant').flatMap(value =>
    value.role === 'assistant' && Array.isArray(value.tool_calls) ? value.tool_calls.flatMap(call => {
      if (!call || typeof call !== 'object' || Array.isArray(call) || typeof call.id !== 'string') return []
      const fn = call.function
      return fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string' ? [{ id: call.id, name: fn.name }] : []
    }) : []).filter(value => value.name === name).at(-1)
  const message = request.messages.find(value => value.role === 'tool' && value.tool_call_id === call?.id)
  if (!message || typeof message.content !== 'string') throw new Error(`Real paired receipt required: ${name}`)
  return JSON.parse(message.content)
}
function currentDocuments(request: ModelRequest): any[] {
  const marker = '\n{"currentDocuments":'
  const message = request.messages.find(value => value.role === 'system' && typeof value.content === 'string' && value.content.includes(marker))
  if (!message || typeof message.content !== 'string') throw new Error('Current canonical snapshot facts must reach the provider')
  return JSON.parse(message.content.slice(message.content.indexOf(marker) + 1)).currentDocuments
}

it.each(['task.finish','direct stop'] as const)('completes saved current results through %s while keeping a definite intermediate rejection as audit warning',async ending=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'T10-result-settlement-'))
  const host=new DocumentHostService(path.join(directory,'documents'))
  const initial=await host.internalAPI.create({kind:'markdown',source:'原稿',resources:{assets:{},components:{}}},'result.md')
  const filename=path.join(directory,'result.md')
  const unavailable=async():Promise<never>=>{throw new Error('No export requested')}
  let requests=0,saves=0
  const deliveries=new DocumentDeliveryService({documents:{read:host.internalAPI.read,
    saveWithFact:async(id,path,identity)=>{saves++;return host.saveWithFact(id,path,identity)},lookupSave:(id,identity)=>host.lookupSave(id,identity),
    withFileLease:(id,work)=>host.registry.get(id).withFileLease(lease=>work(()=>lease.read()))},
    operations:new DocumentDeliveryOperationStore(path.join(directory,'delivery')),authorize:async()=>undefined,
    resolveSaveDestination:async({requested})=>requested,resolveExportDestination:unavailable,build:{build:unavailable},writer:{writeNew:unavailable,inspect:unavailable}})
  host.tools.configureHostServices({deliveries})
  const provider:ModelProvider={async *stream(request){
    requests++
    const current=currentDocuments(request)[0]
    if(requests===1){yield reply(request,[{name:'text.replace',input:{content:'已完成'}},{name:'read',input:{target:'not-an-issued-target'}}]);return}
    if(requests===2){
      if(ending==='task.finish')yield reply(request,[{name:'task.finish',input:{delivery:{target:current.target,destination:filename}}}])
      else yield reply(request,[{name:'file.save',input:{target:current.target,destination:filename}}])
      return
    }
    expect(ending).toBe('direct stop');expect(requests).toBe(3)
    yield reply(request,[],'已保存；中间错误留作诊断。')
  }}
  const contentOutput=prepareExecutionContentOutput(initial,{kind:'markdown-range',from:0,to:2})!
  const engine=new ExecutionEngine({registry:host.registry,gateway:host.tools,files:host.agentFiles,provider,
    runs:new ExecutionRunStore(path.join(directory,'runs')),events:new ExecutionEventStore({directory:path.join(directory,'events')})})
  try{
    const started=await engine.start({conversationId:'settlement',taskId:'saved-result',selection,instruction:'改完并保存正文；中间拒绝保留作警告',
      workspaceRoot:directory,permission:'workspace',documents:[{documentId:initial.documentId,writable:[{kind:'document'}],selection:[contentOutput.target]}],contentOutput})
    const ended=await engine.wait(started.runId)
    expect(ended.status,JSON.stringify(ended.failure)).toBe('completed')
    expect(ended.tools.find(tool=>tool.call.name==='read')?.result).toMatchObject({kind:'error',code:'invalid-target'})
    expect(requests).toBe(ending==='task.finish'?2:3);expect(saves).toBe(1)
    expect(await fs.readFile(filename,'utf8')).toBe('已完成')
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({dirty:false,revision:1})
    if(ending==='task.finish')expect(ended.tools.find(tool=>tool.call.name==='task.finish')?.result).toMatchObject({kind:'read',data:{status:'completed',warnings:expect.arrayContaining([expect.objectContaining({name:'read'})])}})
  }finally{await engine.shutdown()}
})

it('exposes current dirty facts after saving then editing an existing document while preserving the historical save receipt and allowing an intentional unsaved finish', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-current-document-facts-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const initial = await host.internalAPI.create({ kind: 'markdown', source: '原稿', resources: { assets: {}, components: {} } }, 'answer.md')
  const filename = path.join(directory, 'answer.md')
  const unavailable = async (): Promise<never> => { throw new Error('Export is not part of this save request') }
  let saves = 0, requests = 0
  const deliveries = new DocumentDeliveryService({
    documents: { read: host.internalAPI.read,
      saveWithFact: async (id, path, identity) => { saves++; return host.saveWithFact(id, path, identity) },
      lookupSave: (id, identity) => host.lookupSave(id, identity),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'delivery')),
    authorize: async () => undefined, resolveSaveDestination: async ({ requested }) => requested,
    resolveExportDestination: unavailable, build: { build: unavailable }, writer: { writeNew: unavailable, inspect: unavailable },
  })
  host.tools.configureHostServices({ deliveries })
  const mcp = await residentMcpFixture({ host, directory, workspaceRoot: directory })
  mcp.ui.state = { workspaceId: 'space', activeDocumentId: initial.documentId }
  const client = await mcp.connect('current-document-facts')
  const provider: ModelProvider = { async *stream(request) {
    requests++
    const documents = currentDocuments(request)
    expect(documents).toHaveLength(1)
    const current = documents[0]
    expect(current).toMatchObject({ documentId: initial.documentId, epoch: initial.epoch, kind: 'markdown', target: expect.any(String) })
    expect(current).not.toHaveProperty('savedRevision')
    if (requests === 1) {
      yield reply(request, [{ name: 'file.save', input: { target: current.target, destination: filename } }]); return
    }
    const saved = namedReceipt(request, 'file.save')
    expect(saved).toMatchObject({ kind: 'read', data: { status: 'saved', savedRevision: 0, currentRevision: 0, dirty: false, path: filename } })
    if (requests === 2) {
      expect(current).toMatchObject({ revision: 0, dirty: false, path: filename })
      yield reply(request, [{ name: 'text.replace', input: { content: '保存后继续修改的正文' } }]); return
    }
    if (requests !== 3) throw new Error('Current dirty state must allow an intentional unsaved finish without another save or provider request')
    expect(lastReceipt(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
    expect(current).toMatchObject({ revision: 1, dirty: true, path: filename })
    const state = await callTool(client, 'workbench.state')
    expect(state.isError, JSON.stringify(state.structuredContent.result)).toBe(false)
    expect(state.structuredContent.result.data.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ documentId: current.documentId, epoch: current.epoch, revision: current.revision, dirty: current.dirty, kind: current.kind, path: current.path }),
    ]))
    yield reply(request, [{ name: 'task.finish', input: {} }], '原稿已保存；随后修改仍未保存，按要求保留。')
  } }
  const contentOutput = prepareExecutionContentOutput(initial, { kind: 'markdown-range', from: 0, to: 2 })!
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'current-save-facts', taskId: 'edit-after-save', selection,
      instruction: '先保存原稿到 answer.md，然后将正文改为保存后继续修改的正文；最后保留未保存修改并如实结束。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }], selection: [contentOutput.target] }], contentOutput })
    const ended = await engine.wait(started.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
    expect(requests).toBe(3)
    expect(saves).toBe(1)
    expect(ended.tools.find(tool => tool.call.name === 'file.save')!.result).toMatchObject({ kind: 'read', data: { currentRevision: 0, dirty: false } })
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ revision: 1, dirty: true, model: { source: '保存后继续修改的正文' } })
    expect(await fs.readFile(filename, 'utf8')).toBe('原稿')
  } finally {
    await engine.shutdown()
    await mcp.close()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

async function journey(pending: boolean) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-terminal-job-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('任务结束与失败计算')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: textDataEdit('body', createTextComponentData('原稿')).value }
  project.surfaces = [{ id: 'flow', title: '讲义', kind: 'flow', childIds: ['body'] }]
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'finish.h5lesson')
  const target = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'body', dataPath: ['content'] }
  const contentOutput = prepareExecutionContentOutput(initial, target)
  expect(contentOutput).toBeTruthy()
  let backendStarts = 0, resolveProcess!: (value: ComputeProcessResult) => void
  const processResult = new Promise<ComputeProcessResult>(resolve => { resolveProcess = resolve })
  const failed: ComputeProcessResult = { exitCode: 3, stdout: '', stderr: 'diagnostic computation exited 3', truncated: false, cancelled: false, outputs: [] }
  const backend: ComputeBackend = { kind: 'pyodide', async availability() { return { available: true } }, async start() {
    backendStarts++
    if (!pending) resolveProcess(failed)
    return { done: processResult, async cancel() {
      resolveProcess({ ...failed, exitCode: null, cancelled: true }); return true
    } }
  } }
  const compute = new ComputeJobService({ directory: path.join(directory, 'compute'), backend })
  const jobs = new HostJobService({ compute, images: {} as ImageGenerationService })
  host.tools.configureHostServices({ compute, jobs })
  let requests = 0, job = ''
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests === 1) {
      yield reply(request, [{ name: 'text.replace', input: { content: '已提交正文保留，计算未成功。' } }]); return
    }
    if (requests === 2) {
      expect(lastReceipt(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      yield reply(request, [{ name: 'compute.run', input: { code: 'raise SystemExit(3)', outputNames: [] } }]); return
    }
    if (requests === 3) {
      const receipt = lastReceipt(request)
      expect(receipt.kind).toBe('read'); job = receipt.data.job; expect(job).toBeTruthy()
      // A running original job blocks; a definite terminal failure is an audit
      // warning once the current authoring result is preserved.
      yield reply(request, [{ name: 'job.wait', input: { job, milliseconds: pending ? 1 : 1000 } },
        { name: 'task.finish', input: {} }]); return
    }
    if (requests === 4) {
      expect(lastReceipt(request)).toMatchObject({ kind: 'error', code: 'task-unfinished' })
      const receipt = namedReceipt(request, 'job.wait')
      expect(receipt).toMatchObject({ kind: 'read', data: { kind: 'compute', jobId: job,
        terminal: !pending } })
      if (pending) expect(receipt.data.status).toMatch(/^(preparing|running)$/)
      else expect(receipt.data).toMatchObject({ status: 'failed', snapshot: { exitCode: 3, artifacts: [] } })
      if (pending) yield reply(request, [], '计算仍在运行，先尝试结束。')
      else yield reply(request, [{ name: 'job.status', input: { job } }, { name: 'task.finish', input: {} }])
      return
    }
    if (pending && requests === 5) {
      expect(request.messages.some(value => value.role === 'system' && typeof value.content === 'string'
        && value.content.includes('请查询原作业或原操作的结果'))).toBe(true)
      resolveProcess(failed)
      yield reply(request, [{ name: 'job.wait', input: { job, milliseconds: 1000 } }]); return
    }
    if (pending && requests === 6) {
      expect(namedReceipt(request, 'job.wait')).toMatchObject({ kind: 'read', data: { kind: 'compute', jobId: job,
        status: 'failed', terminal: true, snapshot: { exitCode: 3 } } })
      yield reply(request, [{ name: 'task.finish', input: {} }]); return
    }
    throw new Error('A terminal failed job must not trigger another provider request after explicit finish')
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'terminal-job', taskId: 'diagnostic', selection,
      instruction: '修改正文；计算诊断若失败，保留修改并如实结束。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput: contentOutput! })
    const ended = await engine.wait(started.runId)
    const finishes = ended.tools.filter(tool => tool.call.name === 'task.finish')
    const finish = finishes.at(-1)!
    const waited = ended.tools.find(tool => tool.call.name === 'job.wait')!
    expect(waited.call.input).toMatchObject({ job })
    expect(ended.status, JSON.stringify({ failure: ended.failure, finish: finish?.result })).toBe('completed')
    if(pending)expect(finishes[0].result).toMatchObject({ kind: 'error', code: 'task-unfinished', data: {
      remaining: expect.arrayContaining([expect.objectContaining({ status:'pending', job, kind: 'compute' })]) } })
    expect(finish.result).toMatchObject({ kind: 'read', data: { status:'completed',warnings:expect.any(Array) } })
    expect(requests).toBe(pending ? 6 : 3)
    expect(backendStarts).toBe(1)
    const current = await host.internalAPI.read(initial.documentId)
    expect(current).toMatchObject({ undoDepth: 1, model: { project: { instances: { body: {
      data: { content: { inlines: [{ type: 'text', text: '已提交正文保留，计算未成功。' }] } } }, } } } })
    expect(ended.tools.filter(tool => tool.call.name === 'text.replace')).toHaveLength(1)
  } finally {
    resolveProcess({ ...failed, exitCode: null, cancelled: true })
    await engine.shutdown()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
}
it('finishes from a definite failed job receipt with an audit warning and no replay or extra request', () => journey(false))
it('continues a plain stop for the original running job, then finishes from its terminal receipt', () => journey(true))

it('finishes a text edit and an explicit save in one model response using one real delivery operation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-explicit-finish-save-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const initial = await host.internalAPI.create({ kind: 'markdown', source: '原稿', resources: { assets: {}, components: {} } }, 'answer.md')
  const filename = path.join(directory, 'answer.md')
  const unavailable = async (): Promise<never> => { throw new Error('Export is not part of this save request') }
  let saves = 0, requests = 0
  const deliveries = new DocumentDeliveryService({
    documents: { read: host.internalAPI.read,
      saveWithFact: async (id, path, identity) => { saves++; return host.saveWithFact(id, path, identity) },
      lookupSave: (id, identity) => host.lookupSave(id, identity),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'delivery')),
    authorize: async () => undefined,
    resolveSaveDestination: async ({ requested }) => requested,
    resolveExportDestination: unavailable, build: { build: unavailable }, writer: { writeNew: unavailable, inspect: unavailable },
  })
  host.tools.configureHostServices({ deliveries })
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests > 1) throw new Error('The successful explicit delivery must end in the original model response')
    yield reply(request, [{ name: 'text.replace', input: { content: '已完成并保存的正文' } },
      { name: 'task.finish', input: { delivery: { destination: filename } } }])
  } }
  const contentOutput = prepareExecutionContentOutput(initial, { kind: 'markdown-range', from: 0, to: 2 })!
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events })
  try {
    const started = await engine.start({ conversationId: 'explicit-save', taskId: 'save', selection,
      instruction: '将正文改为已完成并保存的正文，然后保存到 answer.md。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }], selection: [contentOutput.target] }], contentOutput })
    const ended = await engine.wait(started.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
    expect(requests).toBe(1)
    expect(saves).toBe(1)
    expect(ended.tools.filter(tool => tool.call.name === 'task.delivery')).toMatchObject([
      { origin: 'host', result: { kind: 'read', data: { status: 'saved', dirty: false, savedRevision: 1, currentRevision: 1, path: filename } } },
    ])
    const timeline = await events.snapshot('explicit-save')
    expect(timeline.items.find(item => item.itemId === ended.tools.find(tool => tool.call.name === 'task.delivery')!.callId))
      .toMatchObject({ type: 'tool', data: { toolName: 'file.save', saveStatus: 'saved', documentId: initial.documentId, revision: 1 } })
    expect(await fs.readFile(filename, 'utf8')).toBe('已完成并保存的正文')
    const reopened = await new DocumentHostService(path.join(directory, 'reopened')).internalAPI.open(filename)
    expect(reopened.model).toMatchObject({ kind: 'markdown', source: '已完成并保存的正文' })
  } finally {
    await engine.shutdown()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

it('keeps successful child delivery and an already observed rejected image as separate truthful receipts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-partial-finish-delivery-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('子交付保全')
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'answer.h5lesson')
  const filename = path.join(directory, 'answer.h5lesson')
  const unavailable = async (): Promise<never> => { throw new Error('No export in this lifecycle check') }
  const deliveries = new DocumentDeliveryService({ documents: { read: host.internalAPI.read,
    saveWithFact: (id, path, identity) => host.saveWithFact(id, path, identity), lookupSave: (id, identity) => host.lookupSave(id, identity),
    withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'delivery')), authorize: async () => undefined,
    resolveSaveDestination: async ({ requested }) => requested, resolveExportDestination: unavailable,
    build: { build: unavailable }, writer: { writeNew: unavailable, inspect: unavailable } })
  host.tools.configureHostServices({ deliveries })
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests === 1) { yield reply(request, [{ name: 'media.insert', input: { target: 'stale-page-handle', resource: 'unapplied-image' } }]); return }
    if (requests === 2) { yield reply(request, [{ name: 'task.finish', input: { delivery: { destination: filename } } }]); return }
    throw new Error('An already observed rejection must not require a repeated finish loop after saving')
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'partial-child', taskId: 'save', selection,
      instruction: '把图片插入课件并保存，未成功要如实保留。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }] })
    const ended = await engine.wait(started.runId)
    expect(ended.status).toBe('completed')
    expect(requests).toBe(2)
    expect(ended.tools.find(tool => tool.call.name === 'task.finish')?.result).toMatchObject({ kind: 'read', data: {
      status: 'completed', warnings: expect.arrayContaining([expect.objectContaining({ name: 'media.insert', status: 'failed' })]),
      delivery: { kind: 'read', data: { status: 'saved', path: filename, savedRevision: 0, dirty: false } },
    } })
    expect(ended.tools.find(tool => tool.call.name === 'media.insert')?.result).toMatchObject({ kind: 'error', code: 'invalid-target' })
    expect((await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)).model.kind).toBe('course-v10')
    expect(ended.tools.filter(tool => tool.call.name === 'task.delivery')).toHaveLength(1)
  } finally { await engine.shutdown(); await fs.rm(directory, { recursive: true, force: true }) }
})

it('settles a corrected text from its real canonical scope while retaining the rejected receipt as history', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-canonical-finish-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const initial = await host.internalAPI.create({ kind: 'markdown', source: '原稿', resources: { assets: {}, components: {} } }, 'answer.md')
  const originalExecute = host.tools.execute.bind(host.tools)
  let rejected = false, requests = 0
  const execute = vi.spyOn(host.tools, 'execute').mockImplementation(async (runId, callId, call) => {
    if (call.name === 'text.replace' && !rejected) {
      rejected = true
      return { kind: 'error', code: 'invalid-operation', message: '该内容表示需要修正' }
    }
    return originalExecute(runId, callId, call)
  })
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests > 2) throw new Error('The corrected canonical result must not require a third request')
    if (requests === 2) expect(namedReceipt(request, 'text.replace')).toMatchObject({ kind: 'error', code: 'invalid-operation' })
    yield reply(request, [{ name: 'text.replace', input: { content: requests === 1 ? '待修正' : '修正后的正文' } },
      { name: 'task.finish', input: {} }])
  } }
  const contentOutput = prepareExecutionContentOutput(initial, { kind: 'markdown-range', from: 0, to: 2 })!
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'canonical-correction', taskId: 'correct', selection,
      instruction: '将正文改为修正后的正文。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }], selection: [contentOutput.target] }], contentOutput })
    const ended = await engine.wait(started.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
    expect(requests).toBe(2)
    const writes = ended.tools.filter(tool => tool.call.name === 'text.replace')
    expect(writes[0]).toMatchObject({ result: { kind: 'error', code: 'invalid-operation' }, writeScopes: [
      { documentId: initial.documentId, epoch: initial.epoch, paths: [['source', '@range', '0', '2']] },
    ] })
    expect(writes[1]).toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ dirty: true, undoDepth: 1, model: { source: '修正后的正文' } })
  } finally {
    execute.mockRestore()
    await engine.shutdown()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

it('reuses the generated image after a rejected insert, explicitly reads the page and saves the corrected insertion', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-recoverable-finish-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const filename = path.join(directory, 'finish.glx')
  const bytes = await sharp({ create: { width: 12, height: 9, channels: 4, background: '#428c72' } }).png().toBuffer()
  let generated = 0, saves = 0, requests = 0, resource = '', createdDocumentId = '', surface = '', document = ''
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { async generate(request, references) {
    generated++
    return { status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: 'fixture.png' }], provenance: imageProvenance(request, references) }
  } } })
  const imageSelection: ImageModelSelection = { imageModel: 'local-fixture', connection: {
    ...selection.connection, provider: 'openai', baseURL: 'https://controlled.invalid/v1', imageProtocol: 'openai-images',
  } }
  const unavailable = async (): Promise<never> => { throw new Error('Export is outside this save journey') }
  const deliveries = new DocumentDeliveryService({
    documents: { read: host.internalAPI.read,
      saveWithFact: async (id, target, identity) => { saves++; return host.saveWithFact(id, target, identity) },
      lookupSave: (id, identity) => host.lookupSave(id, identity),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'delivery')),
    authorize: async () => undefined, resolveSaveDestination: async () => filename,
    resolveExportDestination: unavailable, build: { build: unavailable }, writer: { writeNew: unavailable, inspect: unavailable },
  })
  host.tools.configureHostServices({ deliveries, images: { selection: () => imageSelection,
    run: images.start.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
    readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) } })
  let phase = 'create'
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (phase === 'create') {
      phase = 'discover'
      yield reply(request, [{ name: 'file.create', input: { name: 'finish.glx', kind: 'course-v10' } }]); return
    }
    if (phase === 'discover') {
      const created = namedReceipt(request, 'file.create')
      expect(created).toMatchObject({ kind: 'read', data: { path: filename, documentId: expect.any(String), operation: { status: 'success' } } })
      createdDocumentId = created.data.documentId
      document = created.data.target
      phase = 'generate'
      yield reply(request, [{ name: 'listChildren', input: { target: document } }]); return
    }
    if (phase === 'generate') {
      const pages = namedReceipt(request, 'listChildren')
      expect(pages).toMatchObject({ kind: 'read', data: expect.any(Array) })
      surface = pages.data.find((value: { kind: string }) => value.kind === 'course-surface')?.target
      expect(surface).toEqual(expect.any(String))
      phase = 'image'
      yield reply(request, [{ name: 'image.generate', input: { target: surface, prompt: '受控测试图片', output: { format: 'png' } } }]); return
    }
    if (phase === 'image') {
      const result = lastReceipt(request)
      expect(result.kind, JSON.stringify(result)).toBe('read')
      if (result.data.status !== 'ready') {
        yield reply(request, [{ name: 'image.status', input: { job: result.data.job } }]); return
      }
      resource = result.data.resources[0].resource
      phase = 'bad-insert'
      yield reply(request, [{ name: 'media.insert', input: { target: 'stale-page-handle', resource } }]); return
    }
    if (phase === 'bad-insert') {
      expect(lastReceipt(request)).toMatchObject({ kind: 'error', code: 'invalid-target' })
      phase = 'save'
      yield reply(request, [{ name: 'project.save', input: {} }]); return
    }
    if (phase === 'save') {
      expect(lastReceipt(request)).toMatchObject({ kind: 'read', data: { status: 'saved', dirty: false } })
      phase = 'read'
      yield reply(request, [{ name: 'listChildren', input: { target: document } }]); return
    }
    if (phase === 'read') {
      expect(namedReceipt(request, 'listChildren')).toMatchObject({ kind: 'read' })
      phase = 'done'
      yield reply(request, [{ name: 'media.insert', input: { target: surface, resource } },
        { name: 'project.save', input: {} }, { name: 'task.finish', input: {} }]); return
    }
    throw new Error('The corrected insertion and save should end without another provider request')
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'recoverable-finish', taskId: 'insert-and-save', selection,
      instruction: '把生成的图片插入第一页，并保存课件。', workspaceRoot: directory, permission: 'workspace',
      documents: [] })
    const ended = await engine.wait(started.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
    expect(requests).toBeGreaterThanOrEqual(7)
    expect(generated).toBe(1)
    expect(saves).toBe(2)
    expect(ended.tools.filter(value => value.call.name === 'media.insert').map(value => value.result?.kind)).toEqual(['error', 'document-operation'])
    const current = await host.internalAPI.read(createdDocumentId)
    expect(current).toMatchObject({ revision: 1, dirty: false })
    expect(ended.tools.filter(value => value.call.name === 'project.save').at(-1)?.result)
      .toMatchObject({ kind: 'read', data: { status: 'saved', savedRevision: 1, currentRevision: 1, dirty: false } })
    if (current.model.kind !== 'course-v10') throw new Error('Expected course project')
    expect(current.model.project.surfaces[0].childIds).toHaveLength(1)
    expect((await new DocumentHostService(path.join(directory, 'reopened')).internalAPI.open(filename)).revision).toBe(1)
  } finally {
    await engine.shutdown()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

it.each(['finish', 'stop', 'retry'] as const)('ends truthfully after %s with an uncorrected image insertion', async ending => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-stalled-finish-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('结束停滞')
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'stalled.h5lesson')
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests === 1) {
      yield reply(request, [{ name: 'media.insert', input: { target: 'stale-page-handle', resource: 'task-image' } }]); return
    }
    expect(namedReceipt(request, 'media.insert')).toMatchObject({ kind: 'error', code: 'invalid-target' })
    if (requests > 3) throw new Error('Repeating the same exit without work must not spin indefinitely')
    if (ending === 'retry') {
      yield reply(request, requests === 2
        ? [{ name: 'media.insert', input: { target: 'still-invalid-page', resource: 'task-image' } }]
        : [{ name: 'task.finish', input: {} }]); return
    }
    yield reply(request, ending === 'finish'
      ? [{ name: 'task.finish', input: {} }] : [], '仍不插入图片。')
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'stalled-finish', taskId: ending, selection,
      instruction: '把图片插入课件第一页。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }, { kind: 'course-surface', surfaceId: project.surfaces[0].id }] }] })
    const ended = await engine.wait(started.runId)
    expect(requests).toBe(ending === 'retry' ? 3 : 2)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('partial')
    expect(ended.failure?.code).not.toBe('model-no-progress')
    expect(ended.tools.filter(value => value.call.name === 'media.insert')).toHaveLength(ending === 'retry' ? 2 : 1)
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ revision: 0, dirty: true })
  } finally {
    await engine.shutdown()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

it('queries an unknown original operation after plain stop and ends a repeated cross-form exit without replay', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-unknown-stop-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('未知写入回执')
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'unknown.h5lesson')
  let attempts = 0, requests = 0
  const originalExecute = host.tools.execute.bind(host.tools)
  const intercepted = vi.spyOn(host.tools, 'execute').mockImplementation(async (runId, callId, call) => {
    if (call.name === 'project.apply') {
      attempts++
      return { kind: 'read', data: { commit: 'unknown', usability: 'unverified', delivery: 'not_requested',
        diagnostics: [], insertedIds: [] } }
    }
    return originalExecute(runId, callId, call)
  })
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests === 1) {
      yield reply(request, [{ name: 'project.apply', input: { path: 'theme.css', content: 'body { color: #123456; }' } }]); return
    }
    expect(namedReceipt(request, 'project.apply')).toMatchObject({ kind: 'read', data: { commit: 'unknown' } })
    if (requests === 2) { yield reply(request, [], '暂时结束。'); return }
    if (requests === 3) {
      expect(request.messages.some(value => value.role === 'system' && typeof value.content === 'string'
        && value.content.includes('请查询原作业或原操作的结果'))).toBe(true)
      yield reply(request, [{ name: 'project.read', input: { path: 'theme.css' } }, { name: 'task.finish', input: {} }]); return
    }
    if (requests === 4) {
      expect(namedReceipt(request, 'project.read')).toMatchObject({ kind: 'read' })
      expect(namedReceipt(request, 'task.finish')).toMatchObject({ kind: 'error', code: 'task-unfinished' })
      yield reply(request, [], '查询后仍直接结束。'); return
    }
    throw new Error('Repeated exit with the same unknown operation must terminate')
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'unknown-stop', taskId: 'unknown-insert', selection,
      instruction: '插入图片并确认结果。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' },
        { kind: 'course-surface', surfaceId: project.surfaces[0]!.id }] }] })
    const ended = await engine.wait(started.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('partial')
    expect(ended.failure?.code).toBe('model-no-progress')
    expect(ended.tools.find(tool => tool.call.name === 'task.finish')?.result)
      .toMatchObject({ kind: 'error', code: 'task-unfinished', data: { remaining: expect.arrayContaining([expect.objectContaining({ status: 'unknown', name: 'project.apply' }), expect.objectContaining({ status: 'unverified', name: '交付' })]) } })
    expect(attempts).toBe(1)
    expect(requests).toBe(4)
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ revision: 0 })
  } finally {
    intercepted.mockRestore()
    await engine.shutdown()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})
