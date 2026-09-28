// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import type { DocumentDeliveryServiceOptions } from '../../src/main/workbench/delivery/DocumentDeliveryService'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-delivery-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const document = await host.internalAPI.create({ kind: 'markdown', source: '# original\n', resources: { assets: {}, components: {} } }, 'note.md')
  const target = path.join(root, 'note.md')
  const authorize = vi.fn(async () => undefined)
  const saveWithFact = vi.fn((documentId: string, filename?: string) => host.saveWithFact(documentId, filename))
  const writer: DocumentDeliveryServiceOptions['writer'] = {
    writeNew: async (filename, bytes) => {
      await fs.writeFile(filename, bytes, { flag: 'wx' })
      return { fileVersion: createHash('sha256').update(bytes).digest('hex') }
    },
    inspect: async filename => {
      try { const bytes = await fs.readFile(filename); const sha256 = createHash('sha256').update(bytes).digest('hex'); return { fileVersion: sha256, sha256 } }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    },
  }
  const service = new DocumentDeliveryService({
    documents: { read: host.internalAPI.read, saveWithFact,
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(root, 'operations')),
    authorize, resolveSaveDestination: async () => target, resolveExportDestination: async () => null,
    build: { build: async () => { throw new Error('not used') } }, writer,
  })
  return { root, host, document, target, authorize, saveWithFact, service }
}

it('saves through the canonical host, reports captured revision and returns the durable receipt on repeat', async () => {
  const { host, document, target, saveWithFact, service } = await fixture()
  const input = { runId: 'r1', operationId: 'save-1', requestDigest: 'd1', documentId: document.documentId,
    epoch: document.epoch, baseRevision: document.revision }
  const result = await service.save(input)
  expect(result).toMatchObject({ status: 'saved', path: target, savedRevision: document.revision,
    currentRevision: document.revision, dirty: false })
  expect(await fs.readFile(target, 'utf8')).toBe('# original\n')
  expect(await service.save(input)).toEqual(result)
  expect(saveWithFact).toHaveBeenCalledTimes(1)
  expect((await host.internalAPI.read(document.documentId)).binding.kind).toBe('file')
})

it('rejects a read-only grant even for a clean document and never calls the save writer', async () => {
  const { document, target, authorize, saveWithFact, service } = await fixture()
  authorize.mockRejectedValueOnce(new Error('只读档不能写盘'))
  const result = await service.save({ runId: 'readonly', operationId: 'save-2', requestDigest: 'd2',
    documentId: document.documentId, epoch: document.epoch, baseRevision: document.revision })
  expect(result).toMatchObject({ status: 'rejected', reason: '只读档不能写盘' })
  expect(saveWithFact).not.toHaveBeenCalled()
  await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps savedRevision separate from a later currentRevision and leaves dirty true', async () => {
  const { host, document, target, service, saveWithFact } = await fixture()
  saveWithFact.mockImplementationOnce(async (documentId, filename) => {
    const saved = await host.saveWithFact(documentId, filename)
    const before = await host.internalAPI.read(documentId)
    await host.internalAPI.dispatch({ documentId, epoch: before.epoch, operationId: 'human-later', baseRevision: before.revision,
      actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: '# later\n' } } })
    return { snapshot: await host.internalAPI.read(documentId), savedRevision: saved.savedRevision }
  })
  const result = await service.save({ runId: 'race', operationId: 'save-3', requestDigest: 'd3',
    documentId: document.documentId, epoch: document.epoch, baseRevision: document.revision })
  expect(result).toMatchObject({ status: 'saved', savedRevision: document.revision,
    currentRevision: document.revision + 1, dirty: true })
  expect(await fs.readFile(target, 'utf8')).toBe('# original\n')
})
