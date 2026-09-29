import { describe, expect, it } from 'vitest'
import { hasUnresolvedToolFailure, runEndSummary } from '../../src/main/workbench/execution/executionOutcome'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'

const tool = (name: string, input: unknown, result: ExecutionToolRecord['result'], index: number): ExecutionToolRecord => ({
  callId: `call-${index}`, providerCallId: `provider-${index}`, requestId: 'request',
  call: { name, input }, state: 'returned', result,
})
const run = (...tools: ExecutionToolRecord[]): ExecutionRunRecord => ({
  schemaVersion: 1, runId: 'run', version: 1, status: 'running', createdAt: 1, updatedAt: 1,
  input: { conversationId: 'conversation', taskId: 'task', instruction: '完成这份文件的修改',
    selection: {} as ExecutionRunRecord['input']['selection'], documents: [] },
  budget: { maxRequests: null, maxToolCalls: null, maxContextBytes: 10000 },
  messages: [], initialMessageCount: 0, requests: [], tools,
})
const error = (code: string) => ({ kind: 'error' as const, code, message: code })
const written = (path: string) => ({ kind: 'read' as const, data: { path, status: 'written', saved: true } })

describe('M26 R7 receipt-based settlement', () => {
  it('resolves a failed concrete request only after the same operation and arguments succeed', () => {
    const input = { mode: 'replace', path: 'draft.md', content: '完成', expectedVersion: 'v1' }
    const record = run(tool('file.write', input, error('file-tool-failed'), 0), tool('file.write', input, written('draft.md'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(false)
  })
  it('keeps a failed requested write partial when a different file succeeds', () => {
    const record = run(tool('file.write', { path: 'required.md', mode: 'create', content: 'A' }, error('file-tool-failed'), 0),
      tool('file.write', { path: 'other.md', mode: 'create', content: 'B' }, written('other.md'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
    record.status = 'partial'
    expect(runEndSummary(record)).toContain('剩余工作未完成')
  })
  it('retains diagnostic failure history without marking a verified delivery partial', () => {
    const record = run(tool('read', { target: 'bad-handle' }, error('invalid-target'), 0),
      tool('file.write', { path: 'draft.md', mode: 'create', content: '完成' }, written('draft.md'), 1))
    expect(record.tools[0]!.result).toMatchObject({ kind: 'error', code: 'invalid-target' })
    expect(hasUnresolvedToolFailure(record)).toBe(false)
  })
  it('does not downgrade a delivered file because an earlier model call had malformed arguments', () => {
    const record = run(tool('file.write', null, error('invalid-tool-arguments'), 0),
      tool('file.write', { path: 'chart.svg', mode: 'create', content: '<svg />' }, written('chart.svg'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(false)
  })
  it('does not mistake an unrelated read for recovery from malformed delivery arguments', () => {
    const record = run(tool('file.write', null, error('invalid-tool-arguments'), 0),
      tool('file.read', { path: 'other.md' }, { kind: 'read', data: { content: 'unrelated' } }, 1))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
  })
  it('keeps a required delivery failure partial after an unrelated document edit', () => {
    const record = run(tool('file.save', { documentId: 'required' }, error('save-failed'), 0),
      tool('file.write', { path: 'other.md', mode: 'create', content: '完成' }, written('other.md'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
  })
  it('never treats an unknown side effect as recovered by another receipt', () => {
    const input = { path: 'required.md', mode: 'create', content: 'A' }
    const record = run(tool('file.write', input, error('file-create-outcome-unknown'), 0),
      tool('file.write', input, written('required.md'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
  })
  it('keeps a durable running image job pending until the matching owner reports ready', () => {
    const pending = tool('image.generate', { prompt: '图一' }, { kind: 'read', data: { job: 'image-one', status: 'running' } }, 0)
    const unrelated = tool('job.wait', { kind: 'image', job: 'image-other' }, { kind: 'read', data: {
      kind: 'image', jobId: 'image-other', status: 'ready', terminal: true,
    } }, 1)
    expect(hasUnresolvedToolFailure(run(pending, unrelated))).toBe(true)
    const ready = tool('job.wait', { kind: 'image', job: 'image-one' }, { kind: 'read', data: {
      kind: 'image', jobId: 'image-one', status: 'ready', terminal: true,
    } }, 2)
    expect(hasUnresolvedToolFailure(run(pending, unrelated, ready))).toBe(false)
  })
  it('keeps running compute partial until the same restricted job returns ready', () => {
    const pending = tool('compute.run', { code: 'print(1)' }, { kind: 'read', data: { job: 'compute-one', status: 'preparing' } }, 0)
    expect(hasUnresolvedToolFailure(run(pending))).toBe(true)
    const ready = tool('job.status', { kind: 'compute', job: 'compute-one' }, { kind: 'read', data: {
      kind: 'compute', jobId: 'compute-one', status: 'ready', terminal: true,
    } }, 1)
    expect(hasUnresolvedToolFailure(run(pending, ready))).toBe(false)
  })
  it('settles a pending owner only when its own artifact is actually saved', () => {
    const pending = tool('compute.run', { code: 'print(1)' }, { kind: 'read', data: {
      job: 'compute-one', status: 'running',
    } }, 0)
    const other = tool('artifact.save', { kind: 'compute', job: 'compute-two', name: 'result.txt', destination: 'other.txt' },
      { kind: 'read', data: { status: 'written', sourceKind: 'compute', sourceId: 'compute-two@result.txt' } }, 1)
    expect(hasUnresolvedToolFailure(run(pending, other))).toBe(true)
    const delivered = tool('artifact.save', { kind: 'compute', job: 'compute-one', name: 'result.txt', destination: 'result.txt' },
      { kind: 'read', data: { status: 'written', sourceKind: 'compute', sourceId: 'compute-one@result.txt' } }, 2)
    expect(hasUnresolvedToolFailure(run(pending, other, delivered))).toBe(false)
  })
  it('keeps delegation pending until the parent verifies and reads its own candidate', () => {
    const delegated = tool('delegate.start', { goal: 'prepare a report', expectedArtifacts: ['report.md'] },
      { kind: 'read', data: { job: 'delegate-one', status: 'ready' } }, 0)
    const ready = tool('job.wait', { kind: 'delegation', job: 'delegate-one' }, { kind: 'read', data: {
      kind: 'delegation', jobId: 'delegate-one', status: 'ready', terminal: true,
    } }, 1)
    expect(hasUnresolvedToolFailure(run(delegated, ready))).toBe(true)
    const other = tool('delegate.read', { job: 'delegate-other', name: 'report.md' }, { kind: 'read', data: {
      status: 'read', job: 'delegate-other', name: 'report.md', verifiedBytes: true,
    } }, 2)
    expect(hasUnresolvedToolFailure(run(delegated, ready, other))).toBe(true)
    const verified = tool('delegate.read', { job: 'delegate-one', name: 'report.md' }, { kind: 'read', data: {
      status: 'read', job: 'delegate-one', name: 'report.md', verifiedBytes: true,
    } }, 3)
    expect(hasUnresolvedToolFailure(run(delegated, ready, other, verified))).toBe(false)
  })
})
