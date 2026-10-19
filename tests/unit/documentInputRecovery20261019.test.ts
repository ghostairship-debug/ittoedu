// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentInputRecovery } from '../../src/main/workbench/DocumentInputRecovery'
import { documentDigest } from '../../src/core/documents/documentDigest'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'document-inputs-')); roots.push(root)
  const directory = path.join(root, 'raw'), legacyFlow = path.join(root, 'flow')
  const owner = { documentId: 'original', epoch: 'epoch-1', model: { kind: 'text', source: 'saved', resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: path.join(root, 'source.txt'), version: 'disk', bindingVersion: 1 } } as Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'model' | 'binding'>
  return { root, directory, legacyFlow, owner, store: new DocumentInputRecovery(directory, legacyFlow) }
}
const conflict = (documentId = 'original', epoch = 'epoch-1', text = 'unfinished') => ({ documentId, epoch, source: 'saved', diskVersion: 'disk',
  conflictBaseline: 'baseline', hunks: [{ id: 'conflict-1-2', text }] })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function blockPublication(directory: string, documentId: string) {
  const entered = deferred(), release = deferred(), rename = fs.rename.bind(fs)
  let first = true
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if (first && String(destination) === path.join(directory, `${documentDigest({ documentId })}.inputs-v2.json`)) {
      first = false; entered.resolve(); await release.promise
    }
    await rename(source, destination)
  })
  return { entered: entered.promise, release: release.resolve }
}

