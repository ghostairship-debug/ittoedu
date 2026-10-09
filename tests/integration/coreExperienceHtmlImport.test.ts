// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { createCourseFromHtml, type CreateCourseFromHtmlPorts } from '../../src/main/workbench/htmlImport/CreateCourseFromHtml'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { isSourceDocumentModel } from '../../src/shared/workbench/document'
import { readComponentProjectFileInput, prepareComponentProjectFileSource } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { patchHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { HtmlImportDesktopService } from '../../src/main/workbench/htmlImport/HtmlImportDesktopService'
import { chromium } from 'playwright'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { resolveWebResourceBindings } from '../../src/components/web/resources'
import { authoredDocumentBootstrap, installAuthoredDocumentPrograms } from '../../src/components/web/authoredDocumentBootstrap'
import type { WebRuntimeData } from '../../src/components/web/moduleGraph'

// The disposable measurement window is unrelated to source capture, pagination
// and archive closure. Use its real supported retained-program result here.
vi.mock('../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement.js', async () => {
  const { sourceProgramAssembly } = await import('../../src/core/contentApply/assembly/htmlAssembly')
  return { measureHtmlAtDesignViewport: async (input: any) => sourceProgramAssembly(input.viewport, { html: input.html }, 'fixture-retained-program') }
})
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function fixture(html: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-html-import-')); roots.push(root)
  const sourcePath = path.join(root, 'lesson.html'); await fs.writeFile(sourcePath, html)
  const host = new DocumentHostService(path.join(root, 'journal')), files = new AgentFileService(host)
  const runId = 'import', context = { runId, workspaceRoot: root, permission: 'workspace' as const }
  await host.tools.beginRun({ runId, actor: 'agent', documents: [], fileAccess: context })
  const children = new Map<string, ToolResult>(), targets = new Map<string, string>()
  const ports: CreateCourseFromHtmlPorts = {
    lookupChild: async id => children.get(id) ?? null,
    documentTarget: async id => {
      const target = await host.tools.issueTarget(runId, id, { kind: 'document' }); targets.set(target, id); return target
    },
    executeChild: async (id, call) => {
      let result: ToolResult
      if (call.name === 'file.open' || call.name === 'file.create') {
        const outcome = await files.execute(context, call.name, call.input, host.tools.operationIdentity(runId, id))
        if (outcome.opened) await host.tools.attachRunDocument(runId, outcome.opened.documentId, outcome.opened.writable)
        result = { kind: 'read', data: outcome.data }
      } else if (call.name === 'file.save') {
        const documentId = targets.get((call.input as { target: string }).target)!
        const saved = await host.saveWithFact(documentId)
        result = { kind: 'read', data: { status: 'saved', documentId, savedRevision: saved.savedRevision } }
      } else result = await host.tools.execute(runId, id, call)
      children.set(id, result); return result
    },
  }
  return { root, host, sourcePath, ports, context: { callId: 'create', permission: 'workspace' as const, assertActive() {} } }
}

async function editOpenedSource(host: DocumentHostService, filename: string, source: string) {
  const opened = await host.open(filename)
  expect(isSourceDocumentModel(opened.model)).toBe(true)
  const result = await host.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
    operationId: `edit-${path.basename(filename)}`, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
  expect(result.status).toBe('applied')
}

it('imports current opened HTML and recursive dependencies through public creation and manual import', async () => {
  const f = await fixture('<p>disk HTML</p>')
  const currentHtml = '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><p>session HTML</p><script type="module" src="main.js"></script></body></html>'
  const mainPath = path.join(f.root, 'main.js'), helperPath = path.join(f.root, 'helper.js')
  await fs.writeFile(mainPath, 'window.currentValue="disk JS";')
  await fs.writeFile(helperPath, 'export const value="disk helper";')
  await fs.writeFile(path.join(f.root, 'theme.css'), 'p{color:rgb(3,4,5)}')
  await editOpenedSource(f.host, f.sourcePath, currentHtml)
  await editOpenedSource(f.host, mainPath, 'import {value} from "./helper.js";window.currentValue=value;')
  await editOpenedSource(f.host, helperPath, 'export const value="session helper";')
  const created = await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)
  expect(created).toMatchObject({ kind: 'read', data: { saved: true } })
  const reopened = await new DocumentHostService(path.join(f.root, 'source-reopened')).open((created as { data: { path: string } }).data.path)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
  const importedData = JSON.stringify(Object.values(reopened.model.project.instances).map(instance => instance.data))
  expect(importedData).toContain('session HTML'); expect(importedData).toContain('session helper')
  expect(importedData).not.toContain('disk HTML'); expect(importedData).not.toContain('disk helper')
  const manual = await f.host.registry.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'manual-sources.h5lesson')
  const before = await manual.drain()
  if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
  const result = await new HtmlImportDesktopService({ documents: f.host, chooseSource: async () => f.sourcePath }).import({
    documentId: before.documentId, epoch: before.epoch, revision: before.revision, surfaceId: before.model.project.surfaces[0]!.id, source: { kind: 'choose' },
  })
  expect(result?.receipt.status).toBe('applied')
  const after = await manual.drain()
  if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  const manualData = JSON.stringify(Object.values(after.model.project.instances).map(instance => instance.data))
  expect(manualData).toContain('session HTML'); expect(manualData).toContain('session helper')
  expect(manualData).not.toContain('disk helper')
  expect(await fs.readFile(f.sourcePath, 'utf8')).toBe('<p>disk HTML</p>')
  expect(await fs.readFile(helperPath, 'utf8')).toBe('export const value="disk helper";')
  expect(await f.host.readOpenedSource(path.join(f.root, 'theme.css'))).toBeUndefined()
})

