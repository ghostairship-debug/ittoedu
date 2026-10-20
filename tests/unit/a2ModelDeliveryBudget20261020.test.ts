// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { boundedModelValue, boundedToolResult, MODEL_DELIVERY_BYTES, modelJsonBytes, type ModelValuePage } from '../../src/core/tools/modelDeliveryBudget'
import { projectExecutionContext, projectFinalDeliveryContext } from '../../src/main/workbench/execution/ExecutionContextProjection'
import { estimateSerializedTokens, modelContextBudget } from '../../src/core/execution/modelContextBudget'
import { readProgrammaticResult } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { serializeModelPayload } from '../../src/main/workbench/providers/ModelProviderRouter'
import type { ModelChatMessage, ModelJsonObject, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ProgrammaticJournalEntry } from '../../src/shared/workbench/programmatic'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ProgrammaticToolRunner } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import type { ModelEvent, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'

const protocols = ['openai-chat', 'openai-responses', 'chatgpt-responses', 'anthropic-messages'] as const
const selection = (protocol: ModelSelection['connection']['protocol']): ModelSelection => ({
  model: 'local-budget-fixture', outputLimit: 2048, connection: {
    id: 'local-fixture', revision: 1, provider: 'fixture', protocol,
    baseURL: protocol === 'chatgpt-responses' ? CHATGPT_RESPONSES_BASE_URL : 'https://fixture.invalid/v1',
    accountId: 'fixture-account', auth: { kind: protocol === 'chatgpt-responses' ? 'oauth' : 'api-key', credentialRef: 'unused' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' },
  },
})

function journal(value: unknown): ProgrammaticJournalEntry[] {
  return [{ callId: 'parent', call: { name: 'programmatic.execute', input: { code: 'return retainedValue' } },
    result: { kind: 'read', data: { value, status: 'completed' } } }]
}
function page(records: ProgrammaticJournalEntry[], path: (string | number)[], offset?: number, limit?: number) {
  const result = readProgrammaticResult({ callId: 'parent', path, ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) }, records)
  expect(result.kind).toBe('read')
  return (result as Extract<ToolResult, { kind: 'read' }>).data as ModelValuePage
}

describe('A2 final model delivery uses bounded data while retaining native continuation', () => {
  it.each(protocols)('bounds the newest %s tool outputs in the actual serialized request without changing calls or originals', protocol => {
    const name = modelToolWireName('file.read')
    const inputs: ModelJsonObject[] = [{ target: 'actual-target', source: '真实参数😀'.repeat(250) }, { target: 'second-target', offset: 7 }]
    const calls = inputs.map((input, index) => ({ id: `call-${index}`, type: 'function' as const,
      function: { name, arguments: JSON.stringify(input) } }))
    const assistant: ModelChatMessage = { role: 'assistant', content: '继续读取原结果', tool_calls: calls }
    if (protocol === 'openai-responses' || protocol === 'chatgpt-responses') {
      assistant.nativeResponses = { protocol, responseId: 'native-response', output: [
        { type: 'reasoning', id: 'reasoning', encrypted_content: 'opaque-encrypted-reasoning', signature: { opaque: 'signature😀' } },
        ...calls.map(call => ({ type: 'function_call', call_id: call.id, name, arguments: call.function.arguments })),
      ] }
    } else if (protocol === 'anthropic-messages') {
      assistant.nativeAnthropic = { content: [
        { type: 'thinking', thinking: '原始思考', signature: 'opaque-thinking-signature😀' },
        { type: 'redacted_thinking', data: 'opaque-redacted-state' },
        ...calls.map((call, index) => ({ type: 'tool_use', id: call.id, name, input: inputs[index]! })),
      ] }
    } else assistant.reasoning_content = '原生推理内容😀'
    const huge = JSON.stringify({ kind: 'read', data: { text: '源码😀\\\"\n'.repeat(18_000), status: 'partial', errorCount: 3 } })
    const messages: ModelChatMessage[] = [{ role: 'system', content: '保留用户目标' }, { role: 'user', content: '读取两个来源' }, assistant,
      { role: 'tool', tool_call_id: 'call-0', content: huge },
      { role: 'tool', tool_call_id: 'call-1', content: '{"kind":"read","data":{"text":"small complete output"}}' }]
    const before = structuredClone(messages), projected = projectFinalDeliveryContext('a2-run', messages)
    const wire = JSON.parse(serializeModelPayload({ selection: selection(protocol), messages: projected })) as Record<string, any>
    let outputs: { id: string; text: string }[]
    if (protocol === 'openai-chat') {
      expect(wire.messages[2]).toEqual(assistant)
      outputs = wire.messages.filter((message: any) => message.role === 'tool').map((message: any) => ({ id: message.tool_call_id, text: message.content }))
    } else if (protocol === 'anthropic-messages') {
      expect(wire.messages[1].content).toEqual((assistant.nativeAnthropic as ModelJsonObject).content)
      const blocks = wire.messages.flatMap((message: any) => message.content).filter((block: any) => block.type === 'tool_result')
      outputs = blocks.map((block: any) => ({ id: block.tool_use_id, text: block.content[0].text }))
      expect(wire.messages[1].content.filter((block: any) => block.type === 'tool_use').map((block: any) => block.id)).toEqual(outputs.map(output => output.id))
    } else {
      expect(wire.input.slice(1, 4)).toEqual((assistant.nativeResponses as ModelJsonObject).output)
      outputs = wire.input.filter((item: any) => item.type === 'function_call_output').map((item: any) => ({ id: item.call_id, text: item.output }))
      expect(wire.input.filter((item: any) => item.type === 'function_call').map((item: any) => item.call_id)).toEqual(outputs.map(output => output.id))
    }
    expect(outputs.map(output => output.id)).toEqual(['call-0', 'call-1'])
    expect(Buffer.byteLength(outputs[0]!.text, 'utf8')).toBeLessThanOrEqual(MODEL_DELIVERY_BYTES)
    expect(JSON.parse(outputs[0]!.text).modelDelivery).toMatchObject({ complete: false, sourceId: 'run:a2-run:3',
      read: { tool: 'context.read', input: { sourceId: 'run:a2-run:3' } } })
    expect(outputs[1]!.text).toBe(messages[4]!.content)
    expect(projected[2]).toEqual(before[2])
    expect(messages).toEqual(before)
    expect(messages[3]!.content).toBe(huge)
  })

  it('bounds only host-identified data messages and preserves the complete human instruction', () => {
    const host = '宿主返回的数据😀'.repeat(15_000), human = '人类补充要求必须原样保留😀'.repeat(8000)
    const messages: ModelChatMessage[] = [{ role: 'user', content: host }, { role: 'user', content: human }]
    const before = structuredClone(messages), projected = projectFinalDeliveryContext('host-data', messages, MODEL_DELIVERY_BYTES, new Set([0]))
    expect(Buffer.byteLength(String(projected[0]!.content), 'utf8')).toBeLessThanOrEqual(MODEL_DELIVERY_BYTES)
    expect(JSON.parse(String(projected[0]!.content)).modelDelivery.sourceId).toBe('run:host-data:0')
    expect(projected[1]).toEqual(before[1])
    expect(messages).toEqual(before)
  })
})

describe('A2 bounded value readback retains complete owner data', () => {
  it('reconstructs a long escaped Unicode string using its exact nextOffset without splitting a surrogate pair', () => {
    const source = '开头😀\n\\\"中段'.repeat(8000) + '尾部不能丢失😀'
    const records = journal(source), before = structuredClone(records), path = ['data', 'value']
    let offset = 0, recovered = '', pages = 0
    do {
      const current = page(records, path, offset)
      expect(modelJsonBytes(current)).toBeLessThanOrEqual(MODEL_DELIVERY_BYTES)
      expect(current).toMatchObject({ path, offset, total: source.length })
      expect(typeof current.value).toBe('string')
      const text = current.value as string
      expect(text).toBe(source.slice(offset, offset + text.length))
      expect(text).not.toMatch(/[\uD800-\uDBFF]$/)
      recovered += text; pages++
      if (current.complete) break
      expect(current.nextOffset).toBe(offset + text.length)
      expect(current.nextOffset!).toBeGreaterThan(offset)
      offset = current.nextOffset!
    } while (pages < 100)
    expect(pages).toBeGreaterThan(1)
    expect(recovered).toBe(source)
    const internal = readProgrammaticResult({ callId: 'parent', path }, records, { internal: true })
    expect(internal).toEqual({ kind: 'read', data: { callId: 'parent', path, value: source } })
    expect(records).toEqual(before)
  })

  it('reports the absolute path of one huge array item and reads the omitted string range from that source', () => {
    const text = '单项内容😀'.repeat(12_000), source = [{ text: 'before' }, { text }, { text: 'after' }]
    const records = journal(source), before = structuredClone(records), path = ['data', 'value']
    const current = page(records, path, 1, 1)
    expect(current.complete).toBe(false)
    expect(current.value).toEqual([expect.objectContaining({ text: expect.any(String) })])
    const omission = current.omitted?.find(item => JSON.stringify(item.path) === JSON.stringify([...path, 1, 'text']))
    expect(omission).toMatchObject({ path: [...path, 1, 'text'], type: 'string', total: text.length, nextOffset: expect.any(Number) })
    const excerpt = (current.value as { text: string }[])[0]!.text
    expect(omission!.nextOffset).toBe(excerpt.length)
    const next = page(records, omission!.path, omission!.nextOffset, 200)
    expect(next.value).toBe(text.slice(excerpt.length, excerpt.length + 200))
    expect(next.path).toEqual([...path, 1, 'text'])
    expect(readProgrammaticResult({ callId: 'parent', path }, records, { internal: true })).toEqual({ kind: 'read', data: { callId: 'parent', path, value: source } })
    expect(records).toEqual(before)
  })

  it('pages object keys exactly and keeps a large nested property addressable', () => {
    const source = { intro: 'first', large: { body: '对象正文😀'.repeat(10_000), status: 'failed' }, tail: 'last' }
    const before = structuredClone(source), path = ['data', 'value']
    const first = boundedModelValue(source, { path, limit: 1 })
    expect(first).toMatchObject({ value: { intro: 'first' }, complete: false, nextOffset: 1, total: 3 })
    const second = boundedModelValue(source, { path, offset: first.nextOffset, limit: 1 })
    expect(second.omitted).toEqual(expect.arrayContaining([expect.objectContaining({ path: [...path, 'large', 'body'], type: 'string' })]))
    expect(second.value).toMatchObject({ large: { status: 'failed' } })
    const last = boundedModelValue(source, { path, offset: 2, limit: 1 })
    expect(last).toMatchObject({ value: { tail: 'last' }, complete: true, offset: 2 })
    expect(modelJsonBytes(second)).toBeLessThanOrEqual(MODEL_DELIVERY_BYTES)
    expect(source).toEqual(before)
  })

  it('keeps diagnostic severity totals and error identity visible instead of treating omitted failures as success', () => {
    const diagnostics = Array.from({ length: 120 }, (_, index) => ({ severity: index % 3 === 0 ? 'error' : index % 3 === 1 ? 'warning' : 'info', message: '诊断详情😀'.repeat(100) }))
    const result: ToolResult = { kind: 'read', data: { text: '长正文'.repeat(30_000), status: 'failed', diagnostics,
      errors: [{ level: 'fatal', message: '真实致命错误' }], failures: [{ severity: 'custom', message: '未知严重性仍计数' }] } }
    const before = structuredClone(result), source = { sourceId: 'run:owner:7', tool: 'context.read', input: { sourceId: 'run:owner:7' } }
    const bounded = boundedToolResult('file.read', result, source) as ToolResult & { modelDelivery: { complete: boolean; diagnostics: unknown; source: unknown } }
    expect(modelJsonBytes(bounded)).toBeLessThanOrEqual(MODEL_DELIVERY_BYTES)
    expect(bounded).toMatchObject({ kind: 'read', data: { status: 'failed' }, modelDelivery: { complete: false, source,
      diagnostics: { total: 122, severities: { error: 40, warning: 40, info: 40, fatal: 1, unspecified: 1 } } } })
    expect(result).toEqual(before)
    const error: ToolResult = { kind: 'error', code: 'actual-owner-failure', message: '失败详情😀'.repeat(20_000) }
    const publicError = boundedToolResult('file.read', error, source)
    expect(publicError).toMatchObject({ kind: 'error', code: 'actual-owner-failure' })
    expect(modelJsonBytes(publicError)).toBeLessThanOrEqual(MODEL_DELIVERY_BYTES)
    const small: ToolResult = { kind: 'read', data: { ok: true } }
    expect(boundedToolResult('file.read', small)).toBe(small)
  })
})

it('grants complete readback only to the actual executing PTC child in the real Engine', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'a2-internal-read-'))
  try {
    const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
    const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
    const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
    const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    const body = '原始大值😀\n'.repeat(20_000)
    let turns = 0, source: { runId: string; callId: string; path: (string | number)[] } | undefined
    const complete = (request: ModelRequest, id?: string, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> => {
      const calls = id ? [{ id, name: name!, argumentsText: JSON.stringify(input) }] : []
      return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${turns}`,
        nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
        assistant: { role: 'assistant', content: calls.length ? '' : '已核对原始值', ...(calls.length ? { tool_calls: calls.map(call => ({
          id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText },
        })) } : {}) } }
    }
    const provider: ModelProvider = { async *stream(request): AsyncGenerator<ModelEvent> {
      turns++
      if (turns === 1) { yield complete(request, 'seed', 'programmatic.execute', { code: 'seed full value' }); return }
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      if (turns === 2) {
        source = receipt.data.valueRead.input
        yield complete(request, 'aggregate', 'programmatic.execute', { code: 'read original internally' }); return
      }
      if (turns === 3) {
        expect(receipt).toMatchObject({ kind: 'read', data: { value: { length: body.length, tail: body.slice(-31) } } })
        // A model-visible read of the same exact source has no internal bypass.
        yield complete(request, 'direct-read', 'programmatic.read', source); return
      }
      expect(receipt).toMatchObject({ kind: 'read', data: { complete: false, total: body.length } })
      expect(receipt.data.value).toBe(body.slice(0, receipt.data.nextOffset))
      expect(receipt.data.value.length).toBeLessThan(body.length)
      yield complete(request)
    } }
    const programmatic = new ProgrammaticToolRunner({ execute: async input => {
      if (input.code === 'seed full value') return { status: 'completed', value: body }
      const result = await input.call('programmatic.read', source!)
      expect(result).toMatchObject({ kind: 'read', data: { value: body } })
      return { status: 'completed', value: { length: (result as any).data.value.length, tail: (result as any).data.value.slice(-31) } }
    } })
    const engine = new ExecutionEngine({ registry, gateway, runs, events, provider, programmatic })
    const started = await engine.start({ conversationId: 'a2-conversation', taskId: 'a2-task', instruction: '读取已有值，不做修改',
      selection: { ...selection('openai-chat'), contextWindow: 128_000 }, documents: [], workspaceRoot: directory })
    const final = await engine.wait(started.runId)
    expect(final.failure).toBeUndefined()
    expect(final.status).toBe('completed')
    expect(final.requests.at(-1)).toMatchObject({ state: 'completed', finishReason: 'stop' })
    expect(final.tools.every(tool => tool.state === 'returned' && tool.result?.kind === 'read')).toBe(true)
    expect(turns).toBe(4)
    const child = final.tools.find(tool => tool.origin === 'host' && tool.call.name === 'programmatic.read')
    expect(child?.result).toMatchObject({ kind: 'read', data: { value: body } })
    expect(final.tools.filter(tool => tool.call.name === 'programmatic.execute')).toHaveLength(2)
  } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) }
})

it('reduces the newest multi-tool round to the real Engine request window without repeating reads', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'a2-aggregate-budget-'))
  try {
    const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
    const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
    const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
    const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    const body = '汉'.repeat(5000), session = await registry.create(driver.load(new TextEncoder().encode(body)), 'source.md')
    const model = { ...selection('openai-chat'), contextWindow: 32_768 }
    let turns = 0, actualNextTokens = 0, originalArguments: string[] = []
    const provider: ModelProvider = { async *stream(request): AsyncGenerator<ModelEvent> {
      turns++
      if (turns === 1) {
        const context = request.messages.find(message => message.role === 'system' && typeof message.content === 'string'
          && message.content.startsWith('本次固定文档与权限（切换界面不改变它们）：'))!
        const target = JSON.parse(String(context.content).split('：')[1])[0].target
        const calls = Array.from({ length: 4 }, (_, index) => ({ id: `read-${index}`, name: 'read', argumentsText: JSON.stringify({ target }) }))
        originalArguments = calls.map(call => call.argumentsText)
        yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'four-reads', nativeResponse: {},
          finishReason: 'tool_calls', toolCalls: calls, assistant: { role: 'assistant', content: '', tool_calls: calls.map(call => ({
            id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText },
          })) } }
        return
      }
      actualNextTokens = estimateSerializedTokens(serializeModelPayload(request))
      expect(actualNextTokens).toBeLessThanOrEqual(modelContextBudget(request.selection).inputTokens)
      const outputs = request.messages.filter(message => message.role === 'tool')
      expect(outputs.map(message => message.tool_call_id)).toEqual(['read-0', 'read-1', 'read-2', 'read-3'])
      expect(outputs.every(message => JSON.parse(String(message.content)).modelDelivery.complete === false)).toBe(true)
      const calls = request.messages.find(message => message.role === 'assistant' && Array.isArray(message.tool_calls))!.tool_calls as ModelJsonObject[]
      expect(calls.map(call => (call.function as ModelJsonObject).arguments)).toEqual(originalArguments)
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'read-once-complete', nativeResponse: {},
        finishReason: 'stop', toolCalls: [], assistant: { role: 'assistant', content: '已获得片段，需要时按来源续读。' } }
    } }
    const engine = new ExecutionEngine({ registry, gateway, runs, events, provider })
    const started = await engine.start({ conversationId: 'a2-aggregate', taskId: 'a2-aggregate', instruction: '读取该文档四次作比较，不做修改',
      selection: model, documents: [{ documentId: session.documentId, writable: [] }], workspaceRoot: directory })
    const final = await engine.wait(started.runId)
    expect(final.failure).toBeUndefined()
    expect(turns).toBe(2)
    expect(final.tools).toHaveLength(4)
    expect(final.tools.every(tool => tool.call.name === 'read' && tool.result?.kind === 'read' && (tool.result.data as any).text === body)).toBe(true)
    expect(final.tools.every(tool => modelJsonBytes(tool.result) < MODEL_DELIVERY_BYTES)).toBe(true)
    const original = projectExecutionContext(final.runId, final.messages, final.initialMessageCount).messages
    expect(estimateSerializedTokens(serializeModelPayload({ selection: model, messages: original }))).toBeGreaterThan(modelContextBudget(model).inputTokens)
    expect(actualNextTokens).toBeGreaterThan(0)
    expect(session.read().revision).toBe(0)
  } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) }
})
