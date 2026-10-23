// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serialize } from 'node:v8'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { createCourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { normalizeCourseDocumentRecovery } from '../../src/core/drivers/workProjectRecovery'
import { createDocumentAcceptedChange } from '../../src/core/documents/documentStateEffects'
import { describeComponentChanges } from '../../src/core/drivers/courseV10Operations'
import { migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { DocumentJournalDecoder } from '../../src/main/workbench/documentJournalCodec'
import type { DocumentModel, DocumentStateTransition, DurableDocumentState } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('document-isolation-')) throw new Error('Unexpected fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const model = (source: string): DocumentModel => ({ kind: 'markdown', source, resources: { assets: {}, components: {} } })
const state = (): DurableDocumentState => ({ schemaVersion: 3, disposition: 'active', documentId: 'recover-me', epoch: 'old-epoch',
  sequence: 0, revision: 3, savedRevision: 1, model: model('C'), savedModel: model('A'),
  binding: { kind: 'untitled', suggestedName: 'draft.md' }, past: [], future: [], operations: [], stoppedRuns: ['stopped-run'] })
const entry = (operationId: string, before: string, after: string) => ({ operationId, effects: [createDocumentAcceptedChange(model(before), model(after))] })
const receipt = (operationId: string, before: string, after: string, revision: number): DurableDocumentState['operations'][number] => ({
  operationId, digest: `digest-${operationId}`, result: { status: 'applied', documentId: 'recover-me', operationId,
    beforeRevision: revision - 1, revision, persistence: 'recoverable' }, effect: createDocumentAcceptedChange(model(before), model(after)),
})
async function fixture(input: DurableDocumentState) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'document-isolation-')); roots.push(root)
  const directory = path.join(root, 'journal'), journal = createDocumentJournal({ directory })
  const filename = path.join(directory, `${createHash('sha256').update(input.documentId).digest('hex')}.journal`)
  // An actual committed V3 checkpoint, including a malformed optional payload,
  // reaches the decoder without relying on the current writer to create it.
  await fs.mkdir(directory); await fs.writeFile(filename, record('checkpoint', input))
  return { root, directory, journal, filename, original: await fs.readFile(filename) }
}
function payload(type: 'checkpoint' | 'transition', input: DurableDocumentState | DocumentStateTransition) {
  return serialize({ journalVersion: 3, type, buffers: [], value: serialize(input) })
}
function record(type: 'checkpoint' | 'transition', input: DurableDocumentState | DocumentStateTransition) {
  const encoded = payload(type, input)
  const header = Buffer.alloc(48); Buffer.from('G20JNL01').copy(header)
  header.writeUInt32BE(encoded.length, 8); header.writeUInt32BE((~encoded.length) >>> 0, 12)
  createHash('sha256').update(encoded).digest().copy(header, 16)
  return Buffer.concat([header, encoded, Buffer.from('G20DONE!')])
}

it('restores current content, keeps only adjacent executable history, and preserves exact raw input before publishing', async () => {
  const input = state()
  input.past = [entry('older', 'A', 'B'), { operationId: 'broken', before: model('A'), after: { kind: 'markdown' } as DocumentModel }, entry('near', 'B', 'C')]
  input.future = [entry('far-redo', 'E', 'F'), entry('broken-redo', 'not-D', 'E'), entry('near-redo', 'C', 'D')]
  input.operations = [receipt('older', 'A', 'B', 1), receipt('broken', 'wrong', 'not-B', 2), receipt('near', 'B', 'C', 3)]
  input.savedModel = model('\uD800')
  const f = await fixture(input)
  const session = await DocumentSession.restore((await f.journal.recover(input.documentId))!, 'new-epoch', createMarkdownDriver(), f.journal)
  expect(session.read()).toMatchObject({ documentId: input.documentId, epoch: 'new-epoch', revision: 3, dirty: true,
    model: { source: 'C' }, undoDepth: 1, redoDepth: 1, recoveryDiagnostics: expect.arrayContaining([expect.stringContaining('原恢复记录已保留')]) })
  expect(session.lookupOperation('broken', 'digest-broken')).toEqual(input.operations[1]!.result)
  expect(session.readSavedModel()).toBeUndefined()
  const kept = (await f.journal.recover(input.documentId))!
  expect(kept.savedRevision).toBe(1)
  expect(kept.operations.map(operation => [operation.operationId, operation.historyUnavailable])).toEqual([['older', true], ['broken', true], ['near', undefined]])
  expect(kept.stoppedRuns).toEqual(['stopped-run'])
  const retained = path.join(f.directory, 'recovery-inputs', (await fs.readdir(path.join(f.directory, 'recovery-inputs')))[0]!)
  expect(await fs.readFile(path.join(retained, path.basename(f.filename)))).toEqual(f.original)
  const undo = await session.execute({ documentId: input.documentId, epoch: 'new-epoch', baseRevision: 3, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })
  expect(undo.status).toBe('applied'); expect(session.read().model).toMatchObject({ source: 'B' })
  const blocked = await session.execute({ documentId: input.documentId, epoch: 'new-epoch', baseRevision: 4, operationId: 'late', actor: 'agent', runId: 'stopped-run',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: 'must not write' } } })
  expect(blocked).toMatchObject({ status: 'cancelled', code: 'run-stopped' })
  const cold = createDocumentJournal({ directory: f.directory })
  const reopened = await DocumentSession.restore((await cold.recover(input.documentId))!, 'cold-epoch', createMarkdownDriver(), cold)
  expect(reopened.read()).toMatchObject({ revision: 4, model: { source: 'B' }, undoDepth: 0, redoDepth: 2 })
})

