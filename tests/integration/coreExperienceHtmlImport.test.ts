// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { createCourseFromHtml, type CreateCourseFromHtmlPorts } from '../../src/main/workbench/htmlImport/CreateCourseFromHtml'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { readComponentProjectFileInput, prepareComponentProjectFileSource } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { patchHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { HtmlImportDesktopService } from '../../src/main/workbench/htmlImport/HtmlImportDesktopService'

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
  const modified = { ...compilationInput, files: { ...compilationInput.files, 'styles/nested.css': '.sample{color:blue}' } }
  const next = await compilation.compile(modified)
  expect(next.cacheHit).toBe(false); if (next.status === 'ready') expect(next.artifact.css).toContain('blue')
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
