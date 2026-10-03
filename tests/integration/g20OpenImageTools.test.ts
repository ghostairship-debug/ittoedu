// @vitest-environment node
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { OpenImageService } from '../../src/main/workbench/assetSources/OpenImageService'
import type { AssetHttpPort, OpenImageCandidate } from '../../src/main/workbench/assetSources/assetSourceTypes'
import { openverseLicense } from '../../src/main/workbench/assetSources/licensePolicy'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

const driver = new CourseV9Driver()
const fixture = () => driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
const data = (result: ToolResult): any => { if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data }
const photo: OpenImageCandidate = { library: 'openverse', providerId: 'flickr-1', title: 'Autumn maple leaves', author: 'Jane Doe',
  license: openverseLicense('by', '2.0', 'https://creativecommons.org/licenses/by/2.0/', { allowShareAlike: false })!,
  sourceName: 'Flickr', pageUrl: 'https://www.flickr.com/photos/1/2', fileUrl: 'https://live.staticflickr.com/1/2_b.jpg',
  previewUrl: 'https://api.openverse.org/v1/images/flickr-1/thumb/', width: 1024, height: 768 }

async function harness() {
  const jpeg = new Uint8Array(await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#c86428' } }).jpeg().toBuffer())
  const http: AssetHttpPort = { getJson: async () => ({}), getBytes: vi.fn(async (url: string) => ({ url, contentType: 'image/jpeg', bytes: jpeg })) }
  const openImages = new OpenImageService({ http, libraries: [['openverse', async () => ({ library: 'openverse', candidates: [photo], excluded: 0, hasMore: false })]] })
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('Not requested') } } })
  const gateway = new DocumentToolGateway(registry, [driver], () => `${++id}`, { prepareImage: prepareImageResource, services: {
    beginRun: async grant => openImages.beginRun(grant.runId), stopRun: runId => openImages.stopRun(runId),
    openImages: { search: input => openImages.search(input), preview: input => openImages.preview(input),
      readPreview: (runId, resourceId) => openImages.readPreview(runId, resourceId), fetch: input => openImages.fetch(input) },
    assetLibrary: { search: async input => ({ status: 'results', query: input.query, candidates: [], libraryComponents: 4 }) } } })
  const baseline = fixture(), session = await registry.create(baseline, 'open-images.h5lesson')
  const begin = async (runId: string, permission: 'workspace' | 'read-only') => {
    await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: permission === 'read-only' ? [] : [{ kind: 'document' }] }],
      fileAccess: { permission, workspaceRoot: 'D:/open-image-fixture' } })
    return gateway.issueTarget(runId, session.documentId, { kind: 'document' })
  }
  return { gateway, session, baseline, jpeg, begin }
}

it('searches, previews and fetches an open-license photo into the existing image resource and media path', async () => {
  const h = await harness()
  const document = await h.begin('run', 'workspace')
  const names = (await h.gateway.describeRun('run')).map(tool => tool.name)
  expect(names).toEqual(expect.arrayContaining(['image.search', 'image.preview', 'image.fetch']))
  const found = data(await h.gateway.execute('run', 'search', { name: 'image.search', input: { query: 'autumn maple leaves' } }))
  expect(found).toMatchObject({ status: 'results', candidates: [{ image: 'img1', title: 'Autumn maple leaves', license: 'CC BY 2.0', source: 'Flickr' }] })
  const previewed = data(await h.gateway.execute('run', 'preview', { name: 'image.preview', input: { images: ['img1'] } }))
  expect(previewed).toMatchObject({ status: 'prepared', previews: [{ image: 'img1', mimeType: 'image/jpeg', width: 480, height: 360 }] })
  expect(h.gateway.readOpenImagePreview('run', previewed.previews[0].resourceId).bytes.byteLength).toBe(previewed.previews[0].byteLength)

  const fetched = data(await h.gateway.execute('run', 'fetch', { name: 'image.fetch', input: { image: 'img1', target: document } }))
  expect(fetched).toMatchObject({ status: 'ready', resource: expect.stringMatching(/^r/), mimeType: 'image/jpeg', width: 1024, height: 768,
    source: { kind: 'open-library', title: 'Autumn maple leaves', author: 'Jane Doe', url: 'https://www.flickr.com/photos/1/2',
      license: { id: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/' },
      attribution: '“Autumn maple leaves”，作者：Jane Doe，来源：Flickr（https://www.flickr.com/photos/1/2），授权：CC BY 2.0（https://creativecommons.org/licenses/by/2.0/）' } })
  expect(h.session.read().undoDepth).toBe(0)
  const location = h.baseline.project.locations.find(item => item.kind === 'slide-scene')!
  const owner = await h.gateway.issueTarget('run', h.session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
  // The model loads the media family before inserting; open-library tools themselves are always visible.
  await h.gateway.loadToolFamilies('run', ['media'])
  expect(await h.gateway.execute('run', 'insert', { name: 'media.insert', input: { target: owner, resource: fetched.resource, properties: {} } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const assets = Object.values(h.session.read().model.resources.assets)
  expect(assets.some(bytes => Buffer.from(bytes).equals(Buffer.from(h.jpeg)))).toBe(true)
})

it('keeps candidates per run and refuses downloads in a read-only run', async () => {
  const h = await harness()
  const target = await h.begin('reader', 'read-only')
  expect(data(await h.gateway.execute('reader', 'search', { name: 'image.search', input: { query: 'maple' } }))).toMatchObject({ status: 'results' })
  expect(data(await h.gateway.execute('reader', 'assets', { name: 'asset.search', input: { query: '公转' } })))
    .toEqual({ status: 'results', query: '公转', candidates: [], libraryComponents: 4 })
  expect(await h.gateway.execute('reader', 'fetch', { name: 'image.fetch', input: { image: 'img1', target } }))
    .toMatchObject({ kind: 'error', message: expect.stringContaining('只读') })
  const writer = await h.begin('writer', 'workspace')
  expect(data(await h.gateway.execute('writer', 'fetch', { name: 'image.fetch', input: { image: 'img1', target: writer } })))
    .toMatchObject({ status: 'rejected', reason: expect.stringContaining('image.search') })
})
