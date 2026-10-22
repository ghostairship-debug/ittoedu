// @vitest-environment node
import { setRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { HTML_PROGRAM_DEFINITION, WEB_DEFINITION } from '../../src/components/web/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles, type ComponentProjectFile } from '../../src/core/projectFiles/componentPlatform'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import type { ComponentFrame, ComponentInstance } from '../../src/shared/contracts/component-platform'
import type { DocumentModel, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'

// Only geometry is replaced. Source preparation, media admission, Gateway, CAS and saving are real.
vi.mock('../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement', async () => {
  const { sourceProgramAssembly } = await import('../../src/core/contentApply/assembly/htmlAssembly')
  return { measureHtmlAtDesignViewport: async (request: HtmlDesignMeasurementRequest) =>
    sourceProgramAssembly(request.viewport, { html: request.html }, 'fixture-retained-program') }
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const encode = (value: string) => new TextEncoder().encode(value)
const frame = (x = 0): ComponentFrame => ({ width: 300, height: 220, transform: [1, 0, 0, 1, x, 0] })

function wavFixture() {
  const bytes = Buffer.alloc(44 + 160)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(16_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(160, 40)
  return new Uint8Array(bytes)
}

function seed() {
  const project = createBlankCourseProjectV10('工程源码素材接力')
  project.definitions = {}; project.instances = {}; project.global = { underlay: [], overlay: [] }
  for (const definition of [WEB_DEFINITION, HTML_PROGRAM_DEFINITION, IMAGE_DEFINITION])
    project.definitions[definition.id] = structuredClone(definition)
  setRootContainers(project, [{ id: 'original-page', kind: 'slide', title: '原内容', childIds: [], designSize: { width: 800, height: 600 } },
    { id: 'copy-page', kind: 'slide', title: '源码副本', childIds: [], designSize: { width: 800, height: 600 } }])
  const assets = { 'audio-a': wavFixture(),
    'photo-a': encode('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="red"/></svg>'),
    'photo-b': encode('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="blue"/></svg>') }
  project.assets = {
    'audio-a': { id: 'audio-a', path: 'assets/audio-a.wav', filename: 'audio-a.wav', kind: 'audio', mimeType: 'audio/wav', byteLength: assets['audio-a'].byteLength },
    'photo-a': { id: 'photo-a', path: 'assets/photo-a.svg', filename: 'photo-a.svg', kind: 'image', mimeType: 'image/svg+xml', byteLength: assets['photo-a'].byteLength, width: 30, height: 20 },
    'photo-b': { id: 'photo-b', path: 'assets/photo-b.svg', filename: 'photo-b.svg', kind: 'image', mimeType: 'image/svg+xml', byteLength: assets['photo-b'].byteLength, width: 30, height: 20 },
  }
  const model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', project, resources: { assets, components: {} } }
  return model
}

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10 fixture')
  return snapshot.model
}
function instanceFile(files: ComponentProjectFile[], instanceId: string) {
  const file = files.find(value => value.kind === 'html' && value.target?.kind === 'instance' && value.target.instanceId === instanceId)
  if (!file) throw new Error(`Missing HTML source for ${instanceId}`)
  return file
}
function boundAsset(instance: ComponentInstance, selector: string, attribute = 'src') {
  const data = instance.data as { html: string; resourceBindings?: Record<string, string> }
  const dom = new JSDOM(data.html)
  try {
    const reference = dom.window.document.querySelector(selector)?.getAttribute(attribute)
    if (!reference) throw new Error(`Missing ${selector}.${attribute}`)
    return data.resourceBindings?.[reference] ?? reference.replace(/^cw-resource:/, '')
  } finally { dom.window.close() }
}
const resourceDiagnostic = (result: ContentApplyResult) => result.diagnostics.filter(issue =>
  /resource|url-scheme/.test(issue.code) && issue.level !== 'info')

async function fixture(model: ReturnType<typeof seed>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-source-media-'))
  const host = new DocumentHostService(path.join(root, 'recovery'))
  const initial = await host.internalAPI.create(model, 'media-handoff.glx')
  await host.tools.beginRun({ runId: 'author', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  await host.tools.loadToolFamilies('author', ['content'])
  let serial = 0
  const call = (name: string, input: unknown) => host.tools.execute('author', `call-${++serial}`, { name, input })
  const read = async (file: ComponentProjectFile) => {
    const result = await call('project.read', { path: file.path })
    expect(result.kind, JSON.stringify(result)).toBe('read')
    if (result.kind !== 'read') throw new Error(JSON.stringify(result))
    return (result.data as { content: string }).content
  }
  const apply = async (input: unknown) => {
    const result = await call('project.apply', input)
    expect(result.kind, JSON.stringify(result)).toBe('read')
    if (result.kind !== 'read') throw new Error(JSON.stringify(result))
    return result.data as ContentApplyResult
  }
  const snapshot = () => host.internalAPI.read(initial.documentId)
  const files = async () => { const current = course(await snapshot()); return componentProjectFiles(current.project, current.resources) }
  cleanups.push(async () => {
    await host.tools.stop('author')
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 20 })
  })
  return { root, host, initial, read, apply, snapshot, files }
}

it('reads an audio alias as a canonical source, edits the same program, and copies its static audio without adding an asset', async () => {
  const model = seed(), script = 'window.savedAlias="cw-resource:voice";document.getElementById("play").onclick=()=>document.querySelector("audio").play();'
  const imageRecord = { kind: 'image', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'img', index: 2, attributes: { id: 'picture' } }], baseline: 'cw-resource:photo' },
    overrides: { src: 'cw-resource:record-photo', geometry: { translateX: 12, width: 120 } } }
  const expectImageRecordAssets = (instance: ComponentInstance) => {
    const record = instance.authoring?.records?.picture
    expect(record).toMatchObject({ kind: 'image', binding: { kind: 'dom', path: imageRecord.binding.path },
      overrides: { geometry: imageRecord.overrides.geometry } })
    if (!record?.overrides.src) throw new Error('Expected the original authored image record')
    const bindings = (instance.data as { resourceBindings: Record<string, string> }).resourceBindings
    expect(bindings[record.binding.baseline]).toBe('photo-a')
    expect(bindings[record.overrides.src]).toBe('photo-b')
  }
  const wrapper = `<script id="cw-html-authoring-records" type="application/json">${JSON.stringify({ version: 1, records: { picture: imageRecord } })}</script>`
  const html = `<!doctype html><html><head><title>Original program</title></head><body><p>Original line</p><audio controls src="cw-resource:voice"></audio><img id="picture" src="cw-resource:photo"><button id="play">Play</button><script>${script}</script>${wrapper}</body></html>`
  model.project.instances.program = { id: 'program', definitionId: HTML_PROGRAM_DEFINITION.id,
    data: { html, resourceBindings: { 'cw-resource:voice': 'audio-a', 'cw-resource:photo': 'photo-a', 'cw-resource:record-photo': 'photo-b' } }, frame: frame() }
  testContainerInstance(model.project, 0).childIds = ['program']
  const f = await fixture(model), originalFile = instanceFile(await f.files(), 'program')
  const source = await f.read(originalFile)
  expect(source).toContain('<audio controls src="cw-resource:audio-a"></audio>')
  expect(source).toContain(`<!doctype html>`)
  expect(source).toContain(`<script>${script}</script>`)
  expect(readHtmlAuthoringRecords(source)).toEqual({ picture: { ...imageRecord,
    binding: { ...imageRecord.binding, baseline: 'cw-resource:photo-a' }, overrides: { ...imageRecord.overrides, src: 'cw-resource:photo-b' } } })
  const programPage = (await f.files()).find(file => file.kind === 'page' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'original-page')!
  expect(originalFile.content).toBe(source)
  expect(programPage.content).toBe(programPage.projection!.html)
  expect(programPage.content).toBe(source)
  expect((await f.snapshot()).revision).toBe(f.initial.revision)
  expect(course(await f.snapshot())).toEqual(course(f.initial))
  const edited = await f.apply({ path: originalFile.path, edits: [{ old: '<p>Original line</p>', new: '<p>Revised line</p>' }] })
  expect(edited).toMatchObject({ commit: 'committed', insertedIds: [], receipt: { status: 'applied' } })
  expect(resourceDiagnostic(edited)).toEqual([])
  const changed = course(await f.snapshot())
  expect(boundAsset(changed.project.instances.program!, 'audio')).toBe('audio-a')
  expectImageRecordAssets(changed.project.instances.program!)
  expect((changed.project.instances.program!.data as { html: string }).html).toContain(`<script>${script}</script>`)
  const reread = await f.read(instanceFile(await f.files(), 'program'))
  const audio = reread.match(/<audio\b[^>]*>[^]*?<\/audio>/)?.[0]
  expect(audio).toContain('src="cw-resource:audio-a"')
  const copyPage = (await f.files()).find(file => file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'copy-page')!
  await f.read(copyPage)
  const copied = await f.apply({ path: copyPage.path, intent: 'insert', content: `<section><p>Copied audio</p>${audio}</section>` })
  expect(copied).toMatchObject({ commit: 'committed', receipt: { status: 'applied' } })
  expect(resourceDiagnostic(copied)).toEqual([])
  const current = course(await f.snapshot())
  expect(boundAsset(current.project.instances[copied.insertedIds[0]!]!, 'audio')).toBe('audio-a')
  expect(Object.keys(current.project.assets)).toEqual(Object.keys(model.project.assets))
  expect(current.resources).toEqual(model.resources)
  const filename = path.join(f.root, 'saved.glx')
  await f.host.internalAPI.save(f.initial.documentId, filename)
  const cold = course(await new DocumentHostService(path.join(f.root, 'cold')).internalAPI.open(filename))
  expect(boundAsset(cold.project.instances.program!, 'audio')).toBe('audio-a')
  expectImageRecordAssets(cold.project.instances.program!)
  expect(boundAsset(cold.project.instances[copied.insertedIds[0]!]!, 'audio')).toBe('audio-a')
  expect((cold.project.instances.program!.data as { html: string }).html).toContain('<p>Revised line</p>')
  expect(cold.resources).toEqual(model.resources)
})

it('normalizes each composed instance with its own effective resource bindings, including virtual asset paths and professional images', async () => {
  const model = seed()
  model.project.instances.group = { id: 'group', definitionId: WEB_DEFINITION.id, data: { html: '<main id="group"></main>' }, frame: frame(), childIds: ['left', 'right', 'native'] }
  model.project.instances.left = { id: 'left', definitionId: WEB_DEFINITION.id, frame: frame(), data: {
    html: '<section id="left"><img id="picture-left" src="cw-resource:shared" srcset="cw-resource:shared 1x, ../assets/photo-a.svg 2x" style="background-image:url(\'cw-resource:shared\')"><img id="virtual-path" src="../assets/photo-a.svg"><svg width="30" height="20"><image id="svg-image" href="cw-resource:shared" width="30" height="20"></image></svg><video poster="cw-resource:shared"></video></section>',
    css: '#left{background-image:url("cw-resource:shared")}', resourceBindings: { 'cw-resource:shared': 'photo-a' } } }
  model.project.instances.right = { id: 'right', definitionId: WEB_DEFINITION.id, frame: frame(320), data: {
    html: '<section id="right"><img id="picture-right" src="cw-resource:shared"></section>',
    css: '#right{background-image:url("cw-resource:shared")}', resourceBindings: { 'cw-resource:shared': 'photo-a' } },
    authoring: { resourceBindings: { 'cw-resource:shared': 'photo-b' } } }
  model.project.instances.native = { id: 'native', definitionId: IMAGE_DEFINITION.id, data: createImageData('photo-b', 'Professional picture'), frame: frame(640) }
  testContainerInstance(model.project, 0).childIds = ['group']
  const f = await fixture(model), files = await f.files()
  const group = instanceFile(files, 'group'), page = files.find(file => file.kind === 'page' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'original-page')!
  for (const file of [group, page]) {
    const source = await f.read(file)
    expect(file.content).toBe(file.projection!.html)
    expect(source).toBe(file.projection!.html)
    const dom = new JSDOM(source)
    try {
      const document = dom.window.document
      expect(document.querySelector('#picture-left')!.getAttribute('src')).toBe('cw-resource:photo-a')
      expect(document.querySelector('#picture-right')!.getAttribute('src')).toBe('cw-resource:photo-b')
      expect(document.querySelector('#virtual-path')!.getAttribute('src')).toBe('cw-resource:photo-a')
      expect(document.querySelector('#picture-left')!.getAttribute('srcset')).toBe('cw-resource:photo-a 1x, cw-resource:photo-a 2x')
      expect(document.querySelector('#svg-image')!.getAttribute('href')).toBe('cw-resource:photo-a')
      expect(document.querySelector('#left video')!.getAttribute('poster')).toBe('cw-resource:photo-a')
      expect(document.querySelector('#picture-left')!.getAttribute('style')).toContain('cw-resource:photo-a')
      expect(document.querySelector('img[alt="Professional picture"]')!.getAttribute('src')).toBe('cw-resource:photo-b')
      expect([...document.querySelectorAll('style')].map(style => style.textContent).join('\n')).toContain('#right{background-image:url("cw-resource:photo-b")}')
    } finally { dom.window.close() }
  }
  expect((await f.snapshot()).revision).toBe(f.initial.revision)
  expect(course(await f.snapshot())).toEqual(course(f.initial))
  const copyPage = files.find(file => file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'copy-page')!
  await f.read(copyPage)
  const copied = await f.apply({ path: copyPage.path, intent: 'insert', content: page.content })
  expect(copied).toMatchObject({ commit: 'committed' })
  expect(resourceDiagnostic(copied)).toEqual([])
  const current = course(await f.snapshot()), copy = current.project.instances[copied.insertedIds[0]!]!
  expect(boundAsset(copy, '#picture-left')).toBe('photo-a')
  expect(boundAsset(copy, '#picture-right')).toBe('photo-b')
  expect(Object.keys(current.project.assets)).toEqual(Object.keys(model.project.assets))
  expect(current.resources).toEqual(model.resources)
})

it('keeps unknown aliases and relative paths intact and diagnoses their ingestion instead of borrowing another instance binding', async () => {
  const model = seed()
  const html = '<section id="unknown"><img id="foreign-alias" src="cw-resource:foreign"><img id="missing-path" src="../assets/missing.svg"></section>'
  model.project.instances.unknown = { id: 'unknown', definitionId: WEB_DEFINITION.id, data: { html }, frame: frame() }
  model.project.instances.other = { id: 'other', definitionId: WEB_DEFINITION.id,
    data: { html: '<img src="cw-resource:foreign">', resourceBindings: { 'cw-resource:foreign': 'photo-b' } }, frame: frame(320) }
  testContainerInstance(model.project, 0).childIds = ['unknown', 'other']
  const f = await fixture(model), source = await f.read(instanceFile(await f.files(), 'unknown'))
  expect(source).toBe(html)
  expect((await f.snapshot()).revision).toBe(f.initial.revision)
  const copyPage = (await f.files()).find(file => file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'copy-page')!
  await f.read(copyPage)
  const copied = await f.apply({ path: copyPage.path, intent: 'insert', content: source })
  expect(copied).toMatchObject({ commit: 'committed' })
  expect(copied.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'unresolved-project-resource', reference: 'cw-resource:foreign' }),
    expect.objectContaining({ code: 'missing-relative-resource' }),
  ]))
  const current = course(await f.snapshot()), copy = current.project.instances[copied.insertedIds[0]!]!
  expect((copy.data as { html: string }).html).toContain('src="cw-resource:foreign"')
  expect((copy.data as { html: string }).html).toContain('src="../assets/missing.svg"')
  expect((copy.data as { resourceBindings?: Record<string, string> }).resourceBindings?.['cw-resource:foreign']).toBeUndefined()
  expect(Object.keys(current.project.assets)).toEqual(Object.keys(model.project.assets))
  expect(current.project.instances.other).toEqual(model.project.instances.other)
})

