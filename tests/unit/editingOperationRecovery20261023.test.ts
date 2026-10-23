// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { settleCourseComponentInput } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentFileObservation, DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentHostEvent, DocumentModel, DocumentOperation, DocumentPersistence } from '../../src/shared/workbench/document'

const dispose: Array<() => void> = [], directories: string[] = []
afterEach(async () => {
  dispose.splice(0).forEach(work => work())
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
const source = (model: DocumentModel | null | undefined) => model?.kind === 'markdown' || model?.kind === 'text' ? model.source : undefined
async function fixture(prepareSave?: DocumentPersistence['prepareSave']) {
  const session = await DocumentSession.create({ documentId: 'editing-input', epoch: 'input-epoch',
    binding: { kind: 'file', path: '/editing.md', version: 'original', bindingVersion: 1 },
    model: { kind: 'markdown', source: 'A', resources: { assets: { 'stable.svg': new Uint8Array([1]) }, components: {} } } }, new MarkdownDriver(), {
    async append() {}, prepareSave,
    async save(input) { if (input.binding.kind !== 'file') throw new Error('Expected file'); return { ...input.binding, version: 'saved' } },
  })
  const listeners = new Set<(event: DocumentHostEvent) => void>()
  const emit = (event: DocumentHostEvent) => listeners.forEach(listener => listener(event))
  session.subscribe(emit)
  const api = {
    read: vi.fn(async () => session.read()), lookup: vi.fn(async (_id: string, operationId: string) => session.lookupOperation(operationId)),
    dispatch: vi.fn(async (operation: DocumentOperation) => session.execute(operation)),
    subscribe(listener: (event: DocumentHostEvent) => void) { listeners.add(listener); return () => listeners.delete(listener) },
  } as unknown as DocumentHostAPI
  const projection = await DocumentProjection.attach(api, session.documentId); dispose.push(() => projection.dispose())
  let id = 0
  const edit = (text: string, historyGroup = 'G', actor: DocumentOperation['actor'] = 'human') => {
    const current = session.read()
    return session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: `edit-${++id}`, actor, historyGroup, mutation: { type: 'command', command: { type: 'markdown.replace', source: text } } })
  }
  const history = (type: 'undo' | 'redo') => {
    const current = session.read()
    return session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: `history-${++id}`, actor: 'human', mutation: { type } })
  }
  return { session, projection, api, emit, edit, history }
}
async function fileFixture(text = 'A\nkeep\nC') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editing-input-recovery-')); directories.push(directory)
  const filename = path.join(directory, 'notes.md'); await fs.writeFile(filename, text)
  const { host, documents } = createMarkdownTestHost(path.join(directory, 'journal'))
  const files = createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'metadata'), validateTarget: async () => {}, documents })
  const ref = { kind: 'file' as const, path: filename }, port = { ...files, documents }
  const view = new DocumentFileSession(ref, port); dispose.push(() => view.dispose()); await view.open()
  return { host, documents, view, ref, port }
}

