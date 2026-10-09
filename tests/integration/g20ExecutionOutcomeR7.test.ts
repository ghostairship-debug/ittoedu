// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, textDataEdit } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { htmlImportReceiptResult } from '../../src/core/tools/HtmlImportTools'
import { executionExitDecision, hasUnresolvedToolFailure, newFileDeliveryFacts, persistedToolWork, runEndSummary, serviceToolOutcome, toolFailed } from '../../src/main/workbench/execution/executionOutcome'
import { applicationEventFacts, committedFact } from '../../src/main/workbench/execution/executionToolFacts'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'
import { modelToolResult } from '../../src/core/tools/modelToolResult'

const tool = (name: string, input: unknown, result: ExecutionToolRecord['result'], index: number): ExecutionToolRecord => ({
  callId: `call-${index}`, providerCallId: `provider-${index}`, requestId: 'request',
  call: { name, input }, state: 'returned', result,
})
const run = (...tools: ExecutionToolRecord[]): ExecutionRunRecord => ({
  schemaVersion: 1, runId: 'run', version: 1, status: 'running', createdAt: 1, updatedAt: 1,
  input: { conversationId: 'conversation', taskId: 'task', instruction: '完成这份文件的修改',
    selection: {} as ExecutionRunRecord['input']['selection'], documents: [] },
  messages: [], initialMessageCount: 0, requests: [], tools,
})
const error = (code: string) => ({ kind: 'error' as const, code, message: code })
const written = (path: string) => ({ kind: 'read' as const, data: { path, status: 'written', saved: true, dirty: false,
  operationId: 'file-owner-write', beforeVersion: 'before-version', afterVersion: 'owner-version' } })
const createdWrite = (path: string) => ({ kind: 'read' as const, data: { path, saved: true, afterVersion: 'owner-version',
  operation: { operationId: 'file-owner-create', status: 'success', items: [{ status: 'success', targetPath: path }], affectedPaths: [path] } } })
const fileWrite = (entry: ExecutionToolRecord, path: string) => ({ ...entry, effectPaths: [path] })
const authoredWrite = (entry: ExecutionToolRecord, paths: string[][]) => ({ ...entry,
  writeScopes: [{ documentId: 'lesson', epoch: 'lesson-epoch', paths }] })
const expectAuditWarnings = (record: ExecutionRunRecord, ...failures: ExecutionToolRecord[]) => {
  expect(executionExitDecision(record)).toMatchObject({
    warnings: expect.arrayContaining(failures.map(failure => expect.objectContaining({ name: failure.call.name,
      callId: failure.callId, requestId: failure.requestId, receiptCallId: failure.callId, status: 'failed' }))) })
  for (const failure of failures) expect(record.tools).toContainEqual(failure)
}
const expectCompletedWithWarnings = (record: ExecutionRunRecord, ...failures: ExecutionToolRecord[]) => {
  expectAuditWarnings(record, ...failures)
  expect(hasUnresolvedToolFailure(record)).toBe(false)
  expect(executionExitDecision(record)).toMatchObject({ status: 'completed', remaining: [], continuable: [] })
}
const expectMissingResultWithWarnings = (record: ExecutionRunRecord, ...failures: ExecutionToolRecord[]) => {
  expectAuditWarnings(record, ...failures)
  expect(hasUnresolvedToolFailure(record)).toBe(true)
  expect(executionExitDecision(record)).toMatchObject({ status: 'partial', continuable: [],
    remaining: [expect.objectContaining({ name: '交付', status: 'unverified' })] })
}

