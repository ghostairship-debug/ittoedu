// @vitest-environment node
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeTaskRunner, type NativeExecutionEnginePort } from '../../src/main/workbench/delegation/NativeTaskRunner'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import type { SpeechSelectionSnapshot } from '../../src/shared/workbench/speechSettings'

it('inherits accepted speech identity into children and resumes the original child without adopting a newer parent route', async () => {
  const connection = { id: 'speech-api', revision: 3, provider: 'fixture', protocol: 'openai-chat' as const,
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key' as const, credentialRef: 'fixture-only' },
    billing: { kind: 'metered' as const }, capabilities: { tools: 'supported' as const, vision: 'supported' as const, stream: 'supported' as const, reasoning: 'unknown' as const } }
  const accepted: SpeechSelectionSnapshot = { selection: { connectionId: connection.id, model: 'gpt-4o-mini-tts', voice: 'coral', format: 'mp3' }, connection }
  const input: ExecutionStart = { conversationId: 'parent', taskId: 'parent', instruction: 'parent', documents: [], permission: 'workspace',
    selection: { model: 'text-only', connection }, speechSelection: structuredClone(accepted) }
  const record = (runId: string, start: ExecutionStart, status: ExecutionRunRecord['status']): ExecutionRunRecord => ({
    schemaVersion: 1, version: 1, runId, input: structuredClone(start), status, createdAt: 1, updatedAt: 1,
    messages: [], initialMessageCount: 0, requests: [], tools: [],
  })
  const parent = record('parent', input, 'running'), records = new Map<string, ExecutionRunRecord>([['parent', parent]])
  const inputs: ExecutionStart[] = []
  const open = async (start: ExecutionStart, onPrepared?: (record: ExecutionRunRecord) => Promise<void>) => {
    inputs.push(structuredClone(start)); const run = record(`child-${inputs.length}`, start, 'running')
    records.set(run.runId, run); await onPrepared?.(run); return run
  }
  const engine: NativeExecutionEnginePort = { read: async id => records.get(id) ?? null,
    start: async (start, _continuation, onPrepared) => open(start, onPrepared), resume: async (_id, start, onPrepared) => open(start, onPrepared),
    wait: async id => { const run = records.get(id)!; run.status = 'completed'; return run },
    stop: async () => null, subscribe: () => () => {}, message: vi.fn(),
  }
  const runner = new NativeTaskRunner({ engine: () => engine })
  const request = { runId: 'parent', jobId: 'job', taskId: 'child-task', copyRoot: path.resolve('output', 'speech-inheritance-fixture'),
    permission: 'workspace' as const, intent: { goal: 'fixture', outputs: [] }, sources: [] }
  const first = await runner.run(request)
  expect(first.status).toBe('verified'); expect(inputs[0].speechSelection).toEqual(accepted)
  parent.input.speechSelection = { selection: { ...accepted.selection!, model: 'gpt-4o-mini-tts-new', voice: 'nova' },
    connection: { ...connection, revision: 4 } }
  expect((await runner.run({ ...request, jobId: 'resume', resumeRunId: first.childRunId })).status).toBe('verified')
  expect(inputs[1].speechSelection).toEqual(accepted)
  delete records.get(first.childRunId!)!.input.speechSelection
  await runner.run({ ...request, jobId: 'legacy-resume', resumeRunId: first.childRunId })
  expect(inputs[2].speechSelection).toEqual({ unavailableReason: '任务接受时未配置GPT语音' })
  delete parent.input.speechSelection
  await runner.run({ ...request, jobId: 'legacy-parent' })
  expect(inputs[3].speechSelection).toEqual({ unavailableReason: '任务接受时未配置GPT语音' })
})
