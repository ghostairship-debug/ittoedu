// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { toolCatalog } from '../../src/core/tools/ToolCatalog'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ModelChatMessage, ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { USER_QUESTION_TOOL } from '../../src/shared/workbench/userQuestion'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { DesktopOperationError } from '../../src/main/errors'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionEventPage } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

// M09-T04 (Owner 2026-09-24): the built-in AI asks with option cards. The loop waits for the
// user's own choice, continues the same run with it, and never invents an answer.
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })
const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
const question = { question: '这一段改成哪种写法？', options: [{ label: '简洁版' }, { label: '详细版', description: '保留例子' }] }
function complete(request: ModelRequest, calls: { id: string; name: string; argumentsText: string }[] = [], content = '已结束'): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`, actualModel: 'fixture',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
const writableTarget = (request: ModelRequest) => (JSON.parse(String(request.messages[1].content).split('：')[1]) as { writable: { target: string }[] }[])[0]!.writable[0]!.target
const toolReply = (request: ModelRequest): unknown => {
  const message = [...request.messages].reverse().find((item): item is ModelChatMessage & { role: 'tool' } => item.role === 'tool')
  return message ? JSON.parse(String(message.content)) : undefined
}
async function fixture(provider: ModelProvider, directory?: string) {
  const root = directory ?? await mkdtemp(path.join(tmpdir(), 'g20-question-'))
  if (!directory) cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(root, 'documents') })
  const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const runs = new ExecutionRunStore(path.join(root, 'runs')), events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const engine = new ExecutionEngine({ registry, gateway, runs, events, provider })
  const session = await registry.create(driver.load(new TextEncoder().encode('前文 OLD 后文')), '未保存.md')
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '改写这一段', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 3, to: 6 }] }] }
  return { root, registry, gateway, runs, events, engine, session, input }
}
function waiting(engine: ExecutionEngine) {
  const seen: ExecutionEvent[] = []
  let notify: (event: ExecutionEvent) => void = () => {}
  const unsubscribe = engine.subscribe(event => { seen.push(event); if (event.type === 'tool' && event.data.status === 'waiting') notify(event) })
  const next = () => new Promise<ExecutionEvent>(resolve => {
    const found = seen.find(event => event.type === 'tool' && event.data.status === 'waiting' && !(event as { consumed?: boolean }).consumed)
    if (found) { (found as { consumed?: boolean }).consumed = true; resolve(found) }
    else notify = event => { (event as { consumed?: boolean }).consumed = true; notify = () => {}; resolve(event) }
  })
  cleanup.push(async () => unsubscribe())
  return { seen, next }
}
async function timeline(h: Awaited<ReturnType<typeof fixture>>) {
  return (await h.events.readPage({ conversationId: 'conversation', after: 0, limit: 500 })).events
}

describe('M09-T04 built-in option-card questions', () => {
  it('waits for the chosen option, then continues the same run with exactly that choice', async () => {
    const requests: ModelRequest[] = []
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      if (requests.length === 1) { yield complete(request, [{ id: 'ask-1', name: USER_QUESTION_TOOL, argumentsText: JSON.stringify(question) }], '先确认写法。'); return }
      if (requests.length === 2) {
        const reply = toolReply(request) as { kind: string; data: { selected: { label: string }[] } }
        yield complete(request, [{ id: 'write-1', name: 'text.replace', argumentsText: JSON.stringify({ target: writableTarget(request), content: reply.data.selected[0]!.label }) }]); return
      }
      yield complete(request, [], '已按你的选择改写。')
    } }
    const h = await fixture(provider), watch = waiting(h.engine)
    const started = await h.engine.start(h.input)
    const asked = await watch.next()
    // The question tool is offered to the model, but only by this loop: not the shared catalog or external MCP.
    expect((requests[0]!.tools ?? []).map(tool => tool.name)).toContain(USER_QUESTION_TOOL)
    expect((await h.gateway.describe()).map(tool => tool.name)).not.toContain(USER_QUESTION_TOOL)
    expect(toolCatalog.map(tool => tool.name)).not.toContain(USER_QUESTION_TOOL)
    expect(asked.data.question).toEqual({ text: question.question, multiple: false, options: question.options })
    const live = await h.engine.read(started.runId)
    expect(live).toMatchObject({ status: 'running', tools: [{ call: { name: USER_QUESTION_TOOL }, state: 'executing' }] })
    expect(requests).toHaveLength(1)
    expect(watch.seen.some(event => event.type === 'run.state' && event.data.status === 'waiting' && event.data.label === '等待你的选择')).toBe(true)
    // Wrong answers are rejected and the question stays open; nothing is sent on the user's behalf.
    const callId = asked.itemId
    await expect(h.engine.answer({ runId: started.runId, callId, answer: { choices: [5] } })).rejects.toThrow('所选项不属于这个问题')
    await expect(h.engine.answer({ runId: started.runId, callId, answer: { choices: [0, 1] } })).rejects.toThrow('这个问题只能选一项')
    await expect(h.engine.answer({ runId: started.runId, callId, answer: { choices: [] } })).rejects.toThrow('请选择一项')
    await expect(h.engine.answer({ runId: started.runId, callId: 'another-call', answer: { choices: [0] } })).rejects.toThrow('不能再次回答')
    expect(requests).toHaveLength(1)
    await h.engine.answer({ runId: started.runId, callId, answer: { choices: [1] } })
    const final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed')
    expect(toolReply(requests[1]!)).toEqual({ kind: 'read', data: { status: 'answered', selected: [{ index: 1, label: '详细版' }] } })
    expect(final.tools.map(tool => tool.call.name)).toEqual([USER_QUESTION_TOOL, 'text.replace'])
    expect(h.session.read().model).toMatchObject({ source: '前文 详细版 后文' })
    // Repeating the accepted answer is a confirmation; a different late answer is refused.
    await expect(h.engine.answer({ runId: started.runId, callId, answer: { choices: [1] } })).resolves.toMatchObject({ runId: started.runId })
    await expect(h.engine.answer({ runId: started.runId, callId, answer: { choices: [0] } })).rejects.toThrow('任务已停止或已结束')
    const events = await timeline(h)
    const card = events.filter(event => event.itemId === callId)
    expect(card.map(event => event.data.status)).toEqual(['waiting', 'answered'])
    expect(card[1]!.data).toMatchObject({ toolName: USER_QUESTION_TOOL, answer: { choices: [1] }, question: { text: question.question } })
    expect(events.filter(event => event.itemId === 'run-state').map(event => event.data.status)).toEqual(['running', 'waiting', 'running'])
    expect(events.at(-1)).toMatchObject({ type: 'run.end', data: { status: 'completed' } })
  })

  it('stopping while the question is open closes it unanswered, sends nothing more and keeps the document', async () => {
    let calls = 0
    const provider: ModelProvider = { async *stream(request) {
      calls++
      yield complete(request, [{ id: 'ask-stop', name: USER_QUESTION_TOOL, argumentsText: JSON.stringify(question) }])
    } }
    const h = await fixture(provider), watch = waiting(h.engine)
    const started = await h.engine.start(h.input)
    const asked = await watch.next()
    const stopped = await h.engine.stop(started.runId)
    expect(stopped).toMatchObject({ status: 'stopped', tools: [{ state: 'returned', result: { kind: 'error', code: 'run-stopped' } }] })
    expect(calls).toBe(1)
    await expect(h.engine.answer({ runId: started.runId, callId: asked.itemId, answer: { choices: [0] } })).rejects.toThrow('任务已停止或已结束')
    expect(h.session.read()).toMatchObject({ revision: 0, model: { source: '前文 OLD 后文' } })
    const card = (await timeline(h)).filter(event => event.itemId === asked.itemId)
    expect(card.map(event => event.data.status)).toEqual(['waiting', 'cancelled'])
    expect(card[1]!.data.answer).toBeUndefined()
  })

  it('returns malformed questions to the model as an error without leaving the run partial', async () => {
    const requests: ModelRequest[] = []
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      if (requests.length === 1) {
        yield complete(request, [{ id: 'ask-bad', name: USER_QUESTION_TOOL, argumentsText: JSON.stringify({ question: '选哪个？', options: [{ label: '唯一' }] }) }]); return
      }
      yield complete(request, [], '我会按原要求继续。')
    } }
    const h = await fixture(provider), watch = waiting(h.engine)
    const final = await h.engine.wait((await h.engine.start(h.input)).runId)
    expect(final.status).toBe('completed')
    expect(final.tools[0]).toMatchObject({ state: 'returned', result: { kind: 'error', code: 'invalid-question' } })
    expect(toolReply(requests[1]!)).toMatchObject({ kind: 'error', code: 'invalid-question' })
    expect(watch.seen.some(event => event.data.status === 'waiting')).toBe(false)
  })

  it('carries free text and multiple choices exactly as given', async () => {
    const replies: unknown[] = []
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) { yield complete(request, [{ id: 'ask-other', name: USER_QUESTION_TOOL, argumentsText: JSON.stringify(question) }]); return }
      if (turn === 2) {
        replies.push(toolReply(request))
        yield complete(request, [{ id: 'ask-many', name: USER_QUESTION_TOOL, argumentsText: JSON.stringify({ question: '再加哪些？', multiple: true,
          options: [{ label: '图示' }, { label: '练习' }, { label: '小结' }] }) }]); return
      }
      replies.push(toolReply(request))
      yield complete(request)
    } }
    const h = await fixture(provider), watch = waiting(h.engine)
    const started = await h.engine.start(h.input)
    const first = await watch.next()
    await h.engine.answer({ runId: started.runId, callId: first.itemId, answer: { choices: [], other: '保持原样，只改标点' } })
    const second = await watch.next()
    expect(second.data.question).toMatchObject({ multiple: true })
    await h.engine.answer({ runId: started.runId, callId: second.itemId, answer: { choices: [2, 0] } })
    expect((await h.engine.wait(started.runId)).status).toBe('completed')
    expect(replies).toEqual([
      { kind: 'read', data: { status: 'answered', selected: [], other: '保持原样，只改标点' } },
      { kind: 'read', data: { status: 'answered', selected: [{ index: 0, label: '图示' }, { index: 2, label: '小结' }] } },
    ])
  })

  it('after a crash the open question is settled unanswered and an explicit continuation may ask again', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'g20-question-recover-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
    const continued: ModelRequest[] = []
    const provider: ModelProvider = { async *stream(request) {
      continued.push(structuredClone(request))
      if (continued.length === 1) { yield complete(request, [{ id: 'ask-again', name: USER_QUESTION_TOOL, argumentsText: JSON.stringify(question) }]); return }
      yield complete(request)
    } }
    const h = await fixture(provider, directory)
    // The durable state left by a process that died while the question was open.
    const runId = 'crashed-run', callId = 'crashed-request:0', now = Date.now()
    const crashed: ExecutionRunRecord = { schemaVersion: 1, runId, version: 3, input: h.input, budget: { maxRequests: 24, maxToolCalls: 120, maxContextBytes: 1024 * 1024 },
      status: 'running', createdAt: now, updatedAt: now, messages: [], initialMessageCount: 0,
      requests: [{ requestId: 'crashed-request', state: 'completed' }],
      tools: [{ callId, providerCallId: 'ask-crashed', requestId: 'crashed-request', call: { name: USER_QUESTION_TOOL, input: question }, state: 'executing' }] }
    await h.runs.save(crashed)
    await h.events.append({ eventId: randomUUID(), conversationId: 'conversation', taskId: 'task', runId, itemId: callId, time: now, source: 'builtin', type: 'tool', update: 'snapshot',
      data: { toolName: USER_QUESTION_TOOL, status: 'waiting', question: { text: question.question, multiple: false, options: question.options } } })
    const [recovered] = await h.engine.recover()
    expect(recovered).toMatchObject({ status: 'interrupted', tools: [{ state: 'returned', result: { kind: 'error', code: 'question-unanswered' } }] })
    await expect(h.engine.answer({ runId, callId, answer: { choices: [0] } })).rejects.toThrow('任务已停止或已结束')
    const card = (await timeline(h)).filter(event => event.itemId === callId)
    expect(card.map(event => event.data.status)).toEqual(['waiting', 'cancelled'])
    // The unanswered question is a fact, not an unknown side effect that would block asking again.
    const watch = waiting(h.engine)
    const next = await h.engine.start(h.input, { runId, facts: '' })
    const asked = await watch.next()
    const facts = String(continued[0]!.messages.find(message => message.role === 'system' && String(message.content).startsWith('显式继续先前运行'))?.content)
    expect(facts).toContain('"kind":"unanswered"')
    await h.engine.answer({ runId: next.runId, callId: asked.itemId, answer: { choices: [0] } })
    expect((await h.engine.wait(next.runId)).status).toBe('completed')
  })

  // Desktop path: the renderer answers through the same IPC request; closing the bound document revokes the task.
  const sse = (delta: unknown, finish: string) => new Response(`data: ${JSON.stringify({ id: 'wire', model: 'fixture-model',
    choices: [{ index: 0, delta, finish_reason: finish }] })}

