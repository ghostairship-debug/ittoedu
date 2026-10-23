// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentJournal } from '../../src/main/workbench/documentJournal'
import type { DocumentSaveFact } from '../../src/shared/workbench/documentSave'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'save-ack-recovery-'))
  directories.push(directory)
  const filename = path.join(directory, 'original.txt'), journalDirectory = path.join(directory, 'documents')
  await fs.writeFile(filename, 'base')
  const host = new DocumentHostService(journalDirectory), opened = await host.open(filename)
  const journal = (host as unknown as { journal: DocumentJournal }).journal
  const edit = async (source: string) => {
    const current = await host.internalAPI.read(opened.documentId)
    const result = await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: current.epoch,
      baseRevision: current.revision, operationId: `edit-${current.revision}`, actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
    expect(result.status).toBe('applied')
  }
  await edit('captured')
  return { directory, filename, journalDirectory, host, journal, opened, edit }
}

function failSaveAck(journal: DocumentJournal, beforeFailure?: () => Promise<void>, repeated = false) {
  const append = journal.appendTransition!.bind(journal)
  let acknowledgements = 0
  vi.spyOn(journal, 'appendTransition').mockImplementation(async (transition, checkpoint) => {
    if (checkpoint.savedRevision === 1 && ++acknowledgements === 1) {
      await beforeFailure?.()
      throw new Error('injected save ACK failure')
    }
    if (repeated && checkpoint.savedRevision === 1) throw new Error('injected repeated ACK failure')
    return append(transition, checkpoint)
  })
  return () => acknowledgements
}

