import { describe, expect, it } from 'vitest'
import { htmlImportReceiptResult } from '../../src/core/tools/HtmlImportTools'
import { hasUnresolvedToolFailure, newFileDeliveryFacts, persistedToolWork, runEndSummary, serviceToolOutcome, toolFailed } from '../../src/main/workbench/execution/executionOutcome'
import { applicationEventFacts, committedFact } from '../../src/main/workbench/execution/executionToolFacts'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../src/shared/workbench/execution'

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
  it('treats a definite artifact publication rejection as failed until the same delivery succeeds', () => {
    const input = { kind: 'compute', job: 'job-one', name: 'result.txt', destination: 'result.txt' }
    const rejected = tool('artifact.save', input, { kind: 'read', data: { status: 'rejected', message: '目标目录不可写' } }, 0)
    expect(serviceToolOutcome(rejected.call.name, rejected.result)).toEqual({ status: 'failed', message: '目标目录不可写' })
    expect(hasUnresolvedToolFailure(run(rejected))).toBe(true)
    expect(hasUnresolvedToolFailure(run(rejected, tool('artifact.save', input, written('result.txt'), 1)))).toBe(false)
  })
  it('limits diagnostic settlement to definite read-only observation failures', () => {
    const optional = tool('view.observe', { target: 'page', purpose: 'diagnostic' }, error('service-unavailable'), 0)
    expect(hasUnresolvedToolFailure(run(optional))).toBe(false)
    expect(hasUnresolvedToolFailure(run({ ...optional, result: error('tool-outcome-unknown') }))).toBe(true)
    expect(hasUnresolvedToolFailure(run({ ...optional, call: { name: 'html.click', input: { purpose: 'diagnostic' } } }))).toBe(true)
    expect(hasUnresolvedToolFailure(run({ ...optional, call: { name: 'file.write', input: { purpose: 'diagnostic' } } }))).toBe(true)
  })
  it('settles a missing required visual check only after a successful observation of the same host page', () => {
    const observation = (locationId: string) => ({ kind: 'read' as const, data: { identity: { documentId: 'course', locationId }, image: { resourceId: 'pixels' } } })
    const failed = { ...tool('view.observe', { target: 'old-handle' }, observation('one'), 0), observationFailure: { message: '视觉不可用' } }
    expect(hasUnresolvedToolFailure(run(failed, tool('view.observe', { target: 'new-handle' }, observation('two'), 1)))).toBe(true)
    expect(hasUnresolvedToolFailure(run(failed, tool('view.observe', { target: 'new-handle' }, observation('one'), 1)))).toBe(false)
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


const createdLesson = () => tool('file.create', { name: 'lesson.h5lesson' }, { kind: 'read', data: {
  documentId: 'lesson', path: 'C:/fixture/lesson.h5lesson', operation: { status: 'success' },
} }, 0)
const appliedLesson = (revision = 1) => tool('html.import', {}, { kind: 'document-operation', affected: [], result: {
  status: 'applied', documentId: 'lesson', operationId: `import-${revision}`, beforeRevision: revision - 1,
  revision, persistence: 'recoverable',
} }, revision)
const savedLesson = (documentId: string, savedRevision: number, currentRevision = savedRevision) => tool('file.save', {},
  { kind: 'read', data: { status: 'saved', documentId, savedRevision, currentRevision, dirty: savedRevision !== currentRevision } }, 10)

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
  const failed = tool('file.save', { target: 'old-target' }, error('target-conflict'), 1)
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
it.each([
  ['committed', 'usable', false, true], ['committed', 'unverified', false, true], ['committed', 'unusable', true, true],
  ['unchanged', 'usable', false, true], ['unchanged', 'unverified', false, true], ['unchanged', 'unusable', true, true],
  ['not_committed', 'usable', true, false], ['not_committed', 'unverified', true, false], ['unknown', 'unverified', true, false],
] as const)('settles nested %s/%s without conflating commit and usability', (commit, usability, failed, kept) => {
  const result = applyResult(commit, usability), operation = tool('project.apply', { path: 'theme.css', content: 'A' }, result, 1)
  expect(toolFailed(operation.call.name, result)).toBe(failed)
  expect(hasUnresolvedToolFailure(run(operation))).toBe(failed)
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
it('settles a definite content rejection only after the same request succeeds', () => {
  const input = { path: 'theme.css', content: 'A' }, failed = tool('project.apply', input, applyResult('not_committed', 'unusable'), 1)
  expect(hasUnresolvedToolFailure(run(failed, tool('project.apply', { ...input, content: 'B' }, applyResult('committed', 'usable'), 2)))).toBe(true)
  expect(hasUnresolvedToolFailure(run(failed, tool('project.apply', input, applyResult('committed', 'unverified'), 2)))).toBe(false)
  expect(hasUnresolvedToolFailure(run({ ...failed, result: applyResult('unknown', 'unverified') },
    tool('project.apply', input, applyResult('committed', 'usable'), 2)))).toBe(true)
})
const projectSaved = (documentId = 'lesson', savedRevision = 1, currentRevision = savedRevision, path = 'C:/fixture/lesson.h5lesson', epoch = 'lesson-epoch') =>
  tool('project.save', {}, { kind: 'read', data: { status: 'saved', documentId, savedRevision, currentRevision,
    dirty: savedRevision !== currentRevision, path, epoch, warnings: [] } }, 10)
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
  const wrongBinding = run(projectSaved('lesson', 1, 1, 'C:/other.h5lesson'))
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
