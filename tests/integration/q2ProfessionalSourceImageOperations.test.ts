// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentSourceAuthoringEdits } from '../../src/core/components/source/sourceAuthoringEdits'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { IMAGE_DEFINITION } from '../../src/components/image'
import { createImageData, imageDataSchema } from '../../src/components/image/data'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { AssetSource } from '../../src/shared/contracts/media-v1/types'

const encode = (text: string) => new TextEncoder().encode(text)
const svg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${color}"/></svg>`
const model = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}

it('replaces an aliased professional image with shared source through both live image Gateway routes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-q2-professional-image-'))
  try {
    const original = await prepareImageResource({ filename: 'original.svg', mimeType: 'image/svg+xml', bytes: encode(svg('blue')) }, () => 'original')
    const project = createBlankCourseProjectV10('Shared image source')
    const definition = { ...structuredClone(IMAGE_DEFINITION), id: 'library-rebound-image', title: '共享图片程序' }
    project.definitions[definition.id] = definition
    const imageData = createImageData(original.meta.id, '教师原图')
    imageData.fit = 'cover'; imageData.crop = { left: .1, top: .2, right: .1, bottom: 0 }
    imageData.cropX = .2; imageData.cropY = .8; imageData.filters.contrast = 1.3
    const frame = { width: 310, height: 210, transform: [1, .2, 0, 1, 17, 29] as [number, number, number, number, number, number] }
    for (const id of ['image', 'other']) project.instances[id] = { id, definitionId: definition.id,
      data: structuredClone(imageData) as unknown as typeof project.instances[string]['data'], frame, style: { opacity: .7 } }
    project.surfaces[0].childIds = ['image', 'other']
    project.assets[original.meta.id] = original.meta
    const host = new DocumentHostService(path.join(directory, 'recovery'))
    const initial = await host.internalAPI.create({ kind: 'course-v10', project,
      resources: { assets: { [original.meta.id]: original.bytes }, components: {} } }, 'shared-image.h5lesson')
    const sourceFiles = { 'main.js': encode('export default {mount(){return {update(){},dispose(){}}}};'), 'opaque.bin': Uint8Array.of(255, 0, 128) }
    const sourceEdits = componentSourceAuthoringEdits({ kind: 'definition', definition },
      { kind: 'source', language: 'javascript', workspace: { ownerId: 'image-source', entry: 'main.js' } },
      { type: 'component.files.set', ownerId: 'image-source', files: sourceFiles, expectedFiles: null })
    expect((await host.internalAPI.dispatch({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
      operationId: 'share-image-source', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(project, sourceEdits) } })).status).toBe('applied')
    const shared = model(await host.internalAPI.read(initial.documentId))
    expect(shared.project.definitions[definition.id]).toMatchObject({ professionalBuiltinKey: 'guoling.image', implementation: { kind: 'source' } })
    const originalInstanceIds = Object.keys(shared.project.instances).sort()
    const assetSource: AssetSource = { kind: 'user-material', title: '本地图片样本' }
    await fs.writeFile(path.join(directory, 'red.svg'), svg('red'))
    await fs.writeFile(path.join(directory, 'green.svg'), svg('green'))
    host.tools.configureHostServices({ openImages: {
      search: async () => ({}), preview: async () => ({}), readPreview: () => { throw new Error('No preview in this local case') },
      fetch: async input => ({ status: 'ready', file: { filename: `${input.image}.svg`, mimeType: 'image/svg+xml',
        bytes: new Uint8Array(await fs.readFile(path.join(directory, `${input.image}.svg`))) }, width: 160, height: 90, source: assetSource }),
    } })
    await host.tools.beginRun({ runId: 'images', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { workspaceRoot: directory, permission: 'workspace' } })
    await host.tools.loadToolFamilies('images', ['content', 'media'])
    let serial = 0
    const call = (name: string, input: unknown) => host.tools.execute('images', `image-call-${++serial}`, { name, input })
    const imageFile = componentProjectFiles(shared.project, shared.resources).find(file => file.target?.kind === 'instance' && file.target.instanceId === 'image' && file.kind === 'data')!
    await call('project.read', { path: imageFile.path })
    expect(await call('image.fetch', { image: 'red', path: imageFile.path })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    let current = model(await host.internalAPI.read(initial.documentId))
    const fetched = imageDataSchema.parse(current.project.instances.image.data)
    expect(fetched.assetId).not.toBe(original.meta.id)
    expect(fetched).toMatchObject({ originalAssetId: fetched.assetId, fit: 'cover', filters: { contrast: 1.3 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 }, cropX: .2, cropY: .8 })
    expect(current.resources.assets[fetched.assetId]).toEqual(encode(svg('red')))
    expect(current.project.assets[fetched.assetId].source).toEqual(assetSource)
    const resourceResult = await call('image.fetch', { image: 'green' })
    expect(resourceResult).toMatchObject({ kind: 'read', data: { status: 'ready', resource: expect.any(String) } })
    if (resourceResult.kind !== 'read') throw new Error('Missing image resource')
    const resource = (resourceResult.data as { resource: string }).resource
    expect(await call('project.apply', { path: imageFile.path, from: resource, intent: 'content' }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    current = model(await host.internalAPI.read(initial.documentId))
    const replaced = imageDataSchema.parse(current.project.instances.image.data)
    expect(replaced.assetId).not.toBe(fetched.assetId)
    expect(replaced).toMatchObject({ originalAssetId: replaced.assetId, fit: 'cover', filters: { contrast: 1.3 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 }, cropX: .2, cropY: .8 })
    expect(current.resources.assets[replaced.assetId]).toEqual(encode(svg('green')))
    expect(Object.keys(current.project.instances).sort()).toEqual(originalInstanceIds)
    expect(current.project.instances.image).toMatchObject({ id: 'image', definitionId: definition.id, frame, style: { opacity: .7 } })
    expect(current.project.instances.image.implementationOverride).toBeUndefined()
    expect(current.project.instances.other).toEqual(shared.project.instances.other)
    expect(current.project.definitions[definition.id]).toEqual(shared.project.definitions[definition.id])
    expect(current.resources.components).toEqual(shared.resources.components)
    expect(current.resources.assets[original.meta.id]).toEqual(original.bytes)
    expect((await host.internalAPI.read(initial.documentId)).undoDepth).toBe(3)
    await host.tools.stop('images')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
