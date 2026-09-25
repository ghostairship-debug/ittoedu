// @vitest-environment jsdom
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolResult } from '../../src/shared/workbench/tools'

const roots: string[] = []
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe test directory')
    await rm(root, { recursive: true, force: true })
  }
})

const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }

function response(request: ModelRequest, tool?: string): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = tool ? [{ id: 'tool-call', name: tool, argumentsText: '{}' }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'fixture-response', actualModel: 'fixture-model',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: tool ? '' : '处理结束', ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}

async function runReceipt(tool: string, result: Extract<ToolResult, { kind: 'read' }>, nextTool?: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-image-tool-status-'))
  roots.push(directory)
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(driver.load(new TextEncoder().encode('原文')), '原文.md')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const execute = vi.spyOn(gateway, 'execute').mockResolvedValue(result)
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    const current = turn++
    yield response(request, current === 0 ? tool : current === 1 ? nextTool : undefined)
  } }
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const engine = new ExecutionEngine({ registry, gateway, provider, runs: new ExecutionRunStore(path.join(directory, 'runs')), events })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '处理图片', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 2 }] }] }
  const started = await engine.start(input)
  const run = await engine.wait(started.runId)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '原文' } })
  const projection = await events.snapshot('conversation')
  const event = projection.items.find(item => item.type === 'tool' && item.data.toolName === tool)
  expect(event).toBeDefined()
  const timing = await events.readTiming('conversation', 'task')
  return { run, projection, event: event!, timing }
}

it.each([
  { name: 'image.generate failed', tool: 'image.generate', result: { kind: 'read', data: { job: 'image-1', status: 'failed', stopped: false,
    resources: [], failure: { outcome: 'not-sent', kind: 'configuration', code: 'image-unsupported-image-option', message: '输出参数不支持；请求未发送。' } } },
    toolStatus: 'failed', uiStatus: '失败', uiFact: '执行失败', runStatus: 'partial', timing: 'failed' },
  { name: 'image.edit unknown', tool: 'image.edit', result: { kind: 'read', data: { job: 'image-2', status: 'unknown', stopped: false,
    resources: [], failure: { outcome: 'unknown', kind: 'transport', code: 'image-job-interrupted', message: '结果未知；未自动重发。' } } },
    toolStatus: 'unknown', uiStatus: '结果未知', uiFact: '结果未知', runStatus: 'partial', timing: 'unknown' },
  { name: 'image.edit stopped before send', tool: 'image.edit', result: { kind: 'read', data: { job: 'image-stopped', status: 'stopped', stopped: true,
    resources: [], failure: { outcome: 'not-sent', kind: 'aborted', code: 'image-stopped-before-send', message: '任务已停止；成果未应用。' } } },
    toolStatus: 'stopped', uiStatus: '已停止', uiFact: '已停止', runStatus: 'partial', timing: 'stopped' },
  { name: 'image.generate stopped after send with unknown outcome', tool: 'image.generate', result: { kind: 'read', data: { job: 'image-stopped-unknown', status: 'unknown', stopped: true,
    resources: [], failure: { outcome: 'unknown', kind: 'aborted', code: 'image-stopped-after-send', message: '图片请求已停止等待，结果和费用未知；未自动重发。' } } },
    toolStatus: 'unknown', uiStatus: '结果未知', uiFact: '结果未知', runStatus: 'partial', timing: 'unknown' },
  { name: 'image.generate ready but unapplied', tool: 'image.generate', result: { kind: 'read', data: { job: 'image-3', status: 'ready', stopped: false,
    resources: [{ resource: 'image-resource', mimeType: 'image/png', width: 32, height: 32, byteLength: 128 }] } },
    toolStatus: 'ready', uiStatus: '已生成', uiFact: '已生成', runStatus: 'completed', timing: 'ready' },
  { name: 'ordinary read with a status field', tool: 'read', result: { kind: 'read', data: { status: 'failed', source: 'business data' } },
    toolStatus: 'completed', uiStatus: '已完成', uiFact: '已运行', runStatus: 'completed', timing: 'returned' },
  { name: 'image.status queries a failed job', tool: 'image.status', result: { kind: 'read', data: { job: 'image-4', status: 'failed', stopped: false } },
    toolStatus: 'completed', uiStatus: '已完成', uiFact: '已运行', runStatus: 'completed', timing: 'returned' },
] as const)('image service result is settled truthfully: $name', async ({ tool, result, toolStatus, uiStatus, uiFact, runStatus, timing }) => {
  const { run, projection, event, timing: marks } = await runReceipt(tool, result)
  expect(event.data.status).toBe(toolStatus)
  expect(run.status).toBe(runStatus)
  expect(marks.find(mark => mark.stage === 'tool.finished')?.detail?.outcome).toBe(timing)
  const visibleText = event.content.filter(content => content.kind === 'text').map(content => content.text).join('')
  if (toolStatus === 'ready') expect(visibleText).toBe('图片已生成，尚未应用到文档')
  if (toolStatus === 'failed' || toolStatus === 'unknown') expect(visibleText).not.toBe('已收到正式结果')
  render(<ExecutionTimeline projection={projection} />)
  const card = screen.getByRole('article', { name: '工具执行' })
  expect(card.querySelector('summary span')?.textContent).toContain(uiStatus)
  const details = card.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  expect(within(card).getByText(uiFact)).toBeInTheDocument()
  expect(within(card).getByText('未确认应用')).toBeInTheDocument()
})

it.each([false, true])('does not resend an unknown image operation under a fresh model call ID when stopped=%s', async stopped => {
  const { run } = await runReceipt('image.generate', { kind: 'read', data: { job: 'image-unknown', status: 'unknown', stopped,
    resources: [], failure: { outcome: 'unknown', kind: stopped ? 'aborted' : 'transport', code: 'image-job-interrupted', message: '结果未知；未自动重发。' } } }, 'image.edit')
  expect(run.tools).toHaveLength(2)
  expect(run.tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'unknown' } })
  expect(run.tools[1]?.result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
  expect(run.status).toBe('partial')
})
