// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import type { ToolResult } from '../../src/shared/workbench/tools'

const selection: ModelSelection = { model: 'local-execution-facts', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
  accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused-local-fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' },
} }
function complete(request: ModelRequest, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = name ? [{ id: request.requestId, name, argumentsText: JSON.stringify(input) }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'local-response',
    actualModel: selection.model, nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls.map(call => ({
      id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText },
    })) } : {}) } }
}

async function fixture(mode: 'unverified' | 'unusable' | 'lost-ack' | 'missing-receipt') {
  const directory = await mkdtemp(path.join(tmpdir(), 'audit-execution-facts-'))
  try {
    const workspaceRoot = path.join(directory, 'workspace'); await mkdir(workspaceRoot)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const document = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Facts'),
      resources: { assets: {}, components: {} } }, 'facts.h5lesson')
    const css = '.lesson { color: blue; }', input = { path: 'theme.css', content: css }
    const originalExecute = host.tools.execute.bind(host.tools), originalLookup = host.tools.lookup.bind(host.tools)
    const raw: ToolResult[] = [], lost: { runId: string; callId: string; operationId: string }[] = []
    const lookup = vi.spyOn(host.tools, 'lookup').mockImplementation(async (runId, callId, call) => {
      if (mode === 'missing-receipt' && lost.some(item => item.runId === runId && item.callId === callId)) return null
      return originalLookup(runId, callId, call)
    })
    const execute = vi.spyOn(host.tools, 'execute').mockImplementation(async (...args) => {
      const result = await originalExecute(...args)
      if (args[2].name !== 'project.apply' || result.kind !== 'read') return result
      raw.push(structuredClone(result))
      const apply = result.data as ContentApplyResult
      if (raw.length === 1 && (mode === 'lost-ack' || mode === 'missing-receipt')) {
        lost.push({ runId: args[0], callId: args[1], operationId: apply.receipt!.operationId })
        return { ...result, data: { ...apply, commit: 'unknown', usability: 'unverified', receipt: undefined } }
      }
      return { ...result, data: { ...apply, usability: mode === 'unusable' ? 'unusable' : 'unverified' } }
    })
    let turn = 0
    const requests: ModelRequest[] = []
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      yield ++turn === 1 ? complete(request, 'tools.load', { families: ['content'] })
        : turn === 2 ? complete(request, 'project.read', { path: 'theme.css' })
          : turn === 3 || turn === 4 && (mode === 'lost-ack' || mode === 'missing-receipt')
            ? complete(request, 'project.apply', input)
            : turn === 4 || turn === 5 ? complete(request, 'project.read', { path: 'theme.css' }) : complete(request)
    } }
    const runs = new ExecutionRunStore(path.join(directory, 'runs'))
    const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    const observed: ExecutionEvent[] = []
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs, events })
    engine.subscribe(event => observed.push(event))
    const started = await engine.start({ conversationId: 'facts', taskId: 'facts', instruction: '修改主题并读取结果',
      selection, workspaceRoot, permission: 'workspace', documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
    const finished = await engine.wait(started.runId)
    const snapshot = await host.internalAPI.read(document.documentId)
    const applied = finished.tools.filter(item => item.call.name === 'project.apply')
    expect(snapshot).toMatchObject({ revision: 1, undoDepth: 1, model: { project: { theme: { css } } } })
    expect(finished.tools.filter(item => item.call.name === 'project.read').at(-1)!.result).toMatchObject({ kind: 'read', data: { content: css } })
    expect(finished.tools.at(-1)!.call.name).toBe('project.read')
    return { finished, applied, observed, requests, raw, lost,
      executeCalls: execute.mock.calls.map(args => ({ runId: args[0], callId: args[1], name: args[2].name })),
      lookupCalls: lookup.mock.calls.map(args => ({ runId: args[0], callId: args[1], name: args[2].name })),
      operationIds: raw.flatMap(result => result.kind === 'read' ? [(result.data as ContentApplyResult).receipt!.operationId] : []) }
  } finally {
    vi.restoreAllMocks()
    const resolved = path.resolve(directory), expectedRoot = path.resolve(tmpdir()) + path.sep
    if (!resolved.startsWith(expectedRoot)) throw new Error('Unexpected fixture cleanup path')
    await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
}

it('continues observation after committed + unverified and publishes the nested canonical commit', async () => {
  const { finished, applied, observed } = await fixture('unverified')
  expect(finished.status).toBe('completed')
  expect(applied[0]!.result).toMatchObject({ kind: 'read', data: { commit: 'committed', usability: 'unverified' } })
  expect(observed.filter(event => event.type === 'document.commit')).toMatchObject([{ data: { status: 'applied', revision: 1 } }])
  expect(observed.filter(event => event.itemId === applied[0]!.callId).at(-1)!.data).toMatchObject({ applicationStatus: 'applied', revision: 1 })
})
it('keeps a committed unusable result partial while preserving its commit event and subsequent observation', async () => {
  const { finished, observed } = await fixture('unusable')
  expect(finished.status).toBe('partial')
  expect(observed.filter(event => event.type === 'document.commit')).toMatchObject([{ data: { status: 'applied', revision: 1 } }])
  expect(observed.find(event => event.type === 'run.end')!.data.text).toContain('已保留 1 项正式文档修改')
})
it('confirms a lost nested ACK by original lookup, clears the guard and never replays the original write', async () => {
  const { finished, applied, observed, lost, executeCalls, lookupCalls, requests, operationIds } = await fixture('lost-ack')
  expect(finished.status).toBe('completed')
  expect(lost).toHaveLength(1)
  const original = lost[0]!
  expect(executeCalls.filter(call => call.runId === original.runId && call.callId === original.callId)).toHaveLength(1)
  expect(lookupCalls.filter(call => call.runId === original.runId && call.callId === original.callId).length).toBeGreaterThanOrEqual(2)
  expect(operationIds[0]).toBe(original.operationId)
  expect(applied[0]!.result).toMatchObject({ kind: 'read', data: { commit: 'committed', usability: 'unverified', receipt: { operationId: original.operationId, revision: 1 } } })
  expect(applied[1]!.result).toMatchObject({ kind: 'read', data: { commit: 'unchanged', receipt: { revision: 1 } } })
  expect(observed.filter(event => event.type === 'document.commit' && event.data.operationId === original.operationId)).toHaveLength(1)
  expect(requests.at(-1)!.messages.some(message => typeof message.content === 'string' && message.content.includes('已按原操作编号查证'))).toBe(true)
})
it('keeps a missing original receipt unknown and blocks a new call from replaying that write', async () => {
  const { finished, applied, observed, executeCalls, lookupCalls, lost } = await fixture('missing-receipt')
  expect(finished.status).toBe('partial')
  expect(applied[0]!.result).toMatchObject({ kind: 'read', data: { commit: 'unknown' } })
  expect(applied[1]!.result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
  expect(executeCalls.filter(call => call.name === 'project.apply')).toHaveLength(1)
  expect(lookupCalls.some(call => call.callId === lost[0]!.callId)).toBe(true)
  expect(observed.filter(event => event.type === 'document.commit')).toHaveLength(0)
})
