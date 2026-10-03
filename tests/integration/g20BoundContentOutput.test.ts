// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture path')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'unsupported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function completed(request: ModelRequest, content: string): Extract<ModelEvent, { type: 'response.completed' }> {
  return { type: 'response.completed', requestId: request.requestId, sequence: 10, responseId: 'fixture', actualModel: 'fixture',
    finishReason: 'stop', toolCalls: [], assistant: { role: 'assistant', content }, nativeResponse: {} }
}
async function fixture(provider: ModelProvider, source = '前文 OLD 后文') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-bound-content-')); roots.push(root)
  const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(root, 'documents') })
  const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const edits = new EditSessionService(registry, gateway), runs = new ExecutionRunStore(path.join(root, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const engine = new ExecutionEngine({ registry, gateway, edits, runs, events, provider })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'draft.md')
  const target = { kind: 'markdown-range' as const, from: 0, to: source.length }
  const input: ExecutionStart = { conversationId: 'conversation', taskId: randomUUID(), instruction: '改写选中的正文', selection,
    documents: [{ documentId: session.documentId, writable: [target], selection: [target] }],
    contentOutput: { kind: 'replace-text', documentId: session.documentId, target } }
  return { registry, gateway, edits, runs, engine, session, input }
}

describe('U01 explicit bound content output', () => {
  it('receives complete text without tools, applies once through canonical history, and does not apply ordinary chat or replay a settled continuation', async () => {
    const source = '完整正文'.repeat(1500) + '尾部不可截断', requests: ModelRequest[] = []
    let h!: Awaited<ReturnType<typeof fixture>>
    const provider: ModelProvider = { async *stream(request) {
      requests.push(request)
      if (requests.length === 1) {
        expect(request.tools).toEqual([])
        expect(JSON.stringify(request.messages)).toContain('尾部不可截断')
        expect(JSON.stringify(request.messages)).not.toContain('text.replace 参数')
        yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '改写' }
        expect(h.edits.list(h.session.documentId)[0]?.value).toBe('改写')
        expect(h.session.read()).toMatchObject({ model: { source }, undoDepth: 0 })
        yield completed(request, '改写后的完整正文')
      } else {
        expect(request.tools?.length).toBeGreaterThan(0)
        yield completed(request, '这只是对所选正文的解释。')
      }
    } }
    h = await fixture(provider, source)
    const start = await h.engine.start(h.input), result = await h.engine.wait(start.runId)
    expect(result.status).toBe('completed')
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]).toMatchObject({ origin: 'host', call: { name: 'text.replace' }, result: { kind: 'document-operation', result: { status: 'applied' } } })
    expect(result.messages.some(message => message.role === 'tool')).toBe(false)
    expect(h.session.read()).toMatchObject({ model: { source: '改写后的完整正文' }, undoDepth: 1 })
    expect(h.edits.list(h.session.documentId)).toEqual([])
    expect((await h.runs.read(start.runId))?.input.contentOutput).toEqual(h.input.contentOutput)
    const target = { kind: 'markdown-range' as const, from: 0, to: '改写后的完整正文'.length }
    const current = { ...h.input, taskId: randomUUID(), documents: [{ documentId: h.session.documentId, writable: [target], selection: [target] }],
      contentOutput: { ...h.input.contentOutput!, target } }
    const resumed = await h.engine.start(current, { runId: start.runId, facts: '', sameTask: true })
    expect((await h.engine.wait(resumed.runId)).status).toBe('completed')
    expect(requests).toHaveLength(1)
    expect(h.session.read().undoDepth).toBe(1)
    const { contentOutput: _output, ...ordinary } = current
    const chat = await h.engine.start({ ...ordinary, taskId: randomUUID(), instruction: '解释这段话，不修改',
      selection: { ...selection, connection: { ...selection.connection, capabilities: { ...selection.connection.capabilities, tools: 'supported' } } } })
    expect((await h.engine.wait(chat.runId)).tools).toHaveLength(0)
    expect(h.session.read().undoDepth).toBe(1)
    await expect(h.engine.start({ ...current, permission: 'read-only' })).rejects.toThrow('只读')
  })

  it('does not commit late generated text after stopping or after an overlapping human edit', async () => {
    for (const mode of ['stop', 'conflict'] as const) {
      const streamed = deferred(), release = deferred()
      const h = await fixture({ async *stream(request, options) {
        options?.signal?.addEventListener('abort', release.resolve, { once: true })
        yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '尚未完成' }
        streamed.resolve(); await release.promise
        yield completed(request, '不得覆盖人的内容')
      } })
      const started = await h.engine.start(h.input)
      await streamed.promise
      if (mode === 'stop') await h.engine.stop(started.runId)
      else {
        const before = h.session.read()
        await h.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: randomUUID(), actor: 'human',
          baseRevision: before.revision, mutation: { type: 'command', command: { type: 'markdown.replace', source: '人的新正文' } } })
        release.resolve()
      }
      const ended = await h.engine.wait(started.runId)
      expect(ended.status).toBe(mode === 'stop' ? 'stopped' : 'failed')
      expect(h.session.read()).toMatchObject({ model: { source: mode === 'stop' ? '前文 OLD 后文' : '人的新正文' }, undoDepth: mode === 'stop' ? 0 : 1 })
      expect(h.edits.list(h.session.documentId)).toEqual([])
      expect(ended.tools).toHaveLength(0)
    }
  })

  it('freezes direct output through the desktop queue and rejects a changed output mode under the same submission identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-content-queue-')); roots.push(root)
    const documents = new DocumentHostService(path.join(root, 'documents'))
    const filename = path.join(root, 'draft.md'); await fs.writeFile(filename, '待改写正文')
    const document = await documents.open(filename)
    const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
      isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
    } })
    const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
      accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
    await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture' }, vision: null, imageGenerate: null, imageEdit: null } })
    const entered = deferred(), release = deferred(); let requests = 0
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      const at = ++requests
      if (at === 1) { entered.resolve(); await release.promise }
      else expect(JSON.parse(String(init?.body)).tools ?? []).toEqual([])
      return new Response(`data: ${JSON.stringify({ id: `reply-${at}`, model: 'fixture', choices: [{ index: 0,
        delta: { role: 'assistant', content: at === 1 ? '普通回答' : '队列改写正文' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings, fetch, authorizeWorkspaceRoot: async wanted => ({ resolvedPath: wanted }) })
    const space = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string } }
    let conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
    const common = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
    const first = await service.operate({ type: 'send', ...common, submissionId: randomUUID(), expectedRevision: conversation.revision, text: '普通问题', documents: [] }) as ExecutionSendResult
    await entered.promise
    conversation = await service.operate({ type: 'conversation', ...common }) as ConversationRecord
    const target = { kind: 'markdown-range' as const, from: 0, to: 5 }
    const output = { kind: 'replace-text' as const, documentId: document.documentId, target }
    const input = { type: 'send' as const, ...common, submissionId: randomUUID(), expectedRevision: conversation.revision, text: '改写正文',
      documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, selection: [target], writable: [target] }], contentOutput: output }
    const queued = await service.operate(input) as ExecutionSendResult
    expect(queued.submission).toMatchObject({ state: 'queued', contentOutput: output })
    expect((await service.submissions.read(input.submissionId))?.start.contentOutput).toEqual(output)
    await expect(service.operate({ ...input, contentOutput: undefined })).rejects.toThrow('同一提交编号')
    release.resolve(); await service.engine.wait(first.run!.runId)
    let second = await service.submissions.read(input.submissionId)
    for (let attempt = 0; !second?.runId && attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10)); second = await service.submissions.read(input.submissionId)
    }
    expect(second?.runId).toBeTruthy()
    const result = await service.engine.wait(second!.runId!)
    expect(result.status).toBe('completed')
    expect(documents.registry.get(document.documentId).read().model).toMatchObject({ source: '队列改写正文' })
    expect(result.messages.some(message => message.role === 'tool')).toBe(false)
  })
})
