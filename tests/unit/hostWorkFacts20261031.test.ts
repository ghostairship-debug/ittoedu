// @vitest-environment node
import { expect, it } from 'vitest'
import { hostWorkFactSignature } from '../../src/main/workbench/execution/hostWorkFacts'
import type { ExecutionCompletionIssue } from '../../src/main/workbench/execution/executionOutcome'

const pending: ExecutionCompletionIssue = { callId: 'create-job', name: 'delegate.agent', status: 'pending',
  job: 'delegate-scene', kind: 'delegation', message: '正在形成候选', requestId: 'query-1', receiptCallId: 'poll-1' }
const signature = (issues: ExecutionCompletionIssue[]) => hostWorkFactSignature('remainingOperations', issues)

it('ignores only known job polling identities without rewriting the receipt', () => {
  const later = { ...pending, requestId: 'query-2', receiptCallId: 'poll-2' }
  expect(signature([later])).toBe(signature([pending]))
  expect(later.receiptCallId).toBe('poll-2')
  expect(signature([{ ...later, status: 'unverified', message: '候选已完成，需回读' }])).not.toBe(signature([pending]))
  expect(signature([{ ...later, message: '新的业务阻断' }])).not.toBe(signature([pending]))
})

it('retains distinct unknown effects and non-job operation identities', () => {
  expect(signature([{ ...pending, status: 'unknown', receiptCallId: 'unknown-1' }]))
    .not.toBe(signature([{ ...pending, status: 'unknown', receiptCallId: 'unknown-2' }]))
  const write: ExecutionCompletionIssue = { callId: 'save', name: 'project.save', status: 'unsaved', message: '仍待保存',
    documentId: 'document', receiptCallId: 'write-1' }
  expect(signature([write])).not.toBe(signature([{ ...write, receiptCallId: 'write-2' }]))
})

it('does not classify or discard free-text collaboration or working-note changes', () => {
  expect(hostWorkFactSignature('workingNote', { requestId: 'authored-1', text: '参数需要核对' }))
    .not.toBe(hostWorkFactSignature('workingNote', { requestId: 'authored-2', text: '参数需要核对' }))
})
