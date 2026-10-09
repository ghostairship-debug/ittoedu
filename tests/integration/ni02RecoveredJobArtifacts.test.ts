import { requireWorkspaceRoot } from '../helpers/workspaceGrant'
// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { HostToolCoordinator, type HostToolServices } from '../../src/core/tools/HostToolServices'
import { artifactDeliverySource, hostArtifactSaveRegistration } from '../../src/core/tools/HostArtifactTools'
import { workbenchServiceRegistration } from '../../src/core/tools/WorkbenchServiceTools'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import type { ComputeBackend, ComputeProcessResult } from '../../src/main/workbench/compute/ComputeBackend'
import { HostArtifactDeliveryService } from '../../src/main/workbench/execution/HostArtifactDeliveryService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'
import type { ImageProviderReference } from '../../src/main/workbench/images/ImageProviderPort'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { dispatchMaterialTool, readMaterialImageSource } from '../../src/main/workbench/execution/MaterialReadTools'
import { mediaFileInput } from '../../src/main/workbench/admittedMediaResource'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpSdkClient, McpClientService } from '../../src/main/workbench/externalTools/McpClientService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('ni02-'))
      throw new Error('Unexpected test directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const selection: ImageModelSelection = { imageModel: 'offline-fixture', connection: {
  id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture',
  auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
} }
function data(result: ToolResult): any {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data
}
function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected Project V10')
  return snapshot.model
}
async function fixture(pending = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni02-recovered-')); roots.push(root)
  const bytes = await fs.readFile(path.resolve('tests/fixtures/g20M17/local-media.png'))
  const generate = vi.fn(async (request: ImageGenerationRequest, references: readonly ImageProviderReference[]) => ({ status: 'completed' as const,
    images: [{ bytes, mimeType: 'image/png', filename: 'existing.png' }], provenance: imageProvenance(request, references) }))
  const images = new ImageGenerationService({ directory: path.join(root, 'images'), provider: { generate } })
  const done: Promise<ComputeProcessResult> = pending ? new Promise(() => undefined) : Promise.resolve({
    exitCode: 0, stdout: 'ready', stderr: '', truncated: false, cancelled: false,
    outputs: [{ name: '统计 表.csv', bytes: Buffer.from('label,value\n正确,42\n') }],
  })
  // Only computation is controlled; durable job ownership, ready checks and byte integrity are real.
  const execute = vi.fn(async () => ({ done, cancel: async () => true }))
  const backend: ComputeBackend = { kind: 'pyodide', availability: async () => ({ available: true }), start: execute }
  const computeDirectory = path.join(root, 'compute')
  let compute = new ComputeJobService({ directory: computeDirectory, backend })
  const deliveries = new HostArtifactDeliveryService({ journalDirectory: path.join(root, 'deliveries'), withFileOperation: work => work() })
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document writes') }, async save() { throw new Error('No document saves') } } })
  const never = (): never => { throw new Error('No document authority') }
  const services = (): HostToolServices => ({ compute, jobs: new HostJobService({ images, compute }),
    images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
      readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) },
    artifacts: { lookup: (runId, operationId) => deliveries.lookup(operationId, runId),
      save: ({ grant, operationId, source, bytes: supplied, assertActive }) => deliveries.deliver({
        runId: grant.runId, operationId, workspaceRoot: requireWorkspaceRoot(grant.fileAccess), permission: grant.fileAccess!.permission,
        destination: source.destination, ...artifactDeliverySource(source),
        bytes: supplied, assertActive,
      }) },
  })
  const coordinator = new HostToolCoordinator(services(), registry,
    { resolveImage: never, active: never, ownsDocument: () => false, provideImage: never, readImage: never })
  const begin = (runId: string, permission: 'workspace' | 'read-only' = 'workspace', workspaceRoot = root) => coordinator.beginRun({
    runId, actor: 'agent', documents: [], fileAccess: { permission, workspaceRoot },
  })
  const call = async (runId: string, name: string, input: unknown): Promise<any> => {
    const registration = workbenchServiceRegistration(name)!
    const context = { runId, operationId: `${runId}:${name}`, host: coordinator }
    return data(await registration.handler(context as never, input as never))
  }
  const save = async (runId: string, source: string, destination: string) => data(await hostArtifactSaveRegistration.handler({
    runId, operationId: `${runId}:${destination}`, requestDigest: destination, host: coordinator,
  }, { source, destination }))
  return { root, bytes, images, generate, coordinator, begin, call, save, execute, deliveries,
    compute: () => compute, coldCompute: () => { compute = new ComputeJobService({ directory: computeDirectory, backend }); coordinator.configure(services()) } }
}

