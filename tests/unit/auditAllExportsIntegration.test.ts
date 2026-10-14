import { afterEach, expect, it, vi } from 'vitest'
import { DOMSerializer } from 'prosemirror-model'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { ComponentProjectFileCoordinator, componentFileContentSource, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { componentObjectJsonEdits } from '../../src/renderer/ui/DeveloperTab'
import { renderDocumentText } from '../../src/shared/document/render'
import { documentEditorSchema } from '../../src/renderer/document/editorSchema'
import { buildFlowRichTextHtml } from '../../src/shared/flowRichText'
import { splitHtmlSections } from '../../src/main/workbench/htmlImport/splitHtmlSections'
import { collectBundledFontFamiliesInUse, registerBundledFontEmbedSource, resolveEmbeddedBundledFonts } from '../../src/renderer/export/bundledFontEmbedding'
import { installedBundledFontFaceCss } from '../../src/shared/fonts/installedBundledFontFaceCss'
import { authoredDocumentBootstrap, type AuthoredDocumentPrograms } from '../../src/components/web/authoredDocumentBootstrap'
import { webModuleGraphForDocument, type WebModuleGraph } from '../../src/components/web/moduleGraph'
import { buildComponentReadingProjection } from '../../src/renderer/export/componentPlatform/document/reading'
import { ComponentRuntimeHost } from '../../src/player/components/runtime/ComponentRuntimeHost'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform'

afterEach(() => { vi.restoreAllMocks(); registerBundledFontEmbedSource(null) })

async function fixture() {
  const project = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'json', revision: 0, title: '真实写域',
    definitions: { group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
    instances: { parent: { id: 'parent', definitionId: 'group', data: {}, style: { opacity: 1, backgroundColor: '#f00' }, childIds: ['child'] },
      child: { id: 'child', definitionId: 'text', data: { content: { inlines: [{ type: 'text', text: '人工子正文' }] } }, style: { opacity: 0.4 }, locked: true } },
    surfaces: [{ id: 'page', kind: 'flow', title: '页', childIds: ['parent'] }], global: { underlay: [], overlay: [] },
    assets: { art: { id: 'art', path: 'theme.css', filename: 'theme.css', mimeType: 'text/css', byteLength: 8 } }, theme: { css: 'p{color:black}' } })
  const driver = new CourseV10Driver()
  const session = await DocumentSession.create({ documentId: 'json', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'json.h5lesson' },
    model: { kind: 'course-v10', project, resources: { assets: { art: new TextEncoder().encode('old-art') }, components: {} } } }, driver,
    { async append() {}, async save() { throw new Error('not a save request') } })
  const coordinator = new ComponentProjectFileCoordinator({ document: async () => session.read() as ComponentProjectSnapshot,
    async source() { throw new Error('literal content') },
    async apply(_run, operationId, _digest, baseline, request) {
      const command = request.intent === 'canonical' ? captureComponentOperation(baseline.model.project, request.edits)
        : ['content', 'insert', 'redo', 'style'].includes(request.intent) ? planContentApply({ project: baseline.model.project,
          request: request as Parameters<typeof planContentApply>[0]['request'], createId: () => crypto.randomUUID() }).command
          : (() => { throw new Error('unexpected surface request') })()
      const receipt = await session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId,
        baseRevision: baseline.revision, actor: 'agent', mutation: { type: 'command', command } })
      expect(receipt.status).toBe('applied')
      return { commit: 'committed', usability: 'usable', delivery: 'not_requested', diagnostics: [], input: request, insertedIds: [], receipt }
    } })
  return { project, driver, session, coordinator }
}

