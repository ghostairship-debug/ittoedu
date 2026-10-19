// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import { randomUUID } from 'node:crypto'
import { assembleMeasuredHtml, sourceProgramAssembly, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import type { ComponentInstance, CourseProjectV10, JsonObject } from '../../src/shared/contracts/component-platform'
import type { DocumentCommand, DocumentOperation, DocumentResources, DocumentPersistence } from '../../src/shared/workbench/document'
import type { ContentApplyRequest } from '../../src/main/workbench/contentApply/application/types'
import { auditExportPng } from '../fixtures/auditExportPng'
import { documentColorChannels } from '../../src/shared/document/color'

let browser: Browser, captureBundle: string
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'NativeAssembly', target: 'es2022' })
  captureBundle = bundle.outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

/** The production browser capture and assembly run here; only Electron's disposable window is replaced. */
async function measure(request: HtmlDesignMeasurementRequest) {
  const prepared = prepareMeasurementDocument(request)
  const source = { html: request.html, ...(request.themeCss === undefined ? {} : { themeCss: request.themeCss }) }
  const framing = request.framing ?? (prepared.documentKind === 'document' ? 'viewport' : 'content')
  if (prepared.documentProgramReason && framing === 'viewport') return sourceProgramAssembly(request.viewport, source, prepared.documentProgramReason)
  const page = await browser.newPage({ viewport: request.viewport })
  try {
    await page.setContent('<!doctype html><body></body>')
    await page.addScriptTag({ content: captureBundle })
    await page.setContent(prepared.html)
    const capture = await page.evaluate(() => {
      const api = (window as any).NativeAssembly
      return api.captureHtmlDesignViewport(200, api.cssUsesViewport)
    }) as HtmlDesignCapture
    const references = Object.entries(request.resourceUrls ?? {}).map(([reference, url]) => [url, reference] as const)
    const restore = (value: string) => references.reduce((text, [url, reference]) => text.split(url).join(reference), value)
    const restoreStyle = (style: Record<string, string> | undefined) => {
      if (style) for (const [name, value] of Object.entries(style)) style[name] = restore(value)
    }
    for (const element of capture.elements) {
      const original = prepared.originalElements.get(element.sourcePath.join('/'))
      if (original) { element.attributes = original.attributes; element.sourceHtml = original.sourceHtml }
      restoreStyle(element.style); restoreStyle(element.sourceStyle); restoreStyle(element.inheritedStyle)
      Object.values(element.pseudoElements).forEach(restoreStyle)
    }
    restoreStyle(capture.pageStyle)
    if (capture.sourceCss) capture.sourceCss = restore(capture.sourceCss)
    if (capture.supportCss) capture.supportCss = restore(capture.supportCss)
    for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml(source, capture.elements[scope.index]!.sourcePath)
    return assembleMeasuredHtml(capture, source, framing)
  } finally { await page.close() }
}

async function authoring(project = createBlankCourseProjectV10('Native page background')) {
  const driver = new CourseV10Driver()
  let saved: Uint8Array | undefined
  const persistence: DocumentPersistence = { async append() {}, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('Expected a file binding')
    saved = Uint8Array.from(input.bytes)
    return { ...input.binding, version: `revision-${input.revision}` }
  } }
  const registryOptions = { drivers: [driver], createId: randomUUID, bindingKey: (binding: { path: string }) => binding.path, persistence }
  let registry = new DocumentRegistry(registryOptions)
  let session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'background.glx')
  const current = () => {
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected V10')
    return model.project
  }
  const execute = (mutation: DocumentOperation['mutation']) => {
    const snapshot = session.read()
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: randomUUID(), actor: 'agent', mutation })
  }
  const resources = (): DocumentResources => session.read().model.resources
  const service = new ContentApplyService({ session: { project: current, resources,
    dispatch: (command: DocumentCommand) => execute({ type: 'command', command }) }, measure,
    compilation: { async compile() { throw new Error('Builtin assembly must not compile a new implementation') } } })
  const apply = (html: string, intent: 'insert' | 'redo' = 'insert') => service.apply({ intent,
    target: { kind: 'container', container: { kind: 'surface', surfaceId: current().surfaces[0]!.id } }, source: { kind: 'html', html } })
  return { current, apply, service, resources, snapshot: () => session.read(), execute,
    async reopen() {
      const binding = { kind: 'file' as const, path: 'D:/native-background-test.glx', version: null, bindingVersion: 0 }
      await registry.save(session.documentId, binding)
      if (!saved) throw new Error('Registry save did not serialize the canonical model')
      registry = new DocumentRegistry(registryOptions)
      session = await registry.open(binding, async () => driver.load(saved!))
      return current()
    } }
}