describe('same-save publication recovery after a journal ACK failure', () => {
  it.each([false, true])('acknowledges the original publication without replaying disk save, Save As=%s', async saveAs => {
    const f = await fixture(), target = saveAs ? path.join(f.directory, 'saved-as.txt') : f.filename
    const publish = vi.spyOn(f.journal, 'savePrepared'), lookup = vi.spyOn(f.host, 'lookupSave')
    const acknowledgements = failSaveAck(f.journal), facts: DocumentSaveFact[] = []
    f.host.subscribeSaves(fact => { facts.push(fact) })
    const saved = await f.host.saveToPath(f.opened.documentId, saveAs ? target : undefined)
    expect(saved).toMatchObject({ revision: 1, dirty: false, saveError: null,
      binding: { kind: 'file', path: target }, model: { source: 'captured' }, undoDepth: 1 })
    expect(publish).toHaveBeenCalledOnce()
    expect(lookup).toHaveBeenCalledExactlyOnceWith(f.opened.documentId, publish.mock.calls[0]![0].saveIdentity)
    expect(publish.mock.calls[0]![0].saveIdentity).toMatchObject({ runId: expect.any(String), operationId: expect.any(String), requestDigest: expect.any(String) })
    expect(acknowledgements()).toBe(2)
    expect(facts.at(-1)).toMatchObject({ status: 'saved', savedRevision: 1, currentRevision: 1 })
    expect(await fs.readFile(target, 'utf8')).toBe('captured')
    if (saveAs) expect(await fs.readFile(f.filename, 'utf8')).toBe('base')
    const cold = new DocumentHostService(f.journalDirectory)
    expect(await cold.internalAPI.recoverable()).toEqual([])
    expect(await cold.internalAPI.restore(f.opened.documentId)).toMatchObject({ revision: 1, dirty: false,
      binding: { path: target }, model: { source: 'captured' }, undoDepth: 1 })
  })

  it('acknowledges only the captured revision while a later edit survives cold reopening', async () => {
    const f = await fixture(), target = path.join(f.directory, 'saved-as.txt')
    const identity = { runId: 'save-run', operationId: 'save-once', requestDigest: 'captured-r1' }
    const save = f.journal.savePrepared!.bind(f.journal)
    const publish = vi.spyOn(f.journal, 'savePrepared').mockImplementation(async input => {
      const binding = await save(input)
      await f.edit('later draft')
      return binding
    })
    const acknowledgements = failSaveAck(f.journal)
    const result = await f.host.saveWithFact(f.opened.documentId, target, identity)
    expect(result).toMatchObject({ savedRevision: 1, snapshot: { revision: 2, dirty: true,
      binding: { path: target }, model: { source: 'later draft' }, undoDepth: 2 } })
    expect(publish).toHaveBeenCalledOnce()
    expect(publish.mock.calls[0]![0].saveIdentity).toEqual(identity)
    expect(acknowledgements()).toBe(2)
    expect(await fs.readFile(target, 'utf8')).toBe('captured')
    expect(await fs.readFile(f.filename, 'utf8')).toBe('base')
    const cold = new DocumentHostService(f.journalDirectory)
    expect(await cold.internalAPI.restore(f.opened.documentId)).toMatchObject({ revision: 2, dirty: true,
      binding: { path: target }, model: { source: 'later draft' }, undoDepth: 2 })
    expect((await (cold as unknown as { journal: DocumentJournal }).journal.inspect(f.opened.documentId))?.savedModel).toMatchObject({ source: 'captured' })
  })

  it.each(['missing-proof', 'external-change'] as const)('keeps the unknown result and recoverable draft when %s prevents proof', async failure => {
    const f = await fixture(), publish = vi.spyOn(f.journal, 'savePrepared')
    const acknowledgements = failSaveAck(f.journal, async () => {
      if (failure === 'external-change') await fs.writeFile(f.filename, 'external')
      else {
        const intent = (await fs.readdir(f.journalDirectory)).find(filename => filename.endsWith('.save-intent.json'))
        if (!intent) throw new Error('fixture publication intent missing')
        await fs.rm(path.join(f.journalDirectory, intent))
      }
    })
    await expect(f.host.saveToPath(f.opened.documentId)).rejects.toMatchObject({ publication: 'unknown', message: 'injected save ACK failure' })
    expect(publish).toHaveBeenCalledOnce()
    expect(acknowledgements()).toBe(1)
    expect(await f.host.internalAPI.read(f.opened.documentId)).toMatchObject({ revision: 1, dirty: true,
      saveError: 'injected save ACK failure', model: { source: 'captured' }, undoDepth: 1 })
    const expectedDisk = failure === 'external-change' ? 'external' : 'captured'
    expect(await fs.readFile(f.filename, 'utf8')).toBe(expectedDisk)
    const cold = new DocumentHostService(f.journalDirectory)
    expect(await cold.internalAPI.restore(f.opened.documentId)).toMatchObject({ revision: 1, dirty: true,
      model: { source: 'captured' }, undoDepth: 1 })
    expect(await fs.readFile(f.filename, 'utf8')).toBe(expectedDisk)
  })

  it('keeps the original unknown result and durable draft if the proof ACK also fails', async () => {
    const f = await fixture(), publish = vi.spyOn(f.journal, 'savePrepared')
    const acknowledgements = failSaveAck(f.journal, undefined, true)
    await expect(f.host.saveToPath(f.opened.documentId)).rejects.toMatchObject({ publication: 'unknown', message: 'injected save ACK failure' })
    expect(publish).toHaveBeenCalledOnce()
    expect(acknowledgements()).toBe(2)
    expect(await f.host.internalAPI.read(f.opened.documentId)).toMatchObject({ revision: 1, dirty: true,
      saveError: 'injected save ACK failure', model: { source: 'captured' }, undoDepth: 1 })
    expect(await f.journal.inspect(f.opened.documentId)).toMatchObject({ revision: 1, savedRevision: 0,
      model: { source: 'captured' }, savedModel: { source: 'base' } })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('captured')
    // With journal I/O available again, the cold owner can confirm this same publication.
    const cold = new DocumentHostService(f.journalDirectory)
    expect(await cold.internalAPI.restore(f.opened.documentId)).toMatchObject({ revision: 1, dirty: false,
      model: { source: 'captured' }, undoDepth: 1 })
  })
})
