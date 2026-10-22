// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { createTextDriver } from '../../src/core/drivers/TextDriver'
import { createCourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { DocumentCommand, DocumentModel, DocumentOperation, DurableDocumentState } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const sourceModel = (source: string): DocumentModel => ({ kind: 'text', source, resources: { assets: {}, components: {} } })
const command = (session: DocumentSession, id: string, mutation: DocumentOperation['mutation'], group?: string): DocumentOperation => {
  const identity = session.readIdentity()
  return { documentId: identity.documentId, epoch: identity.epoch, baseRevision: identity.revision,
    operationId: id, actor: 'human', ...(group ? { historyGroup: group } : {}), mutation }
}
const edit = (session: DocumentSession, id: string, value: DocumentCommand, group?: string) => session.execute(command(session, id, { type: 'command', command: value }, group))
const source = (session: DocumentSession) => {
  const model = session.read().model
  if (model.kind !== 'text') throw new Error('Expected source fixture')
  return model.source
}
async function fixture(model = sourceModel('start')) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-incremental-history-'))
  roots.push(root)
  const directory = path.join(root, 'journal'), journal = createDocumentJournal({ directory })
  const driver = model.kind === 'course-v10' ? createCourseV10Driver() : createTextDriver()
  const session = await DocumentSession.create({ documentId: 'document', epoch: 'epoch', model,
    binding: { kind: 'untitled', suggestedName: 'work.html' } }, driver, journal)
  const filename = path.join(directory, `${createHash('sha256').update(session.documentId).digest('hex')}.journal`)
  return { root, directory, filename, journal, driver, session }
}