it('CA144: list/read/apply keep theme and same-name asset owners distinct through the real Session', async () => {
  const { project, session, coordinator } = await fixture(), before = session.read() as ComponentProjectSnapshot
  const files = componentProjectFiles(project, before.model.resources)
  expect(new Set(files.map(file => file.path)).size).toBe(files.length)
  const asset = files.find(file => file.binding?.kind === 'asset')!
  expect(asset.path).toBe('assets/art/theme.css')
  expect(coordinator.captureFile('run', before, 'theme.css', false).file.binding).toEqual({ kind: 'theme' })
  coordinator.listScope('run', before, { kind: 'document' })
  expect(coordinator.captureFile('run', before, 'theme.css', false).file.binding).toEqual({ kind: 'theme' })
  expect((await coordinator.execute('run', 'read-art', '1', 'project.read', { path: asset.path })).kind).toBe('read')
  expect((await coordinator.execute('run', 'apply-art', '2', 'project.apply', { path: asset.path, content: 'new-art' })).kind).toBe('read')
  const after = session.read() as ComponentProjectSnapshot
  expect(new TextDecoder().decode(after.model.resources.assets.art)).toBe('new-art')
  expect(after.model.project.theme).toEqual(project.theme)
  expect(after.model.project.assets.art!.path).toBe('theme.css')
})

it('CA270/293: own style file clears camel aliases and changes only its parent, including a locked child', async () => {
  const { session, driver, coordinator } = await fixture(), before = session.read() as ComponentProjectSnapshot
  const file = componentProjectFiles(before.model.project, before.model.resources).find(file => file.kind === 'style' && file.target?.kind === 'instance' && file.target.instanceId === 'parent')!
  await coordinator.execute('run', 'read', '1', 'project.read', { path: file.path })
  const result = await coordinator.execute('run', 'apply', '2', 'project.apply', { path: file.path, content: '{"opacity":0.8}' })
  expect(result.kind).toBe('read')
  const after = session.read() as ComponentProjectSnapshot
  expect(after.model.project.instances.parent!.style).toEqual({ opacity: 0.8 })
  expect(after.model.project.instances.child).toEqual(before.model.project.instances.child)
  const reopened = driver.load(driver.serialize(after.model))
  expect(reopened.kind === 'course-v10' && reopened.project.instances).toEqual(after.model.project.instances)
  // Changing spelling while retaining a value must not let deletion of the old alias erase the new one.
  const source = componentFileContentSource(file, '{"background-color":"#0f0","opacity":1}')
  expect(source.kind === 'style' && source.style).toEqual({ 'background-color': '#0f0' })
})

it('CA363: visibility-only Developer JSON edits enter the canonical Driver and survive reopening', async () => {
  const { session, driver } = await fixture(), before = session.read() as ComponentProjectSnapshot
  const current = before.model.project.instances.parent!, next = { ...current, visibility: { mode: 'all' as const, surfaceIds: [] } }
  const edits = componentObjectJsonEdits(before.model.project, { instanceId: current.id, surfaceId: 'page', stateId: null }, current, next)
  expect(edits).toContainEqual({ type: 'instance.patch', instanceId: current.id, patch: expect.objectContaining({ visibility: next.visibility }) })
  const result = await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'developer', baseRevision: before.revision,
    actor: 'human', mutation: { type: 'command', command: captureComponentOperation(before.model.project, edits) } })
  expect(result.status).toBe('applied')
  const after = session.read() as ComponentProjectSnapshot
  expect(after.model.project.instances.parent!.visibility).toEqual(next.visibility)
  const reopened = driver.load(driver.serialize(after.model))
  expect(reopened.kind === 'course-v10' && reopened.project.instances).toEqual(after.model.project.instances)
})

