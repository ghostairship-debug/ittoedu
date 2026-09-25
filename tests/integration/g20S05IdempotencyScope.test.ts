// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ModelToolCall } from '../../src/shared/workbench/tools'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-s05-idempotency-'))
  directories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const make = (source: string, name: string) => host.internalAPI.create({ kind: 'markdown' as const, source,
    resources: { assets: {}, components: {} } }, name)
  const target = await make('AAA BBB', 'target.md')
  const other = await make('OTHER', 'other.md')
  return { directory, host, target, other }
}

const replace = (target: string, content: string): ModelToolCall => ({ name: 'text.replace', input: { target, content } })

it('pins a run to its original document and writable range even after another document becomes active', async () => {
  const { host, target, other } = await fixture()
  const runId = 'limited-run'
  await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: target.documentId,
    writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] })
  await host.tools.describeRun(runId)
  await expect(host.tools.issueTarget(runId, other.documentId, { kind: 'document' })).rejects.toMatchObject({ code: 'not-authorized' })
  await host.tools.beginRun({ runId: 'other-run', actor: 'agent', documents: [{ documentId: other.documentId,
    writable: [{ kind: 'document' }] }] })
  const foreign = await host.tools.issueTarget('other-run', other.documentId, { kind: 'markdown-range', from: 0, to: 5 })
  expect(await host.tools.execute(runId, 'foreign', replace(foreign, 'BAD'))).toMatchObject({ kind: 'error', code: 'invalid-target' })
  const allowed = await host.tools.issueTarget(runId, target.documentId, { kind: 'markdown-range', from: 0, to: 3 })
  const outside = await host.tools.issueTarget(runId, target.documentId, { kind: 'markdown-range', from: 4, to: 7 })
  expect(await host.tools.execute(runId, 'outside', replace(outside, 'BAD'))).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect((await host.internalAPI.read(target.documentId))).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'AAA BBB' } })
  expect((await host.internalAPI.read(other.documentId))).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'OTHER' } })
  expect(await host.tools.execute(runId, 'allowed', replace(allowed, 'NEW'))).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect((await host.internalAPI.read(target.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'NEW BBB' } })

  // The same persisted document restored into a new epoch cannot renew the old run's handles.
  await host.registry.close(target.documentId, { discardDirty: true })
  const restored = await host.internalAPI.restore(target.documentId)
  expect(restored.epoch).not.toBe(target.epoch)
  expect(await host.tools.execute(runId, 'late-new-call', replace(allowed, 'LATE'))).toMatchObject({ kind: 'error', code: 'stale-epoch' })
  expect(await host.tools.execute(runId, 'allowed', replace(allowed, 'NEW'))).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
  expect((await host.internalAPI.read(target.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'NEW BBB' } })
})

it('queries a durable lost ACK and replays only the original operation across a fresh Gateway', async () => {
  const { directory, host, target } = await fixture()
  const runId = 'receipt-run', callId = 'replace-call'
  await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: target.documentId,
    writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] })
  await host.tools.describeRun(runId)
  const handle = await host.tools.issueTarget(runId, target.documentId, { kind: 'markdown-range', from: 0, to: 3 })
  const call = replace(handle, 'DONE')
  const observedFailure = async () => { await host.tools.execute(runId, callId, call); throw new Error('injected lost transport ACK') }
  await expect(observedFailure()).rejects.toThrow('injected lost transport ACK')
  const committed = await host.internalAPI.read(target.documentId)
  expect(committed).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'DONE BBB' } })
  const receipt = await host.tools.lookup(runId, callId, call)
  expect(receipt).toMatchObject({ kind: 'document-operation', result: { status: 'applied', documentId: target.documentId,
    beforeRevision: 0, revision: 1 } })
  expect(await host.tools.execute(runId, callId, call)).toEqual(receipt)
  expect(await host.tools.execute(runId, callId, replace(handle, 'DIFFERENT'))).toMatchObject({ kind: 'error', code: 'operation-payload-mismatch' })
  expect((await host.internalAPI.read(target.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'DONE BBB' } })

  const reopened = new DocumentHostService(path.join(directory, 'documents'))
  const recovered = await reopened.internalAPI.restore(target.documentId)
  expect(recovered).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'DONE BBB' } })
  reopened.tools.recoverRun({ runId, actor: 'agent', documents: [{ documentId: target.documentId,
    writable: [{ kind: 'document' }] }] }) // Recovery deliberately strips this supplied write grant.
  expect(await reopened.tools.lookup(runId, callId, call)).toEqual(receipt)
  expect(await reopened.tools.execute(runId, callId, call)).toEqual(receipt)
  expect(await reopened.tools.execute(runId, 'new-call', replace(handle, 'BAD'))).toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect((await reopened.internalAPI.read(target.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'DONE BBB' } })
})
