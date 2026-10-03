// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
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
      failures: [{ image: 'img2', reason: '预览图下载失败' }] } })
  const read = vi.spyOn(gateway, 'readOpenImagePreview').mockReturnValue({ mimeType: 'image/jpeg', bytes })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '为“枫叶”页挑一张照片', selection: selection(vision), documents: [] }
  const started = await engine.start(input), final = await engine.wait(started.runId)
  return { final, requests, execute, read, bytes }
}

it('attaches prepared previews to the next model request, each labelled with its candidate handle', async () => {
  const { final, requests, read, bytes } = await run('supported')
  expect(final.status).toBe('completed')
  expect(read).toHaveBeenCalledWith(final.runId, 'preview-3')
  expect(final.tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'prepared', failures: [{ image: 'img2' }] } })
  const attached = requests[1]!.messages.find(message => Array.isArray(message.content)
    && message.content.some(part => (part as { type?: string }).type === 'image_url'))
  expect(attached?.content).toEqual([
    { type: 'text', text: expect.stringContaining('不可信') },
    { type: 'text', text: '候选 img1：' },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` } },
  ])
})

it('answers vision-unavailable without downloading previews when the run has no vision route', async () => {
  const { final, execute, read, requests } = await run('unsupported')
  expect(final.status).toBe('completed')
  expect(execute.mock.calls.some(([, , call]) => call.name === 'image.preview')).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect(final.tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'vision-unavailable', reason: expect.stringContaining('相关度') } })
  expect(JSON.stringify(requests[1]!.messages)).not.toContain('image_url')
})