it('applies current opened JS and JSON plus module and CSS dependencies through public project.from', async () => {
  const f = await fixture('<p>source input</p>')
  const entryPath = path.join(f.root, 'entry.js'), helperPath = path.join(f.root, 'helper.js'), jsonPath = path.join(f.root, 'data.json')
  const cssPath = path.join(f.root, 'theme.css'), nestedPath = path.join(f.root, 'nested.css')
  await fs.writeFile(entryPath, 'export default {value:"disk entry",mount(){return {update(){},dispose(){}}}};')
  await fs.writeFile(helperPath, 'export const value="disk helper";')
  await fs.writeFile(jsonPath, '{"message":"disk JSON"}')
  await fs.writeFile(cssPath, '.source{color:red}')
  await fs.writeFile(nestedPath, '.source{color:rgb(3,4,5)}')
  await editOpenedSource(f.host, entryPath, 'import {value} from "./helper.js";import data from "./data.json";import "./theme.css";export default {value,message:data.message,mount(){return {update(){},dispose(){}}}};')
  await editOpenedSource(f.host, helperPath, 'export const value="session helper";')
  await editOpenedSource(f.host, jsonPath, '{"message":"session JSON"}')
  await editOpenedSource(f.host, cssPath, '@import "nested.css";.source{background:blue}')
  const target = await f.host.registry.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'current-source.h5lesson')
  await f.host.tools.attachRunDocument('import', target.documentId, true)
  const project = await f.host.tools.issueTarget('import', target.documentId, { kind: 'document' })
  const listed = await f.host.tools.execute('import', 'source-list', { name: 'project.list', input: { project } })
  const pagePath = (listed as { data: { files: { type: string; path: string }[] } }).data.files.find(file => file.type === 'structure' && file.path.startsWith('pages/'))!.path
  const applied = await f.host.tools.execute('import', 'source-apply', { name: 'project.apply', input: { project, path: pagePath, from: entryPath, intent: 'insert' } })
  expect(applied).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  const snapshot = await target.drain()
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  const componentFiles = Object.values(snapshot.model.resources.components).flatMap(files => Object.entries(files))
  const textFiles = Object.fromEntries(componentFiles.map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]))
  expect(textFiles['entry.js']).toContain('data.message'); expect(textFiles['helper.js']).toContain('session helper')
  expect(textFiles['data.json']).toBe('{"message":"session JSON"}')
  expect(textFiles['theme.css']).toContain('nested.css'); expect(textFiles['nested.css']).toBe('.source{color:rgb(3,4,5)}')
  const sourceInstanceId = snapshot.model.project.surfaces[0]!.childIds[0]!
  const dataFile = componentProjectFiles(snapshot.model.project, snapshot.model.resources).find(file => file.kind === 'data'
    && file.target?.kind === 'instance' && file.target.instanceId === sourceInstanceId)!
  await f.host.tools.execute('import', 'data-read', { name: 'project.read', input: { project, path: dataFile.path } })
  expect(await f.host.tools.execute('import', 'data-apply', { name: 'project.apply', input: { project, path: dataFile.path, from: jsonPath } }))
    .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  const after = await target.drain()
  if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(after.model.project.instances[sourceInstanceId]!.data).toEqual({ message: 'session JSON' })
  expect(await fs.readFile(jsonPath, 'utf8')).toBe('{"message":"disk JSON"}')
  expect(await fs.readFile(cssPath, 'utf8')).toBe('.source{color:red}')
})

