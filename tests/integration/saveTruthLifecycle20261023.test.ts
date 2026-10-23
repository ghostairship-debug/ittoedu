// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentJournal } from '../../src/main/workbench/documentJournal'
import { DocumentDeliveryService, type DocumentDeliveryServiceOptions } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import type { DocumentSaveFact } from '../../src/shared/workbench/documentSave'
import { diagnosticLog } from '../../src/main/diagnosticLog'

vi.mock('../../src/main/diagnosticLog', () => ({ diagnosticLog: { append: vi.fn(async () => {}) } }))

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'save-truth-lifecycle-')); roots.push(root)
  const filename = path.join(root, 'original.txt'), directory = path.join(root, 'documents')
  await fs.writeFile(filename, 'base')
  const host = new DocumentHostService(directory), opened = await host.open(filename)
  const journal = (host as unknown as { journal: DocumentJournal }).journal
  await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
    operationId: 'edit', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'captured' } } })
  const operations = new DocumentDeliveryOperationStore(path.join(root, 'operations'))
  const service = new DocumentDeliveryService({
    documents: { read: host.internalAPI.read, saveWithFact: (id, destination, identity) => host.saveWithFact(id, destination, identity),
      lookupSave: (id, identity) => host.lookupSave(id, identity),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations, authorize: async () => {}, resolveSaveDestination: async input => input.requested,
    resolveExportDestination: async () => null, build: { build: async () => { throw new Error('unused export') } },
    writer: { writeNew: async () => { throw new Error('unused export') }, inspect: async () => null } as DocumentDeliveryServiceOptions['writer'],
  })
  return { root, filename, directory, host, journal, opened, service }
}

function rejectSaveAcknowledgements(journal: DocumentJournal) {
  const append = journal.appendTransition!.bind(journal)
  return vi.spyOn(journal, 'appendTransition').mockImplementation((transition, checkpoint) => {
    if (checkpoint.savedRevision === 1) return Promise.reject(new Error('injected ACK persistence failure'))
    return append(transition, checkpoint)
  })
}