describe('editing operation and source input recovery', () => {
  it('retries a transient read failure without an operation or a write replay', async () => {
    const h = await fixture(), read = vi.mocked(h.api.read)
    read.mockRejectedValueOnce(new Error('temporary read failure'))
    await expect(h.projection.drain()).rejects.toThrow('temporary read failure')
    expect(h.projection.read()).toMatchObject({ connected: false, error: { code: 'snapshot-unavailable' } })
    expect(source((await h.projection.drain()).model)).toBe('A')
    expect(h.projection.read()).toMatchObject({ connected: true, error: null, pending: [] })
    expect(h.api.dispatch).not.toHaveBeenCalled()
  })

  it('does not turn a missing unknown receipt into a queued replay during reconnect', async () => {
    const h = await fixture()
    vi.mocked(h.api.dispatch).mockRejectedValueOnce(new Error('lost transport'))
    await expect(h.projection.edit({ type: 'markdown.replace', source: 'unconfirmed' })).rejects.toThrow()
    const operationId = h.projection.read().pending[0]!.operationId
    await h.projection.reattach()
    expect(h.projection.read().pending).toEqual([{ operationId, status: 'unknown' }])
    expect(h.api.lookup).toHaveBeenCalledWith(h.session.documentId, operationId)
    expect(h.api.dispatch).toHaveBeenCalledTimes(1)
    await expect(h.projection.drain()).rejects.toThrow()
  })

  it('accepts save-prepared resources at the same revision and retains unchanged buffers', async () => {
    const h = await fixture(async input => ({ model: { ...input.model,
      resources: { ...input.model.resources, assets: { ...input.model.resources.assets, 'new.svg': new Uint8Array([9]) } } } }))
    const stable = h.projection.read().committed!.model.resources.assets['stable.svg']
    await h.session.save()
    expect(h.projection.read().committed!.revision).toBe(0)
    expect(h.projection.read().committed!.model.resources.assets['new.svg']).toEqual(new Uint8Array([9]))
    expect(h.projection.read().committed!.model.resources.assets['stable.svg']).toBe(stable)
    const model = h.projection.read().committed!.model
    await h.projection.edit({ type: 'markdown.replace', source: 'B', resources: model.resources })
    expect(h.session.read().model.resources.assets['new.svg']).toEqual(new Uint8Array([9]))
  })

  it('accepts an explicit resource delta with an unchanged source revision', async () => {
    const h = await fixture(), current = h.projection.read().committed!, { model: _model, ...facts } = current
    h.emit({ type: 'updated', baseRevision: current.revision, baseSequence: current.sequence!,
      head: { ...facts, kind: 'markdown', sequence: current.sequence! + 1 },
      model: { kind: 'source', documentKind: 'markdown', edits: [], resources: { assets: { 'stable.svg': new Uint8Array([7]) }, components: {} } } })
    expect(h.projection.read().committed!.model.resources.assets['stable.svg']).toEqual(new Uint8Array([7]))
  })

  it('keeps an own no-op inside a typing group, while an unchanged History command still ends the group', async () => {
    const h = await fixture()
    await h.edit('AB'); await h.edit('AB'); await h.edit('ABC')
    expect(h.session.read().undoDepth).toBe(1)
    await h.history('undo'); expect(source(h.session.read().model)).toBe('A')
    await h.history('redo'); expect(source(h.session.read().model)).toBe('ABC')
    await h.history('redo') // No future, but an explicit History action is still a boundary.
    await h.edit('ABCD')
    expect(h.session.read().undoDepth).toBe(2)
    await h.history('undo'); expect(source(h.session.read().model)).toBe('ABC')
  })

  it('does not merge a typing group across another actor no-op', async () => {
    const h = await fixture()
    await h.edit('AB'); await h.edit('AB', 'G', 'external'); await h.edit('ABC')
    expect(h.session.read().undoDepth).toBe(2)
  })

  it('uses a source file retry to release a definite rejection and submit current retained text once', async () => {
    const h = await fileFixture(), dispatch = vi.spyOn(h.documents, 'dispatch')
    dispatch.mockImplementationOnce(async operation => ({ status: 'failed', documentId: operation.documentId,
      operationId: operation.operationId, applied: false, code: 'fixture-refusal', message: 'A definite refusal' }))
    h.view.edit('A local\nkeep\nC', 'typing')
    await vi.waitFor(async () => expect((await h.documents.readAuthoringDrafts(h.view.documentId!))?.sourceConflicts
      ?.some(value => value.hunks.some(hunk => hunk.text === 'A local\nkeep\nC'))).toBe(true))
    expect(await h.view.drain()).toBe(true)
    expect(source(h.view.committedDocument!.model)).toBe('A local\nkeep\nC')
    expect(h.view.committedDocument!.undoDepth).toBe(1)
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(h.view.getSnapshot().source).toBe('A local\nkeep\nC')
  })

  it('retains a real Session overlap in the existing hunk UI and lets the selected result commit', async () => {
    const h = await fileFixture(), original = h.documents.dispatch.bind(h.documents)
    vi.spyOn(h.documents, 'dispatch').mockImplementationOnce(async operation => {
      await original({ ...operation, actor: 'external', operationId: 'external-overlap',
        mutation: { type: 'command', command: { type: 'markdown.replace', source: 'A remote\nkeep\nC' } } })
      return original(operation)
    })
    h.view.edit('A local\nkeep\nC', 'typing')
    await vi.waitFor(() => expect(h.view.getSnapshot().conflictOrigin).toBe('session'))
    expect(h.view.getSnapshot().conflictHunks).toHaveLength(1)
    expect(source(h.view.committedDocument!.model)).toBe('A remote\nkeep\nC')
    await h.view.resolveConflictHunk(h.view.getSnapshot().conflictHunks[0]!.id, 'local')
    expect(await h.view.drain()).toBe(true)
    expect(source(h.view.committedDocument!.model)).toBe('A local\nkeep\nC')
    expect(h.view.getSnapshot().conflict).toBeNull()
  })

  it('preserves later source text and original unknown identity without issuing another dispatch', async () => {
    const h = await fileFixture(), dispatch = vi.spyOn(h.documents, 'dispatch').mockRejectedValueOnce(new Error('unknown transport result'))
    h.view.edit('A first\nkeep\nC')
    await vi.waitFor(() => expect(h.view.getSnapshot().error).not.toBeNull())
    h.view.edit('A latest\nkeep\nC')
    expect(await h.view.drain()).toBe(false)
    expect(await h.view.preserveDraft()).toBe(true)
    const recovery = await h.documents.readAuthoringDrafts(h.view.documentId!)
    const input = recovery!.sourceConflicts!.find(value => value.hunks.some(hunk => hunk.text === 'A latest\nkeep\nC'))!
    expect(input).toBeDefined()
    expect(input.conflictBaseline).toContain(dispatch.mock.calls[0]![0].operationId)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const reopened = new DocumentFileSession(h.ref, h.port); dispose.push(() => reopened.dispose()); await reopened.open()
    expect(reopened.getSnapshot().retainedSourceConflicts.some(value => value.hunks.some(hunk => hunk.text === 'A latest\nkeep\nC'))).toBe(true)
    expect(reopened.getSnapshot().conflict).toBeNull()
  })

  it('a non-input error does not claim to resolve another operation', async () => {
    expect(await settleCourseComponentInput(new Error('local validation'))).toBe('ready')
  })

  it('settles only a known course refusal even if its follow-up read failed, then recovers on a new edit', async () => {
    const h = await createV10StoreHost(createBlankCourseProjectV10('Definite rejection'))
    dispose.push(() => h.bridge.dispose())
    const rootId = h.model().project.rootIds[0]!
    vi.spyOn(h.api, 'dispatch').mockImplementationOnce(async operation => ({ status: 'failed', applied: false,
      documentId: operation.documentId, operationId: operation.operationId, code: 'known-refused', message: 'Known refusal' }))
    vi.spyOn(h.api, 'read').mockRejectedValueOnce(new Error('temporary read failure'))
    const failure = await h.bridge.edit([{ type: 'style.set', instanceId: rootId, path: ['gap'], value: 18 }]).catch(error => error)
    expect(await settleCourseComponentInput(failure)).toBe('ready')
    expect(h.bridge.read().pending).toBe(0)
    await h.bridge.edit([{ type: 'style.set', instanceId: rootId, path: ['gap'], value: 24 }])
    expect(h.model().project.instances[rootId]!.style?.gap).toBe(24)
    expect(h.first.read().undoDepth).toBe(1)
  })

  it('keeps an edit made during the actual Main save capture when disk then changes independently', async () => {
    const h = await fileFixture('A base\nB base\nC base')
    h.view.edit('A base\nB saved\nC base'); await h.view.drain()
    let edited = false
    const stop = h.documents.subscribe(event => {
      const saving = event.type === 'changed' ? event.snapshot.saving : event.type === 'state' ? event.head.saving : false
      if (saving && !edited) {
        edited = true; h.view.edit('A teacher\nB saved\nC base')
      }
    }); dispose.push(stop)
    const save = h.documents.save.bind(h.documents)
    vi.spyOn(h.documents, 'save').mockImplementation(async id => {
      const snapshot = await save(id)
      expect(snapshot.dirty).toBe(true)
      await fs.writeFile(h.ref.path, 'A base\nB saved\nC external')
      return snapshot
    })
    const result = await h.view.flush()
    expect({ result, source: h.view.getSnapshot().source, error: h.view.getSnapshot().error }).toEqual({
      result: true, source: 'A teacher\nB saved\nC external', error: null,
    })
  })

  it('keeps new source input when idle reconnect also fails, then merges it with newer accepted content', async () => {
    const h = await fileFixture(), read = vi.spyOn(h.documents, 'read')
    read.mockRejectedValueOnce(new Error('first read unavailable'))
    expect(await h.view.drain()).toBe(false)
    read.mockRejectedValueOnce(new Error('reconnect read unavailable'))
    h.view.edit('A local\nkeep\nC')
    await vi.waitFor(async () => expect((await h.documents.readAuthoringDrafts(h.view.documentId!))?.sourceConflicts
      ?.some(value => value.hunks.some(hunk => hunk.text === 'A local\nkeep\nC'))).toBe(true))
    const current = await h.host.internalAPI.read(h.view.documentId!)
    await h.documents.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: 'independent-after-read-failure', actor: 'external', mutation: { type: 'command',
        command: { type: 'markdown.replace', source: 'A\nkeep\nC external' } } })
    expect(h.view.getSnapshot().source).toBe('A local\nkeep\nC')
    expect(await h.view.preserveDraft()).toBe(true)
    expect(await h.view.drain()).toBe(true)
    expect(source(h.view.committedDocument!.model)).toBe('A local\nkeep\nC external')
  })

  it('requires the actual current manual conflict write ACK before reporting preservation', async () => {
    const h = await fileFixture()
    h.view.edit('A local\nkeep\nC'); await h.view.drain()
    await fs.writeFile(h.ref.path, 'A remote\nkeep\nC')
    const observed = await h.documents.observeFile(h.view.documentId!)
    await (h.view as unknown as { observe(value: DocumentFileObservation): Promise<void> }).observe(observed)
    const hunk = h.view.getSnapshot().conflictHunks[0]!
    const write = vi.spyOn(h.documents, 'writeAuthoringDrafts').mockRejectedValue(new Error('recovery disk unavailable'))
    h.view.setConflictDraft(hunk.id, 'teacher manual input')
    expect(await h.view.preserveDraft()).toBe(false)
    expect(h.view.getSnapshot().conflictDrafts[hunk.id]).toBe('teacher manual input')
    write.mockRestore()
    expect(await h.view.preserveDraft()).toBe(true)
    const recovery = await h.documents.readAuthoringDrafts(h.view.documentId!)
    expect(recovery?.sourceConflicts?.some(value => value.hunks.some(candidate => candidate.text === 'teacher manual input'))).toBe(true)
  })
})
