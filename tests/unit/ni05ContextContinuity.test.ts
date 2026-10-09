// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { conversationHistoryIndex } from '../../src/main/workbench/execution/ConversationHistoryIndex'
import { readContextMessage } from '../../src/main/workbench/execution/ContextReadTool'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
const selection: ModelSelection = { model: 'fixture', contextWindow: 120_000,
  connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
    accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
function complete(request: ModelRequest, calls: { id: string; name: string; argumentsText: string }[] = [], content = '结束'): ModelEvent {
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'fixture',
    finishReason: calls.length ? 'tool_calls' : 'stop', nativeResponse: {}, toolCalls: calls,
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id,
      type: 'function', function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
async function fixture(provider: ModelProvider) {
  const root = await mkdtemp(path.join(tmpdir(), 'ni05-context-')); roots.push(root)
  const driver = new MarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver],
    persistence: createDocumentJournal({ directory: path.join(root, 'documents') }), createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID), runs = new ExecutionRunStore(path.join(root, 'runs'))
  const engine = new ExecutionEngine({ registry, gateway, provider, runs, events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  const session = await registry.create(driver.load(new TextEncoder().encode('OLD\n' + 'x'.repeat(62_000) + '\nTAIL_FACT=42')), 'long.md')
  return { registry, gateway, engine, session, runs }
}

it('NI05 repeated production compaction keeps short decisions, long result tails, source coverage, and committed work without replay', async () => {
  let turns = 0
  const sourceParts: Array<{ sourceId: string; offset: number; to: number; text: string }> = []
  const modelPayloads: string[] = []
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    if (!request.tools?.length) {
      const packet = JSON.parse(String(request.messages[1]!.content))
      sourceParts.push(...packet.sources)
      const text = String(packet.previous ?? '') + packet.sources.map((source: { text: string }) => source.text).join('\n')
      const summary = [text.includes('否决重生') ? '否决重生，因为原Ready应复用。' : '',
        text.includes('TAIL_FACT=42') ? 'TAIL_FACT=42，按原来源回读。' : ''].join('\n') || '来源已存档，未改变用户授权。'
      yield complete(request, [], summary); return
    }
    modelPayloads.push(JSON.stringify(request.messages))
    const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]!)
    turns++
    if (turns === 1) { yield complete(request, [{ id: 'commit-once', name: 'text.replace', argumentsText: JSON.stringify({ target: refs[0].writable[0].target, content: 'NEW' }) }], '否决重生'); return }
    if (turns === 2) { yield complete(request, [{ id: 'long-read', name: 'read', argumentsText: JSON.stringify({ target: refs[0].target, limit: 1000 }) }]); return }
    if (turns === 3 || turns === 4) { yield complete(request, [{ id: `inspect-${turns}`, name: 'inspect', argumentsText: JSON.stringify({ target: refs[0].target }) }], '过程数据' + 'y'.repeat(180_000)); return }
    yield complete(request)
  } }
  const h = await fixture(provider)
  const started = await h.engine.start({ conversationId: 'c', taskId: 'long-task', instruction: '禁止改图。只改首词并研究长结果，复用原Ready。', selection,
    documents: [{ documentId: h.session.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] })
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.compacted?.summary).toContain('否决重生')
  expect(final.compacted?.summary).toContain('TAIL_FACT=42')
  expect(final.compacted?.summaryThroughMessage).toBeGreaterThan(final.initialMessageCount)
  expect(sourceParts.some(source => source.text === '否决重生' || source.text.startsWith('否决重生'))).toBe(true)
  expect(sourceParts.some(source => source.text.includes('TAIL_FACT=42'))).toBe(true)
  const intervals = sourceParts.map(source => `${source.sourceId}:${source.offset}:${source.to}`)
  expect(new Set(intervals).size).toBe(intervals.length)
  expect(modelPayloads.at(-1)).toContain('禁止改图')
  expect(final.tools.filter(tool => tool.call.name === 'text.replace')).toHaveLength(1)
  expect((await h.session.drain()).undoDepth).toBe(1)
  expect((await h.session.drain()).model).toMatchObject({ source: 'NEW\n' + 'x'.repeat(62_000) + '\nTAIL_FACT=42' })
  const stored = await h.runs.read(final.runId)
  expect(stored?.messages.some(message => String(message.content).includes('TAIL_FACT=42'))).toBe(true)
})

it('NI05 summary failure keeps the prior note and never advances uncompleted source coverage', async () => {
  let turns = 0, summaryCalls = 0
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    if (!request.tools?.length) { summaryCalls++; yield { type: 'response.failed', requestId: request.requestId, sequence: 1,
      failure: { outcome: 'rejected', kind: 'protocol', code: 'summary-rejected', message: 'summary unavailable' } }; return }
    const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]!)
    if (++turns <= 3) { yield complete(request, [{ id: `read-${turns}`, name: 'read', argumentsText: JSON.stringify({ target: refs[0].target, limit: 1000 }) }], 'z'.repeat(180_000)); return }
    yield complete(request)
  } }
  const h = await fixture(provider)
  const started = await h.engine.start({ conversationId: 'c', taskId: 'failed-note', instruction: '禁止重放，只读取长结果。', selection,
    documents: [{ documentId: h.session.documentId, writable: [] }] })
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(summaryCalls).toBeGreaterThan(0)
  expect(final.compacted?.summaryThroughMessage).toBeUndefined()
  expect(final.messages.some(message => String(message.content).includes('TAIL_FACT=42'))).toBe(true)
  expect(final.requests.filter(request => request.kind === 'context-summary').every(request => request.state === 'failed')).toBe(true)
  expect((await h.session.drain()).undoDepth).toBe(0)
})

