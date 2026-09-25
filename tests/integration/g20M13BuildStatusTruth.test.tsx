// @vitest-environment jsdom
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
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
const output = path.resolve('output/g20/m13/build-status-truth')
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

function response(request: ModelRequest, tool?: 'build.check' | 'build.compile'): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = tool ? [{ id: 'build-call', name: tool, argumentsText: JSON.stringify({ job: 'staged-job' }) }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'fixture-response', actualModel: 'fixture-model',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: tool ? '' : '检查结束', ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}

async function runBuildReceipt(tool: 'build.check' | 'build.compile', result: Extract<ToolResult, { kind: 'read' }>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-m13-build-status-'))
  roots.push(directory)
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(driver.load(new TextEncoder().encode('原文')), '原文.md')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const execute = vi.spyOn(gateway, 'execute').mockResolvedValue(result)
  let turn = 0
  const provider: ModelProvider = { async *stream(request) { yield response(request, turn++ === 0 ? tool : undefined) } }
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const engine = new ExecutionEngine({ registry, gateway, provider, runs: new ExecutionRunStore(path.join(directory, 'runs')), events })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '检查暂存代码', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 2 }] }] }
  const started = await engine.start(input)
  const run = await engine.wait(started.runId)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '原文' } })
  const projection = await events.snapshot('conversation')
  const event = projection.items.find(item => item.type === 'tool' && item.data.toolName === tool)
  expect(event).toBeDefined()
  await events.readTiming('conversation', 'task') // Wait for diagnostic writes before removing this Windows fixture.
  return { run, projection, event: event! }
}

it.each([
  { key: 'check-failed', name: 'failed build.check', tool: 'build.check', result: { kind: 'read', data: { job: 'staged-job', status: 'failed' } },
    toolStatus: 'failed', uiStatus: '失败', uiFact: '执行失败', runStatus: 'partial', runLabel: '部分完成' },
  { key: 'check-ready', name: 'ready build.check', tool: 'build.check', result: { kind: 'read', data: { job: 'staged-job', status: 'ready', prepared: true, artifact: 'candidate-artifact' } },
    toolStatus: 'completed', uiStatus: '已完成', uiFact: '已运行', runStatus: 'completed', runLabel: '已完成' },
  { key: 'compile-failed', name: 'failed build.compile', tool: 'build.compile', result: { kind: 'read', data: { ok: false, stage: 'syntax-checked', message: '语法编译失败' } },
    toolStatus: 'failed', uiStatus: '失败', uiFact: '执行失败', runStatus: 'partial', runLabel: '部分完成' },
] as const)('M13-T02 projects $name as the actual tool and run outcome', async ({ key, tool, result, toolStatus, uiStatus, uiFact, runStatus, runLabel }) => {
  const { run, projection, event } = await runBuildReceipt(tool, result)
  expect(event.data.status).toBe(toolStatus)
  expect(run.status).toBe(runStatus)
  if (toolStatus === 'failed') expect('text' in event.data ? event.data.text : undefined).not.toBe('已收到正式结果')
  render(<ExecutionTimeline projection={projection} />)
  const card = screen.getByRole('article', { name: '工具执行' })
  expect(card.querySelector('summary span')?.textContent).toContain(uiStatus)
  const details = card.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  expect(within(card).getByText(uiFact)).toBeInTheDocument()
  expect(within(card).getByText('未确认应用')).toBeInTheDocument()
  expect(screen.getByRole('article', { name: '任务结果' }).querySelector('header span')?.textContent).toContain(runLabel)
  mkdirSync(output, { recursive: true })
  writeFileSync(path.join(output, `${key}.json`), JSON.stringify({ tool, serviceReceipt: result, toolEvent: { status: event.data.status,
    text: 'text' in event.data ? event.data.text : undefined }, runStatus: run.status,
    visible: { toolStatus: uiStatus, toolFact: uiFact, runLabel, documentApplication: '未确认应用' },
    limitation: 'The gateway read receipt is an injected contract fixture; this verifies the actual ExecutionEngine event and ExecutionTimeline text projection, not a full ControlledBuildService run.' }, null, 2))
})
