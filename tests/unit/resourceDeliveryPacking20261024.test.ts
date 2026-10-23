// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { JSDOM, VirtualConsole } from 'jsdom'
import { unzipSync, strFromU8 } from 'fflate'
import { restoreSerializedResourcePool, serializeResourcePool } from '../../src/shared/serializedResourcePool'
import { buildComponentSingleHtml, buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'
import type { PublishedCourseV4 } from '../../src/shared/contracts/component-platform/published'
import { componentAssetDataUrl } from '../../src/core/publish/componentPlatform/resourceUrl'
import { projectCompiledHtmlPreviewAssets } from '../../src/main/workbench/htmlPreview/compiledHtmlPreviewAssets'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createImageData } from '../../src/components/image/data'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { buildComponentWebPackage } from '../../src/renderer/export/componentPlatform/buildHtml'
import { setRootContainers } from '../helpers/glxWorkFixture'
import * as imageEncoding from '../../src/renderer/export/componentPlatform/encodeDeliveryImage'

const fixture = vi.hoisted(() => ({ media: '', source: '' }))
vi.mock('../../src/renderer/export/loadCompiledPlayerBundle', () => ({ loadCompiledPlayerBundle: () => 'var CoursewareCompiledPlayer={mountCompiledCourse:function(course,root,options){window.received={course:course,options:options};return {dispose:function(){}}}};' }))
vi.mock('../../src/core/publish/componentPlatform/compileCoursePlayback', () => ({ compileCoursePlayback: async (course: PublishedCourseV4) => ({
  title: course.title, format: 'compiled-course-v2', id: course.id, course, html: `<div><img src="${fixture.media}"><style>.photo{background:url('${fixture.media}')}</style><script>var untouched=${JSON.stringify(fixture.media)}</script></div>`,
  staticViews: { image: [{ signature: 'view', html: `<img src=${fixture.media}>` }] }, sourceStyles: { custom: `.photo{background:url('${fixture.media}')}` },
  webPrograms: {}, sourceFactories: { custom: fixture.source }, builtinFactories: {}, staticKeys: [], diagnostics: [],
}) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); fixture.media = ''; fixture.source = '' })

const runtime = 'var CoursewareCompiledPlayer={mountCompiledCourse:function(course){window.received=course;return {}}};var CoursewarePlayer={mountPublishedCourseV4:CoursewareCompiledPlayer.mountCompiledCourse};'
const artifact = (extra: Record<string, unknown> = {}) => ({ format: 'compiled-course-v2', title: 'Packed <resource>', course: { assets: {} }, ...extra }) as unknown as CompiledCoursePlayback
const body = (dom: JSDOM, id: string) => JSON.parse(dom.window.document.getElementById(id)!.textContent!)

it('stores one base64 body across IDs, MIME labels and nested source while restoring every original string exactly', async () => {
  const bytes = Uint8Array.from({ length: 49157 }, (_, index) => index * 17 % 256)
  const image = componentAssetDataUrl(bytes, 'image/webp'), font = componentAssetDataUrl(bytes, 'font/woff2')
  expect(image).toBe(`data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`)
  const input = artifact({ course: { assets: { a: { url: image }, b: { url: image }, font: { url: font } } }, nativeSources: { source: `const marker='~0~';const image=${JSON.stringify(image)};const closing='</script><script>window.attack=true</script>';` } })
  const packed = serializeResourcePool(input)
  expect(packed.pool!.content).toEqual([Buffer.from(bytes).toString('base64')])
  expect(restoreSerializedResourcePool(structuredClone(packed.data), packed.pool)).toEqual(input)
  for (const html of [buildCompiledSingleHtml(input, runtime), buildComponentSingleHtml(input as unknown as PublishedCourseV4, runtime)]) {
    expect(html.split(Buffer.from(bytes).toString('base64'))).toHaveLength(2)
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    await (dom.window as any).coursePlayerReady
    expect((dom.window as any).received).toEqual(input)
    expect((dom.window as any).attack).toBeUndefined()
    expect((dom.window.document.getElementById('course-data') as any).__courseDecodedPayload).toBe((dom.window as any).received)
    // Bootstrap retains the single serialized DOM carrier instead of making a
    // second giant JSON copy merely for the HTML author's alias reader.
    expect(body(dom, 'course-data')).toEqual(packed.data)
    dom.window.close()
  }
})

it('keeps malformed transport and script failures visible through the existing diagnostic bootstrap', async () => {
  const uri = componentAssetDataUrl(new Uint8Array([1, 2, 3]), 'image/png')
  for (const html of [
    buildCompiledSingleHtml(artifact({ html: uri, more: uri }), runtime).replace('"insertions":[[', '"insertions":[[999999,'),
    buildCompiledSingleHtml(artifact(), 'const =;'),
  ]) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: new VirtualConsole() })
    await expect((dom.window as any).coursePlayerReady).rejects.toBeDefined()
    expect(dom.window.document.getElementById('course-diagnostic')!.hidden).toBe(false)
    expect(dom.window.document.getElementById('course-diagnostic')!.textContent).toContain('课件加载失败')
    dom.window.close()
  }
})

