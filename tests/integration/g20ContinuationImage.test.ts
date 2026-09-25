// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { AgentFileService } from '../../src/core/tools/AgentFileTools'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { imageProvenance } from '../../src/main/workbench/images/ChatGPTImageProvider'
import type { ImageJobSnapshot, ImageModelSelection } from '../../src/shared/workbench/images'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
const driver = new CourseV9Driver()
const done = (request: ModelRequest, calls: { name: string; input: unknown }[] = []) => ({
  requestId: request.requestId, sequence: 1, type: 'response.completed' as const, responseId: randomUUID(), actualModel: 'free-fixture',
  nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
  toolCalls: calls.map((call, index) => ({ id: `call-${request.requestId}-${index}`, name: call.name, argumentsText: JSON.stringify(call.input) })),
  assistant: { role: 'assistant' as const, content: calls.length ? '' : '图片已使用',
    ...(calls.length ? { tool_calls: calls.map((call, index) => ({ id: `call-${request.requestId}-${index}`, type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.input) } })) } : {}) },
})

it.each([false, true])('reopens a V9 file and applies its prior ready image with a new document ID (initially frozen: %s)', async frozenInitially => {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-continuation-image-')); roots.push(root)
  const filePath = path.join(root, 'lesson.h5lesson')
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: createDocumentJournal({ directory: path.join(root, 'documents') }) })
  writeFileSync(filePath, readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))
  const model = driver.load(new Uint8Array(readFileSync(filePath)))
  const session = await registry.open({ kind: 'file', path: filePath, version: null, bindingVersion: 1 }, async () => model)
  const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#4285f4' } }).png().toBuffer()
  const resourceId = `image_${createHash('sha256').update(png).digest('hex')}`
  const imageSelection: ImageModelSelection = { imageModel: 'free-fixture-image', connection: {
    id: 'image-fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
    accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'fixture-only' }, billing: { kind: 'subscription' },
    capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } }
  const jobs = new Map<string, ImageJobSnapshot>()
  let generated = 0, reopened = 0, reissued = 0, oldResource = '', newResource = '', reopenedDocumentId = ''
  const services: HostToolServices = { images: {
    selection: async () => imageSelection,
    async run(request) {
      generated++
      const now = new Date().toISOString()
      const job: ImageJobSnapshot = { version: 1, jobId: request.jobId, runId: request.runId, documentId: request.documentId,
        requestDigest: 'fixture', operation: request.operation, status: 'ready', stopped: false, createdAt: now, updatedAt: now,
        provenance: imageProvenance(request), resources: [{ resourceId, digest: resourceId.slice(6), mimeType: 'image/png', width: 32, height: 24, byteLength: png.length }] }
      jobs.set(request.jobId, job)
      return job
    },
    async read(jobId) { return jobs.get(jobId)! },
    async stop(jobId) { return jobs.get(jobId)! },
    async readResource() { return { bytes: png, mimeType: 'image/png', filename: 'fixture.png' } },
    async readReadyResourceFromJob({ jobId, sourceRunId, sourceDocumentId, resourceId: requested }) {
      const job = jobs.get(jobId)
      if (!job || job.runId !== sourceRunId || job.documentId !== sourceDocumentId || job.status !== 'ready'
        || !job.resources.some(resource => resource.resourceId === requested)) throw new Error('source image rejected')
      reissued++
      return { bytes: png, mimeType: 'image/png', filename: 'fixture.png' }
    },
  } }
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { services, prepareImage: prepareImageResource })
  const files: AgentFileService = { async preflightCreate() { return { directory: root, outside: false } },
    async execute(context, name, input) {
      if (name === 'file.create') return { data: { operation: { status: 'success' }, path: filePath, documentId: session.documentId },
        opened: { documentId: session.documentId, kind: 'course-v9', name: filePath, writable: true } }
      if (name === 'file.open') {
        expect(input).toEqual({ path: filePath })
        expect(context.workspaceRoot).toBe(root)
        reopened++
        const opened = await registry.open({ kind: 'file', path: filePath, version: null, bindingVersion: 1 },
          async () => driver.load(new Uint8Array(readFileSync(filePath))))
        reopenedDocumentId = opened.documentId
        return { data: { path: filePath, documentId: opened.documentId, kind: 'course-v9' },
          opened: { documentId: opened.documentId, kind: 'course-v9', name: filePath, writable: context.permission !== 'read-only' } }
      }
      throw new Error(`unexpected ${name}`)
    } }
  let turns = 0, providerError = '', resumedRunId = ''
  const provider: ModelProvider = { async *stream(request) {
    turns++
    if (turns === 1 && !frozenInitially) { yield done(request, [{ name: 'file.create', input: { name: 'lesson.h5lesson', kind: 'course-v9' } }]); return }
    if (turns === (frozenInitially ? 1 : 2)) {
      yield done(request, [{ name: 'tools.load', input: { families: ['media'] } }]); return
    }
    if (turns === (frozenInitially ? 2 : 3)) {
      const created = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)?.content))
      const file = request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(String(message.content)))
        .find(result => result.data?.target)
      const frozenTarget = JSON.parse(String(request.messages[1].content).split('：')[1])[0]?.target
      yield done(request, [{ name: 'image.generate', input: {
        target: frozenInitially ? frozenTarget : file?.data.target ?? created.data.target,
        prompt: 'a single blue illustration' } }]); return
    }
    const facts = request.messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n')
    expect(facts).toContain(resourceId)
    expect(facts).toContain('本次可用短句柄')
    expect(facts).not.toContain(oldResource)
    const reissueLine = request.messages.find(message => message.role === 'system' && String(message.content).includes('本次可用短句柄'))!
    const ready = JSON.parse(String(reissueLine.content).split('：').at(-1)!).ready
    newResource = ready[0].resource
    if (turns === (frozenInitially ? 3 : 4)) {
      const refs = JSON.parse(String(request.messages[1].content).split('：')[1])
      yield done(request, [{ name: 'read', input: { target: refs[0].target } }]); return
    }
    if (turns === (frozenInitially ? 4 : 5)) { yield done(request, [{ name: 'tools.load', input: { families: ['media'] } }]); return }
    if (turns === (frozenInitially ? 5 : 6)) {
      try {
        await expect(gateway.readImageResource(resumedRunId, reopenedDocumentId, oldResource)).rejects.toThrow()
        const location = (model as Extract<typeof model, { kind: 'course-v9' }>).project.locations.find(value => value.kind === 'slide-scene')!
        const owner = await gateway.issueTarget(resumedRunId, reopenedDocumentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
        yield done(request, [{ name: 'media.insert', input: { target: owner, resource: newResource, properties: {} } }]); return
      } catch (error) { providerError = error instanceof Error ? error.message : String(error); throw error }
    }
    yield done(request)
  } }
  const engine = new ExecutionEngine({ registry, gateway, provider, files, runs: new ExecutionRunStore(path.join(root, 'runs')),
    events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  const selection: ExecutionStart['selection'] = { model: 'free-fixture', connection: { id: 'text-fixture', revision: 1,
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
    auth: { kind: 'api-key', credentialRef: 'fixture-only' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } }
  const input: ExecutionStart = { conversationId: 'same-conversation', taskId: 'image-task', instruction: '创建课件并生成插图',
    selection, documents: frozenInitially ? [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] : [],
    workspaceRoot: root, permission: 'workspace', budget: { maxRequests: frozenInitially ? 2 : 3 } }
  const first = await engine.start(input), exhausted = await engine.wait(first.runId)
  expect(exhausted.status).toBe(frozenInitially ? 'failed' : 'partial')
  expect(exhausted.failure?.code).toBe('model-request-budget-exhausted')
  expect(exhausted.tools.map(tool => tool.call.name)).toEqual(frozenInitially
    ? ['tools.load', 'image.generate'] : ['file.create', 'tools.load', 'image.generate'])
  expect(exhausted.tools.find(tool => tool.call.name === 'image.generate')?.result).toMatchObject({ kind: 'read' })
  oldResource = (exhausted.tools.find(tool => tool.call.name === 'image.generate')!.result as any).data.resources[0].resource
  await registry.close(session.documentId)
  const resumed = await engine.start({ ...input, documents: [], budget: { maxRequests: 4 } }, { runId: exhausted.runId, facts: '' },
    async prepared => { resumedRunId = prepared.runId })
  const final = await engine.wait(resumed.runId)
  if (final.status !== 'completed') throw new Error(JSON.stringify({ providerError, failure: final.failure, tools: final.tools.map(tool => ({ name: tool.call.name, result: tool.result })) }))
  expect(final.status).toBe('completed')
  expect(final.tools.find(tool => tool.call.name === 'media.insert')?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(reopenedDocumentId).not.toBe(session.documentId)
  expect(registry.get(reopenedDocumentId).read().undoDepth).toBe(1)
  expect(generated).toBe(1)
  expect(reissued).toBe(1)
  expect(reopened).toBe(1)
  expect(newResource).not.toBe(oldResource)
  expect(final.hostContinuationImages).toEqual([{ sourceRunId: exhausted.runId,
    sourceJobId: (exhausted.tools.find(tool => tool.call.name === 'image.generate')!.result as any).data.job,
    resourceId, sourceDocumentId: session.documentId, destinationDocumentId: reopenedDocumentId,
    documentId: reopenedDocumentId, resource: newResource }])
})
