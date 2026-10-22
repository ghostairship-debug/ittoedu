// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { normalizeCourseDocumentModel, normalizeCourseDocumentRecovery } from '../../src/core/drivers/workProjectRecovery'
import type { DocumentModel, DocumentOperation, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'

const temporaryRoots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of temporaryRoots.splice(0)) {
    const absolute = path.resolve(root), temporary = path.resolve(os.tmpdir())
    if (!absolute.startsWith(temporary + path.sep)) throw new Error('Recovery fixture is outside the temporary directory')
    await fs.rm(absolute, { recursive: true, force: true })
  }
})

/** Kept as a real V10 wire fixture: a surface and an object may legally share their old namespace. */
function legacyModel(revision: number, title: string, collision = false): DocumentModel {
  const objectId = collision ? 'scene' : 'content'
  return { kind: 'course-v10', project: {
    schemaVersion: 10, id: 'retained-work', revision, title,
    definitions: { group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'group' } } },
    instances: { [objectId]: { id: objectId, definitionId: 'group', data: { title } } },
    surfaces: [{ id: 'scene', kind: 'slide', title: '保留页面', childIds: [objectId] }],
    global: { underlay: [], overlay: [] },
    assets: { raw: { id: 'raw', path: 'assets/retained.bin' } },
  }, resources: { assets: { raw: new Uint8Array([7, 8, 9]) }, components: {} } } as unknown as DocumentModel
}

function fixture(): DurableDocumentState {
  const saved = legacyModel(5, '已保存', true), current = legacyModel(7, '未保存修改'), future = legacyModel(8, '重做修改')
  return { schemaVersion: 2, disposition: 'active', documentId: 'retained-document', epoch: 'old-epoch', sequence: 12,
    revision: 7, savedRevision: 5, binding: { kind: 'file', path: 'retained.glx', version: 'disk-version', bindingVersion: 2 },
    model: current, savedModel: saved,
    past: [{ operationId: 'old-edit', actor: 'human', beforeRevision: 5, revision: 7, before: saved, after: current }],
    future: [{ operationId: 'old-redo', actor: 'human', beforeRevision: 7, revision: 8, before: current, after: future }],
    operations: [{ operationId: 'old-edit', digest: 'retained-request-digest', actor: 'human', before: saved, after: current,
      result: { status: 'applied', documentId: 'retained-document', operationId: 'old-edit', beforeRevision: 5, revision: 7, persistence: 'recoverable' } }],
    stoppedRuns: ['stopped-run'],
  }
}

function memoryPersistence() {
  const states: DurableDocumentState[] = []
  const port: DocumentPersistence = {
    async append(state) { states.push(structuredClone(state)) },
    async save(input) { if (input.binding.kind !== 'file') throw new Error('missing binding'); return input.binding },
  }
  return { states, port }
}

function history(session: DocumentSession, operationId: string, type: 'undo' | 'redo'): DocumentOperation {
  const snapshot = session.read()
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId, actor: 'human', mutation: { type } }
}

