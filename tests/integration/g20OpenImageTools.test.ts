// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OpenImageService } from '../../src/main/workbench/assetSources/OpenImageService'
import type { OpenImageCandidate } from '../../src/main/workbench/assetSources/assetSourceTypes'
import { openverseLicense } from '../../src/main/workbench/assetSources/licensePolicy'
import { assetSourceSchema } from '../../src/shared/contracts/media-v1/schema'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'

function data(result: ToolResult): unknown { if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data }
const photo: OpenImageCandidate = { library: 'openverse', providerId: 'flickr-1', title: 'Autumn maple leaves', author: 'Jane Doe',
  license: openverseLicense('by', '2.0', 'https://creativecommons.org/licenses/by/2.0/', { allowShareAlike: false })!,
  sourceName: 'Flickr', pageUrl: 'https://www.flickr.com/photos/1/2', fileUrl: 'https://live.staticflickr.com/1/2_b.jpg',
  previewUrl: 'https://api.openverse.org/v1/images/flickr-1/thumb/', width: 1024, height: 768 }

it('keeps previews run-scoped and fetched images workspace-owned, permits independent reads and inserts once with provenance through save undo and cold reopen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-current-open-image-'))
  const jpeg = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#c86428' } }).jpeg().toBuffer()
  const getBytes = vi.fn(async (url: string) => ({ url, contentType: 'image/jpeg', bytes: Uint8Array.from(jpeg) }))
  const search = vi.fn(async () => ({ library: 'openverse' as const, candidates: [photo], excluded: 0, hasMore: false }))
  const openImages = new OpenImageService({ http: { getJson: async () => { throw new Error('No remote JSON in this fixture') }, getBytes }, libraries: [['openverse', search]] })
  const host = new DocumentHostService(path.join(root, 'documents'))
  const imageOwner = new ImageGenerationService({ directory: path.join(root, 'images'), provider: { generate: async () => { throw new Error('Fetched images must not call a generator') } } })
  host.tools.configureHostServices({ openImages, beginRun: async grant => { openImages.beginRun(grant.runId) }, stopRun: runId => { openImages.stopRun(runId) },
    images: { selection: () => { throw new Error('No model selection for fetched images') }, run: imageOwner.run.bind(imageOwner), read: imageOwner.read.bind(imageOwner),
      stop: imageOwner.stop.bind(imageOwner), readResource: imageOwner.readResource.bind(imageOwner),
      registerWorkspaceResource: imageOwner.registerWorkspaceResource.bind(imageOwner), readWorkspaceResource: imageOwner.readWorkspaceResource.bind(imageOwner) } })
  const initial = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('秋天'), resources: { assets: {}, components: {} } }, '秋天.h5lesson')
  if (initial.model.kind !== 'course-v10') throw new Error('V10 required')
  const surfaceId = initial.model.project.surfaces[0].id
  const begin = (runId: string, permission: 'workspace' | 'read-only') => host.tools.beginRun({ runId, actor: 'agent',
    documents: [{ documentId: initial.documentId, writable: permission === 'read-only' ? [] : [{ kind: 'document' }] }], fileAccess: { permission, workspaceRoot: root } })
  const call = (runId: string, id: string, name: string, input: unknown) => host.tools.execute(runId, id, { name, input })
  try {
    await begin('reader', 'read-only')
    expect(data(await call('reader', 'reader-search', 'image.search', { query: 'maple' }))).toMatchObject({ status: 'results', candidates: [{ image: 'img1' }] })
    expect(data(await call('reader', 'independent-fetch', 'image.fetch', { image: 'img1' })))
      .toMatchObject({ status: 'ready', resource: expect.stringMatching(/^workspace-image:/) })
    expect(await call('reader', 'denied-apply', 'image.fetch', { image: 'img1', path: 'assets/x.jpg' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(getBytes).toHaveBeenCalledTimes(1)
    expect(await host.internalAPI.read(initial.documentId)).toEqual(initial)
    getBytes.mockClear()
    await begin('writer', 'workspace')
    expect(data(await call('writer', 'foreign-candidate', 'image.fetch', { image: 'img1' })))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('image.search') })
    expect(getBytes).not.toHaveBeenCalled()
    expect((await host.tools.describeRun('writer')).map(value => value.name)).toEqual(expect.arrayContaining(['image.search', 'image.preview', 'image.fetch']))
    const found = data(await call('writer', 'search', 'image.search', { query: 'autumn maple leaves' }))
    expect(found).toMatchObject({ status: 'results', candidates: [{ image: 'img1', title: photo.title, author: photo.author, license: 'CC BY 2.0', source: 'Flickr' }] })
    const previewed = z.object({ status: z.literal('prepared'), previews: z.array(z.object({ resourceId: z.string(), byteLength: z.number() })) })
      .parse(data(await call('writer', 'preview', 'image.preview', { images: ['img1'] })))
    expect(getBytes).toHaveBeenCalledTimes(1)
    expect(getBytes.mock.calls[0][0]).toBe(photo.previewUrl)
    const preview = await host.tools.readOpenImagePreview('writer', previewed.previews[0].resourceId)
    expect(preview.bytes.byteLength).toBe(previewed.previews[0].byteLength)
    expect(await sharp(preview.bytes).metadata()).toMatchObject({ format: 'jpeg', width: 480, height: 360 })
    await expect(host.tools.readOpenImagePreview('reader', previewed.previews[0].resourceId)).rejects.toThrow('不属于本任务')

    const fetched = z.object({ status: z.literal('ready'), resource: z.string(), source: assetSourceSchema }).parse(data(await call('writer', 'fetch', 'image.fetch', { image: 'img1' })))
    expect(getBytes).toHaveBeenCalledTimes(2)
    expect(getBytes.mock.calls[1][0]).toBe(photo.fileUrl)
    expect(fetched.source).toEqual({ kind: 'open-library', title: photo.title, author: photo.author, url: photo.pageUrl,
      license: { id: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/' },
      attribution: '“Autumn maple leaves”，作者：Jane Doe，来源：Flickr（https://www.flickr.com/photos/1/2），授权：CC BY 2.0（https://creativecommons.org/licenses/by/2.0/）' })
    expect(await host.internalAPI.read(initial.documentId)).toEqual(initial)
    const resource = await host.tools.readImageResource('writer', initial.documentId, fetched.resource)
    expect(await sharp(resource.bytes).metadata()).toMatchObject({ format: 'jpeg', width: 1024, height: 768 })
    const target = await host.tools.issueTarget('writer', initial.documentId, { kind: 'course-surface', surfaceId })
    await host.tools.loadToolFamilies('writer', ['media'])
    expect(await call('writer', 'insert', 'media.insert', { target, resource: fetched.resource }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const inserted = await host.internalAPI.read(initial.documentId)
    if (inserted.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(inserted.undoDepth).toBe(1)
    const [asset] = Object.values(inserted.model.project.assets)
    expect(asset.source).toEqual(fetched.source)
    expect(Buffer.from(inserted.model.resources.assets[asset.id])).toEqual(Buffer.from(resource.bytes))
    expect(inserted.model.project.surfaces[0].childIds).toHaveLength(1)
    const saved = path.join(root, 'saved.h5lesson'); await host.internalAPI.save(initial.documentId, saved)
    const head = await host.internalAPI.read(initial.documentId)
    expect(await host.internalAPI.dispatch({ documentId: head.documentId, epoch: head.epoch, baseRevision: head.revision, actor: 'human', operationId: 'undo-insert', mutation: { type: 'undo' } }))
      .toMatchObject({ status: 'applied' })
    const undone = await host.internalAPI.read(initial.documentId)
    if (undone.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(undone.model.project.instances).toEqual(initial.model.project.instances)
    expect(undone.model.project.assets).toEqual(initial.model.project.assets)
    expect(undone.model.resources).toEqual(initial.model.resources)
    const reopened = await new DocumentHostService(path.join(root, 'cold')).open(saved)
    expect(reopened.model).toEqual(inserted.model)
    await host.tools.stop('writer')
    await expect(host.tools.readOpenImagePreview('writer', previewed.previews[0].resourceId)).rejects.toThrow('任务已停止')
    await imageOwner.releaseRunJobs(['reader', 'writer'])
    await host.tools.beginRun({ runId: 'next', actor: 'agent', documents: [], fileAccess: { permission: 'read-only', workspaceRoot: root } })
    expect(data(await call('next', 'preview-existing', 'image.preview', { images: [fetched.resource] })))
      .toMatchObject({ status: 'prepared', previews: [{ resourceId: fetched.resource }] })
    await host.tools.beginRun({ runId: 'other', actor: 'agent', documents: [], fileAccess: { permission: 'full', workspaceRoot: path.join(root, 'other') } })
    expect(data(await call('other', 'preview-foreign', 'image.preview', { images: [fetched.resource] })))
      .toMatchObject({ status: 'failed', failures: [{ reason: expect.stringContaining('不属于当前工作空间') }] })
    expect(getBytes).toHaveBeenCalledTimes(2)
    expect(search).toHaveBeenCalledTimes(2)
  } finally { await host.tools.stop('reader'); await fs.rm(root, { recursive: true, force: true }) }
})
