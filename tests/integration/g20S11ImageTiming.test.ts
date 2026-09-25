// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ImageGenerationRequest, ImageModelSelection } from '../../src/shared/workbench/images'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function root() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s11-image-')); roots.push(value); return value }
const connection = { id: 'oauth-fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture-account',
  auth: { kind: 'oauth', credentialRef: 'fixture-ref' }, billing: { kind: 'subscription' },
  capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } as const
const imageSelection: ImageModelSelection = { connection, imageModel: 'fixture-image' }
const modelSelection: ModelSelection = { model: 'fixture-text', connection: { id: 'text-fixture', revision: 1,
  provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'fixture-text',
  auth: { kind: 'api-key', credentialRef: 'fixture-key' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
const png = () => sharp({ create: { width: 8, height: 8, channels: 4, background: '#2463eb' } }).png().toBuffer()
function request(jobId: string, operation: 'generate' | 'edit' = 'generate'): ImageGenerationRequest {
  return { jobId, runId: 'fixture-run', documentId: 'fixture-document', operation, prompt: 'blue bell private prompt',
    selection: imageSelection, ...(operation === 'edit' ? { referenceIds: ['fixture-reference'] } : {}) }
}
function completed(input: ModelRequest, call?: { id: string; name: string; argumentsText: string }): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: input.requestId, sequence: 1, type: 'response.completed', responseId: 'response', actualModel: 'fixture-text',
    nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls: call ? [call] : [],
    assistant: { role: 'assistant', content: call ? '' : '已生成', ...(call ? { tool_calls: [{ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } }] } : {}) } }
}