it('CA093: relative links survive semantic and editable DOM consumers while unsafe links remain inert', () => {
  for (const href of ['./guide.html', '../notes.html#lesson']) {
    const root = document.createElement('div'); root.innerHTML = renderDocumentText({ inlines: [{ type: 'text', text: '阅读', link: { href } }] })
    expect(root.querySelector('a')?.getAttribute('href')).toBe(href)
    const mark = documentEditorSchema.marks.link!.create({ href }), editor = document.createElement('div')
    editor.append(DOMSerializer.fromSchema(documentEditorSchema).serializeFragment(documentEditorSchema.nodes.paragraph!.create({}, documentEditorSchema.text('阅读', [mark])).content))
    expect(editor.querySelector('a')?.getAttribute('href')).toBe(href)
  }
  expect(renderDocumentText({ inlines: [{ type: 'text', text: '阅读', link: { href: 'javascript:alert(1)' } }] })).not.toContain('<a')
})

it('CA105: cross-section anchors retain one usable document, while same-section anchors keep ordinary pagination', () => {
  const source = '<html><body><section id="one"><a href="#%E4%BA%8C">下一段</a></section><section id="二">第二段</section></body></html>'
  for (const mode of ['auto', 'sections'] as const) expect(splitHtmlSections(source, mode)).toMatchObject({ mode: 'whole', sections: [{ html: source }] })
  expect(splitHtmlSections('<html><body><section><a href="#same">正文</a><p id="same">段</p></section><section>二</section></body></html>').mode).toBe('sections')
})

it('CA116: contiguous same-style Unicode text becomes one naturally wrapping span; boundaries remain intact', () => {
  const text = '甲😀'.repeat(1000), root = document.createElement('div')
  root.innerHTML = buildFlowRichTextHtml(text, [{ start: 0, end: 2000, style: { color: '#123', underline: true } }])
  expect(root.querySelectorAll('span')).toHaveLength(1)
  expect(root.textContent).toBe(text)
  expect(root.innerHTML).not.toContain('inline-block')
  root.innerHTML = buildFlowRichTextHtml('甲\n乙丙', [{ start: 0, end: 3, style: { baseline: 0.2 } }, { start: 3, end: 4, style: { baseline: -0.1 } }])
  expect(root.querySelectorAll('span')).toHaveLength(3)
  expect(root.querySelectorAll('br')).toHaveLength(1)
})

it('CA024: real CSS and nested HTML declarations select only their requested bundled export families', () => {
  const payload = { html: '<style>p{font-family:"Noto Sans SC",sans-serif}</style><iframe srcdoc="&lt;p style=&quot;font:italic 20px \'STIX Two Math\'&quot;&gt;x&lt;/p&gt;"></iframe>',
    modules: { 'local.css': 'p{font-family:"Noto Sans SC"}', 'unused.js': 'const fake="font-family: STIX Two Math"' } }
  const requested: string[][] = []
  registerBundledFontEmbedSource(families => { requested.push([...families]); return [] })
  expect(collectBundledFontFamiliesInUse(payload)).toEqual(['Noto Sans SC', 'STIX Two Math'])
  resolveEmbeddedBundledFonts(payload)
  expect(requested).toEqual([['Noto Sans SC', 'STIX Two Math']])
  expect(collectBundledFontFamiliesInUse({ html: '<script>const fake="font-family:Noto Sans SC"</script>', css: '/* font-family:STIX Two Math */ p{color:red}' })).toEqual([])
})