describe('GLX work-project recovery read boundary', () => {
  it('uses one identity map across current, saved, undo, redo and retained operation models without changing the source record', () => {
    const input = fixture(), original = structuredClone(input)
    const converted = normalizeCourseDocumentRecovery(input)
    const models = [converted.model, converted.savedModel!, converted.past[0].before, converted.past[0].after,
      converted.future[0].before, converted.future[0].after, converted.operations[0].before!, converted.operations[0].after!]
    const rootIds = models.map(model => {
      if (!model || model.kind !== 'course-v10') throw new Error('expected retained legacy work project')
      expect(model.project.schemaVersion).toBe(11)
      expect(model.project).not.toHaveProperty('surfaces')
      expect(model.resources.assets.raw).toEqual(new Uint8Array([7, 8, 9]))
      return model.project.rootIds[0]
    })
    expect(new Set(rootIds).size).toBe(1)
    expect(rootIds[0]).not.toBe('scene')
    expect(converted).toMatchObject({ revision: 7, savedRevision: 5, sequence: 12, epoch: 'old-epoch', stoppedRuns: ['stopped-run'],
      operations: [{ operationId: 'old-edit', digest: 'retained-request-digest' }] })
    expect(input).toEqual(original)
  })

  it('restores an unsaved V10 record into the real Session and preserves its undo, redo, saved model and receipt', async () => {
    const input = fixture(), original = structuredClone(input), persistence = memoryPersistence()
    const session = await DocumentSession.restore(input, 'new-epoch', new CourseV10Driver(), persistence.port)
    expect(session.read()).toMatchObject({ revision: 7, epoch: 'new-epoch', dirty: true, recovered: true, undoDepth: 1, redoDepth: 1,
      model: { project: { schemaVersion: 11, title: '未保存修改' } } })
    expect(session.readSavedModel()).toMatchObject({ project: { schemaVersion: 11, title: '已保存' } })
    expect(session.lookupOperation('old-edit')).toEqual(input.operations[0].result)
    expect(await session.execute(history(session, 'undo-after-conversion', 'undo'))).toMatchObject({ status: 'applied' })
    expect(session.read()).toMatchObject({ revision: 8, model: { project: { title: '已保存' } } })
    expect(await session.execute(history(session, 'redo-after-conversion', 'redo'))).toMatchObject({ status: 'applied' })
    expect(session.read()).toMatchObject({ revision: 9, model: { project: { title: '未保存修改' } } })
    expect(persistence.states[0]).toMatchObject({ sequence: 13, revision: 7, savedRevision: 5,
      operations: [{ operationId: 'old-edit', digest: 'retained-request-digest' }] })
    expect(input).toEqual(original)
  })

  it('normalizes a newly opened V10 model before Session validation and leaves ordinary source documents unchanged', async () => {
    const model = legacyModel(3, '原文件'), original = structuredClone(model), persistence = memoryPersistence()
    const session = await DocumentSession.create({ documentId: 'opened', epoch: 'open-epoch', model,
      binding: { kind: 'untitled', suggestedName: '原文件.glx' }, saved: true }, new CourseV10Driver(), persistence.port)
    expect(session.read()).toMatchObject({ revision: 3, dirty: false, model: { project: { schemaVersion: 11 } } })
    expect(model).toEqual(original)
    const markdown: DocumentModel = { kind: 'markdown', source: 'same source', resources: { assets: {}, components: {} } }
    expect(normalizeCourseDocumentModel(markdown)).toBe(markdown)
  })

  it('retains the actual V10 journal input after converted appends reach the real checkpoint replacement', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-v10-journal-input-'))
    temporaryRoots.push(root)
    const directory = path.join(root, 'recovery'), journal = createDocumentJournal({ directory }), input = fixture()
    input.binding = { kind: 'file', path: path.join(root, 'retained.glx'), version: 'disk-version', bindingVersion: 2 }
    const models = [input.model, input.savedModel!, ...[...input.past, ...input.future].flatMap(entry => [entry.before, entry.after]),
      ...input.operations.flatMap(operation => [operation.before!, operation.after!])]
    const originalBytes = new Uint8Array(2 * 1024 * 1024).fill(9)
    for (const model of models) {
      if (!model) throw new Error('expected retained legacy history model')
      model.resources.assets.raw = originalBytes
    }
    await journal.append(input)
    const basename = `${createHash('sha256').update(input.documentId).digest('hex')}.journal`, filename = path.join(directory, basename)
    let checkpoints = 0
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (String(target) === filename && String(source).includes('.checkpoint-')) checkpoints++
      return rename(source, target)
    })
    const session = await DocumentSession.restore(input, 'converted-epoch', new CourseV10Driver(), journal)
    const converted = await journal.inspect(input.documentId)
    if (!converted) throw new Error('Converted journal was not written')
    for (let index = 1; index <= 10; index++) await journal.append({ ...converted, sequence: converted.sequence + index })
    expect(checkpoints).toBeGreaterThan(0)
    expect(await journal.inspect(input.documentId)).toMatchObject({ model: { project: { schemaVersion: 11 } } })
    expect(session.read()).toMatchObject({ dirty: true, undoDepth: 1, redoDepth: 1 })

    const retainedDirectory = path.join(directory, 'project-v10-inputs', path.basename(basename, '.journal'))
    const retained = await createDocumentJournal({ directory: retainedDirectory }).inspect(input.documentId)
    expect(retained).toMatchObject({ sequence: 12, revision: 7, savedRevision: 5, epoch: 'old-epoch',
      model: { project: { schemaVersion: 10, title: '未保存修改' } },
      past: [{ operationId: 'old-edit' }], future: [{ operationId: 'old-redo' }],
      operations: [{ operationId: 'old-edit', digest: 'retained-request-digest' }] })
    expect(retained!.model.resources.assets.raw).toBeInstanceOf(Uint8Array)
    expect(retained!.model.resources.assets.raw.every(value => value === 9)).toBe(true)
    const recoveredAgain = await DocumentSession.restore(retained!, 'retained-copy-epoch', new CourseV10Driver(), memoryPersistence().port)
    expect(recoveredAgain.read()).toMatchObject({ revision: 7, dirty: true, undoDepth: 1, redoDepth: 1,
      model: { project: { schemaVersion: 11, title: '未保存修改' } } })
  }, 20_000)
})