it('persists actual image preparation, fetch invocation and response observations without inventing streamed first content', async () => {
  const directory = await root(), output = await png()
  let fetchCalls = 0
  const fetchFixture: typeof fetch = async () => {
    fetchCalls++
    return new Response(JSON.stringify({ created: 1, data: [{ b64_json: output.toString('base64') }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const service = new ImageGenerationService({ directory, provider: new ChatGPTImageProvider({
    credentialResolver: async () => ({ accessToken: 'private-access-token', accountId: 'fixture-account' }), fetch: fetchFixture,
  }), resolveReference: async () => ({ bytes: output, mimeType: 'image/png', filename: 'reference.png' }) })
  const job = await service.run(request('edit-with-reference', 'edit'))
  expect(job.status).toBe('ready')
  expect(fetchCalls).toBe(1)
  const stages = job.timing?.map(mark => mark.stage)
  expect(stages).toEqual(['image.references.started', 'image.references.finished', 'image.provider.started',
    'image.provider.prepared', 'image.fetch.invoked', 'image.response.headers', 'image.provider.finished',
    'image.resources.started', 'image.resources.finished'])
  expect(job.timing!.map(mark => mark.monotonicMs)).toEqual([...job.timing!.map(mark => mark.monotonicMs)].sort((a, b) => a - b))
  expect(new Set(job.timing!.map(mark => `${mark.process}:${mark.clock}:${mark.clockInstanceId}`)).size).toBe(1)
  expect(job.timing!.find(mark => mark.stage === 'image.provider.prepared')?.detail).toMatchObject({ referenceCount: 1,
    requestBytes: expect.any(Number) })
  expect(job.timing!.find(mark => mark.stage === 'image.response.headers')?.detail).toEqual({ httpStatus: 200 })
  expect(job.timing!.find(mark => mark.stage === 'image.provider.finished')?.detail).toMatchObject({ outcome: 'completed', imageCount: 1 })
  expect(JSON.stringify(job.timing)).not.toMatch(/private-access-token|private prompt|b64_json/)
  expect((await new ImageGenerationService({ directory, provider: new ChatGPTImageProvider({ fetch: fetchFixture,
    credentialResolver: async () => { throw new Error('must not resolve credentials on reopen') } }) }).read(job.jobId)).timing).toEqual(job.timing)

  const unsent = await new ImageGenerationService({ directory: await root(), provider: new ChatGPTImageProvider({
    credentialResolver: async () => { throw new Error('no credential') }, fetch: fetchFixture,
  }) }).run(request('missing-credential'))
  expect(unsent.status).toBe('failed')
  expect(unsent.failure?.outcome).toBe('not-sent')
  expect(unsent.timing?.map(mark => mark.stage)).toEqual(['image.references.started', 'image.references.finished',
    'image.provider.started', 'image.provider.prepared', 'image.provider.finished'])
  expect(fetchCalls).toBe(1)

  const jobFile = path.join(directory, 'jobs', (await fs.readdir(path.join(directory, 'jobs')))[0]!)
  const legacy = JSON.parse(await fs.readFile(jobFile, 'utf8')) as Record<string, unknown>
  delete legacy.timing
  await fs.writeFile(jobFile, JSON.stringify(legacy))
  const reopened = new ImageGenerationService({ directory, provider: new ChatGPTImageProvider({ fetch: fetchFixture,
    credentialResolver: async () => { throw new Error('must not send old job') } }) })
  expect((await reopened.read(job.jobId)).timing).toBeUndefined()
  expect((await reopened.run(request(job.jobId, 'edit'))).status).toBe('ready')
  expect(fetchCalls).toBe(1)
})

it('keeps one completed upstream terminal when local image resource storage fails', async () => {
  const directory = await root(), output = await png()
  const provider = new ChatGPTImageProvider({ credentialResolver: async () => ({ accessToken: 'private-access-token', accountId: 'fixture-account' }),
    fetch: async () => new Response(JSON.stringify({ created: 1, data: [{ b64_json: output.toString('base64') }] }),
      { headers: { 'Content-Type': 'application/json' } }) })
  const service = new ImageGenerationService({ directory, provider })
  vi.spyOn(service as unknown as { storeImage(input: unknown): Promise<unknown> }, 'storeImage')
    .mockRejectedValueOnce(new Error('local storage failed'))
  const job = await service.run(request('local-store-failed'))
  expect(job.status).toBe('unknown')
  expect(job.resources).toEqual([])
  expect(job.timing?.filter(mark => mark.stage === 'image.provider.finished')).toMatchObject([{ detail: { outcome: 'completed' } }])
  expect(job.timing?.filter(mark => mark.stage === 'image.resources.finished')).toMatchObject([{ detail: { outcome: 'failed' } }])
  expect(await service.readTiming(job.jobId)).toMatchObject({ jobId: job.jobId, runId: job.runId,
    timing: job.timing })
})

it('projects original image producer instants onto their own request/tool while keeping diagnostics out of model messages', async () => {
  const directory = await root(), output = await png()
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: new ChatGPTImageProvider({
    credentialResolver: async () => ({ accessToken: 'private-access-token', accountId: 'fixture-account' }),
    fetch: async () => new Response(JSON.stringify({ created: 1, data: [{ b64_json: output.toString('base64') }] }),
      { headers: { 'Content-Type': 'application/json' } }),
  }) })
  const driver = new CourseV9Driver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create({ kind: 'course-v9', project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    resources: { assets: {}, components: {} } }, 'test.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { prepareImage: prepareImageResource, services: { images: {
    selection: () => imageSelection, run: (input, options) => images.run(input, options), read: id => images.read(id),
    stop: id => images.stop(id), readResource: id => images.readResource(id),
  } } })
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const calls: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(input) {
    calls.push(input)
    if (calls.length === 1) {
      const refs = JSON.parse(String(input.messages[1].content).split('：')[1]) as { target: string }[]
      yield completed(input, { id: 'image-call', name: 'image.generate',
        argumentsText: JSON.stringify({ target: refs[0]!.target, prompt: 'private prompt for engine' }) })
    } else yield completed(input)
  } }
  const engine = new ExecutionEngine({ registry, gateway, events, runs: new ExecutionRunStore(path.join(directory, 'runs')), provider })
  const start: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: 'generate', selection: modelSelection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] }
  const started = await engine.start(start), final = await engine.wait(started.runId)
  expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools })).toBe('completed')
  expect(final.tools).toHaveLength(1)
  expect(final.tools[0]!.result?.kind).toBe('read')
  const tool = final.tools[0]!, result = tool.result as Extract<typeof tool.result, { kind: 'read' }>
  expect(result.data).toMatchObject({ status: 'ready', job: expect.stringMatching(/^image-/), timing: expect.any(Array) })
  const jobId = (result.data as { job: string }).job
  const marks = await events.readTiming(start.conversationId, start.taskId)
  const imageMarks = marks.filter(mark => mark.stage.startsWith('image.'))
  expect(imageMarks.map(mark => mark.stage)).toEqual((result.data as { timing: { stage: string }[] }).timing.map(mark => mark.stage))
  for (const [index, mark] of imageMarks.entries()) {
    const original = (result.data as { timing: { monotonicMs: number; clockInstanceId: string; wallTimeMs: number }[] }).timing[index]!
    expect(mark).toMatchObject({ requestId: tool.requestId, toolCallId: tool.callId, monotonicMs: original.monotonicMs,
      wallTimeMs: original.wallTimeMs, clockInstanceId: original.clockInstanceId, detail: { jobId } })
  }
  expect(marks.filter(mark => mark.stage === 'request.finished').map(mark => mark.detail?.outcome)).toEqual(['completed', 'completed'])
  expect(calls[1]!.messages.some(message => JSON.stringify(message).includes('image.fetch.invoked'))).toBe(false)
  expect(calls[1]!.messages.some(message => JSON.stringify(message).includes('private-access-token'))).toBe(false)
})