data: [DONE]

`, { headers: { 'Content-Type': 'text/event-stream' } })
  const askOnWire = () => sse({ role: 'assistant', tool_calls: [{ index: 0, id: 'wire-ask', type: 'function',
    function: { name: USER_QUESTION_TOOL, arguments: JSON.stringify(question) } }] }, 'tool_calls')
  async function desktop(fetch: typeof globalThis.fetch) {
    const directory = await mkdtemp(path.join(tmpdir(), 'g20-question-desktop-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
    const documents = new DocumentHostService(path.join(directory, 'documents'))
    const settings = new ExecutionSettingsStore({ directory: path.join(directory, 'settings'), encryption: {
      isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString() } })
    const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
      accountId: 'account', authKind: 'api-key', billing: { kind: 'metered' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
    await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
    const service = new ExecutionDesktopService({ directory: path.join(directory, 'desktop'), documents, settings, fetch, authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
    const opened = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: opened.workspace.workspaceId }) as ConversationRecord
    const filename = path.join(directory, 'lesson.md'); await writeFile(filename, '原来的正文')
    const document = await documents.open(filename)
    const sent = await service.operate({ type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId: randomUUID(), expectedRevision: conversation.revision, text: '先问我用哪种写法', attachments: [], mode: 'queue',
      documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [{ kind: 'document' }] }] }) as ExecutionSendResult
    let callId = ''
    for (let attempt = 0; attempt < 200 && !callId; attempt++) {
      const page = await service.operate({ type: 'events', conversationId: conversation.conversationId, limit: 500 }) as ExecutionEventPage
      callId = page.events.find(event => event.type === 'tool' && event.data.status === 'waiting')?.itemId ?? ''
      if (!callId) await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(callId).not.toBe('')
    return { service, documents, document, runId: sent.run!.runId, callId }
  }

  it('answers through the desktop request and continues the same run', async () => {
    let calls = 0
    const fetch = vi.fn(async () => ++calls === 1 ? askOnWire() : sse({ role: 'assistant', content: '按你的选择继续。' }, 'stop'))
    const h = await desktop(fetch as unknown as typeof globalThis.fetch)
    const answered = await h.service.operate({ type: 'answer', runId: h.runId, callId: h.callId, answer: { choices: [0] } }) as ExecutionRunRecord
    expect(answered.runId).toBe(h.runId)
    expect(await h.service.engine.wait(h.runId)).toMatchObject({ status: 'completed', tools: [{ result: { kind: 'read', data: { selected: [{ label: '简洁版' }] } } }] })
    expect(calls).toBe(2)
  })

  it('closing the bound document while the question is open stops the task and refuses a late answer', async () => {
    const fetch = vi.fn(async () => askOnWire())
    const h = await desktop(fetch as unknown as typeof globalThis.fetch)
    expect(await h.service.stopTasksForDocument(h.document.documentId)).toMatchObject({ runIds: [h.runId] })
    expect(await h.service.engine.read(h.runId)).toMatchObject({ status: 'stopped', tools: [{ result: { kind: 'error', code: 'run-stopped' } }] })
    const late = h.service.operate({ type: 'answer', runId: h.runId, callId: h.callId, answer: { choices: [1] } })
    await expect(late).rejects.toBeInstanceOf(DesktopOperationError)
    await expect(late).rejects.toMatchObject({ code: 'execution-answer-rejected', message: '任务已停止或已结束，这个问题不能再回答。' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(h.documents.registry.get(h.document.documentId).read()).toMatchObject({ revision: 0, model: { source: '原来的正文' } })
  })
})
