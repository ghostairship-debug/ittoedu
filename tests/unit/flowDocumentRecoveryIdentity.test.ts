import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { DocumentInputRecovery } from '@/main/workbench/DocumentInputRecovery'
import { readLegacyFlowDocumentInputs } from '@/main/flowDocumentRecovery'
import type { DocumentSnapshot } from '@/shared/workbench/document'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-recovery-'))
  roots.push(root)
  const owner = { documentId: 'document-1', epoch: 'session-1', model: { kind: 'course-v10', project: { id: 'same-id' }, resources: { assets: {}, components: {} } }, binding: { kind: 'file', path: 'C:\\Lessons\\A.h5lesson', version: 'disk', bindingVersion: 1 } } as Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'model' | 'binding'>
  return { root, owner, store: new DocumentInputRecovery(path.join(root, 'raw'), path.join(root, 'legacy')) }
}
const identity = { projectId: 'same-id', surfaceId: 'flow', projectPath: 'C:\\Lessons\\A.h5lesson', epoch: 'session-1' }
const record = { ...identity, revision: 5, source: '$unfinished', diagnostics: [], composing: false }

describe('Flow input migration into the document owner', () => {
  it('isolates Save As from an old path while lexical aliases locate the original candidate', async () => {
    const { store, owner } = await setup()
    await store.write(owner, { flow: [{ ...record, documentId: owner.documentId, documentEpoch: owner.epoch }], flowSurfaceId: 'flow' })
    const alias = { ...owner, documentId: 'reopened', epoch: 'reopen', binding: { kind: 'file' as const, path: 'c:/lessons/./A.h5lesson', version: 'disk', bindingVersion: 1 } }
    expect((await store.read(alias))?.flow?.[0]?.source).toBe('$unfinished')
    const savedAs = { ...owner, binding: { kind: 'file' as const, path: 'C:/Lessons/B.h5lesson', version: 'disk', bindingVersion: 2 } }
    await store.refresh(savedAs)
    expect(await store.read(alias)).toBeNull()
    expect((await store.read(savedAs))?.flow?.[0]?.source).toBe('$unfinished')
  })
  it('retains previous process raw until exact claim, and clears only the adopted owner', async () => {
    const { root, store, owner } = await setup()
    await store.write(owner, { flow: [record] })
    const restarted = new DocumentInputRecovery(path.join(root, 'raw'))
    const current = { ...owner, documentId: 'document-2', epoch: 'session-2' }
    const read = (await restarted.read(current))!
    await restarted.write(current, { flow: [] })
    expect((await restarted.read(current))?.flow).toHaveLength(1)
    await restarted.claim(current, read.recoveryRecords!)
    await restarted.write(current, { flow: [] })
    expect(await restarted.read(current)).toBeNull()
    expect(await restarted.read(owner)).toBeNull()
  })
  it('does not accept a late current-slice write after document ownership retired', async () => {
    const { store, owner } = await setup()
    await store.write(owner, { flow: [record] })
    await expect(store.write(owner, { flow: [] }, () => { throw new Error('retired document epoch') })).rejects.toThrow('retired')
    expect((await store.read(owner))?.flow?.[0]?.source).toBe('$unfinished')
  })
  it('discovers legacy retained orphan inputs without assigning them to an arbitrary live document', async () => {
    const { root, store, owner } = await setup()
    const legacy = path.join(root, 'legacy'); await fs.mkdir(path.join(legacy, 'retained'), { recursive: true })
    await fs.writeFile(path.join(legacy, 'retained', 'orphan.json'), JSON.stringify(record))
    expect(await readLegacyFlowDocumentInputs(legacy)).toHaveLength(1)
    const candidates = await store.list()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.documentId).toMatch(/^unclaimed-flow:/)
    expect(candidates[0]!.documentId).not.toBe(owner.documentId)
    expect((await store.read(owner))?.flow?.[0]?.source).toBe('$unfinished')
  })
  it('current surface clearing does not remove another surface or a different file owner', async () => {
    const { store, owner } = await setup()
    await store.write(owner, { flow: [record] })
    await store.write(owner, { flow: [{ ...record, surfaceId: 'other-flow', source: 'other surface' }], flowSurfaceId: 'other-flow' })
    const other = { ...owner, documentId: 'other-document', epoch: 'other-epoch', binding: { kind: 'file' as const, path: 'C:/Lessons/B.h5lesson', version: 'disk', bindingVersion: 1 } }
    await store.write(other, { flow: [{ ...record, projectPath: 'C:/Lessons/B.h5lesson', source: 'other file' }] })
    await store.write(owner, { flow: [], flowSurfaceId: 'flow' })
    expect((await store.read(owner))?.flow?.map(item => item.source)).toEqual(['other surface'])
    expect((await store.read(other))?.flow?.[0]?.source).toBe('other file')
  })
})