describe('accepted document effects and incremental durable history', () => {
  it('keeps a long source and unchanged resource bytes out of each small append, with exact cold Undo/Redo', async () => {
    const original = 'A'.repeat(512 * 1024), model = sourceModel(original)
    model.resources.assets.audio = new Uint8Array(512 * 1024).fill(13)
    const { directory, filename, session } = await fixture(model)
    const firstSize = (await fs.stat(filename)).size
    await edit(session, 'type-a', { type: 'markdown.splice', from: 10, to: 10, text: '甲' }, 'typing')
    await edit(session, 'type-b', { type: 'markdown.splice', from: 11, to: 11, text: '乙' }, 'typing')
    const growth = (await fs.stat(filename)).size - firstSize
    expect(growth).toBeLessThan(16 * 1024)
    const restarted = createDocumentJournal({ directory }), retained = await restarted.recover(session.documentId)
    expect(retained?.schemaVersion).toBe(3)
    expect(retained?.past).toHaveLength(1)
    expect(retained?.past[0]).not.toHaveProperty('before')
    expect(retained?.past[0]).not.toHaveProperty('after')
    const cold = await DocumentSession.restore(retained!, 'cold-epoch', createTextDriver(), restarted)
    expect(source(cold)).toBe(original.slice(0, 10) + '甲乙' + original.slice(10))
    await cold.execute(command(cold, 'undo-group', { type: 'undo' }))
    expect(source(cold)).toBe(original)
    await cold.execute(command(cold, 'redo-group', { type: 'redo' }))
    expect(source(cold)).toBe(original.slice(0, 10) + '甲乙' + original.slice(10))
    expect(cold.read().model.resources.assets.audio).toEqual(model.resources.assets.audio)
  })

  it('does not write unrelated backing bytes for a pooled/subview resource', async () => {
    const backing = new Uint8Array(2 * 1024 * 1024).fill(77)
    const model = sourceModel('small')
    model.resources.assets.small = backing.subarray(1_000_000, 1_000_008)
    const { filename, journal, session } = await fixture(model)
    expect((await fs.stat(filename)).size).toBeLessThan(8 * 1024)
    await edit(session, 'change-text', { type: 'markdown.splice', from: 0, to: 1, text: 'S' })
    const restored = await journal.recover(session.documentId)
    const bytes = restored!.model.resources.assets.small!
    expect([...bytes]).toEqual(Array(8).fill(77))
    expect(bytes.byteLength).toBe(bytes.buffer.byteLength)
  })

  it('does not reuse a resource number after a failed append and keeps the admitted receipt idempotent', async () => {
    const { directory, filename, session } = await fixture()
    const next = { assets: { image: new Uint8Array([1, 2, 3, 4]) }, components: {} }
    const request = command(session, 'with-new-resource', { type: 'command', command: { type: 'markdown.replace', source: 'next', resources: next } })
    const open = fs.open.bind(fs), before = (await fs.stat(filename)).size
    let fail = true
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, ...rest) => {
      if (fail && String(target) === filename && flags === 'a+') { fail = false; throw new Error('injected disk full') }
      return open(target, flags, ...rest)
    })
    expect(await session.execute(request)).toMatchObject({ status: 'failed', code: 'recovery-write-failed' })
    expect(source(session)).toBe('start')
    expect((await fs.stat(filename)).size).toBe(before)
    expect(await session.execute(request)).toMatchObject({ status: 'applied', revision: 1 })
    const size = (await fs.stat(filename)).size
    expect(await session.execute(request)).toMatchObject({ status: 'applied', revision: 1 })
    expect((await fs.stat(filename)).size).toBe(size)
    const cold = await createDocumentJournal({ directory }).recover(session.documentId)
    expect(cold!.model.resources.assets.image).toEqual(next.assets.image)
    expect(cold!.operations).toHaveLength(1)
  })

  it('uses the durable light head for saving and retains savedModel, pending history and stops across restart', async () => {
    const { root, directory, filename, session } = await fixture(sourceModel('base'))
    await edit(session, 'one', { type: 'markdown.replace', source: 'saved' })
    const opened = vi.spyOn(fs, 'open')
    await session.save({ kind: 'file', path: path.join(root, 'saved.html'), version: null, bindingVersion: 1 })
    expect(opened.mock.calls.some(call => String(call[0]) === filename && call[1] === 'r')).toBe(false)
    await edit(session, 'two', { type: 'markdown.splice', from: 5, to: 5, text: '-draft' })
    await session.stopRun('stopped-author')
    const persisted = await createDocumentJournal({ directory }).recover(session.documentId)
    expect(persisted).toMatchObject({ savedRevision: 1, revision: 2, savedModel: { source: 'saved' }, stoppedRuns: ['stopped-author'] })
    const cold = await DocumentSession.restore(persisted!, 'restored', createTextDriver(), createDocumentJournal({ directory }))
    expect(source(cold)).toBe('saved-draft')
    await cold.execute(command(cold, 'undo-draft', { type: 'undo' }))
    expect(source(cold)).toBe('saved')
    expect(await cold.execute({ ...command(cold, 'late-author', { type: 'command', command: { type: 'markdown.replace', source: 'bad' } }), actor: 'agent', runId: 'stopped-author' }))
      .toMatchObject({ status: 'cancelled', code: 'run-stopped' })
  })

  it('materializes retained revisions and continuation pairs without replacing them with current content', async () => {
    const { session } = await fixture(sourceModel('original'))
    await edit(session, 'first', { type: 'markdown.replace', source: 'first' }, 'group')
    await edit(session, 'second', { type: 'markdown.replace', source: 'second' }, 'group')
    expect(session.readRevision(0)?.model).toMatchObject({ source: 'original' })
    expect(session.readRevision(1)?.model).toMatchObject({ source: 'first' })
    expect(session.readRevision(2)?.model).toMatchObject({ source: 'second' })
    expect(session.readRevision(3)).toBeUndefined()
    const [change] = session.committedChangesSince(1)
    expect(change?.before).toMatchObject({ source: 'first' })
    expect(change?.after).toMatchObject({ source: 'second' })
    expect(change?.sourceChange).toEqual({ kind: 'changed', before: 'first', after: 'second' })
    expect(change).not.toHaveProperty('effect')
    const identity = session.readIdentity()
    expect(identity).not.toHaveProperty('model')
    if (identity.binding.kind === 'untitled') identity.binding.suggestedName = 'mutated'
    expect(session.readIdentity().binding).toMatchObject({ suggestedName: 'work.html' })
  })

  it('restores GLX fields and resources through pure accepted values while revisions stay monotonic', async () => {
    let id = 0
    const project = createBlankCourseProjectV10('initial', () => `id-${++id}`)
    const { directory, session } = await fixture({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
    const initial = session.read().model
    if (initial.kind !== 'course-v10') throw new Error('Expected GLX fixture')
    const root = initial.project.rootIds[0]!
    await edit(session, 'rename-root', captureComponentOperation(initial.project, [{ type: 'instance.patch', instanceId: root, patch: { name: 'renamed' } }]))
    const after = session.read().model
    if (after.kind !== 'course-v10') throw new Error('Expected GLX fixture')
    await edit(session, 'add-resource', captureComponentOperation(after.project, [{ type: 'asset.add',
      asset: { id: 'test-bytes', path: 'assets/test.png', mimeType: 'image/png' }, bytes: new Uint8Array([0, 255, 3]) }]))
    const journal = createDocumentJournal({ directory }), saved = await journal.recover(session.documentId)
    const cold = await DocumentSession.restore(saved!, 'cold', createCourseV10Driver(), journal)
    await cold.execute(command(cold, 'undo-resource', { type: 'undo' }))
    expect(cold.read()).toMatchObject({ revision: 3, model: { project: { revision: 3, instances: { [root]: { name: 'renamed' } } } } })
    expect(cold.read().model.resources.assets['test-bytes']).toBeUndefined()
    await cold.execute(command(cold, 'undo-name', { type: 'undo' }))
    expect(cold.read()).toMatchObject({ revision: 4, model: { project: { revision: 4, instances: { [root]: { name: '第 1 页' } } } } })
    await cold.execute(command(cold, 'redo-name', { type: 'redo' }))
    expect(cold.read()).toMatchObject({ revision: 5, model: { project: { revision: 5, instances: { [root]: { name: 'renamed' } } } } })
  })

  it('reads the legacy complete snapshots into effect history without losing an amend group', async () => {
    const { journal, session } = await fixture(sourceModel('unused'))
    const before = sourceModel('before'), middle = sourceModel('middle'), after = sourceModel('after')
    const legacy: DurableDocumentState = { schemaVersion: 2, disposition: 'active', documentId: 'legacy', epoch: 'old', sequence: 2,
      revision: 2, savedRevision: 0, savedModel: before, binding: { kind: 'untitled', suggestedName: 'legacy.html' }, model: after,
      past: [{ operationId: 'second', actor: 'human', historyGroup: 'group', beforeRevision: 0, revision: 2, before, after }], future: [], stoppedRuns: [],
      operations: [{ operationId: 'first', digest: 'a', actor: 'human', before, after: middle,
        result: { status: 'applied', documentId: 'legacy', operationId: 'first', beforeRevision: 0, revision: 1, persistence: 'recoverable' } },
      { operationId: 'second', digest: 'b', actor: 'human', before: middle, after,
        result: { status: 'applied', documentId: 'legacy', operationId: 'second', beforeRevision: 1, revision: 2, persistence: 'recoverable' } }] }
    await journal.append(legacy)
    const restored = await DocumentSession.restore(legacy, 'new', createTextDriver(), journal)
    expect(restored.readRevision(1)?.model).toMatchObject({ source: 'middle' })
    const result = await restored.execute(command(restored, 'amend', { type: 'command', command: { type: 'markdown.replace', source: 'final' },
      amendHistory: { expectedTopOperationId: 'second' } }))
    expect(result.status).toBe('applied')
    await restored.execute(command(restored, 'undo-all', { type: 'undo' }))
    expect(source(restored)).toBe('before')
    expect(source(session)).toBe('unused')
  })
})