it('projects packed compiled-v2 preview assets through the same decoder and removes stale transport offsets', async () => {
  const uri = componentAssetDataUrl(new Uint8Array([9, 7, 5, 3]), 'image/webp')
  const original = artifact({ course: { assets: { a: { url: uri }, b: { url: uri } } }, html: `<img src="${uri}">` })
  const html = buildCompiledSingleHtml(original, runtime)
  const projected = projectCompiledHtmlPreviewAssets(html, id => `courseware-preview://lease/token/_asset/${id}`)
  expect(projected.assets.size).toBe(1)
  expect(projected.source).not.toContain('id="course-resource-pool"')
  const dom = new JSDOM(projected.source, { runScripts: 'dangerously' })
  await (dom.window as any).coursePlayerReady
  expect((dom.window as any).received.course.assets.a.url).toBe('courseware-preview://lease/token/_asset/a')
  expect((dom.window as any).received.course.assets.b.url).toBe((dom.window as any).received.course.assets.a.url)
  expect((dom.window as any).received.html).toBe(original.html)
  expect(projected.assets.get('a')!.bytes).toEqual(new Uint8Array([9, 7, 5, 3]))
  dom.window.close()
})

it('writes shared Web binaries once, externalizes passive compiled media, and loads fallback only for file://', async () => {
  const project = createBlankCourseProjectV10('Web resource packing'), bytes = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3])
  project.global = { underlay: [], overlay: [] }; project.instances = {}; project.definitions = { image: { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } } }
  setRootContainers(project, [{ id: 'page', title: 'Page', kind: 'slide', childIds: ['one', 'two'], designSize: { width: 800, height: 600 } }])
  for (const id of ['one', 'two']) {
    project.assets[id] = { id, path: `assets/${id}.gif`, filename: `${id}.gif`, mimeType: 'image/gif' }
    project.instances[id] = { id, definitionId: 'image', data: JSON.parse(JSON.stringify(createImageData(id))), frame: { width: 100, height: 80, transform: [1, 0, 0, 1, 0, 0] } }
  }
  const snapshot: DocumentSnapshot = { documentId: 'export', epoch: 'epoch', revision: 0, model: { kind: 'course-v10', project, resources: { assets: { one: bytes, two: bytes.slice() }, components: {} } }, binding: { kind: 'untitled', suggestedName: 'Web' }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const dom = new JSDOM('<!doctype html><body></body>')
  vi.stubGlobal('document', dom.window.document)
  fixture.media = componentAssetDataUrl(bytes, 'image/gif'); fixture.source = `function(){return ${JSON.stringify(fixture.media)}}`
  const encodeDemands: unknown[] = [], begin = imageEncoding.beginDeliveryImageEncoding
  vi.spyOn(imageEncoding, 'beginDeliveryImageEncoding').mockImplementation((...args) => {
    const job = begin(...args)
    return { ...job, encode: (...input) => { encodeDemands.push(input[3]); return job.encode(...input) } }
  })
  const originalDemand = { width: 400, height: 300, dpr: 2, quality: 'original' as const }
  const result = await buildComponentWebPackage(snapshot, async () => { throw new Error('No authored compilation needed') }, undefined, undefined, { one: originalDemand })
  expect(encodeDemands).toContainEqual(originalDemand)
  const files = unzipSync(result.bytes), html = strFromU8(files['index.html']!), fallback = strFromU8(files['course-assets.js']!)
  expect(Object.keys(files).filter(path => path.startsWith('assets/'))).toHaveLength(1)
  expect(fallback.split(Buffer.from(bytes).toString('base64'))).toHaveLength(2)
  const requests: string[] = []
  for (const url of ['https://course.example/index.html', 'file:///offline/index.html']) {
    const page = new JSDOM(html, { url, runScripts: 'dangerously', virtualConsole: new VirtualConsole(), beforeParse(window) {
      const append = window.HTMLHeadElement.prototype.appendChild
      window.HTMLHeadElement.prototype.appendChild = function<T extends Node>(node: T): T {
        if ((node as unknown as HTMLScriptElement).tagName === 'SCRIPT') {
          requests.push((node as unknown as HTMLScriptElement).src)
          window.eval(fallback)
          queueMicrotask(() => node.dispatchEvent(new window.Event('load')))
          return node
        }
        return append.call(this, node) as T
      }
    } })
    await (page.window as any).coursePlayerReady
    const received = (page.window as any).received
    expect(received.course.course.assets.one.url).toBe(received.course.course.assets.two.url)
    expect(received.course.html).toContain('cw-delivery:')
    expect(received.course.staticViews.image[0].html).not.toContain('data:image')
    expect(received.course.html).toContain(`<script>var untouched=${JSON.stringify(fixture.media)}</script>`)
    expect(received.course.sourceFactories.custom).toBe(fixture.source)
    if (url.startsWith('https:')) {
      expect(requests).toEqual([]); expect(received.options.preparedAssetBytes).toBeUndefined()
      const [first, second] = await Promise.all([received.options.prepareAssetBytes(), received.options.prepareAssetBytes()])
      expect(first).toBe(second)
      expect(requests.filter(url => url.endsWith('/course-assets.js'))).toHaveLength(1)
      expect([...first.one]).toEqual([...bytes]); expect(first.one).toBe(first.two)
    }
    else {
      const decode = vi.spyOn(page.window, 'atob'), prepared = received.options.preparedAssetBytes
      expect(decode).not.toHaveBeenCalled()
      expect([...prepared.one]).toEqual([...bytes]); expect(prepared.one).toBe(prepared.two)
      expect(decode).toHaveBeenCalledTimes(1)
    }
    page.window.close()
  }
  expect(project.assets.one.path).toBe('assets/one.gif')
  expect(project.instances.one.data).toEqual(JSON.parse(JSON.stringify(createImageData('one'))))
  dom.window.close()
})
