// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { HostToolCoordinator, type HostToolServices } from '../../src/core/tools/HostToolServices'
import { HostArtifactDeliveryService } from '../../src/main/workbench/execution/HostArtifactDeliveryService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ToolResult } from '../../src/shared/workbench/tools'

const selection: ImageModelSelection = { imageModel: 'local-fixture', connection: {
  id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture',
  auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
} }
function data(result: ToolResult): any {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'creation-image-recovery-'))
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#347d68' } }).png().toBuffer()
  let providerCalls = 0
  const editedReferences: Uint8Array[][] = []
  const images = new ImageGenerationService({ directory: path.join(root, 'images'), provider: {
    generate: async (request, references) => {
      providerCalls++
      if (request.operation === 'edit') editedReferences.push(references.map(reference => Uint8Array.from(reference.bytes)))
      return { status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: 'ready.png' }], provenance: imageProvenance(request, references) }
    },
  } })
  const artifacts = new HostArtifactDeliveryService({ journalDirectory: path.join(root, 'deliveries'), withFileOperation: work => work() })
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() { throw new Error('No document writes') }, async save() { throw new Error('No document saves') } } })
  const never = (): never => { throw new Error('Workspace recovery cannot use document authority') }
  const services: HostToolServices = {
    images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
      readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) },
    artifacts: { lookup: (runId, operationId) => artifacts.lookup(operationId, runId),
      save: ({ grant, operationId, source, bytes: supplied, assertActive }) => artifacts.deliver({
        runId: grant.runId, operationId, workspaceRoot: grant.fileAccess!.workspaceRoot, permission: grant.fileAccess!.permission,
        destination: source.destination, sourceKind: source.kind,
        sourceId: source.kind === 'image' ? `${source.job}@${source.resourceId}` : `${source.job}@${source.name}`,
        bytes: supplied, assertActive,
      }) },
  }
  const coordinator = new HostToolCoordinator(services, registry, {
    resolveImage: never, active: never, ownsDocument: () => false, provideImage: never, readImage: never,
  })
  const begin = (runId: string, workspaceRoot = root) => coordinator.beginRun({ runId, actor: 'agent', documents: [],
    fileAccess: { permission: 'workspace', workspaceRoot } })
  return { root, bytes, images, coordinator, begin, providerCalls: () => providerCalls, editedReferences }
}

