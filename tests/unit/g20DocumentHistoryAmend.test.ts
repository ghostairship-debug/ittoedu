// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { documentHostRequestSchema } from '../../src/shared/workbench/desktop'
import type { DocumentModel, DocumentOperation, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

function persistence() {
  const states: DurableDocumentState[] = []
  let fail = false
  const port: DocumentPersistence = {
    async append(state) { if (fail) throw new Error('disk full'); states.push(structuredClone(state)) },
    async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> },
  }
  return { port, states, fail: () => { fail = true } }
}
const model: DocumentModel = { kind: 'markdown', source: 'before', resources: { assets: {}, components: {} } }
async function setup() {
  const wal = persistence()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model,
    binding: { kind: 'untitled', suggestedName: 'test.md' } }, createMarkdownDriver(), wal.port)
  return { session, wal }
}
function edit(session: DocumentSession, operationId: string, source: string, head?: string): DocumentOperation {
  const current = session.read()
  return { documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source },
      ...(head ? { amendHistory: { expectedTopOperationId: head } } : {}) } }
}
function history(session: DocumentSession, operationId: string, type: 'undo' | 'redo'): DocumentOperation {
  return { ...edit(session, operationId, ''), mutation: { type } }
}

describe('strict document history amendment', () => {
  it('amends the acknowledged V9 content and binary resources in one Undo/Redo and durable recovery entry', async () => {
    const wal = persistence(), driver = createCourseV9Driver()
    const original = await driver.load(new Uint8Array(readFileSync(resolve('tests/fixtures/course-project-v9/multi-asset.h5lesson'))))
    if (original.kind !== 'course-v9') throw new Error('course fixture')
    const session = await DocumentSession.create({ documentId: 'course', epoch: 'e1', model: original,
      binding: { kind: 'untitled', suggestedName: 'test.h5lesson' } }, driver, wal.port)
    const firstProject = structuredClone(original.project)
    firstProject.title = 'Edited'
    const first: DocumentOperation = { ...edit(session, 'edit', ''), historyGroup: 'logical-edit',
      mutation: { type: 'command', command: { type: 'course.replace', project: firstProject, resources: original.resources } } }
    expect(await session.execute(first)).toMatchObject({ status: 'applied' })
    const changed = session.read().model
    if (changed.kind !== 'course-v9') throw new Error('course fixture')
    const project = structuredClone(changed.project), resources = structuredClone(changed.resources)
    const asset = Object.values(project.assets)[0]!
    project.assets['fallback-copy'] = { ...asset, id: 'fallback-copy', path: 'assets/fallback-copy.png' }
    resources.assets['fallback-copy'] = Uint8Array.from(resources.assets[asset.id]!)
    const amend: DocumentOperation = { ...edit(session, 'amend', ''),
      mutation: { type: 'command', command: { type: 'course.replace', project, resources }, amendHistory: { expectedTopOperationId: 'edit' } } }
    const receipt = await session.execute(amend)
    expect(receipt).toMatchObject({ status: 'applied', beforeRevision: project.revision, revision: project.revision + 1 })
    expect(session.read()).toMatchObject({ undoDepth: 1, redoDepth: 0, undoHead: { operationId: 'amend', actor: 'human' } })
    const persisted = wal.states.at(-1)!
    expect(persisted.past[0]!.before).toEqual(original)
    expect(persisted.past[0]!.historyGroup).toBe('logical-edit')
    expect(persisted.past[0]!.after).toMatchObject({ resources: { assets: { 'fallback-copy': resources.assets['fallback-copy'] } } })
    const count = wal.states.length
    expect(await session.execute(amend)).toEqual(receipt)
    expect(wal.states).toHaveLength(count)
    const restored = await DocumentSession.restore(persisted, 'e2', driver, wal.port)
    await restored.execute(history(restored, 'undo', 'undo'))
    expect(restored.read().model).toMatchObject({ project: { title: original.project.title }, resources: original.resources })
    if (restored.read().model.kind === 'course-v9') expect(Object.keys(restored.read().model.resources.assets)).not.toContain('fallback-copy')
    await restored.execute(history(restored, 'redo', 'redo'))
    expect(restored.read().model).toMatchObject({ project: { title: 'Edited' }, resources })
  })

  it.each(['document', 'epoch', 'revision', 'head', 'actor', 'run', 'redo'] as const)('rejects %s mismatch without model, resources, history, or WAL changes', async kind => {
    const { session, wal } = await setup()
    await session.execute(edit(session, 'first', 'edited'))
    if (kind === 'redo') {
      await session.execute(edit(session, 'second', 'later'))
      await session.execute(history(session, 'undo', 'undo'))
    }
    const request = edit(session, 'amend', 'bad', 'first')
    if (kind === 'document') request.documentId = 'other'
    if (kind === 'epoch') request.epoch = 'other'
    if (kind === 'revision') request.baseRevision--
    if (kind === 'head' && request.mutation.type === 'command') request.mutation.amendHistory!.expectedTopOperationId = 'other'
    if (kind === 'actor') request.actor = 'external'
    if (kind === 'run') request.runId = 'other'
    const before = session.read(), count = wal.states.length
    expect(await session.execute(request)).toMatchObject({ status: 'conflict', applied: false })
    expect(session.read()).toEqual(before)
    expect(wal.states).toHaveLength(count)
  })

  it('does not fall back to historyGroup push after a serially earlier writer changes the head', async () => {
    const { session, wal } = await setup()
    await session.execute(edit(session, 'first', 'edited'))
    const late = edit(session, 'amend', 'fallback', 'first')
    const earlier = session.execute(edit(session, 'second', 'new edit'))
    const amend = session.execute(late)
    expect(await earlier).toMatchObject({ status: 'applied' })
    expect(await amend).toMatchObject({ status: 'conflict', code: 'stale-revision' })
    expect(session.read()).toMatchObject({ undoDepth: 2, model: { source: 'new edit' } })
    expect(wal.states.at(-1)!.operations.map(value => value.operationId)).toEqual(['first', 'second'])
  })

  it('amends an unchanged history head after a no-op and leaves no-op amendments unchanged', async () => {
    const { session } = await setup()
    await session.execute(edit(session, 'first', 'edited'))
    await session.execute(edit(session, 'noop', 'edited'))
    expect(await session.execute(edit(session, 'amend', 'fallback', 'first'))).toMatchObject({ status: 'applied' })
    const revision = session.read().revision
    expect(await session.execute(edit(session, 'noop-amend', 'fallback', 'amend'))).toMatchObject({ status: 'unchanged', revision })
    expect(session.read()).toMatchObject({ undoDepth: 1, undoHead: { operationId: 'amend' } })
    await session.execute(history(session, 'undo', 'undo'))
    expect(session.read().model).toMatchObject({ source: 'before' })
  })

  it('does not publish a candidate or alter history if the amendment WAL append fails', async () => {
    const { session, wal } = await setup()
    await session.execute(edit(session, 'first', 'edited'))
    const before = session.read(), count = wal.states.length
    wal.fail()
    expect(await session.execute(edit(session, 'amend', 'fallback', 'first'))).toMatchObject({ status: 'failed', code: 'recovery-write-failed' })
    expect(session.read()).toEqual(before)
    expect(wal.states).toHaveLength(count)
  })

  it('accepts only the strict command amendment envelope over desktop IPC', async () => {
    const { session } = await setup()
    const request = edit(session, 'amend', 'fallback', 'first')
    expect(documentHostRequestSchema.safeParse({ type: 'dispatch', operation: request }).success).toBe(true)
    for (const mutation of [
      { ...request.mutation, amendHistory: { expectedTopOperationId: '' } },
      { ...request.mutation, amendHistory: { expectedTopOperationId: 'first', extra: true } },
      { type: 'undo', amendHistory: { expectedTopOperationId: 'first' } },
    ]) expect(documentHostRequestSchema.safeParse({ type: 'dispatch', operation: { ...request, mutation } }).success).toBe(false)
  })
})
