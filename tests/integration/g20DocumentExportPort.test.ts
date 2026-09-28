// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentDeliveryService, type DocumentDeliveryServiceOptions } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { DocumentExportPort } from '../../src/main/workbench/delivery/DocumentExportPort'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExportBuildReply, ExportBuildRequest } from '../../src/shared/workbench/toolPorts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
function snapshot(): DocumentSnapshot {
  return { documentId: 'doc', epoch: 'epoch', revision: 4, binding: { kind: 'untitled', suggestedName: 'Lesson.h5lesson' },
    model: { kind: 'course-v9', project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
      resources: { assets: {}, components: {} } }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}

it('rejects foreign and stale replies; abort removes the pending request', async () => {
  let request!: ExportBuildRequest
  const port = new DocumentExportPort(12, value => { request = value })
  const signal = new AbortController()
  const source = snapshot()
  const buildRequest: ExportBuildRequest = { requestId: 'req', identity: { documentId: source.documentId, epoch: source.epoch,
    revision: source.revision, projectId: source.model.kind === 'course-v9' ? source.model.project.id : '' },
    format: 'html-offline', snapshot: source }
  const promise = port.build(buildRequest, signal.signal)
  const reply: ExportBuildReply = { requestId: request.requestId, identity: request.identity, status: 'generated',
    files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes: new TextEncoder().encode('hello') }], warnings: [] }
  expect(port.accept(reply, 13)).toBe(false)
  expect(port.accept({ ...reply, identity: { ...reply.identity, revision: 5 } }, 12)).toBe(false)
  expect(port.accept(reply, 12)).toBe(true)
  expect(await promise).toEqual(reply)
  expect(port.accept(reply, 12)).toBe(false)
  const late = port.build({ ...buildRequest, requestId: 'late' }, signal.signal)
  signal.abort()
  await expect(late).rejects.toThrow('导出已取消')
  expect(port.accept({ ...reply, requestId: 'late' }, 12)).toBe(false)
  port.dispose()
})

it('writes only a validated byte result and recovers a lost acknowledgement without a second write', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-port-')); roots.push(root)
  const document = snapshot(), filename = path.join(root, 'lesson.html')
  const read = vi.fn(async () => document)
  const writeNew = vi.fn(async (target: string, bytes: Uint8Array) => {
    await fs.writeFile(target, bytes, { flag: 'wx' })
    return { fileVersion: createHash('sha256').update(bytes).digest('hex') }
  })
  const inspect: DocumentDeliveryServiceOptions['writer']['inspect'] = async target => {
    try { const bytes = await fs.readFile(target); const sha256 = createHash('sha256').update(bytes).digest('hex'); return { fileVersion: sha256, sha256 } }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  const operations = new DocumentDeliveryOperationStore(path.join(root, 'ops'))
  const service = new DocumentDeliveryService({ documents: { read, saveWithFact: async () => { throw new Error('not used') },
    withFileLease: async (_id, work) => work(() => document) },
    operations, authorize: async () => undefined, resolveSaveDestination: async () => undefined,
    resolveExportDestination: async () => filename,
    build: { build: async request => ({ requestId: request.requestId, identity: request.identity, status: 'generated', warnings: [],
      files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes: new TextEncoder().encode('<html>complete</html>') }] }) },
    writer: { writeNew, inspect } })
  const input = { runId: 'run', operationId: 'export', requestDigest: 'digest', documentId: document.documentId,
    epoch: document.epoch, revision: document.revision, format: 'html-offline' as const }
  const first = await service.export(input)
  expect(first).toMatchObject({ status: 'written', path: filename, exportedRevision: 4, currentRevision: 4 })
  expect(await fs.readFile(filename, 'utf8')).toBe('<html>complete</html>')
  expect(await service.export(input)).toEqual(first)
  expect(writeNew).toHaveBeenCalledTimes(1)

  const other = { ...input, operationId: 'interrupted' }
  const bytes = new TextEncoder().encode('<html>recovered</html>')
  const recoveredPath = path.join(root, 'recovered.html'), sha256 = createHash('sha256').update(bytes).digest('hex')
  await operations.start({ runId: other.runId, operationId: other.operationId, requestDigest: other.requestDigest, kind: 'export' })
  await fs.writeFile(recoveredPath, bytes)
  await operations.patch(other.runId, other.operationId, { status: 'writing', path: recoveredPath, contentSha256: sha256,
    receipt: { status: 'generated', documentId: document.documentId, epoch: document.epoch, format: other.format,
      exportedRevision: document.revision, currentRevision: document.revision, warnings: [] } })
  expect(await service.lookup(other)).toMatchObject({ status: 'written', path: recoveredPath })
  expect(writeNew).toHaveBeenCalledTimes(1)
})

it('rejects renderer path substitution before any file write', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-invalid-')); roots.push(root)
  const document = snapshot(), writeNew = vi.fn()
  const service = new DocumentDeliveryService({ documents: { read: async () => document, saveWithFact: async () => { throw new Error('not used') },
    withFileLease: async (_id, work) => work(() => document) },
    operations: new DocumentDeliveryOperationStore(path.join(root, 'ops')), authorize: async () => undefined,
    resolveSaveDestination: async () => undefined, resolveExportDestination: async () => path.join(root, 'lesson.html'),
    build: { build: async request => ({ requestId: request.requestId, identity: request.identity, status: 'generated', warnings: [],
      files: [{ relativePath: '../secret.html', mimeType: 'text/html', bytes: new TextEncoder().encode('bad') }] }) },
    writer: { writeNew, inspect: async () => null } })
  const result = await service.export({ runId: 'r', operationId: 'o', requestDigest: 'd', documentId: document.documentId,
    epoch: document.epoch, revision: document.revision, format: 'html-offline' })
  expect(result).toMatchObject({ status: 'rejected' })
  expect(writeNew).not.toHaveBeenCalled()
})

it('distinguishes generated bytes from a written file and refuses a stale binding at the write lease', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-state-')); roots.push(root)
  const document = snapshot(), writeNew = vi.fn()
  const operations = new DocumentDeliveryOperationStore(path.join(root, 'ops'))
  let destination: string | null = null
  let stale = false
  const service = new DocumentDeliveryService({ documents: { read: async () => document,
    saveWithFact: async () => { throw new Error('not used') },
    withFileLease: async (_id, work) => work(() => stale
      ? { ...document, binding: { kind: 'file', path: path.join(root, 'moved.h5lesson'), version: 'v', bindingVersion: 2 } }
      : document) },
    operations, authorize: async () => undefined, resolveSaveDestination: async () => undefined,
    resolveExportDestination: async () => destination,
    build: { build: async request => ({ requestId: request.requestId, identity: request.identity, status: 'generated', warnings: [],
      files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes: new TextEncoder().encode('<html>draft</html>') }] }) },
    writer: { writeNew, inspect: async () => null } })
  const base = { runId: 'r', requestDigest: 'd', documentId: document.documentId, epoch: document.epoch,
    revision: document.revision, format: 'html-offline' as const }
  expect(await service.export({ ...base, operationId: 'generated' })).toMatchObject({ status: 'generated', exportedRevision: 4 })
  expect(writeNew).not.toHaveBeenCalled()
  destination = path.join(root, 'out.html'); stale = true
  expect(await service.export({ ...base, operationId: 'stale' })).toMatchObject({ status: 'rejected', reason: expect.stringContaining('绑定') })
  expect(writeNew).not.toHaveBeenCalled()
})