describe('save facts and retained publication evidence', () => {
  it('keeps a completed save successful when input binding maintenance fails, preserving the raw record', async () => {
    const f = await fixture(), facts: DocumentSaveFact[] = []
    f.host.subscribeSaves(fact => { facts.push(fact) })
    await f.host.internalAPI.writeAuthoringDrafts(f.opened.documentId, { properties: [{ bindingKey: JSON.stringify([f.opened.documentId, f.opened.epoch, 'field']),
      kind: 'text', label: 'unfinished field', raw: 'raw survives', composing: false }] }, f.opened.epoch)
    const inputDirectory = path.join(f.directory, 'authoring-drafts')
    const record = (await fs.readdir(inputDirectory)).find(name => name.endsWith('.inputs-v2.json'))!
    const before = await fs.readFile(path.join(inputDirectory, record), 'utf8')
    const rename = fs.rename.bind(fs)
    const maintenance = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (String(destination) === path.join(inputDirectory, record)) throw new Error('injected input metadata write failure')
      await rename(source, destination)
    })
    const saved = await f.host.saveWithFact(f.opened.documentId)
    expect(saved).toMatchObject({ savedRevision: 1, snapshot: { dirty: false, saveError: null, model: { source: 'captured' } } })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('captured')
    expect(await fs.readFile(path.join(inputDirectory, record), 'utf8')).toBe(before)
    expect(facts.map(fact => fact.status)).toEqual(['saving', 'saved'])
    expect(diagnosticLog.append).toHaveBeenCalledWith(expect.objectContaining({ source: 'main',
      message: expect.stringContaining('输入恢复记录') }))
    maintenance.mockRestore()
    await expect(f.host.internalAPI.read(f.opened.documentId)).resolves.toMatchObject({ dirty: false })
  })

  it('can query an unknown Save As after discard-close without restoring or rewriting the document', async () => {
    const f = await fixture(), target = path.join(f.root, 'first-copy.txt')
    const input = { runId: 'run', operationId: 'uncertain-save', requestDigest: 'same-save', documentId: f.opened.documentId,
      epoch: f.opened.epoch, baseRevision: 1, destination: target }
    rejectSaveAcknowledgements(f.journal)
    const publish = vi.spyOn(f.journal, 'savePrepared')
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'tool-outcome-unknown' })
    await f.host.operate({ type: 'close', documentId: f.opened.documentId, discardDirty: true })
    expect(f.host.registry.has(f.opened.documentId)).toBe(false)
    expect(await f.journal.inspect(f.opened.documentId)).toBeNull()
    const cold = new DocumentHostService(f.directory)
    expect(await cold.lookupSave(f.opened.documentId, { runId: input.runId, operationId: input.operationId, requestDigest: input.requestDigest })).toMatchObject({ status: 'saved', path: target,
      savedRevision: 1, currentRevision: 1, dirty: false })
    expect(await f.service.lookup(input)).toMatchObject({ status: 'saved', path: target, savedRevision: 1 })
    expect(await cold.internalAPI.list()).toEqual([])
    expect(publish).toHaveBeenCalledOnce()
    expect(await fs.readFile(target, 'utf8')).toBe('captured')
    expect(await fs.readFile(f.filename, 'utf8')).toBe('base')
  })

  it('keeps an earlier unknown operation queryable when a later Save As replaces the current intent', async () => {
    const f = await fixture(), target = path.join(f.root, 'first-copy.txt'), later = path.join(f.root, 'later-copy.txt')
    const identity = { runId: 'run', operationId: 'first-save', requestDigest: 'first-request' }
    const ack = rejectSaveAcknowledgements(f.journal), publish = vi.spyOn(f.journal, 'savePrepared')
    await expect(f.host.saveWithFact(f.opened.documentId, target, identity)).rejects.toMatchObject({ publication: 'unknown' })
    ack.mockRestore()
    await f.host.renameDocument({ type: 'rename', documentId: f.opened.documentId, epoch: f.opened.epoch, name: 'renamed-original.txt' })
    await f.host.saveWithFact(f.opened.documentId, later, { runId: 'run', operationId: 'later-save', requestDigest: 'later-request' })
    await f.host.operate({ type: 'close', documentId: f.opened.documentId })
    const cold = new DocumentHostService(f.directory)
    expect(await cold.lookupSave(f.opened.documentId, identity)).toMatchObject({ status: 'saved', path: target, savedRevision: 1 })
    expect(await cold.lookupSave(f.opened.documentId, { ...identity, requestDigest: 'different' })).toBeNull()
    const recoverySummaries = cold.internalAPI.recoverySummaries
    if (!recoverySummaries) throw new Error('fixture Host must provide recovery summaries')
    expect(await recoverySummaries()).toEqual([])
    expect(publish).toHaveBeenCalledTimes(2)
    expect(await fs.readFile(target, 'utf8')).toBe('captured')
    expect(await fs.readFile(later, 'utf8')).toBe('captured')
  })

  it('retains an unknown Save As when the source binding is renamed before close', async () => {
    const f = await fixture(), target = path.join(f.root, 'first-copy.txt')
    const identity = { runId: 'run', operationId: 'first-save', requestDigest: 'first-request' }
    const ack = rejectSaveAcknowledgements(f.journal)
    await expect(f.host.saveWithFact(f.opened.documentId, target, identity)).rejects.toMatchObject({ publication: 'unknown' })
    ack.mockRestore()
    await f.host.renameDocument({ type: 'rename', documentId: f.opened.documentId, epoch: f.opened.epoch, name: 'renamed-original.txt' })
    await f.host.operate({ type: 'close', documentId: f.opened.documentId, discardDirty: true })
    const cold = new DocumentHostService(f.directory)
    expect(await cold.lookupSave(f.opened.documentId, identity)).toMatchObject({ status: 'saved', path: target, savedRevision: 1 })
    expect(await fs.readFile(path.join(f.root, 'renamed-original.txt'), 'utf8')).toBe('base')
    expect(await cold.internalAPI.list()).toEqual([])
  })

  it('queries retained proof independently of a different current intent that cannot be read', async () => {
    const f = await fixture(), target = path.join(f.root, 'first-copy.txt'), later = path.join(f.root, 'later-copy.txt')
    const identity = { runId: 'run', operationId: 'first-save', requestDigest: 'first-request' }
    const ack = rejectSaveAcknowledgements(f.journal)
    await expect(f.host.saveWithFact(f.opened.documentId, target, identity)).rejects.toMatchObject({ publication: 'unknown' })
    ack.mockRestore()
    await f.host.saveWithFact(f.opened.documentId, later)
    const current = (await fs.readdir(f.directory)).find(name => name.endsWith('.save-intent.json'))!
    await fs.writeFile(path.join(f.directory, current), 'unreadable later record')
    expect(await f.host.lookupSave(f.opened.documentId, identity)).toMatchObject({ status: 'saved', path: target, savedRevision: 1 })
    expect(await fs.readFile(target, 'utf8')).toBe('captured')
  })

  it('still refuses proof for an externally replaced file after an uncertain operation is closed', async () => {
    const f = await fixture(), target = path.join(f.root, 'first-copy.txt')
    const identity = { runId: 'run', operationId: 'first-save', requestDigest: 'request' }
    rejectSaveAcknowledgements(f.journal)
    await expect(f.host.saveWithFact(f.opened.documentId, target, identity)).rejects.toMatchObject({ publication: 'unknown' })
    await f.host.operate({ type: 'close', documentId: f.opened.documentId, discardDirty: true })
    await fs.rename(target, target + '.original')
    await fs.writeFile(target, 'captured', { flag: 'wx' })
    const cold = new DocumentHostService(f.directory)
    expect(await cold.lookupSave(f.opened.documentId, identity)).toBeNull()
    expect(await fs.readFile(target, 'utf8')).toBe('captured')
  })

  it('cleans the current intent on an ordinary acknowledged close', async () => {
    const f = await fixture()
    await f.host.saveWithFact(f.opened.documentId)
    await f.host.operate({ type: 'close', documentId: f.opened.documentId })
    expect((await fs.readdir(f.directory)).filter(name => name.endsWith('.journal') || name.endsWith('.save-intent.json'))).toEqual([])
  })
})