const documentHtml = (content: string, css = '', background = '#edf2fa') => `<!doctype html><html><head><style>
html,body{margin:0;width:1280px;height:720px}body{font:24px/1.4 Arial;background:#fff;color:#203040}
main{position:relative;width:1280px;height:720px;background:${background}}
h1,p{margin:0;font-weight:400}h1{position:absolute;left:64px;top:40px;font-size:40px;line-height:48px}
${css}</style></head><body><main>${content}</main></body></html>`
const data = (instance: ComponentInstance) => instance.data as JsonObject
const text = (instance: ComponentInstance) => (data(instance).content as { inlines: { type: string; text?: string }[] } | undefined)?.inlines.map(value => value.text ?? '').join('')
const frames = (project: CourseProjectV10) => Object.fromEntries(Object.values(project.instances).map(instance => [instance.id, instance.frame]))
const pageSized = (instance: ComponentInstance) => instance.frame?.width === 1280 && instance.frame.height === 720
const htmlRequest = (html: string, surfaceId: string): ContentApplyRequest => ({ intent: 'redo', target: { kind: 'container', container: { kind: 'surface', surfaceId } }, source: { kind: 'html', html } })

it('commits page paint and independent native card/text in one history entry and preserves them on cold load', async () => {
  const harness = await authoring()
  const html = documentHtml('<h1>Independent heading</h1><section class="card"><p>Editable card text</p></section><p class="upper">Upper overlay</p><i class="decoration"></i><p class="lower">Lower overlay</p><p class="caption">Independent caption</p>',
    'main{isolation:isolate}.card{position:absolute;left:80px;top:160px;width:420px;height:220px;background:#fff;border-radius:20px;isolation:isolate}.card p{position:absolute;left:24px;top:28px;width:360px}.caption{position:absolute;left:80px;top:440px}.upper,.lower{position:absolute;left:80px;top:160px}.upper{z-index:3}.lower{z-index:-2}.decoration{position:absolute;left:70px;top:150px;width:440px;height:240px;background:#efdddd;z-index:1}')
  expect(await harness.apply(html)).toMatchObject({ commit: 'committed', usability: 'usable' })
  const inserted = harness.current(), surface = inserted.surfaces[0]!
  expect(surface.background).toMatchObject({ mode: 'own', color: 'rgb(237, 242, 250)', assetId: null })
  expect(Object.values(inserted.instances).some(pageSized)).toBe(false)
  expect(harness.snapshot()).toMatchObject({ revision: 1, undoDepth: 1 })
  const card = Object.values(inserted.instances).find(instance => instance.definitionId === 'guoling.group')!
  expect(card.frame).toEqual({ width: 420, height: 220, transform: [1, 0, 0, 1, 80, 160] })
  expect(surface.childIds).toContain(card.id)
  const bodyText = Object.values(inserted.instances).find(instance => text(instance) === 'Editable card text')!
  expect(bodyText.definitionId).toBe('guoling.text')
  expect(card.childIds).toContain(bodyText.id)
  expect(bodyText.frame?.transform).toEqual([1, 0, 0, 1, 24, 28])
  expect(card.childIds!.map(id => inserted.instances[id]!.definitionId)).toContain('guoling.shape')
  const heading = Object.values(inserted.instances).find(instance => text(instance) === 'Independent heading')!
  expect(surface.childIds).toContain(heading.id)
  const lower = Object.values(inserted.instances).find(instance => text(instance) === 'Lower overlay')!
  const upper = Object.values(inserted.instances).find(instance => text(instance) === 'Upper overlay')!
  const decoration = Object.values(inserted.instances).find(instance => instance.definitionId === 'guoling.shape' && instance.frame?.width === 440)!
  expect(lower.frame?.transform).toEqual([1, 0, 0, 1, 80, 160])
  expect(upper.frame?.transform).toEqual([1, 0, 0, 1, 80, 160])
  expect(decoration.frame).toEqual({ width: 440, height: 240, transform: [1, 0, 0, 1, 70, 150] })
  expect(surface.childIds.indexOf(lower.id)).toBeLessThan(surface.childIds.indexOf(card.id))
  expect(surface.childIds.indexOf(card.id)).toBeLessThan(surface.childIds.indexOf(decoration.id))
  expect(surface.childIds.indexOf(decoration.id)).toBeLessThan(surface.childIds.indexOf(upper.id))

  expect(await harness.execute({ type: 'undo' })).toMatchObject({ status: 'applied' })
  expect(harness.current().instances).toEqual({})
  expect(harness.current().surfaces[0]!.background).toBeUndefined()
  expect(await harness.execute({ type: 'redo' })).toMatchObject({ status: 'applied' })
  expect(harness.current().surfaces).toEqual(inserted.surfaces)
  expect(harness.current().instances).toEqual(inserted.instances)

  const beforeFrames = frames(harness.current())
  expect(await harness.service.apply({ intent: 'content', target: { kind: 'instance', instanceId: bodyText.id },
    source: { kind: 'data', fields: [{ path: ['content'], value: { inlines: [{ type: 'text', text: 'Updated card text' }] } }] } })).toMatchObject({ commit: 'committed' })
  expect(text(harness.current().instances[bodyText.id]!)).toBe('Updated card text')
  expect(frames(harness.current())).toEqual(beforeFrames)
  expect(harness.current().instances[heading.id]).toEqual(inserted.instances[heading.id])
  const beforeReload = harness.current()
  const reloaded = await harness.reopen()
  expect(reloaded.surfaces).toEqual(beforeReload.surfaces)
  expect(reloaded.instances).toEqual(beforeReload.instances)
  expect(reloaded.surfaces[0]!.background).toEqual(surface.background)
  expect(text(reloaded.instances[bodyText.id]!)).toBe('Updated card text')
  expect(frames(reloaded)).toEqual(beforeFrames)
}, 20000)