it('creates independent host pages from current unsaved HTML, saves/reopens and resumes without duplication', async () => {
  const f = await fixture('<!doctype html><html><body><main><section><h1>旧第一课</h1></section><section><h1>第二课</h1></section></main></body></html>')
  const source = await f.host.open(f.sourcePath)
  const updated = source.model.kind === 'text' ? source.model.source.replace('旧第一课', '当前未落盘第一课') : ''
  await f.host.dispatch({ documentId: source.documentId, epoch: source.epoch, baseRevision: source.revision,
    operationId: 'human-source', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: updated } } })
  const result = await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)
  expect(result).toMatchObject({ kind: 'read', data: { status: 'saved' } })
  const value = (result as { data: { path: string } }).data
  const reopened = await new DocumentHostService(path.join(f.root, 'reopened')).open(value.path)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected current course format')
  expect(reopened.model.project.surfaces.map(page => page.title)).toEqual(['当前未落盘第一课', '第二课'])
  const contents = reopened.model.project.surfaces.map(page => page.childIds.map(id => reopened.model.kind === 'course-v10' ? (reopened.model.project.instances[id]!.data as { html: string }).html : '').join(''))
  expect(contents[0]).toContain('当前未落盘第一课'); expect(contents[0]).not.toContain('第二课')
  expect(contents[1]).toContain('第二课'); expect(contents[1]).not.toContain('当前未落盘第一课')
  expect(await fs.readFile(f.sourcePath, 'utf8')).toContain('旧第一课')
  expect(await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)).toEqual(result)
  const manual = await f.host.registry.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'manual.h5lesson')
  const manualBefore = await manual.drain()
  if (manualBefore.model.kind !== 'course-v10') throw new Error('Expected current course format')
  const imported = await new HtmlImportDesktopService({ documents: f.host, chooseSource: async () => null }).import({
    documentId: manual.documentId, epoch: manualBefore.epoch, revision: manualBefore.revision, surfaceId: manualBefore.model.project.surfaces[0]!.id,
    source: { kind: 'file', path: f.sourcePath },
  })
  expect(imported?.receipt.status).toBe('applied')
  const manualAfter = await manual.drain()
  if (manualAfter.model.kind !== 'course-v10') throw new Error('Expected current course format')
  const manualHtml = (manualAfter.model.project.instances[manualAfter.model.project.surfaces[0]!.childIds[0]!]!.data as { html: string }).html
  expect(manualHtml).toContain('当前未落盘第一课'); expect(manualHtml).not.toContain('旧第一课')
})

