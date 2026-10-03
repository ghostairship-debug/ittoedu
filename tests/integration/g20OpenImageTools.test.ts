// @vitest-environment node
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { OpenImageService } from '../../src/main/workbench/assetSources/OpenImageService'
import type { AssetHttpPort, OpenImageCandidate } from '../../src/main/workbench/assetSources/assetSourceTypes'
import { openverseLicense } from '../../src/main/workbench/assetSources/licensePolicy'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
const driver = new CourseV9Driver()
const fixture = () => driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as CourseModel
const blank = (): CourseModel => ({ kind: 'course-v9', project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
  resources: { assets: {}, components: {} } })
const data = (result: ToolResult): any => { if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data }
const photo: OpenImageCandidate = { library: 'openverse', providerId: 'flickr-1', title: 'Autumn maple leaves', author: 'Jane Doe',
  license: openverseLicense('by', '2.0', 'https://creativecommons.org/licenses/by/2.0/', { allowShareAlike: false })!,
  sourceName: 'Flickr', pageUrl: 'https://www.flickr.com/photos/1/2', fileUrl: 'https://live.staticflickr.com/1/2_b.jpg',
  previewUrl: 'https://api.openverse.org/v1/images/flickr-1/thumb/', width: 1024, height: 768 }
const jpeg = (background: string) => sharp({ create: { width: 1024, height: 768, channels: 3, background } }).jpeg().toBuffer().then(buffer => new Uint8Array(buffer))

async function harness(model: CourseModel = fixture()) {
  // Previews always get the first picture; each download of the file gets the next one.
  const downloads = [await jpeg('#c86428'), await jpeg('#2864c8')]
  let served = 0
  const http: AssetHttpPort = { getJson: async () => ({}), getBytes: vi.fn(async (url: string) => ({ url, contentType: 'image/jpeg',
    bytes: url === photo.previewUrl ? downloads[0]! : downloads[Math.min(served++, downloads.length - 1)]! })) }
  const openImages = new OpenImageService({ http, libraries: [['openverse', async () => ({ library: 'openverse', candidates: [photo], excluded: 0, hasMore: false })]] })
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('Not requested') } } })
  const gateway = new DocumentToolGateway(registry, [driver], () => `${++id}`, { prepareImage: prepareImageResource, services: {
    beginRun: async grant => openImages.beginRun(grant.runId), stopRun: runId => openImages.stopRun(runId),
    projectFiles: { parsePage: parseWebComposition },
    openImages: { search: input => openImages.search(input), preview: input => openImages.preview(input),
      readPreview: (runId, resourceId) => openImages.readPreview(runId, resourceId), fetch: input => openImages.fetch(input) },
    assetLibrary: { search: async input => ({ status: 'results', query: input.query, candidates: [], libraryComponents: 4 }) } } })
  const session = await registry.create(model, '秋天.h5lesson')
  const begin = async (runId: string, permission: 'workspace' | 'read-only') =>
    gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: permission === 'read-only' ? [] : [{ kind: 'document' }] }],
      fileAccess: { permission, workspaceRoot: 'D:/open-image-fixture' } })
  const call = (runId: string, callId: string, name: string, input: unknown) => gateway.execute(runId, callId, { name, input })
  const project = () => (session.read().model as CourseModel).project
  return { gateway, session, downloads, begin, call, project }
}

