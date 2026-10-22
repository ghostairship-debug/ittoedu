import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { assembleMeasuredHtml, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { assemblyContentDraft } from '../../src/main/workbench/contentApply/application/html'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { ComponentInstance } from '../../src/shared/contracts/component-platform'
import type { DocumentCommand } from '../../src/shared/workbench/document'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'

function htmlOf(instance: ComponentInstance | undefined): string {
  const data = instance?.data
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') throw new Error('Expected a retained editable HTML source')
  return data.html
}

const output = 'output/repair-visual-interactive-20261015/run-db19oE/html'
const inputs = 'tests/fixtures/htmlAssemblyFidelity20261015.inputs.json'

it.each(['cover', 'program'] as const)('preserves the frozen %s layout through real capture and the published consumer', async name => {
  const html = JSON.parse(await readFile(inputs, 'utf8'))[name] as string
  const browser = await chromium.launch({ headless: true })
  const bundle = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Fidelity', target: 'es2022' })
  const facts: any = { name }
  await mkdir(output, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.setContent('<!doctype html><body></body>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    const prepared = prepareMeasurementDocument({ html })
    await page.setContent(prepared.html)
    facts.original = await page.evaluate(name => {
      const element = document.querySelector(name === 'cover' ? 'small' : 'iframe')!
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }, name)
    facts.originalStyle = await page.evaluate(() => [...document.querySelectorAll('.cover,.cover small,.cover p')].map(element => ({ tag: element.localName, style: element.getAttribute('style'), font: getComputedStyle(element).font, lineHeight: getComputedStyle(element).lineHeight })))
    const capture = await page.evaluate(() => { const api = (window as any).Fidelity; return api.captureHtmlDesignViewport(200, api.cssUsesViewport) }) as HtmlDesignCapture
    for (const element of capture.elements) {
      const original = prepared.originalElements.get(element.sourcePath.join('/'))
      if (original) { element.attributes = original.attributes; element.sourceHtml = original.sourceHtml }
    }
    for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml({ html }, capture.elements[scope.index]!.sourcePath)
    const assembly = assembleMeasuredHtml(capture, { html }, 'content')
    const draft = assemblyContentDraft(assembly, {}, { definitions: {}, createFormulaId: () => crypto.randomUUID() })
    const blank = createBlankCourseProjectV10(`Frozen ${name}`)
    const plan = planContentApply({ project: blank, createId: () => crypto.randomUUID(), request: { intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: componentSurfaces(blank)[0]!.id } }, source: { kind: 'objects', objects: [draft.draft], definitions: draft.definitions } } })
    let project = applyComponentOperation(blank, plan.command)
    facts.diagnostics = assembly.diagnostics
    facts.scopes = capture.sourceScopes?.map(scope => ({ path: capture.elements[scope.index]!.sourcePath, reason: scope.reason }))
    facts.instances = Object.values(project.instances).map(instance => ({ id: instance.id, definitionId: instance.definitionId, frame: instance.frame }))
    const editable = Object.values(project.instances).find(instance => {
      const data = instance.data
      return data && typeof data === 'object' && !Array.isArray(data) && typeof data.html === 'string' && data.html.includes(name === 'cover' ? '<small>' : '变法议事局部实验')
    })
    if (!editable?.frame) throw new Error('Expected an editable measured region')
    const beforeFrame = structuredClone(editable.frame), driver = new CourseV10Driver()
    const registryOptions = { drivers: [driver], createId: randomUUID, bindingKey: (binding: { path: string }) => binding.path,
      persistence: { async append() {}, async save(input: { binding: { kind: string; path?: string }; bytes: Uint8Array; revision: number }) {
        if (input.binding.kind !== 'file' || !input.binding.path) throw new Error('File binding required')
        await writeFile(input.binding.path, input.bytes)
        return { kind: 'file' as const, path: input.binding.path, version: `revision-${input.revision}`, bindingVersion: 0 }
      } } }
    let registry = new DocumentRegistry(registryOptions)
    let session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, `${name}.glx`)
    const currentProject = () => { const model = session.read().model; if (model.kind !== 'course-v10') throw new Error('V10 expected'); return model.project }
    const dispatch = async (command: DocumentCommand) => {
      const current = session.read()
      return session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        operationId: randomUUID(), actor: 'agent', mutation: { type: 'command', command } })
    }
    const textReplace = async (before: string, after: string) => {
      const gateway = new DocumentToolGateway(registry, [driver], randomUUID), runId = randomUUID()
      await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
      const source = htmlOf(currentProject().instances[editable.id]), start = source.indexOf(before)
      if (start < 0) throw new Error('Original text field is absent')
      const target = await gateway.issueTarget(runId, session.documentId, { kind: 'course-instance', surfaceId: componentSurfaces(project)[0]!.id, instanceId: editable.id,
        authorField: { kind: 'text', initialValue: before, sourceRegion: { kind: 'data', path: ['html'], start, end: start + before.length, encoding: 'html-text' } } })
      const result = await gateway.execute(runId, randomUUID(), { name: 'text.replace', input: { target, content: after } })
      expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      return result
    }
    const sourceReplace = async (before: string, after: string) => {
      const service = new ContentApplyService({ session: { project: currentProject, dispatch },
        measure: async () => { throw new Error('A local source edit must not measure the page again') },
        compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
      const result = await service.apply({ intent: 'content', target: { kind: 'instance', instanceId: editable.id }, source: { kind: 'html', html: htmlOf(currentProject().instances[editable.id]).replace(before, after) } })
      expect(result.commit).toBe('committed')
      return result
    }
    const warmEdit = name === 'cover' ? await textReplace('天下拼图', '天下新图') : await sourceReplace('检查并记录', '检查与记录')
    const filename = resolve(output, `${name}-session.glx`), binding = { kind: 'file' as const, path: filename, version: null, bindingVersion: 0 }
    await registry.save(session.documentId, binding)
    registry = new DocumentRegistry(registryOptions)
    session = await registry.open(binding, async () => driver.load(new Uint8Array(await readFile(filename))))
    const coldEdit = name === 'cover' ? await textReplace('有证据，也有代价', '有证据，也有取舍') : await sourceReplace('当前结果', '本轮结果')
    await registry.save(session.documentId)
    project = currentProject()
    expect(project.instances[editable.id]!.frame).toEqual(beforeFrame)
    expect(htmlOf(project.instances[editable.id])).toContain(name === 'cover' ? '天下新图' : '检查与记录')
    facts.localEdit = { id: editable.id, frame: project.instances[editable.id]!.frame, filename, warmEdit, coldEdit, coldRegistry: true, revision: session.read().revision, dirty: session.read().dirty }
    await writeFile(`${output}/${name}-project.json`, JSON.stringify(project, null, 2))
    const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
    await page.goto('about:blank')
    await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:1280px;height:720px}</style><div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.evaluate<void, unknown>(async value => {
      const payload = value as PublishedCourseV3
      const api = (window as any).Fidelity
      const artifact = await api.compileCoursePlayback(payload, { document, renderBuiltin: (instance: any, key: string, value: any) => api.renderCompiledBuiltin(instance, key, value, document) })
      ;(window as any).player = await api.mountCompiledCourse(artifact, document.getElementById('root'))
    }, published.payload)
    await page.waitForFunction(name => {
      const roots: ParentNode[] = [document]
      const inspect = (root: ParentNode): boolean => [...root.querySelectorAll('*')].some(node => {
        if (name === 'cover' && node.localName === 'small') return true
        if (name === 'program' && node.localName === 'iframe' && (node as HTMLIFrameElement).contentDocument?.querySelector('#check')) return true
        return node.shadowRoot ? inspect(node.shadowRoot) : node.localName === 'iframe' && (node as HTMLIFrameElement).contentDocument ? inspect((node as HTMLIFrameElement).contentDocument!) : false
      })
      return roots.some(inspect)
    }, name)
    facts.actual = await page.evaluate(name => {
      const found: { element: Element; x: number; y: number }[] = []
      const walk = (root: ParentNode, x = 0, y = 0): void => {
        for (const node of root.querySelectorAll('*')) {
          if (node.localName === (name === 'cover' ? 'small' : 'iframe') && (name === 'cover' || node.getAttribute('title') === '变法议事局部实验')) found.push({ element: node, x, y })
          if (node.shadowRoot) walk(node.shadowRoot, x, y)
          if (node.localName === 'iframe') {
            const frame = node as HTMLIFrameElement, rect = frame.getBoundingClientRect()
            if (frame.contentDocument) walk(frame.contentDocument, x + rect.x, y + rect.y)
          }
        }
      }
      walk(document)
      return found.map(({ element, x, y }) => {
        const rect = element.getBoundingClientRect()
        return { x: x + rect.x, y: y + rect.y, width: rect.width, height: rect.height, font: getComputedStyle(element).font, lineHeight: getComputedStyle(element).lineHeight, ancestors: [element.parentElement, element.parentElement?.parentElement].filter(Boolean).map(node => ({ tag: node!.localName, style: node!.getAttribute('style'), font: getComputedStyle(node!).font, lineHeight: getComputedStyle(node!).lineHeight })) }
      })
    }, name)
    await page.screenshot({ path: `${output}/${name}-actual.png` })
    expect(facts.actual).toHaveLength(1)
    for (const axis of ['x', 'y', 'width', 'height']) expect(facts.actual[0][axis]).toBeCloseTo(facts.original[axis], 1)
    if (name === 'program') {
      // The ordinary heading remains independent; only the local executable region is retained.
      expect(Object.values(project.instances).some(instance => instance.definitionId === 'guoling.text')).toBe(true)
      expect(Object.values(project.instances).filter(instance => instance.definitionId === 'guoling.html-program')).toHaveLength(1)
      const program = Object.values(project.instances).find(instance => instance.definitionId === 'guoling.html-program')!
      expect(program.frame).toMatchObject({ width: 1172, height: 490 })
      facts.interaction = await page.evaluate(() => {
        let target: HTMLIFrameElement | undefined
        const find = (root: ParentNode): void => { for (const node of root.querySelectorAll('*')) {
          if (node.shadowRoot) find(node.shadowRoot)
          if (node.localName === 'iframe') { const frame = node as HTMLIFrameElement; if (frame.title === '变法议事局部实验') target = frame; else if (frame.contentDocument) find(frame.contentDocument) }
        } }
        find(document)
        const doc = target!.contentDocument!
        ;(doc.querySelector('#check') as HTMLButtonElement).click()
        return { feedback: doc.querySelector('#result')!.textContent, editedButton: doc.querySelector('#check')!.textContent }
      })
      expect(facts.interaction.feedback).toContain('请选择恰好两项改革')
      expect(facts.interaction.editedButton).toBe('检查与记录')
    } else {
      expect(await page.evaluate(() => [...document.querySelectorAll('*')].flatMap(node => node.shadowRoot ? [...node.shadowRoot.querySelectorAll('h1')] : []).map(node => node.textContent))).toContain('天下新图')
    }
    facts.pass = true
  } catch (error) { facts.failure = String(error); throw error }
  finally { await writeFile(`${output}/${name}-facts.json`, JSON.stringify(facts, null, 2)); await browser.close() }
}, 45000)