it('retains one coupled program and accepts ordinary content into its explicitly empty surface', async () => {
  const html = '<!doctype html><html><body><main><section><h1>A</h1></section><section><h1>B</h1></section></main><script>window.shared={count:0};document.querySelector("h1").onclick=()=>++window.shared.count</script></body></html>'
  const f = await fixture(html)
  const result = await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)
  const value = (result as { data: { path: string } }).data
  const reopened = await f.host.open(value.path)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected current course format')
  expect(reopened.model.project.surfaces).toHaveLength(1)
  const content = reopened.model.project.surfaces[0]!.childIds.map(id => reopened.model.kind === 'course-v10' ? (reopened.model.project.instances[id]!.data as { html: string }).html : '').join('')
  expect(content.match(/window.shared=\{count:0\}/g)).toHaveLength(1)
  const blank = await f.host.registry.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'blank.h5lesson')
  await f.host.tools.attachRunDocument('import', blank.documentId, true)
  const project = await f.host.tools.issueTarget('import', blank.documentId, { kind: 'document' })
  const listed = await f.host.tools.execute('import', 'blank-list', { name: 'project.list', input: { project } })
  const file = (listed as { data: { files: { type: string; path: string }[] } }).data.files.find(file => file.type === 'structure')!
  // The project-file API intentionally requires insert at a structure path;
  // direct bound AI content uses the same apply service and empty surface owner.
  const snapshot = await blank.drain()
  const applied = await f.host.tools.applyComponentContent('import', 'blank-content', snapshot as any, {
    intent: 'content', target: { kind: 'container', container: { kind: 'surface', surfaceId: snapshot.model.kind === 'course-v10' ? snapshot.model.project.surfaces[0]!.id : '' } },
    source: { kind: 'html', html: '<p>无需模型补身份的第一段</p>' },
  })
  expect(file).toBeTruthy(); expect(applied.commit).toBe('committed'); expect(applied.insertedIds.length).toBeGreaterThan(0)
})

it('passes CSS from siblings into the existing source owner/compiler/cache without corrupting image bytes', async () => {
  const f = await fixture('<p>source workspace</p>')
  const cssPath = path.join(f.root, 'replacement.css')
  await fs.writeFile(cssPath, '@import "nested.css";.sample{background:url(./pixel.png)}')
  await fs.writeFile(path.join(f.root, 'nested.css'), '.sample{color:rgb(1,2,3)}')
  const pixel = Uint8Array.of(137,80,78,71,13,10,26,10,0,255,123)
  await fs.writeFile(path.join(f.root, 'pixel.png'), pixel)
  const project = createBlankCourseProjectV10(), ownerId = 'source-owner'
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId, entry: 'main.js' } } }
  project.instances.custom = { id: 'custom', definitionId: 'custom', data: {} }; project.surfaces[0]!.childIds.push('custom')
  const resources = { assets: {}, components: { [ownerId]: { 'main.js': new TextEncoder().encode('import "./styles/main.css";export default {}'), 'styles/main.css': new TextEncoder().encode('.sample{color:red}') } } }
  const file = componentProjectFiles(project, resources).find(file => file.sourceFile?.path === 'styles/main.css')!
  const input = await readComponentProjectFileInput({ from: cssPath, fileAccess: { permission: 'workspace', workspaceRoot: f.root } })
  const prepared = await prepareComponentProjectFileSource(input, file, 'content')
  if (prepared.kind !== 'data' || prepared.implementation?.kind !== 'source') throw new Error('Expected source workspace adapter')
  const edit = prepared.componentFiles![0]!
  const actualResources = { assets: {}, components: { [edit.ownerId]: edit.files! } }
  const compilationInput = componentCompilationInput(project, prepared.implementation, actualResources)
  expect(compilationInput.binaryFiles?.['styles/pixel.png']).toEqual(pixel)
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const first = await compilation.compile(compilationInput)
  expect(first.status).toBe('ready')
  if (first.status !== 'ready') throw new Error('Expected actual CSS compilation')
  expect(first.artifact.css).toMatch(/rgb\(1,\s*2,\s*3\)/); expect(first.artifact.css).toContain(Buffer.from(pixel).toString('base64'))
  expect((await compilation.compile(compilationInput)).cacheHit).toBe(true)
  const modified = { ...compilationInput, files: { ...compilationInput.files,
    'styles/nested.css': '.sample{color:blue}.passive{background:url(data:image/png;base64,AQ==)}.remote{background:url(https://cdn.example/picture.png)}' } }
  const next = await compilation.compile(modified)
  expect(next.cacheHit).toBe(false); expect(next.status).toBe('ready')
  if (next.status === 'ready') { expect(next.artifact.css).toContain('blue'); expect(next.artifact.css).toContain('https://cdn.example/picture.png') }
})