it('keeps canonical project-source identity through alias collisions while external raw HTML retains target-local alias semantics', async () => {
  const model = seed()
  const html = '<section><p>Original collision line</p><img src="cw-resource:photo"></section>'
  for (const [index, id] of ['project-source', 'raw-source'].entries()) {
    model.project.instances[id] = { id, definitionId: WEB_DEFINITION.id, frame: frame(index * 320),
      data: { html, resourceBindings: { 'cw-resource:photo': 'photo-b', 'cw-resource:photo-b': 'photo-a' } } }
  }
  testContainerInstance(model.project, 0).childIds = ['project-source', 'raw-source']
  const f = await fixture(model), files = await f.files()
  const canonicalFile = instanceFile(files, 'project-source')
  expect(await f.read(canonicalFile)).toContain('src="cw-resource:photo-b"')
  const edited = await f.apply({ path: canonicalFile.path,
    edits: [{ old: '<p>Original collision line</p>', new: '<p>Revised collision line</p>' }] })
  expect(edited).toMatchObject({ commit: 'committed', insertedIds: [], receipt: { status: 'applied' } })
  expect(resourceDiagnostic(edited)).toEqual([])
  const changed = course(await f.snapshot())
  expect(boundAsset(changed.project.instances['project-source']!, 'img')).toBe('photo-b')
  expect(Object.keys(changed.project.assets)).toEqual(Object.keys(model.project.assets))

  const rawFile = instanceFile(files, 'raw-source')
  await f.read(rawFile)
  const filename = path.join(f.root, 'raw.html')
  await fs.writeFile(filename, '<section><p>External collision line</p><img src="cw-resource:photo-b"></section>')
  const rawApplied = await f.apply({ path: rawFile.path, from: filename })
  expect(rawApplied).toMatchObject({ commit: 'committed', insertedIds: [], receipt: { status: 'applied' } })
  // Raw file closure diagnostics precede target context; the bound asset verifies unchanged local alias semantics.
  expect(boundAsset(course(await f.snapshot()).project.instances['raw-source']!, 'img')).toBe('photo-a')
})
