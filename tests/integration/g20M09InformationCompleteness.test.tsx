// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  cleanup()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

const selection: ModelSelection = { model: 'fixture-model', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
  accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-ref' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'supported' },
} }

function completion(request: ModelRequest, responseId: string, content: string, sequence: number, call?: { id: string; name: string; argumentsText: string }): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence, type: 'response.completed', responseId, actualModel: 'fixture-model',
    nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls: call ? [call] : [],
    assistant: { role: 'assistant', content, ...(call ? { tool_calls: [{ id: call.id, type: 'function',
      function: { name: call.name, arguments: call.argumentsText } }] } : {}) } }
}

it('M09-T01 preserves actual built-in reasoning, tool input/output and document diff through Engine, durable events and expanded Timeline', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m09-completeness-'))
  roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  const original = '未授权前文|旧段落|未授权后文'
  const from = original.indexOf('旧段落')
  const document = await host.internalAPI.create({ kind: 'markdown', source: original, resources: { assets: {}, components: {} } }, 'draft.md')
  const eventsDirectory = path.join(root, 'events')
  const events = new ExecutionEventStore({ directory: eventsDirectory })
  const privateMarker = 'sk-FIXTUREONLY123456'
  const nestedSecret = '{"api_key":"FIXTURE_SECRET_123"}'
  const networkPath = String.raw`\\fixture-host\share\private.txt`
  const replacement = `新段落 ${privateMarker} ${nestedSecret} ${networkPath}`
  let requests = 0
  let sentArguments = ''
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests === 1) {
      const references = JSON.parse(String(request.messages[1].content).split('：')[1]) as { writable: { target: string }[] }[]
      const call = { id: 'provider-call', name: 'text.replace',
        argumentsText: JSON.stringify({ target: references[0]!.writable[0]!.target, content: replacement }) }
      sentArguments = call.argumentsText
      yield { requestId: request.requestId, sequence: 1, type: 'response.started', responseId: 'first', actualModel: 'fixture-model' }
      yield { requestId: request.requestId, sequence: 2, type: 'reasoning.delta', text: '公开思考摘要' }
      yield { requestId: request.requestId, sequence: 3, type: 'text.delta', text: '准备替换。' }
      yield { requestId: request.requestId, sequence: 4, type: 'tool.delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.argumentsText }
      yield completion(request, 'first', '准备替换。', 5, call)
    } else yield completion(request, 'second', '已检查。', 1)
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events })
  const started = await engine.start({ conversationId: 'conversation', taskId: 'task', instruction: '将旧段落替换成新段落', selection,
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from, to: from + '旧段落'.length }] }] })
  const run = await engine.wait(started.runId)
  expect(run.status).toBe('completed')
  expect(requests).toBe(2)
  expect(run.tools[0]?.call.input).toMatchObject({ content: replacement })
  expect((await host.internalAPI.read(document.documentId)).model).toMatchObject({ source: original.replace('旧段落', replacement) })

  const reopened = new ExecutionEventStore({ directory: eventsDirectory })
  const persisted = (await reopened.readPage({ conversationId: 'conversation', limit: 100 })).events
  const projection = await reopened.snapshot('conversation')
  const reasoning = projection.items.find(item => item.runId === run.runId && item.type === 'reasoning')
  const tool = projection.items.find(item => item.runId === run.runId && item.type === 'tool')
  const persistedTool = persisted.find(event => event.runId === run.runId && event.type === 'tool' && event.data.output)
  expect(reasoning?.content).toEqual([{ kind: 'text', text: '公开思考摘要' }])
  expect(projection.items.filter(item => item.type === 'text').flatMap(item => item.content)
    .some(part => part.kind === 'text' && part.text.includes('公开思考摘要'))).toBe(false)
  expect(tool?.data).toMatchObject({ toolName: 'text.replace', status: 'returned', applicationStatus: 'applied' })
  expect(tool?.data.output).toContain('applied')
  expect(persistedTool?.data.output).toContain('applied')

  render(<ExecutionTimeline projection={projection} />)
  const reasoningCard = screen.getByRole('article', { name: '模型提供的思考' })
  const toolCard = screen.getByRole('article', { name: '工具执行' })
  for (const card of [reasoningCard, toolCard]) {
    const details = card.querySelector('details')!
    act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  }
  expect(within(reasoningCard).getByText('公开思考摘要')).toBeInTheDocument()
  expect(within(toolCard).getByRole('region', { name: '工具输出' })).toHaveTextContent('applied')

  // The Provider's complete arguments and the host's before/after content are
  // independently known above. A generic status line or raw receipt alone is insufficient.
  const sourceInput = JSON.parse(sentArguments) as { target: string; content: string }
  const visibleInput = JSON.parse(persistedTool!.data.input!) as { target: string; content: string }
  expect(visibleInput.target).toBe(sourceInput.target)
  expect(visibleInput.content).toContain('新段落')
  expect(visibleInput.content).toContain('[网络路径]')
  expect(visibleInput.content).toContain('[已隐藏]')
  expect.soft(persistedTool?.data.diff).toEqual(expect.stringContaining('旧段落'))
  expect.soft(persistedTool?.data.diff).toEqual(expect.stringContaining('新段落'))
  expect.soft(tool?.data.input).toBe(persistedTool?.data.input)
  expect.soft(tool?.data.diff).toEqual(expect.stringContaining('旧段落'))
  expect.soft(tool?.data.diff).toEqual(expect.stringContaining('新段落'))
  expect(tool?.data.diff).not.toContain('未授权前文')
  expect(tool?.data.diff).not.toContain('未授权后文')
  const inputSection = within(toolCard).queryByRole('region', { name: '参数' })
  const diffSection = within(toolCard).queryByRole('region', { name: '实际差异' })
  expect.soft(inputSection).toBeInTheDocument()
  expect.soft(diffSection).toBeInTheDocument()
  if (inputSection) expect.soft(inputSection).toHaveTextContent('新段落')
  if (diffSection) {
    expect.soft(diffSection).toHaveTextContent('旧段落')
    expect.soft(diffSection).toHaveTextContent('新段落')
  }
  expect(JSON.stringify(persisted)).not.toContain(privateMarker)
  expect(JSON.stringify(persisted)).not.toContain('FIXTURE_SECRET_123')
  expect(JSON.stringify(persisted)).not.toContain('fixture-host')
  expect(JSON.stringify(persisted)).not.toContain('未授权前文')
  expect(JSON.stringify(persisted)).not.toContain('未授权后文')
  expect(JSON.stringify(projection)).not.toContain(privateMarker)
  expect(toolCard).not.toHaveTextContent(privateMarker)
  await events.readTiming('conversation', 'task')
})

