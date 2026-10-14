// @vitest-environment node
import { expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { WebResearchService } from '../../src/main/workbench/network/WebResearchService'
import { OpenImageService } from '../../src/main/workbench/assetSources/OpenImageService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { assetSourceSchemas } from '../../src/core/tools/AssetSourceTools'
import { extractHtml } from '../../src/main/workbench/network/extractHtml'
import { webImageLicense } from '../../src/main/workbench/assetSources/licensePolicy'
import type { ToolResult } from '../../src/shared/workbench/tools'

const pageUrl = 'https://museum.example/article'
const licensedUrl = 'https://museum.example/photo.png'
const unknownUrl = 'https://museum.example/unknown.png'
const html = `<html><head><title>Museum source</title><meta property="article:published_time" content="2026-10-12">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ImageObject',
    contentUrl: licensedUrl, name: 'Licensed exhibit', creator: { name: 'Museum author' }, caption: 'Image-specific caption',
    license: 'https://creativecommons.org/licenses/by/4.0/', dateCreated: '2024-02-01', width: 800, height: 600 })}</script>
  </head><body><main><h1>Exhibit article</h1><p>A source page about an exhibit.</p>
  <figure><img src="/photo.png" alt="Exhibit"></figure><figure><img src="/unknown.png" alt="Unknown rights"></figure>
  </main><footer><a rel="license" href="https://creativecommons.org/licenses/by/4.0/">Page text license</a></footer></body></html>`
const readData = (result: ToolResult): any => { if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return result.data }

it('uses search -> opened page -> allowed image candidate -> preview -> formal insertion -> Main save and cold open', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-r07-web-images-'))
  const bytes = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: '#397256' } }).png().toBuffer())
  let pagesRead = 0, imageDownloads = 0
  const web = new WebResearchService({ temporaryRoot: folder,
    searchProvider: { search: async () => ({ provider: 'source-fixture', results: [{ title: 'Museum source', url: pageUrl, snippet: 'Exhibit' }] }) },
    fetch: async url => { expect(url).toBe(pageUrl); pagesRead++
      return { url, status: 200, contentType: 'text/html', bytes: new TextEncoder().encode(html) } },
  })
  const openImages = new OpenImageService({ libraries: [],
    pageSource: ({ runId, source, signal }) => web.open({ runId, ...(source.startsWith('https://') ? { url: source } : { sourceId: source }), signal }),
    http: { getJson: async () => { throw new Error('No library JSON in source-page fixture') },
      getBytes: async url => { expect(url).toBe(licensedUrl); imageDownloads++; return { url, contentType: 'image/png', bytes } } },
  })
  const imageOwner = new ImageGenerationService({ directory: path.join(folder, 'images'), provider: { generate: async () => { throw new Error('Web originals must not call a generator') } } })
  const host = new DocumentHostService(path.join(folder, 'documents'))
  host.tools.configureHostServices({ web: { search: input => web.search(input), open: input => web.open(input) }, openImages,
    beginRun: async grant => { web.beginRun(grant.runId); openImages.beginRun(grant.runId) },
    stopRun: async runId => { openImages.stopRun(runId); await web.stopRun(runId) },
    images: { selection: () => { throw new Error('No model selection for originals') }, run: imageOwner.run.bind(imageOwner), read: imageOwner.read.bind(imageOwner),
      stop: imageOwner.stop.bind(imageOwner), readResource: imageOwner.readResource.bind(imageOwner),
      registerWorkspaceResource: imageOwner.registerWorkspaceResource.bind(imageOwner), readWorkspaceResource: imageOwner.readWorkspaceResource.bind(imageOwner) },
  })
  const created = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Originals'), resources: { assets: {}, components: {} } }, 'Originals')
  const call = (id: string, name: string, input: unknown) => host.tools.execute('run', id, { name, input })
  try {
    await host.tools.beginRun({ runId: 'run', actor: 'agent', documents: [{ documentId: created.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: folder } })
    const search = readData(await call('find', 'web.search', { query: 'exhibit original' }))
    const opened = readData(await call('open', 'web.open', { url: search.results[0].url }))
    expect(opened.source.publishedAt).toBe('2026-10-12')
    expect(opened.images).toEqual(expect.arrayContaining([expect.objectContaining({ fileUrl: licensedUrl, dateCreated: '2024-02-01' }),
      expect.objectContaining({ fileUrl: unknownUrl })]))
    const found = readData(await call('images', 'image.search', { source: opened.source.sourceId }))
    expect(found).toMatchObject({ status: 'results', excluded: 1, candidates: [{ image: 'img1', title: 'Licensed exhibit',
      author: 'Museum author', pageUrl, source: 'museum.example', license: 'CC BY 4.0', dateCreated: '2024-02-01', description: 'Image-specific caption' }],
      excludedCandidates: [{ title: 'Unknown rights', pageUrl, license: '未知' }] })
    expect(pagesRead).toBe(1)
    expect(imageDownloads).toBe(0)
    expect(readData(await call('unlicensed', 'image.fetch', { image: 'img2' }))).toMatchObject({ status: 'rejected' })
    const preview = readData(await call('preview', 'image.preview', { images: ['img1'] }))
    expect(preview).toMatchObject({ status: 'prepared', previews: [{ image: 'img1', width: 480, height: 360 }] })
    const fetched = readData(await call('fetch', 'image.fetch', { image: 'img1' }))
    expect(fetched).toMatchObject({ status: 'ready', source: { kind: 'open-library', url: pageUrl, author: 'Museum author', license: { id: 'CC BY 4.0' } } })
    expect(imageDownloads).toBe(2)
    if (created.model.kind !== 'course-v10') throw new Error('V10 required')
    const target = await host.tools.issueTarget('run', created.documentId, { kind: 'course-surface', surfaceId: created.model.project.surfaces[0].id })
    await host.tools.loadToolFamilies('run', ['media'])
    expect(await call('insert', 'media.insert', { target, resource: fetched.resource })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const saved = path.join(folder, 'originals.glx')
    await host.internalAPI.save(created.documentId, saved)
    const cold = await new DocumentHostService(path.join(folder, 'cold')).internalAPI.open(saved)
    if (cold.model.kind !== 'course-v10') throw new Error('V10 required')
    const asset = Object.values(cold.model.project.assets)[0]
    expect(asset.source).toMatchObject({ url: pageUrl, title: 'Licensed exhibit', author: 'Museum author', license: { id: 'CC BY 4.0' } })
    expect(await sharp(cold.model.resources.assets[asset.id]).metadata()).toMatchObject({ width: 800, height: 600, format: 'png' })
  } finally {
    await host.tools.stop('run')
    const cleanup = path.resolve(folder)
    if (path.dirname(cleanup) !== path.resolve(os.tmpdir()) || !path.basename(cleanup).startsWith('guoling-r07-web-images-'))
      throw new Error('Unexpected test cleanup directory')
    await fs.rm(cleanup, { recursive: true, force: true })
  }
})

