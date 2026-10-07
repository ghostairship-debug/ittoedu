// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { ImageResultsDesktopService, type ImageResultsDesktopOptions } from '../../src/main/workbench/images/ImageResultsDesktopService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ImageProviderPort } from '../../src/main/workbench/images/ImageProviderPort'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { documentDigest } from '../../src/core/documents/documentDigest'
import type { ImageJobSnapshot, ImageModelSelection } from '../../src/shared/workbench/images'
import type { ImageResultView } from '../../src/shared/workbench/imageResultsDesktop'

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
      readResource: async () => ({ bytes, mimeType: 'image/png' }), list: async () => [structuredClone(job)], run: generation },
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
  const documentLookup = vi.fn(() => { throw new Error('A result card must not require a course document') })
  const options = { directory: path.join(directory, 'actions'), images, selection: async () => selection,
    documents: { registry: { get: documentLookup } },
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