it('adopts HTML author records into the single H5 consumer with image override resources on normal save', async () => {
  const svg = (color: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="${color}"/></svg>`).toString('base64')}`
  const original = svg('red'), replacement = svg('blue')
  const html = '<!doctype html><html><body><p id="caption">Hello</p><img id="picture" src="' + original + '"><button onclick="this.textContent=\'clicked\'">run</button></body></html>'
  const records = {
    caption: { kind: 'text' as const, binding: { kind: 'dom' as const, path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { id: 'caption' } }], textIndex: 0, baseline: 'Hello' }, overrides: { text: 'Edited once', geometry: { translateX: 17, width: 120 } } },
    picture: { kind: 'image' as const, binding: { kind: 'dom' as const, path: [{ tag: 'body', index: 1 }, { tag: 'img', index: 1, attributes: { id: 'picture' } }], baseline: original }, overrides: { src: replacement } },
  }
  const f = await fixture(patchHtmlAuthoringRecords(html, records))
  const result = await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)
  expect(result).toMatchObject({ kind: 'read', data: { saved: true } })
  const reopened = await new DocumentHostService(path.join(f.root, 'authored-reopened')).open((result as { data: { path: string } }).data.path)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected current course format')
  const instance = reopened.model.project.instances[reopened.model.project.surfaces[0]!.childIds[0]!]!
  const data = instance.data as { html: string; authoringRecords: typeof records; resourceBindings: Record<string, string> }
  expect(data.html).not.toContain('cw-html-authoring-consumer'); expect(data.html).not.toContain('cw-html-authoring-records')
  expect(data.html).toContain('this.textContent=\'clicked\'')
  expect(data.authoringRecords.caption).toEqual(records.caption)
  expect(data.authoringRecords.picture.binding.baseline).toMatch(/^cw-resource:/)
  expect(data.authoringRecords.picture.overrides.src).toMatch(/^cw-resource:/)
  const replacementId = data.resourceBindings[data.authoringRecords.picture.overrides.src]!
  expect(reopened.model.resources.assets[replacementId]).toBeDefined()
  const roundtrip = new CourseV10Driver().load(new CourseV10Driver().serialize(reopened.model))
  expect(roundtrip).toEqual(reopened.model)
  const current = await f.host.open((result as { data: { path: string } }).data.path)
  const next = await f.host.tools.applyComponentContent('import', 'source-after-human', current as any, {
    intent: 'content', target: { kind: 'instance', instanceId: instance.id },
    source: { kind: 'html', html: data.html.replace('>Hello<', '>AI continued<') },
  })
  expect(next.commit).toBe('committed')
  const applied = await f.host.registry.get(current.documentId).drain()
  if (applied.model.kind !== 'course-v10') throw new Error('Expected current course format')
  const adopted = (applied.model.project.instances[instance.id]!.data as unknown as { authoringRecords: typeof records }).authoringRecords
  expect(adopted.caption.binding.baseline).toBe('AI continued')
  expect(adopted.caption.overrides.text).toBeUndefined()
  expect(adopted.caption.overrides.geometry).toEqual(records.caption.overrides.geometry)
  expect(adopted.picture).toEqual(data.authoringRecords.picture)
})

