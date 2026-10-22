import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { imageDataSchema } from '../../src/components/image/data'
import { requireWorkspaceRoot } from '../helpers/workspaceGrant'
// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { artifactDeliverySource } from '../../src/core/tools/HostArtifactTools'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { OpenImageService } from '../../src/main/workbench/assetSources/OpenImageService'
import { MediaCapabilityService } from '../../src/main/workbench/media/MediaCapabilityService'
import { SpeechMediaJobAdapter } from '../../src/main/workbench/media/SpeechMediaJobAdapter'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ToolResult } from '../../src/shared/workbench/tools'

const selection: ImageModelSelection = { imageModel: 'offline-fixture', connection: {
  id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture',
  auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
} }
const data = (result: ToolResult): any => {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data
}

it('saves the returned ready speech source through its media owner and rejects unknown, foreign and stopped media sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-speech-artifact-'))
  // Fixed PCM bytes exercise resource delivery; no voice process or model is called.
  const wav = Buffer.alloc(44 + 160)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(160, 40)
  const synthesize = vi.fn(async () => new Uint8Array(wav))
  const adapter = new SpeechMediaJobAdapter({ directory: path.join(root, 'media'), local: {
    voices: async () => [{ name: 'Fixed voice fixture', culture: 'en-US' }], synthesize,
  } })
  const capability = (await adapter.discoverLocal()).capability!
  const media = new MediaCapabilityService([adapter]), readResource = vi.spyOn(media, 'readResource')
  const host = new DocumentHostService(path.join(root, 'documents'))
  host.tools.configureHostServices({ media,
    beginRun: async grant => media.beginRun(grant.runId, { writable: true, capabilities: [capability] }),
    stopRun: runId => media.stopRun(runId),
    artifacts: { lookup: (runId, operationId) => host.artifactDeliveries.lookup(operationId, runId),
      save: ({ grant, operationId, source, bytes, assertActive }) => host.artifactDeliveries.deliver({ runId: grant.runId, operationId,
        workspaceRoot: requireWorkspaceRoot(grant.fileAccess), permission: grant.fileAccess!.permission,
        destination: source.destination, ...artifactDeliverySource(source), bytes, assertActive }) },
  })
  const begin = (runId: string) => host.tools.beginRun({ runId, actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: root } })
  try {
    await begin('speech-owner')
    const generated = data(await host.tools.execute('speech-owner', 'generate', { name: 'media.start', input: { kind: 'speech', engine: 'local', prompt: 'Fixed delivery fixture' } }))
    expect(generated).toMatchObject({ status: 'started', job: { status: 'ready' } })
    const resource = generated.job.resources[0]
    const receipt = data(await host.tools.execute('speech-owner', 'save', { name: 'artifact.save', input: { source: resource.source, destination: 'speech.wav' } }))
    expect(receipt).toMatchObject({ status: 'written', sourceKind: 'media', sourceId: resource.source, byteLength: wav.byteLength, path: path.join(root, 'speech.wav') })
    expect(await fs.readFile(receipt.path)).toEqual(wav)
    expect(readResource).toHaveBeenCalledWith('speech-owner', resource.resourceId)
    expect(await host.tools.execute('speech-owner', 'unknown', { name: 'artifact.save', input: { source: 'media:unknown', destination: 'unknown.wav' } }))
      .toMatchObject({ kind: 'error', message: '媒体资源不存在或类型不受支持' })
    expect(readResource).toHaveBeenCalledWith('speech-owner', 'unknown')
    await begin('unrelated')
    expect(await host.tools.execute('unrelated', 'foreign', { name: 'artifact.save', input: { source: resource.source, destination: 'foreign.wav' } }))
      .toMatchObject({ kind: 'error', message: '语音资源不属于当前任务' })
    await host.tools.stop('speech-owner')
    expect(await host.tools.execute('speech-owner', 'late', { name: 'artifact.save', input: { source: resource.source, destination: 'late.wav' } }))
      .toMatchObject({ kind: 'error' })
    for (const filename of ['unknown.wav', 'foreign.wav', 'late.wav']) await expect(fs.stat(path.join(root, filename))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(synthesize).toHaveBeenCalledOnce()
  } finally {
    await Promise.allSettled(['speech-owner', 'unrelated'].map(runId => host.tools.stop(runId)))
    readResource.mockRestore()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('g20-speech-artifact-'))
      throw new Error('Unexpected speech fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('cold opens a saved document and saves its ready image through public artifact.save without generating again, preserving source and grant boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-artifact-save-tool-'))
  try {
    const journalDirectory = path.join(root, 'documents'), filename = path.join(root, 'source.h5lesson')
    let host = new DocumentHostService(journalDirectory)
    const document = await host.internalAPI.create({ kind: 'course-v10',
      project: createBlankCourseProjectV10('Ready image delivery'), resources: { assets: {}, components: {} } }, 'source.h5lesson')
    await host.internalAPI.save(document.documentId, filename)
    const bytes = await fs.readFile(path.resolve('tests/fixtures/g20M17/local-media.png'))
    const directory = path.join(root, 'images')
    // Persist an existing local PNG as a completed source. No network provider is used.
    const seed = new ImageGenerationService({ directory, provider: { generate: async (request, references) => ({
      status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: 'existing.png' }],
      provenance: imageProvenance(request, references),
    }) } })
    const ready = await seed.run({ jobId: 'image-document-ready', runId: 'source-run', documentId: document.documentId,
      operation: 'generate', prompt: 'Existing offline PNG', selection })
    expect(ready).toMatchObject({ status: 'ready', stopped: false, documentId: document.documentId })
    const savedSource = await host.internalAPI.read(document.documentId)
    if (savedSource.model.kind !== 'course-v10') throw new Error('Expected course')
    expect(await host.internalAPI.dispatch({ documentId: savedSource.documentId, epoch: savedSource.epoch,
      baseRevision: savedSource.revision, operationId: 'unsaved-source-title', actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(savedSource.model.project,
        [{ type: 'project.title.set', title: 'Unsaved source edit' }]) } })).toMatchObject({ status: 'applied' })
    expect(await host.internalAPI.read(document.documentId)).toMatchObject({ dirty: true })
    const generate = vi.fn(async (): Promise<never> => { throw new Error('Saving must not generate an image') })
    const images = new ImageGenerationService({ directory, provider: { generate } })
    const configure = (currentHost: DocumentHostService) => currentHost.tools.configureHostServices({
      matchesSavedDocument: (sourceDocumentId, currentDocumentId) => currentHost.matchesSavedDocument(sourceDocumentId, currentDocumentId),
      images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images),
      stop: images.stop.bind(images), readResource: images.readResource.bind(images),
      readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) },
      artifacts: { lookup: (runId, operationId) => currentHost.artifactDeliveries.lookup(operationId, runId),
        save: ({ grant, operationId, source, bytes: supplied, assertActive }) => currentHost.artifactDeliveries.deliver({
          runId: grant.runId, operationId, workspaceRoot: requireWorkspaceRoot(grant.fileAccess), permission: grant.fileAccess!.permission,
          destination: source.destination, ...artifactDeliverySource(source),
          bytes: supplied, assertActive,
        }) },
    })
    const begin = (currentHost: DocumentHostService, runId: string, documentId?: string, permission: 'workspace' | 'read-only' = 'workspace') => currentHost.tools.beginRun({
      runId, actor: 'agent', documents: documentId ? [{ documentId, writable: [{ kind: 'document' }] }] : [],
      fileAccess: { permission, workspaceRoot: root },
    })
    const openRun = async (currentHost: DocumentHostService, runId: string, sourcePath: string) => {
      await begin(currentHost, runId)
      const opened = await currentHost.agentFiles.execute({ runId, workspaceRoot: root, permission: 'workspace' },
        'file.open', { path: sourcePath }, `${runId}-open`)
      if (!opened.opened) throw new Error('Expected file.open to open the course')
      await currentHost.tools.completeOpenedDocument(runId, opened.opened)
      return opened.opened.documentId
    }
    // Ordinary cold file.open creates a new session identity, without restoring the source draft.
    host = new DocumentHostService(journalDirectory)
    configure(host)
    const currentDocumentId = await openRun(host, 'current', filename)
    expect(currentDocumentId).not.toBe(document.documentId)
    const recovered = data(await host.tools.execute('current', 'status', { name: 'image.status', input: { job: ready.jobId } }))
    expect(recovered).toMatchObject({ status: 'ready', documentId: currentDocumentId,
      resources: [{ resourceId: ready.resources[0]!.resourceId }] })
    const source = { source: recovered.resources[0].source }
    const saved = data(await host.tools.execute('current', 'save-ready', {
      name: 'artifact.save', input: { ...source, destination: 'result.png' },
    }))
    expect(saved).toMatchObject({ status: 'written', sourceKind: 'image', path: path.join(root, 'result.png') })
    const pixels = await sharp(await fs.readFile(saved.path)).raw().toBuffer({ resolveWithObject: true })
    expect(pixels).toEqual(await sharp(bytes).raw().toBuffer({ resolveWithObject: true }))
    const current = await host.internalAPI.read(currentDocumentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected course')
    expect(current.model.project.title).toBe('Ready image delivery')
    const surfaceId = componentSurfaces(current.model.project)[0]!.id
    const surface = await host.tools.issueTarget('current', currentDocumentId, { kind: 'course-surface', surfaceId })
    expect(await host.tools.execute('current', 'apply-ready', { name: 'media.insert',
      input: { target: surface, resource: recovered.resources[0].resource } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const applied = await host.internalAPI.read(currentDocumentId)
    if (applied.model.kind !== 'course-v10') throw new Error('Expected course')
    const instanceId = componentSurfaces(applied.model.project)[0]!.childIds[0]!
    const assetId = imageDataSchema.parse(applied.model.project.instances[instanceId]!.data).assetId
    expect(await sharp(applied.model.resources.assets[assetId]).raw().toBuffer({ resolveWithObject: true })).toEqual(pixels)

    await begin(host, 'no-document')
    expect(await host.tools.execute('no-document', 'deny-document', { name: 'artifact.save',
      input: { ...source, destination: 'denied-document.png' } })).toMatchObject({ kind: 'error', message: expect.stringContaining('已授权文档') })
    expect(await host.tools.execute('current', 'deny-source', { name: 'artifact.save',
      input: { source: recovered.resources[0].source.replace(recovered.resources[0].resourceId, 'image_' + '0'.repeat(64)), destination: 'denied-source.png' } }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('已完成任务') })
    await begin(host, 'read-only', currentDocumentId, 'read-only')
    expect(await host.tools.execute('read-only', 'deny-write', { name: 'artifact.save',
      input: { ...source, destination: 'denied-write.png' } })).toMatchObject({ kind: 'error' })
    const clonePath = path.join(root, 'clone.h5lesson')
    await fs.copyFile(filename, clonePath)
    await openRun(host, 'other-path', clonePath)
    expect(await host.tools.execute('other-path', 'deny-path', { name: 'artifact.save',
      input: { ...source, destination: 'denied-path.png' } }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('已授权文档') })

    const replacementPath = path.join(root, 'replacement.h5lesson')
    const replacement = await host.internalAPI.create({ kind: 'course-v10',
      project: createBlankCourseProjectV10('Different project'), resources: { assets: {}, components: {} } }, 'replacement.h5lesson')
    await host.internalAPI.save(replacement.documentId, replacementPath)
    await fs.copyFile(replacementPath, filename)
    const replacementHost = new DocumentHostService(journalDirectory)
    configure(replacementHost)
    await openRun(replacementHost, 'other-project', filename)
    expect(await replacementHost.tools.execute('other-project', 'deny-project', { name: 'artifact.save',
      input: { ...source, destination: 'denied-project.png' } }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('已授权文档') })
    for (const name of ['denied-document.png', 'denied-source.png', 'denied-write.png', 'denied-path.png', 'denied-project.png'])
      await expect(fs.stat(path.join(root, name))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(generate).not.toHaveBeenCalled()
    expect(await images.read(ready.jobId)).toMatchObject({ runId: 'source-run', documentId: document.documentId, status: 'ready', stopped: false })
    await host.tools.stop('current'); await host.tools.stop('no-document'); await host.tools.stop('read-only')
    await host.tools.stop('other-path'); await replacementHost.tools.stop('other-project')
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('g20-artifact-save-tool-'))
      throw new Error('Unexpected test directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('saves a fetched task image through the existing artifact writer and retains resource, run, stop, and overwrite boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-fetched-artifact-'))
  const host = new DocumentHostService(path.join(root, 'documents'))
  const bytes = await fs.readFile(path.resolve('tests/fixtures/g20M17/local-media.png'))
  const getBytes = vi.fn(async () => ({ url: 'https://example.com/fixture.png', contentType: 'image/png', bytes }))
  const openImages = new OpenImageService({ http: { getJson: async () => { throw new Error('Offline library fixture') }, getBytes },
    libraries: [['openverse', async () => ({ library: 'openverse', excluded: 0, hasMore: false, candidates: [{
      library: 'openverse', providerId: 'fixture', title: 'Offline fixture', license: { code: 'cc0', id: 'CC0 1.0', attributionRequired: false },
      sourceName: 'Offline fixture', pageUrl: 'https://example.com/fixture', fileUrl: 'https://example.com/fixture.png',
    }] })]] })
  host.tools.configureHostServices({ openImages,
    beginRun: async grant => { openImages.beginRun(grant.runId) }, stopRun: runId => { openImages.stopRun(runId) },
    artifacts: { lookup: (runId, operationId) => host.artifactDeliveries.lookup(operationId, runId),
      save: ({ grant, operationId, source, bytes: supplied, assertActive }) => host.artifactDeliveries.deliver({
        runId: grant.runId, operationId, workspaceRoot: requireWorkspaceRoot(grant.fileAccess), permission: grant.fileAccess!.permission,
        destination: source.destination, ...artifactDeliverySource(source), bytes: supplied, assertActive,
      }) },
  })
  try {
    const document = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Fetched image'),
      resources: { assets: {}, components: {} } }, 'source.h5lesson')
    await host.internalAPI.save(document.documentId, path.join(root, 'source.h5lesson'))
    const begin = (runId: string) => host.tools.beginRun({ runId, actor: 'agent',
      documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await begin('fetch-owner')
    const found = data(await host.tools.execute('fetch-owner', 'search', { name: 'image.search', input: { query: 'fixture', limit: 1 } }))
    const fetched = data(await host.tools.execute('fetch-owner', 'fetch', { name: 'image.fetch', input: { image: found.candidates[0].image } }))
    expect(fetched).toMatchObject({ status: 'ready', source: { kind: 'open-library', title: 'Offline fixture' } })
    const original = await host.tools.readImageResource('fetch-owner', document.documentId, fetched.resource)
    const receipt = data(await host.tools.execute('fetch-owner', 'save', { name: 'artifact.save',
      input: { source: fetched.resource, destination: 'download.png' } }))
    expect(receipt).toMatchObject({ status: 'written', sourceKind: 'image', sourceId: fetched.resource, path: path.join(root, 'download.png') })
    expect(await fs.readFile(receipt.path)).toEqual(Buffer.from(original.bytes))
    expect(data(await host.tools.execute('fetch-owner', 'overwrite', { name: 'artifact.save',
      input: { source: fetched.resource, destination: 'download.png' } }))).toMatchObject({ status: 'conflict' })
    expect(await fs.readFile(receipt.path)).toEqual(Buffer.from(original.bytes))
    await begin('unrelated')
    expect(await host.tools.execute('unrelated', 'foreign', { name: 'artifact.save',
      input: { source: fetched.resource, destination: 'foreign.png' } })).toMatchObject({ kind: 'error' })
    await host.tools.stop('fetch-owner')
    expect(await host.tools.execute('fetch-owner', 'late', { name: 'artifact.save',
      input: { source: fetched.resource, destination: 'late.png' } })).toMatchObject({ kind: 'error' })
    for (const name of ['foreign.png', 'late.png']) await expect(fs.stat(path.join(root, name))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(getBytes).toHaveBeenCalledOnce()
    await host.tools.stop('unrelated')
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('g20-fetched-artifact-'))
      throw new Error('Unexpected test directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