it('reads original ready computation through verified continuation, then saves with the current grant without recomputing', async () => {
  const f = await fixture()
  await f.begin('original')
  const created = await f.call('original', 'compute.run', { code: 'result = 42' })
  const initial = await f.call('original', 'job.wait', { job: created.job, milliseconds: 1000 })
  expect(initial).toMatchObject({ status: 'ready', snapshot: { runId: 'original', stopped: false,
    artifacts: [{ name: '统计 表.csv', source: expect.any(String) }] } })
  await f.coordinator.stop('original')
  f.coldCompute()
  await f.begin('continued')
  await expect(f.call('continued', 'job.status', { job: created.job })).rejects.toMatchObject({ code: 'job-not-authorized' })
  f.coordinator.authorizeContinuationReads('continued', ['original'])
  const status = await f.call('continued', 'job.status', { job: created.job })
  const waited = await f.call('continued', 'job.wait', { job: created.job, milliseconds: 0 })
  expect(waited).toEqual(status)
  expect(status.snapshot.runId).toBe('original')
  expect(status.snapshot.artifacts[0].source).toBe(initial.snapshot.artifacts[0].source)
  const receipt = await f.save('continued', status.snapshot.artifacts[0].source, 'report.csv')
  expect(receipt).toMatchObject({ status: 'written', sourceKind: 'compute', path: path.join(f.root, 'report.csv') })
  expect(await f.deliveries.lookup('continued:report.csv', 'continued')).toEqual(receipt)
  expect(await fs.readFile(receipt.path, 'utf8')).toBe('label,value\n正确,42\n')
  await expect(f.call('continued', 'job.cancel', { job: created.job })).rejects.toMatchObject({ code: 'job-not-authorized' })
  await f.begin('unrelated')
  await expect(f.save('unrelated', status.snapshot.artifacts[0].source, 'foreign.csv')).rejects.toMatchObject({ code: 'job-not-authorized' })
  await f.begin('reader', 'read-only')
  f.coordinator.authorizeContinuationReads('reader', ['original'])
  expect(await f.call('reader', 'job.status', { job: created.job })).toMatchObject({ status: 'ready' })
  await expect(f.save('reader', status.snapshot.artifacts[0].source, 'denied.csv')).rejects.toThrow('只读')
  await f.coordinator.stop('continued')
  await expect(f.save('continued', status.snapshot.artifacts[0].source, 'late.csv')).rejects.toThrow('停止')
  expect(await f.compute().status('original', created.job)).toMatchObject({ status: 'ready', stopped: false, runId: 'original' })
  expect(f.execute).toHaveBeenCalledOnce()
  for (const name of ['foreign.csv', 'denied.csv', 'late.csv']) await expect(fs.stat(path.join(f.root, name))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not recover a stopped or unfinished original computation even with same-task lineage', async () => {
  const f = await fixture(true)
  await f.begin('original')
  const created = await f.call('original', 'compute.run', { code: 'wait_for_result()' })
  await f.begin('continued')
  f.coordinator.authorizeContinuationReads('continued', ['original'])
  await expect(f.call('continued', 'job.status', { job: created.job })).rejects.toThrow('已完成成果')
  await f.coordinator.stop('original')
  await expect(f.call('continued', 'job.wait', { job: created.job, milliseconds: 0 })).rejects.toThrow('已完成成果')
})

it('lets read-only tasks inspect a same-workspace ready image without generation, editing, cancellation or saving', async () => {
  const f = await fixture()
  await f.begin('original')
  const created = data(await f.coordinator.invoke('original', 'ready-image', '', 'image.generate', { prompt: 'Existing offline image' }))
  await f.coordinator.stop('original')
  await f.begin('reader', 'read-only')
  const status = await f.call('reader', 'job.status', { job: created.job })
  expect(await f.call('reader', 'job.wait', { job: created.job, milliseconds: 0 })).toEqual(status)
  const source = status.snapshot.resources[0].source
  expect(source).toBe(created.resources[0].source)
  const preview = await f.coordinator.imagePreview('reader', { images: [source] })
  expect(data(preview)).toMatchObject({ status: 'prepared', previews: [{ resourceId: source }] })
  const prepared = await f.coordinator.prepareResultImages('reader', preview)
  expect(prepared[0]).toMatchObject({ source, mimeType: 'image/png' })
  expect(prepared[0]!.bytes.byteLength).toBe(f.bytes.byteLength)
  await expect(f.coordinator.invoke('reader', 'generate-denied', '', 'image.generate', { prompt: 'Denied' })).rejects.toThrow('只读')
  await expect(f.coordinator.invoke('reader', 'edit-denied', '', 'image.edit', { prompt: 'Denied', references: [source] })).rejects.toThrow('只读')
  await expect(f.call('reader', 'job.cancel', { job: created.job })).rejects.toThrow('只读')
  await expect(f.save('reader', source, 'denied.png')).rejects.toThrow('只读')
  await f.begin('foreign', 'read-only', path.join(f.root, 'other-workspace'))
  await expect(f.call('foreign', 'job.status', { job: created.job })).rejects.toThrow('工作空间')
  expect(f.generate).toHaveBeenCalledOnce()
  expect(await f.images.read(created.job)).toMatchObject({ runId: 'original', status: 'ready', stopped: false })
})

it('returns directly consumable image sources from durable lookup without rebuilding the stopped run or requesting status again', async () => {
  const f = await fixture()
  await f.begin('original')
  const created = data(await f.coordinator.invoke('original', 'lookup-ready', '', 'image.generate', { prompt: 'Existing offline image' }))
  await f.coordinator.stop('original')
  const recovered = data((await f.coordinator.lookup('original', 'lookup-ready', '', 'image.generate'))!)
  expect(recovered.resources[0].source).toBe(created.resources[0].source)
  expect(f.coordinator.runtimeCounts('original')).toMatchObject({ runs: 0, imageJobs: 0, imageResources: 0 })
  await f.begin('current')
  expect(data(await f.coordinator.imagePreview('current', { images: [recovered.resources[0].source] }))).toMatchObject({ status: 'prepared' })
  expect(await f.save('current', recovered.resources[0].source, 'lookup-result.png')).toMatchObject({ status: 'written', sourceKind: 'image' })
  expect(f.generate).toHaveBeenCalledOnce()
  expect(await f.images.read(created.job)).toMatchObject({ runId: 'original', status: 'ready', stopped: false })
})

it('applies a material image source from its immutable directory entry as one background transaction without a read-and-copy relay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni02-material-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  const attachments = new AttachmentService({ directory: path.join(root, 'attachments') })
  const original = await attachments.receiveBytes({ name: 'material.png',
    bytes: await fs.readFile(path.resolve('tests/fixtures/g20M17/local-media.png')), source: { kind: 'paste' } })
  const ids = new Set([original.id])
  host.tools.configureHostServices({ materials: {
    admit: async (_runId, sources) => { for (const source of sources) { await attachments.readSnapshot(source); ids.add(source) } },
    read: async (_runId, name, input) => ({ kind: 'read', data: (await dispatchMaterialTool(attachments, ids, name, input)).data }),
    readResource: ({ resourceId }) => readMaterialImageSource(attachments, ids, resourceId),
  } })
  const doc = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('材料背景'),
    resources: { assets: {}, components: {} } }, 'material.h5lesson')
  await host.tools.beginRun({ runId: 'material', actor: 'agent', documents: [{ documentId: doc.documentId, writable: [{ kind: 'document' }] }],
    materialIds: [original.id], fileAccess: { permission: 'workspace', workspaceRoot: root } })
  const listed = data(await host.tools.execute('material', 'list', { name: 'material.list', input: { attachmentId: original.id } }))
  const source = listed.representations.find((item: { kind: string }) => item.kind === 'image').source
  const target = await host.tools.issueTarget('material', doc.documentId, { kind: 'course-surface', surfaceId: course(doc).project.surfaces[0]!.id })
  expect(await host.tools.execute('material', 'background', { name: 'surface.configure',
    input: { target, settings: { background: { mode: 'own', source, fit: 'cover' } } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const applied = await host.internalAPI.read(doc.documentId), model = course(applied)
  expect(applied.undoDepth).toBe(doc.undoDepth + 1)
  expect(applied.revision).toBe(doc.revision + 1)
  const assetId = model.project.surfaces[0]!.background!.assetId!
  expect(model.project.assets[assetId]).toMatchObject({ kind: 'image', mimeType: 'image/png' })
  expect(model.resources.assets[assetId]!.byteLength).toBe(original.byteLength)
  ids.clear()
  expect(await host.tools.execute('material', 'denied-source', { name: 'surface.configure',
    input: { target, settings: { background: { mode: 'own', source } } } })).toMatchObject({ kind: 'error' })
  expect((await host.internalAPI.read(doc.documentId)).revision).toBe(applied.revision)
  const filename = path.join(root, 'material.h5lesson')
  await host.internalAPI.save(doc.documentId, filename)
  const reopened = course(await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename))
  expect(reopened.project.surfaces[0]!.background!.assetId).toBe(assetId)
  expect(reopened.resources.assets[assetId]!.byteLength).toBe(original.byteLength)
})

it('imports and replaces an authorized local video through the formal media consumer while preserving manual geometry and playback settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni02-video-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  for (const name of ['motion.webm', 'motion-blue.webm']) await fs.copyFile(path.resolve('tests/fixtures/r18CommonTasks/materials', name), path.join(root, name))
  host.tools.configureHostServices({ mediaFiles: { read: async (runId, source) => mediaFileInput(await host.agentFiles.readAuthorizedFile({
    runId, workspaceRoot: root, permission: 'workspace',
  }, source)) } })
  const doc = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('原视频导入'),
    resources: { assets: {}, components: {} } }, 'video.h5lesson')
  await host.tools.beginRun({ runId: 'video', actor: 'agent', documents: [{ documentId: doc.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  const surfaceId = course(doc).project.surfaces[0]!.id
  const surface = await host.tools.issueTarget('video', doc.documentId, { kind: 'course-surface', surfaceId })
  expect(await host.tools.execute('video', 'insert', { name: 'media.insert', input: { target: surface, source: 'motion.webm' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const inserted = await host.internalAPI.read(doc.documentId), original = course(inserted)
  const instanceId = original.project.surfaces[0]!.childIds[0]!, instance = original.project.instances[instanceId]!
  expect(instance.definitionId).toBe('guoling.video')
  const oldAssetId = (instance.data as { assetId: string }).assetId
  const frame = { width: 619, height: 311, transform: [1, .1, 0, 1, 43, 71] as [number, number, number, number, number, number] }
  expect(await host.internalAPI.dispatch({ documentId: doc.documentId, epoch: inserted.epoch, baseRevision: inserted.revision,
    operationId: 'manual-video', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(original.project, [
      { type: 'frame.set', instanceId, frame }, { type: 'data.set', instanceId, path: ['volume'], value: .37 },
    ]) } })).toMatchObject({ status: 'applied' })
  const target = await host.tools.issueTarget('video', doc.documentId, { kind: 'course-instance', surfaceId, instanceId })
  expect(await host.tools.execute('video', 'replace', { name: 'media.apply', input: { target, source: 'motion-blue.webm' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const applied = course(await host.internalAPI.read(doc.documentId)), replaced = applied.project.instances[instanceId]!
  expect(replaced.frame).toEqual(frame)
  expect(replaced.data).toMatchObject({ volume: .37, showControls: true })
  const assetId = (replaced.data as { assetId: string }).assetId
  expect(assetId).not.toBe(oldAssetId)
  expect(applied.resources.assets[oldAssetId]!.byteLength).toBe(4021)
  expect(applied.resources.assets[assetId]!.byteLength).toBe(4044)
  const filename = path.join(root, 'video.h5lesson')
  await host.internalAPI.save(doc.documentId, filename)
  const reopened = course(await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename))
  expect(reopened.project.instances[instanceId]).toEqual(replaced)
  expect(reopened.resources.assets[assetId]!.byteLength).toBe(4044)
})

it('applies the source recovered by actual MCP success lookup without replay or an intermediate resource read and retains its run boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni02-mcp-')); roots.push(root)
  const bytes = await fs.readFile(path.resolve('tests/fixtures/g20M17/local-media.png'))
  const server = new Server({ name: 'media-fixture', version: '1.0' }, { capabilities: { tools: {} } })
  const client = createMcpSdkClient(), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'image', inputSchema: { type: 'object' as const } }] }))
  const remoteCalls = vi.fn(async () => ({ content: [{ type: 'image' as const, data: bytes.toString('base64'), mimeType: 'image/png' }] }))
  server.setRequestHandler(CallToolRequestSchema, remoteCalls)
  await server.connect(serverTransport); await client.connect(clientTransport)
  const mcp = new McpClientService({ connection: { namespace: 'fixture',
    transport: { kind: 'streamable-http', endpoint: 'https://example.test/mcp' }, tools: [{ name: 'image', effect: 'read' }] },
    connect: async () => ({ listTools: (params, options) => client.listTools(params, options),
      callTool: async (params, _schema, options) => {
        const result = await client.callTool(params, undefined, options)
        if (!Array.isArray(result.content)) throw new Error('MCP fixture returned no content')
        return { content: result.content, structuredContent: result.structuredContent, isError: result.isError === true }
      }, close: () => client.close() }) })
  const host = new DocumentHostService(path.join(root, 'documents'))
  host.tools.configureHostServices({ mcp, beginRun: async grant => mcp.beginRun(grant.runId, { allowedTools: ['image'], writeAllowed: false }),
    stopRun: runId => mcp.stopRun(runId) })
  try {
    const doc = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('MCP 图片'),
      resources: { assets: {}, components: {} } }, 'mcp.h5lesson')
    for (const runId of ['mcp', 'unrelated']) await host.tools.beginRun({ runId, actor: 'agent',
      documents: [{ documentId: doc.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.execute('mcp', 'discover', { name: 'mcp.discover', input: {} })
    const call = { name: 'mcp.invoke', input: { name: 'mcp.fixture.image', arguments: {} } } as const
    const response = data(await host.tools.execute('mcp', 'remote', call))
    expect(response.content[0].source).toBe(`mcp:${response.content[0].resourceId}`)
    // Simulate checking a lost reply: lookup reads the owner's committed response, without invoking the tool again.
    const recovered = data((await host.tools.lookup('mcp', 'remote', call))!)
    const source = recovered.content[0].source
    expect(source).toBe(response.content[0].source)
    expect(await host.tools.lookup('unrelated', 'remote', call)).toBeNull()
    const surfaceId = course(doc).project.surfaces[0]!.id
    const target = await host.tools.issueTarget('mcp', doc.documentId, { kind: 'course-surface', surfaceId })
    expect(await host.tools.execute('mcp', 'apply', { name: 'media.insert', input: { target, source } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const applied = await host.internalAPI.read(doc.documentId), model = course(applied)
    const instance = model.project.instances[model.project.surfaces[0]!.childIds[0]!]!
    const assetId = (instance.data as { assetId: string }).assetId
    expect(model.resources.assets[assetId]!.byteLength).toBe(bytes.byteLength)
    expect(applied.undoDepth).toBe(doc.undoDepth + 1)
    const foreignTarget = await host.tools.issueTarget('unrelated', doc.documentId, { kind: 'course-surface', surfaceId })
    expect(await host.tools.execute('unrelated', 'denied', { name: 'media.insert', input: { target: foreignTarget, source } })).toMatchObject({ kind: 'error' })
    expect((await host.internalAPI.read(doc.documentId)).revision).toBe(applied.revision)
    expect(remoteCalls).toHaveBeenCalledOnce()
  } finally { await mcp.endRun('mcp'); await mcp.endRun('unrelated'); await server.close() }
})