describe('M26 R7 receipt-based settlement', () => {
  it('keeps definite write failures as warnings without requiring path-scoped retries', () => {
    const failed = { ...tool('file.write', { mode: 'create', path: 'lesson/plan.md', content: '策划' }, error('file-tool-failed'), 0),
      rejectedCreationPath: 'C:/fixture/lesson/plan.md' }
    const later = fileWrite(tool('file.write', { mode: 'create', path: 'lesson/plan.md', content: '策划修订' }, createdWrite('C:/fixture/lesson/plan.md'), 2), 'C:/fixture/lesson/plan.md')
    expect(toolFailed(failed.call.name, failed.result)).toBe(true)
    expectMissingResultWithWarnings(run(failed, tool('file.mkdir', { name: 'lesson' }, { kind: 'read', data: { status: 'created' } }, 1)), failed)
    expectCompletedWithWarnings(run(failed, later), failed)
    expectCompletedWithWarnings(run(failed, { ...later, effectPaths: ['C:/other/lesson/plan.md'], result: createdWrite('C:/other/lesson/plan.md') }), failed)
    expectMissingResultWithWarnings(run(failed, { ...later, result: { kind: 'read', data: { path: 'C:/fixture/lesson/plan.md', saved: false } } }), failed)
    expect(hasUnresolvedToolFailure(run({ ...failed, result: error('file-create-outcome-unknown') }, later))).toBe(true)
  })
  it('settles a corrected file from the canonical file owner even when content and path representation change', () => {
    const input = { mode: 'replace', path: 'draft.md', content: '完成', expectedVersion: 'v1' }
    const record = run(fileWrite(tool('file.write', input, error('file-tool-failed'), 0), 'C:/fixture/draft.md'),
      fileWrite(tool('file.write', { ...input, path: 'C:/fixture/draft.md', content: '修订完成', expectedVersion: 'v2' },
        written('C:/fixture/draft.md'), 1), 'C:/fixture/draft.md'))
    expectCompletedWithWarnings(record, record.tools[0]!)
  })
  it('keeps a designated export missing when a different file succeeds', () => {
    const requested = { ...tool('task.delivery', { format: 'html-offline', destination: 'C:/fixture/required.html' }, error('export-failed'), 0),
      effectTargets: [{ documentId: 'lesson', epoch: 'lesson-epoch', target: { kind: 'document' as const } }] }
    const record = run(requested,
      tool('file.write', { path: 'other.md', mode: 'create', content: 'B' }, createdWrite('other.md'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
    expect(executionExitDecision(record)).toMatchObject({ status: 'partial', remaining: expect.arrayContaining([
      expect.objectContaining({ name: 'task.delivery', status: 'unverified', documentId: 'lesson' }),
    ]), warnings: expect.arrayContaining([expect.objectContaining({ callId: requested.callId, status: 'failed' })]) })
    record.status = 'partial'
    expect(runEndSummary(record)).toContain('剩余工作未完成')
  })
  it('retains diagnostic failure history without marking a verified delivery partial', () => {
    const record = run(tool('read', { target: 'bad-handle' }, error('invalid-target'), 0),
      tool('file.write', { path: 'draft.md', mode: 'create', content: '完成' }, createdWrite('draft.md'), 1))
    expect(record.tools[0]!.result).toMatchObject({ kind: 'error', code: 'invalid-target' })
    expectCompletedWithWarnings(record, record.tools[0]!)
  })
  it('does not downgrade a delivered file because an earlier model call had malformed arguments', () => {
    const record = run(tool('file.write', null, error('invalid-tool-arguments'), 0),
      tool('file.write', { path: 'chart.svg', mode: 'create', content: '<svg />' }, createdWrite('chart.svg'), 1))
    expectCompletedWithWarnings(record, record.tools[0]!)
  })
  it('retains malformed arguments as warnings and reports a missing result without treating a read as delivery', () => {
    const record = run(tool('file.write', null, error('invalid-tool-arguments'), 0),
      tool('file.read', { path: 'other.md' }, { kind: 'read', data: { content: 'unrelated' } }, 1))
    expectMissingResultWithWarnings(record, record.tools[0]!)
  })
  it('keeps a required delivery failure partial after an unrelated document edit', () => {
    const failed = { ...tool('file.save', { target: 'required-target' }, error('save-failed'), 0),
      effectTargets: [{ documentId: 'required', target: { kind: 'document' as const } }] }
    const record = run(failed,
      tool('file.write', { path: 'other.md', mode: 'create', content: '完成' }, createdWrite('other.md'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
    expect(executionExitDecision(record)).toMatchObject({ status: 'partial', remaining: expect.arrayContaining([
      expect.objectContaining({ name: 'project.save', status: 'unsaved', documentId: 'required' }),
    ]) })
  })
  it('never treats an unknown side effect as recovered by another receipt', () => {
    const input = { path: 'required.md', mode: 'create', content: 'A' }
    const record = run(tool('file.write', input, error('file-create-outcome-unknown'), 0),
      tool('file.write', input, createdWrite('required.md'), 1))
    expect(hasUnresolvedToolFailure(record)).toBe(true)
  })
  it('requires the designated artifact source version to be written at its actual destination', () => {
    const input = { kind: 'compute', job: 'job-one', name: 'result.txt', destination: 'result.txt' }
    const identity = { sourceKind: 'compute', sourceId: 'job-one@result.txt', path: 'C:/fixture/result.txt', version: 'owner-version' }
    const rejected = tool('artifact.save', input, { kind: 'read', data: { ...identity, status: 'rejected', message: '目标目录不可写' } }, 0)
    expect(serviceToolOutcome(rejected.call.name, rejected.result)).toEqual({ status: 'failed', message: '目标目录不可写' })
    expect(hasUnresolvedToolFailure(run(rejected))).toBe(true)
    expect(executionExitDecision(run(rejected))).toMatchObject({ status: 'partial', remaining: expect.arrayContaining([
      expect.objectContaining({ name: 'artifact.save', status: 'unverified', callId: rejected.callId }),
    ]), warnings: expect.arrayContaining([expect.objectContaining({ name: 'artifact.save', status: 'failed', callId: rejected.callId })]) })
    for (const different of [{ ...identity, path: 'C:/fixture/other.txt' }, { ...identity, sourceKind: 'image' },
      { ...identity, sourceId: 'job-two@result.txt' }, { ...identity, version: 'other-version' }]) {
      expect(hasUnresolvedToolFailure(run(rejected, tool('artifact.save', { ...input, kind: different.sourceKind,
        job: different.sourceId.split('@')[0], destination: different.path },
        { kind: 'read', data: { ...different, status: 'written' } }, 1)))).toBe(true)
    }
    expect(hasUnresolvedToolFailure(run(rejected, tool('artifact.save', { ...input, destination: identity.path },
      { kind: 'read', data: { ...identity, status: 'written' } }, 1)))).toBe(false)
    expect(hasUnresolvedToolFailure(run(rejected, tool('artifact.save', { ...input, destination: 'C:\\fixture\\result.txt' },
      { kind: 'read', data: { ...identity, path: 'C:\\fixture\\result.txt', status: 'written' } }, 1)))).toBe(false)
    const delivered = tool('artifact.save', input, { kind: 'read', data: { ...identity, status: 'written' } }, 0)
    const conflict = tool('artifact.save', input, { kind: 'read', data: { ...identity, status: 'conflict', message: '目标文件已存在' } }, 1)
    expectCompletedWithWarnings(run(delivered, conflict), conflict)
    expect(hasUnresolvedToolFailure(run(delivered, tool('artifact.save', input,
      { kind: 'read', data: { ...identity, status: 'unknown' } }, 1)))).toBe(true)
  })
  it('keeps failure audits while a missing result and an unknown outcome remain distinct', () => {
    const optional = tool('view.observe', { target: 'page', purpose: 'diagnostic' }, error('service-unavailable'), 0)
    expectCompletedWithWarnings(run(optional), optional)
    expect(hasUnresolvedToolFailure(run({ ...optional, result: error('tool-outcome-unknown') }))).toBe(true)
    const click = { ...optional, call: { name: 'html.click', input: { purpose: 'diagnostic' } } }
    const write = { ...optional, call: { name: 'file.write', input: { purpose: 'diagnostic' } } }
    expectCompletedWithWarnings(run(click), click)
    expectMissingResultWithWarnings(run(write), write)
  })
  it('retains a known observation gap and its original page as an audit warning', () => {
    const observation = (locationId: string) => ({ kind: 'read' as const, data: { identity: { documentId: 'course', locationId }, image: { resourceId: 'pixels' } } })
    const failed = { ...tool('view.observe', { target: 'old-handle' }, observation('one'), 0), observationFailure: { message: '视觉不可用' } }
    expectCompletedWithWarnings(run(failed, tool('view.observe', { target: 'new-handle' }, observation('two'), 1)), failed)
    expectCompletedWithWarnings(run(failed, tool('view.observe', { target: 'new-handle' }, observation('one'), 1)), failed)
    expect(failed.result).toMatchObject({ data: { identity: { documentId: 'course', locationId: 'one' } } })
  })
  it('keeps a durable running image job pending until the matching owner reports ready', () => {
    const pending = tool('image.generate', { prompt: '图一' }, { kind: 'read', data: { job: 'image-one', status: 'running' } }, 0)
    const unrelated = tool('job.wait', { job: 'image-other' }, { kind: 'read', data: {
      kind: 'image', jobId: 'image-other', status: 'ready', terminal: true,
    } }, 1)
    expect(hasUnresolvedToolFailure(run(pending, unrelated))).toBe(true)
    const ready = tool('job.wait', { job: 'image-one' }, { kind: 'read', data: {
      kind: 'image', jobId: 'image-one', status: 'ready', terminal: true,
    } }, 2)
    expect(hasUnresolvedToolFailure(run(pending, unrelated, ready))).toBe(false)
  })
  it('keeps running compute partial until the same restricted job returns ready', () => {
    const pending = tool('compute.run', { code: 'print(1)' }, { kind: 'read', data: { job: 'compute-one', status: 'preparing' } }, 0)
    expect(hasUnresolvedToolFailure(run(pending))).toBe(true)
    const ready = tool('job.status', { job: 'compute-one' }, { kind: 'read', data: {
      kind: 'compute', jobId: 'compute-one', status: 'ready', terminal: true,
    } }, 1)
    expect(hasUnresolvedToolFailure(run(pending, ready))).toBe(false)
  })
  it('settles a pending owner only when its own artifact is actually saved', () => {
    const pending = tool('compute.run', { code: 'print(1)' }, { kind: 'read', data: {
      job: 'compute-one', status: 'running',
    } }, 0)
    const other = tool('artifact.save', { kind: 'compute', job: 'compute-two', name: 'result.txt', destination: 'other.txt' },
      { kind: 'read', data: { status: 'written', sourceKind: 'compute', sourceId: 'compute-two@result.txt',
        path: 'C:/fixture/other.txt', version: 'other-version' } }, 1)
    expect(hasUnresolvedToolFailure(run(pending, other))).toBe(true)
    const delivered = tool('artifact.save', { kind: 'compute', job: 'compute-one', name: 'result.txt', destination: 'result.txt' },
      { kind: 'read', data: { status: 'written', sourceKind: 'compute', sourceId: 'compute-one@result.txt',
        path: 'C:/fixture/result.txt', version: 'owner-version' } }, 2)
    expect(hasUnresolvedToolFailure(run(pending, other, delivered))).toBe(false)
  })
  it('keeps delegation pending until the parent verifies and reads its own candidate', () => {
    const delegated = tool('delegate.start', { goal: 'prepare a report', expectedArtifacts: ['report.md'] },
      { kind: 'read', data: { job: 'delegate-one', status: 'ready' } }, 0)
    const ready = tool('job.wait', { job: 'delegate-one' }, { kind: 'read', data: {
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


const createdLesson = () => tool('file.create', { name: 'lesson.h5lesson' }, { kind: 'read', data: {
  documentId: 'lesson', path: 'C:/fixture/lesson.h5lesson', operation: { status: 'success' },
} }, 0)
const appliedLesson = (revision = 1) => tool('html.import', {}, { kind: 'document-operation', affected: [], result: {
  status: 'applied', documentId: 'lesson', operationId: `import-${revision}`, beforeRevision: revision - 1,
  revision, persistence: 'recoverable',
} }, revision)
const savedLesson = (documentId: string, savedRevision: number, currentRevision = savedRevision) => tool('file.save', {},
  { kind: 'read', data: { status: 'saved', documentId, savedRevision, currentRevision, dirty: savedRevision !== currentRevision } }, 10)

it('keeps image insertion failures as audit warnings without requiring a per-image retry', () => {
  const failed = tool('media.insert', { target: 'stale-page', resource: 'ready-image' }, error('invalid-target'), 1)
  const saved = projectSaved()
  const inDocument = (...tools: ExecutionToolRecord[]) => {
    const record = run(...tools)
    record.input.documents = [{ documentId: 'lesson', writable: [{ kind: 'document' }] }]
    return record
  }
  expectCompletedWithWarnings(inDocument(failed, saved), failed)
  const otherImage = { ...appliedLesson(2), call: { name: 'media.insert', input: { target: 'page', resource: 'other-image' } } }
  expectCompletedWithWarnings(inDocument(failed, saved, otherImage), failed)
  const corrected = { ...appliedLesson(2), call: { name: 'media.insert', input: { target: 'current-page', resource: 'ready-image' } } }
  expectCompletedWithWarnings(inDocument(failed, saved, corrected), failed)
  const earlierSuccess = { ...appliedLesson(1), callId: 'earlier-success', requestId: 'earlier-request',
    call: { name: 'media.insert', input: { target: 'first-position', resource: 'ready-image' } } }
  const secondInsertFailed = { ...failed, callId: 'second-insert', requestId: 'second-request' }
  expectCompletedWithWarnings(inDocument(earlierSuccess, secondInsertFailed, saved), secondInsertFailed)
  const retried = { ...tool('media.insert', { target: 'current-page', resource: 'ready-image' }, error('invalid-target'), 2), requestId: 'next-request' }
  expectCompletedWithWarnings(inDocument(failed, saved, retried), failed, retried)
  expect(toolFailed(retried.call.name, retried.result)).toBe(true)
  const unknown = { ...tool('media.insert', { target: 'current-page', resource: 'ready-image' }, error('tool-outcome-unknown'), 2), requestId: 'next-request' }
  expect(executionExitDecision(inDocument(failed, saved, unknown))).toMatchObject({ status: 'continue',
    remaining: expect.arrayContaining([expect.objectContaining({ callId: unknown.callId, status: 'unknown' })]) })
})

it('keeps definite content attempts as warnings while missing saves and unknown effects remain unresolved', () => {
  const first = { ...authoredWrite(tool('text.replace', { target: 'title', content: '新标题' }, error('invalid-content'), 1),
    [['instances', 'title', 'data', 'text']]), requestId: 'first' }
  const later = { ...authoredWrite(tool('text.replace', { target: 'title', content: '再试标题' }, error('invalid-content'), 2),
    [['instances', 'title', 'data', 'text']]), requestId: 'second' }
  expectCompletedWithWarnings(run(createdLesson(), first), first)
  expectCompletedWithWarnings(run(createdLesson(), first, later), first, later)
  const twoDocuments = run(createdLesson(), first)
  twoDocuments.input.documents = [{ documentId: 'other-lesson', writable: [] }]
  expectCompletedWithWarnings(twoDocuments, first)
  const body = { ...authoredWrite(tool('text.replace', { target: 'body', content: '新正文' }, error('invalid-content'), 5),
    [['instances', 'body', 'data', 'text']]), requestId: 'body' }
  expectCompletedWithWarnings(run(createdLesson(), first, body), first, body)
  const imageA = { ...tool('media.apply', { target: 'image-a', resource: 'ready-image' }, error('invalid-target'), 6),
    requestId: 'image-a', effectTargets: [{ documentId: 'lesson', target: { kind: 'course-instance' as const, surfaceId: 'slide', instanceId: 'a' } }] }
  const imageB = { ...tool('media.apply', { target: 'image-b', resource: 'ready-image' }, error('invalid-target'), 7),
    requestId: 'image-b', effectTargets: [{ documentId: 'lesson', target: { kind: 'course-instance' as const, surfaceId: 'slide', instanceId: 'b' } }] }
  expectCompletedWithWarnings(run(createdLesson(), imageA, imageB), imageA, imageB)
  const earlierSuccess = { ...appliedLesson(1), callId: 'earlier-commit', requestId: 'earlier',
    call: { name: 'text.replace', input: { target: 'title', content: '旧标题' } } }
  expectCompletedWithWarnings(run(createdLesson(), earlierSuccess, first, projectSaved()), first)
  const save = { ...tool('project.save', {}, error('target-conflict'), 3), requestId: 'save-first',
    effectTargets: [{ documentId: 'lesson', target: { kind: 'document' as const } }] }
  expect(executionExitDecision(run(createdLesson(), save))).toMatchObject({ status: 'partial', remaining: expect.arrayContaining([
    expect.objectContaining({ name: 'project.save', status: 'unsaved', documentId: 'lesson' }),
  ]), warnings: expect.arrayContaining([expect.objectContaining({ callId: save.callId, status: 'failed' })]) })
  const unknown = tool('object.update', {}, error('tool-outcome-unknown'), 4)
  expect(executionExitDecision(run(createdLesson(), unknown))).toMatchObject({ status: 'continue',
    remaining: expect.arrayContaining([expect.objectContaining({ callId: unknown.callId, status: 'unknown' })]) })
})

it('settles the current saved result without requiring a rejected page title to be replayed', () => {
  const failed = { ...tool('project.apply', { project: 'lesson.h5lesson', path: 'pages', intent: 'surface.title', title: '01｜桌面上的两盏灯' },
    error('target-not-found'), 1),
    requestId: 'wrong-page' }
  expectCompletedWithWarnings(run(createdLesson(), failed, projectSaved()), failed)
  const addedPage = { ...appliedLesson(2), call: { name: 'project.apply', input: { path: 'pages', intent: 'surface.add', title: '第二页' } } }
  expectCompletedWithWarnings(run(createdLesson(), failed, addedPage, savedLesson('lesson', 2)), failed)
  const insertedImage = { ...appliedLesson(3), call: { name: 'project.apply', input: { path: 'pages/01.page.json', intent: 'insert', from: 'ready-image' } } }
  expectCompletedWithWarnings(run(createdLesson(), failed, addedPage, insertedImage, savedLesson('lesson', 3)), failed)
})

it('does not settle a new course from recoverable edits or from saving the source HTML', () => {
  const record = run(createdLesson(), appliedLesson(), savedLesson('source-html', 16))
  expect(hasUnresolvedToolFailure(record)).toBe(true)
  record.status = 'stopped'
  expect(runEndSummary(record)).toContain('lesson.h5lesson（文档版本 1）')
  expect(runEndSummary(record)).toContain('可恢复状态不等于目标文件已写盘')
  expect(hasUnresolvedToolFailure(run(...record.tools, savedLesson('lesson', 1)))).toBe(false)
})

it('keeps a save raced by a new revision pending, including path-based file.patch receipts', () => {
  const patch = tool('file.patch', {}, { kind: 'read', data: { documentResult: {
    status: 'applied', documentId: 'lesson', revision: 2,
  } } }, 11)
  expect(hasUnresolvedToolFailure(run(createdLesson(), appliedLesson(), savedLesson('lesson', 1), patch))).toBe(true)
  expect(hasUnresolvedToolFailure(run(createdLesson(), appliedLesson(), savedLesson('lesson', 1, 2)))).toBe(true)
  expect(hasUnresolvedToolFailure(run(createdLesson(), appliedLesson(), savedLesson('lesson', 1), patch, savedLesson('lesson', 2)))).toBe(false)
})

it('preserves ordinary unsaved editing and an intentionally empty new file without inventing a failure', () => {
  expect(hasUnresolvedToolFailure(run(appliedLesson()))).toBe(false)
  expect(hasUnresolvedToolFailure(run(createdLesson()))).toBe(false)
  const stopped = run(createdLesson()); stopped.status = 'stopped'
  expect(runEndSummary(stopped)).toContain('仅有创建回执、未见课件内容提交：lesson.h5lesson')
})

it('distinguishes a cancelled import from failure and still reports a committed operation first', () => {
  expect(htmlImportReceiptResult({ operationId: 'cancel', status: 'cancelled', reason: 'stopped', pages: [] }))
    .toMatchObject({ kind: 'error', code: 'html-import-cancelled' })
  expect(serviceToolOutcome('html.import', htmlImportReceiptResult({ operationId: 'cancel', status: 'cancelled', reason: 'stopped', pages: [] })))
    .toMatchObject({ status: 'stopped' })
  const applied = appliedLesson().result!
  if (applied.kind !== 'document-operation' || applied.result.status !== 'applied') throw new Error('fixture')
  expect(htmlImportReceiptResult({ operationId: 'done', status: 'applied', revision: 1, pages: [], commit: applied.result }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
})

it('settles a renewed save reference for the same document, not a different successful save', () => {
  const opened = tool('file.open', {}, { kind: 'read', data: { documentId: 'lesson', target: 'old-target' } }, 0)
  const failed = { ...tool('file.save', { target: 'old-target' }, error('target-conflict'), 1),
    effectTargets: [{ documentId: 'lesson', target: { kind: 'document' as const } }] }
  const renewed = tool('file.open', {}, { kind: 'read', data: { documentId: 'lesson', target: 'new-target' } }, 2)
  expect(hasUnresolvedToolFailure(run(opened, failed, renewed, savedLesson('other', 3)))).toBe(true)
  expect(hasUnresolvedToolFailure(run(opened, failed, renewed, savedLesson('lesson', 3)))).toBe(false)
  expect(hasUnresolvedToolFailure(run(opened, failed, renewed, savedLesson('lesson', 2, 3)))).toBe(true)
  expect(hasUnresolvedToolFailure(run(opened, { ...failed, result: error('tool-outcome-unknown') }, savedLesson('lesson', 3)))).toBe(true)
})


it.each(['file.write', 'file.patch'])('tracks unsaved new-document revisions from %s', name => {
  const mutation = tool(name, {}, { kind: 'read', data: { saved: false, dirty: true, documentResult: {
    status: 'applied', documentId: 'lesson', revision: 2,
  } } }, 11)
  expect(hasUnresolvedToolFailure(run(createdLesson(), mutation))).toBe(true)
  expect(hasUnresolvedToolFailure(run(createdLesson(), mutation, savedLesson('other', 2)))).toBe(true)
  expect(hasUnresolvedToolFailure(run(createdLesson(), mutation, savedLesson('lesson', 2)))).toBe(false)
})

const applyResult = (commit: ContentApplyResult['commit'], usability: ContentApplyResult['usability'], receipt = true): ExecutionToolRecord['result'] => ({
  kind: 'read', data: { commit, usability, delivery: 'not_requested', diagnostics: [], input: {}, insertedIds: [],
    ...(receipt && (commit === 'committed' || commit === 'unchanged') ? { receipt: {
      status: commit === 'committed' ? 'applied' : 'unchanged', documentId: 'lesson', operationId: 'content-one',
      beforeRevision: 0, revision: commit === 'committed' ? 1 : 0, persistence: 'recoverable',
    } } : {}) },
})
it('keeps the real MCP committed SVG warning receipt successful while retaining local diagnostics and genuine failures', () => {
  // MCP author output 682195137: the experiment was committed at revision 16,
  // then saved at revision 17; its only finding was a conditional SVG color warning.
  const diagnostic = { code: 'unsupported-dynamic-url-sink', level: 'warning' as const,
    message: '无法静态解析stroke的资源内容', repairable: true, instanceId: '54c59c57-3ffc-4f6c-b231-5bb2c4e11016' }
  const data: ContentApplyResult = { commit: 'committed', usability: 'partial', delivery: 'not_requested', diagnostics: [diagnostic],
    input: { intent: 'canonical', edits: [] }, insertedIds: [], receipt: { status: 'applied',
      documentId: 'cddeeb43-5e83-4a8f-94c6-26806cc05db4',
      operationId: 'tool:4cb99b5e8532348b23e05ece47275296d53c380d030b5247f914a1b162b035e3',
      beforeRevision: 15, revision: 16, persistence: 'recoverable' } }
  const result = { kind: 'read' as const, data }, projected = modelToolResult('project.apply', result)
  expect(serviceToolOutcome('project.apply', projected)).toBeNull()
  expect(toolFailed('project.apply', projected)).toBe(false)
  expect(committedFact('project.apply', projected)).toEqual(data.receipt)
  expect(persistedToolWork('project.apply', projected)).toBe(true)
  expect(hasUnresolvedToolFailure(run(tool('project.apply', {}, projected, 1)))).toBe(false)
  expect(projected).toMatchObject({ data: { usability: 'partial', diagnostics: [diagnostic] } })
  const failed = (patch: Partial<ContentApplyResult>) => ({ kind: 'read' as const, data: { ...data, ...patch } })
  expect(serviceToolOutcome('project.apply', failed({ diagnostics: [{ ...diagnostic, level: 'error', message: '交互模块不能运行' }] })))
    .toEqual({ status: 'failed', message: '交互模块不能运行' })
  expect(serviceToolOutcome('project.apply', failed({ usability: 'unusable' }))?.status).toBe('failed')
  expect(serviceToolOutcome('project.apply', failed({ commit: 'not_committed' }))?.status).toBe('failed')
  expect(serviceToolOutcome('project.apply', failed({ commit: 'unknown' }))?.status).toBe('unknown')
  expect(toolFailed('project.apply', error('explicit-failure'))).toBe(true)
  expect(toolFailed('image.generate', { kind: 'read', data: { status: 'running' } })).toBe(true)
})
it.each([
  ['committed', 'usable', false, true], ['committed', 'unverified', false, true], ['committed', 'unusable', true, true],
  ['unchanged', 'usable', false, true], ['unchanged', 'unverified', false, true], ['unchanged', 'unusable', true, true],
  ['not_committed', 'usable', true, false], ['not_committed', 'unverified', true, false], ['unknown', 'unverified', true, false],
] as const)('settles nested %s/%s without conflating commit and usability', (commit, usability, failed, kept) => {
  const result = applyResult(commit, usability), operation = tool('project.apply', { path: 'theme.css', content: 'A' }, result, 1)
  expect(toolFailed(operation.call.name, result)).toBe(failed)
  expect(hasUnresolvedToolFailure(run(operation))).toBe(commit === 'unknown' || commit === 'not_committed')
  if (commit === 'unknown') expect(executionExitDecision(run(operation))).toMatchObject({ status: 'continue',
    remaining: expect.arrayContaining([expect.objectContaining({ callId: operation.callId, status: 'unknown' })]) })
  else if (commit === 'not_committed') expectMissingResultWithWarnings(run(operation), operation)
  else expectCompletedWithWarnings(run(operation), ...(failed ? [operation] : []))
  expect(persistedToolWork(operation.call.name, result)).toBe(kept)
  expect(!!committedFact(operation.call.name, result)).toBe(kept)
  if (kept) expect(applicationEventFacts(operation.call.name, result)).toMatchObject({ documentId: 'lesson' })
  const record = run(operation); record.status = 'partial'
  if (commit === 'committed') expect(runEndSummary(record)).toContain('已保留 1 项正式文档修改')
})
it('preserves equivalent content without fabricating an operation or document revision', () => {
  const result = applyResult('unchanged', 'unverified', false)
  expect(hasUnresolvedToolFailure(run(tool('project.apply', {}, result, 1)))).toBe(false)
  expect(committedFact('project.apply', result)).toBeNull()
  expect(applicationEventFacts('project.apply', result)).toEqual({ applicationStatus: 'unchanged' })
  expect(applicationEventFacts('project.read', result)).toEqual({})
})
it('retains rejected content audit facts without requiring matching write scopes, while unknown remains unresolved', () => {
  const input = { path: 'theme.css', content: 'A' }
  const failed = authoredWrite(tool('project.apply', input, applyResult('not_committed', 'unusable'), 1), [['theme']])
  const corrected = authoredWrite(tool('project.apply', { path: 'current-theme.css', intent: 'style', content: 'B' },
    applyResult('committed', 'usable'), 2), [['theme']])
  expectCompletedWithWarnings(run(failed, corrected), failed)
  expectCompletedWithWarnings(run(failed, authoredWrite({ ...corrected }, [['instances', 'other', 'data']])), failed)
  expect(hasUnresolvedToolFailure(run({ ...failed, result: applyResult('unknown', 'unverified') }, corrected))).toBe(true)
  expectCompletedWithWarnings(run(failed, { ...corrected, writeScopes: [{ ...corrected.writeScopes[0]!, epoch: 'different-epoch' }] }), failed)
  expect(toolFailed(failed.call.name, failed.result)).toBe(true)
  expect(failed.result).toMatchObject({ data: { commit: 'not_committed' } })
})
const projectSaved = (documentId = 'lesson', savedRevision = 1, currentRevision = savedRevision, path = 'C:/fixture/lesson.h5lesson', epoch = 'lesson-epoch') =>
  tool('project.save', {}, { kind: 'read', data: { status: 'saved', documentId, savedRevision, currentRevision,
    dirty: savedRevision !== currentRevision, path, epoch, warnings: [] } }, 10)
it('keeps terminal export fresh after correcting metadata, without letting an ordinary save replace export or forcing ordinary unsaved editing', () => {
  const exported = (revision: number, name = 'task.delivery') => tool(name,
    { format: 'html-offline', destination: 'C:/fixture/lesson.html' }, { kind: 'read', data: {
    status: 'written', path: 'C:/fixture/lesson.html', documentId: 'lesson', epoch: 'lesson-epoch', format: 'html-offline',
    exportedRevision: revision, currentRevision: revision, fileVersion: `export-${revision}`, warnings: [],
  } }, 2)
  const edit = authoredWrite({ ...appliedLesson(1), call: { name: 'course.configure', input: { settings: { title: '当前标题' } } } }, [['title']])
  const initial = run(exported(0), edit)
  initial.input.documents = [{ documentId: 'lesson', writable: [{ kind: 'document' }] }]
  expect(hasUnresolvedToolFailure(initial)).toBe(true)
  expect(hasUnresolvedToolFailure({ ...initial, tools: [...initial.tools, projectSaved()] })).toBe(true)
  const otherDestination = exported(1, 'document.export')
  if (otherDestination.result?.kind !== 'read') throw new Error('Expected export receipt')
  otherDestination.result.data = { ...(otherDestination.result.data as object), path: 'C:/fixture/another.html' }
  expect(hasUnresolvedToolFailure({ ...initial, tools: [...initial.tools, otherDestination] })).toBe(true)
  expect(hasUnresolvedToolFailure({ ...initial, tools: [...initial.tools, exported(1, 'document.export')] })).toBe(false)
  const pageEdit = { ...edit, writeScopes: undefined, effectTargets: [{ documentId: 'lesson', epoch: 'lesson-epoch', target: { kind: 'document' as const } }] }
  expect(hasUnresolvedToolFailure({ ...initial, tools: [exported(0), pageEdit] })).toBe(true)
  const unchanged = appliedLesson(0)
  if (unchanged.result?.kind !== 'document-operation' || unchanged.result.result.status !== 'applied') throw new Error('Expected formal receipt')
  unchanged.result.result.status = 'unchanged'
  expect(hasUnresolvedToolFailure({ ...initial, tools: [exported(0), unchanged] })).toBe(false)
  expect(hasUnresolvedToolFailure({ ...initial, tools: [exported(0), { ...edit, writeScopes: [{ documentId: 'lesson', epoch: 'another-epoch', paths: [['title']] }] }] })).toBe(false)
  expect(hasUnresolvedToolFailure({ ...initial, tools: [projectSaved('lesson', 0, 0), edit] })).toBe(false)
})
it('settles project.save from the current course document, revision and actual binding', () => {
  const record = run(createdLesson(), tool('project.apply', {}, applyResult('committed', 'unverified'), 1))
  record.documentBindings = { lesson: { kind: 'course-v10', path: 'C:/fixture/lesson.h5lesson', projectId: 'lesson-project',
    epoch: 'lesson-epoch', savedRevision: 0, fileVersion: null } }
  expect(hasUnresolvedToolFailure(record)).toBe(true)
  for (const save of [projectSaved('source-html'), projectSaved('lesson', 0, 1), projectSaved('lesson', 1, 1, 'C:/other.h5lesson'),
    projectSaved('lesson', 1, 1, 'C:/fixture/lesson.h5lesson', 'other-epoch')])
    expect(hasUnresolvedToolFailure({ ...record, tools: [...record.tools, save] })).toBe(true)
  expect(hasUnresolvedToolFailure({ ...record, tools: [...record.tools, projectSaved()] })).toBe(false)
  expect(newFileDeliveryFacts({ ...record, tools: [...record.tools, projectSaved('lesson', 0, 1)] })).toMatchObject([{ revision: 1, savedRevision: 0 }])
  expect(serviceToolOutcome('project.save', projectSaved('lesson', 0, 1).result)?.message).toContain('新修改仍未保存')
})
it('recovers a requested project save only after a current save of that document succeeds', () => {
  const failed = { ...tool('project.save', {}, error('target-conflict'), 1), effectTargets: [{ documentId: 'lesson', target: { kind: 'document' as const } }] }
  expect(hasUnresolvedToolFailure(run(failed, projectSaved('other')))).toBe(true)
  expect(hasUnresolvedToolFailure(run(failed, projectSaved('lesson', 0, 1)))).toBe(true)
  expect(hasUnresolvedToolFailure(run(failed, projectSaved()))).toBe(false)
  expect(hasUnresolvedToolFailure(run(projectSaved('lesson', 0, 1)))).toBe(true)
  const requestedSave = { ...tool('task.delivery', { destination: 'C:/fixture/lesson.h5lesson' }, error('target-conflict'), 1),
    effectTargets: [{ documentId: 'lesson', epoch: 'lesson-epoch', target: { kind: 'document' as const } }] }
  const wrongBinding = run(requestedSave, projectSaved('lesson', 1, 1, 'C:/other.h5lesson'))
  wrongBinding.documentBindings = { lesson: { kind: 'course-v10', path: 'C:/fixture/lesson.h5lesson', projectId: 'lesson-project',
    epoch: 'lesson-epoch', savedRevision: 0, fileVersion: null } }
  expect(hasUnresolvedToolFailure(wrongBinding)).toBe(true)
})
it('keeps proved saves and current course delivery settled across formal rename or Save As', () => {
  const currentBinding = { kind: 'course-v10' as const, path: 'C:/fixture/renamed.h5lesson', projectId: 'lesson-project',
    epoch: 'lesson-epoch', savedRevision: 1, fileVersion: null }
  const renamedAfterSave = run(createdLesson(), tool('project.apply', {}, applyResult('committed', 'unverified'), 1), projectSaved())
  renamedAfterSave.documentBindings = { lesson: currentBinding }
  expect(hasUnresolvedToolFailure(renamedAfterSave)).toBe(false)
  expect(newFileDeliveryFacts(renamedAfterSave)).toMatchObject([{ label: 'renamed.h5lesson', revision: 1, savedRevision: 1 }])
  const savedAfterRename = run(createdLesson(), tool('project.apply', {}, applyResult('committed', 'unverified'), 1),
    projectSaved('lesson', 1, 1, currentBinding.path))
  savedAfterRename.documentBindings = { lesson: currentBinding }
  expect(hasUnresolvedToolFailure(savedAfterRename)).toBe(false)
})

it('settles explicit delivery from current save/export facts while keeping unsaved and generated-only results partial', () => {
  const dirty = { ...projectSaved('lesson', 0, 1), call: { name: 'task.delivery', input: {} } }
  expect(hasUnresolvedToolFailure(run(dirty))).toBe(true)
  expect(hasUnresolvedToolFailure(run(dirty, projectSaved()))).toBe(false)
  const exported = (name: string, status: 'generated' | 'written', documentId = 'lesson') => tool(name,
    { format: 'html-offline', destination: 'C:/fixture/lesson.html' }, { kind: 'read', data: {
      status, documentId, epoch: 'lesson-epoch', format: 'html-offline', exportedRevision: 1, currentRevision: 1,
      warnings: [], ...(status === 'written' ? { path: 'C:/fixture/lesson.html', fileVersion: 'owner-version' } : {}),
    } }, 20)
  const generated = exported('task.delivery', 'generated')
  expect(hasUnresolvedToolFailure(run(generated))).toBe(true)
  expect(hasUnresolvedToolFailure(run(exported('document.export', 'generated')))).toBe(true)
  expect(hasUnresolvedToolFailure(run(generated, exported('document.export', 'written', 'other')))).toBe(true)
  expect(hasUnresolvedToolFailure(run(generated, exported('document.export', 'written')))).toBe(false)
  expect(hasUnresolvedToolFailure(run(exported('task.delivery', 'written')))).toBe(false)
})

it('settles an actual workspace file writer receipt after the requested UTF-8 file is saved', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-outcome-file-writer-'))
  const workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const files = new AgentFileService(host), runId = 'actual-file-writer'
  try {
    await host.tools.beginRun({ runId, actor: 'agent', documents: [],
      fileAccess: { permission: 'workspace', workspaceRoot: workspace } })
    const call = { name: 'file.write' as const, input: { mode: 'create', path: '教学策划.md', content: '# 串联电路\n观察两盏灯同时亮灭。\n' } }
    const outcome = await files.execute({ runId, workspaceRoot: workspace, permission: 'workspace' }, call.name, call.input, 'write-plan')
    const result = { kind: 'read' as const, data: outcome.data }, filename = path.join(workspace, call.input.path)
    expect(result).toMatchObject({ data: { path: filename, saved: true, operation: { status: 'success' } } })
    expect(await fs.readFile(filename, 'utf8')).toBe(call.input.content)
    expect(persistedToolWork(call.name, result)).toBe(true)
    const record = run(tool(call.name, call.input, result, 0))
    record.input.workspaceRoot = workspace
    expect(executionExitDecision(record)).toMatchObject({ status: 'completed', remaining: [], warnings: [] })
    expect(record.tools[0]!.result).toEqual(result)
  } finally {
    files.releaseRun(runId)
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

it('retains a failed field as a warning while an empty patch preserves content and a real edit has one History entry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-outcome-empty-patch-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('恢复当前正文')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: textDataEdit('body', createTextComponentData('原稿')).value }
  project.surfaces = [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['body'] }]
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'lesson.h5lesson')
  try {
    await host.tools.beginRun({ runId: 'field-correction', actor: 'agent', documents: [
      { documentId: initial.documentId, writable: [{ kind: 'document' }] },
    ] })
    const target = await host.tools.issueTarget('field-correction', initial.documentId,
      { kind: 'course-instance', surfaceId: 'flow', instanceId: 'body' })
    const failedInput = { target, properties: { data: createTextComponentData('修正后的正文') } }
    const failed = { ...tool('object.update', failedInput, error('invalid-operation'), 0),
      writeScopes: await host.tools.effectWriteScopes('field-correction', { name: 'object.update', input: failedInput }) }
    expect(failed.writeScopes?.length).toBeGreaterThan(0)
    const emptyCall = { name: 'object.update', input: { target, properties: { data: {} } } }
    const empty = { ...tool(emptyCall.name, emptyCall.input, await host.tools.execute('field-correction', 'empty', emptyCall), 1),
      writeScopes: await host.tools.effectWriteScopes('field-correction', emptyCall) }
    expect(empty.result).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
    expectCompletedWithWarnings(run(failed, empty), failed)
    expect(toolFailed(failed.call.name, failed.result)).toBe(true)
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 0,
      model: { project: { instances: { body: { data: createTextComponentData('原稿') } } } } })
    const correctedCall = { name: 'object.update', input: failedInput }
    const corrected = { ...tool(correctedCall.name, correctedCall.input,
      await host.tools.execute('field-correction', 'corrected', correctedCall), 2),
      writeScopes: await host.tools.effectWriteScopes('field-correction', correctedCall) }
    expect(corrected.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expectCompletedWithWarnings(run(failed, empty, corrected), failed)
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 1,
      model: { project: { instances: { body: { data: createTextComponentData('修正后的正文') } } } } })
  } finally {
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})
