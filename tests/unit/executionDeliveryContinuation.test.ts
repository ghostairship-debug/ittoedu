// @vitest-environment node
import { expect, it } from 'vitest'
import frozen from '../fixtures/execution-delivery-continuation/staged-layout-v1.json'
import { continuationDocumentIds } from '../../src/main/workbench/execution/savedDocumentBinding'
import { executionExitDecision, newFileDeliveryFacts, runEndSummary, type SettledExecutionRun } from '../../src/main/workbench/execution/executionOutcome'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

function fixture() {
  const prior: ExecutionRunRecord = {
    schemaVersion: 1, runId: frozen.prior.runId, version: 1, status: 'partial', createdAt: 1, updatedAt: 1,
    input: { conversationId: 'frozen-conversation', taskId: 'frozen-task', instruction: '完成本次框架交付',
      documents: [], selection: {} as ExecutionRunRecord['input']['selection'] },
    messages: [], initialMessageCount: 0, requests: [],
    documentBindings: structuredClone(frozen.prior.documentBindings) as ExecutionRunRecord['documentBindings'],
    tools: structuredClone(frozen.prior.tools) as unknown as ExecutionToolRecord[],
  }
  const current: ExecutionRunRecord = { ...prior, runId: frozen.current.runId, taskContinuedFrom: prior.runId,
    documentBindings: structuredClone(frozen.current.documentBindings) as ExecutionRunRecord['documentBindings'],
    tools: structuredClone(frozen.current.tools) as unknown as ExecutionToolRecord[] }
  const snapshots = structuredClone(frozen.documents) as unknown as DocumentSnapshot[]
  const record: SettledExecutionRun = { ...current, tools: [...prior.tools, ...current.tools],
    continuationDocumentIds: continuationDocumentIds([prior, current], snapshots),
    currentDocuments: Object.fromEntries(snapshots.map(snapshot => [snapshot.documentId,
      { epoch: snapshot.epoch, revision: snapshot.revision, dirty: snapshot.dirty }])) }
  return { prior, current, snapshots, record }
}

it('settles the frozen created revision 6 from the same saved work at revision 41 without rewriting either run or its receipts', () => {
  const { prior, current, record } = fixture(), before = structuredClone([prior, current])
  expect(newFileDeliveryFacts(record)).toMatchObject([{ documentId: frozen.documents[0].documentId, revision: 41, savedRevision: 41 }])
  expect(executionExitDecision(record)).toMatchObject({ status: 'completed', remaining: [], continuable: [] })
  expect([prior, current]).toEqual(before)
  expect(record.status).toBe('partial')
})

it('keeps the old creation unsaved when no continuation identity has been proved', () => {
  const { record } = fixture()
  delete record.continuationDocumentIds
  expect(executionExitDecision(record)).toMatchObject({ status: 'continue',
    remaining: [expect.objectContaining({ name: 'project.save', status: 'unsaved', documentId: Object.keys(frozen.prior.documentBindings)[0] })] })
})

it('does not use another work at the same path to settle the original creation', () => {
  const { prior, current, snapshots, record } = fixture()
  if (snapshots[0].model.kind !== 'course-v10') throw new Error('Expected frozen course')
  snapshots[0].model.project.id = 'a-different-work'
  record.continuationDocumentIds = continuationDocumentIds([prior, current], snapshots)
  expect(record.continuationDocumentIds.size).toBe(0)
  expect(executionExitDecision(record).remaining).toContainEqual(expect.objectContaining({ name: 'project.save', status: 'unsaved' }))
})

it('keeps revision 42 unsaved when the same continued work has only a revision 41 save', () => {
  const { current, record } = fixture()
  const nextWrite = structuredClone(current.tools[0])
  if (nextWrite.result?.kind !== 'document-operation' || nextWrite.result.result.status !== 'applied') throw new Error('Expected frozen canonical write')
  nextWrite.callId = 'later-write-42'
  nextWrite.result.result.revision = 42
  record.tools.push(nextWrite)
  record.currentDocuments![frozen.documents[0].documentId] = { epoch: frozen.documents[0].epoch, revision: 42, dirty: true }
  expect(newFileDeliveryFacts(record)).toMatchObject([{ revision: 42, savedRevision: 41 }])
  expect(executionExitDecision(record).remaining).toContainEqual(expect.objectContaining({ name: 'project.save', status: 'unsaved' }))
})

it('retains an unknown original side effect and does not change a stopped run while settling its saved work', () => {
  const { record } = fixture()
  record.status = 'stopped'
  record.tools.push({ callId: 'original-unknown-write', providerCallId: 'original-unknown-write', requestId: 'original-request',
    call: { name: 'file.write', input: { mode: 'create', path: 'unconfirmed.md', content: '未知写入' } }, state: 'returned',
    result: { kind: 'error', code: 'file-create-outcome-unknown', message: '原副作用尚未确认' } })
  const before = structuredClone(record)
  expect(executionExitDecision(record)).toMatchObject({ status: 'continue',
    remaining: [expect.objectContaining({ callId: 'original-unknown-write', status: 'unknown' })],
    continuable: [expect.objectContaining({ callId: 'original-unknown-write', status: 'unknown' })] })
  expect(record).toEqual(before)
  expect(record.status).toBe('stopped')
})

it('keeps a continued revision-zero PPTX import out of the empty-course scaffold summary', () => {
  const { prior, record } = fixture()
  const imported = structuredClone(prior.tools[0])
  imported.call.name = 'course.importPptx'
  if (imported.result?.kind !== 'read') throw new Error('Expected frozen file receipt')
  imported.result.data = { ...(imported.result.data as object), status: 'saved' }
  record.status = 'stopped'
  record.tools = [imported]
  record.currentDocuments![frozen.documents[0].documentId] = { epoch: frozen.documents[0].epoch, revision: 0, dirty: false }
  expect(newFileDeliveryFacts(record)).toMatchObject([{ documentId: frozen.documents[0].documentId, revision: null }])
  expect(runEndSummary(record)).not.toContain('仅有创建回执、未见课件内容提交')
})
