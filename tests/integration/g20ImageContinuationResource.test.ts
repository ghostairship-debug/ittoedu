// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'
import type { ToolResult } from '../../src/shared/workbench/tools'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => {
  const resolved = path.resolve(directory), temporaryRoot = path.resolve(os.tmpdir()) + path.sep
  if (!resolved.startsWith(temporaryRoot) || path.basename(resolved).startsWith('g20-image-continuation-') === false)
    throw new Error('测试清理目标超出临时目录')
  return fs.rm(resolved, { recursive: true, force: true })
})) })

const connection = { id: 'connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'account', auth: { kind: 'oauth', credentialRef: 'ref' },
  billing: { kind: 'subscription' }, capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } as const
const request = (jobId: string): ImageGenerationRequest => ({ jobId, runId: 'ancestor-run', documentId: 'course',
  operation: 'generate', prompt: '蓝色铃铛', selection: { connection, imageModel: 'fixture-model' } })

it('recovers a ready document image after cold restore and applies a fresh authorized handle without another provider call', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-image-continuation-'))
  directories.push(directory)
  const original = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#234567' } }).png().toBuffer()
  const replacement = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#abcdef' } }).png().toBuffer()
  const asset = await prepareImageResource({ bytes: original, mimeType: 'image/png', filename: 'original.png' }, () => 'original')
  const project = createBlankCourseProjectV10('Document image continuation')
  project.assets[asset.meta.id] = asset.meta
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  const frame = { width: 120, height: 80, transform: [1, 0, 0, 1, 45, 65] as [number, number, number, number, number, number] }
  project.instances.picture = { id: 'picture', definitionId: IMAGE_DEFINITION.id, data: createImageData(asset.meta.id), frame }
  project.surfaces[0].childIds = ['picture']
  let host = new DocumentHostService(path.join(directory, 'documents'))
  const document = await host.internalAPI.create({ kind: 'course-v10', project,
    resources: { assets: { [asset.meta.id]: asset.bytes }, components: {} } }, 'document-image.h5lesson')
  const filename = path.join(directory, 'document-image.h5lesson')
  await host.internalAPI.save(document.documentId, filename)
  let calls = 0
  const createImages = () => new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { generate: async (input, references) => {
    calls++
    return { status: 'completed', images: [{ bytes: replacement, mimeType: 'image/png', filename: 'replacement.png' }], provenance: imageProvenance(input, references) }
  } } })
  let images = createImages()
  const configure = () => host.tools.configureHostServices({ images: { selection: () => request('unused').selection,
    run: images.run.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
    readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) },
    jobs: new HostJobService({ images }) })
  configure()
  const data = (result: ToolResult): any => { if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data }
  const begin = (runId: string, authorized = true) => host.tools.beginRun({ runId, actor: 'agent',
    documents: authorized ? [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] : [],
    fileAccess: { permission: 'workspace', workspaceRoot: authorized ? directory : path.join(directory, 'other-workspace') } })
  const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'picture' }
  await begin('original')
  const originalTarget = await host.tools.issueTarget('original', document.documentId, target)
  const ready = data(await host.tools.execute('original', 'create-image', { name: 'image.generate', input: { target: originalTarget, prompt: 'Controlled replacement' } }))
  expect(ready.status).toBe('ready')
  await host.tools.stop('original')
  // Product restart keeps the formal journal. Restore the exact saved document
  // before normal file.open so its durable identity survives with a fresh epoch.
  host = new DocumentHostService(path.join(directory, 'documents'))
  images = createImages()
  configure()
  const restored = await host.internalAPI.restore(document.documentId)
  expect(restored.documentId).toBe(document.documentId)
  expect(restored.epoch).not.toBe(document.epoch)
  expect(restored.dirty).toBe(false)
  expect(await host.internalAPI.open(filename)).toMatchObject({ documentId: restored.documentId, epoch: restored.epoch })
  await begin('outside', false)
  expect(await host.tools.execute('outside', 'denied-recovery', { name: 'image.status', input: { job: ready.job } }))
    .toMatchObject({ kind: 'error', message: expect.stringContaining('已授权文档') })
  await begin('continuation')
  expect(data(await host.tools.execute('continuation', 'job-read', { name: 'job.status', input: { kind: 'image', job: ready.job } })))
    .toMatchObject({ status: 'ready', terminal: true })
  const recovered = data(await host.tools.execute('continuation', 'recover-image', { name: 'image.status', input: { job: ready.job } }))
  expect(recovered).toMatchObject({ job: ready.job, documentId: document.documentId, status: 'ready', stopped: false })
  expect(recovered.resources[0].resource).not.toBe(ready.resources[0].resource)
  await expect(host.tools.readImageResource('continuation', document.documentId, ready.resources[0].resource)).rejects.toThrow()
  const preview = data(await host.tools.execute('continuation', 'preview-image', { name: 'image.preview', input: { images: [recovered.resources[0].resource] } }))
  expect(preview).toMatchObject({ status: 'prepared', previews: [{ resourceId: recovered.resources[0].resource, mimeType: 'image/png' }] })
  const previewed = await host.tools.readOpenImagePreview('continuation', preview.previews[0].resourceId)
  expect(await sharp(previewed.bytes).raw().toBuffer()).toEqual(await sharp(replacement).raw().toBuffer())
  await expect(host.tools.readOpenImagePreview('outside', recovered.resources[0].resource)).rejects.toThrow()
  const freshTarget = await host.tools.issueTarget('continuation', document.documentId, target)
  expect(await host.tools.execute('continuation', 'apply-image', { name: 'media.apply', input: { target: freshTarget, resource: recovered.resources[0].resource } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = await host.internalAPI.read(document.documentId)
  if (current.model.kind !== 'course-v10') throw new Error('Expected course document')
  const picture = current.model.project.instances.picture
  expect(picture.frame).toEqual(frame)
  expect(current.undoDepth).toBe(1)
  const source = current.model.resources.assets[picture.data.assetId as string]
  expect(await sharp(source).raw().toBuffer()).toEqual(await sharp(replacement).raw().toBuffer())
  expect(await images.read(ready.job)).toMatchObject({ runId: 'original', documentId: document.documentId, status: 'ready', stopped: false })
  expect(calls).toBe(1)
  await host.tools.stop('outside'); await host.tools.stop('continuation')
  await expect(host.tools.readOpenImagePreview('continuation', recovered.resources[0].resource)).rejects.toThrow()
})

it('reopens only a ready resource of the exact durable job without another provider call', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-image-continuation-'))
  directories.push(directory)
  const bytes = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#4682b4' } }).png().toBuffer()
  let calls = 0
  const provider = { generate: async (input: ImageGenerationRequest) => {
    calls++
    return { status: 'completed' as const, images: [{ bytes, mimeType: 'image/png', filename: 'fixture.png' }],
      provenance: { executor: 'guoling-direct-chatgpt-images' as const,
        endpoint: 'https://chatgpt.com/backend-api/codex/images/generations' as const,
        connectionId: input.selection.connection.id, connectionRevision: 1, accountId: 'account' as const,
        authKind: 'oauth' as const, billing: input.selection.connection.billing,
        requestedImageModel: input.selection.imageModel, references: [], querySupport: 'unavailable' as const, charge: 'unknown' as const } }
  } }
  const service = new ImageGenerationService({ directory, provider })
  const job = await service.run(request('original-job'))
  expect(job.status).toBe('ready')
  const resourceId = job.resources[0]!.resourceId
  const owner = { jobId: job.jobId, sourceRunId: job.runId, sourceDocumentId: job.documentId, resourceId }
  const reopened = new ImageGenerationService({ directory, provider })
  expect(Buffer.from((await reopened.readReadyResourceFromJob(owner)).bytes)).toEqual(bytes)
  expect(calls).toBe(1)
  for (const candidate of [
    { ...owner, sourceRunId: 'different-run' },
    { ...owner, sourceDocumentId: 'other-course' },
    { ...owner, resourceId: 'image_' + '0'.repeat(64) },
    { ...owner, jobId: 'other-job' },
  ]) await expect(reopened.readReadyResourceFromJob(candidate)).rejects.toThrow()
  expect(calls).toBe(1)

  await fs.rm(path.join(directory, 'resources', `${job.resources[0]!.digest}.blob`))
  await expect(reopened.readReadyResourceFromJob(owner)).rejects.toMatchObject({ code: 'image-continuation-resource-missing' })
  const [jobFile] = await fs.readdir(path.join(directory, 'jobs'))
  const saved = JSON.parse(await fs.readFile(path.join(directory, 'jobs', jobFile!), 'utf8'))
  saved.status = 'unapplied'; saved.stopped = true
  await fs.writeFile(path.join(directory, 'jobs', jobFile!), JSON.stringify(saved))
  await expect(reopened.readReadyResourceFromJob(owner)).rejects.toMatchObject({ code: 'image-continuation-unavailable' })
  expect(calls).toBe(1)
})

it('does not reissue a stopped, unknown, or unapplied image job', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-image-continuation-'))
  directories.push(directory)
  let calls = 0
  const service = new ImageGenerationService({ directory, provider: { generate: async () => {
    calls++
    return { status: 'failed' as const, failure: { outcome: 'unknown' as const, kind: 'transport' as const,
      code: 'interrupted', message: 'unknown' }, provenance: { executor: 'guoling-direct-chatgpt-images' as const,
      endpoint: 'https://chatgpt.com/backend-api/codex/images/generations' as const,
      connectionId: 'connection', connectionRevision: 1, accountId: 'account', authKind: 'oauth' as const,
      billing: connection.billing, requestedImageModel: 'fixture-model', references: [],
      querySupport: 'unavailable' as const, charge: 'unknown' as const } }
  } } })
  const unknown = await service.run(request('unknown-job'))
  expect(unknown.status).toBe('unknown')
  await expect(service.readReadyResourceFromJob({ jobId: unknown.jobId, sourceRunId: unknown.runId,
    sourceDocumentId: unknown.documentId, resourceId: 'image_' + '0'.repeat(64) })).rejects.toMatchObject({ code: 'image-continuation-unavailable' })
  expect(calls).toBe(1)
})
