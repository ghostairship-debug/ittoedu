// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { continueDocumentTargets } from '../../src/main/workbench/execution/continuationTargets'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'
import type { DocumentResources } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'timed-r1-source-')) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture(source = 'TARGET\nrest', extension = 'md', from = 0, to = 6) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'timed-r1-source-')); roots.push(root)
  const filename = path.join(root, `source.${extension}`), recovery = path.join(root, 'recovery')
  await fs.writeFile(filename, source)
  const host = new DocumentHostService(recovery), opened = await host.open(filename)
  const session = host.registry.get(opened.documentId)
  const target = { kind: 'markdown-range' as const, from, to }
  const reference: ExecutionDocumentReference = { documentId: opened.documentId, epoch: opened.epoch,
    revision: opened.revision, writable: [target], selection: [target] }
  const replace = async (source: string, historyGroup?: string, resources?: DocumentResources) => {
    const current = session.read()
    const result = await host.dispatch({ documentId: current.documentId, epoch: current.epoch,
      operationId: randomUUID(), actor: 'human', baseRevision: current.revision,
      ...(historyGroup ? { historyGroup } : {}),
      mutation: { type: 'command', command: { type: 'markdown.replace', source, ...(resources ? { resources } : {}) } } })
    expect(result.status).toBe('applied')
  }
  const history = async (type: 'undo' | 'redo') => {
    const current = session.read()
    expect(await host.dispatch({ documentId: current.documentId, epoch: current.epoch,
      operationId: randomUUID(), actor: 'human', baseRevision: current.revision, mutation: { type } })).toMatchObject({ status: 'applied' })
  }
  const continueCurrent = () => continueDocumentTargets(session, reference, new Set())
  return { root, filename, recovery, host, opened, session, target, reference, replace, history, continueCurrent }
}

it('continues a source selection through a disjoint disk reconciliation after recovery', async () => {
  const f = await fixture()
  await fs.writeFile(f.filename, 'TARGET\nrest!')
  const disk = await f.host.observeFile(f.opened.documentId)
  const adopted = await f.host.reconcileFile({ documentId: f.opened.documentId, epoch: f.opened.epoch,
    baseRevision: f.opened.revision, bindingVersion: disk.bindingVersion, version: disk.version, choice: 'disk' })
  expect(adopted).toMatchObject({ revision: 1, dirty: false, undoDepth: 1 })
  // Explicit restore reads the actual durable receipt, even though the adopted file is clean.
  const restarted = new DocumentHostService(f.recovery)
  await restarted.internalAPI.restore(f.opened.documentId)
  const continued = await continueDocumentTargets(restarted.registry.get(f.opened.documentId), f.reference, new Set())
  expect(continued.writable).toEqual([f.target])
  expect(continued.selection).toEqual(continued.writable)
})

it('continues a plain-text selection through coalesced human typing after recovery', async () => {
  const f = await fixture('TARGET\nrest', 'txt')
  await f.replace('TARGET\nrest!', 'typing')
  await f.replace('TARGET\nrest!!', 'typing')
  expect(f.session.read()).toMatchObject({ revision: 2, undoDepth: 1 })
  const restarted = new DocumentHostService(f.recovery)
  await restarted.internalAPI.restore(f.opened.documentId)
  expect((await continueDocumentTargets(restarted.registry.get(f.opened.documentId), f.reference, new Set())).writable).toEqual([f.target])
})

it('continues a source selection through Undo, Redo and a new branch without relying on retained redo models', async () => {
  const f = await fixture()
  await f.replace('TARGET\nrest!')
  await f.history('undo')
  expect((await f.continueCurrent()).writable).toEqual([f.target])
  await f.history('redo')
  expect((await f.continueCurrent()).writable).toEqual([f.target])
  await f.history('undo')
  await f.replace('TARGET\nbranch')
  expect(f.session.read()).toMatchObject({ revision: 5, undoDepth: 1, redoDepth: 0, model: { source: 'TARGET\nbranch' } })
  expect((await f.continueCurrent()).writable).toEqual([f.target])
})

it('keeps source ranges traceable across resource-only commits and their undo without losing resources', async () => {
  const f = await fixture()
  await f.replace('TARGET\nrest', undefined, { assets: { 'assets/pixel.bin': new Uint8Array([3, 7]) }, components: {} })
  expect((await f.continueCurrent()).writable).toEqual([f.target])
  expect(f.session.read().model.resources.assets['assets/pixel.bin']).toEqual(new Uint8Array([3, 7]))
  await f.history('undo')
  expect((await f.continueCurrent()).writable).toEqual([f.target])
  expect(f.session.read().model.resources.assets).toEqual({})
})

it('still rejects overlapping and ambiguous repeated-source changes instead of guessing a range', async () => {
  const overlap = await fixture()
  await overlap.replace('CHANGED\nrest')
  await expect(overlap.continueCurrent()).rejects.toThrow(/重叠|范围/)
  const ambiguous = await fixture('AAAA', 'md', 1, 3)
  await ambiguous.replace('AAAAA')
  await expect(ambiguous.continueCurrent()).rejects.toThrow(/重复文字|范围映射不唯一/)
})
