// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action() })
const selection = (vision: 'supported' | 'unsupported'): ModelSelection => ({ model: 'fixture-model', connection: { id: 'fixture', revision: 1,
  provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account',
  auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision, reasoning: 'supported' } } })
function complete(request: ModelRequest, calls: { id: string; name: string; argumentsText: string }[] = []): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 10, type: 'response.completed', responseId: 'fixture-response', actualModel: 'fixture',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: calls.length ? '' : '已结束', ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}

async function run(vision: 'supported' | 'unsupported') {
  const requests: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) {
    requests.push(request)
    yield requests.length === 1 ? complete(request, [{ id: 'preview', name: 'image.preview', argumentsText: JSON.stringify({ images: ['img1', 'img2'] }) }])
      : complete(request)
  } }
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-open-preview-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const engine = new ExecutionEngine({ registry, gateway, edits: new EditSessionService(registry, gateway),
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }), provider })
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const original = gateway.execute.bind(gateway)
  const execute = vi.spyOn(gateway, 'execute').mockImplementation(async (runId, callId, call) => call.name !== 'image.preview' ? original(runId, callId, call)
    : { kind: 'read', data: { status: 'prepared', previews: [{ image: 'img1', resourceId: 'preview-3', mimeType: 'image/jpeg', byteLength: bytes.length, width: 480, height: 320 }],
      failures: [{ image: 'img2', reason: '预览图下载失败' }] },
      images: [{ kind: 'image', source: 'preview', resourceId: 'preview-3', mimeType: 'image/jpeg', byteLength: bytes.length, label: '图片 img1：' }] })
  const read = vi.spyOn(gateway, 'prepareResultImages').mockResolvedValue([{ kind: 'image', mimeType: 'image/jpeg', bytes, label: '图片 img1：' }])
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '为“枫叶”页挑一张照片', selection: selection(vision), documents: [] }
  const started = await engine.start(input), final = await engine.wait(started.runId)
  return { final, requests, execute, read, bytes }
}

it('attaches prepared previews to the next model request, each labelled with its candidate handle', async () => {
  const { final, requests, read, bytes } = await run('supported')
  expect(final.status).toBe('completed')
  expect(read).toHaveBeenCalledWith(final.runId, expect.objectContaining({ images: [expect.objectContaining({ resourceId: 'preview-3' })] }))
  expect(final.tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'prepared', failures: [{ image: 'img2' }] } })
  const attached = requests[1]!.messages.find(message => Array.isArray(message.content)
    && message.content.some(part => (part as { type?: string }).type === 'image_url'))
  expect(attached?.content).toEqual([
    { type: 'text', text: expect.stringContaining('不可信') },
    { type: 'text', text: '图片 img1：' },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` } },
  ])
})

it('previews the original ready image from a prior workspace run through the real visual consumer without generating again', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-open-preview-'))
  cleanup.push(async () => {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  })
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#347d68' } }).png().toBuffer()
  let imageCalls = 0
  const imageSelection: ImageModelSelection = { imageModel: 'fixture-image', connection: { ...selection('supported').connection,
    provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
    auth: { kind: 'oauth', credentialRef: 'fixture-secret-ref' } } }
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { generate: async (request, references) => {
    imageCalls++
    return { status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: 'original.png' }], provenance: imageProvenance(request, references) }
  } } })
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { services: { images: {
    selection: () => imageSelection, run: images.run.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
    readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images),
  } } })
  const data = (result: ToolResult): any => { if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data }
  await gateway.beginRun({ runId: 'original', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: directory } })
  const ready = data(await gateway.execute('original', 'generate', { name: 'image.generate', input: { prompt: 'Controlled PNG fixture' } }))
  const reference = ready.resources[0].resource
  expect(reference.length).toBeGreaterThan(100)
  await gateway.stop('original')

  const requests: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) {
    requests.push(request)
    yield requests.length === 1 ? complete(request, [{ id: 'preview', name: 'image.preview', argumentsText: JSON.stringify({ images: [reference] }) }])
      : complete(request)
  } }
  const engine = new ExecutionEngine({ registry, gateway, edits: new EditSessionService(registry, gateway),
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }), provider })
  const started = await engine.start({ conversationId: 'conversation', taskId: 'task', instruction: '查看之前生成的图片',
    selection: selection('supported'), documents: [], permission: 'workspace', workspaceRoot: directory })
  const final = await engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'prepared', previews: [
    { image: reference, resourceId: reference, mimeType: 'image/png', byteLength: bytes.byteLength },
  ] } })
  const attached = requests[1]!.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .find(part => (part as { type?: string }).type === 'image_url') as { image_url: { url: string } }
  expect(attached.image_url.url).toBe(`data:image/png;base64,${bytes.toString('base64')}`)
  expect(await images.read(ready.job)).toMatchObject({ runId: 'original', status: 'ready', stopped: false })
  expect(imageCalls).toBe(1)

  await gateway.beginRun({ runId: 'foreign', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: path.join(directory, 'foreign') } })
  expect(await gateway.execute('foreign', 'preview', { name: 'image.preview', input: { images: [reference] } }))
    .toMatchObject({ kind: 'read', data: { status: 'failed', failures: [{ image: reference, reason: expect.stringContaining('工作空间') }] } })
  await expect(gateway.readOpenImagePreview('foreign', reference)).rejects.toThrow('工作空间')
  await gateway.stop('foreign')
  expect(imageCalls).toBe(1)

  // The existing library owner still supplies both the receipt and its preview bytes.
  const libraryReceipt = { status: 'prepared', previews: [{ image: 'img1', resourceId: 'preview-1', mimeType: 'image/png',
    byteLength: bytes.byteLength, width: 32, height: 24 }] }
  const preview = vi.fn(async () => libraryReceipt), readPreview = vi.fn(() => ({ mimeType: 'image/png', bytes }))
  const libraryGateway = new DocumentToolGateway(registry, [driver], randomUUID, { services: { openImages: {
    search: async () => ({}), preview, readPreview, fetch: async () => ({ status: 'failed', reason: 'Unused' }),
  } } })
  await libraryGateway.beginRun({ runId: 'library', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: directory } })
  expect(data(await libraryGateway.execute('library', 'preview', { name: 'image.preview', input: { images: ['img1'] } }))).toEqual(libraryReceipt)
  expect(preview).toHaveBeenCalledWith({ runId: 'library', images: ['img1'], signal: undefined })
  expect(await libraryGateway.readOpenImagePreview('library', 'preview-1')).toEqual({ mimeType: 'image/png', bytes })
  expect(readPreview).toHaveBeenCalledWith('library', 'preview-1')
  await libraryGateway.stop('library')
})

it('answers vision-unavailable without downloading previews when the run has no vision route', async () => {
  const { final, execute, read, requests } = await run('unsupported')
  expect(final.status).toBe('completed')
  expect(execute.mock.calls.some(([, , call]) => call.name === 'image.preview')).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect(final.tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'vision-unavailable', reason: expect.stringContaining('相关度') } })
  expect(JSON.stringify(requests[1]!.messages)).not.toContain('image_url')
})