it('keeps text formatting independent and closes only the actual selector/containing-block dependencies', async () => {
  const browser = await chromium.launch({ headless: true })
  const bundle = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Fidelity', target: 'es2022' })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    for (const name of ['formatting', 'selector', 'positioned'] as const) {
      const html = name === 'formatting'
        ? '<style>p{width:100px}</style><p>Text <b>bold words across many separate lines</b> end.</p>'
        : name === 'selector'
          ? '<style>.local{width:400px;height:180px}.local iframe:nth-child(2){width:350px;height:120px}</style><h1>Independent title</h1><section class="local"><p>Preceding sibling</p><iframe srcdoc="<p>live</p>"></iframe></section>'
          : '<style>main{position:relative;width:600px;height:300px}section{width:200px;height:180px}small{font:18px/1.5 Arial}i{position:absolute;right:0;bottom:0;width:20px;height:20px}</style><h1>Independent title</h1><main><section><p>block before</p><small>line 1<br>line 2<br>line 3</small><i></i></section></main>'
      await page.goto('about:blank')
      await page.setContent('<!doctype html><body></body>')
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
      const prepared = prepareMeasurementDocument({ html })
      await page.setContent(prepared.html)
      const capture = await page.evaluate(() => { const api = (window as any).Fidelity; return api.captureHtmlDesignViewport(200, api.cssUsesViewport) }) as HtmlDesignCapture
      for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml({ html }, capture.elements[scope.index]!.sourcePath)
      const assembly = assembleMeasuredHtml(capture, { html })
      await writeFile(`${output}/${name}-capture.json`, JSON.stringify(capture, null, 2))
      if (name === 'formatting') {
        expect(capture.elements.find(element => element.tagName === 'b')?.geometryIssue).toBe('non-rectangular-layout-box')
        expect(capture.sourceScopes).toEqual([])
        expect(assembly.root.children[0]?.kind).toBe('text')
      } else {
        const retained = capture.sourceScopes!.map(scope => capture.elements[scope.index]!.tagName)
        expect(retained).toEqual([name === 'selector' ? 'section' : 'main'])
        expect(capture.sourceScopes!.some(scope => scope.index === capture.body)).toBe(false)
        expect(assembly.root.children[0]?.kind).toBe('text')
        if (name === 'selector') {
          expect(assembly.root.children[1]?.kind).toBe('program')
          const draft = assemblyContentDraft(assembly, {}, { modules: { 'local.js': 'export default 1' }, definitions: {}, createFormulaId: () => crypto.randomUUID() })
          expect(draft.draft.children?.[1]?.data).toMatchObject({ modules: { 'local.js': 'export default 1' } })
        }
      }
    }
  } finally { await browser.close() }
}, 20000)
