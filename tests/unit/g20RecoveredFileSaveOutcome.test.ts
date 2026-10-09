import { expect, it } from 'vitest'
import { executionAuditWarnings, hasUnresolvedToolFailure } from '../../src/main/workbench/execution/executionOutcome'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'

const tool = (name: string, input: unknown, result: ExecutionToolRecord['result'], index: number):
  ExecutionToolRecord & { sourceRunId: string } => ({
  callId: `call-${index}`, providerCallId: `provider-${index}`, requestId: 'request', sourceRunId: 'origin-a',
  call: { name, input }, state: 'returned', result,
})
const run = (...tools: ExecutionToolRecord[]): ExecutionRunRecord => ({
  schemaVersion: 1, runId: 'run', version: 1, status: 'running', createdAt: 1, updatedAt: 1,
  input: { conversationId: 'conversation', taskId: 'task', instruction: '完成并保存这份文件',
    selection: {} as ExecutionRunRecord['input']['selection'], documents: [] },
  messages: [], initialMessageCount: 0, requests: [], tools,
})
const error = (code: string) => ({ kind: 'error' as const, code, message: code })

it('settles a mistaken save path only from an earlier host identity and a confirmed save of that document', () => {
  const path = 'D:\\fixture\\lesson.html'
  const opened = (name: 'file.create' | 'file.open') => tool(name,
    name === 'file.create' ? { path: 'D:\\fixture', name: 'lesson.html', kind: 'html' } : { path },
    { kind: 'read', data: { path, documentId: 'lesson', target: 'document-handle',
      ...(name === 'file.create' ? { operation: { status: 'success' } } : {}),
      text: { content: '', writableTarget: 'text-handle' } } }, 0)
  const failed = tool('file.save', { target: path }, error('invalid-target'), 1)
  const saved = (documentId = 'lesson') => tool('file.save', { target: 'document-handle' },
    { kind: 'read', data: { status: 'saved', documentId, savedRevision: 3, currentRevision: 3, dirty: false } }, 2)

  for (const name of ['file.create', 'file.open'] as const)
    expect(hasUnresolvedToolFailure(run(opened(name), failed, saved()))).toBe(false)

  const created = opened('file.create')
  expect(hasUnresolvedToolFailure(run(created, failed))).toBe(true)
  expect(hasUnresolvedToolFailure(run(created, failed, saved('other-document')))).toBe(true)
  // Saving the original file does not complete a requested Save As.
  expect(hasUnresolvedToolFailure(run(created,
    { ...failed, call: { name: 'file.save', input: { target: path, destination: 'D:\\fixture\\copy.html' } } }, saved()))).toBe(true)
  expect(hasUnresolvedToolFailure(run(created,
    { ...failed, result: error('tool-outcome-unknown') }, saved()))).toBe(true)
  // A confirmed save of the same current document remains a fact across continuation lineage.
  const continuation = run(created,
    { ...failed, sourceRunId: 'origin-b' } as ExecutionToolRecord,
    { ...saved(), sourceRunId: 'origin-b' } as ExecutionToolRecord)
  expect(hasUnresolvedToolFailure(continuation)).toBe(false)
  expect(continuation.tools[2]!.result).toMatchObject({ kind: 'read', data: {
    status: 'saved', documentId: 'lesson', savedRevision: 3, currentRevision: 3, dirty: false,
  } })
  expect(executionAuditWarnings(continuation)).toContainEqual(expect.objectContaining({ name: 'file.save' }))
  expect(continuation.tools[1]!.result).toEqual(error('invalid-target'))
})