it('edits a ready workspace image from its original bytes through a new run public image request', async () => {
  const f = await fixture()
  try {
    await f.begin('original')
    const generated = data(await f.coordinator.invoke('original', `tool:${'3'.repeat(64)}`, 'generate', 'image.generate', { prompt: 'Local fixture' }))
    await f.coordinator.stop('original')
    await f.begin('continuation')
    const ready = data(await f.coordinator.invoke('continuation', 'ready-status', '', 'image.status', { job: generated.job }))
    const request = { prompt: 'Edit the existing image', references: [ready.resources[0].resource] }
    const edited = data(await f.coordinator.invoke('continuation', `tool:${'4'.repeat(64)}`, 'edit', 'image.edit', request))
    expect(edited).toMatchObject({ status: 'ready', scope: 'workspace', resources: [{ mimeType: 'image/png', width: 32, height: 24 }] })
    expect(f.editedReferences).toHaveLength(1)
    expect(f.editedReferences[0]).toHaveLength(1)
    expect(Buffer.from(f.editedReferences[0][0])).toEqual(f.bytes)
    expect(f.providerCalls()).toBe(2)
    expect(await f.images.read(generated.job)).toMatchObject({ runId: 'original', status: 'ready', stopped: false })
    expect(await f.images.read(edited.job)).toMatchObject({ runId: 'continuation', status: 'ready', operation: 'edit' })
    expect(data(await f.coordinator.invoke('continuation', `tool:${'4'.repeat(64)}`, 'edit', 'image.edit', request))).toEqual(edited)
    expect(f.providerCalls()).toBe(2)
  } finally {
    await f.coordinator.stop('continuation')
    if (!path.resolve(f.root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(f.root, { recursive: true, force: true })
  }
})

it('reuses a ready workspace image after the original session closes and saves without generating again', async () => {
  const f = await fixture()
  try {
    await f.begin('original')
    const generated = data(await f.coordinator.invoke('original', `tool:${'1'.repeat(64)}`, 'generate', 'image.generate', { prompt: 'Local fixture' }))
    expect(generated.status).toBe('ready')
    const resourceId = generated.resources[0].resourceId
    await f.begin('continuation')
    // The resident host still holds the original runtime entry here.
    expect(data(await f.coordinator.invoke('continuation', 'known-status', '', 'image.status', { job: generated.job })).status).toBe('ready')
    await f.coordinator.stop('original')
    await f.coordinator.stop('continuation')
    await f.begin('reconnected')
    const ready = data(await f.coordinator.invoke('reconnected', 'restored-status', '', 'image.status', { job: generated.job }))
    expect(ready).toMatchObject({ status: 'ready', scope: 'workspace', resources: [{ resourceId }] })
    const saved = data(await f.coordinator.saveArtifact('reconnected', 'save-existing', 'save-existing', {
      kind: 'image', job: ready.job, resourceId, destination: 'continued.png',
    }))
    expect(saved).toMatchObject({ status: 'written', sourceKind: 'image' })
    expect((await sharp(await fs.readFile(saved.path)).metadata()).width).toBe(32)
    expect(f.providerCalls()).toBe(1)
    expect((await f.images.read(generated.job)).runId).toBe('original')
  } finally {
    await f.coordinator.stop('reconnected')
    await fs.rm(f.root, { recursive: true, force: true })
  }
})

it('keeps document images, other workspaces and stopped unfinished jobs outside ready-result recovery', async () => {
  const f = await fixture()
  try {
    await f.begin('original')
    const ready = data(await f.coordinator.invoke('original', `tool:${'2'.repeat(64)}`, 'generate', 'image.generate', { prompt: 'Local fixture' }))
    await f.begin('outside', path.join(f.root, 'another-workspace'))
    await expect(f.coordinator.invoke('outside', 'status', '', 'image.status', { job: ready.job })).rejects.toThrow('工作空间')
    await expect(f.coordinator.readStandaloneImage('outside', ready.job, ready.resources[0].resourceId)).rejects.toThrow('工作空间')
    const document = await f.images.run({ jobId: 'document-ready', runId: 'original', documentId: 'captured-document',
      operation: 'generate', prompt: 'Document fixture', selection })
    await f.begin('continuation')
    await expect(f.coordinator.invoke('continuation', 'document-status', '', 'image.status', { job: document.jobId })).rejects.toThrow('工作空间')
    await expect(f.coordinator.readStandaloneImage('continuation', document.jobId, document.resources[0].resourceId)).rejects.toThrow('工作空间')
    const controller = new AbortController(); controller.abort()
    const stopped = await f.images.run({ jobId: 'stopped-request', runId: 'original',
      documentId: `workspace:${documentDigest({ root: f.root })}`, operation: 'generate', prompt: 'Already stopped', selection }, { signal: controller.signal })
    expect(stopped).toMatchObject({ status: 'stopped', stopped: true })
    await expect(f.coordinator.invoke('continuation', 'stopped-status', '', 'image.status', { job: stopped.jobId })).rejects.toThrow('已完成成果')
    await expect(f.coordinator.readStandaloneImage('continuation', stopped.jobId, ready.resources[0].resourceId)).rejects.toThrow('已完成任务')
    expect(f.providerCalls()).toBe(2)
  } finally {
    await f.coordinator.stop('original'); await f.coordinator.stop('outside'); await f.coordinator.stop('continuation')
    await fs.rm(f.root, { recursive: true, force: true })
  }
})
