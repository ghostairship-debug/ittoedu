// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { createServer, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { imageDataSchema } from '../../src/components/image/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ToolResult } from '../../src/shared/workbench/tools'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve())
  })))
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
      || !path.basename(resolved).startsWith('r07-image-references-')) throw new Error('Unexpected test root')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
const selection: ImageModelSelection = { imageModel: 'local-reference-model', connection: {
  id: 'reference-connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'reference-account',
  auth: { kind: 'oauth', credentialRef: 'local-reference' }, billing: { kind: 'subscription' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
} }
const read = (result: ToolResult): any => {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data
}

it('sends an authorized course image and material as independent references, then saves the new scene without changing its source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r07-image-references-')); roots.push(root)
  const raster = (background: string) => sharp({ create: { width: 32, height: 24, channels: 4, background } }).png().toBuffer()
  const character = await raster('#2458a0'), setting = await raster('#a0b824'), nextScene = await raster('#bd3e50')
  const bodies: Array<{ images: Array<{ image_url: string }>; model: string }> = []
  const server = createServer((request, response) => { void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    expect(request.url).toBe('/backend-api/codex/images/edits')
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ created: 123, data: [{ b64_json: nextScene.toString('base64') }],
      size: '32x24', output_format: 'png' }))
  })().catch(() => response.destroy()) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server')
  const transport: typeof fetch = (url, init) => fetch('http://127.0.0.1:' + address.port + new URL(String(url)).pathname, init)

  const host = new DocumentHostService(path.join(root, 'documents'))
  const original = await prepareImageResource({ bytes: character, mimeType: 'image/png', filename: 'character.png' }, () => 'character')
  const project = createBlankCourseProjectV10('Character and scene references')
  project.assets[original.meta.id] = original.meta
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  const frame = { width: 120, height: 90, transform: [1, 0, 0, 1, 70, 60] as [number, number, number, number, number, number] }
  project.instances.character = { id: 'character', definitionId: IMAGE_DEFINITION.id, data: createImageData(original.meta.id), frame }
  testContainerInstance(project, 0).childIds = ['character']
  const initial = await host.internalAPI.create({ kind: 'course-v10', project,
    resources: { assets: { [original.meta.id]: original.bytes }, components: {} } }, 'references.h5lesson')
  let materialReads = 0
  const images = new ImageGenerationService({ directory: path.join(root, 'images'),
    provider: new ChatGPTImageProvider({ fetch: transport,
      credentialResolver: async () => ({ accessToken: 'local-test-token', accountId: selection.connection.accountId }) }),
    resolveReference: async () => { throw new Error('Admitted references must not be resolved a second time') } })
  host.tools.configureHostServices({
    images: { selection: () => selection, run: images.start.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
      readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) },
    materials: { admit: async () => undefined, read: async () => { throw new Error('Text extraction not used') },
      readResource: async ({ runId, resourceId }) => {
        if (runId !== 'story' || resourceId !== 'material:scene') throw new Error('Material not authorized')
        materialReads++; return { bytes: setting, mimeType: 'image/png' }
      } },
  })
  await host.tools.beginRun({ runId: 'story', actor: 'agent',
    documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  const reference = await host.tools.issueTarget('story', initial.documentId,
    { kind: 'course-instance', surfaceId: componentSurfaces(project)[0].id, instanceId: 'character' })
  await host.tools.beginRun({ runId: 'outside', actor: 'agent', documents: [],
    fileAccess: { permission: 'workspace', workspaceRoot: path.join(root, 'other') } })
  expect(await host.tools.execute('outside', 'unauthorized-reference', {
    name: 'image.edit', input: { prompt: 'Must not send', references: [reference] },
  })).toMatchObject({ kind: 'error' })
  expect(bodies).toHaveLength(0)

  const pending = read(await host.tools.execute('story', 'next-scene', {
    name: 'image.edit', input: { prompt: 'Use the stable character and scene references for a new action',
      references: [reference, 'material:scene'] },
  }))
  await images.wait('story', pending.job, 5000)
  const ready = read(await host.tools.execute('story', 'read-next-scene', { name: 'image.status', input: { job: pending.job } }))
  expect(ready).toMatchObject({ status: 'ready', scope: 'workspace', provenance: {
    references: [{ referenceId: reference }, { referenceId: 'material:scene' }],
  } })
  expect(bodies).toEqual([{ model: selection.imageModel, prompt: 'Use the stable character and scene references for a new action',
    images: [{ image_url: 'data:image/png;base64,' + character.toString('base64') },
      { image_url: 'data:image/png;base64,' + setting.toString('base64') }] }])
  expect(materialReads).toBe(1)
  expect((await host.internalAPI.read(initial.documentId)).model).toEqual(initial.model)

  const destination = await host.tools.issueTarget('story', initial.documentId,
    { kind: 'course-surface', surfaceId: componentSurfaces(project)[0].id })
  await host.tools.loadToolFamilies('story', ['media'])
  expect(await host.tools.execute('story', 'insert-next-scene', {
    name: 'media.insert', input: { target: destination, resource: ready.resources[0].resource },
  })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const applied = await host.internalAPI.read(initial.documentId)
  if (applied.model.kind !== 'course-v10') throw new Error('Expected current course')
  expect(applied.model.project.instances.character.frame).toEqual(frame)
  expect(Buffer.from(applied.model.resources.assets[original.meta.id])).toEqual(character)
  const insertedId = componentSurfaces(applied.model.project)[0].childIds.find(id => id !== 'character')!
  const insertedAsset = imageDataSchema.parse(applied.model.project.instances[insertedId].data).assetId
  expect(Buffer.from(applied.model.resources.assets[insertedAsset])).toEqual(nextScene)
  const filename = path.join(root, 'saved.h5lesson')
  await host.internalAPI.save(initial.documentId, filename)
  const reopened = await new DocumentHostService(path.join(root, 'cold')).open(filename)
  expect(reopened.model).toEqual(applied.model)
  expect(bodies).toHaveLength(1)
  await host.tools.stop('outside'); await host.tools.stop('story')
})
