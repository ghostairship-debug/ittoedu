// @vitest-environment node
import { createHash } from 'node:crypto'
import { publicationIdentity } from '../../src/main/workbench/publishNewFile'
import { workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentDeliveryService, type DocumentDeliveryServiceOptions } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { DocumentExportPort } from '../../src/main/workbench/delivery/DocumentExportPort'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExportBuildReply, ExportBuildRequest } from '../../src/shared/workbench/toolPorts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
function snapshot(): DocumentSnapshot {
  return { documentId: 'doc', epoch: 'epoch', revision: 4, binding: { kind: 'untitled', suggestedName: 'Lesson.glx' },
    model: { kind: 'course-v10', project: createBlankCourseProjectV10('Lesson'),
      resources: { assets: {}, components: {} } }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}

it('rejects foreign and stale replies; abort removes the pending request', async () => {
  let request!: ExportBuildRequest
  const port = new DocumentExportPort(12, value => { request = value })
  const signal = new AbortController()
  const source = snapshot()
  const buildRequest: ExportBuildRequest = { requestId: 'req', identity: { documentId: source.documentId, epoch: source.epoch,
    revision: source.revision, projectId: source.model.kind === 'course-v10' ? source.model.project.id : '' },
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
    try { const bytes = await fs.readFile(target); const sha256 = createHash('sha256').update(bytes).digest('hex'); return { fileVersion: sha256, sha256, publicationIdentity: await publicationIdentity(target) } }
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
  await operations.patch(other.runId, other.operationId, { status: 'writing', path: recoveredPath, contentSha256: sha256, publicationIdentity: await publicationIdentity(recoveredPath),
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
      ? { ...document, binding: { kind: 'file', path: path.join(root, 'moved.glx'), version: 'v', bindingVersion: 2 } }
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

it('updates only this run own export, keeps unknown files and interrupted writes intact', async () => {
  const { workbenchExportWriter } = await import('../../src/main/workbench/workbenchDeliveryAdapters')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-update-')); roots.push(root)
  const document = snapshot(), filename = path.join(root, 'lesson.html')
  let source = '<html>first</html>'
  const options: DocumentDeliveryServiceOptions = { documents: { read: async () => document,
    saveWithFact: async () => { throw new Error('not used') }, withFileLease: async (_id, work) => work(() => document) },
    operations: new DocumentDeliveryOperationStore(path.join(root, 'ops')), authorize: async () => undefined,
    resolveSaveDestination: async () => undefined, resolveExportDestination: async () => filename,
    build: { build: async request => ({ requestId: request.requestId, identity: request.identity, status: 'generated', warnings: [],
      files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes: Buffer.from(source) }] }) }, writer: workbenchExportWriter }
  const service = new DocumentDeliveryService(options)
  const base = { runId: 'owner', documentId: 'doc', epoch: 'epoch', revision: 4, format: 'html-offline' as const }
  expect(await service.export({ ...base, operationId: 'one', requestDigest: 'one' })).toMatchObject({ status: 'written' })
  source = '<html>second</html>'
  // A fresh service can prove ownership from durable receipts, not an in-memory shortcut.
  expect(await new DocumentDeliveryService(options).export({ ...base, operationId: 'two', requestDigest: 'two' })).toMatchObject({ status: 'written' })
  expect(await fs.readFile(filename, 'utf8')).toBe(source)
  expect(await service.export({ ...base, runId: 'foreign', operationId: 'foreign', requestDigest: 'foreign' })).toMatchObject({ status: 'rejected' })
  await fs.writeFile(filename, '<html>human</html>')
  expect(await service.export({ ...base, operationId: 'human', requestDigest: 'human' })).toMatchObject({ status: 'rejected' })
  expect(await fs.readFile(filename, 'utf8')).toBe('<html>human</html>')
  const version = (await workbenchExportWriter.inspect(filename))!.fileVersion
  const controller = new AbortController(); controller.abort()
  await expect(workbenchExportWriter.replaceExisting(filename, Buffer.from('bad'), version, controller.signal)).rejects.toThrow()
  expect(await fs.readFile(filename, 'utf8')).toBe('<html>human</html>')
  expect((await fs.readdir(root)).some(name => name.endsWith('.tmp'))).toBe(false)
})


it('updates a verified task ancestor export across restart epochs but refuses context-only ownership and external changes', async () => {
  const { workbenchExportWriter } = await import('../../src/main/workbench/workbenchDeliveryAdapters')
  const { ExecutionRunStore } = await import('../../src/main/workbench/execution/ExecutionRunStore')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-lineage-')); roots.push(root)
  const document = snapshot(), filename = path.join(root, 'lesson.html')
  const runs = new ExecutionRunStore(path.join(root, 'runs'))
  const run = (runId: string, taskContinuedFrom?: string) => ({ schemaVersion: 1, runId, version: 1, status: 'completed', createdAt: 1, updatedAt: 1,
    input: { conversationId: 'conversation', taskId: runId, instruction: 'test', selection: {} as never, documents: [] }, initialMessageCount: 0, messages: [], tools: [], requests: [], ...(taskContinuedFrom ? { taskContinuedFrom } : {}) }) as import('../../src/shared/workbench/execution').ExecutionRunRecord
  await runs.save(run('parent')); await runs.save(run('child', 'parent')); await runs.save({ ...run('other'), continuedFrom: 'parent' })
  let source = 'first'
  const service = new DocumentDeliveryService({ documents: { read: async () => document, saveWithFact: async () => { throw new Error('unused') },
    withFileLease: async (_id, work) => work(() => document) }, operations: new DocumentDeliveryOperationStore(path.join(root, 'ops')),
    authorize: async () => undefined, taskRunIds: runId => runs.taskLineage(runId), resolveSaveDestination: async () => undefined,
    resolveExportDestination: async () => filename, writer: workbenchExportWriter,
    build: { build: async request => ({ requestId: request.requestId, identity: request.identity, status: 'generated', warnings: [],
      files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes: Buffer.from(source) }] }) } })
  const input = { runId: 'parent', operationId: 'first', requestDigest: 'first', documentId: document.documentId, epoch: document.epoch, revision: document.revision, format: 'html-offline' as const }
  expect(await service.export(input)).toMatchObject({ status: 'written' })
  document.epoch = 'restored-epoch'; source = 'revised'
  expect(await service.export({ ...input, epoch: document.epoch, runId: 'other', operationId: 'other', requestDigest: 'other' })).toMatchObject({ status: 'rejected' })
  expect(await service.export({ ...input, epoch: document.epoch, runId: 'child', operationId: 'child', requestDigest: 'child' })).toMatchObject({ status: 'written' })
  expect(await fs.readFile(filename, 'utf8')).toBe('revised')
  await fs.writeFile(filename, 'external change')
  expect(await service.export({ ...input, epoch: document.epoch, runId: 'child', operationId: 'again', requestDigest: 'again' })).toMatchObject({ status: 'rejected' })
  expect(await fs.readFile(filename, 'utf8')).toBe('external change')
})


it.each(['EEXIST', 'ENOSPC', 'EACCES'])('records %s before export publication as a definite rejection, never an unresolved write', async code => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-rejection-')); roots.push(root)
  const document = snapshot(), filename = path.join(root, 'lesson.html')
  const operations = new DocumentDeliveryOperationStore(path.join(root, 'ops'))
  const service = new DocumentDeliveryService({ documents: { read: async () => document,
    saveWithFact: async () => { throw new Error('unused') }, withFileLease: async (_id, work) => work(() => document) },
    operations, authorize: async () => undefined, resolveSaveDestination: async () => undefined,
    resolveExportDestination: async () => filename, writer: workbenchExportWriter,
    build: { build: async request => ({ requestId: request.requestId, identity: request.identity, status: 'generated', warnings: [],
      files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes: Buffer.from('complete export') }] }) } })
  const input = { runId: 'run', operationId: code, requestDigest: code, documentId: 'doc', epoch: 'epoch', revision: 4, format: 'html-offline' as const }
  const link = vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error(code), { code }))
  try {
    expect(await service.export(input)).toMatchObject({ status: 'rejected', reason: expect.stringContaining(code) })
    expect(await service.lookup(input)).toMatchObject({ status: 'rejected' })
    expect(link).toHaveBeenCalledTimes(1)
    await expect(fs.stat(filename)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { link.mockRestore() }
})

