// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
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
function data<T>(result: ToolResult): T {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as T
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'creation-image-application-'))
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#347d68' } }).png().toBuffer()
  let providerCalls = 0
  const images = new ImageGenerationService({ directory: path.join(root, 'images'), provider: {
    generate: async (request, references) => {
      providerCalls++
      return { status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: 'ready.png' }], provenance: imageProvenance(request, references) }
    },
  } })
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const gateway = documents.tools
  gateway.configureHostServices({ images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images),
    stop: images.stop.bind(images), readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) } })
  await gateway.beginRun({ runId: 'author', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: root } })
  let sequence = 0
  const call = (name: string, input: unknown) => gateway.execute('author', String(++sequence), { name, input })
  const ready = data<{ job: string; resources: { resource: string; resourceId: string }[] }>(await call('image.generate', { prompt: 'Local fixture' }))
  const project = await documents.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Ready image'),
    resources: { assets: {}, components: {} } }, 'ready-image.h5lesson')
  await gateway.attachRunDocument('author', project.documentId, true, 'select')
  const target = await gateway.issueTarget('author', project.documentId, { kind: 'document' })
  const children = data<{ target: string; kind: string }[]>(await call('listChildren', { target }))
  const surface = children.find(child => child.kind === 'course-surface')!
  return { root, bytes, images, documents, gateway, project, surface, ready, call, providerCalls: () => providerCalls }
}

it('inserts the public workspace ready resource directly through media.insert and project.apply from', async () => {
  const f = await fixture()
  try {
    const resource = f.ready.resources[0].resource
    expect(await f.call('media.insert', { target: f.surface.target, resource, fit: 'contain' }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const files = data<{ files: { path: string; type: string }[] }>(await f.call('project.list', {})).files
    const page = files.find(file => file.type === 'structure' && file.path.startsWith('pages/'))!
    expect(await f.call('project.apply', { path: page.path, from: resource, intent: 'insert' }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = await f.documents.internalAPI.read(f.project.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(current.model.project.surfaces[0].childIds).toHaveLength(2)
    for (const id of current.model.project.surfaces[0].childIds) {
      const instance = current.model.project.instances[id]
      expect(current.model.project.definitions[instance.definitionId].implementation).toMatchObject({ kind: 'builtin', key: 'guoling.image' })
      const assetId = (instance.data as { assetId: string }).assetId
      expect((await sharp(current.model.resources.assets[assetId]).metadata()).width).toBe(32)
    }
    expect(f.providerCalls()).toBe(1)
  } finally {
    await f.gateway.stop('author')
    await fs.rm(f.root, { recursive: true, force: true })
  }
})

it('rejects foreign workspace and unfinished resources before either image application commits', async () => {
  const f = await fixture()
  try {
    await f.gateway.beginRun({ runId: 'outside', actor: 'agent', documents: [{ documentId: f.project.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: path.join(f.root, 'outside') } })
    const outside = await f.gateway.issueTarget('outside', f.project.documentId,
      { kind: 'course-surface', surfaceId: f.project.model.kind === 'course-v10' ? f.project.model.project.surfaces[0].id : '' })
    expect(await f.gateway.execute('outside', 'insert', { name: 'media.insert', input: { target: outside, resource: f.ready.resources[0].resource } }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('工作空间') })
    const controller = new AbortController(); controller.abort()
    const jobId = `image-tool:${'7'.repeat(64)}`
    await f.images.run({ jobId, runId: 'author', documentId: `workspace:${documentDigest({ root: f.root })}`,
      operation: 'generate', prompt: 'Already stopped', selection }, { signal: controller.signal })
    const reference = `${jobId}@${f.ready.resources[0].resourceId}`
    const files = data<{ files: { path: string; type: string }[] }>(await f.call('project.list', {})).files
    const page = files.find(file => file.type === 'structure' && file.path.startsWith('pages/'))!
    expect(await f.call('project.apply', { path: page.path, from: reference, intent: 'insert' }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('已完成任务') })
    const current = await f.documents.internalAPI.read(f.project.documentId)
    expect(current.revision).toBe(f.project.revision)
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(current.model.project.surfaces[0].childIds).toEqual([])
    expect(Object.keys(current.model.resources.assets)).toEqual([])
    expect(f.providerCalls()).toBe(1)
  } finally {
    await f.gateway.stop('author'); await f.gateway.stop('outside')
    await fs.rm(f.root, { recursive: true, force: true })
  }
})