it('runs saved nested iframe/srcdoc modules, CSS and images through the real native document consumer', async () => {
  const escaped = (html: string) => html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const nested = '<!doctype html><html><body><button id="count">0</button><script type="module" src="main.js"></script></body></html>'
  const child = `<html><head><base href="assets/"></head><body><img id="picture" src="picture.svg"><button id="count">0</button><iframe name="nested" srcdoc="${escaped(nested)}"></iframe><script type="module" src="main.js"></script></body></html>`
  const html = '<!doctype html><html><body><iframe name="experiment" id="experiment" src="child/page.html"></iframe><script>window.parentRuns=(window.parentRuns||0)+1</script></body></html>'
  const f = await fixture(html)
  await fs.mkdir(path.join(f.root, 'child/assets'), { recursive: true })
  await fs.writeFile(path.join(f.root, 'child/page.html'), child)
  await fs.writeFile(path.join(f.root, 'child/assets/main.js'), 'import "./theme.css";window.childRuns=(window.childRuns||0)+1;let count=0;document.getElementById("count").onclick=()=>document.getElementById("count").textContent=String(++count)')
  await fs.writeFile(path.join(f.root, 'child/assets/theme.css'), '@import "nested.css";button{background-image:url(picture.svg)}')
  await fs.writeFile(path.join(f.root, 'child/assets/nested.css'), 'button{color:rgb(1,2,3)}')
  await fs.writeFile(path.join(f.root, 'child/assets/picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="green"/></svg>')
  const result = await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)
  expect(result).toMatchObject({ kind: 'read', data: { saved: true } })
  const reopened = await new DocumentHostService(path.join(f.root, 'nested-reopened')).open((result as { data: { path: string } }).data.path)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected current course format')
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const published = await buildPublishedCourseV3({ project: reopened.model.project, assetBytes: reopened.model.resources.assets }, { compilation })
  expect(published.diagnostics).toEqual([])
  const instance = published.payload.instances[published.payload.surfaces[0]!.childIds[0]!]!
  const resources = Object.fromEntries(Object.entries(reopened.model.resources.assets).map(([id, bytes]) => [id,
    `data:${reopened.model.kind === 'course-v10' ? reopened.model.project.assets[id]!.mimeType : ''};base64,${Buffer.from(bytes).toString('base64')}`]))
  const projected = resolveWebResourceBindings(instance, id => resources[id])
  const source = authoredDocumentBootstrap(projected.data as WebRuntimeData, { instanceId: instance.id, nonce: 'nested-test', resources,
    bridge: programs => `(${installAuthoredDocumentPrograms.toString()})(${JSON.stringify(programs)})` })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(source)
    const childFrame = page.frame({ name: 'experiment' })!
    await childFrame.waitForFunction(() => (window as any).childRuns === 1)
    await childFrame.locator('#count').click()
    expect(await childFrame.locator('#count').textContent()).toBe('1')
    expect(await childFrame.locator('#count').evaluate(node => getComputedStyle(node).color)).toBe('rgb(1, 2, 3)')
    expect(await childFrame.locator('#picture').evaluate((node: HTMLImageElement) => ({ complete: node.complete, width: node.naturalWidth, height: node.naturalHeight }))).toEqual({ complete: true, width: 8, height: 6 })
    expect(await childFrame.locator('#count').evaluate(node => getComputedStyle(node).backgroundImage)).toContain('data:image/svg+xml')
    const nestedFrame = childFrame.childFrames().find(frame => frame.name() === 'nested')!
    await nestedFrame.waitForFunction(() => (window as any).childRuns === 1)
    await nestedFrame.locator('#count').click()
    expect(await nestedFrame.locator('#count').textContent()).toBe('1')
    expect(await childFrame.locator('#count').textContent()).toBe('1')
    expect(await page.evaluate(() => (window as any).parentRuns)).toBe(1)
  } finally { await browser.close() }
}, 30_000)