it('retains image job facts after stop revokes tool authority without applying the image', async () => {
  const directory = await root()
  let fetchEntered!: () => void, fetchCalls = 0
  const entered = new Promise<void>(resolve => { fetchEntered = resolve })
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: new ChatGPTImageProvider({
    credentialResolver: async () => ({ accessToken: 'private-access-token', accountId: 'fixture-account' }),
    fetch: async (_url, init) => {
      fetchCalls++; fetchEntered()
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    },
  }) })
  const driver = new CourseV9Driver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create({ kind: 'course-v9', project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    resources: { assets: {}, components: {} } }, 'stopped.h5lesson')
  const before = session.read().revision
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { prepareImage: prepareImageResource, services: { images: {
    selection: () => imageSelection, run: (input, options) => images.run(input, options), read: id => images.read(id),
    stop: id => images.stop(id), readResource: id => images.readResource(id),
  } } })
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const provider: ModelProvider = { async *stream(input) {
    const refs = JSON.parse(String(input.messages[1].content).split('：')[1]) as { target: string }[]
    yield completed(input, { id: 'image-call', name: 'image.generate',
      argumentsText: JSON.stringify({ target: refs[0]!.target, prompt: 'private prompt for stop' }) })
  } }
  const engine = new ExecutionEngine({ registry, gateway, events, runs: new ExecutionRunStore(path.join(directory, 'runs')),
    provider, readImageTiming: id => images.readTiming(id) })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'stopped-image', instruction: 'generate',
    selection: modelSelection, documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] }
  const started = await engine.start(input)
  await entered
  const stopped = await engine.stop(started.runId)
  expect(stopped?.status).toBe('stopped')
  expect(fetchCalls).toBe(1)
  expect(session.read().revision).toBe(before)
  expect(stopped?.tools[0]?.result).toMatchObject({ kind: 'error', code: 'run-stopped' })
  const callId = stopped!.tools[0]!.callId, jobId = `image-${gateway.operationIdentity(started.runId, callId)}`
  const jobFacts = await images.readTiming(jobId)
  expect(jobFacts?.timing?.map(mark => mark.stage)).toContain('image.fetch.invoked')
  const marks = await events.readTiming(input.conversationId, input.taskId)
  const projected = marks.filter(mark => mark.stage.startsWith('image.'))
  expect(projected.map(mark => mark.stage)).toEqual(jobFacts!.timing!.map(mark => mark.stage))
  expect(projected.find(mark => mark.stage === 'image.fetch.invoked')).toMatchObject({
    requestId: stopped!.tools[0]!.requestId, toolCallId: callId, detail: { jobId },
    monotonicMs: jobFacts!.timing!.find(mark => mark.stage === 'image.fetch.invoked')!.monotonicMs,
  })
  expect(marks.some(mark => mark.stage === 'document.applied')).toBe(false)
})