it.each([false, true])('queries a published export by candidate identity, not coincidentally equal bytes (foreign replacement: %s)', async replace => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-proof-')); roots.push(root)
  const document = snapshot(), filename = path.join(root, 'lesson.html'), operations = new DocumentDeliveryOperationStore(path.join(root, 'ops'))
  const bytes = Buffer.from('<html>complete evidence</html>'), writer = { ...workbenchExportWriter, writeNew: vi.fn(workbenchExportWriter.writeNew) }
  const service = new DocumentDeliveryService({ documents: { read: async () => document,
    saveWithFact: async () => { throw new Error('unused') }, withFileLease: async (_id, work) => work(() => document) },
    operations, authorize: async () => undefined, resolveSaveDestination: async () => undefined,
    resolveExportDestination: async () => filename, writer,
    build: { build: async request => ({ requestId: request.requestId, identity: request.identity, status: 'generated', warnings: [],
      files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes }] }) } })
  const patchOperation = operations.patch.bind(operations)
  const lost = vi.spyOn(operations, 'patch').mockImplementation(async (runId, operationId, change) => {
    if (change.status === 'completed') throw new Error('fixture: outer ACK lost')
    return patchOperation(runId, operationId, change)
  })
  const input = { runId: 'run', operationId: 'proof', requestDigest: 'proof', documentId: 'doc', epoch: 'epoch', revision: 4, format: 'html-offline' as const }
  await expect(service.export(input)).rejects.toMatchObject({ code: 'tool-outcome-unknown' })
  lost.mockRestore()
  const originalIdentity = await publicationIdentity(filename)
  if (replace) {
    const foreign = path.join(root, 'foreign.tmp'); await fs.writeFile(foreign, bytes); await fs.rename(foreign, filename)
    expect(await publicationIdentity(filename)).not.toBe(originalIdentity)
    await expect(service.lookup(input)).rejects.toMatchObject({ code: 'tool-outcome-unknown' })
  } else {
    expect(await service.lookup(input)).toMatchObject({ status: 'written', path: filename })
    expect(await service.export(input)).toMatchObject({ status: 'written' })
  }
  expect(writer.writeNew).toHaveBeenCalledTimes(1)
  expect(await fs.readFile(filename)).toEqual(bytes)
})