it('keeps license-unknown and policy-excluded sources visible and distinguishes an unavailable reader from no candidates', async () => {
  const http = { getJson: async () => ({}), getBytes: async () => { throw new Error('Excluded pictures must not be downloaded') } }
  const absent = new OpenImageService({ http, libraries: [] }); absent.beginRun('run')
  expect(await absent.search({ runId: 'run', source: pageUrl })).toMatchObject({ status: 'not-configured' })
  const extracted = extractHtml('<title>Figure</title><main><figure><img src="/diagram.svg" alt="Existing diagram"><figcaption>Diagram caption <a rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a></figcaption></figure></main>', pageUrl)
  expect(extracted.images?.[0]).toMatchObject({ title: 'Existing diagram', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' })
  expect(webImageLicense(extracted.images![0].licenseUrl, { allowShareAlike: false })).toBeNull()
  expect(webImageLicense(extracted.images![0].licenseUrl, { allowShareAlike: true })?.code).toBe('by-sa')
  expect(webImageLicense('https://creativecommons.org/licenses/by-nc/4.0/', { allowShareAlike: true })).toBeNull()
  expect(webImageLicense(undefined, { allowShareAlike: true })).toBeNull()
  expect(assetSourceSchemas['image.search'].safeParse({ source: pageUrl }).success).toBe(true)
  expect(assetSourceSchemas['image.search'].safeParse({ query: 'a', source: pageUrl }).success).toBe(false)
  expect(assetSourceSchemas['image.search'].safeParse({}).success).toBe(false)
})