describe('one document input recovery owner', () => {
  it('publishes an independent document while a large owner is blocked, preserves owner order, and lets list observe admitted writes', async () => {
    const f = await fixture(), gate = blockPublication(f.directory, f.owner.documentId)
    const first = f.store.write(f.owner, { sourceConflicts: [conflict('original', 'epoch-1', 'large input')] })
    await gate.entered
    let secondDone = false, listed = false
    const second = f.store.write(f.owner, { sourceConflicts: [conflict('original', 'epoch-1', 'latest input')] }).then(() => { secondDone = true })
    const listing = f.store.list().then(value => { listed = true; return value })
    try {
      const other = { ...f.owner, documentId: 'independent', binding: { kind: 'untitled' as const, suggestedName: 'other' } }
      await f.store.write(other, { sourceConflicts: [conflict('independent', 'epoch-1', 'independent input')] })
      expect(secondDone).toBe(false)
      expect(listed).toBe(false)
    } finally { gate.release() }
    await Promise.all([first, second])
    const envelopes = await listing
    expect(envelopes.find(value => value.documentId === 'original')!.records.map(value => value.kind === 'sourceConflict' && value.value)).toEqual([conflict('original', 'epoch-1', 'latest input')])
    expect((await f.store.read(f.owner))!.sourceConflicts?.map(value => value.hunks[0]!.text)).toEqual(['latest input'])
  })
  it('serializes claim with both old and new owners while unrelated input remains writable', async () => {
    const f = await fixture(), next = { ...f.owner, documentId: 'reopened', epoch: 'epoch-2' }
    await f.store.write(f.owner, { sourceConflicts: [conflict(), conflict('original', 'epoch-1', 'unselected')] })
    const selected = (await f.store.read(next))!.recoveryRecords!.find(value => value.kind === 'sourceConflict'
      && (value.value as ReturnType<typeof conflict>).hunks[0]!.text === 'unfinished')!
    const gate = blockPublication(f.directory, next.documentId)
    const claiming = f.store.claim(next, [selected])
    await gate.entered
    const old = { ...f.owner, epoch: 'epoch-3' }
    const oldWrite = f.store.write(old, { sourceConflicts: [conflict('original', 'epoch-3', 'new original input')] })
    const newWrite = f.store.write(next, { properties: [{ bindingKey: 'field', kind: 'text', label: 'field', raw: 'new target input', composing: false }] })
    const listing = f.store.list()
    try {
      const other = { ...f.owner, documentId: 'independent', binding: { kind: 'untitled' as const, suggestedName: 'other' } }
      await f.store.write(other, { sourceConflicts: [conflict('independent')] })
      const source = JSON.parse(await fs.readFile(path.join(f.directory, `${documentDigest({ documentId: f.owner.documentId })}.inputs-v2.json`), 'utf8'))
      expect(source.records).toHaveLength(2)
    } finally { gate.release() }
    await Promise.all([claiming, oldWrite, newWrite])
    const found = await listing
    expect(found.find(value => value.documentId === 'reopened')!.records).toHaveLength(2)
    expect((await f.store.read(old))!.recoveryRecords!.filter(value => value.ownerDocumentId === 'original').map(value => (value.value as ReturnType<typeof conflict>).hunks[0]!.text).sort()).toEqual(['new original input', 'unselected'])
    expect((await f.store.read(next))!.recoveryRecords!.filter(value => value.ownerDocumentId === 'reopened')).toHaveLength(2)
  })
  it('keeps the original owner when the claim target cannot ACK publication and permits a later exact retry', async () => {
    const f = await fixture(), next = { ...f.owner, documentId: 'reopened', epoch: 'epoch-2' }
    await f.store.write(f.owner, { sourceConflicts: [conflict()] })
    const selected = (await f.store.read(next))!.recoveryRecords![0]!
    const rename = fs.rename.bind(fs); let fail = true
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (fail && String(destination) === path.join(f.directory, `${documentDigest({ documentId: next.documentId })}.inputs-v2.json`)) {
        fail = false; throw new Error('target publication failed')
      }
      await rename(source, destination)
    })
    await expect(f.store.claim(next, [selected])).rejects.toThrow('publication failed')
    expect((await f.store.list()).map(value => value.documentId)).toEqual(['original'])
    await f.store.claim(next, [selected])
    expect((await f.store.list()).map(value => value.documentId)).toEqual(['reopened'])
  })
  it('relocates a first publication already admitted before the move, then orders refresh before discard', async () => {
    const f = await fixture(), gate = blockPublication(f.directory, f.owner.documentId)
    const writing = f.store.write(f.owner, { sourceConflicts: [conflict()] })
    await gate.entered
    const destination = path.join(f.root, 'moved.txt'), originalPath = f.owner.binding.kind === 'file' ? f.owner.binding.path : ''
    const moving = f.store.relocate({ operationId: 'move', workspaceId: 'workspace', kind: 'move',
      sources: [{ entryId: 'source', resolvedPath: originalPath, kind: 'file' }],
      target: { workspaceId: 'workspace', directoryEntryId: 'root', resolvedDirectoryPath: f.root, resolvedPath: destination },
      affectedPaths: [originalPath, destination], overwrite: false })
    try {
      await f.store.write({ ...f.owner, documentId: 'independent', binding: { kind: 'untitled', suggestedName: 'other' } }, { sourceConflicts: [conflict('independent')] })
    } finally { gate.release() }
    await Promise.all([writing, moving])
    expect((await f.store.list()).find(value => value.documentId === f.owner.documentId)!.binding).toMatchObject({ kind: 'file', path: destination, bindingVersion: 2 })
    const refreshing = f.store.refresh({ ...f.owner, binding: { kind: 'file', path: destination, version: 'moved', bindingVersion: 2 } })
    const discarding = f.store.discard(f.owner.documentId)
    await Promise.all([refreshing, discarding])
    expect((await f.store.list()).map(value => value.documentId)).toEqual(['independent'])
  })
  it('coordinates a legacy source with its foreign target while preserving a concurrent target write and an independent write', async () => {
    const f = await fixture(), foreign = { ...f.owner, documentId: 'foreign' }
    await fs.mkdir(f.directory, { recursive: true })
    const source = path.join(f.directory, `${documentDigest({ documentId: f.owner.documentId })}.json`)
    await fs.writeFile(source, JSON.stringify({ advanced: [], properties: [], sourceConflict: conflict('foreign', 'legacy-epoch', 'legacy input') }))
    const gate = blockPublication(f.directory, foreign.documentId)
    const migrating = f.store.read(f.owner)
    await gate.entered
    const targetWrite = f.store.write(foreign, { sourceConflicts: [conflict('foreign', 'epoch-1', 'current input')] })
    try {
      await f.store.write({ ...f.owner, documentId: 'independent', binding: { kind: 'untitled', suggestedName: 'other' } }, { sourceConflicts: [conflict('independent')] })
      expect(JSON.parse(await fs.readFile(source, 'utf8')).sourceConflict.hunks[0].text).toBe('legacy input')
    } finally { gate.release() }
    await Promise.all([migrating, targetWrite])
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await f.store.read(foreign))!.sourceConflicts?.map(value => value.hunks[0]!.text).sort()).toEqual(['current input', 'legacy input'])
  })
  it('read does not consume another owner; exact claim persists the selected raw before consuming only that record', async () => {
    const f = await fixture()
    await f.store.write(f.owner, { sourceConflicts: [conflict(), conflict('original', 'epoch-1', 'second raw')] })
    const next = { ...f.owner, documentId: 'reopened', epoch: 'epoch-2' }
    const read = (await f.store.read(next))!
    expect(read.sourceConflicts).toHaveLength(2)
    expect((await f.store.read(f.owner))!.sourceConflicts).toHaveLength(2)
    await expect(f.store.claim(next, [{ id: read.recoveryRecords![0]!.id, digest: 'wrong' }])).rejects.toThrow('未消费')
    await f.store.claim(next, [read.recoveryRecords![0]!])
    const owners = await f.store.list()
    expect(owners.find(value => value.documentId === 'reopened')!.records).toHaveLength(1)
    expect(owners.find(value => value.documentId === 'original')!.records).toHaveLength(1)
  })
  it('keeps unclaimed older-epoch input when the current provider writes or clears, and isolates Save As from the old file', async () => {
    const f = await fixture()
    await f.store.write(f.owner, { sourceConflicts: [conflict()] })
    const recovered = { ...f.owner, epoch: 'restored-epoch' }
    await f.store.write(recovered, { sourceConflicts: [conflict('original', 'restored-epoch', 'current')] })
    await f.store.write(recovered, { sourceConflicts: [] })
    expect((await f.store.read(recovered))!.sourceConflicts?.map(value => value.hunks[0]!.text)).toEqual(['unfinished'])
    const moved = { ...recovered, binding: { kind: 'file' as const, path: path.join(f.root, 'saved-as.txt'), version: 'new', bindingVersion: 2 } }
    await f.store.refresh(moved)
    expect(await f.store.read({ ...f.owner, documentId: 'old-file', epoch: 'new' })).toBeNull()
    expect((await f.store.read(moved))!.sourceConflicts).toHaveLength(1)
  })
  it('merges different legacy and existing conflicts; deletion interruption retries without losing or duplicating either raw', async () => {
    const f = await fixture()
    await f.store.write(f.owner, { sourceConflicts: [conflict()] })
    const source = path.join(f.directory, `${documentDigest({ documentId: f.owner.documentId })}.json`)
    await fs.writeFile(source, JSON.stringify({ advanced: [], properties: [], sourceConflict: conflict('original', 'epoch-1', 'legacy second') }))
    const remove = fs.rm.bind(fs); let interrupted = false
    vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      if (String(file) === source && !interrupted) { interrupted = true; throw new Error('cut after publish') }
      return remove(file, options)
    })
    await expect(f.store.read(f.owner)).rejects.toThrow('cut after publish')
    expect(JSON.parse(await fs.readFile(source, 'utf8')).sourceConflict.hunks[0].text).toBe('legacy second')
    const read = (await f.store.read(f.owner))!
    expect(read.sourceConflicts?.map(value => value.hunks[0]!.text).sort()).toEqual(['legacy second', 'unfinished'])
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    await f.store.write(f.owner, { sourceConflicts: [] })
    expect((await f.store.read(f.owner))!.sourceConflicts?.map(value => value.hunks[0]!.text)).toEqual(['legacy second'])
  })
  it('does not commit input admitted by a retired document epoch', async () => {
    const f = await fixture()
    await f.store.write(f.owner, { sourceConflicts: [conflict()] })
    await expect(f.store.write(f.owner, { sourceConflicts: [] }, () => { throw new Error('retired epoch') })).rejects.toThrow('retired')
    expect((await f.store.read(f.owner))!.sourceConflicts).toHaveLength(1)
  })
  it('discovers owner-bearing and unknown legacy input as original materials without guessing the current document', async () => {
    const f = await fixture()
    await fs.mkdir(f.directory, { recursive: true })
    await fs.writeFile(path.join(f.directory, 'unknown-locator.json'), JSON.stringify({ advanced: [], properties: [{ bindingKey: 'unparsed', kind: 'text', label: '原输入', raw: 'unowned raw', composing: false }], sourceConflict: conflict('old-text-owner', 'old-epoch', 'old source hunk') }))
    const found = await f.store.list()
    expect(found.map(value => value.documentId).sort()).toEqual(['old-text-owner', 'unclaimed-input:unknown-locator'])
    expect(found.map(value => f.store.material(value).source).join('\n')).toContain('unowned raw')
    expect(found.map(value => f.store.material(value).source).join('\n')).toContain('old source hunk')
    expect(await f.store.read(f.owner)).toBeNull()
  })
  it('deduplicates the same Flow original across provider generations while preserving different raw text', async () => {
    const f = await fixture()
    const owner = { ...f.owner, model: { kind: 'course-v10', project: { id: 'project' }, resources: { assets: {}, components: {} } } } as typeof f.owner
    const flow = { projectId: 'project', surfaceId: 'flow', projectPath: 'D:/one.glx', epoch: 'generation-one', documentEpoch: 'epoch-1', revision: 1, source: 'same raw', diagnostics: [], composing: false }
    await f.store.write(owner, { flow: [flow, { ...flow, epoch: 'generation-two' }, { ...flow, epoch: 'generation-three', source: 'different raw' }] })
    expect((await f.store.read(owner))!.flow?.map(value => value.source).sort()).toEqual(['different raw', 'same raw'])
  })
  it('ingests both old Flow active and retained input without overwriting a different retained source', async () => {
    const f = await fixture(), owner = { ...f.owner, model: { kind: 'course-v10', project: { id: 'project' }, resources: { assets: {}, components: {} } } } as typeof f.owner
    await fs.mkdir(path.join(f.legacyFlow, 'retained'), { recursive: true })
    const flow = { projectId: 'project', surfaceId: 'flow', projectPath: f.owner.binding.kind === 'file' ? f.owner.binding.path : '', epoch: 'provider-old',
      documentEpoch: 'epoch-1', revision: 4, source: 'active raw', diagnostics: [], composing: false }
    await fs.writeFile(path.join(f.legacyFlow, 'active.json'), JSON.stringify(flow))
    await fs.writeFile(path.join(f.legacyFlow, 'retained', 'retained.json'), JSON.stringify({ ...flow, source: 'retained raw' }))
    const read = (await f.store.read(owner))!
    expect(read.flow?.map(value => value.source).sort()).toEqual(['active raw', 'retained raw'])
    await f.store.write(owner, { flow: [], flowSurfaceId: 'flow' })
    expect((await f.store.read(owner))!.flow).toHaveLength(2)
    expect(await fs.readdir(path.join(f.legacyFlow, 'retained'))).toEqual([])
  })
})
