// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ImageGenerationService } from '../../../../src/main/workbench/images/ImageGenerationService'
import { imageProvenance } from '../../../../src/main/workbench/images/imageRoute'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import type { ImageModelSelection } from '../../../../src/shared/workbench/images'
import type { HostToolServices } from '../../../../src/core/tools/HostToolServices'

it('looks up a durable original image after its ACK is lost and document detached without another generation or renewed resource authority', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T09-image-lost-ack-'))
  try {
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const opened = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Original image owner'),
      resources: { assets: {}, components: {} } }, 'image-owner.h5lesson')
    const original = await host.internalAPI.read(opened.documentId)
    const selection: ImageModelSelection = { imageModel: 'local-image', connection: { id: 'fixture', revision: 1, provider: 'openai',
      protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'unused' },
      billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } }
    const bytes = await sharp({ create: { width: 24, height: 20, channels: 4, background: '#1358a4' } }).png().toBuffer()
    let generated = 0
    const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { generate: async (request, references) => {
      generated++
      return { status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: 'original.png' }], provenance: imageProvenance(request, references) }
    } } })
    const servicePort = (owner: ImageGenerationService): NonNullable<HostToolServices['images']> => ({ selection: () => selection,
      run: owner.run.bind(owner), read: owner.read.bind(owner), stop: owner.stop.bind(owner), readResource: owner.readResource.bind(owner),
      readReadyResourceFromJob: owner.readReadyResourceFromJob.bind(owner) })
    let originalJob = ''
    // Lose only the acknowledgement after the real durable image owner has stored the completed job and raster.
    host.tools.configureHostServices({ images: { ...servicePort(images), run: async (request, options) => {
      const result = await images.run(request, options); originalJob = result.jobId
      expect(result.status).toBe('ready')
      throw Object.assign(new Error('Controlled loss of original image ACK'), { code: 'tool-outcome-unknown' })
    } } })
    const grant = { runId: 'original-run', actor: 'agent' as const, documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' as const }] }],
      fileAccess: { permission: 'workspace' as const, workspaceRoot: directory } }
    await host.tools.beginRun(grant)
    const target = await host.tools.issueTarget(grant.runId, opened.documentId, { kind: 'document' })
    const call = { name: 'image.generate', input: { target, prompt: 'Local original image' } }
    const provide = vi.spyOn(host.tools, 'provideImage')
    const lost = await host.tools.execute(grant.runId, 'original-call', call)
    expect(lost.kind, JSON.stringify(lost)).toBe('error')
    expect(originalJob).not.toBe('')
    expect(generated).toBe(1)
    expect(await host.internalAPI.read(opened.documentId)).toEqual(original)
    await host.tools.stopRunDocument(grant.runId, opened.documentId)
    await host.operate({ type: 'close', documentId: opened.documentId, discardDirty: true })
    await host.tools.stop(grant.runId)
    const lookup = await host.tools.lookup(grant.runId, 'original-call', call)
    expect(lookup, JSON.stringify(lookup)).toMatchObject({ kind: 'read', data: { job: originalJob, documentId: opened.documentId, status: 'ready',
      resources: [{ resourceId: expect.any(String), width: 24, height: 20 }] } })
    if (lookup?.kind !== 'read') throw new Error('Missing original durable receipt')
    const data = lookup.data as { resources: Array<{ resourceId: string; resource?: string }> }
    expect(data.resources[0].resource).toBeUndefined()
    expect(provide).not.toHaveBeenCalled()
    expect(host.tools.runtimeCounts(grant.runId)).toMatchObject({ handles: 0, images: 0,
      host: { runs: 0, imageJobs: 0, imageResources: 0, reissuedImages: 0 } })
    expect(await host.tools.execute(grant.runId, 'new-generation', call)).toMatchObject({ kind: 'error', code: 'run-stopped' })

    const cold = new DocumentHostService(path.join(directory, 'cold-documents'))
    const reopenedOwner = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { generate: async () => {
      throw new Error('Read-only recovery must never call the image provider')
    } } })
    cold.tools.configureHostServices({ images: servicePort(reopenedOwner) })
    cold.tools.recoverRun(grant)
    const coldProvide = vi.spyOn(cold.tools, 'provideImage')
    expect(await cold.tools.lookup(grant.runId, 'original-call', call)).toEqual(lookup)
    expect(cold.tools.runtimeCounts(grant.runId)).toMatchObject({ handles: 0, images: 0,
      host: { runs: 0, imageJobs: 0, imageResources: 0, reissuedImages: 0 } })
    expect(coldProvide).not.toHaveBeenCalled()
    expect(await cold.tools.execute(grant.runId, 'after-recovery', call)).toMatchObject({ kind: 'error', code: 'run-stopped' })
    const retained = await reopenedOwner.readResource(data.resources[0].resourceId)
    expect(await sharp(retained.bytes).metadata()).toMatchObject({ width: 24, height: 20, format: 'png' })
    expect(generated).toBe(1)
    expect(cold.registry.list()).toHaveLength(0)
  } finally {
    vi.restoreAllMocks()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