it('does not replace the recovery checkpoint when retaining its raw input fails', async () => {
  const input = state(); input.past = [entry('broken', 'A', 'different-current')]
  const f = await fixture(input)
  vi.spyOn(fs, 'copyFile').mockRejectedValue(new Error('retention full'))
  await expect(DocumentSession.restore((await f.journal.recover(input.documentId))!, 'new-epoch', createMarkdownDriver(), f.journal)).rejects.toThrow('retention full')
  expect(await fs.readFile(f.filename)).toEqual(f.original)
})

it('isolates optional payloads in a committed delta while current changes remain strict', async () => {
  const input = state(), f = await fixture(input)
  const bad = { kind: 'markdown', source: 'B', resources: null } as unknown as DocumentModel
  const transition: DocumentStateTransition = { documentId: input.documentId, epoch: input.epoch, baseSequence: 0, sequence: 1,
    revision: 4, savedRevision: 1, disposition: 'active', modelChange: createDocumentAcceptedChange(model('C'), model('D')),
    savedModel: { model: bad }, history: { type: 'push', entry: { operationId: 'broken', before: model('B'), after: bad } },
    operation: receipt('current', 'C', 'D', 4), stoppedRuns: ['delta-stop'] }
  if (transition.operation!.effect!.kind !== 'source') throw new Error('Expected source effect')
  transition.operation!.effect!.beforeResources = null as never
  await fs.appendFile(f.filename, record('transition', transition))
  const original = await fs.readFile(f.filename)
  const recovered = (await f.journal.recover(input.documentId))!
  const restored = await DocumentSession.restore(recovered, 'delta-epoch', createMarkdownDriver(), f.journal)
  expect(restored.read()).toMatchObject({ revision: 4, model: { source: 'D' }, undoDepth: 0 })
  expect(restored.lookupOperation('current')).toEqual(transition.operation!.result)
  const kept = (await f.journal.recover(input.documentId))!
  expect(kept.stoppedRuns).toEqual(['stopped-run', 'delta-stop'])
  expect(kept.operations[0]).toMatchObject({ operationId: 'current', historyUnavailable: true })
  const retained = path.join(f.directory, 'recovery-inputs', (await fs.readdir(path.join(f.directory, 'recovery-inputs')))[0]!)
  expect(await fs.readFile(path.join(retained, path.basename(f.filename)))).toEqual(original)
  expect(() => new DocumentJournalDecoder().decode(payload('transition', { ...transition,
    modelChange: { kind: 'replace' as const, before: model('C'), after: bad } }))).toThrow()
})

it('keeps a valid saved baseline independent of broken current history', () => {
  const input = state(); input.past = [entry('broken', 'A', 'different-current')]
  const isolated = normalizeCourseDocumentRecovery(input, value => createMarkdownDriver().validate(value))
  expect(isolated.savedRevision).toBe(1); expect(isolated.savedModel).toBe(input.savedModel)
  expect(isolated.model).toBe(input.model); expect(isolated.past).toEqual([])
})

it('isolates an invalid legacy project history before migration while sharing retained identities', () => {
  const legacy = { schemaVersion: 10, id: 'legacy', revision: 1, title: 'Current', definitions: {}, instances: {},
    surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }], assets: {}, global: { underlay: [], overlay: [] } }
  const current = { kind: 'course-v10', project: legacy, resources: { assets: {}, components: {} } } as unknown as DocumentModel
  const badLegacy = { ...current, project: { ...legacy, surfaces: null } } as unknown as DocumentModel
  const input: DurableDocumentState = { ...state(), model: current, savedModel: current, past: [{ operationId: 'bad-legacy', before: badLegacy, after: current }] }
  const normalized = normalizeCourseDocumentRecovery(input, value => createCourseV10Driver().validate(value))
  expect(normalized.past).toEqual([])
  if (normalized.model.kind !== 'course-v10' || normalized.savedModel?.kind !== 'course-v10') throw new Error('Expected course models')
  expect(normalized.model.project.schemaVersion).toBe(11)
  expect(normalized.model.project.rootIds).toEqual(normalized.savedModel.project.rootIds)
  const before = { ...current, project: { ...legacy, revision: 0, title: 'Before' } } as unknown as DocumentModel
  const mixed = normalizeCourseDocumentRecovery({ ...input, model: normalized.model,
    past: [{ operationId: 'valid-legacy', before, after: current }] }, value => createCourseV10Driver().validate(value))
  expect(mixed.past).toHaveLength(1)
  expect(mixed.courseProjectMigrationIds?.surfaceIds.flow).toBe(normalized.model.project.rootIds[0])
})

it('accepts executable project history after Undo assigns a newer revision stamp', () => {
  const before = { kind: 'course-v10' as const, project: migrateCourseProjectV10({ schemaVersion: 10, id: 'course', revision: 0, title: 'Before',
    definitions: {}, instances: {}, surfaces: [], assets: {}, global: { underlay: [], overlay: [] } }), resources: { assets: {}, components: {} } }
  const after = { ...before, project: { ...before.project, revision: 1, title: 'After' } }
  const effect = createDocumentAcceptedChange(before, after, describeComponentChanges(before.project, after.project))
  const current = { ...before, project: { ...before.project, revision: 2 } }
  const input = { ...state(), revision: 2, model: current, savedModel: before, future: [{ operationId: 'redo', effects: [effect] }] }
  const normalized = normalizeCourseDocumentRecovery(input, value => createCourseV10Driver().validate(value))
  expect(normalized).toBe(input); expect(normalized.future).toHaveLength(1)
})
