import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { hasUnresolvedToolFailure, runEndSummary } from '../../src/main/workbench/execution/executionOutcome'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'

const tool = (index: number, name: string, input: unknown, result: ExecutionToolRecord['result']): ExecutionToolRecord => ({
  callId: `call-${index}`, providerCallId: `provider-${index}`, requestId: 'request',
  call: { name, input }, state: 'returned', result,
})
const run = (...tools: ExecutionToolRecord[]): ExecutionRunRecord => ({
  schemaVersion: 1, runId: 'offline-replay', version: 1, status: 'running', createdAt: 1, updatedAt: 1,
  input: { conversationId: 'conversation', taskId: 'task', instruction: '完成指定成果',
    selection: {} as ExecutionRunRecord['input']['selection'], documents: [] },
  messages: [], initialMessageCount: 0, requests: [], tools,
})
const error = (code: string): ExecutionToolRecord['result'] => ({ kind: 'error', code, message: code })
const written = (file: string): ExecutionToolRecord['result'] => ({ kind: 'read', data: {
  path: file, operationId: `write-${file}`, status: 'written', saved: true,
} })

describe('M26 R7 offline settlement replay', () => {
  it('preserves an exploratory failure as history after a receipt-backed delivery', () => {
    const record = run(tool(0, 'read', { target: 'expired-handle' }, error('invalid-target')),
      tool(1, 'file.write', { path: 'lesson.md', mode: 'create', content: '交付稿' }, written('lesson.md')))
    expect(record.tools[0]?.result).toMatchObject({ kind: 'error', code: 'invalid-target' })
    expect(hasUnresolvedToolFailure(record)).toBe(false)
  })

  it('does not let an unrelated success settle a required export failure', () => {
    const record = run(tool(0, 'document.export', { target: 'required-document', format: 'html' }, error('export-failed')),
      tool(1, 'file.write', { path: 'other.md', mode: 'create', content: '旁支' }, written('other.md')))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
    record.status = 'partial'
    expect(runEndSummary(record)).toContain('剩余工作未完成')
  })

  it('retains an unknown external write even if a later receipt appears successful', () => {
    const input = { kind: 'compute', job: 'job-1', name: 'result.txt', destination: 'result.txt' }
    const record = run(tool(0, 'artifact.save', input, { kind: 'read', data: { status: 'unknown', reason: '回执丢失' } }),
      tool(1, 'artifact.save', input, { kind: 'read', data: { status: 'written', sourceKind: 'compute',
        sourceId: 'job-1@result.txt' } }))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
  })

  it('settles a failed concrete request only when the same operation and arguments succeed', () => {
    const first = { mode: 'replace', path: 'draft.md', content: '完成', expectedVersion: 'v1' }
    const sameWithDifferentPropertyOrder = { expectedVersion: 'v1', content: '完成', path: 'draft.md', mode: 'replace' }
    const other = { mode: 'replace', path: 'other.md', content: '完成', expectedVersion: 'v1' }
    expect(hasUnresolvedToolFailure(run(tool(0, 'file.write', first, error('file-tool-failed')),
      tool(1, 'file.write', other, written('other.md'))))).toBe(true)
    expect(hasUnresolvedToolFailure(run(tool(0, 'file.write', first, error('file-tool-failed')),
      tool(1, 'file.write', sameWithDifferentPropertyOrder, written('draft.md'))))).toBe(false)
  })

  const realRelRecord = path.resolve('output/g20/rel-t11/real-4ul0ka/profile/workbench-v2/runs',
    'c81aab513db3da97fbe2fa796e89177f654af6a266358a4317b41d36ca7c556b.json')
  it.skipIf(!existsSync(realRelRecord))('recomputes tool settlement from one retained real REL-T11 run without changing its recorded partial result', () => {
    const record = JSON.parse(readFileSync(realRelRecord, 'utf8')) as ExecutionRunRecord
    expect(record.schemaVersion).toBe(1)
    expect(record.status).toBe('partial')
    expect(record.tools.map(entry => entry.call.name)).toEqual(['file.list', 'file.search', 'file.open', 'file.create', 'tools.load'])
    expect(record.tools.find(entry => entry.call.name === 'file.create')?.result).toMatchObject({
      kind: 'read', data: { operation: { status: 'success' } },
    })
    expect(hasUnresolvedToolFailure(record)).toBe(false)
    // Its model request ended unknown; successful tool receipts do not rewrite the historical run to completed.
    expect(record.failure).toMatchObject({ code: 'unsupported-tool-type', outcome: 'unknown' })
    expect(runEndSummary(record)).toContain('未能完整确认')
  })
})