it('NI05 cross-user history preserves old short constraints, explicit target updates, tail decisions and original sources', async () => {
  const run = { runId: 'r', input: { conversationId: 'c', instruction: '原要求' }, initialMessageCount: 1,
    initialPayload: { userText: { messageIndex: 0 }, explicitAttachments: [] },
    workingNote: { goal: '原要求', userConstraints: [], decisions: [{ text: '否决方案A', reason: '保持原图', sourceRefs: ['task:instruction'] }], remaining: [], openQuestions: [], risks: [] },
    compacted: { summary: '原方案A已否决；结果尾部值为42。', summaryThroughMessage: 3 }, tools: [],
    messages: [{ role: 'user', content: '禁止改图。' }, { role: 'assistant', content: '前文'.repeat(5000) + '尾部决定：改用B，保持原图。' }] } as unknown as ExecutionRunRecord
  const messages: ConversationRecord['messages'] = [
    { messageId: 'u1', role: 'user', text: '禁止改图。', attachmentIds: [], runId: 'r', createdAt: 0 },
    { messageId: 'a1', role: 'assistant', text: String(run.messages[1]!.content), attachmentIds: [], runId: 'r', createdAt: 1 },
    { messageId: 'u2', role: 'user', text: '方案A撤回，后续明确改用B；保持禁止改图。', attachmentIds: [], createdAt: 2 },
    { messageId: 'a2', role: 'assistant', text: '收到', attachmentIds: [], createdAt: 3 },
    { messageId: 'u3', role: 'user', text: '继续', attachmentIds: [], createdAt: 4 },
  ]
  const conversation = { conversationId: 'c', messages } as ConversationRecord
  const index = await conversationHistoryIndex(conversation, async () => run)
  expect(String(index.context[0]!.message.content)).toContain('禁止改图')
  expect(String(index.context[1]!.message.content)).toContain('尾部决定：改用B')
  expect(String(index.context[1]!.message.content)).toContain('否决方案A')
  expect(String(index.context[2]!.message.content)).toContain('方案A撤回')
  expect(index.context[1]!.provenance.id).toBe('run:r:1')
  const reread = readContextMessage(run.messages[1]!, { sourceId: index.context[1]!.provenance.id,
    offset: 10_000, maxChars: 100, imageIndexes: [] })
  expect(reread.data.text).toBe('尾部决定：改用B，保持原图。')
})

it('NI05 the configured compression selection owns its protocol, window, output budget and separate usage receipt', async () => {
  let turns = 0, summaryCalls = 0
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    if (!request.tools?.length) {
      summaryCalls++
      expect(request.selection.model).toBe('small-helper')
      expect(request.selection.connection.protocol).toBe('anthropic-messages')
      expect(request.selection.parameters?.max_tokens).toBe(256)
      expect(request.selection.parameters?.thinking).toMatchObject({ type: 'disabled' })
      expect(request.selection.contextWindow).toBe(20_000)
      expect(request.tools).toEqual([])
      yield { ...complete(request, [], '只保留结论、来源和禁止重放约束。'), usage: { inputTokens: 100, outputTokens: 20, raw: {} } } as ModelEvent
      return
    }
    expect(request.selection.model).toBe('fixture')
    const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]!)
    if (++turns <= 3) { yield complete(request, [{ id: `helper-read-${turns}`, name: 'read', argumentsText: JSON.stringify({ target: refs[0].target, limit: 1000 }) }], 'x'.repeat(180_000)); return }
    yield complete(request)
  } }
  const h = await fixture(provider)
  const compressionSelection: ModelSelection = { ...selection, model: 'small-helper', contextWindow: 20_000,
    connection: { ...selection.connection, id: 'small-connection', protocol: 'anthropic-messages', billing: { kind: 'metered' } },
    parameters: { max_tokens: 256, thinking: { type: 'enabled', budget_tokens: 5000 } } }
  const started = await h.engine.start({ conversationId: 'c', taskId: 'helper', instruction: '只读取；禁止重放。', selection,
    compressionSelection, documents: [{ documentId: h.session.documentId, writable: [] }] })
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(summaryCalls).toBeGreaterThan(0)
  const requests = final.requests.filter(request => request.kind === 'context-summary')
  expect(requests.every(request => request.selection?.connectionId === 'small-connection' && request.selection.model === 'small-helper'
    && request.selection.billingKind === 'metered' && request.inputTokens === 100 && request.outputTokens === 20)).toBe(true)
  expect((await h.session.drain()).undoDepth).toBe(0)
})
