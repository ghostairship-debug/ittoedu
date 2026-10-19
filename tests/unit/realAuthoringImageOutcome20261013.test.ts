// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  executionAuditWarnings, executionCompletionIssues, executionExitDecision, runningExecutionJobs, runEndSummary,
} from '../../src/main/workbench/execution/executionOutcome'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'

const tool = (name: string, data: unknown, index: number): ExecutionToolRecord => ({
  callId: `call-${index}`, providerCallId: `provider-${index}`, requestId: 'request',
  call: { name, input: {} }, state: 'returned', result: { kind: 'read', data },
})
const run = (...tools: ExecutionToolRecord[]): ExecutionRunRecord => ({
  schemaVersion: 1, runId: 'image-outcome', version: 1, status: 'partial', createdAt: 1, updatedAt: 1,
  input: { conversationId: 'conversation', taskId: 'task', instruction: '创作并保存互动演示',
    selection: {} as ExecutionRunRecord['input']['selection'], documents: [] },
  messages: [], initialMessageCount: 0, requests: [], tools,
})

describe('image status settlement from the same job owner', () => {
  it('settles the real authoring sequence: old running status, terminal ready, media application and current save', () => {
    const oldStatus = tool('image.status', { job: 'image-one', status: 'running', stopped: false, resources: [] }, 7)
    const applied: ExecutionToolRecord = { ...tool('media.insert', {}, 16), result: { kind: 'document-operation',
      result: { status: 'applied', documentId: 'lesson', operationId: 'insert-image', beforeRevision: 1,
        revision: 2, persistence: 'recoverable', appliedChanges: { changes: [], affectedTargets: [] } }, affected: [] } }
    const record = run(
      tool('image.generate', { job: 'image-one', status: 'preparing', stopped: false, resources: [] }, 4), oldStatus,
      tool('job.wait', { kind: 'image', jobId: 'image-one', status: 'running', terminal: false }, 8),
      tool('job.wait', { kind: 'image', jobId: 'image-one', status: 'ready', terminal: true,
        snapshot: { resources: [{ id: 'image-one@image.png' }] } }, 9), applied,
      tool('file.save', { status: 'saved', documentId: 'lesson', epoch: 'lesson-epoch', savedRevision: 2,
        currentRevision: 2, dirty: false, path: 'D:\\fixture\\lesson.glx' }, 21),
    )
    const original = structuredClone(record)
    expect(executionCompletionIssues(record)).toEqual([])
    expect(runningExecutionJobs(record)).toEqual([])
    expect(executionExitDecision(record).status).toBe('completed')
    expect(runEndSummary(record)).not.toContain('图片作业仍在运行')
    expect(record).toEqual(original)
    expect(record.status).toBe('partial')
    expect(oldStatus.result).toMatchObject({ data: { status: 'running' } })
  })

  it('keeps a different job pending and waits once for the producer and its repeated pending status', () => {
    const record = run(
      tool('image.generate', { job: 'image-one', status: 'running' }, 0),
      tool('image.status', { job: 'image-one', status: 'running' }, 1),
      tool('job.wait', { kind: 'image', jobId: 'image-other', status: 'ready', terminal: true }, 2),
    )
    expect(executionCompletionIssues(record)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'image.status', job: 'image-one', status: 'pending' }),
    ]))
    expect(executionExitDecision(record).status).toBe('continue')
    expect(runningExecutionJobs(record)).toEqual([{ kind: 'image', job: 'image-one', callId: 'call-0' }])
  })

  it('stops waiting after a definite failed terminal job while retaining the failure receipt and missing image result', () => {
    const failed = tool('job.wait', { kind: 'image', jobId: 'image-one', status: 'failed', terminal: true,
      snapshot: { failure: { outcome: 'failed', message: '供应商拒绝请求' } } }, 2)
    const record = run(tool('image.generate', { job: 'image-one', status: 'preparing' }, 0),
      tool('image.status', { job: 'image-one', status: 'running' }, 1), failed)
    expect(runningExecutionJobs(record)).toEqual([])
    expect(executionExitDecision(record)).toMatchObject({ status: 'continue', continuable: [expect.objectContaining({ name: '交付', status: 'unverified' })],
      remaining: [expect.objectContaining({ name: '交付', status: 'unverified' })] })
    expect(executionAuditWarnings(record)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'image.status', status: 'failed' }),
    ]))
    expect(record.tools[2]).toBe(failed)
    expect(failed.result).toMatchObject({ data: { status: 'failed', snapshot: { failure: { message: '供应商拒绝请求' } } } })
  })

  it('keeps an unknown job outcome unresolved, including an original unknown status followed by ready', () => {
    const pending = tool('image.status', { job: 'image-one', status: 'running' }, 0)
    const unknown = tool('job.wait', { kind: 'image', jobId: 'image-one', status: 'unknown', terminal: true,
      snapshot: { failure: { outcome: 'unknown' } } }, 1)
    expect(executionExitDecision(run(pending, unknown))).toMatchObject({ status: 'continue',
      remaining: expect.arrayContaining([expect.objectContaining({ name: 'image.status', status: 'unknown', job: 'image-one' })]) })
    const originalUnknown = tool('image.status', { job: 'image-one', status: 'unknown', failure: { outcome: 'unknown' } }, 0)
    const ready = tool('job.wait', { kind: 'image', jobId: 'image-one', status: 'ready', terminal: true }, 1)
    expect(executionExitDecision(run(originalUnknown, ready))).toMatchObject({ status: 'continue',
      remaining: expect.arrayContaining([expect.objectContaining({ name: 'image.status', status: 'unknown' })]) })
  })
})
