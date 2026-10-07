import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { createFlowDocumentRecoveryStore } from '@/main/flowDocumentRecovery'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-recovery-'))
  roots.push(root)
  return { root, operate: createFlowDocumentRecoveryStore(root) }
}
const identity = { projectId: 'same-id', surfaceId: 'flow', projectPath: 'C:\\Lessons\\A.h5lesson', epoch: 'session-1' }
const record = { ...identity, revision: 5, source: '$unfinished', diagnostics: [], composing: false }

describe('Flow recovery path identity and session fences', () => {
  it('isolates Save As paths with the same project ID and normalizes lexical path aliases', async () => {
    const { operate } = await setup()
    await operate({ operation: 'read', target: identity })
    await operate({ operation: 'write', record })
    const savedAs = { ...identity, projectPath: 'C:\\Lessons\\B.h5lesson', epoch: 'session-2' }
    expect(await operate({ operation: 'read', target: savedAs })).toBeNull()
    await operate({ operation: 'write', record: { ...record, ...savedAs, source: 'B only' } })
    expect(await operate({ operation: 'read', target: { ...identity, projectPath: 'c:/lessons/./A.h5lesson', epoch: 'session-3' } })).toMatchObject({ source: '$unfinished' })
    expect(await operate({ operation: 'read', target: { ...identity, projectPath: null, epoch: 'unsaved' } })).toBeNull()
  })
  it('rejects queued and subsequent writes or clears from a retired epoch', async () => {
    const { operate } = await setup()
    await operate({ operation: 'read', target: identity })
    await operate({ operation: 'write', record })
    const staleWrite = operate({ operation: 'write', record: { ...record, source: 'late old edit' } })
    const current = { ...identity, epoch: 'session-2' }
    const read = operate({ operation: 'read', target: current })
    await expect(staleWrite).rejects.toThrow('会话已失效')
    expect(await read).toMatchObject({ source: '$unfinished' })
    await expect(operate({ operation: 'clear', target: identity })).rejects.toThrow('会话已失效')
    expect(() => operate({ operation: 'read', target: identity })).toThrow('会话已失效')
    await operate({ operation: 'write', record: { ...record, ...current, source: 'current edit' } })
    expect(await operate({ operation: 'read', target: current })).toMatchObject({ source: 'current edit' })
  })
  it('restores a previous-process record under the newly registered epoch', async () => {
    const { root, operate } = await setup()
    await operate({ operation: 'read', target: identity })
    await operate({ operation: 'write', record })
    const restarted = createFlowDocumentRecoveryStore(root)
    const current = { ...identity, epoch: 'new-process-session' }
    expect(await restarted({ operation: 'read', target: current })).toMatchObject({ epoch: 'session-1', source: '$unfinished' })
    await restarted({ operation: 'clear', target: current })
    expect(await restarted({ operation: 'read', target: current })).toMatchObject({ source: '$unfinished' })
    await restarted({ operation: 'claim', target: current, recordEpoch: record.epoch, revision: record.revision })
    await restarted({ operation: 'clear', target: current })
    expect(await restarted({ operation: 'read', target: current })).toBeNull()
  })
  it('keeps an older revision retrievable through current writes, clears and document discard', async () => {
    const { operate } = await setup()
    await operate({ operation: 'read', target: identity })
    await operate({ operation: 'write', record })
    const current = { ...identity, epoch: 'current-input', documentEpoch: 'current-document', revision: 8 }
    expect(await operate({ operation: 'read', target: current })).toMatchObject({ source: '$unfinished' })
    await operate({ operation: 'clear', target: current })
    expect(await operate({ operation: 'retained', target: current })).toEqual([record])
    await operate({ operation: 'write', record: { ...record, ...current, source: 'current raw' } })
    await operate.discardDocument({ ...current, epoch: current.documentEpoch })
    const reopened = { ...current, epoch: 'reopen-input', documentEpoch: 'reopen-document' }
    expect(await operate({ operation: 'read', target: reopened })).toBeNull()
    expect(await operate({ operation: 'retained', target: reopened })).toEqual([record])
    await expect(operate({ operation: 'write', record: { ...record, ...current } })).rejects.toThrow('会话已失效')
  })
  it('discards only the adopted document input, not another saved path', async () => {
    const { operate } = await setup()
    await operate({ operation: 'read', target: identity })
    await operate({ operation: 'write', record })
    const other = { ...identity, projectPath: 'C:/Lessons/B.h5lesson', epoch: 'other' }
    await operate({ operation: 'read', target: other })
    await operate({ operation: 'write', record: { ...record, ...other, source: 'other source' } })
    const adopted = { ...identity, epoch: 'adopted', documentEpoch: 'main-epoch' }
    await operate({ operation: 'read', target: adopted })
    await operate({ operation: 'claim', target: adopted, recordEpoch: record.epoch, revision: record.revision })
    await operate.discardDocument({ ...adopted, epoch: 'main-epoch' })
    expect(await operate({ operation: 'read', target: { ...adopted, epoch: 'next' } })).toBeNull()
    expect(await operate({ operation: 'read', target: other })).toMatchObject({ source: 'other source' })
  })
})