it('searches, previews and fetches an open-license photo as a run resource for the existing media path', async () => {
  const h = await harness()
  await h.begin('run', 'workspace')
  const names = (await h.gateway.describeRun('run')).map(tool => tool.name)
  expect(names).toEqual(expect.arrayContaining(['image.search', 'image.preview', 'image.fetch', 'asset.search']))
  const found = data(await h.call('run', 'search', 'image.search', { query: 'autumn maple leaves' }))
  expect(found).toMatchObject({ status: 'results', candidates: [{ image: 'img1', title: 'Autumn maple leaves', license: 'CC BY 2.0', source: 'Flickr' }] })
  const previewed = data(await h.call('run', 'preview', 'image.preview', { images: ['img1'] }))
  expect(previewed).toMatchObject({ status: 'prepared', previews: [{ image: 'img1', mimeType: 'image/jpeg', width: 480, height: 360 }] })
  expect(h.gateway.readOpenImagePreview('run', previewed.previews[0].resourceId).bytes.byteLength).toBe(previewed.previews[0].byteLength)

  // Without a path the download is only a run resource; the course is unchanged until a media tool uses it.
  const fetched = data(await h.call('run', 'fetch', 'image.fetch', { image: 'img1' }))
  expect(fetched).toMatchObject({ status: 'ready', resource: expect.stringMatching(/^r/), mimeType: 'image/jpeg', width: 1024, height: 768,
    source: { kind: 'open-library', title: 'Autumn maple leaves', author: 'Jane Doe', url: 'https://www.flickr.com/photos/1/2',
      license: { id: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/' },
      attribution: '“Autumn maple leaves”，作者：Jane Doe，来源：Flickr（https://www.flickr.com/photos/1/2），授权：CC BY 2.0（https://creativecommons.org/licenses/by/2.0/）' } })
  expect(h.session.read().undoDepth).toBe(0)
  const location = h.project().locations.find(item => item.kind === 'slide-scene')!
  const owner = await h.gateway.issueTarget('run', h.session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
  // The model loads the media family before inserting; open-library tools themselves are always visible.
  await h.gateway.loadToolFamilies('run', ['media'])
  expect(await h.call('run', 'insert', 'media.insert', { target: owner, resource: fetched.resource, properties: {} }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(Object.values(h.session.read().model.resources.assets).some(bytes => Buffer.from(bytes).equals(Buffer.from(h.downloads[0]!)))).toBe(true)
})

it('writes the download to the asset path a page waits for, with its source, and replaces it only after a read', async () => {
  const h = await harness(blank())
  await h.begin('run', 'workspace')
  expect(await h.call('run', 'page', 'project.write', { path: 'slides/01-秋天.html',
    content: '<!doctype html><html><body><h1>秋天</h1><img src="../assets/秋叶.jpg" alt="秋天的枫叶"></body></html>' }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const pending = async () => data(await h.call('run', `list-${Math.random()}`, 'project.list', {})).files
    .filter((file: { type: string }) => file.type === '待填素材').map((file: { path: string }) => file.path)
  expect(await pending()).toEqual(['assets/秋叶.jpg'])
  data(await h.call('run', 'search', 'image.search', { query: 'maple' }))

  const written = await h.call('run', 'fetch-1', 'image.fetch', { image: 'img1', path: '../assets/秋叶.jpg' })
  expect(written).toMatchObject({ kind: 'document-operation', result: { status: 'applied' }, affected: ['assets/秋叶.jpg'] })
  expect(written).not.toHaveProperty('advisories')
  expect(await pending()).toEqual([])
  const [asset, ...others] = Object.values(h.project().assets)
  expect(others).toEqual([])
  expect(asset).toMatchObject({ path: 'assets/秋叶.jpg', filename: '秋叶.jpg', mimeType: 'image/jpeg', width: 1024, height: 768,
    source: { kind: 'open-library', title: 'Autumn maple leaves', license: { id: 'CC BY 2.0' }, attribution: expect.stringContaining('作者：Jane Doe') } })
  const slide = h.project().surfaces.find(surface => surface.type === 'slide')!
  const page = slide.type === 'slide' ? slide.scenes[0]!.layerItems[0]! : undefined
  expect(page?.kind === 'composition' && page.content.assets['assets/秋叶.jpg']).toEqual({ assetId: asset!.id })
  expect(h.session.read().undoDepth).toBe(2)

  // Replacing follows the project-file rule: a run that did not write or read the asset must read it first.
  await h.gateway.stop('run')
  await h.begin('next', 'workspace')
  data(await h.call('next', 'search', 'image.search', { query: 'maple' }))
  expect(await h.call('next', 'fetch-2', 'image.fetch', { image: 'img1', path: 'assets/秋叶.jpg' })).toMatchObject({ kind: 'error', code: 'read-required' })
  data(await h.call('next', 'read-asset', 'project.read', { path: 'assets/秋叶.jpg' }))
  const replaced = await h.call('next', 'fetch-3', 'image.fetch', { image: 'img1', path: 'assets/秋叶.jpg' })
  expect(replaced).toMatchObject({ kind: 'document-operation', result: { status: 'applied' }, affected: ['assets/秋叶.jpg'],
    advisories: [{ message: expect.stringContaining('已替换原素材') }] })
  expect(Object.keys(h.project().assets)).toEqual([asset!.id])
  expect(Buffer.from(h.session.read().model.resources.assets[asset!.id]!).equals(Buffer.from(h.downloads[1]!))).toBe(true)

  // The file extension decides the stored format.
  expect(await h.call('next', 'fetch-png', 'image.fetch', { image: 'img1', path: 'assets/枫叶.png' })).toMatchObject({ kind: 'document-operation' })
  expect(Object.values(h.project().assets).find(meta => meta.path === 'assets/枫叶.png')).toMatchObject({ mimeType: 'image/png' })
  for (const path of ['slides/x.jpg', 'assets/动画.gif', 'assets/'])
    expect(await h.call('next', `bad-${path}`, 'image.fetch', { image: 'img1', path })).toMatchObject({ kind: 'error', code: 'invalid-path' })
})

it('keeps candidates per run and refuses downloads without a writable course', async () => {
  const h = await harness()
  await h.begin('reader', 'read-only')
  expect(data(await h.call('reader', 'search', 'image.search', { query: 'maple' }))).toMatchObject({ status: 'results' })
  expect(data(await h.call('reader', 'assets', 'asset.search', { query: '公转' })))
    .toEqual({ status: 'results', query: '公转', candidates: [], libraryComponents: 4 })
  expect(await h.call('reader', 'fetch', 'image.fetch', { image: 'img1' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await h.call('reader', 'fetch-path', 'image.fetch', { image: 'img1', path: 'assets/x.jpg' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  await h.begin('writer', 'workspace')
  expect(data(await h.call('writer', 'fetch', 'image.fetch', { image: 'img1' })))
    .toMatchObject({ status: 'rejected', reason: expect.stringContaining('image.search') })
})
