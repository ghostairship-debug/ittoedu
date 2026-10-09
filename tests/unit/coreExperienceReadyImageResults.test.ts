// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { ImageResultsDesktopService, type ImageResultsDesktopOptions } from '../../src/main/workbench/images/ImageResultsDesktopService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import type { ImageProviderPort } from '../../src/main/workbench/images/ImageProviderPort'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { frozenImageRoles } from '../../src/main/workbench/images/frozenImageRoles'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { documentDigest } from '../../src/core/documents/documentDigest'
import type { ImageJobSnapshot, ImageModelSelection } from '../../src/shared/workbench/images'
import type { ImageResultView } from '../../src/shared/workbench/imageResultsDesktop'

it('reads an existing ready workspace image through generic jobs in a new run while retaining producer cancel ownership', async () => {
  const root = 'D:/workspace/teacher-journey', job = { version: 1, jobId: 'image-original-job', runId: 'original-run',
    documentId: `workspace:${documentDigest({ root })}`, status: 'ready', stopped: false, resources: [{
      resourceId: `image_${'a'.repeat(64)}`, digest: 'a'.repeat(64), mimeType: 'image/png', width: 10, height: 10, byteLength: 100,
    }],
    timing: [{ stage: 'image.provider.started', wallTimeMs: 100 }],
  } as ImageJobSnapshot
  const generate = vi.fn(() => { throw new Error('Reading a completed image must not regenerate it') })
  const stop = vi.fn(async () => { job.stopped = true; return structuredClone(job) })
  const read = async () => structuredClone(job)
  const wait = vi.fn(async (runId: string) => { if (runId !== job.runId) throw new Error('图片任务不属于当前运行'); return read() })
  const images = { read, wait, stop, run: generate } as unknown as ImageGenerationService
  const jobs = new HostJobService({ images })
  const registry = new DocumentRegistry({ drivers: [], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document write') }, async save() { throw new Error('No document save') } } })
  const gateway = new DocumentToolGateway(registry, [], () => crypto.randomUUID(), { services: { jobs,
    images: { read, stop, run: generate, selection() { throw new Error('No model selection') }, readResource() { throw new Error('No image bytes needed') } } } })
  const begin = (runId: string, workspaceRoot: string) => gateway.beginRun({ runId, actor: 'agent', documents: [],
    fileAccess: { permission: 'workspace', workspaceRoot } })
  await begin('new-run', root)
  expect(await gateway.execute('new-run', 'read-old-ready', { name: 'job.status', input: { job: job.jobId } }))
    .toMatchObject({ kind: 'read', data: { kind: 'image', status: 'ready', snapshot: { runId: 'original-run' } } })
  expect(await gateway.execute('new-run', 'wait-old-ready', { name: 'job.wait', input: { job: job.jobId, milliseconds: 1 } }))
    .toMatchObject({ kind: 'read', data: { kind: 'image', status: 'ready', snapshot: { resources: [{
      source: `${job.jobId}@${job.resources[0]!.resourceId}`, htmlSource: `cw-result:${encodeURIComponent(`${job.jobId}@${job.resources[0]!.resourceId}`)}`,
    }] } } })
  expect(await gateway.execute('new-run', 'log-old-ready', { name: 'job.logs', input: { job: job.jobId } }))
    .toMatchObject({ kind: 'read', data: { entries: [{ cursor: 1, time: 100 }], nextCursor: 1 } })
  expect(wait).toHaveBeenCalledWith('original-run', job.jobId, 1, undefined)
  expect(await gateway.execute('new-run', 'cancel-old-ready', { name: 'job.cancel', input: { job: job.jobId } }))
    .toMatchObject({ kind: 'error' })
  expect(stop).not.toHaveBeenCalled()
  await begin('other-root', 'D:/workspace/another')
  expect(await gateway.execute('other-root', 'read-foreign-ready', { name: 'job.status', input: { job: job.jobId } }))
    .toMatchObject({ kind: 'error' })
  job.status = 'running'
  expect(await gateway.execute('new-run', 'read-unfinished', { name: 'job.status', input: { job: job.jobId } }))
    .toMatchObject({ kind: 'error' })
  job.status = 'ready'; job.stopped = true
  expect(await gateway.execute('new-run', 'read-stopped', { name: 'job.status', input: { job: job.jobId } }))
    .toMatchObject({ kind: 'error' })
  expect(generate).not.toHaveBeenCalled()
})

it('shows an existing ready workspace image from its owning built-in conversation without a document or another generation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'core-ready-image-'))
  const root = path.join(directory, 'workspace'), bytes = new Uint8Array([10, 20, 30])
  const owner = { workspaceId: 'space', conversationId: 'conversation', runId: 'original-run', jobId: 'ready-job' }
  const job = { version: 1, jobId: owner.jobId, runId: owner.runId,
    documentId: `workspace:${documentDigest({ root })}`, status: 'ready', stopped: false,
    resources: [{ resourceId: 'image-resource', mimeType: 'image/png', width: 10, height: 20, byteLength: bytes.length }],
  } as ImageJobSnapshot
  const generation = vi.fn(() => { throw new Error('Ready image must not regenerate') })
  const options = { directory,
    images: { subscribe: () => () => {}, subscribeSettled: () => () => {}, read: async () => structuredClone(job),
      readOwnedResultResourceFromJob: async () => ({ bytes, mimeType: 'image/png' }), list: async () => [structuredClone(job)], run: generation },
    documents: { registry: { get() { throw new Error('A workspace result has no course document') } } },
    execution: { conversations: {
      readConversation: async ({ conversationId }: { conversationId: string }) => ({ runIndex: { builtinRunIds: conversationId === 'conversation' ? ['original-run'] : [], externalRunIds: [] } }),
      listWorkspaces: async () => [{ workspaceId: 'space' }],
      listConversations: async () => [{ conversationId: 'conversation', runIndex: { builtinRunIds: ['original-run'], externalRunIds: [] } }],
    }, runs: { read: async () => ({ input: { conversationId: 'conversation', workspaceRoot: root, documents: [] } }) },
    appendExternalEvent: async () => {} },
  } as unknown as ImageResultsDesktopOptions
  const service = new ImageResultsDesktopService(options)
  try {
    expect(await service.list(owner)).toMatchObject([{ source: 'builtin', job: { status: 'ready' } }])
    expect(await service.preview({ ...owner, resourceId: 'image-resource' })).toEqual({ bytes, mimeType: 'image/png', width: 10, height: 20 })
    await expect(service.read({ ...owner, conversationId: 'another' })).rejects.toThrow('不属于')
    job.documentId = `workspace:${documentDigest({ root: path.join(root, 'another') })}`
    await expect(service.read(owner)).rejects.toThrow('不属于')
    expect(generation).not.toHaveBeenCalled()
  } finally {
    await service.flush(); service.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('edits an owned workspace result through the existing image service without requiring a course document or replaying its request', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'core-edit-image-'))
  const root = path.join(directory, 'workspace'), documentId = `workspace:${documentDigest({ root })}`
  const owner = { workspaceId: 'space', conversationId: 'conversation', runId: 'original-run', jobId: 'original-job' }
  const selection: ImageModelSelection = { imageModel: 'controlled-image', connection: { id: 'connection', revision: 1,
    provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture',
    auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'subscription' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } }
  const original = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#003366' } }).png().toBuffer()
  const edited = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#ee9900' } }).png().toBuffer()
  const provider = vi.fn<ImageProviderPort['generate']>(async (request, refs) => ({ status: 'completed' as const,
    images: [{ bytes: request.operation === 'edit' ? edited : original, mimeType: 'image/png', filename: 'image.png' }],
    provenance: imageProvenance(request, refs) }))
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { generate: provider } })
  const generated = await images.run({ jobId: owner.jobId, runId: owner.runId, documentId,
    operation: 'generate', prompt: 'controlled parent', selection })
  const registry = new DocumentRegistry({ drivers: [], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document write') }, async save() { throw new Error('No document save') } } })
  const documentLookup = vi.spyOn(registry, 'get')
  const roles = frozenImageRoles(async role => ({ role, profileRevision: 1, profileUpdatedAt: '',
    connection: selection.connection, model: selection.imageModel, parameters: {} }))
  const gateway = new DocumentToolGateway(registry, [], () => crypto.randomUUID(),
    { services: { beginRun: grant => roles.beginRun(grant.runId, grant.disclosedSettings), images: {
      selection: () => selection, run: images.run.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
      readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images),
    } } })
  const options = { directory: path.join(directory, 'actions'), images, selection: roles.selection,
    documents: { registry, tools: gateway },
    execution: { conversations: {
      readConversation: async ({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) =>
        workspaceId === owner.workspaceId && conversationId === owner.conversationId
          ? { runIndex: { builtinRunIds: [owner.runId], externalRunIds: [] } } : undefined,
      listWorkspaces: async () => [{ workspaceId: owner.workspaceId }],
      listConversations: async () => [{ conversationId: owner.conversationId, runIndex: { builtinRunIds: [owner.runId], externalRunIds: [] } }],
    }, runs: { read: async () => ({ input: { conversationId: owner.conversationId, workspaceRoot: root, documents: [] } }) },
    appendExternalEvent: async () => {} },
  } as unknown as ImageResultsDesktopOptions
  const service = new ImageResultsDesktopService(options)
  let reopened: ImageResultsDesktopService | undefined
  try {
    const input = { type: 'edit' as const, ...owner, actionId: crypto.randomUUID(),
      resourceId: generated.resources[0].resourceId, prompt: 'make the switch state match the circuit' }
    const result = await service.operate(input) as ImageResultView
    expect(result.job).toMatchObject({ status: 'ready', operation: 'edit', documentId, provenance: { requestedImageModel: selection.imageModel } })
    expect(provider).toHaveBeenCalledTimes(2)
    expect(Buffer.from(provider.mock.calls[1][1][0].bytes)).toEqual(original)
    expect((await sharp((await service.preview({ ...input, runId: result.runId, jobId: result.job.jobId,
      resourceId: result.job.resources[0].resourceId })).bytes).raw().toBuffer())[0]).toBe(238)
    expect(Buffer.from((await service.preview(input)).bytes)).toEqual(original)
    // A result-card edit has an opaque image-edit job identity; the next authorized tool run can consume it.
    const reference = `${result.job.jobId}@${result.job.resources[0].resourceId}`
    await gateway.beginRun({ runId: 'consumer', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    const previewResult = await gateway.execute('consumer', 'preview-child', { name: 'image.preview', input: { images: [reference] } })
    expect(previewResult).toMatchObject({ kind: 'read', images: [{ source: 'preview', resourceId: reference }] })
    const pixels = await gateway.prepareResultImages('consumer', previewResult)
    expect(await sharp(pixels[0].bytes).raw().toBuffer()).toEqual(await sharp(edited).raw().toBuffer())
    await gateway.beginRun({ runId: 'foreign', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: `${root}-other` } })
    await expect(gateway.prepareResultImages('foreign', previewResult)).rejects.toThrow('工作空间')
    await gateway.stop('consumer')
    await expect(async () => gateway.prepareResultImages('consumer', previewResult)).rejects.toThrow('停止')
    await gateway.stop('foreign')
    reopened = new ImageResultsDesktopService(options)
    expect(await reopened.operate(input)).toEqual(result)
    await expect(service.operate({ ...input, actionId: crypto.randomUUID(), conversationId: 'another' })).rejects.toThrow('不存在')
    await expect(images.editFromResult({ jobId: 'forged-child', runId: 'forged-run', documentId: `${documentId}-other`,
      prompt: 'wrong workspace', selection }, { jobId: owner.jobId, runId: owner.runId, resourceId: input.resourceId })).rejects.toThrow('不属于')
    expect(provider).toHaveBeenCalledTimes(2)
    expect(documentLookup).not.toHaveBeenCalled()
  } finally {
    await service.flush(); service.dispose()
    if (reopened) { await reopened.flush(); reopened.dispose() }
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
