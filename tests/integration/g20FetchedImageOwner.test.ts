// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { HostToolCoordinator } from '../../src/core/tools/HostToolServices'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'
import type { ImageProviderReference } from '../../src/main/workbench/images/ImageProviderPort'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { AssetSource } from '../../src/shared/contracts/media-v1'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
const source: AssetSource = { kind: 'open-library', title: 'Maple', author: 'Jane', url: 'https://example.org/maple',
  license: { id: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, attribution: 'Maple by Jane, CC BY 4.0' }

it('retains fetched bytes and source in the existing owner across task cleanup and cold reopen, without generating or widening workspace ownership', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-fetched-owner-')); roots.push(root)
  const generate = vi.fn(async () => { throw new Error('Fetching must not generate') })
  const ownerDirectory = path.join(root, 'images')
  const owner = new ImageGenerationService({ directory: ownerDirectory, provider: { generate } })
  const host = new DocumentHostService(path.join(root, 'documents'))
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { append: async () => undefined, save: async () => { throw new Error('No document needed') } } })
  const authority = { resolveImage: async () => { throw new Error('No document needed') }, active: () => undefined,
    ownsDocument: () => false, provideImage: async () => { throw new Error('No document needed') }, readImage: async () => { throw new Error('No document needed') } }
  const ports = (service: ImageGenerationService): HostToolServices => ({ images: {
    selection: () => { throw new Error('No model needed') }, run: service.run.bind(service), read: service.read.bind(service), stop: service.stop.bind(service),
    readResource: service.readResource.bind(service), registerWorkspaceResource: service.registerWorkspaceResource.bind(service), readWorkspaceResource: service.readWorkspaceResource.bind(service) },
    artifacts: { lookup: (runId: string, operationId: string) => host.artifactDeliveries.lookup(operationId, runId),
      save: input => {
        if (!input.grant.fileAccess?.workspaceRoot || input.source.kind !== 'image-resource') throw new Error('Frozen image grant required')
        return host.artifactDeliveries.deliver({ ...input, workspaceRoot: input.grant.fileAccess.workspaceRoot,
          runId: input.grant.runId, permission: input.grant.fileAccess.permission, destination: input.source.destination,
          sourceKind: 'image', sourceId: input.source.resource })
      } } })
  const coordinator = new HostToolCoordinator(ports(owner), registry, authority)
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#445566' } }).png().toBuffer()
  await coordinator.beginRun({ runId: 'fetch', actor: 'agent', documents: [], fileAccess: { permission: 'read-only', workspaceRoot: root } })
  const resource = await coordinator.registerFetchedImage('fetch', { bytes, mimeType: 'image/png', filename: 'maple.png' }, source)
  expect(resource).toMatch(/^workspace-image:[a-f0-9]{64}:image_[a-f0-9]{64}$/)
  await coordinator.stop('fetch')
  await expect(coordinator.readImageReference('fetch', resource)).rejects.toThrow('停止')
  expect(await owner.releaseRunJobs(['fetch'])).toMatchObject({ deferred: false, jobs: 0, resources: 0 })
  expect(generate).not.toHaveBeenCalled()
  const reopened = new ImageGenerationService({ directory: ownerDirectory, provider: { generate } })
  const resumed = new HostToolCoordinator(ports(reopened), registry, authority)
  await resumed.beginRun({ runId: 'next', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: root } })
  const read = await resumed.readImageReference('next', resource)
  expect(read?.source).toEqual(source)
  expect(Buffer.from(read!.bytes)).toEqual(bytes)
  expect(await resumed.registerFetchedImage('next', read!, source)).toBe(resource)
  const saved = await resumed.saveArtifact('next', 'save-fetched', 'digest', { source: resource, destination: 'downloaded.png' })
  expect(saved).toMatchObject({ kind: 'read', data: { status: 'written', sourceId: resource } })
  expect(await fs.readFile(path.join(root, 'downloaded.png'))).toEqual(bytes)
  await resumed.beginRun({ runId: 'other', actor: 'agent', documents: [], fileAccess: { permission: 'full', workspaceRoot: path.join(root, 'other') } })
  await expect(resumed.readImageReference('other', resource)).rejects.toThrow('不属于当前工作空间')
  expect(generate).not.toHaveBeenCalled()
})

it('edits a fetched standalone image using the same owner reference and original bytes, while preserving source attribution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-fetched-edit-')); roots.push(root)
  const { imageProvenance } = await import('../../src/main/workbench/images/imageRoute')
  const { documentDigest } = await import('../../src/core/documents/documentDigest')
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#445566' } }).png().toBuffer()
  const generate = vi.fn(async (request: ImageGenerationRequest, references: readonly ImageProviderReference[]) => {
    expect(references).toHaveLength(1)
    expect(Buffer.from(references[0].bytes)).toEqual(bytes)
    expect(references[0].source).toEqual(source)
    return { status: 'completed' as const, images: [{ bytes, mimeType: 'image/png', filename: 'edited.png' }], provenance: imageProvenance(request) }
  })
  const owner = new ImageGenerationService({ directory: path.join(root, 'images'), provider: { generate } })
  const scope = `workspace:${documentDigest({ root })}`
  const resource = await owner.registerWorkspaceResource(scope, { bytes, mimeType: 'image/png', filename: 'maple.png' }, source)
  const selection = { imageModel: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses' as const,
    baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture', auth: { kind: 'oauth' as const, credentialRef: 'fixture' }, billing: { kind: 'subscription' as const },
    capabilities: { tools: 'unknown' as const, stream: 'unknown' as const, vision: 'unknown' as const, reasoning: 'unknown' as const } } }
  const result = await owner.run({ runId: 'edit', jobId: 'image-tool:fixture', documentId: scope, operation: 'edit', prompt: 'edit the fetched image',
    selection, referenceIds: [resource] })
  expect(result.status).toBe('ready')
  expect(generate).toHaveBeenCalledTimes(1)
  expect((await owner.readWorkspaceResource(scope, resource)).source).toEqual(source)
  expect((await owner.releaseRunJobs(['edit'])).resources).toBe(0)
})
