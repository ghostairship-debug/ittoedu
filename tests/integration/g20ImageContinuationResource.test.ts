// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'

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