it('adopts a bound background image as surface paint with its real fit and asset bytes', async () => {
  const harness = await authoring()
  const pixel = `data:image/png;base64,${Buffer.from(auditExportPng(8, 4)).toString('base64')}`
  const html = documentHtml('<h1>Image page</h1>', `main{background-image:url("${pixel}");background-size:cover;background-position:center;background-repeat:no-repeat}`)
  expect(await harness.apply(html)).toMatchObject({ commit: 'committed' })
  const project = harness.current(), background = project.surfaces[0]!.background!
  expect(background).toMatchObject({ mode: 'own', fit: 'cover' })
  expect(typeof background.assetId).toBe('string')
  expect(project.assets[background.assetId!]).toMatchObject({ mimeType: 'image/png' })
  expect(harness.resources().assets[background.assetId!]!.byteLength).toBeGreaterThan(0)
  expect(Object.values(project.instances).map(instance => instance.definitionId)).toEqual(['guoling.text'])
  expect(Object.values(project.instances).some(pageSized)).toBe(false)
}, 20000)

it('keeps existing manual page paint and content frames during insert, while an explicit redo adopts new paint', async () => {
  const initial = createBlankCourseProjectV10('A manually painted empty page')
  initial.surfaces[0]!.background = { mode: 'own', color: '#ffeedd', assetId: null }
  const harness = await authoring(initial)
  expect(await harness.apply(documentHtml('<h1>Existing heading</h1>'))).toMatchObject({ commit: 'committed' })
  const surfaceId = harness.current().surfaces[0]!.id
  expect(harness.current().surfaces[0]!.background).toEqual(initial.surfaces[0]!.background)
  const existing = structuredClone(harness.current().instances)
  const html = documentHtml('<p class="new">New content</p>', '.new{position:absolute;left:600px;top:240px}', '#112233')
  expect(await harness.apply(html)).toMatchObject({ commit: 'committed' })
  expect(harness.current().surfaces[0]!.background).toEqual({ mode: 'own', color: '#ffeedd', assetId: null })
  for (const [id, instance] of Object.entries(existing)) expect(harness.current().instances[id]).toEqual(instance)
  expect(Object.values(harness.current().instances).some(pageSized)).toBe(false)
  expect(await harness.service.apply(htmlRequest(html, surfaceId))).toMatchObject({ commit: 'committed' })
  expect(harness.current().surfaces[0]!.background).toMatchObject({ color: 'rgb(17, 34, 51)' })
  expect(Object.values(harness.current().instances).map(text)).toEqual(['New content'])
  const beforePaintOnly = harness.snapshot().undoDepth
  expect(await harness.apply(documentHtml('', '', 'rgba(52,86,120,0.25)'), 'redo')).toMatchObject({ commit: 'committed' })
  // The translucent main paint composes over the white document canvas.
  expect(documentColorChannels(harness.current().surfaces[0]!.background!.color!)).toEqual({ red: 204.25, green: 212.75, blue: 221.25, alpha: 1 })
  expect(harness.current().instances).toEqual({})
  expect(harness.snapshot().undoDepth).toBe(beforePaintOnly + 1)
}, 20000)

it('retains complex local source independently and keeps an executable document as source without static conversion', async () => {
  const harness = await authoring()
  const html = documentHtml('<h1>Independent title</h1><details><summary>Open local content</summary><p>Hidden local body</p></details>',
    'details{position:absolute;left:80px;top:160px;width:420px;background:linear-gradient(#fff,#ddeeff)}')
  expect(await harness.apply(html)).toMatchObject({ commit: 'committed' })
  const project = harness.current()
  expect(Object.values(project.instances).some(instance => instance.definitionId === 'guoling.text' && text(instance) === 'Independent title')).toBe(true)
  const retained = Object.values(project.instances).find(instance => typeof data(instance).html === 'string')!
  expect(data(retained).html).toContain('<details')
  expect(data(retained).html).toContain('Hidden local body')
  expect(retained.frame?.width).toBe(420)
  expect(pageSized(retained)).toBe(false)
  const program = '<!doctype html><style>body{background:#123456}</style><button onclick="this.textContent=\'live\'">Run</button><script>window.lessonState={count:0}</script>'
  expect(await harness.apply(program, 'redo')).toMatchObject({ commit: 'committed', usability: 'unverified' })
  expect(Object.values(harness.current().instances)).toHaveLength(1)
  const executable = Object.values(harness.current().instances)[0]!
  expect(executable.definitionId).toBe('guoling.html-program')
  expect(data(executable).html).toContain('window.lessonState={count:0}')
  expect(data(executable).html).toContain('onclick=')
  expect(harness.current().assets).toEqual({})
}, 20000)