it('M09-T01 keeps a raw failure in the internal run record while redacting the persisted terminal event', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m09-terminal-redaction-'))
  roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  const eventsDirectory = path.join(root, 'events')
  const events = new ExecutionEventStore({ directory: eventsDirectory })
  const failure = `上游失败 sk-TERMINALONLY123456 {"api_key":"FIXTURE_SECRET_123"} ${String.raw`\\fixture-host\share\private.txt`}`
  const provider: ModelProvider = { async *stream(request) {
    yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'not-sent', kind: 'configuration', code: 'fixture-failure', message: failure } }
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events })
  const started = await engine.start({ conversationId: 'conversation', taskId: 'failed-task', instruction: '检查失败展示',
    selection, documents: [] })
  const run = await engine.wait(started.runId)
  expect(run.status).toBe('failed')
  expect(run.failure?.message).toBe(failure)
  const reopened = new ExecutionEventStore({ directory: eventsDirectory })
  const terminal = (await reopened.readPage({ conversationId: 'conversation' })).events.find(event => event.type === 'run.end')
  expect(terminal?.data.status).toBe('failed')
  expect(terminal?.data.text).toContain('上游失败')
  expect(terminal?.data.text).toContain('[网络路径]')
  expect(JSON.stringify(terminal)).not.toContain('sk-TERMINALONLY123456')
  expect(JSON.stringify(terminal)).not.toContain('FIXTURE_SECRET_123')
  expect(JSON.stringify(terminal)).not.toContain('fixture-host')
  await events.readTiming('conversation', 'failed-task')
})