it('CA196/216: every parser document gets font faces and only its own module closure, including module URL workers', () => {
  const host = document.implementation.createHTMLDocument('host'), base = host.createElement('base'); base.href = 'https://editor.example/app/'; host.head.append(base)
  const style = host.createElement('style'); style.id = 'bundled-font-faces'; style.textContent = '@font-face{font-family:Test;src:url(./fonts/test.woff2)}'; host.head.append(style)
  const fontCss = installedBundledFontFaceCss(host)
  expect(fontCss).toContain('https://editor.example/app/fonts/test.woff2')
  const graph: WebModuleGraph = { entries: { '0:0': 'child-a.js', '1:0': 'child-b.js' }, modules: {
    'child-a.js': { code: 'import "dep.js";new Worker("guoling-module-url:worker.js")', imports: [{ start: 7, end: 15, path: 'dep.js' }] },
    'dep.js': { code: 'export const value=1', imports: [] }, 'worker.js': { code: 'postMessage(42)', imports: [] },
    'child-b.js': { code: 'export const value=2', imports: [] }, unused: { code: 'never-loaded', imports: [] } } }
  const rootPrograms: AuthoredDocumentPrograms[] = []
  const html = authoredDocumentBootstrap({ html: '<iframe srcdoc="&lt;script type=module&gt;&lt;/script&gt;"></iframe><iframe srcdoc="&lt;script type=module&gt;&lt;/script&gt;"></iframe>', moduleGraph: graph },
    { nonce: 'fonts', instanceId: 'web', resources: {}, themeCss: fontCss, bridge: programs => { rootPrograms.push(programs); return '' } })
  expect(Object.keys(rootPrograms[0]!.graph!.modules)).toEqual([])
  expect(Object.keys(webModuleGraphForDocument(graph, '0')!.modules).sort()).toEqual(['child-a.js', 'dep.js', 'worker.js'])
  expect(Object.keys(webModuleGraphForDocument(graph, '1')!.modules)).toEqual(['child-b.js'])
  const root = document.createElement('div'); root.innerHTML = html
  for (const frame of root.querySelectorAll('iframe')) {
    const child = new DOMParser().parseFromString(frame.srcdoc, 'text/html')
    expect(child.querySelector('style[data-component-bundled-faces]')?.textContent).toBe(fontCss)
    expect(frame.srcdoc).not.toContain('never-loaded')
  }
  expect(root.querySelectorAll('iframe')[0]!.srcdoc).not.toContain('export const value=2')
  expect(root.querySelectorAll('iframe')[1]!.srcdoc).not.toContain('postMessage(42)')
})

it('CA185: source-backed professional text keeps reading semantics after definition identity changes', () => {
  const project = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'alias', revision: 0, title: '库插入',
    definitions: { alias: { id: 'alias', role: 'content', professionalBuiltinKey: 'guoling.text', implementation: { kind: 'source', language: 'typescript', source: 'export default {}' } } },
    instances: { text: { id: 'text', definitionId: 'alias', data: { content: { inlines: [{ type: 'text', text: '专业正文仍可编辑' }] } } } },
    surfaces: [{ id: 'page', kind: 'flow', title: '页', childIds: ['text'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const block = buildComponentReadingProjection(project, 'page').blocks[0]!
  expect(block.kind).toBe('text')
  expect(block.kind === 'text' && renderDocumentText(block.data.content)).toContain('专业正文仍可编辑')
})

it('CA047: repeated author registrations release their cleanup immediately and disposal calls only the remaining registration', async () => {
  let context: ComponentRuntimeContext | undefined
  const unregister = vi.fn(), removed = vi.spyOn(Set.prototype, 'delete')
  const host = new ComponentRuntimeHost({ resolveImplementation: () => ({ mount(value) { context = value; return { update() {}, dispose() {} } } }),
    ports: () => ({ target: () => null, events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } }),
    authoring: () => ({ register: () => unregister }) })
  await host.create({ runScopeId: 'registrations', definition: { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }, instance: { id: 'web', definitionId: 'web', data: {} } })
  for (let index = 0; index < 100; index++) {
    const off = context!.authoring!.register({ kind: 'text', initialValue: String(index), localBounds: { width: 1, height: 1, transform: [1, 0, 0, 1, 0, 0] } })
    off(); off()
    expect(removed).toHaveBeenCalledWith(off)
  }
  context!.authoring!.register({ kind: 'text', initialValue: 'current', localBounds: { width: 1, height: 1, transform: [1, 0, 0, 1, 0, 0] } })
  expect(unregister).toHaveBeenCalledTimes(100)
  await host.disposeScope('registrations')
  expect(unregister).toHaveBeenCalledTimes(101)
})
